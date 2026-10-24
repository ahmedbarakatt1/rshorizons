import {afterEach,describe,expect,it,vi} from "vitest";
import {createHmac,randomUUID} from "node:crypto";
import {createServer} from "node:http";
import {once} from "node:events";
import {applyMessagingWebhook,deliverNotification,verifyMessagingWebhook} from "@/integrations/messaging/notifications";
import {admin,makeBooking,makeDeparture,tourItem} from "../database/helpers";

afterEach(()=>vi.unstubAllEnvs());
const session="rsh-test-session",secret="synthetic-openwa-webhook-secret-32";
function callback(messageId:string,status="delivered",overrides:Record<string,unknown>={}){
  return JSON.stringify({event:"message.ack",sessionId:session,timestamp:new Date().toISOString(),idempotencyKey:randomUUID(),deliveryId:randomUUID(),data:{id:messageId,messageId,status},...overrides});
}
function headers(body:string){return new Headers({"x-openwa-signature":`sha256=${createHmac("sha256",secret).update(body).digest("hex")}`});}
function configure(){
  vi.stubEnv("APP_ENV","test");vi.stubEnv("DEMO_MODE","true");vi.stubEnv("EMAIL_PROVIDER","local");
  vi.stubEnv("WHATSAPP_PROVIDER","openwa");vi.stubEnv("OPENWA_SESSION_ID",session);vi.stubEnv("OPENWA_API_KEY","synthetic-key");
  vi.stubEnv("OPENWA_WEBHOOK_SECRET",secret);vi.stubEnv("MESSAGING_ACCOUNT_VERIFIED","true");vi.stubEnv("MESSAGING_SANDBOX_ALLOWLIST","+201000000001");
}
async function fixture(){
  const db=admin();await db.connect();
  const departure=await makeDeparture(db),{booking}=await makeBooking(db,[await tourItem(db,departure.id)]);
  const guest=(await db.query("UPDATE app.guests SET phone_e164='+201000000001' WHERE id=(SELECT primary_guest_id FROM app.bookings WHERE id=$1) RETURNING id",[booking.id])).rows[0].id;
  await db.query("INSERT INTO app.guest_consents(guest_id,type,granted,policy_version,collection_source) VALUES($1,'whatsapp_booking',true,'synthetic','test')",[guest]);
  // OpenWA uses agency-approved text, not Meta template IDs. The migration must allow that distinction.
  await db.query("INSERT INTO app.notification_templates(event_type,channel,locale,template_version,provider,approval_status,category,body_template) VALUES('request_received','whatsapp','en',987656,'openwa','approved','utility','Request {{reference}}. {{access_url}}') ON CONFLICT DO NOTHING");
  await db.query("INSERT INTO app.notification_templates(event_type,channel,locale,template_version,provider,approval_status,category,subject_template,body_template) VALUES('request_received','email','en',987656,'local','approved','transactional','Request {{reference}}','{{access_url}}') ON CONFLICT DO NOTHING");
  const event=(await db.query("SELECT id,event_type,aggregate_id,payload FROM app.outbox_events WHERE aggregate_id=$1 AND event_type='request_received'",[booking.id])).rows[0];
  const job=(await db.query("INSERT INTO app.jobs(event_id,kind,job_key,status,attempts,lease_until) VALUES($1,'notification',$2,'running',1,now()+interval '2 minutes') RETURNING id,attempts",[event.id,randomUUID()])).rows[0];
  return {db,guest,job:{...job,event}};
}
describe("OpenWA gateway",()=>{
  it("verifies exact signed bytes, pins the session, and accepts delayed durable retries",()=>{
    configure();
    const body=callback("message-1","read",{timestamp:new Date(Date.now()-86400000).toISOString()});
    expect(verifyMessagingWebhook("openwa",body,headers(body))[0]).toMatchObject({provider:"openwa",account:session,messageId:`${session}:message-1`,status:"read"});
    expect(()=>verifyMessagingWebhook("openwa",body+" ",headers(body))).toThrow("WEBHOOK_SIGNATURE_INVALID");
    const other=callback("message-1","read",{sessionId:"unrelated"});
    expect(()=>verifyMessagingWebhook("openwa",other,headers(other))).toThrow("WEBHOOK_ACCOUNT_MISMATCH");
    const future=callback("message-1","read",{timestamp:new Date(Date.now()+3600000).toISOString()});
    expect(()=>verifyMessagingWebhook("openwa",future,headers(future))).toThrow("WEBHOOK_TIMESTAMP_INVALID");
  });
  it("sends opted-in approved localized text over real HTTP, disables link previews, dedupes callbacks and retries",async()=>{
    configure();const messageId=randomUUID(),calls:{url?:string;key?:string;body:Record<string,unknown>}[]=[];
    const server=createServer(async(req,res)=>{const parts=[];for await(const chunk of req)parts.push(chunk);calls.push({url:req.url,key:req.headers["idempotency-key"] as string,body:JSON.parse(Buffer.concat(parts).toString())});expect(req.headers.authorization).toBe("Bearer synthetic-key");res.writeHead(201,{"Content-Type":"application/json"}).end(JSON.stringify({messageId,timestamp:Math.floor(Date.now()/1000)}));});
    server.listen(0,"127.0.0.1");await once(server,"listening");
    vi.stubEnv("OPENWA_BASE_URL",`http://127.0.0.1:${(server.address() as {port:number}).port}`);
    const f=await fixture();
    try{
      expect(await deliverNotification(f.job)).toMatchObject({provider:"openwa",channel:"whatsapp",status:"accepted",external:true});
      expect(calls).toHaveLength(1);expect(calls[0].url).toBe(`/api/sessions/${session}/messages/send-text`);
      expect(calls[0].key).toMatch(/^[a-f0-9]{64}$/);expect(calls[0].body).toMatchObject({chatId:"201000000001@c.us",linkPreview:false});
      expect(calls[0].body.text).toContain("/en/guest-access#token=");
      const body=callback(messageId),events=verifyMessagingWebhook("openwa",body,headers(body));
      expect(await applyMessagingWebhook(events)).toEqual({applied:1});expect(await applyMessagingWebhook(events)).toEqual({applied:0});
      expect(await deliverNotification({...f.job,attempts:2})).toEqual({alreadyProcessed:true});expect(calls).toHaveLength(1);
      expect((await f.db.query("SELECT status FROM app.notification_deliveries WHERE job_id=$1",[f.job.id])).rows[0].status).toBe("delivered");
      const duplicate=await fixture();try{
        // A gateway response accepted but not recorded locally is uncertain, never a reason to resend/fall back.
        await expect(deliverNotification(duplicate.job)).rejects.toThrow("NOTIFICATION_RECORD_OUTCOME_UNKNOWN");
        expect((await duplicate.db.query("SELECT channel,status FROM app.notification_deliveries WHERE job_id=$1",[duplicate.job.id])).rows).toEqual([{channel:"whatsapp",status:"unknown"}]);
      }finally{await duplicate.db.end();}
    }finally{await f.db.end();server.close();await once(server,"close");}
  });
  it.each([400,401,403,404,409,422,429,500,502])("initial gateway HTTP %s cannot prove nothing was sent or trigger fallback",async(status)=>{
    configure();const server=createServer((_req,res)=>res.writeHead(status,{"Content-Type":"application/json"}).end(JSON.stringify({message:"Synthetic engine error"})));
    server.listen(0,"127.0.0.1");await once(server,"listening");vi.stubEnv("OPENWA_BASE_URL",`http://127.0.0.1:${(server.address() as {port:number}).port}`);
    const f=await fixture();try{
      await expect(deliverNotification(f.job)).rejects.toThrow("OPENWA_SEND_OUTCOME_UNKNOWN");
      await expect(deliverNotification({...f.job,attempts:2})).rejects.toThrow("NOTIFICATION_RECONCILIATION_REQUIRED");
      expect((await f.db.query("SELECT channel,status FROM app.notification_deliveries WHERE job_id=$1",[f.job.id])).rows).toEqual([{channel:"whatsapp",status:"unknown"}]);
    }finally{await f.db.end();server.close();await once(server,"close");}
  });
  it("withdrawn consent causes no gateway send",async()=>{
    configure();vi.stubEnv("OPENWA_BASE_URL","https://gateway.example.invalid");const f=await fixture();const send=vi.spyOn(globalThis,"fetch");
    try{
      await f.db.query("INSERT INTO app.guest_consents(guest_id,type,granted,policy_version,collection_source) VALUES($1,'whatsapp_booking',false,'withdrawn','test')",[f.guest]);
      expect(await deliverNotification(f.job)).toMatchObject({channel:"email",external:false});expect(send).not.toHaveBeenCalled();
    }finally{send.mockRestore();await f.db.end();}
  });
  it("an unlisted sandbox recipient is refused before network access",async()=>{
    configure();vi.stubEnv("MESSAGING_SANDBOX_ALLOWLIST","");vi.stubEnv("OPENWA_BASE_URL","https://gateway.example.invalid");
    const f=await fixture(),send=vi.spyOn(globalThis,"fetch");try{
      expect(await deliverNotification(f.job)).toMatchObject({channel:"email",external:false});expect(send).not.toHaveBeenCalled();
      expect((await f.db.query("SELECT status,error_class FROM app.notification_deliveries WHERE job_id=$1 AND channel='whatsapp'",[f.job.id])).rows[0]).toEqual({status:"failed",error_class:"SANDBOX_RECIPIENT_NOT_ALLOWED"});
    }finally{send.mockRestore();await f.db.end();}
  });
  it("signed failure queues one email fallback and cannot regress a read receipt",async()=>{
    configure();const f=await fixture(),messageId=randomUUID();try{
      await f.db.query("INSERT INTO app.notification_deliveries(job_id,channel,attempt,provider,provider_message_id,status) VALUES($1,'whatsapp',1,'openwa',$2,'accepted')",[f.job.id,`${session}:${messageId}`]);
      const body=callback(messageId,"failed"),events=verifyMessagingWebhook("openwa",body,headers(body));
      expect(await applyMessagingWebhook(events)).toEqual({applied:1});expect(await applyMessagingWebhook(events)).toEqual({applied:0});
      expect((await f.db.query("SELECT count(*)::int n FROM app.jobs WHERE event_id=$1 AND job_key LIKE '%:email-fallback'",[f.job.event.id])).rows[0].n).toBe(1);
      const read=callback(messageId,"read");expect(await applyMessagingWebhook(verifyMessagingWebhook("openwa",read,headers(read)))).toEqual({applied:1});
      const late=callback(messageId,"failed");expect(await applyMessagingWebhook(verifyMessagingWebhook("openwa",late,headers(late)))).toEqual({applied:0});
      expect((await f.db.query("SELECT status FROM app.notification_deliveries WHERE job_id=$1",[f.job.id])).rows[0].status).toBe("read");
    }finally{await f.db.end();}
  });
});
