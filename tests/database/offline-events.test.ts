import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,expect,test} from "vitest";
import {admin,makeActor,makeBooking,makeDeparture,tourItem} from "./helpers";
const db=admin();beforeAll(()=>db.connect());afterAll(()=>db.end());
test("offline_receipt_emits_payment_received_exactly_once",async()=>{
 const actor=await makeActor(db),d=await makeDeparture(db),{booking}=await makeBooking(db,[await tourItem(db,d.id)]),key=randomUUID();
 await db.query("SELECT app.approve_booking($1,1,$2)",[booking.id,actor]);
 for(let i=0;i<2;i++)await db.query("SELECT app.record_offline_receipt($1,10000,'EGP','cash','Synthetic',$2,$3)",[booking.id,key,actor]);
 const events=await db.query("SELECT event_type,payload FROM app.outbox_events WHERE event_type='payment_received' AND payload->>'bookingId'=$1",[booking.id]);
 expect(events.rows).toHaveLength(1);expect(events.rows[0].payload.bookingId).toBe(booking.id);
 expect((await db.query("SELECT count(*)::int n FROM app.cash_ledger WHERE booking_id=$1",[booking.id])).rows[0].n).toBe(1);
});
test("offline_refund_emits_refund_completed_exactly_once",async()=>{
 const actor=await makeActor(db),d=await makeDeparture(db),{booking}=await makeBooking(db,[await tourItem(db,d.id)]);
 await db.query("SELECT app.approve_booking($1,1,$2)",[booking.id,actor]);
 const receipt=(await db.query("SELECT app.record_offline_receipt($1,10000,'EGP','cash','Synthetic',$2,$3) r",[booking.id,randomUUID(),actor])).rows[0].r;
 const refund=(await db.query("SELECT app.request_refund($1,NULL,$2,5000,'Synthetic decision',$3,$4) r",[booking.id,receipt.id,JSON.stringify({policySnapshot:booking.policy_snapshot,reason:"Synthetic decision"}),actor])).rows[0].r;
 await db.query("SELECT app.approve_refund($1,1,$2)",[refund.id,actor]);
 for(let i=0;i<2;i++)await db.query("SELECT app.complete_offline_refund($1,$2,$3)",[refund.id,randomUUID(),actor]);
 const events=await db.query("SELECT event_type,payload FROM app.outbox_events WHERE event_type='refund_completed' AND aggregate_id=$1",[refund.id]);
 expect(events.rows).toHaveLength(1);expect(events.rows[0].payload.bookingId).toBe(booking.id);
 expect((await db.query("SELECT count(*)::int n FROM app.cash_ledger WHERE refund_request_id=$1",[refund.id])).rows[0].n).toBe(1);
});
