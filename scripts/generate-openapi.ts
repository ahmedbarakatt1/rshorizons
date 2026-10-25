import {mkdirSync,writeFileSync} from "node:fs";
import {z} from "zod";
import {bookingInputSchema,quoteInputSchema} from "../src/modules/bookings/contracts";
import {attemptInput} from "../src/modules/payments/service";
import {uploadInputSchema} from "../src/modules/photography/validation";
import {downloadInputSchema} from "../src/modules/photography/service";
import {reviewInputSchema,moderationInputSchema} from "../src/modules/reviews/service";
import {contactInputSchema} from "../src/modules/content/contact";
import {editorSchemas,staffInvitationSchema} from "../src/server/api/admin-writes";
type Schema=Record<string,unknown>;
const ref=(name:string)=>({$ref:`#/components/schemas/${name}`});
const money={type:"string",pattern:"^-?[0-9]+$",description:"Integer minor units, serialized as a decimal string. Never binary floating-point."};
const uuid={type:"string",format:"uuid"};
const schemas:Record<string,unknown>={
  QuoteInput:z.toJSONSchema(quoteInputSchema),BookingInput:z.toJSONSchema(bookingInputSchema),PaymentAttemptInput:z.toJSONSchema(attemptInput),
  UploadIntent:z.toJSONSchema(uploadInputSchema),DownloadGrant:z.toJSONSchema(downloadInputSchema),ReviewInput:z.toJSONSchema(reviewInputSchema),
  ReviewModeration:z.toJSONSchema(moderationInputSchema),ContactInput:z.toJSONSchema(contactInputSchema),
  Error:{type:"object",required:["error","meta"],properties:{error:{type:"object",required:["code","message"],properties:{code:{type:"string"},message:{type:"string"},fields:{type:"object",additionalProperties:{type:"string"}}}},meta:{type:"object",properties:{requestId:uuid}}}},
  Success:{type:"object",required:["data","meta"],properties:{data:{},meta:{type:"object",properties:{requestId:uuid,nextCursor:{type:["string","null"]}}}}},
  Quote:{type:"object",required:["id","totalAmountMinor","initialDueAmountMinor","currency","validUntil","items","policyVersions"],properties:{id:uuid,totalAmountMinor:money,initialDueAmountMinor:money,currency:{type:"string",pattern:"^[A-Z]{3}$"},validUntil:{type:"string",format:"date-time"},items:{type:"array",items:{type:"object"}},policyVersions:{type:"object",required:["terms","privacy"],properties:{terms:{type:"string"},privacy:{type:"string"}}}}},
  BookingReceipt:{type:"object",required:["reference","status","paymentRequested"],properties:{reference:{type:"string"},status:{const:"pending_review"},paymentRequested:{const:false},message:{type:"string"}}},
  Booking:{type:"object",required:["id","reference","status","version","currency","totalAmountMinor","items"],properties:{id:uuid,reference:{type:"string"},status:{enum:["pending_review","approved_pending_payment","confirmed","rejected","expired","cancelled","completed"]},version:{type:"integer",minimum:1},currency:{type:"string"},totalAmountMinor:money,initialDueAmountMinor:money,paidAmountMinor:money,balanceAmountMinor:money,items:{type:"array",items:{type:"object"}},obligations:{type:"array",items:{type:"object"}},timeline:{type:"array",items:{type:"object"}},requests:{type:"array",items:{type:"object"}},revisions:{type:"array",items:{type:"object"}},galleries:{type:"array",items:{type:"object"}}}},
  ExpectedVersion:{type:"object",required:["expectedVersion"],additionalProperties:false,properties:{expectedVersion:{type:"integer",minimum:1}}},
  Decision:{type:"object",required:["expectedVersion","reason"],additionalProperties:false,properties:{expectedVersion:{type:"integer",minimum:1},reason:{type:"string",minLength:1,maxLength:2000}}},
  ChangeRequest:{type:"object",required:["reason"],additionalProperties:false,properties:{reason:{type:"string",minLength:3,maxLength:2000},proposedChanges:{type:"object"}}},
  Credentials:{type:"object",required:["email","password"],additionalProperties:false,properties:{email:{type:"string",format:"email"},password:{type:"string",minLength:1,maxLength:256}}},
  Redemption:{type:"object",required:["token"],additionalProperties:false,properties:{token:{type:"string",maxLength:200,writeOnly:true}}},
};
for(const [name,schema] of Object.entries(editorSchemas))schemas[`Editor_${name}`]=z.toJSONSchema(schema);
schemas.ReviewPage={type:"object",required:["items","summary","filteredTotal","nextCursor"],properties:{
 items:{type:"array",items:{type:"object",required:["id","rating","text","locale","display_name","submitted_at","replies"],properties:{id:uuid,rating:{type:"integer",minimum:1,maximum:5},text:{type:"string",description:"Immutable original guest text."},locale:{type:"string"},display_name:{type:"string"},submitted_at:{type:"string",format:"date-time"},replies:{type:"array",items:{type:"object",required:["body","publishedAt"],properties:{body:{type:"string"},publishedAt:{type:"string",format:"date-time"}}}}}}},
 summary:{type:"object",required:["total","average","ratings"],properties:{total:{type:"integer",minimum:0},average:{type:["number","null"],description:"Mean of every published review in the service scope, independent of rating filter and pagination. Null when empty."},ratings:{type:"object",additionalProperties:{type:"integer",minimum:0},description:"Counts keyed by each star rating 1–5."}}},
 filteredTotal:{type:"integer",minimum:0},nextCursor:{type:["string","null"],format:"uuid",description:"Last visible review ID; newest-first keyset pagination preserves equal timestamps."}
}};
const paths:Record<string,Record<string,unknown>>={};
function add(path:string,method:string,summary:string,options:{security?:"staff"|"guest"|"cron"|"webhook";body?:string|Schema;response?:string;created?:boolean;idempotent?:boolean;query?:string[];description?:string}={}){
  const full=`/api/v1${path}`,parameters:Schema[]=[...path.matchAll(/\{([^}]+)\}/g)].map(match=>({name:match[1],in:"path",required:true,schema:{type:"string",...match[1]==="id"?{format:"uuid"}:{}}}));
  for(const name of options.query??[])parameters.push({name,in:"query",schema:{type:"string"}});
  if(!["get","head"].includes(method)&&!options.security?.match(/cron|webhook/))parameters.push({name:"Origin",in:"header",required:true,schema:{type:"string",format:"uri"},description:"Exact configured application origin; cookie mutations reject missing/foreign origins."});
  if(options.idempotent)parameters.push({name:"Idempotency-Key",in:"header",required:true,schema:{type:"string",minLength:8,maxLength:200},description:"Reuse for the identical logical request; a different body with the same key is rejected."});
  const successSchema=options.response?{allOf:[ref("Success"),{properties:{data:ref(options.response)}}]}:ref("Success");
  const entry:Record<string,unknown>={operationId:`${method}_${path.replaceAll(/[^a-zA-Z0-9]/g,"_")}`,summary,description:options.description??"Validated server operation. All money, inventory, approval and authorization rules are enforced against the current database state.",tags:[path.split("/")[1]],parameters,
    security:options.security?[{[`${options.security}Auth`]:[]}]:[],
    responses:{[options.created?"201":"200"]:{description:"Successful operation; private endpoints are no-store.",content:{"application/json":{schema:successSchema}}},400:{description:"Invalid input",content:{"application/json":{schema:ref("Error")}}},401:{description:"Missing/invalid session or signature",content:{"application/json":{schema:ref("Error")}}},403:{description:"Permission, scope or origin rejected",content:{"application/json":{schema:ref("Error")}}},404:{description:"Unavailable or unauthorized object",content:{"application/json":{schema:ref("Error")}}},409:{description:"Version, inventory, idempotency or state conflict",content:{"application/json":{schema:ref("Error")}}},410:{description:"Expired quote or consumed/expired grant",content:{"application/json":{schema:ref("Error")}}},422:{description:"Business rule rejected",content:{"application/json":{schema:ref("Error")}}},429:{description:"Rate limited",content:{"application/json":{schema:ref("Error")}}},503:{description:"Dependency/configuration unavailable; no simulated external success",content:{"application/json":{schema:ref("Error")}}}}};
  if(options.body)entry.requestBody={required:true,content:{"application/json":{schema:typeof options.body==="string"?ref(options.body):options.body}}};
  (paths[full]??={})[method]=entry;
}
for(const path of ["/health/live","/health/ready","/catalog","/destinations","/services","/services/{id}","/apartments","/apartments/{id}","/policies/current","/galleries/public","/reviews","/social-links","/pages/{slug}"])add(path,"get",`Read ${path}`,{query:["locale",...path==="/services"?["destination","category","date","guests","cursor"]:[]]});
add("/reviews","get","Read published verified reviews and rating summary",{query:["locale","serviceId","rating","cursor","limit"],response:"ReviewPage",description:"Published originals and non-withdrawn public agency replies only. Optional rating 1–5 and serviceId UUID filters. Cursor is a review UUID; limit defaults to 12, maximum 24. Aggregate includes all published reviews in the service scope regardless of rating filter or page."});
add("/services/{id}/departures","get","Available departures",{query:["from","to","guests"]});
add("/apartments/{id}/availability","get","Unavailable half-open date ranges",{query:["from","to"]});
add("/quotes","post","Create immutable server-calculated quote",{body:"QuoteInput",response:"Quote",created:true});
add("/bookings","post","Submit a request for staff review",{body:"BookingInput",response:"BookingReceipt",created:true,idempotent:true});
for(const path of ["/bookings/{reference}","/bookings/{reference}/payments","/bookings/{reference}/payment-options","/galleries/{id}"])add(path,"get","Read authorized guest record",{security:"guest",...path==="/bookings/{reference}"?{response:"Booking"}:{}});
add("/bookings/{reference}/payment-attempts","post","Create hosted payment after approval",{security:"guest",body:"PaymentAttemptInput",idempotent:true,created:true});
for(const action of ["change-requests","cancellation-requests"])add(`/bookings/{reference}/${action}`,"post","Request change without releasing inventory",{security:"guest",body:"ChangeRequest",created:true});
add("/bookings/{reference}/revision-acceptance","post","Accept reviewed quote revision",{security:"guest",body:{type:"object",required:["revisionId","policiesAccepted"],properties:{revisionId:uuid,policiesAccepted:{const:true}}}});
add("/guest-access/request","post","Generic acknowledgement, scoped link through durable delivery",{body:{type:"object",required:["reference","contact"],properties:{reference:{type:"string"},contact:{type:"string"},locale:{type:"string"}}}});
add("/guest-access/redeem","post","Consume one-use grant into HttpOnly session",{body:"Redemption",description:"GET/prefetch never redeems. Token is hashed at rest, scoped and expiring; response selects booking/gallery/review destination."});
add("/galleries/{id}/download-grants","post","Issue two-minute entitlement-bound download token",{security:"guest",body:"DownloadGrant"});
add("/galleries/{id}/assets/{derivativeId}","get","Stream private media after current entitlement check",{security:"guest",description:"Binary response. Originals require x-download-token header, same live guest session, current entitlement and matching derivative. Never cache or put a token in a URL."});
add("/galleries/public/assets/{derivativeId}","get","Stream currently consented public derivative",{description:"Binary response. Re-check publication, consent, expiry, derivative state and media safety."});
add("/reviews","post","Submit one completed-item verified review",{security:"guest",body:"ReviewInput",created:true});
add("/contact","post","Create consented contact request and durable event",{body:"ContactInput"});
add("/webhooks/paymob","post","Verify Paymob transaction HMAC before financial effects",{security:"webhook",query:["hmac"],body:{type:"object",required:["type","obj"],properties:{type:{const:"TRANSACTION"},obj:{type:"object"}}},description:"Signed order ID chooses stored attempt; match merchant, environment, integration, currency and integer amount. Redirects cannot change payment state. Delivery and ledger effects dedupe separately."});
add("/admin/auth/login","post","Invited staff sign-in",{body:"Credentials"});
add("/admin/auth/local","post","Development-only one-use local operator token",{body:"Redemption",description:"Unavailable outside explicitly configured local development/test demonstration."});
for(const action of ["logout","refresh"])add(`/admin/auth/${action}`,"post",`Staff ${action}`,{security:"staff"});
for(const action of ["enroll","factors","challenge","verify"])add(`/admin/auth/mfa/${action}`,"post",`Supabase MFA ${action}`,{security:"staff",...["challenge","verify"].includes(action)?{body:{type:"object",properties:{factorId:uuid,challengeId:uuid,code:{type:"string",pattern:"^[0-9]{6}$"}}}}:{}});
for(const resource of ["session","summary","lookups","bookings","services","departures","apartments","resources","transport","guests","payments","refunds","financial-exceptions","galleries","media","pages","reviews","notification-deliveries","jobs","staff","audit-events","settings","reports/bookings","reports/finance","reports/occupancy"])add(`/admin/${resource}`,"get",`Read authorized ${resource}`,{security:"staff"});
add("/admin/bookings/{id}","get","Read scoped booking detail",{security:"staff",response:"Booking"});
add("/admin/contact","get","List retained contact requests",{security:"staff",query:["state","after"],description:"Requires contacts.read and current global staff scope. Default grant: owner only. Excludes expired records; optional state filter and UUID after cursor page 50 records at a time, returning data.nextCursor."});
add("/admin/contact/{id}","get","Read a retained guest enquiry",{security:"staff",description:"Requires contacts.read and current global scope. Expired or missing requests return 404; all responses are private and no-store."});
add("/admin/contact/{id}","patch","Record contact resolution without sending a message",{security:"staff",description:"Requires contacts.manage and global scope; locks the retained row and rejects stale expectedVersion with 409. Preserves the original message and appends a redacted audit event.",body:{type:"object",required:["state","expectedVersion"],additionalProperties:false,properties:{state:{enum:["new","replied","closed","spam"]},expectedVersion:{type:"integer",minimum:1}}}});
for(const [name] of Object.entries(editorSchemas)){
  add(`/admin/${name}`,"post",`Create ${name} draft/configuration`,{security:"staff",body:`Editor_${name}`,created:true});
  if(!["prices","apartment-rates","payment-policy-bindings","dive-clearance"].includes(name))add(`/admin/${name}${name==="settings"?"":"/{id}"}`,"patch",`Update ${name} with expected version`,{security:"staff",body:`Editor_${name}`});
}
for(const name of ["services","apartments","pages"]){
  add(`/admin/${name}/{id}/publish`,"post","Publish only approved content",{security:"staff",body:"ExpectedVersion"});
  add(`/admin/${name}/{id}/approve-translation`,"post","Record authorized translation approval",{security:"staff",body:{type:"object",required:["locale"],properties:{locale:{type:"string"}}}});
}
for(const action of ["approve","reject","cancel"])add(`/admin/bookings/{id}/${action}`,"post",`Staff ${action} booking atomically`,{security:"staff",body:action==="approve"?"ExpectedVersion":"Decision"});
for(const action of ["offline-receipts","revisions","apply-revision","fulfilment","pickup"])add(`/admin/bookings/{id}/${action}`,"post",`Record ${action}`,{security:"staff",body:{type:"object"},idempotent:action==="offline-receipts"});
for(const [path,summary] of Object.entries({"/admin/apartments/{id}/blocks":"Create inventory block","/admin/resources/{id}/blocks":"Block resource","/admin/resources/{id}/assignments":"Assign resource","/admin/departures/{id}/assignments":"Assign shared departure resource","/admin/stays/{id}/events":"Record stay operation","/admin/refunds":"Request source-bound partial refund","/admin/refunds/{id}/approve":"Authorize refund","/admin/refunds/{id}/complete-offline":"Record offline refund","/admin/financial-exceptions/{id}/resolve":"Resolve financial exception with audit","/admin/payments/{id}/reconcile":"Authenticated provider inquiry","/admin/jobs/{id}/retry":"Retry eligible failed job"}))add(path,"post",summary,{security:"staff",body:{type:"object"}});
add("/admin/staff/{id}/access","patch","Change current roles/scopes or revoke",{security:"staff",body:{type:"object",required:["roles","active","scopes","expectedVersion"]}});
add("/admin/media/upload-intents","post","Declare quarantined media upload",{security:"staff",body:"UploadIntent",created:true});
add("/admin/media/{id}/bytes","put","Upload bounded bytes; declared MIME is not trusted",{security:"staff",description:"Binary upload, maximum20MiB images/64MiB videos, actual MIME/hash/decode checks, no public bucket."});
for(const action of ["finalize","complete","public-derivative"])add(`/admin/media/{id}/${action}`,"post",`Media ${action}`,{security:"staff",body:{type:"object"}});
add("/admin/galleries/{id}/publish","post","Publish only consented ready gallery",{security:"staff",body:"ExpectedVersion"});
add("/admin/reviews/{id}/moderate","post","Moderate without changing original rating/text",{security:"staff",body:"ReviewModeration"});
add("/admin/reviews/{id}/replies","post","Publish staff reply",{security:"staff",body:{type:"object",required:["body"],properties:{body:{type:"string"}}}});
// Explicit action contracts mirror the strict HTTP boundary, including actions
// with no JSON body. Editor payloads above come from the application schemas.
const object=(properties:Schema,required=Object.keys(properties))=>({type:"object",additionalProperties:false,required,properties});
const textField={type:"string",minLength:1,maxLength:2000},versionField={type:"integer",minimum:1},dateField={type:"string",format:"date"},timeField={type:"string",format:"date-time"},currencyField={type:"string",pattern:"^[A-Z]{3}$"};
const choice=(...values:string[])=>({type:"string",enum:values});
const op=(path:string,method="post")=>paths[`/api/v1${path}`][method] as Record<string,unknown>;
function body(path:string,schema:Schema,method="post"){op(path,method).requestBody={required:true,content:{"application/json":{schema}}};}
function status(path:string,code:string,method="post"){const responses=op(path,method).responses as Record<string,unknown>;const existing=responses["200"]??responses["201"];delete responses["200"];delete responses["201"];responses[code]=existing;}
function noBody(path:string){delete op(path).requestBody;}
body("/admin/bookings/{id}/offline-receipts",object({amountMinor:money,currency:currencyField,method:choice("cash","bank_transfer"),reference:textField,expectedVersion:versionField},["amountMinor","currency","method","reference"]));status("/admin/bookings/{id}/offline-receipts","201");
body("/admin/bookings/{id}/revisions",object({quoteId:uuid,expectedVersion:versionField,reason:textField},["quoteId","expectedVersion"]));status("/admin/bookings/{id}/revisions","201");
body("/admin/bookings/{id}/apply-revision",object({revisionId:uuid,expectedVersion:versionField}));
body("/admin/bookings/{id}/fulfilment",object({bookingItemId:uuid,state:choice("check_in","fulfilled","no_show","cancelled"),notes:textField,expectedVersion:versionField}));
body("/admin/bookings/{id}/pickup",object({bookingItemId:uuid,address:textField,pickupAt:timeField,instructions:{type:"string",maxLength:2000},expectedVersion:versionField},["bookingItemId","address","pickupAt","expectedVersion"]));status("/admin/bookings/{id}/pickup","201");
body("/admin/apartments/{id}/blocks",object({from:dateField,to:dateField,kind:choice("maintenance","owner_block","cleaning"),reason:textField,expectedVersion:versionField}));status("/admin/apartments/{id}/blocks","201");
body("/admin/resources/{id}/blocks",object({startsAt:timeField,endsAt:timeField,reason:textField,expectedVersion:versionField},["startsAt","endsAt","reason"]));
body("/admin/resources/{id}/assignments",{...object({departureId:uuid,bookingItemId:uuid,startsAt:timeField,endsAt:timeField,quantity:versionField},["startsAt","endsAt","quantity"]),oneOf:[{required:["departureId"],not:{required:["bookingItemId"]}},{required:["bookingItemId"],not:{required:["departureId"]}}]});status("/admin/resources/{id}/assignments","201");
body("/admin/departures/{id}/assignments",object({resourceId:uuid,quantity:versionField,role:textField,bufferBeforeMinutes:{type:"integer",minimum:0,maximum:1440,default:0},bufferAfterMinutes:{type:"integer",minimum:0,maximum:1440,default:0},expectedVersion:versionField},["resourceId","quantity","role","expectedVersion"]));
body("/admin/stays/{id}/events",object({event:choice("checked_in","checked_out","cleaning"),notes:{type:"string",maxLength:2000},expectedVersion:versionField},["event","expectedVersion"]));
body("/admin/refunds",{...object({bookingId:uuid,originalTransactionId:uuid,originalOfflineReceiptId:uuid,amountMinor:money,reason:textField,policyCalculation:{type:"object",additionalProperties:true}},["bookingId","amountMinor","reason"]),oneOf:[{required:["originalTransactionId"],not:{required:["originalOfflineReceiptId"]}},{required:["originalOfflineReceiptId"],not:{required:["originalTransactionId"]}}]});status("/admin/refunds","201");
body("/admin/refunds/{id}/approve",ref("ExpectedVersion"));
for(const path of ["/admin/refunds","/admin/refunds/{id}/complete-offline"])(op(path).parameters as unknown[]).push({name:"Idempotency-Key",in:"header",required:true,schema:{type:"string",minLength:8,maxLength:200}});
add("/admin/refunds/{id}/execute","post","Submit an approved refund once; ambiguous result requires inquiry",{security:"staff",body:object({expectedVersion:versionField,confirm:{const:true}})});
add("/admin/refunds/{id}/reconcile","post","Authenticate provider refund and match parent transaction, merchant, currency and amount",{security:"staff",body:object({providerRefundId:{type:"string",pattern:"^\\d+$",maxLength:30}})});
body("/admin/financial-exceptions/{id}/resolve",object({resolution:choice("refund_requested","new_offer_created","reconciled","acknowledged"),reason:textField,expectedVersion:versionField}));
for(const path of ["/admin/jobs/{id}/retry","/admin/payments/{id}/reconcile","/admin/refunds/{id}/complete-offline","/admin/media/{id}/finalize","/admin/media/{id}/complete"])noBody(path);
body("/admin/media/{id}/public-derivative",object({galleryId:uuid,expectedVersion:versionField}));status("/admin/media/{id}/public-derivative","201");
body("/admin/reviews/{id}/moderate",object({expectedVersion:versionField,action:choice("publish","reject","withdraw","restore"),reason:textField}));
body("/galleries/{id}/download-grants",object({assetIds:{type:"array",minItems:1,maxItems:100,items:uuid},derivative:choice("preview","web","video","original")}));
status("/admin/reviews/{id}/replies","201");
for(const path of ["/contact","/guest-access/request"])status(path,"202");
schemas.StaffInvitation=z.toJSONSchema(staffInvitationSchema);
add("/admin/staff/invitations","post","Invite a designated staff member with current scopes; no public signup",{security:"staff",body:"StaffInvitation",created:true});
const invitationProperties=(schemas.StaffInvitation as {properties:Schema}).properties;
body("/admin/staff/{id}/access",object({roles:invitationProperties.roles,active:{type:"boolean"},scopes:invitationProperties.scopes,expectedVersion:versionField}),"patch");
add("/admin/auth/invite-accept","post","Accept one-use provider invitation and set a strong password before MFA",{body:object({token:{type:"string",minLength:32,maxLength:256,writeOnly:true},password:{type:"string",minLength:12,maxLength:256,writeOnly:true}})});
body("/admin/auth/mfa/challenge",object({factorId:uuid}));
body("/admin/auth/mfa/verify",object({factorId:uuid,challengeId:uuid,code:{type:"string",pattern:"^[0-9]{6}$"}}));
for(const resource of ["stays","properties","photo-packages","variants","pickup-locations","variant-pickups","photographer-assignments","gallery-entitlements","publication-consents"])add(`/admin/${resource}`,"get",`Read scoped ${resource}`,{security:"staff"});
add("/admin/bookings/{id}/manifest","get","Scoped participant, pickup and fulfilment manifest",{security:"staff"});
add("/photo-packages","get","Approved active photography packages and entitlement rules",{query:["locale"]});
for(const name of ["variants","photo-packages"])add(`/admin/${name}/{id}/approve-translation`,"post","Approve translated product content",{security:"staff",body:object({locale:choice("en","de","pl","fr","ru","uk","es","ar","it","nl")})});
for(const name of ["finance","bookings","occupancy"])for(const key of ["from","to","currency"])(op(`/admin/reports/${name}`,"get").parameters as unknown[]).push({name:key,in:"query",schema:key==="currency"?currencyField:dateField});
for(const path of ["/galleries/{id}/assets/{derivativeId}","/galleries/public/assets/{derivativeId}"]){
 const responses=op(path,"get").responses as Record<string,unknown>;
 responses["200"]={description:"Authorized media bytes, never a public storage URL. Current entitlement and consent rechecked on every request.",content:{"application/octet-stream":{schema:{type:"string",format:"binary"}}},headers:{"Cache-Control":{schema:{const:"private, no-store"}}}};
}
(op("/galleries/{id}/assets/{derivativeId}","get").parameters as unknown[]).push({name:"x-download-token",in:"header",required:false,schema:{type:"string",writeOnly:true},description:"Required for original; scoped to this live guest session and derivative. Never send in URL."});
op("/admin/media/{id}/bytes","put").requestBody={required:true,content:{"application/octet-stream":{schema:{type:"string",format:"binary",description:"Bounded original bytes, maximum20MiB images/64MiB video; signature, full decode, hash and declared size checked."}}}};
const webhookSignatures:Record<string,string[]>={resend:["svix-id","svix-timestamp","svix-signature"],mux:["mux-signature"]};
for(const [provider,headers] of Object.entries(webhookSignatures)){
 add(`/webhooks/${provider}`,"post",`Authenticate raw ${provider} callback and deduplicate effects`,{security:"webhook",body:object({id:{type:"string"},type:{type:"string"},data:{type:"object",additionalProperties:true}},provider==="mux"?["id","type","data"]:["type","data"]),description:"Signature verified against the exact raw body before parsing. Timestamp/replay limits apply where supported. No unsigned client redirect can confirm delivery or payment."});
 op(`/webhooks/${provider}`).security=[{[`${provider}Signature`]:[]}];
 for(const name of headers)(op(`/webhooks/${provider}`).parameters as unknown[]).push({name,in:"header",required:true,schema:{type:"string"}});
}
add("/admin/bookings/{id}/whatsapp-link","get","Prepare a manual WhatsApp draft for the saved guest number",{security:"staff",description:"Current booking scope and WhatsApp consent are required. Returns a wa.me URL containing only a booking-reference draft; no send, token or delivery receipt is created."});
for(const action of ["worker","retention","monitor"]){
 add(`/internal/${action}`,"get",`Authenticated bounded ${action} task`,{security:"cron",description:action==="retention"?"Daily bounded expiry cleanup. Dry-run until retention policy approval; failed purge returns503 and stays eligible for retry.":"Fixed-size operational task. Bearer authentication required before database work; aggregate counts only."});
 paths[`/api/internal/${action}`]=paths[`/api/v1/internal/${action}`];delete paths[`/api/v1/internal/${action}`];
}
const document={openapi:"3.1.0",info:{title:"Red Sea Horizons",version:"0.1.0",description:"Private-schema PostgreSQL application API. Current authorization is evaluated on every sensitive action. Operational schema and adapter acceptance tests remain authoritative; external provider live verification is separately gated."},servers:[{url:"/",description:"Same-origin application"}],paths,components:{schemas,securitySchemes:{guestAuth:{type:"apiKey",in:"cookie",name:"rsh_guest"},staffAuth:{type:"apiKey",in:"cookie",name:"rsh_staff_access",description:"MFA aal2 required for operations; MFA enrollment routes use an active pre-MFA staff session. Local test token is a separate development-only cookie."},cronAuth:{type:"http",scheme:"bearer"},webhookAuth:{type:"apiKey",in:"query",name:"hmac",description:"Paymob HMAC-SHA512 exact canonical transaction fields."},resendSignature:{type:"apiKey",in:"header",name:"svix-signature"},muxSignature:{type:"apiKey",in:"header",name:"mux-signature"}}}};
mkdirSync("docs",{recursive:true});writeFileSync("docs/openapi.json",JSON.stringify(document,null,2)+"\n");
console.log(`Generated ${Object.keys(paths).length} API paths.`);
