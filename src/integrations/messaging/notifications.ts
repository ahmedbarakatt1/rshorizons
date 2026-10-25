import {createHmac,timingSafeEqual} from "node:crypto";
import {mkdir,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {z} from "zod";
import {query,withTransaction,type Transaction} from "@/server/db";
import {digestSecret} from "@/server/security";

export class NotificationError extends Error {
  constructor(public code:string,public retryable=false,public ambiguous=false){super(code);}
}
type Job={id:string;attempts:number;event:{id:string;event_type:string;aggregate_id:string;payload:Record<string,unknown>}};
type Channel="email"|"whatsapp";
type Template={id:string;channel:Channel;provider:string;provider_template_id:string|null;provider_language:string|null;category:string;subject_template:string|null;body_template:string;template_version:number};
type Recipient={booking_id:string;reference:string;guest_id:string;email:string|null;phone_e164:string|null;locale:string;whatsapp_opt_in:boolean;marketing_opt_in:boolean;synthetic:boolean;gallery_id?:string;invitation_id?:string;target_expiry?:Date};
export type NormalizedDeliveryEvent={provider:"resend";account:string;eventKey:string;messageId:string;status:"accepted"|"delivered"|"read"|"failed";occurredAt:Date};
const eventTemplates:Record<string,string>={
  request_received:"request_received",request_rejected:"request_rejected",approved_payment_required:"approved_payment_required",
  booking_confirmed:"booking_confirmed",payment_received:"payment_received",booking_changed:"booking_changed",pickup_reminder:"pickup_reminder",
  payment_reminder:"approved_payment_required",
  pickup_updated:"booking_changed",booking_expired:"cancellation_update",booking_completed:"booking_completed",cancellation_update:"cancellation_update",
  refund_update:"refund_update",refund_completed:"refund_update",refund_approved:"refund_approved",
  gallery_ready:"gallery_ready",review_invitation:"review_invitation",contact_received:"contact_received"
};
const emailSchema=z.email().max(254);
function fail(code:string):never{throw new NotificationError(code);}
const configured=(key:string)=>process.env[key]?.trim()||fail(`${key}_REQUIRED`);
const environment=()=>process.env.APP_ENV==="production"?"production":process.env.APP_ENV==="staging"?"sandbox":"local";
function equal(a:string,b:string){const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb);}
function recipientGate(to:string){
  if(process.env.MESSAGING_ACCOUNT_VERIFIED!=="true")fail("MESSAGING_ACCOUNT_UNVERIFIED");
  if(environment()!=="production"){
    const permitted=(process.env.MESSAGING_SANDBOX_ALLOWLIST??"").split(",").map(s=>s.trim().toLowerCase()).filter(Boolean);
    if(!permitted.includes(to.toLowerCase()))fail("SANDBOX_RECIPIENT_NOT_ALLOWED");
  }
}
export function renderTemplate(template:string,values:Record<string,string>){
  const rendered=template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g,(_,key:string)=>{
    if(!["reference","access_url"].includes(key)||!(key in values))fail("TEMPLATE_VARIABLE_UNSUPPORTED");
    return values[key];
  });
  if(/\{\{|\}\}/.test(rendered))fail("TEMPLATE_VARIABLE_UNSUPPORTED");
  return rendered;
}
export async function sendEmail(message:{to:string;subject:string;text:string;idempotencyKey:string;synthetic?:boolean}){
  emailSchema.parse(message.to);
  if(/[\r\n]/.test(message.subject)||message.subject.length>500||message.text.length>20000)fail("EMAIL_CONTENT_INVALID");
  const provider=configured("EMAIL_PROVIDER");
  if(provider==="local"){
    if(!["development","test"].includes(process.env.APP_ENV??"")||process.env.DEMO_MODE!=="true"||!message.synthetic||!message.to.endsWith(".invalid"))fail("LOCAL_EMAIL_REQUIRES_SYNTHETIC_DATA");
    const id=createHmac("sha256",configured("TOKEN_HASH_PEPPER")).update(message.idempotencyKey).digest("hex");
    const directory=join(process.cwd(),".local","outbox");
    await mkdir(directory,{recursive:true});
    // Contains only a synthetic recipient/reference and the scoped grant URL. Never deployed or logged.
    try{await writeFile(join(directory,`${id}.json`),JSON.stringify({mode:"local-preview-no-external-send",to:"synthetic-guest@example.invalid",subject:message.subject,text:message.text}),{flag:"wx",mode:0o600});}
    catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;}
    return {provider,messageId:`local_${id}`,status:"accepted" as const,external:false};
  }
  if(provider!=="resend")fail("EMAIL_PROVIDER_UNSUPPORTED");
  recipientGate(message.to);
  const key=configured("EMAIL_API_KEY"),from=configured("EMAIL_FROM");
  emailSchema.parse(from);
  let response:Response;
  try{response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json","Idempotency-Key":message.idempotencyKey},body:JSON.stringify({from,to:[message.to],subject:message.subject,text:message.text}),redirect:"error",signal:AbortSignal.timeout(15000)});}
  catch{throw new NotificationError("EMAIL_SEND_OUTCOME_UNKNOWN",false,true);}
  if(!response.ok){
    if(response.status>=500)throw new NotificationError("EMAIL_SEND_OUTCOME_UNKNOWN",false,true);
    throw new NotificationError(response.status===429?"EMAIL_RATE_LIMITED":"EMAIL_PROVIDER_REJECTED",response.status===429);
  }
  const parsed=z.object({id:z.string().min(1).max(200)}).safeParse(await response.json().catch(()=>null));
  if(!parsed.success)throw new NotificationError("EMAIL_SEND_OUTCOME_UNKNOWN",false,true);
  return {provider,messageId:parsed.data.id,status:"accepted" as const,external:true};
}
async function getRecipient(tx:Transaction,job:Job):Promise<Recipient>{
  const kind=job.event.event_type;
  let bookingId=job.event.aggregate_id,galleryId:string|undefined,invitationId:string|undefined,targetExpiry:Date|undefined;
  if(kind==="payment_received"){
    const ledger=(await tx.query("SELECT booking_id FROM app.cash_ledger WHERE id=$1 AND amount>0 AND source IN('online','offline')",[job.event.aggregate_id])).rows[0];
    if(!ledger)fail("PAYMENT_NOTIFICATION_INELIGIBLE");
    bookingId=ledger.booking_id;
  }
  if(kind==="refund_completed"||kind==="refund_update"){
    const refund=(await tx.query("SELECT booking_id FROM app.refund_requests WHERE id=$1",[job.event.aggregate_id])).rows[0];
    if(!refund)fail("REFUND_NOTIFICATION_INELIGIBLE");
    bookingId=refund.booking_id;
  }
  if(kind==="gallery_ready"){
    const row=(await tx.query("SELECT id,booking_id,expires_at FROM app.galleries WHERE id=$1 AND kind='private' AND visibility_state='published' AND (expires_at IS NULL OR expires_at>now())",[job.event.aggregate_id])).rows[0];
    if(!row)fail("GALLERY_NOTIFICATION_INELIGIBLE");
    bookingId=row.booking_id;galleryId=row.id;targetExpiry=row.expires_at;
  }
  if(kind==="review_invitation"){
    const row=(await tx.query(`SELECT i.id,i.expires_at,b.booking_id FROM app.review_invitations i JOIN app.booking_items b ON b.id=i.booking_item_id
      WHERE i.id=$1 AND i.eligible_at<=now() AND i.expires_at>now() AND i.used_at IS NULL AND i.revoked_at IS NULL AND b.fulfilment_state='fulfilled' AND b.superseded_at IS NULL`,[job.event.aggregate_id])).rows[0];
    if(!row)fail("REVIEW_NOTIFICATION_INELIGIBLE");
    bookingId=row.booking_id;invitationId=row.id;targetExpiry=row.expires_at;
  }
  const row=(await tx.query(`SELECT b.id booking_id,b.reference,g.id guest_id,g.email,g.phone_e164,g.locale,
    coalesce((SELECT granted AND withdrawn_at IS NULL FROM app.guest_consents c WHERE c.guest_id=g.id AND c.type='whatsapp_booking' ORDER BY captured_at DESC,id DESC LIMIT 1),false) whatsapp_opt_in,
    coalesce((SELECT granted AND withdrawn_at IS NULL FROM app.guest_consents c WHERE c.guest_id=g.id AND c.type='marketing' ORDER BY captured_at DESC,id DESC LIMIT 1),false) marketing_opt_in,
    NOT EXISTS(SELECT 1 FROM app.booking_items bi JOIN app.quote_items qi ON qi.id=bi.quote_item_id LEFT JOIN app.service_variants v ON v.id=qi.variant_id LEFT JOIN app.services s ON s.id=v.service_id LEFT JOIN app.apartments a ON a.id=qi.apartment_id WHERE bi.booking_id=b.id AND NOT coalesce(s.synthetic,a.synthetic,false)) synthetic
    FROM app.bookings b JOIN app.guests g ON g.id=b.primary_guest_id WHERE b.id=$1`,[bookingId])).rows[0];
  if(!row)fail("NOTIFICATION_RECIPIENT_UNAVAILABLE");
  return {...row,gallery_id:galleryId,invitation_id:invitationId,target_expiry:targetExpiry};
}
async function selectTemplate(tx:Transaction,job:Job,channel:Channel,locale:string){
  // Pin retries to the originally approved version instead of silently changing the external payload.
  const prior=(await tx.query("SELECT template_id FROM app.notification_deliveries WHERE job_id=$1 AND channel=$2 AND template_id IS NOT NULL ORDER BY attempt LIMIT 1",[job.id,channel])).rows[0];
  const provider=process.env.EMAIL_PROVIDER;
  const result=await tx.query<Template>(`SELECT * FROM app.notification_templates WHERE event_type=$1 AND channel=$2 AND locale=$3 AND approval_status='approved' AND provider=$4
    AND ($5::uuid IS NULL OR id=$5) ORDER BY template_version DESC LIMIT 1`,[eventTemplates[job.event.event_type],channel,locale,provider,prior?.template_id??null]);
  return result.rows[0];
}
function origin(){
  const url=new URL(configured("APP_BASE_URL"));
  if(environment()!=="local"&&url.protocol!=="https:")fail("NOTIFICATION_ORIGIN_INVALID");
  if(url.username||url.password||url.search||url.hash)fail("NOTIFICATION_ORIGIN_INVALID");
  return url.origin;
}
async function grantUrl(tx:Transaction,job:Job,recipient:Recipient){
  // Domain-separated HMAC provides a reproducible, unguessable 256-bit token across a crashed retry.
  // The token is never stored in the database, event payload, delivery record or application log.
  const secret=createHmac("sha256",configured("TOKEN_HASH_PEPPER")).update(`notification-access-v1:${job.event.id}:${recipient.booking_id}:${recipient.gallery_id??recipient.invitation_id??"booking"}`).digest("base64url");
  const hash=digestSecret(secret);
  const purpose=recipient.gallery_id?"gallery":recipient.invitation_id?"review":"booking";
  const scope=purpose==="gallery"?["gallery:read"]:purpose==="review"?["review:submit"]:["booking:read","booking:request","gallery:read"];
  const expires=new Date(Math.min(Date.now()+48*3600_000,recipient.target_expiry?.getTime()??Infinity));
  await tx.query(`INSERT INTO app.access_grants(token_hash,purpose,booking_id,gallery_id,review_invitation_id,scope,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(token_hash) DO NOTHING`,[hash,purpose,recipient.booking_id,recipient.gallery_id??null,recipient.invitation_id??null,scope,expires]);
  const grant=(await tx.query("SELECT id FROM app.access_grants WHERE token_hash=$1 AND expires_at>now() AND revoked_at IS NULL AND used_at IS NULL",[hash])).rows[0];
  if(!grant)fail("NOTIFICATION_ACCESS_GRANT_EXPIRED");
  // Fragment prevents access tokens being included in server/proxy referrer/request logs.
  return `${origin()}/${recipient.locale}/guest-access#token=${encodeURIComponent(secret)}`;
}
async function recordFailure(deliveryId:string,error:unknown){
  const classified=error instanceof NotificationError?error:new NotificationError("NOTIFICATION_PROCESSING_FAILED");
  await query(`UPDATE app.notification_deliveries SET status=$2,error_class=$3,failed_at=CASE WHEN $2='failed' THEN now() ELSE NULL END,updated_at=now(),version=version+1 WHERE id=$1`,[deliveryId,classified.ambiguous?"unknown":"failed",classified.code]);
  return classified;
}
export async function deliverNotification(job:Job):Promise<unknown>{
  z.uuid().parse(job.id);z.uuid().parse(job.event.id);z.uuid().parse(job.event.aggregate_id);
  if(!eventTemplates[job.event.event_type])fail("NOTIFICATION_EVENT_UNSUPPORTED");
  const prepared=await withTransaction({type:"system"},async tx=>{
    const live=(await tx.query(`SELECT j.id,j.job_key,e.payload FROM app.jobs j JOIN app.outbox_events e ON e.id=j.event_id WHERE j.id=$1 AND j.status='running' AND j.lease_until>now() AND e.id=$2 AND e.event_type=$3 AND e.aggregate_id=$4 FOR UPDATE OF j`,[job.id,job.event.id,job.event.event_type,job.event.aggregate_id])).rows[0];
    if(!live)fail("NOTIFICATION_JOB_LEASE_REQUIRED");
    async function suppress(reason:string){
      await tx.query(`INSERT INTO app.notification_deliveries(job_id,channel,attempt,provider,status,error_class)
        VALUES($1,'email',$2,'internal','suppressed',$3) ON CONFLICT DO NOTHING`,[job.id,Math.max(1,job.attempts),reason]);
      return {alreadyProcessed:true as const,suppressionReason:reason};
    }
    if(job.event.event_type==="refund_approved"){
      if(!(await tx.query("SELECT 1 FROM app.refund_requests WHERE id=$1 AND approved_at IS NOT NULL",[job.event.aggregate_id])).rowCount)fail("REFUND_NOTIFICATION_INELIGIBLE");
      return suppress("INTERNAL_APPROVAL_NO_CUSTOMER_SEND");
    }
    if(job.event.event_type==="payment_reminder"){
      if(!(await tx.query("SELECT 1 FROM app.bookings WHERE id=$1 AND status='approved_pending_payment' AND payment_deadline>now() AND payment_deadline=$2::timestamptz",[job.event.aggregate_id,live.payload.deadline])).rowCount)return suppress("STALE_PAYMENT_REMINDER");
    }
    if(job.event.event_type==="pickup_reminder"){
      if(!(await tx.query(`SELECT 1 FROM app.pickup_assignments p JOIN app.booking_items i ON i.id=p.booking_item_id JOIN app.bookings b ON b.id=i.booking_id
        WHERE p.id=$1 AND b.id=$2 AND b.status='confirmed' AND i.superseded_at IS NULL AND i.fulfilment_state NOT IN('fulfilled','no_show','cancelled')
        AND p.pickup_at>now() AND p.pickup_at=$3::timestamptz`,[live.payload.pickupId,job.event.aggregate_id,live.payload.pickupAt])).rowCount)return suppress("STALE_PICKUP_REMINDER");
    }
    const prior=await tx.query("SELECT status,channel FROM app.notification_deliveries WHERE job_id=$1 AND status IN('accepted','delivered','read','submitted','unknown') ORDER BY created_at DESC LIMIT 1",[job.id]);
    if(prior.rows[0]){
      if(["submitted","unknown"].includes(prior.rows[0].status))fail("NOTIFICATION_RECONCILIATION_REQUIRED");
      return {alreadyProcessed:true as const};
    }
    if(job.event.event_type==="contact_received"){
      const exists=(await tx.query("SELECT 1 FROM app.contact_requests WHERE id=$1 AND retention_deadline>now()",[job.event.aggregate_id])).rowCount;
      if(!exists)fail("CONTACT_NOTIFICATION_INELIGIBLE");
      const template=await selectTemplate(tx,job,"email",process.env.STAFF_NOTIFICATION_LOCALE??"en");
      if(!template)fail("NOTIFICATION_TEMPLATE_UNAVAILABLE");
      if(template.category!=="transactional")fail("CONTACT_TEMPLATE_CATEGORY_INVALID");
      // Staff alert contains only an opaque reference and authenticated admin URL, never form content/contact details.
      const values={reference:job.event.aggregate_id,access_url:`${origin()}/admin/contact`};
      return {alreadyProcessed:false as const,template,values,to:configured("STAFF_NOTIFICATION_EMAIL"),synthetic:false,recipient:null};
    }
    const recipient=await getRecipient(tx,job);
    // WhatsApp is a manual click-to-chat action; only email is dispatched by jobs.
    if(!recipient.email)return suppress("MANUAL_CONTACT_REQUIRED");
    const template=await selectTemplate(tx,job,"email",recipient.locale);
    if(!template)fail("NOTIFICATION_TEMPLATE_UNAVAILABLE");
    if(template.category==="marketing"&&!recipient.marketing_opt_in)fail("MARKETING_CONSENT_REQUIRED");
    const values={reference:recipient.reference,access_url:await grantUrl(tx,job,recipient)};
    return {alreadyProcessed:false as const,template,values,to:template.channel==="email"?recipient.email!:recipient.phone_e164!,synthetic:recipient.synthetic,recipient};
  });
  if(prepared.alreadyProcessed)return "suppressionReason" in prepared?{status:"suppressed",reason:prepared.suppressionReason,external:false}:{alreadyProcessed:true};
  const {template,values,to,synthetic}=prepared;
  const idempotencyKey=`notification/${job.event.id}/${template.channel}/${template.id}/${template.template_version}`;
  const delivery=await query(`INSERT INTO app.notification_deliveries(job_id,template_id,channel,attempt,provider,status,submitted_at) VALUES($1,$2,$3,$4,$5,'submitted',now()) ON CONFLICT(job_id,channel,attempt) DO NOTHING RETURNING id`,[job.id,template.id,template.channel,Math.max(1,job.attempts),template.provider]);
  if(!delivery.rowCount)fail("NOTIFICATION_ATTEMPT_ALREADY_CLAIMED");
  const deliveryId=delivery.rows[0].id;
  let acceptedExternally=false;
  try{
    const result=await sendEmail({to,subject:renderTemplate(template.subject_template??"",values),text:renderTemplate(template.body_template,values),idempotencyKey,synthetic});
    acceptedExternally=result.external;
    await query(`UPDATE app.notification_deliveries SET status='accepted',provider_message_id=$2,accepted_at=now(),updated_at=now(),version=version+1 WHERE id=$1`,[deliveryId,result.messageId]);
    if(prepared.recipient?.invitation_id)await query("UPDATE app.review_invitations SET sent_at=coalesce(sent_at,now()) WHERE id=$1",[prepared.recipient.invitation_id]);
    return {...result,channel:template.channel};
  }catch(error){
    const classified=await recordFailure(deliveryId,acceptedExternally?new NotificationError("NOTIFICATION_RECORD_OUTCOME_UNKNOWN",false,true):error);
    throw classified;
  }
}

