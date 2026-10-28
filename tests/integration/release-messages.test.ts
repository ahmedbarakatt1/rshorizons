import {afterAll,beforeAll,expect,test,vi} from "vitest";
import {admin} from "../database/helpers";
import {productionDataProblems} from "@/server/env/release-data";

const db=admin();
beforeAll(()=>db.connect());afterAll(()=>db.end());
test("launch requires approved transactional production email templates in every guest language plus the staff alert",async()=>{
 vi.stubEnv("EMAIL_PROVIDER","resend");vi.stubEnv("STAFF_NOTIFICATION_LOCALE","en");
 const version=987670;
 const events=["request_received","request_rejected","approved_payment_required","booking_confirmed","payment_received","booking_changed","pickup_reminder","booking_completed","cancellation_update","refund_update","gallery_ready","review_invitation","guest_access_requested"];
 try{
  expect(await productionDataProblems()).toContain("notification_templates_missing");
  await db.query(`INSERT INTO app.notification_templates(event_type,channel,locale,template_version,provider,approval_status,category,subject_template,body_template)
   SELECT event,'email',l.code,$2,'resend','approved','transactional','Synthetic {{reference}}','{{access_url}}' FROM unnest($1::text[]) event CROSS JOIN app.locales l WHERE l.enabled
   ON CONFLICT(event_type,channel,locale,template_version) DO UPDATE SET approval_status='approved'`,[events,version]);
  await db.query(`INSERT INTO app.notification_templates(event_type,channel,locale,template_version,provider,approval_status,category,subject_template,body_template)
   VALUES('contact_received','email','en',$1,'resend','approved','transactional','Synthetic enquiry {{reference}}','{{access_url}}') ON CONFLICT(event_type,channel,locale,template_version) DO UPDATE SET approval_status='approved'`,[version]);
  expect(await productionDataProblems()).not.toContain("notification_templates_missing");
  await db.query(`INSERT INTO app.notification_templates(event_type,channel,locale,template_version,provider,approval_status,category,subject_template,body_template)
   VALUES('review_invitation','email','en',$1,'resend','approved','marketing','Synthetic review invitation','{{access_url}}') ON CONFLICT(event_type,channel,locale,template_version) DO UPDATE SET approval_status='approved'`,[version+1]);
  expect(await productionDataProblems()).not.toContain("notification_templates_missing");
  await db.query("UPDATE app.notification_templates SET approval_status='disabled' WHERE template_version=$1 AND event_type='guest_access_requested' AND locale='ar' AND provider='resend'",[version]);
  expect(await productionDataProblems()).toContain("notification_templates_missing");
 }finally{
  await db.query("UPDATE app.notification_templates SET approval_status='disabled' WHERE template_version IN($1,$2) AND provider='resend'",[version,version+1]);vi.unstubAllEnvs();
 }
});
