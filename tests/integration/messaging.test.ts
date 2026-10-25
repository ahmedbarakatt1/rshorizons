import {afterEach,describe,expect,it,vi} from "vitest";
import {createHmac,randomUUID} from "node:crypto";
import {applyMessagingWebhook,deliverNotification,renderTemplate,sendEmail,verifyMessagingWebhook} from "@/integrations/messaging/notifications";
import {admin,makeActor,makeAttempt,makeBooking,makeDeparture,paymentEvent,tourItem} from "../database/helpers";

afterEach(()=>vi.unstubAllEnvs());
describe("notification provider boundaries",()=>{
  it("rejects unsigned and stale provider webhooks",()=>{
    vi.stubEnv("EMAIL_WEBHOOK_SECRET",`whsec_${Buffer.from("test-secret").toString("base64")}`);
    const body=JSON.stringify({type:"email.delivered",data:{email_id:randomUUID()}});
    const timestamp=String(Math.floor(Date.now()/1000)-601),id="msg_test";
    const signature=createHmac("sha256","test-secret").update(`${id}.${timestamp}.${body}`).digest("base64");
    expect(()=>verifyMessagingWebhook("resend",body,new Headers())).toThrow("WEBHOOK_SIGNATURE_INVALID");
    expect(()=>verifyMessagingWebhook("resend",body,new Headers({"svix-id":id,"svix-timestamp":timestamp,"svix-signature":`v1,${signature}`}))).toThrow("WEBHOOK_TIMESTAMP_INVALID");
  });
  it("accepts exact signed bytes and rejects tampering",()=>{
    vi.stubEnv("EMAIL_WEBHOOK_SECRET",`whsec_${Buffer.from("synthetic-secret").toString("base64")}`);
    vi.stubEnv("RESEND_ACCOUNT_ID","test-account");
    const body=JSON.stringify({type:"email.delivered",data:{email_id:"test-email"}}),timestamp=String(Math.floor(Date.now()/1000)),id="test-event";
    const signature=createHmac("sha256","synthetic-secret").update(`${id}.${timestamp}.${body}`).digest("base64");
    const headers=new Headers({"svix-id":id,"svix-timestamp":timestamp,"svix-signature":`v1,${signature}`});
    expect(verifyMessagingWebhook("resend",body,headers)[0]).toMatchObject({messageId:"test-email",status:"delivered"});
    expect(()=>verifyMessagingWebhook("resend",body+" ",headers)).toThrow("WEBHOOK_SIGNATURE_INVALID");
  });
  it("fails closed before fetch without sandbox allowlist and rejects unapproved variables",async()=>{
    vi.stubEnv("EMAIL_PROVIDER","resend");
    vi.stubEnv("APP_ENV","staging");
    vi.stubEnv("EMAIL_API_KEY","re_synthetic");
    vi.stubEnv("EMAIL_FROM","office@example.invalid");
    vi.stubEnv("MESSAGING_ACCOUNT_VERIFIED","true");
    vi.stubEnv("MESSAGING_SANDBOX_ALLOWLIST","");
    const fetchMock=vi.spyOn(globalThis,"fetch");
    try{
      await expect(sendEmail({to:"anyone@example.com",subject:"test",text:"test",idempotencyKey:"test"})).rejects.toThrow("SANDBOX_RECIPIENT_NOT_ALLOWED");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(()=>renderTemplate("{{health_data}}",{reference:"RSH-1"})).toThrow("TEMPLATE_VARIABLE_UNSUPPORTED");
    }finally{fetchMock.mockRestore();}
  });
  it("whatsapp_opt_out falls back to a synthetic local email, with no external delivery claim",async()=>{
    vi.stubEnv("EMAIL_PROVIDER","local");vi.stubEnv("APP_ENV","test");vi.stubEnv("DEMO_MODE","true");
    const db=admin();await db.connect();
    try{
      const dep=await makeDeparture(db);
      const {booking}=await makeBooking(db,[await tourItem(db,dep.id)]);
      const guest=(await db.query("SELECT primary_guest_id FROM app.bookings WHERE id=$1",[booking.id])).rows[0].primary_guest_id;
      await db.query("INSERT INTO app.guest_consents(guest_id,type,granted,policy_version,collection_source) VALUES($1,'whatsapp_booking',false,'test','test')",[guest]);
      await db.query("INSERT INTO app.notification_templates(event_type,channel,locale,template_version,provider,approval_status,category,subject_template,body_template) VALUES('request_received','email','en',987654,'local','approved','transactional','Request {{reference}}','Synthetic request {{reference}}. {{access_url}}') ON CONFLICT DO NOTHING");
      const event=(await db.query("SELECT id,event_type,aggregate_id,payload FROM app.outbox_events WHERE aggregate_id=$1 AND event_type='request_received'",[booking.id])).rows[0];
      const job=(await db.query("INSERT INTO app.jobs(event_id,kind,job_key,status,attempts,lease_owner,lease_until) VALUES($1,'notification',$2,'running',1,'test',now()+interval '2 minutes') RETURNING id,attempts",[event.id,randomUUID()])).rows[0];
      const result=await deliverNotification({...job,event});
      expect(result).toMatchObject({channel:"email",status:"accepted",external:false});
      const delivery=(await db.query("SELECT status,provider,delivered_at FROM app.notification_deliveries WHERE job_id=$1",[job.id])).rows[0];
      expect(delivery).toMatchObject({status:"accepted",provider:"local",delivered_at:null});
      expect((await db.query("SELECT count(*)::int n FROM app.access_grants WHERE booking_id=$1",[booking.id])).rows[0].n).toBeGreaterThan(0);
      expect(await deliverNotification({...job,event})).toMatchObject({alreadyProcessed:true});
    }finally{await db.end();}
  });
  it("delivery callbacks are durable, replay-safe and cannot regress a delivered message",async()=>{
    vi.stubEnv("APP_ENV","test");
    const db=admin();await db.connect();
    try{
      const dep=await makeDeparture(db),{booking}=await makeBooking(db,[await tourItem(db,dep.id)]);
      const event=(await db.query("SELECT id FROM app.outbox_events WHERE aggregate_id=$1 LIMIT 1",[booking.id])).rows[0];
      const job=(await db.query("INSERT INTO app.jobs(event_id,kind,job_key) VALUES($1,'notification',$2) RETURNING id",[event.id,randomUUID()])).rows[0];
      const messageId=randomUUID();
      await db.query("INSERT INTO app.notification_deliveries(job_id,channel,attempt,provider,provider_message_id,status) VALUES($1,'email',1,'resend',$2,'accepted')",[job.id,messageId]);
      const callback={provider:"resend" as const,account:"synthetic-test",eventKey:randomUUID(),messageId,status:"delivered" as const,occurredAt:new Date()};
      expect(await applyMessagingWebhook([callback])).toEqual({applied:1});
      expect(await applyMessagingWebhook([callback])).toEqual({applied:0});
      expect(await applyMessagingWebhook([{...callback,eventKey:randomUUID(),status:"accepted"}])).toEqual({applied:0});
      expect((await db.query("SELECT status FROM app.notification_deliveries WHERE job_id=$1",[job.id])).rows[0].status).toBe("delivered");
    }finally{await db.end();}
  });
  it("gallery and review notifications issue distinct grants only for an eligible target",async()=>{
    vi.stubEnv("EMAIL_PROVIDER","local");vi.stubEnv("APP_ENV","test");vi.stubEnv("DEMO_MODE","true");
    const db=admin();await db.connect();
    try{
      const dep=await makeDeparture(db),{booking}=await makeBooking(db,[await tourItem(db,dep.id)]);
      const item=(await db.query("SELECT id FROM app.booking_items WHERE booking_id=$1",[booking.id])).rows[0];
      const gallery=(await db.query("INSERT INTO app.galleries(kind,booking_id,title,visibility_state,published_at) VALUES('private',$1,'Test','published',now()) RETURNING id",[booking.id])).rows[0];
      const invitation=(await db.query("INSERT INTO app.review_invitations(booking_item_id,eligible_at,expires_at) VALUES($1,now()-interval '1 minute',now()+interval '2 days') RETURNING id",[item.id])).rows[0];
      for(const [kind,target] of [["gallery_ready",gallery.id],["review_invitation",invitation.id]]){
        await db.query("INSERT INTO app.notification_templates(event_type,channel,locale,template_version,provider,approval_status,category,subject_template,body_template) VALUES($1,'email','en',987654,'local','approved','transactional','Synthetic {{reference}}','{{access_url}}') ON CONFLICT DO NOTHING",[kind]);
        const event=(await db.query("INSERT INTO app.outbox_events(aggregate_type,aggregate_id,aggregate_version,event_type,event_key) VALUES('test',$1,1,$2,$3) RETURNING id,event_type,aggregate_id,payload",[target,kind,randomUUID()])).rows[0];
        const job=(await db.query("INSERT INTO app.jobs(event_id,kind,job_key,status,attempts,lease_until) VALUES($1,'notification',$2,'running',1,now()+interval '2 minutes') RETURNING id,attempts",[event.id,randomUUID()])).rows[0];
        if(kind==="review_invitation"){
          await expect(deliverNotification({...job,event})).rejects.toThrow("REVIEW_NOTIFICATION_INELIGIBLE");
          await db.query("UPDATE app.booking_items SET fulfilment_state='fulfilled' WHERE id=$1",[item.id]);
        }
        expect(await deliverNotification({...job,event})).toMatchObject({external:false,status:"accepted"});
      }
      const grants=(await db.query("SELECT purpose,scope FROM app.access_grants WHERE booking_id=$1",[booking.id])).rows;
      expect(grants).toEqual(expect.arrayContaining([{purpose:"gallery",scope:["gallery:read"]},{purpose:"review",scope:["review:submit"]}]));
    }finally{await db.end();}
  });
  it("dispatches actual SQL booking payment fulfilment and refund events without treating ledger IDs as booking IDs",async()=>{
    vi.stubEnv("EMAIL_PROVIDER","local");vi.stubEnv("APP_ENV","test");vi.stubEnv("DEMO_MODE","true");
    const db=admin();await db.connect();
    try{
      const actor=await makeActor(db),dep=await makeDeparture(db),{booking}=await makeBooking(db,[await tourItem(db,dep.id)],"deposit");
      for(const kind of ["request_received","approved_payment_required","booking_confirmed","payment_received","booking_completed","refund_update"]){
        await db.query("INSERT INTO app.notification_templates(event_type,channel,locale,template_version,provider,approval_status,category,subject_template,body_template) VALUES($1,'email','en',987655,'local','approved','transactional','Synthetic {{reference}}','{{access_url}}') ON CONFLICT DO NOTHING",[kind]);
      }
      await db.query("SELECT app.approve_booking($1,1,$2)",[booking.id,actor]);
      const attempt=await makeAttempt(db,booking.id,30000);
      await db.query("SELECT app.apply_payment_event($1)",[JSON.stringify(paymentEvent(attempt.id,30000))]);
      const transaction=(await db.query("SELECT id FROM app.payment_transactions WHERE attempt_id=$1",[attempt.id])).rows[0].id;
      const item=(await db.query("SELECT id FROM app.booking_items WHERE booking_id=$1",[booking.id])).rows[0].id;
      await db.query("SELECT app.fulfil_item($1,'fulfilled','Synthetic fulfilment',$2)",[item,actor]);
      const refund=(await db.query("SELECT app.request_refund($1,$2,NULL,1000,'Synthetic refund','{}',$3) r",[booking.id,transaction,actor])).rows[0].r;
      await db.query("SELECT app.approve_refund($1,1,$2)",[refund.id,actor]);
      const refundAttempt=(await db.query("SELECT app.claim_online_refund($1,2,$2) r",[refund.id,actor])).rows[0].r;
      const providerId=randomUUID();
      await db.query("SELECT app.save_online_refund_reference($1,$2)",[refundAttempt.id,providerId]);
      await db.query("SELECT app.complete_online_refund($1,$2)",[refundAttempt.id,providerId]);
      const emitted=(await db.query(`SELECT id,event_type,aggregate_id,payload FROM app.outbox_events
        WHERE aggregate_id=$1 OR aggregate_id=$2 OR aggregate_id IN(SELECT id FROM app.cash_ledger WHERE booking_id=$1) ORDER BY occurred_at`,[booking.id,refund.id])).rows;
      expect(emitted.map(e=>e.event_type)).toEqual(expect.arrayContaining(["request_received","approved_payment_required","booking_confirmed","payment_received","booking_completed","refund_approved","refund_completed"]));
      for(const event of emitted){
        const job=(await db.query("INSERT INTO app.jobs(event_id,kind,job_key,status,attempts,lease_owner,lease_until) VALUES($1,'notification',$2,'running',1,'synthetic-integration',now()+interval '2 minutes') RETURNING id,attempts",[event.id,randomUUID()])).rows[0];
        const result=await deliverNotification({...job,event});
        expect(result).toMatchObject(event.event_type==="refund_approved"?{status:"suppressed",external:false}:{status:"accepted",external:false});
      }
    }finally{await db.end();}
  });
});
