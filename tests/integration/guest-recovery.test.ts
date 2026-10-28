import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {readFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {admin,makeActor,makeBooking,makeDeparture,tourItem} from "../database/helpers";
import {route} from "@/server/api/router";
import {getGuest,redeemGuestGrant} from "@/server/auth";
import {deliverNotification} from "@/integrations/messaging/notifications";
import {startPayment} from "@/modules/payments/service";

beforeEach(()=>{vi.stubEnv("APP_ENV","test");vi.stubEnv("DEMO_MODE","true");vi.stubEnv("EMAIL_PROVIDER","local");});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
const base=process.env.APP_BASE_URL??"http://127.0.0.1:3000";
async function requestLink(reference:string,contact:string){
  return route(new Request(`${base}/api/v1/guest-access/request`,{method:"POST",headers:{origin:base,"content-type":"application/json"},body:JSON.stringify({reference,contact,locale:"en"})}),["guest-access","request"]);
}
async function previewToken(messageId:string){
  const message=JSON.parse(await readFile(`.local/outbox/${messageId.slice(6)}.json`,"utf8"));
  const url=new URL(message.text.match(/https?:\/\/\S+/)[0]);
  return {url,token:new URLSearchParams(url.hash.slice(1)).get("token")!};
}
describe("guest recovery and emailed booking access",()=>{
  it("queues one enumeration-resistant recovery event and delivers a fresh one-use link in the saved guest language",async()=>{
    const db=admin();await db.connect();
    try{
      await db.query("DELETE FROM app.rate_limit_buckets WHERE operation='guest-access'");
      const {booking}=await makeBooking(db,[await tourItem(db,(await makeDeparture(db)).id)]);
      await db.query("UPDATE app.guests SET locale='de' WHERE id=(SELECT primary_guest_id FROM app.bookings WHERE id=$1)",[booking.id]);
      await db.query("INSERT INTO app.notification_templates(event_type,channel,locale,template_version,provider,approval_status,category,subject_template,body_template) VALUES('guest_access_requested','email','de',987660,'local','approved','transactional','Booking access {{reference}}','{{access_url}}') ON CONFLICT DO NOTHING");
      const missing=await requestLink("TR-NOT-A-BOOKING","guest@example.invalid");
      const wrong=await requestLink(booking.reference,"wrong@example.invalid");
      const accepted=await requestLink(booking.reference,"guest@example.invalid");
      const duplicate=await requestLink(booking.reference,"guest@example.invalid");
      for(const response of [missing,wrong,accepted,duplicate])expect(response.status).toBe(202);
      const data=await accepted.json();expect((await missing.json()).data).toEqual(data.data);expect((await wrong.json()).data).toEqual(data.data);
      expect(data.data).not.toHaveProperty("token");expect(data.data).not.toHaveProperty("bookingId");
      const events=(await db.query("SELECT id,event_type,aggregate_id,payload FROM app.outbox_events WHERE aggregate_id=$1 AND event_type='guest_access_requested'",[booking.id])).rows;
      expect(events).toHaveLength(1);
      const job=(await db.query("UPDATE app.jobs SET status='running',attempts=1,lease_until=now()+interval '2 minutes' WHERE event_id=$1 RETURNING id,attempts",[events[0].id])).rows[0];
      const result=await deliverNotification({...job,event:events[0]}) as {messageId:string};
      const {url,token}=await previewToken(result.messageId);expect(url.pathname).toBe("/de/guest-access");expect(url.search).toBe("");
      expect(await deliverNotification({...job,event:events[0]})).toMatchObject({alreadyProcessed:true});
      expect((await db.query("SELECT count(*)::int n FROM app.access_grants WHERE booking_id=$1",[booking.id])).rows[0].n).toBe(1);
      const redeemed=await redeemGuestGrant(token);expect(redeemed.reference).toBe(booking.reference);
      await expect(redeemGuestGrant(token)).rejects.toMatchObject({code:"GRANT_EXPIRED"});
      const actor=await getGuest(new Request(`${base}/api/v1/bookings/${booking.reference}`,{headers:{cookie:`rsh_guest=${redeemed.sessionToken}`}}),booking.reference);
      expect(actor.bookingId).toBe(booking.id);
      await expect(getGuest(new Request(`${base}/api/v1/bookings/OTHER`,{headers:{cookie:`rsh_guest=${redeemed.sessionToken}`}}),"OTHER")).rejects.toMatchObject({status:404});
    }finally{await db.query("DELETE FROM app.rate_limit_buckets WHERE operation='guest-access'");await db.end();}
  });
  it("allows a guest arriving from an approval email to create only the approved server-priced checkout",async()=>{
    const db=admin();await db.connect();
    try{
      for(const [key,value] of Object.entries({PAYMOB_MODE:"sandbox",PAYMOB_API_BASE_URL:"https://accept.paymob.com",PAYMOB_SECRET_KEY:"synthetic-secret",PAYMOB_PUBLIC_KEY:"synthetic-public",PAYMOB_HMAC_SECRET:"synthetic-hmac",PAYMOB_ACCOUNT_ID:"123",PAYMOB_INTEGRATION_IDS:"456",PAYMOB_CARD_INTEGRATION_IDS:"456"}))vi.stubEnv(key,value);
      const owner=await makeActor(db),{booking}=await makeBooking(db,[await tourItem(db,(await makeDeparture(db)).id)],"deposit");
      await db.query("SELECT app.approve_booking($1,1,$2)",[booking.id,owner]);
      await db.query("INSERT INTO app.notification_templates(event_type,channel,locale,template_version,provider,approval_status,category,subject_template,body_template) VALUES('approved_payment_required','email','en',987660,'local','approved','transactional','Approved {{reference}}','{{access_url}}') ON CONFLICT DO NOTHING");
      const event=(await db.query("SELECT id,event_type,aggregate_id,payload FROM app.outbox_events WHERE aggregate_id=$1 AND event_type='approved_payment_required'",[booking.id])).rows[0];
      const job=(await db.query("INSERT INTO app.jobs(event_id,kind,job_key,status,attempts,lease_until) VALUES($1,'notification',$2,'running',1,now()+interval '2 minutes') RETURNING id,attempts",[event.id,randomUUID()])).rows[0];
      const result=await deliverNotification({...job,event}) as {messageId:string};
      const {token}=await previewToken(result.messageId),redeemed=await redeemGuestGrant(token);
      const actor=await getGuest(new Request(`${base}/api/v1/bookings/${booking.reference}`,{headers:{cookie:`rsh_guest=${redeemed.sessionToken}`}}),booking.reference);
      const obligation=(await db.query("SELECT id FROM app.payment_obligations WHERE booking_id=$1 AND kind='initial'",[booking.id])).rows[0].id;
      // The actual provider is external; only its HTTP boundary is substituted.
      vi.spyOn(globalThis,"fetch").mockResolvedValue(Response.json({id:randomUUID(),intention_order_id:Math.floor(Math.random()*1e9),client_secret:"synthetic-checkout"}));
      const checkout=await startPayment(actor,{obligationId:obligation,method:"card",billing:{firstName:"Synthetic",lastName:"Guest",email:"guest@example.invalid",phone:"+201000000001"}},randomUUID());
      expect(new URL(checkout.checkoutUrl).origin).toBe("https://accept.paymob.com");
      const attempt=(await db.query("SELECT booking_id,expected_amount::text,currency FROM app.payment_attempts WHERE id=$1",[checkout.attemptId])).rows[0];
      expect(attempt).toEqual({booking_id:booking.id,expected_amount:"30000",currency:"EGP"});
      expect((await db.query("SELECT status FROM app.bookings WHERE id=$1",[booking.id])).rows[0].status).toBe("approved_pending_payment");
    }finally{await db.end();}
  });
});
