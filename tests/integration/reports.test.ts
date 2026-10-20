import {afterAll,beforeAll,expect,test} from "vitest";
import {route} from "@/server/api/router";
import {newSecret,digestSecret} from "@/server/security";
import {admin,makeActor,makeBooking,makeDeparture,tourItem} from "../database/helpers";
import {randomUUID} from "node:crypto";
const db=admin();let cookie:string;
const base="http://127.0.0.1:3000";
async function report(path:string,session=cookie){
 const response=await route(new Request(`${base}/api/v1/admin/reports/${path}`,{headers:{cookie:session}}),["admin","reports",path.split("?")[0]]);
 return {status:response.status,body:await response.json()};
}
beforeAll(async()=>{await db.connect();const actor=await makeActor(db),token=newSecret();cookie=`rsh_local_staff=${token}`;await db.query("INSERT INTO app.local_operator_sessions(staff_id,token_hash,expires_at,redeemed_at) VALUES($1,$2,now()+interval '1 hour',now())",[actor,digestSecret(token)]);});
afterAll(()=>db.end());
test("finance_report_separates_period_cash_refunds_receivables_and_customer_liability",async()=>{
 const departure=await makeDeparture(db,5),{booking}=await makeBooking(db,[await tourItem(db,departure.id)]);
 let currency="";
 while(!currency){const candidate=Array.from({length:3},()=>String.fromCharCode(65+Math.floor(Math.random()*26))).join("");if((await db.query("INSERT INTO app.currencies(code,exponent) VALUES($1,2) ON CONFLICT DO NOTHING RETURNING code",[candidate])).rowCount)currency=candidate;}
 // A historical synthetic account isolates report arithmetic from other suites.
 await db.query("SELECT app.approve_booking($1,1,$2)",[booking.id,await makeActor(db)]);
 await db.query("UPDATE app.bookings SET currency=$2,created_at='2035-03-05T10:00:00Z' WHERE id=$1",[booking.id,currency]);
 for(const [source,amount] of [["offline",40000],["refund",-5000]] as const)await db.query("INSERT INTO app.cash_ledger(booking_id,source,amount,currency,effect_key,effective_at) VALUES($1,$2,$3,$5,$4,'2035-03-06T12:00:00Z')",[booking.id,source,amount,randomUUID(),currency]);
 const result=await report(`finance?from=2035-03-01&to=2035-03-31&currency=${currency}`);
 expect(result.status).toBe(200);
 const row=result.body.data.items[0];expect(row.cash_collected).toBe("40000");expect(row.refunds_paid).toBe("5000");expect(row.net_cash).toBe("35000");expect(BigInt(row.receivables)).toBeGreaterThanOrEqual(65000n);
 expect(result.body.data.basis).toContain("Africa/Cairo");
 expect((await report(`finance?from=2035-04-01&to=2035-04-02&currency=${currency}`)).body.data.items[0].net_cash).toBe("0");
 await db.query("UPDATE app.bookings SET status='cancelled' WHERE id=$1",[booking.id]);
 expect(BigInt((await report(`finance?from=2035-03-01&to=2035-03-31&currency=${currency}`)).body.data.items[0].customer_liability)).toBeGreaterThanOrEqual(35000n);
});
test("report_filters_validate_dates_and_operations_roles_cannot_read_financial_totals",async()=>{
 expect((await report("finance?from=2035-02-30")).status).toBe(400);
 expect((await report("bookings?from=2035-03-31&to=2035-03-01")).status).toBe(400);
 const actor=await makeActor(db,"operations"),token=newSecret();await db.query("INSERT INTO app.local_operator_sessions(staff_id,token_hash,expires_at,redeemed_at) VALUES($1,$2,now()+interval '1 hour',now())",[actor,digestSecret(token)]);
 // Explicit report grant does not also grant finance.
 await db.query("INSERT INTO app.staff_permission_grants(staff_id,permission_id) SELECT $1,id FROM app.permissions WHERE code='reports.read' ON CONFLICT DO NOTHING",[actor]);
 const session=`rsh_local_staff=${token}`,result=await report("bookings",session);
 expect(result.status).toBe(200);expect(result.body.data.items.every((row:Record<string,unknown>)=>!("operational_sales" in row))).toBe(true);
 expect((await report("finance",session)).status).toBe(403);
});