const resendBody=z.object({type:z.string(),created_at:z.string().optional(),data:z.object({email_id:z.string().min(1).max(200)})});
export function verifyMessagingWebhook(provider:"resend",rawBody:string,headers:Headers):NormalizedDeliveryEvent[]{
  if(Buffer.byteLength(rawBody)>256*1024)fail("WEBHOOK_BODY_TOO_LARGE");
  if(provider==="resend"){
    const id=headers.get("svix-id")??"",timestamp=headers.get("svix-timestamp")??"",signature=headers.get("svix-signature")??"";
    if(!id||!timestamp||!signature)fail("WEBHOOK_SIGNATURE_INVALID");
    if(!/^\d+$/.test(timestamp)||Math.abs(Date.now()/1000-Number(timestamp))>300)fail("WEBHOOK_TIMESTAMP_INVALID");
    const key=configured("EMAIL_WEBHOOK_SECRET");
    if(!key.startsWith("whsec_"))fail("EMAIL_WEBHOOK_SECRET_INVALID");
    const expected=createHmac("sha256",Buffer.from(key.slice(6),"base64")).update(`${id}.${timestamp}.${rawBody}`).digest("base64");
    if(!signature.split(" ").some(part=>part.startsWith("v1,")&&equal(expected,part.slice(3))))fail("WEBHOOK_SIGNATURE_INVALID");
    const data=resendBody.parse(JSON.parse(rawBody));
    const status:Record<string,NormalizedDeliveryEvent["status"]>={"email.sent":"accepted","email.delivered":"delivered","email.bounced":"failed","email.failed":"failed","email.complained":"failed"};
    if(!status[data.type])return [];
    return [{provider:"resend",account:configured("RESEND_ACCOUNT_ID"),eventKey:id,messageId:data.data.email_id,status:status[data.type],occurredAt:new Date(Number(timestamp)*1000)}];
  }
  return [];
}
export async function applyMessagingWebhook(events:NormalizedDeliveryEvent[]){
  return withTransaction({type:"system"},async tx=>{
    let applied=0;
    for(const event of events){
      const provider=event.provider;
      const delivery=(await tx.query("SELECT id,status,job_id FROM app.notification_deliveries WHERE provider=$1 AND provider_message_id=$2 FOR UPDATE",[provider,event.messageId])).rows[0];
      // Do not acknowledge/discard a callback that races the accepted-row update; provider should retry.
      if(!delivery)fail("DELIVERY_NOT_YET_RECORDED");
      const inserted=await tx.query(`INSERT INTO app.messaging_webhook_receipts(provider,account,environment,event_key,event_kind,provider_message_id,verified_at) VALUES($1,$2,$3,$4,$5,$6,now()) ON CONFLICT DO NOTHING RETURNING event_key`,[provider,event.account,environment(),event.eventKey,event.status,event.messageId]);
      if(!inserted.rowCount)continue;
      const ranks:Record<string,number>={queued:0,submitted:1,unknown:1,accepted:2,failed:3,delivered:4,read:5};
      if((ranks[event.status]??0)<(ranks[delivery.status]??0))continue;
      await tx.query(`UPDATE app.notification_deliveries SET status=$2,accepted_at=coalesce(accepted_at,$3),delivered_at=CASE WHEN $2 IN('delivered','read') THEN coalesce(delivered_at,$3) ELSE delivered_at END,
        read_at=CASE WHEN $2='read' THEN coalesce(read_at,$3) ELSE read_at END,failed_at=CASE WHEN $2='failed' THEN coalesce(failed_at,$3) ELSE failed_at END,updated_at=now(),version=version+1 WHERE id=$1`,[delivery.id,event.status,event.occurredAt]);
      applied++;
    }
    return {applied};
  });
}
