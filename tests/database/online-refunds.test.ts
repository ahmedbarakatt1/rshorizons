import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,expect,test} from "vitest";
import {admin,makeActor,makeBooking,makeDeparture,makeAttempt,paymentEvent,tourItem,race} from "./helpers";
const db=admin();beforeAll(()=>db.connect());afterAll(()=>db.end());
async function approvedRefund(amount=10000){
 const actor=await makeActor(db),d=await makeDeparture(db),{booking}=await makeBooking(db,[await tourItem(db,d.id)],"deposit");
 await db.query("SELECT app.approve_booking($1,1,$2)",[booking.id,actor]);
 const attempt=await makeAttempt(db,booking.id,30000);
 const event=paymentEvent(attempt.id,30000);
 await db.query("SELECT app.apply_payment_event($1)",[JSON.stringify(event)]);
 const transaction=(await db.query("SELECT id FROM app.payment_transactions WHERE attempt_id=$1",[attempt.id])).rows[0].id;
 const refund=(await db.query("SELECT app.request_refund($1,$2,NULL,$3,'Synthetic refund','{}',$4) r",[booking.id,transaction,amount,actor])).rows[0].r;
 await db.query("SELECT app.approve_refund($1,1,$2)",[refund.id,actor]);
 return {actor,booking,refund,transaction,event};
}
test("online_refund_claim_is_one_external_action",async()=>{
 const {actor,booking,refund}=await approvedRefund();
 const claims=await race(db,"SELECT id FROM app.bookings WHERE id=$1 FOR UPDATE",[booking.id],[c=>c.query("SELECT app.claim_online_refund($1,2,$2) r",[refund.id,actor]),c=>c.query("SELECT app.claim_online_refund($1,2,$2) r",[refund.id,actor])]);
 expect(claims.filter(x=>x.status==="fulfilled")).toHaveLength(1);
 expect(claims.filter(x=>x.status==="rejected")).toHaveLength(1);
 expect((await db.query("SELECT count(*)::int n FROM app.refund_attempts WHERE refund_request_id=$1",[refund.id])).rows[0].n).toBe(1);
});
test("online_refund_completion_is_semantically_idempotent",async()=>{
 const {actor,booking,refund,transaction}=await approvedRefund(),providerId=randomUUID();
 const attempt=(await db.query("SELECT app.claim_online_refund($1,2,$2) r",[refund.id,actor])).rows[0].r;
 expect(attempt.amount).toBe("10000");expect(attempt.original_transaction_id).toBe(transaction);
 await db.query("SELECT app.save_online_refund_reference($1,$2)",[attempt.id,providerId]);
 await db.query("SELECT app.complete_online_refund($1,$2)",[attempt.id,providerId]);
 await db.query("SELECT app.complete_online_refund($1,$2)",[attempt.id,providerId]);
 expect((await db.query("SELECT sum(amount)::text amount,count(*) FILTER(WHERE source='refund')::int refunds FROM app.cash_ledger WHERE booking_id=$1",[booking.id])).rows[0]).toEqual({amount:"20000",refunds:1});
 await expect(db.query("SELECT app.complete_online_refund($1,$2)",[attempt.id,randomUUID()])).rejects.toThrow("REFUND_CORRELATION_MISMATCH");
});
test("unknown_online_refund_blocks_other_refunds_on_original_receipt",async()=>{
 const {actor,booking,refund,transaction}=await approvedRefund();
 const first=(await db.query("SELECT app.claim_online_refund($1,2,$2) r",[refund.id,actor])).rows[0].r;
 await db.query("SELECT app.save_online_refund_reference($1,NULL)",[first.id]);
 const second=(await db.query("SELECT app.request_refund($1,$2,NULL,5000,'Second refund','{}',$3) r",[booking.id,transaction,actor])).rows[0].r;
 await db.query("SELECT app.approve_refund($1,1,$2)",[second.id,actor]);
 await expect(db.query("SELECT app.claim_online_refund($1,2,$2)",[second.id,actor])).rejects.toThrow("ORIGINAL_REFUND_OUTCOME_PENDING");
 expect((await db.query("SELECT count(*)::int n FROM app.financial_exceptions WHERE booking_id=$1 AND state='open'",[booking.id])).rows[0].n).toBeGreaterThan(0);
});
test("refund_completion_rechecks_original_receipt_after_reversal",async()=>{
 const {actor,refund,event}=await approvedRefund(25000);
 const attempt=(await db.query("SELECT app.claim_online_refund($1,2,$2) r",[refund.id,actor])).rows[0].r;
 await db.query("SELECT app.apply_payment_event($1)",[JSON.stringify({...event,eventKey:randomUUID(),effectKey:randomUUID(),kind:"reversed",amountMinor:"10000"})]);
 await expect(db.query("SELECT app.complete_online_refund($1,$2)",[attempt.id,randomUUID()])).rejects.toThrow("REFUND_EXCEEDS_RECEIPT");
});
test("refund_callback_then_reconciliation_records_one_effect",async()=>{
 const {actor,refund,event,booking}=await approvedRefund(),providerId=randomUUID();
 const attempt=(await db.query("SELECT app.claim_online_refund($1,2,$2) r",[refund.id,actor])).rows[0].r;
 await db.query("SELECT app.apply_payment_event($1)",[JSON.stringify({...event,eventKey:randomUUID(),effectKey:providerId,kind:"refunded",amountMinor:"10000"})]);
 await db.query("SELECT app.complete_online_refund($1,$2)",[attempt.id,providerId]);
 expect((await db.query("SELECT count(*)::int n FROM app.cash_ledger WHERE booking_id=$1 AND source='refund'",[booking.id])).rows[0].n).toBe(1);
 expect((await db.query("SELECT status FROM app.refund_requests WHERE id=$1",[refund.id])).rows[0].status).toBe("succeeded");
});
