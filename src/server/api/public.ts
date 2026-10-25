import {serveOwnerMedia} from "@/integrations/storage/owner-media";
import {z} from "zod";
import {query} from "@/server/db";
import {AppError} from "@/server/http/errors";
import {readJson,success,rateLimit,idempotencyKey} from "@/server/http/request";
import {cookieValue,getGuest,issueGuestSession,redeemGuestGrant,sessionCookie} from "@/server/auth";
import {newSecret,digestSecret} from "@/server/security";
import {getApartment,getCatalog,getDepartures,getDestinations,getService,searchApartments,searchServices} from "@/modules/catalog";
import {catalogFiltersSchema} from "@/modules/catalog/contracts";
import {bookingInputSchema,dateSchema,localeSchema,quoteInputSchema,uuidSchema} from "@/modules/bookings/contracts";
import {bookingDetails,createBookingRequest,createQuote,submitBooking} from "@/modules/bookings/service";
import {getGalleryManifest,issueDownloadGrant,servePrivateAsset,listPublicGalleries,servePublicDerivative} from "@/modules/photography/service";
import {submitReview,listReviewPage,reviewPageInputSchema} from "@/modules/reviews/service";
import {submitContact,getSocialLinks} from "@/modules/content/contact";

const dateRangeSchema=z.object({from:dateSchema,to:dateSchema}).refine(v=>v.to>=v.from);
export async function publicRoute(request:Request,parts:string[]):Promise<Response|undefined> {
  const url=new URL(request.url),locale=localeSchema.parse(url.searchParams.get("locale")??"en");
  const [resource,id,action]=parts;
  if(resource==="demo-media"&&parts.length===2)return serveOwnerMedia(request,id);
  if(resource==="galleries"&&id==="public"&&action==="assets"&&parts.length===4&&["GET","HEAD"].includes(request.method)){
    return servePublicDerivative(request,uuidSchema.parse(parts[3]));
  }
  if(request.method==="GET") {
    if(resource==="health") {
      if(id==="live")return success({status:"ok"});
      if(id==="ready"){await query("SELECT 1");return success({status:"ok",environment:process.env.APP_ENV??"development",bookingIntake:process.env.BOOKING_ENABLED==="true"});}
    }
    if(resource==="catalog")return success(await getCatalog(locale));
    if(resource==="policies"&&id==="current"){
      const {rows}=await query("SELECT DISTINCT ON(policy_type) policy_type,version FROM app.policy_versions WHERE locale=$1 AND policy_type IN('terms','privacy') AND approved_at IS NOT NULL AND effective_at<=now() ORDER BY policy_type,effective_at DESC",[locale]);
      if(rows.length!==2)throw new AppError("POLICIES_UNAVAILABLE",503);
      return success(Object.fromEntries(rows.map(r=>[r.policy_type,r.version])));
    }
    if(resource==="destinations")return success({items:await getDestinations(locale)});
    if(resource==="photo-packages"){
      const result=await query(`SELECT p.id,p.code,t.title,t.description,p.price_amount::text AS "priceAmountMinor",p.currency,p.entitlement_rules AS "entitlementRules" FROM app.photo_packages p JOIN app.photo_package_translations t ON t.package_id=p.id AND t.locale=$1 WHERE p.active AND t.approved_at IS NOT NULL ORDER BY p.price_amount,p.code`,[locale]);
      return success({items:result.rows});
    }
    if(resource==="services") {
      if(id&&action==="departures") {
        const params=dateRangeSchema.parse({from:url.searchParams.get("from"),to:url.searchParams.get("to")});
        const guests=z.coerce.number().int().min(1).max(100).parse(url.searchParams.get("guests")??1);
        return success({items:await getDepartures(uuidSchema.parse(id),params.from,params.to,guests)});
      }
      if(id)return success(await getService(id,locale));
      const filters=catalogFiltersSchema.parse(Object.fromEntries(url.searchParams));
      return success(await searchServices(filters,locale));
    }
    if(resource==="apartments") {
      if(id&&action==="availability"){
        const range=dateRangeSchema.parse({from:url.searchParams.get("from"),to:url.searchParams.get("to")});
        await getApartment(id,locale);
        const {rows}=await query(`SELECT lower(date_range) AS "from",upper(date_range) AS "to" FROM app.apartment_inventory WHERE apartment_id=$1 AND released_at IS NULL AND date_range && daterange($2,$3,'[)') ORDER BY lower(date_range)`,[uuidSchema.parse(id),range.from,range.to]);
        return success({unavailable:rows,checkoutExclusive:true});
      }
      if(id)return success(await getApartment(id,locale));
      const filter=z.object({locale:localeSchema.optional(),checkIn:dateSchema.optional(),checkOut:dateSchema.optional(),guests:z.coerce.number().int().min(1).max(30).optional()}).strict().parse(Object.fromEntries(url.searchParams));
      if(!!filter.checkIn!==!!filter.checkOut || filter.checkIn&&filter.checkOut&&filter.checkOut<=filter.checkIn)throw new AppError("INVALID_STAY",422);
      return success({items:await searchApartments(filter,locale)});
    }
    if(resource==="bookings"&&id) {
      const guest=await getGuest(request,id);
      if(action==="payments"){const detail=await bookingDetails(guest.bookingId);return success({items:detail.payments});}
      if(action==="payment-options"){
        const detail=await bookingDetails(guest.bookingId);
        const methods=[...process.env.PAYMOB_CARD_INTEGRATION_IDS?.trim()?["card"]:[],...process.env.PAYMOB_WALLET_INTEGRATION_IDS?.trim()?["wallet"]:[]];
        const eligible=["approved_pending_payment","confirmed"].includes(detail.status)&&detail.obligations.some(o=>o.status==="open")&&(!detail.paymentDeadline||new Date(detail.paymentDeadline)>new Date()||detail.status==="confirmed");
        return success({eligible,obligations:detail.obligations,methods,currency:detail.currency,providerConfigured:methods.length>0});
      }
      return success(await bookingDetails(guest.bookingId));
    }
    if(resource==="galleries") {
      if(id==="public"){
        if(action)throw new AppError("NOT_FOUND",404);
        return success({items:await listPublicGalleries(locale)});
      }
      if(id) {
        const actor=await getGuest(request);
        if(action==="assets"&&parts[3]){
          return servePrivateAsset(request,actor,{galleryId:id,derivativeId:parts[3],downloadToken:request.headers.get("x-download-token")??undefined});
        }
        return success(await getGalleryManifest(actor,id));
      }
    }
    if(resource==="reviews"){
      const parameters=Object.fromEntries(url.searchParams);delete parameters.locale;
      return success(await listReviewPage(reviewPageInputSchema.parse(parameters)));
    }
    if(resource==="social-links")return success({items:await getSocialLinks()});
    if(resource==="pages"&&id) {
      const {rows}=await query(`SELECT t.title,t.structured_body AS body,t.seo_title AS "seoTitle",t.seo_description AS "seoDescription" FROM app.cms_pages p JOIN app.cms_translations t ON t.page_id=p.id AND t.locale=$2 WHERE (p.page_key=$1 OR t.slug=$1) AND p.status='published' AND t.approved_at IS NOT NULL`,[id,locale]);
      if(!rows[0])throw new AppError("NOT_FOUND",404);
      return success(rows[0]);
    }
  }
  if(request.method==="POST") {
    if(resource==="quotes"){
      await rateLimit(request,"quote",30);
      const binding=cookieValue(request,"rsh_binding")??newSecret();
      const quote=await createQuote(quoteInputSchema.parse(await readJson(request)),digestSecret(binding));
      return success(quote,201,[sessionCookie("rsh_binding",binding,86400)]);
    }
    if(resource==="bookings"&&!id){
      await rateLimit(request,"booking",10);
      const binding=cookieValue(request,"rsh_binding");
      if(!binding)throw new AppError("QUOTE_NOT_FOUND",404);
      const booking=await submitBooking(bookingInputSchema.parse(await readJson(request)),idempotencyKey(request),digestSecret(binding));
      const session=await issueGuestSession(booking.id);
      return success({reference:booking.reference,status:booking.status,paymentRequested:false,message:"Your reservation request has been received and is awaiting staff approval. It is not confirmed yet."},201,[sessionCookie("rsh_guest",session,43200)]);
    }
    if(resource==="guest-access"){
      await rateLimit(request,"guest-access",5);
      if(id==="redeem"){
        const body=z.object({token:z.string().max(200)}).strict().parse(await readJson(request));
        const redeemed=await redeemGuestGrant(body.token);
        return success({reference:redeemed.reference,purpose:redeemed.purpose,galleryId:redeemed.galleryId,invitationId:redeemed.invitationId},200,[sessionCookie("rsh_guest",redeemed.sessionToken,43200)]);
      }
      if(id==="request"){
        const body=z.object({reference:z.string().max(40),contact:z.string().min(3).max(254),locale:localeSchema.optional()}).strict().parse(await readJson(request));
        // Durable delivery work contains only a booking ID. The worker creates a fresh scoped secret.
        const result=await query(`SELECT b.id,b.version FROM app.bookings b JOIN app.guests g ON g.id=b.primary_guest_id WHERE b.reference=$1 AND (lower(g.email)=lower($2) OR g.phone_e164=$2)`,[body.reference,body.contact]);
        if(result.rows[0]){
          const b=result.rows[0],key=`access:${b.id}:${Math.floor(Date.now()/300000)}`;
          await query(`WITH event AS (INSERT INTO app.outbox_events(aggregate_type,aggregate_id,aggregate_version,event_type,event_key,payload) VALUES('booking',$1,$2,'guest_access_requested',$3,jsonb_build_object('bookingId',$1::uuid)) ON CONFLICT DO NOTHING RETURNING id) INSERT INTO app.jobs(event_id,kind,job_key) SELECT id,'notification',id||':notification' FROM event`,[b.id,b.version,key]);
        }
        return success({message:"If the details match, a secure access link will be sent."},202);
      }
    }
    if(resource==="bookings"&&id){
      const guest=await getGuest(request,id);
      if(!guest.scope.includes("booking:request"))throw new AppError("FORBIDDEN",403);
      if(action==="change-requests"||action==="cancellation-requests") {
        const body=z.object({reason:z.string().trim().min(3).max(2000),proposedChanges:z.record(z.string(),z.unknown()).optional()}).strict().parse(await readJson(request));
        return success(await createBookingRequest(guest,guest.bookingId,action==="change-requests"?"change":"cancel",body.reason,body.proposedChanges),201);
      }
      if(action==="revision-acceptance"){
        const body=z.object({revisionId:uuidSchema,policiesAccepted:z.literal(true)}).strict().parse(await readJson(request));
        const {rows}=await query("SELECT app.accept_revision($1,$2) AS revision",[guest.bookingId,body.revisionId]);
        return success(rows[0].revision);
      }
    }
    if(resource==="galleries"&&id&&action==="download-grants"){
      const actor=await getGuest(request);
      const body=z.object({assetIds:z.array(uuidSchema).min(1).max(100),derivative:z.enum(["preview","web","video","original"])}).strict().parse(await readJson(request));
      return success(await issueDownloadGrant(actor,{...body,galleryId:id}));
    }
    if(resource==="reviews")return success(await submitReview(await getGuest(request),await readJson(request)),201);
    if(resource==="contact"){
      const input=await readJson(request);
      return success(await submitContact(input,{rateLimitKeyDigest:digestSecret(`contact:${process.env.VERCEL==="1"?request.headers.get("x-vercel-forwarded-for")??"unknown":"local"}`)}),202);
    }
  }
  return undefined;
}
