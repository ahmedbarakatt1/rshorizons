import {query} from "@/server/db";
import {getStaff,type StaffActor} from "@/server/auth";
import {success} from "@/server/http/request";
import {AppError} from "@/server/http/errors";
import {bookingDetails} from "@/modules/bookings/service";
import {uuidSchema} from "@/modules/bookings/contracts";
import {readReport} from "@/modules/reports/service";
import {whatsappLink} from "@/modules/content/whatsapp";
import {isLocale} from "@/i18n/locales";
import {z} from "zod";

const scopedBooking=`NOT EXISTS(SELECT 1 FROM app.booking_items bi JOIN app.quote_items qi ON qi.id=bi.quote_item_id LEFT JOIN app.service_variants v ON v.id=qi.variant_id LEFT JOIN app.services sv ON sv.id=v.service_id LEFT JOIN app.apartments ap ON ap.id=qi.apartment_id LEFT JOIN app.properties pr ON pr.id=ap.property_id WHERE bi.booking_id=b.id AND NOT app.scope_allows($1,coalesce(sv.destination_id,pr.destination_id),pr.id))`;
async function operationalOnly(actor:StaffActor) {
  const {rows}=await query(`SELECT EXISTS(SELECT 1 FROM app.staff_roles sr JOIN app.roles r ON r.id=sr.role_id WHERE sr.staff_id=$1 AND r.code IN('owner','reservations','finance','property_manager')) AS full`,[actor.id]);
  return !rows[0].full;
}
export async function adminReads(request:Request,parts:string[]) {
  if(request.method!=="GET")return undefined;
  const [,resource,id]=parts;
  if(resource==="contact") {
    const actor=await getStaff(request,"contacts.read");
    const scope=await query("SELECT app.scope_allows($1,NULL,NULL) AS allowed",[actor.id]);
    if(!scope.rows[0].allowed)throw new AppError("FORBIDDEN",403);
    if(id) {
      const {rows}=await query("SELECT id,sender_name,email,phone_e164,locale,message,state,version,created_at FROM app.contact_requests WHERE id=$1 AND retention_deadline>now()",[uuidSchema.parse(id)]);
      if(!rows[0])throw new AppError("NOT_FOUND",404);
      return success(rows[0]);
    }
    const params=new URL(request.url).searchParams;
    const state=z.enum(["new","assigned","replied","closed","spam"]).nullable().parse(params.get("state"));
    const after=params.get("after")?uuidSchema.parse(params.get("after")):null;
    if(after&&!(await query("SELECT 1 FROM app.contact_requests WHERE id=$1",[after])).rowCount)throw new AppError("INVALID_CURSOR",400,"Refresh the inbox to continue.");
    const {rows}=await query(`SELECT id,sender_name,locale,state,created_at FROM app.contact_requests
      WHERE retention_deadline>now() AND ($1::text IS NULL OR state=$1)
      AND ($2::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM app.contact_requests WHERE id=$2))
      ORDER BY created_at DESC,id DESC LIMIT 51`,[state,after]);
    return success({items:rows.slice(0,50),nextCursor:rows.length>50?rows[49].id:null});
  }
  if(resource==="session") {
    const actor=await getStaff(request);
    const {rows}=await query(`SELECT p.code FROM app.permissions p WHERE app.has_permission($1,p.code)`,[actor.id]);
    return success({name:actor.name,permissions:rows.map(r=>r.code),demo:process.env.DEMO_MODE==="true"});
  }
  if(resource==="summary") {
    const actor=await getStaff(request,"bookings.read");
    const {rows}=await query(`SELECT count(*) FILTER(WHERE status='pending_review')::integer AS "pendingRequests",count(*) FILTER(WHERE status='approved_pending_payment')::integer AS "activeHolds",count(*) FILTER(WHERE status='confirmed')::integer AS "confirmedBookings" FROM app.bookings b WHERE ${scopedBooking}`,[actor.id]);
    const canFinance=await query("SELECT app.has_permission($1,'finance.reconcile') AS allowed",[actor.id]);
    const exceptions=canFinance.rows[0].allowed?await query(`SELECT count(*)::int AS count FROM app.financial_exceptions f JOIN app.bookings b ON b.id=f.booking_id WHERE f.state='open' AND ${scopedBooking}`,[actor.id]):null;
    return success({...rows[0],openExceptions:exceptions?.rows[0].count??null});
  }
  if(resource==="lookups") {
    await getStaff(request);
    const [destinations,categories,variants,properties,roles,policies,amenities,cancellationPolicies,pickupLocations]=await Promise.all([
      query("SELECT id,canonical_slug AS title FROM app.destinations ORDER BY canonical_slug"),
      query("SELECT id,code AS title FROM app.categories ORDER BY sort_order"),
      query("SELECT v.id,t.title FROM app.service_variants v JOIN app.variant_translations t ON t.variant_id=v.id AND t.locale='en' WHERE v.active"),
      query("SELECT id,name AS title FROM app.properties WHERE active"),
      query("SELECT id,code AS title FROM app.roles"),
      query("SELECT id,code AS title,type FROM app.payment_policies ORDER BY code"),
      query("SELECT id,code AS title FROM app.amenities ORDER BY code"),
      query("SELECT id,version||' ('||locale||')' AS title FROM app.policy_versions WHERE policy_type='cancellation' AND approved_at IS NOT NULL ORDER BY effective_at DESC"),
      query("SELECT id,name AS title FROM app.pickup_locations WHERE active ORDER BY name")
    ]);
    return success({destinations:destinations.rows,categories:categories.rows,variants:variants.rows,properties:properties.rows,roles:roles.rows,policies:policies.rows,amenities:amenities.rows,cancellationPolicies:cancellationPolicies.rows,pickupLocations:pickupLocations.rows});
  }
  if(resource==="bookings") {
    const actor=await getStaff(request,"bookings.read",id?uuidSchema.parse(id):undefined);
    const operation=await operationalOnly(actor);
    if(id){
      if(parts[3]==="whatsapp-link"){
        const {rows}=await query(`SELECT b.reference,g.phone_e164,g.locale,
          coalesce((SELECT granted AND withdrawn_at IS NULL FROM app.guest_consents c WHERE c.guest_id=g.id AND c.type='whatsapp_booking' ORDER BY captured_at DESC,id DESC LIMIT 1),false) AS consent
          FROM app.bookings b JOIN app.guests g ON g.id=b.primary_guest_id WHERE b.id=$1`,[id]);
        const guest=rows[0];
        if(!guest)throw new AppError("NOT_FOUND",404);
        if(!guest.consent)throw new AppError("WHATSAPP_CONSENT_REQUIRED",409);
        const locale=isLocale(guest.locale)?guest.locale:"en";
        const messages=(await import(`../../../messages/${locale}.json`)).default;
        const url=whatsappLink(guest.phone_e164,messages.whatsappStaffDraft.replace("{reference}",guest.reference));
        if(!url)throw new AppError("WHATSAPP_PHONE_REQUIRED",409);
        return success({url});
      }
      const details=await bookingDetails(id,true);
      if(parts[3]==="manifest"){
        const participants=await query(`SELECT p.id,p.display_name AS full_name,p.age_category,ip.booking_item_id,d.certification,d.equipment_sizes,d.clearance_status FROM app.booking_participants p LEFT JOIN app.item_participants ip ON ip.participant_id=p.id LEFT JOIN app.dive_requirements d ON d.participant_id=p.id WHERE p.booking_id=$1 ORDER BY p.display_name`,[id]);
        return success({reference:details.reference,status:details.status,version:details.version,guest:details.guest,items:details.items.map(item=>({id:item.id,kind:item.kind,title:item.title,quantity:item.quantity,fulfilmentState:item.fulfilmentState})),pickups:details.pickups,participants:participants.rows});
      }
      if(operation) {
        const {totalAmountMinor,initialDueAmountMinor,paidAmountMinor,balanceAmountMinor,obligations,payments,revisions,...safe}=details;
        void [totalAmountMinor,initialDueAmountMinor,paidAmountMinor,balanceAmountMinor,obligations,payments,revisions];
        return success({...safe,items:safe.items.map(item=>({id:item.id,kind:item.kind,title:item.title,quantity:item.quantity,fulfilmentState:item.fulfilmentState}))});
      }
      return success(details);
    }
    const state=new URL(request.url).searchParams.get("status");
    const {rows}=await query(`SELECT b.id,b.reference,b.status,b.version,b.created_at,g.full_name AS guest_name${operation?"":",b.total_amount::text,b.currency"} FROM app.bookings b JOIN app.guests g ON g.id=b.primary_guest_id WHERE ${scopedBooking} AND ($2::text IS NULL OR b.status=$2) ORDER BY b.created_at DESC LIMIT 200`,[actor.id,state]);
    return success({items:rows});
  }
  if(resource==="reports"){
    return success(await readReport(request,id??"bookings"));
  }
  const lists:Record<string,{permission:string;sql:string;scoped?:boolean}>={
    stays:{permission:"apartments.operate",sql:`SELECT s.id,s.version,s.state,s.check_in::text,s.check_out::text,s.occupants,b.reference,a.unit_code FROM app.apartment_stays s JOIN app.booking_items i ON i.id=s.booking_item_id JOIN app.bookings b ON b.id=i.booking_id JOIN app.apartments a ON a.id=s.apartment_id WHERE i.superseded_at IS NULL AND ${scopedBooking} ORDER BY s.check_in DESC LIMIT 200`,scoped:true},
    "pickup-locations":{permission:"catalog.write",sql:"SELECT p.* FROM app.pickup_locations p WHERE app.scope_allows($1,p.destination_id,NULL) ORDER BY p.name",scoped:true},
    "variant-pickups":{permission:"catalog.write",sql:"SELECT vp.*,p.name AS title FROM app.variant_pickups vp JOIN app.pickup_locations p ON p.id=vp.pickup_id WHERE app.scope_allows($1,p.destination_id,NULL) ORDER BY p.name",scoped:true},
    properties:{permission:"apartments.write",sql:"SELECT p.* FROM app.properties p WHERE app.scope_allows($1,p.destination_id,p.id) ORDER BY p.name",scoped:true},
    "photo-packages":{permission:"media.manage",sql:"SELECT p.id,p.code,p.entitlement_rules,p.price_amount::text,p.currency,p.active,p.version FROM app.photo_packages p ORDER BY p.code"},
    services:{permission:"catalog.write",sql:"SELECT s.id,t.title,t.slug,t.summary,t.locale,t.itinerary,t.inclusions,t.exclusions,t.restrictions,t.meeting_notes,s.cancellation_policy_version_id,s.status,s.version,c.code AS category,s.category_id,s.duration_minutes,s.cutoff_minutes,s.destination_id FROM app.services s JOIN app.service_translations t ON t.service_id=s.id AND t.locale='en' JOIN app.categories c ON c.id=s.category_id WHERE app.scope_allows($1,s.destination_id,NULL) ORDER BY t.title",scoped:true},
    departures:{permission:"operations.write",sql:"SELECT d.*,t.title FROM app.departures d JOIN app.service_variants v ON v.id=d.variant_id JOIN app.services s ON s.id=v.service_id JOIN app.service_translations t ON t.service_id=s.id AND t.locale='en' WHERE app.scope_allows($1,s.destination_id,NULL) ORDER BY starts_at LIMIT 200",scoped:true},
    apartments:{permission:"apartments.write",sql:"SELECT a.*,t.title,t.locale,t.slug,t.description,t.house_rules,a.default_rate::text AS nightly_amount,a.check_in_time::text AS check_in_time,a.check_out_time::text AS check_out_time,coalesce((SELECT jsonb_agg(amenity_id) FROM app.apartment_amenities WHERE apartment_id=a.id),'[]') AS amenity_ids,coalesce((SELECT sum(amount)::text FROM app.apartment_fee_rules WHERE apartment_id=a.id AND kind='cleaning'),'0') AS cleaning_fee_minor,p.name AS property_name FROM app.apartments a JOIN app.properties p ON p.id=a.property_id JOIN app.apartment_translations t ON t.apartment_id=a.id AND t.locale='en' WHERE app.scope_allows($1,p.destination_id,p.id) ORDER BY a.unit_code",scoped:true},
    resources:{permission:"operations.write",sql:"SELECT r.id,r.kind,r.code,r.name,r.mode,r.capacity,r.active,r.version,d.metadata FROM app.resources r LEFT JOIN app.resource_details d ON d.resource_id=r.id ORDER BY r.kind,r.name"},
    transport:{permission:"operations.write",sql:`SELECT i.id,t.pickup,t.dropoff,t.pickup_at,t.passengers,t.luggage,t.flight_number,i.fulfilment_state,b.reference FROM app.transfer_booking_items t JOIN app.booking_items i ON i.id=t.booking_item_id JOIN app.bookings b ON b.id=i.booking_id WHERE ${scopedBooking} ORDER BY t.pickup_at`,scoped:true},
    guests:{permission:"bookings.read",sql:`SELECT DISTINCT g.id,g.full_name,g.locale FROM app.guests g JOIN app.bookings b ON b.primary_guest_id=g.id WHERE ${scopedBooking} LIMIT 200`,scoped:true},
    payments:{permission:"finance.reconcile",sql:`SELECT l.id,l.booking_id,l.source,l.amount::text,l.currency,l.effective_at,l.transaction_id,l.offline_receipt_id,t.attempt_id FROM app.cash_ledger l JOIN app.bookings b ON b.id=l.booking_id LEFT JOIN app.payment_transactions t ON t.id=l.transaction_id WHERE ${scopedBooking} ORDER BY l.effective_at DESC LIMIT 200`,scoped:true},
    refunds:{permission:"finance.reconcile",sql:`SELECT r.id,r.booking_id,r.original_transaction_id,r.original_offline_receipt_id,r.amount::text,r.currency,r.status,r.reason,r.policy_calculation,r.version FROM app.refund_requests r JOIN app.bookings b ON b.id=r.booking_id WHERE ${scopedBooking} ORDER BY r.id DESC LIMIT 200`,scoped:true},
    "financial-exceptions":{permission:"finance.reconcile",sql:`SELECT f.id,f.booking_id,f.kind,f.state,f.version,f.created_at FROM app.financial_exceptions f JOIN app.bookings b ON b.id=f.booking_id WHERE ${scopedBooking} ORDER BY f.created_at DESC LIMIT 200`,scoped:true},
    galleries:{permission:"galleries.manage",sql:"SELECT g.id,g.title,g.kind,g.booking_id,g.visibility_state,g.expires_at,g.version FROM app.galleries g WHERE EXISTS(SELECT 1 FROM app.staff_roles sr JOIN app.roles r ON r.id=sr.role_id WHERE sr.staff_id=$1 AND r.code='owner') OR EXISTS(SELECT 1 FROM app.photographer_assignments pa WHERE pa.staff_id=$1 AND pa.booking_id=g.booking_id AND pa.revoked_at IS NULL AND pa.access_starts_at<=now() AND pa.access_ends_at>now()) OR (g.kind='public' AND app.scope_allows($1,g.destination_id,NULL)) ORDER BY g.created_at DESC",scoped:true},
    pages:{permission:"content.write",sql:"SELECT p.id,p.page_key,p.status,p.version,t.locale,t.title,t.slug,t.structured_body FROM app.cms_pages p LEFT JOIN app.cms_translations t ON t.page_id=p.id ORDER BY p.page_key,t.locale"},
    media:{permission:"media.upload",sql:"SELECT a.id,a.mime_type,a.state,a.size_bytes,a.created_at,a.version FROM app.media_assets a WHERE EXISTS(SELECT 1 FROM app.staff_roles sr JOIN app.roles r ON r.id=sr.role_id WHERE sr.staff_id=$1 AND r.code='owner') OR EXISTS(SELECT 1 FROM app.gallery_assets ga JOIN app.galleries g ON g.id=ga.gallery_id JOIN app.photographer_assignments pa ON pa.booking_id=g.booking_id WHERE ga.asset_id=a.id AND pa.staff_id=$1 AND pa.revoked_at IS NULL AND pa.access_starts_at<=now() AND pa.access_ends_at>now()) ORDER BY a.created_at DESC LIMIT 200",scoped:true},
    reviews:{permission:"reviews.moderate",sql:"SELECT id,rating,original_text,moderation_state,public_display_name,version FROM app.reviews ORDER BY submitted_at DESC LIMIT 200"},
    "notification-deliveries":{permission:"notifications.read",sql:`SELECT d.id,d.channel,d.provider,d.status,d.error_class,d.attempt,d.created_at,e.event_type,b.id AS booking_id,b.reference
      FROM app.notification_deliveries d JOIN app.jobs j ON j.id=d.job_id JOIN app.outbox_events e ON e.id=j.event_id
      LEFT JOIN app.bookings b ON b.id=CASE
        WHEN e.event_type='payment_received' THEN (SELECT booking_id FROM app.cash_ledger WHERE id=e.aggregate_id)
        WHEN e.event_type IN('refund_completed','refund_update','refund_approved') THEN (SELECT booking_id FROM app.refund_requests WHERE id=e.aggregate_id)
        WHEN e.event_type='gallery_ready' THEN (SELECT booking_id FROM app.galleries WHERE id=e.aggregate_id)
        WHEN e.event_type='review_invitation' THEN (SELECT bi.booking_id FROM app.review_invitations ri JOIN app.booking_items bi ON bi.id=ri.booking_item_id WHERE ri.id=e.aggregate_id)
        ELSE e.aggregate_id END AND app.has_permission($1,'bookings.read') AND ${scopedBooking}
      ORDER BY d.created_at DESC LIMIT 200`,scoped:true},
    jobs:{permission:"notifications.read",sql:"SELECT id,kind,status,attempts,run_after,lease_until,failure_class FROM app.jobs ORDER BY created_at DESC LIMIT 200"},
    staff:{permission:"staff.manage",sql:"SELECT id,name,active,revoked_at,mfa_required,version FROM app.staff_profiles ORDER BY name"},
    "audit-events":{permission:"audit.read",sql:"SELECT id,actor_type,action,target_type,target_id,summary,created_at FROM app.audit_events ORDER BY created_at DESC LIMIT 200"},
    settings:{permission:"staff.manage",sql:"SELECT display_name,legal_name,contact_channels,timezone,default_locale,default_currency,booking_enabled,content_approved_at,version FROM app.agency_settings"}
  };
  const entry=lists[resource];
  if(entry){const actor=await getStaff(request,entry.permission);const {rows}=await query(entry.sql,entry.scoped?[actor.id]:[]);return success({items:rows});}
  if(resource)throw new AppError("NOT_FOUND",404);
  return undefined;
}
