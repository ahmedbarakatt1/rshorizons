import {afterEach,describe,expect,it,vi} from "vitest";
import {randomUUID} from "node:crypto";
import {deliverNotification} from "@/integrations/messaging/notifications";
import {route} from "@/server/api/router";
import {admin,makeActor,makeBooking,makeDeparture,tourItem} from "../database/helpers";
import {newSecret,digestSecret} from "@/server/security";

afterEach(()=>vi.unstubAllEnvs());
async function fixture(){
  const db=admin();await db.connect();
  const {booking}=await makeBooking(db,[await tourItem(db,(await makeDeparture(db)).id)]);
  const guest=(await db.query("UPDATE app.guests SET phone_e164='+201000000001' WHERE id=(SELECT primary_guest_id FROM app.bookings WHERE id=$1) RETURNING id",[booking.id])).rows[0].id;
  await db.query("INSERT INTO app.guest_consents(guest_id,type,granted,policy_version,collection_source) VALUES($1,'whatsapp_booking',true,'test','test')",[guest]);
  const event=(await db.query("SELECT id,event_type,aggregate_id,payload FROM app.outbox_events WHERE aggregate_id=$1 AND event_type='request_received'",[booking.id])).rows[0];
  const job=(await db.query("INSERT INTO app.jobs(event_id,kind,job_key,status,attempts,lease_until) VALUES($1,'notification',$2,'running',1,now()+interval '2 minutes') RETURNING id,attempts",[event.id,randomUUID()])).rows[0];
  return {db,booking,guest,job:{...job,event}};
}
describe("manual WhatsApp links",()=>{
  it("uses email without contacting a gateway even when old approved WhatsApp templates and consent exist",async()=>{
    vi.stubEnv("APP_ENV","test");vi.stubEnv("DEMO_MODE","true");vi.stubEnv("EMAIL_PROVIDER","local");vi.stubEnv("WHATSAPP_PROVIDER","openwa");
    const f=await fixture();const send=vi.spyOn(globalThis,"fetch");
    try{
      await f.db.query("INSERT INTO app.notification_templates(event_type,channel,locale,template_version,provider,approval_status,category,subject_template,body_template) VALUES('request_received','email','en',987659,'local','approved','transactional','Request {{reference}}','{{access_url}}') ON CONFLICT DO NOTHING");
      await f.db.query("INSERT INTO app.notification_templates(event_type,channel,locale,template_version,provider,approval_status,category,body_template) VALUES('request_received','whatsapp','en',987659,'openwa','approved','utility','{{reference}}') ON CONFLICT DO NOTHING");
      expect(await deliverNotification(f.job)).toMatchObject({channel:"email",external:false});
      expect(send).not.toHaveBeenCalled();
      expect((await f.db.query("SELECT channel FROM app.notification_deliveries WHERE job_id=$1",[f.job.id])).rows).toEqual([{channel:"email"}]);
      expect(await deliverNotification(f.job)).toMatchObject({alreadyProcessed:true});
    }finally{send.mockRestore();await f.db.end();}
  });
  it("records a manual action for a phone-only booking without claiming delivery or creating a private access token",async()=>{
    const f=await fixture();const send=vi.spyOn(globalThis,"fetch");
    try{
      await f.db.query("UPDATE app.guests SET email=NULL WHERE id=$1",[f.guest]);
      expect(await deliverNotification(f.job)).toEqual({status:"suppressed",reason:"MANUAL_CONTACT_REQUIRED",external:false});
      expect((await f.db.query("SELECT count(*)::int n FROM app.access_grants WHERE booking_id=$1",[f.booking.id])).rows[0].n).toBe(0);
      expect(send).not.toHaveBeenCalled();
      const actor=await makeActor(f.db),token=newSecret();
      await f.db.query("INSERT INTO app.local_operator_sessions(staff_id,token_hash,expires_at,redeemed_at) VALUES($1,$2,now()+interval '1 hour',now())",[actor,digestSecret(token)]);
      const read=async()=>{
        const response=await route(new Request("http://127.0.0.1:3000/api/v1/admin/notification-deliveries",{headers:{cookie:`rsh_local_staff=${token}`}}),["admin","notification-deliveries"]);
        expect(response.status).toBe(200);return (await response.json()).data.items;
      };
      expect(await read()).toEqual(expect.arrayContaining([expect.objectContaining({booking_id:f.booking.id,reference:f.booking.reference,event_type:"request_received",error_class:"MANUAL_CONTACT_REQUIRED",status:"suppressed"})]));
      await f.db.query("DELETE FROM app.staff_scopes WHERE staff_id=$1",[actor]);
      expect(await read()).not.toEqual(expect.arrayContaining([expect.objectContaining({booking_id:f.booking.id})]));
    }finally{send.mockRestore();await f.db.end();}
  });
  it("prepares a scoped staff draft from the saved number, enforces current consent and never records a send",async()=>{
    const f=await fixture();
    try{
      const actor=await makeActor(f.db),token=newSecret();
      await f.db.query("INSERT INTO app.local_operator_sessions(staff_id,token_hash,expires_at,redeemed_at) VALUES($1,$2,now()+interval '1 hour',now())",[actor,digestSecret(token)]);
      const path=`admin/bookings/${f.booking.id}/whatsapp-link`;
      const read=(cookie="")=>route(new Request(`http://127.0.0.1:3000/api/v1/${path}`,{headers:{cookie}}),path.split("/"));
      expect((await read()).status).toBe(401);
      const response=await read(`rsh_local_staff=${token}`);expect(response.status).toBe(200);
      const body=(await response.json()).data;const url=new URL(body.url);
      expect(url.origin+url.pathname).toBe("https://wa.me/201000000001");
      expect(url.searchParams.get("text")).toContain(f.booking.reference);
      expect(body.url).not.toMatch(/token=|guest-access|@example/);
      expect((await f.db.query("SELECT count(*)::int n FROM app.notification_deliveries WHERE job_id=$1",[f.job.id])).rows[0].n).toBe(0);
      await f.db.query("DELETE FROM app.staff_scopes WHERE staff_id=$1",[actor]);
      expect((await read(`rsh_local_staff=${token}`)).status).toBe(403);
      await f.db.query("INSERT INTO app.staff_scopes(staff_id,scope_type) VALUES($1,'all')",[actor]);
      await f.db.query("INSERT INTO app.guest_consents(guest_id,type,granted,policy_version,collection_source) VALUES($1,'whatsapp_booking',false,'withdrawn','test')",[f.guest]);
      expect((await read(`rsh_local_staff=${token}`)).status).toBe(409);
      await f.db.query("UPDATE app.staff_profiles SET active=false WHERE id=$1",[actor]);
      expect((await read(`rsh_local_staff=${token}`)).status).toBe(403);
    }finally{await f.db.end();}
  });
  it("retires gateway webhook endpoints",async()=>{
    for(const provider of ["openwa","whatsapp"]){
      const response=await route(new Request(`http://127.0.0.1:3000/api/v1/webhooks/${provider}`,{method:"POST",body:"{}",headers:{origin:process.env.APP_BASE_URL??"http://127.0.0.1:3000","content-type":"application/json"}}),["webhooks",provider]);
      expect(response.status).toBe(404);
    }
  });
});
