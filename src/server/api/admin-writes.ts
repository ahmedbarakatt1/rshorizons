import {z} from "zod";
import {query,withTransaction} from "@/server/db";
import {getStaff,type StaffActor} from "@/server/auth";
import {readJson,success,idempotencyKey} from "@/server/http/request";
import {AppError} from "@/server/http/errors";
import {uuidSchema,localeSchema,dateSchema} from "@/modules/bookings/contracts";
import {approveBooking,decideBooking} from "@/modules/bookings/service";
import {createUploadIntent,receiveUpload,finalizeUpload,publishGallery,createApprovedPublicDerivative} from "@/modules/photography/service";
import {MAX_VIDEO_BYTES} from "@/modules/photography/validation";
import {moderateReview,replyToReview} from "@/modules/reviews/service";
import {reconcileAttempt} from "@/modules/payments/service";
import {inviteStaff} from "@/modules/staff/invitations";
import {executeRefund,reconcileRefund} from "@/modules/payments/refunds";
const version=z.number().int().positive(),text=z.string().trim().min(1).max(2000),money=z.string().regex(/^(0|[1-9]\d{0,14})$/);
const timestamp=z.iso.datetime({offset:true}),slug=z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(150);
const translation={locale:localeSchema,title:text,slug};
export const staffInvitationSchema=z.object({email:z.email().max(254),name:text.optional(),roles:z.array(z.enum(["owner","reservations","operations","property_manager","finance","content_editor","photographer"])).min(1).max(7),scopes:z.array(z.object({scopeType:z.enum(["all","destination","property"]),destinationId:uuidSchema.optional(),propertyId:uuidSchema.optional()}).strict()).max(100)}).strict();
export const editorSchemas:Record<string,z.ZodType>={
  "pickup-locations":z.object({destinationId:uuidSchema,name:text,address:text,latitude:z.number().min(-90).max(90).optional(),longitude:z.number().min(-180).max(180).optional(),active:z.boolean().optional(),expectedVersion:version.optional()}).strict(),
  "variant-pickups":z.object({variantId:uuidSchema,pickupId:uuidSchema,surchargeAmountMinor:money,currency:z.string().regex(/^[A-Z]{3}$/),offsetMinutes:z.number().int().min(-1440).max(1440),expectedVersion:version.optional()}).strict(),
  properties:z.object({destinationId:uuidSchema,name:text,address:text,latitude:z.number().min(-90).max(90).optional(),longitude:z.number().min(-180).max(180).optional(),active:z.boolean().optional(),expectedVersion:version.optional()}).strict(),
  "apartment-policy-bindings":z.object({apartmentId:uuidSchema,policyId:uuidSchema}).strict(),
  "photo-packages":z.object({code:slug,entitlementRules:z.object({previews:z.boolean(),downloads:z.number().int().nonnegative()}).strict(),priceAmountMinor:money,currency:z.string().regex(/^[A-Z]{3}$/),locale:localeSchema.optional(),title:text.optional(),description:text.optional(),active:z.boolean().optional(),expectedVersion:version.optional()}).strict(),
  "photographer-assignments":z.object({staffId:uuidSchema,bookingId:uuidSchema,accessStartsAt:timestamp,accessEndsAt:timestamp,revoked:z.boolean().optional(),expectedVersion:version.optional()}).strict().refine(v=>v.accessEndsAt>v.accessStartsAt),
  "gallery-entitlements":z.union([z.object({bookingItemId:uuidSchema,galleryId:uuidSchema,packageId:uuidSchema,allowedVariants:z.array(z.enum(["preview","web","original","video"])).min(1),allowedCount:z.number().int().nonnegative().optional(),expiresAt:timestamp.optional()}).strict(),z.object({revoked:z.boolean().optional(),expiresAt:timestamp.optional(),expectedVersion:version}).strict()]),
  "publication-consents":z.union([z.object({assetId:uuidSchema,subjectGuestId:uuidSchema,grantedByGuestId:uuidSchema,evidenceRef:text,allowedUses:z.array(z.enum(["marketing","social","website","print"])).min(1),expiresAt:timestamp.optional()}).strict(),z.object({withdrawn:z.literal(true),expectedVersion:version}).strict()]),
  "media-rights":z.object({rightsEvidenceRef:text,subjectsReviewed:z.literal(true),expectedVersion:version}).strict(),
  "media-subjects":z.object({subjectGuestId:uuidSchema,guardianGuestId:uuidSchema.optional(),expectedVersion:version}).strict(),
  services:z.object({categoryId:uuidSchema,destinationId:uuidSchema,durationMinutes:z.number().int().positive(),cutoffMinutes:z.number().int().nonnegative(),...translation,summary:text,cancellationPolicyVersionId:uuidSchema.optional(),itinerary:z.array(z.unknown()).optional(),inclusions:z.array(text).optional(),exclusions:z.array(text).optional(),restrictions:z.record(z.string(),z.unknown()).optional(),meetingNotes:text.optional(),expectedVersion:version.optional()}).strict(),
  departures:z.object({variantId:uuidSchema,startsAt:timestamp,endsAt:timestamp,seatCapacity:z.number().int().positive(),cutoffAt:timestamp,expectedVersion:version.optional()}).strict().refine(v=>v.endsAt>v.startsAt&&v.cutoffAt<=v.startsAt),
  apartments:z.object({propertyId:uuidSchema,unitCode:text,bedrooms:z.number().int().nonnegative(),beds:z.number().int().positive(),bathrooms:z.number().positive(),maxGuests:z.number().int().positive(),nightlyAmountMinor:money,currency:z.string().regex(/^[A-Z]{3}$/),...translation,description:text,minNights:z.number().int().min(1).max(90).optional(),cleaningBufferDays:z.number().int().min(0).max(30).optional(),checkInTime:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),checkOutTime:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),houseRules:z.array(text).max(100).optional(),amenityIds:z.array(uuidSchema).max(100).optional(),cleaningFeeMinor:money.optional(),cancellationPolicyVersionId:uuidSchema.optional(),expectedVersion:version.optional()}).strict(),
  resources:z.object({kind:z.enum(["boat","vehicle","driver","guide","photographer","equipment"]),code:slug,name:text,mode:z.enum(["exclusive","shared"]),capacity:z.number().int().positive(),metadata:z.object({seats:z.number().int().min(1).max(500),luggage:z.number().int().min(0).max(500),vehicleKind:z.enum(["car","van","minibus","bus"]).optional()}).strict().optional(),active:z.boolean().optional(),expectedVersion:version.optional()}).strict().refine(v=>v.kind!=="vehicle"||!!v.metadata,"Vehicle seat and luggage capacity are required"),
  galleries:z.object({kind:z.enum(["public","private"]),bookingId:uuidSchema.optional(),title:text,destinationId:uuidSchema.optional(),expiresAt:timestamp.optional(),expectedVersion:version.optional()}).strict(),
  pages:z.object({pageKey:slug,...translation,body:z.array(z.discriminatedUnion("type",[z.object({type:z.literal("paragraph"),text}),z.object({type:z.literal("heading"),text}),z.object({type:z.literal("list"),items:z.array(text).max(100)})])).max(100),expectedVersion:version.optional()}).strict(),
  variants:z.object({serviceId:uuidSchema,variantCode:slug,capacityModel:z.enum(["departure","exclusive","shared","none"]),pricingUnit:z.enum(["person","booking","night","quantity"]),durationMinutes:z.number().int().positive(),locale:localeSchema.optional(),title:text.optional(),description:text.optional(),active:z.boolean().optional(),expectedVersion:version.optional()}).strict(),
  prices:z.object({variantId:uuidSchema,guestCategory:z.enum(["adult","child","infant","all"]),from:dateSchema,to:dateSchema,currency:z.string().length(3),amountMinor:money,priority:z.number().int().min(0).max(1000)}).strict().refine(v=>v.to>v.from),
  "apartment-rates":z.object({apartmentId:uuidSchema,from:dateSchema,to:dateSchema,currency:z.string().length(3),amountMinor:money,priority:z.number().int().min(0).max(1000),minNights:z.number().int().positive()}).strict().refine(v=>v.to>v.from),
  "payment-policy-bindings":z.object({variantId:uuidSchema,policyId:uuidSchema}).strict(),
  "social-links":z.object({platform:z.enum(["facebook","instagram","tiktok","whatsapp"]),url:z.url().refine(v=>v.startsWith("https://")),expectedVersion:version.optional()}).strict(),
  "dive-clearance":z.object({participantId:uuidSchema,certification:text.optional(),experience:z.record(z.string(),z.unknown()).optional(),equipmentSizes:z.record(z.string(),z.unknown()).optional(),clearanceStatus:z.enum(["pending","cleared","not_cleared"])}).strict(),
  settings:z.object({displayName:text.optional(),legalName:text.optional(),contactChannels:z.record(z.string(),z.unknown()).optional(),bookingEnabled:z.boolean().optional(),expectedVersion:version}).strict(),
};
const permissions:Record<string,string>={properties:"apartments.write","apartment-policy-bindings":"apartments.write","photo-packages":"media.manage","photographer-assignments":"media.manage","gallery-entitlements":"media.manage","publication-consents":"media.manage",services:"catalog.write",departures:"operations.write",apartments:"apartments.write",resources:"operations.write",galleries:"galleries.manage",pages:"content.write",variants:"catalog.write",prices:"catalog.write","apartment-rates":"apartments.write","payment-policy-bindings":"catalog.write","social-links":"content.write","dive-clearance":"operations.write",settings:"staff.manage"};
permissions["media-rights"]="media.manage";permissions["media-subjects"]="media.manage";
permissions["pickup-locations"]="catalog.write";permissions["variant-pickups"]="catalog.write";
async function routine(actor:StaffActor,sql:string,values:unknown[]) {
  return withTransaction(actor,async tx=>(await tx.query(sql,values)).rows[0]?.result);
}
async function readBytes(request:Request) {
  if(Number(request.headers.get("content-length")??0)>MAX_VIDEO_BYTES)throw new AppError("BODY_TOO_LARGE",413);
  const reader=request.body?.getReader();if(!reader)throw new AppError("EMPTY_UPLOAD",400);
  const chunks:Uint8Array[]=[];let size=0;
  for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>MAX_VIDEO_BYTES){await reader.cancel();throw new AppError("BODY_TOO_LARGE",413);}chunks.push(part.value);}
  return Buffer.concat(chunks);
}
export async function adminWrites(request:Request,parts:string[]) {
  if(!["POST","PATCH","PUT"].includes(request.method))return undefined;
  const [,resource,id,action]=parts;
  if(resource==="contact"&&id&&!action&&request.method==="PATCH") {
    const actor=await getStaff(request,"contacts.manage");
    const input=z.object({state:z.enum(["new","replied","closed","spam"]),expectedVersion:version}).strict().parse(await readJson(request));
    return success(await routine(actor,"SELECT app.update_contact_state($1,$2,$3,$4) AS result",[uuidSchema.parse(id),input.expectedVersion,input.state,actor.id]));
  }
  if(resource==="staff"&&id==="invitations"&&request.method==="POST"){
    const actor=await getStaff(request,"staff.manage"),input=staffInvitationSchema.parse(await readJson(request));
    return success(await inviteStaff(actor,input),201);
  }
  if(resource==="jobs"&&id&&action==="retry"){
    const actor=await getStaff(request,"notifications.retry");
    return success(await routine(actor,"SELECT app.retry_job($1,$2) AS result",[uuidSchema.parse(id),actor.id]));
  }
  if(resource==="bookings"&&id) {
    uuidSchema.parse(id);
    const permission=action==="offline-receipts"?"payments.record_offline":action==="fulfilment"||action==="pickup"?"operations.write":action==="approve"?"bookings.approve":action==="revisions"||action==="apply-revision"?"bookings.revise":"bookings.cancel";
    // SQL routines enforce their exact permission as well.
    const actor=await getStaff(request,permission,id),body=await readJson(request);
    if(action==="approve"){
      const input=z.object({expectedVersion:version}).strict().parse(body);return success(await approveBooking(id,input.expectedVersion,actor));
    }
    if(action==="reject"||action==="cancel"){
      const input=z.object({expectedVersion:version,reason:text}).strict().parse(body);return success(await decideBooking(id,input.expectedVersion,actor,action,input.reason));
    }
    if(action==="offline-receipts"){
      const input=z.object({amountMinor:money,currency:z.string().length(3),method:z.enum(["cash","bank_transfer"]),reference:text,expectedVersion:version.optional()}).strict().parse(body);
      return success(await routine(actor,"SELECT app.record_offline_receipt($1,$2,$3,$4,$5,$6,$7) AS result",[id,input.amountMinor,input.currency,input.method,input.reference,idempotencyKey(request),actor.id]),201);
    }
    if(action==="revisions") {
      const input=z.object({quoteId:uuidSchema,expectedVersion:version,reason:text.optional()}).strict().parse(body);
      return success(await routine(actor,"SELECT app.propose_revision($1,$2,$3,$4) AS result",[id,input.expectedVersion,input.quoteId,actor.id]),201);
    }
    if(action==="apply-revision"){
      const input=z.object({revisionId:uuidSchema,expectedVersion:version}).strict().parse(body);
      return success(await routine(actor,"SELECT app.apply_revision($1,$2,$3,$4) AS result",[id,input.revisionId,input.expectedVersion,actor.id]));
    }
    if(action==="fulfilment"){
      const input=z.object({bookingItemId:uuidSchema,state:z.enum(["check_in","fulfilled","no_show","cancelled"]),notes:text,expectedVersion:version}).strict().parse(body);
      const item=await query("SELECT 1 FROM app.booking_items WHERE id=$1 AND booking_id=$2",[input.bookingItemId,id]);if(!item.rows.length)throw new AppError("NOT_FOUND",404);
      return success(await routine(actor,"SELECT app.fulfil_item_versioned($1,$2,$3,$4,$5) AS result",[input.bookingItemId,input.state,input.notes,input.expectedVersion,actor.id]));
    }
    if(action==="pickup") {
      const input=z.object({bookingItemId:uuidSchema,address:text,pickupAt:timestamp,instructions:z.string().max(2000).optional(),expectedVersion:version}).strict().parse(body);
      return success(await routine(actor,"SELECT app.staff_edit('pickup',$1,$2,$3,$4) AS result",[id,input.expectedVersion,JSON.stringify(input),actor.id]),201);
    }
  }
  if(resource==="apartments"&&id&&action==="blocks") {
    const actor=await getStaff(request,"apartments.block"),input=z.object({from:dateSchema,to:dateSchema,kind:z.enum(["maintenance","owner_block","cleaning"]),reason:text,expectedVersion:version}).strict().refine(v=>v.to>v.from).parse(await readJson(request));
    return success(await routine(actor,"SELECT app.staff_edit('apartment_block',$1,$2,$3,$4) AS result",[uuidSchema.parse(id),input.expectedVersion,JSON.stringify(input),actor.id]),201);
  }
  if(resource==="resources"&&id&&action==="assignments"){
    const actor=await getStaff(request,"operations.write"),input=z.object({departureId:uuidSchema.optional(),bookingItemId:uuidSchema.optional(),startsAt:timestamp,endsAt:timestamp,quantity:z.number().int().positive()}).strict().refine(v=>!!v.departureId!==!!v.bookingItemId&&v.endsAt>v.startsAt).parse(await readJson(request));
    return success(await routine(actor,"SELECT app.assign_resource($1,$2,$3,$4,$5,$6,$7) AS result",[uuidSchema.parse(id),input.departureId??null,input.bookingItemId??null,input.startsAt,input.endsAt,input.quantity,actor.id]),201);
  }
  if(resource==="refunds") {
    const actor=await getStaff(request,!id?"refunds.request":action==="reconcile"?"finance.reconcile":"refunds.approve");
    if(id&&action==="execute"){
      const input=z.object({expectedVersion:version,confirm:z.literal(true)}).strict().parse(await readJson(request));
      return success(await executeRefund(uuidSchema.parse(id),input.expectedVersion,actor));
    }
    if(id&&action==="reconcile"){
      const input=z.object({providerRefundId:z.string().regex(/^\d+$/).max(30)}).strict().parse(await readJson(request));
      return success(await reconcileRefund(uuidSchema.parse(id),input.providerRefundId,actor));
    }
    if(!id) {
      const input=z.object({bookingId:uuidSchema,originalTransactionId:uuidSchema.optional(),originalOfflineReceiptId:uuidSchema.optional(),amountMinor:money,reason:text,policyCalculation:z.record(z.string(),z.unknown()).optional()}).strict().refine(v=>!!v.originalTransactionId!==!!v.originalOfflineReceiptId).parse(await readJson(request));
      await getStaff(request,"refunds.request",input.bookingId);
      return success(await routine(actor,"SELECT app.request_refund_idempotent($1,$2,$3) AS result",[JSON.stringify(input),idempotencyKey(request),actor.id]),201);
    }
    if(action==="approve") {
      const input=z.object({expectedVersion:version}).strict().parse(await readJson(request));
      return success(await routine(actor,"SELECT app.approve_refund($1,$2,$3) AS result",[uuidSchema.parse(id),input.expectedVersion,actor.id]));
    }
    if(action==="complete-offline")return success(await routine(actor,"SELECT app.complete_offline_refund($1,$2,$3) AS result",[uuidSchema.parse(id),idempotencyKey(request),actor.id]));
  }
  if(resource==="payments"&&id&&action==="reconcile"){
    const attemptId=uuidSchema.parse(id);
    const found=await query("SELECT booking_id FROM app.payment_attempts WHERE id=$1",[attemptId]);
    if(!found.rows[0])throw new AppError("NOT_FOUND",404);
    await getStaff(request,"finance.reconcile",found.rows[0].booking_id);
    return success(await reconcileAttempt(attemptId));
  }
  const operations:Record<string,{kind:string;permission:string;schema:z.ZodType}>={
    "resources/blocks":{kind:"resources_block",permission:"operations.write",schema:z.object({startsAt:timestamp,endsAt:timestamp,reason:text,expectedVersion:version.optional()}).strict().refine(v=>v.endsAt>v.startsAt)},
    "departures/assignments":{kind:"departure_assignment",permission:"operations.write",schema:z.object({resourceId:uuidSchema,quantity:z.number().int().positive(),role:text,bufferBeforeMinutes:z.number().int().min(0).max(1440).default(0),bufferAfterMinutes:z.number().int().min(0).max(1440).default(0),expectedVersion:version}).strict()},
    "stays/events":{kind:"stay_event",permission:"apartments.operate",schema:z.object({event:z.enum(["checked_in","checked_out","cleaning"]),notes:z.string().max(2000).optional(),expectedVersion:version}).strict()},
    "staff/access":{kind:"staff_access",permission:"staff.manage",schema:z.object({roles:z.array(z.enum(["owner","reservations","operations","property_manager","finance","content_editor","photographer"])).min(1),active:z.boolean(),scopes:z.array(z.object({scopeType:z.enum(["all","destination","property"]),destinationId:uuidSchema.optional(),propertyId:uuidSchema.optional()}).strict()),expectedVersion:version}).strict()},
    "financial-exceptions/resolve":{kind:"financial_exception",permission:"finance.reconcile",schema:z.object({resolution:z.enum(["refund_requested","new_offer_created","reconciled","acknowledged"]),reason:text,expectedVersion:version}).strict()},
  };
  const operation=operations[`${resource}/${action}`];
  if(id&&operation) {
    const actor=await getStaff(request,operation.permission),body=operation.schema.parse(await readJson(request)) as Record<string,unknown>;
    return success(await routine(actor,"SELECT app.staff_edit($1,$2,$3,$4,$5) AS result",[operation.kind,uuidSchema.parse(id),body.expectedVersion??null,JSON.stringify(body),actor.id]));
  }
  if(resource==="media"){
    const actor=await getStaff(request,"media.upload");
    if(id==="upload-intents")return success(await createUploadIntent(actor,await readJson(request)),201);
    if(id&&action==="bytes"&&request.method==="PUT")return success(await receiveUpload(uuidSchema.parse(id),actor,await readBytes(request)));
    if(id&&(action==="finalize"||action==="complete"))return success(await finalizeUpload(uuidSchema.parse(id),actor));
    if(id&&action==="public-derivative"){
      const input=z.object({galleryId:uuidSchema,expectedVersion:version}).strict().parse(await readJson(request));
      return success(await createApprovedPublicDerivative(actor,{assetId:uuidSchema.parse(id),...input}),201);
    }
  }
  if(resource==="galleries"&&id&&action==="publish") {
    const actor=await getStaff(request,"galleries.manage"),body=z.object({expectedVersion:version}).strict().parse(await readJson(request));
    return success(await publishGallery(actor,{galleryId:uuidSchema.parse(id),...body}));
  }
  if(resource==="reviews"&&id) {
    const actor=await getStaff(request,"reviews.moderate"),body=z.object({expectedVersion:version,action:z.enum(["withdraw","restore"]),reason:text}).strict();
    if(action==="moderate")return success(await moderateReview(actor,{...body.parse(await readJson(request)),reviewId:uuidSchema.parse(id)}));
    if(action==="replies"){const input=z.object({body:text}).strict().parse(await readJson(request));return success(await replyToReview(actor,{reviewId:uuidSchema.parse(id),body:input.body}),201);}
  }
  if(["services","pages","apartments","variants","photo-packages"].includes(resource)&&id&&(action==="publish"||action==="approve-translation")){
    const actor=await getStaff(request,"content.publish");
    if(action==="approve-translation"){
      const input=z.object({locale:localeSchema}).strict().parse(await readJson(request));
      await routine(actor,"SELECT app.approve_translation($1,$2,$3,$4) AS result",[resource.replaceAll("-","_"),uuidSchema.parse(id),input.locale,actor.id]);
      return success({approved:true});
    }
    const input=z.object({expectedVersion:version}).strict().parse(await readJson(request));
    return success(await routine(actor,"SELECT app.publish_content($1,$2,$3,$4) AS result",[resource,uuidSchema.parse(id),input.expectedVersion,actor.id]));
  }
  if(editorSchemas[resource]&&!action){
    const actor=await getStaff(request,permissions[resource]),body=editorSchemas[resource].parse(await readJson(request)) as Record<string,unknown>;
    if(id&&!body.expectedVersion)throw new AppError("VERSION_REQUIRED",400);
    const fn=["pickup-locations","variant-pickups"].includes(resource)?"edit_pickup":"staff_edit";
    return success(await routine(actor,`SELECT app.${fn}($1,$2,$3,$4,$5) AS result`,[resource.replaceAll("-","_"),id?uuidSchema.parse(id):null,body.expectedVersion??null,JSON.stringify(body),actor.id]),id?200:201);
  }
  return undefined;
}
