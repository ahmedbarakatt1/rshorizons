import {query} from "@/server/db";
import {AppError} from "@/server/http/errors";
import {localeSchema,uuidSchema} from "@/modules/bookings/contracts";
import {catalogFiltersSchema} from "./contracts";
import type {ApartmentDetail,ApartmentSummary,CatalogData,DestinationSummary,ServiceDetail,ServiceSummary} from "@/types/catalog";
import {illustrativeImage} from "@/components/catalog-imagery";

function isDemo() {
  return ["development","test"].includes(process.env.APP_ENV??"development")&&process.env.DEMO_MODE==="true";
}
// Only approved variants with an actual effective rate can advertise a price.
// The date expression is internal SQL, never supplied by a request.
const serviceSelect=(serviceDate="(now() AT TIME ZONE 'Africa/Cairo')::date")=>`
SELECT s.id,t.slug,t.title,t.summary,c.code AS category,dt.title AS destination,d.canonical_slug AS "destinationSlug",
s.duration_minutes AS "durationMinutes",
priced.amount::text AS "fromAmountMinor",priced.currency,
COALESCE((SELECT array_agg(DISTINCT p.type) FROM app.variant_payment_policies vp JOIN app.service_variants v ON v.id=vp.variant_id JOIN app.payment_policies p ON p.id=vp.policy_id WHERE v.service_id=s.id AND p.approved_at IS NOT NULL),'{}') AS "paymentPolicies"
FROM app.services s JOIN app.service_translations t ON t.service_id=s.id AND t.locale=$1
JOIN app.categories c ON c.id=s.category_id JOIN app.destinations d ON d.id=s.destination_id
JOIN app.destination_translations dt ON dt.destination_id=d.id AND dt.locale=$1
JOIN LATERAL (
 SELECT rate.amount,rate.currency FROM app.service_variants v
 JOIN app.variant_translations vt ON vt.variant_id=v.id AND vt.locale=$1 AND vt.approved_at IS NOT NULL
 JOIN LATERAL (SELECT r.amount,r.currency FROM app.price_rules r WHERE r.variant_id=v.id AND r.effective_range @> ${serviceDate}
 AND r.guest_category IN('adult','all') ORDER BY r.priority DESC,(r.guest_category='adult') DESC LIMIT 1) rate ON true
 WHERE v.service_id=s.id AND v.active
 ORDER BY rate.currency,rate.amount,v.id LIMIT 1
) priced ON true
WHERE s.status='published' AND t.approved_at IS NOT NULL AND dt.approved_at IS NOT NULL AND d.active
AND ($2::boolean OR NOT s.synthetic)`;
function serviceImage(category:string) {
  category=category.replaceAll("_","-");
  if(isDemo()&&["scuba-diving","shore-dives","snorkeling","photography","tours"].includes(category))
    return `/api/v1/demo-media/${category==="photography"?"diving":"reef"}`;
  if(category==="beach-buggy")return illustrativeImage("buggy");
  if(category==="desert-safari")return illustrativeImage("desert");
  if(category==="boat-tours")return illustrativeImage("boat");
  if(category==="transportation")return illustrativeImage("transfer");
  return illustrativeImage("coast");
}
export async function searchServices(filters:unknown,locale="en") {
  const f=catalogFiltersSchema.parse({...filters as object,locale});
  const {rows}=await query<ServiceSummary>(`${serviceSelect("coalesce($5::date,(now() AT TIME ZONE 'Africa/Cairo')::date)")}
 AND ($3::text IS NULL OR d.canonical_slug=$3) AND ($4::text IS NULL OR replace(c.code,'_','-')=replace($4,'_','-'))
 AND ($5::date IS NULL OR EXISTS(SELECT 1 FROM app.departures dp JOIN app.service_variants v ON v.id=dp.variant_id WHERE v.service_id=s.id AND (dp.starts_at AT TIME ZONE 'Africa/Cairo')::date=$5 AND dp.status='scheduled' AND dp.cutoff_at>now()
 AND dp.seat_capacity-COALESCE((SELECT sum(ca.seats) FROM app.capacity_allocations ca WHERE ca.departure_id=dp.id AND ca.state<>'released'),0)>=COALESCE($6,1)))
 AND ($7::text IS NULL OR s.id::text>$7) ORDER BY s.id LIMIT 25`,
  [f.locale,isDemo(),f.destination??null,f.category??null,f.date??null,f.guests??null,f.cursor??null]);
  return {items:rows.map(row=>({...row,image:serviceImage(row.category)})),nextCursor:rows.length===25?rows.at(-1)!.id:null};
}
export async function getDestinations(locale:string):Promise<DestinationSummary[]> {
  localeSchema.parse(locale);
  const {rows}=await query<DestinationSummary>(`SELECT d.id,d.canonical_slug AS slug,t.title,t.description AS summary FROM app.destinations d JOIN app.destination_translations t ON t.destination_id=d.id AND t.locale=$1 WHERE d.active AND t.approved_at IS NOT NULL ORDER BY d.canonical_slug`,[locale]);
  return rows.map((row,index)=>({...row,image:isDemo()&&index<2?`/api/v1/demo-media/${index?"diving":"hero"}`:illustrativeImage("coast")}));
}
export async function getService(idOrSlug:string,locale:string):Promise<ServiceDetail> {
  localeSchema.parse(locale);
  const {rows}=await query<ServiceSummary>(`${serviceSelect()} AND (s.id::text=$3 OR t.slug=$3)`,[locale,isDemo(),idOrSlug]);
  const row=rows[0];
  if(!row) throw new AppError("NOT_FOUND",404);
  const [variants,departures,content,addons,pickups]=await Promise.all([
    query<{id:string;title:string;priceAmountMinor:string;currency:string;pricingUnit:string;capacityModel:string}>(`SELECT v.id,vt.title,v.pricing_unit AS "pricingUnit",v.capacity_model AS "capacityModel",r.amount::text AS "priceAmountMinor",r.currency FROM app.service_variants v JOIN app.variant_translations vt ON vt.variant_id=v.id AND vt.locale=$2 JOIN LATERAL (SELECT amount,currency FROM app.price_rules pr WHERE pr.variant_id=v.id AND pr.effective_range @> (now() AT TIME ZONE 'Africa/Cairo')::date AND pr.guest_category IN('adult','all') ORDER BY pr.priority DESC,(pr.guest_category='adult') DESC LIMIT 1) r ON true WHERE v.service_id=$1 AND v.active AND vt.approved_at IS NOT NULL ORDER BY vt.title`,[row.id,locale]),
    getDepartures(row.id),
    query(`SELECT itinerary,inclusions,exclusions,restrictions,meeting_notes FROM app.service_translations WHERE service_id=$1 AND locale=$2`,[row.id,locale]),
    query<{variantId:string;title:string;minQuantity:number;maxQuantity:number}>(`SELECT a.addon_variant_id AS "variantId",t.title,a.min_quantity AS "minQuantity",a.max_quantity AS "maxQuantity" FROM app.service_addons a JOIN app.variant_translations t ON t.variant_id=a.addon_variant_id AND t.locale=$2 WHERE a.parent_service_id=$1 AND a.active AND t.approved_at IS NOT NULL`,[row.id,locale]),
    query(`SELECT p.id,v.id AS "variantId",p.name AS title,p.address,vp.surcharge::text AS "surchargeAmountMinor",vp.currency FROM app.variant_pickups vp JOIN app.pickup_locations p ON p.id=vp.pickup_id JOIN app.service_variants v ON v.id=vp.variant_id WHERE v.service_id=$1 AND v.active AND p.active ORDER BY p.name`,[row.id])
  ]);
  return {...row,image:serviceImage(row.category),variants:variants.rows,departures,...content.rows[0],meetingNotes:content.rows[0]?.meeting_notes??"",addons:addons.rows,pickupOptions:pickups.rows} as ServiceDetail;
}
export async function getDepartures(serviceId:string,from?:string,to?:string,guests=1) {
  uuidSchema.parse(serviceId);
  const {rows}=await query<{id:string;startsAt:string;endsAt:string;availableSeats:number;variantId:string}>(`SELECT d.id,d.variant_id AS "variantId",d.starts_at AS "startsAt",d.ends_at AS "endsAt",(d.seat_capacity-COALESCE(sum(a.seats) FILTER(WHERE a.state<>'released'),0))::integer AS "availableSeats" FROM app.departures d JOIN app.service_variants v ON v.id=d.variant_id LEFT JOIN app.capacity_allocations a ON a.departure_id=d.id WHERE v.service_id=$1 AND d.status='scheduled' AND d.cutoff_at>now() AND ($2::date IS NULL OR d.starts_at>=($2::date::timestamp AT TIME ZONE 'Africa/Cairo')) AND ($3::date IS NULL OR d.starts_at<(($3::date+1)::timestamp AT TIME ZONE 'Africa/Cairo')) GROUP BY d.id HAVING d.seat_capacity-COALESCE(sum(a.seats) FILTER(WHERE a.state<>'released'),0)>=$4 ORDER BY d.starts_at LIMIT 90`,[serviceId,from??null,to??null,guests]);
  return rows;
}
const apartmentSelect=`SELECT a.id,t.slug,t.title,t.description AS summary,a.unit_code AS "unitCode",a.max_guests AS "maxGuests",a.bedrooms,a.beds,a.bathrooms::float8 AS bathrooms,a.default_rate::text AS "nightlyAmountMinor",a.currency,COALESCE((SELECT sum(amount)::text FROM app.apartment_fee_rules WHERE apartment_id=a.id AND kind='cleaning'),'0') AS "cleaningFeeMinor",COALESCE((SELECT array_agg(mt.label) FROM app.apartment_amenities am JOIN app.amenity_translations mt ON mt.amenity_id=am.amenity_id AND mt.locale=$1 WHERE am.apartment_id=a.id),'{}') AS amenities FROM app.apartments a JOIN app.apartment_translations t ON t.apartment_id=a.id AND t.locale=$1 JOIN app.properties p ON p.id=a.property_id WHERE a.status='active' AND p.active AND t.approved_at IS NOT NULL AND ($2::boolean OR NOT a.synthetic)`;
export async function searchApartments(filters:{checkIn?:string;checkOut?:string;guests?:number}={},locale="en"):Promise<ApartmentSummary[]> {
  localeSchema.parse(locale);
  const {rows}=await query<ApartmentSummary>(`${apartmentSelect} AND a.max_guests>=COALESCE($3,1) AND ($4::date IS NULL OR $5::date IS NULL OR NOT EXISTS(SELECT 1 FROM app.apartment_inventory ai WHERE ai.apartment_id=a.id AND ai.released_at IS NULL AND ai.date_range && daterange($4::date,$5::date+a.cleaning_buffer_days,'[)'))) ORDER BY a.unit_code`,[locale,isDemo(),filters.guests??null,filters.checkIn??null,filters.checkOut??null]);
  return rows.map(row=>({...row,image:illustrativeImage("apartment")}));
}
export async function getApartment(idOrSlug:string,locale:string):Promise<ApartmentDetail> {
  localeSchema.parse(locale);
  const {rows}=await query<ApartmentSummary>(`${apartmentSelect} AND (a.id::text=$3 OR t.slug=$3)`,[locale,isDemo(),idOrSlug]);
  if(!rows[0]) throw new AppError("NOT_FOUND",404);
  const {rows:details}=await query(`SELECT t.house_rules AS "houseRules",a.check_in_time AS "checkInTime",a.check_out_time AS "checkOutTime",a.min_nights AS "minNights",COALESCE((SELECT array_agg(p.type) FROM app.apartment_payment_policies ap JOIN app.payment_policies p ON p.id=ap.policy_id WHERE ap.apartment_id=a.id AND p.approved_at IS NOT NULL),'{}') AS "paymentPolicies" FROM app.apartments a JOIN app.apartment_translations t ON t.apartment_id=a.id AND t.locale=$2 WHERE a.id=$1`,[rows[0].id,locale]);
  return {...rows[0],...details[0],image:illustrativeImage("apartment")} as ApartmentDetail;
}
export async function getCatalog(locale:string):Promise<CatalogData> {
  const [services,apartments,destinations]=await Promise.all([searchServices({},locale),searchApartments({},locale),getDestinations(locale)]);
  return {services:services.items,apartments,destinations,demo:isDemo()};
}
