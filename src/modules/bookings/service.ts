import {query,withTransaction,type ActorContext} from "@/server/db";
import {AppError} from "@/server/http/errors";
import {readEnvironment} from "@/server/env";
import {bookingInputSchema,quoteInputSchema,type QuoteInput,type BookingInput} from "./contracts";

async function bookingIntake() {
  const target=process.env.APP_ENV??"development";
  if(!["development","test","staging","production"].includes(target))throw new AppError("CONFIGURATION_ERROR",503);
  const env=readEnvironment(target as "development"|"test"|"staging"|"production");
  if(!env.bookingEnabled)throw new AppError("BOOKING_CLOSED",503,"Reservation requests are currently closed.");
  if(!env.demo){
    const {rows}=await query("SELECT booking_enabled,content_approved_at FROM app.agency_settings WHERE id");
    if(!rows[0]?.booking_enabled||!rows[0].content_approved_at)throw new AppError("BOOKING_CLOSED",503,"Reservation requests are currently closed.");
  }
}
export async function createQuote(input:QuoteInput,bindingHash:string) {
  await bookingIntake();
  const parsed=quoteInputSchema.parse(input);
  const items:Record<string,unknown>[]=[];
  for(const item of parsed.items) {
    const position=items.length;
    if(item.kind==="tour") {
      const {addons,...tour}=item;items.push(tour);
      for(const addon of addons??[])items.push({kind:"addon",...addon,parentPosition:position,departureId:item.departureId});
    } else items.push(item);
  }
  const {rows}=await query<{quote:{id:string}}>("SELECT app.create_quote($1::jsonb) AS quote",[JSON.stringify({...parsed,items,bindingHash})]);
  const id=rows[0].quote.id;
  const [quote,itemRows]=await Promise.all([
    query(`SELECT q.id,q.total::text AS "totalAmountMinor",q.initial_due::text AS "initialDueAmountMinor",q.subtotal::text AS "subtotalAmountMinor",q.fees::text AS "feesAmountMinor",q.currency,q.valid_until AS "validUntil",q.policy_snapshot AS "policySnapshot",p.type AS "paymentPolicy" FROM app.quotes q JOIN app.payment_policies p ON p.id=q.payment_policy_id WHERE q.id=$1`,[id]),
    query(`SELECT id,kind,title,quantity,total::text AS "amountMinor",initial_due::text AS "initialDueAmountMinor",snapshot FROM app.quote_items WHERE quote_id=$1 ORDER BY position`,[id])
  ]);
  const terms=quote.rows[0].policySnapshot.termsVersion;
  const privacy=quote.rows[0].policySnapshot.privacyNoticeVersion;
  if(!terms||!privacy)throw new AppError("POLICIES_UNAVAILABLE",503);
  return {...quote.rows[0],items:itemRows.rows,policyVersions:{terms,privacy},allowedPolicies:[parsed.paymentPolicy]};
}
export async function submitBooking(input:BookingInput,key:string,bindingHash:string) {
  await bookingIntake();
  const parsed=bookingInputSchema.parse(input);
  const {rows}=await query<{booking:{id:string;reference:string;status:string}}>("SELECT app.submit_booking($1::jsonb) AS booking",[JSON.stringify({...parsed,idempotencyKey:key,bindingHash})]);
  return rows[0].booking;
}
export async function bookingDetails(id:string,includeContact=false) {
  const {rows}=await query<{id:string;reference:string;status:string;version:number;currency:string;totalAmountMinor:string;initialDueAmountMinor:string;paymentDeadline:Date|null;approvedAt:Date|null;createdAt:Date;fullName:string;email:string|null;phoneE164:string|null;locale:string;paidAmountMinor:string}>(`SELECT b.id,b.reference,b.status,b.version,b.currency,b.total_amount::text AS "totalAmountMinor",b.initial_due_amount::text AS "initialDueAmountMinor",b.payment_deadline AS "paymentDeadline",b.approved_at AS "approvedAt",b.created_at AS "createdAt",g.full_name AS "fullName",g.email,g.phone_e164 AS "phoneE164",g.locale,
  COALESCE((SELECT sum(amount)::text FROM app.cash_ledger WHERE booking_id=b.id),'0') AS "paidAmountMinor" FROM app.bookings b JOIN app.guests g ON g.id=b.primary_guest_id WHERE b.id=$1`,[id]);
  if(!rows[0])throw new AppError("NOT_FOUND",404);
  const [items,timeline,obligations,payments,requests,pickups,revisions,galleries]=await Promise.all([
    query(`SELECT i.id,i.kind,i.title_snapshot AS title,i.quantity,i.total_amount::text AS "totalAmountMinor",i.fulfilment_state AS "fulfilmentState",q.snapshot AS details FROM app.booking_items i JOIN app.quote_items q ON q.id=i.quote_item_id WHERE booking_id=$1 AND i.superseded_at IS NULL ORDER BY q.position`,[id]),
    query(`SELECT event_type AS type,created_at AS at FROM app.booking_events WHERE booking_id=$1 ORDER BY created_at`,[id]),
    query(`SELECT id,kind,amount::text AS "amountMinor",currency,due_at AS "dueAt",status FROM app.payment_obligations WHERE booking_id=$1 ORDER BY kind`,[id]),
    query(`SELECT id,source,amount::text AS "amountMinor",currency,effective_at AS at FROM app.cash_ledger WHERE booking_id=$1 ORDER BY effective_at`,[id]),
    query(`SELECT id,type,status,proposed_changes AS "proposedChanges",created_at AS "createdAt" FROM app.booking_requests WHERE booking_id=$1 ORDER BY created_at`,[id]),
    query(`SELECT p.address_snapshot AS address,p.pickup_at AS "pickupAt",p.instructions FROM app.pickup_assignments p JOIN app.booking_items i ON i.id=p.booking_item_id WHERE i.booking_id=$1 AND i.superseded_at IS NULL`,[id]),
    query(`SELECT r.id,r.status,q.total::text AS "totalAmountMinor",q.currency,q.policy_snapshot AS policies,q.valid_until AS "validUntil",r.source_version AS "sourceVersion" FROM app.booking_revisions r JOIN app.quotes q ON q.id=r.quote_id WHERE r.booking_id=$1 ORDER BY r.created_at`,[id]),
    query(`SELECT g.id,g.title FROM app.galleries g WHERE g.booking_id=$1 AND g.kind='private' AND g.visibility_state='published' AND (g.expires_at IS NULL OR g.expires_at>now()) AND EXISTS(SELECT 1 FROM app.gallery_entitlements e WHERE e.gallery_id=g.id AND e.revoked_at IS NULL AND (e.expires_at IS NULL OR e.expires_at>now()))`,[id])
  ]);
  const {fullName,email,phoneE164,locale,...booking}=rows[0];
  return {...booking,balanceAmountMinor:(BigInt(booking.totalAmountMinor)-BigInt(booking.paidAmountMinor)).toString(),
    guest:{fullName,...includeContact?{email,phoneE164}:{},locale},items:items.rows,timeline:timeline.rows,obligations:obligations.rows,payments:payments.rows,requests:requests.rows,pickups:pickups.rows,revisions:revisions.rows,galleries:galleries.rows};
}
export async function createBookingRequest(actor:ActorContext,bookingId:string,type:"change"|"cancel",reason:string,proposedChanges:unknown={}) {
  return withTransaction(actor,async tx=>{
    const {rows}=await tx.query("SELECT app.create_booking_request($1,$2,$3,$4) AS request",[bookingId,type,JSON.stringify(proposedChanges),reason]);
    return rows[0].request;
  });
}
export async function approveBooking(id:string,expectedVersion:number,actor:ActorContext) {
  const {rows}=await query("SELECT app.approve_booking($1,$2,$3) AS booking",[id,expectedVersion,actor.id]);
  return rows[0].booking;
}
export async function decideBooking(id:string,expectedVersion:number,actor:ActorContext,action:"reject"|"cancel",reason:string) {
  const {rows}=await query("SELECT app.decide_booking($1,$2,$3,$4,$5) AS booking",[id,expectedVersion,actor.id,action,reason]);
  return rows[0].booking;
}
