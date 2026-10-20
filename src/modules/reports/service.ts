import {z} from "zod";
import {query} from "@/server/db";
import {getStaff} from "@/server/auth";
import {dateSchema} from "@/modules/bookings/contracts";
import {AppError} from "@/server/http/errors";
const filters=z.object({from:dateSchema.optional(),to:dateSchema.optional(),currency:z.string().regex(/^[A-Z]{3}$/).optional()})
 .refine(v=>!v.from||!v.to||v.to>=v.from,"End date must follow start date");
const scoped=`NOT EXISTS(SELECT 1 FROM app.booking_items bi JOIN app.quote_items qi ON qi.id=bi.quote_item_id LEFT JOIN app.service_variants v ON v.id=qi.variant_id LEFT JOIN app.services sv ON sv.id=v.service_id LEFT JOIN app.apartments ap ON ap.id=qi.apartment_id LEFT JOIN app.properties pr ON pr.id=ap.property_id WHERE bi.booking_id=b.id AND bi.superseded_at IS NULL AND NOT app.scope_allows($1,coalesce(sv.destination_id,pr.destination_id),pr.id))`;
const from=`($2::date::timestamp AT TIME ZONE 'Africa/Cairo')`,until=`(($3::date+1)::timestamp AT TIME ZONE 'Africa/Cairo')`;
export async function readReport(request:Request,kind:string){
 const actor=await getStaff(request,"reports.read"),params=new URL(request.url).searchParams;
 const input=filters.parse(Object.fromEntries(["from","to","currency"].filter(key=>params.has(key)).map(key=>[key,params.get(key)])));
 const values=[actor.id,input.from??null,input.to??null,input.currency??null];
 if(kind==="finance"){
  await getStaff(request,"finance.reconcile");
  const {rows}=await query(`WITH scoped_bookings AS (
    SELECT b.* FROM app.bookings b WHERE ${scoped} AND ($4::text IS NULL OR b.currency=$4)
   ), period_cash AS (
    SELECT l.currency,coalesce(sum(l.amount) FILTER(WHERE l.amount>0),0) AS received,
     -coalesce(sum(l.amount) FILTER(WHERE l.source='refund'),0) AS refunded,
     -coalesce(sum(l.amount) FILTER(WHERE l.source IN('chargeback','reversal')),0) AS reversals,
     coalesce(sum(l.amount),0) AS net,count(*)::int AS entries
    FROM app.cash_ledger l JOIN scoped_bookings b ON b.id=l.booking_id
    WHERE ($2::date IS NULL OR l.effective_at>=${from}) AND ($3::date IS NULL OR l.effective_at<${until}) GROUP BY l.currency
   ), balances AS (
    SELECT b.currency,b.status,b.total_amount,coalesce((SELECT sum(l.amount) FROM app.cash_ledger l WHERE l.booking_id=b.id AND ($3::date IS NULL OR l.effective_at<${until})),0) AS paid
    FROM scoped_bookings b WHERE $3::date IS NULL OR b.created_at<${until}
   ), totals AS (
    SELECT currency,
     coalesce(sum(greatest(total_amount-paid,0)) FILTER(WHERE status IN('approved_pending_payment','confirmed','completed')),0) AS receivables,
     coalesce(sum(CASE WHEN status IN('expired','cancelled','rejected') THEN greatest(paid,0) ELSE greatest(paid-total_amount,0) END),0) AS customer_liability
    FROM balances GROUP BY currency
   ), currencies AS (SELECT currency FROM totals UNION SELECT currency FROM period_cash)
   SELECT c.currency,coalesce(p.received,0)::text AS cash_collected,coalesce(p.refunded,0)::text AS refunds_paid,coalesce(p.reversals,0)::text AS chargebacks_and_reversals,coalesce(p.net,0)::text AS net_cash,coalesce(p.entries,0)::int AS ledger_entries,coalesce(t.receivables,0)::text AS receivables,coalesce(t.customer_liability,0)::text AS customer_liability
   FROM currencies c LEFT JOIN period_cash p USING(currency) LEFT JOIN totals t USING(currency) ORDER BY c.currency`,values);
  return {items:rows,filters:input,basis:"Cash by effective date in Africa/Cairo, through the inclusive end date. Receivables and customer liability use current booking state and cash through the end date; this is an operational report, not historical revenue recognition or a tax statement."};
 }
 if(kind==="occupancy"){
  const {rows}=await query(`SELECT a.unit_code,i.kind,i.date_range::text FROM app.apartment_inventory i JOIN app.apartments a ON a.id=i.apartment_id JOIN app.properties p ON p.id=a.property_id WHERE i.released_at IS NULL AND app.scope_allows($1,p.destination_id,p.id) AND ($2::date IS NULL OR upper(i.date_range)>$2) AND ($3::date IS NULL OR lower(i.date_range)<$3::date+1) AND ($4::text IS NULL OR a.currency=$4) ORDER BY a.unit_code,lower(i.date_range)`,values);
  return {items:rows,filters:input,basis:"Active inventory overlapping the date range; checkout is excluded."};
 }
 if(kind!=="bookings")throw new AppError("NOT_FOUND",404);
 const canFinance=(await query("SELECT app.has_permission($1,'finance.reconcile') allowed",[actor.id])).rows[0].allowed;
 const {rows}=await query(`SELECT b.status,b.currency,count(*)::int AS reservations${canFinance?",sum(b.total_amount)::text AS operational_sales":""} FROM app.bookings b WHERE ${scoped} AND ($2::date IS NULL OR b.created_at>=${from}) AND ($3::date IS NULL OR b.created_at<${until}) AND ($4::text IS NULL OR b.currency=$4) GROUP BY b.status,b.currency ORDER BY b.status,b.currency`,values);
 return {items:rows,filters:input,basis:"Requests by creation date in Africa/Cairo. Operational totals are not cash collected or recognized revenue."};
}
