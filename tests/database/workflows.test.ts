import {beforeAll,afterAll,expect,test} from "vitest";
import {admin,runtime,makeActor,makeDeparture,makeApartment,makeBooking,tourItem,stayItem,makeAttempt,paymentEvent} from "./helpers";
const db=admin();
beforeAll(()=>db.connect());afterAll(()=>db.end());
test("request_does_not_confirm",async()=>{
 const d=await makeDeparture(db),{booking,quote}=await makeBooking(db,[await tourItem(db,d.id)],"deposit");
 expect(booking.status).toBe("pending_review");expect(quote.total).toBe("100000");expect(quote.initial_due).toBe("30000");
 expect((await db.query("SELECT count(*)::int n FROM app.capacity_allocations c JOIN app.booking_items i ON i.id=c.booking_item_id WHERE i.booking_id=$1",[booking.id])).rows[0].n).toBe(0);
 await expect(db.query("SELECT app.create_payment_attempt($1,gen_random_uuid(),'test-before-approval','local','local')",[booking.id])).rejects.toThrow("PAYMENT_NOT_ELIGIBLE");
});
test("duplicate_request_is_idempotent",async()=>{
 const d=await makeDeparture(db),{booking,input}=await makeBooking(db,[await tourItem(db,d.id)]);
 const again=(await db.query("SELECT app.submit_booking($1::jsonb) b",[JSON.stringify(input)])).rows[0].b;
 expect(again.id).toBe(booking.id);
 expect((await db.query("SELECT count(*)::int n FROM app.outbox_events WHERE aggregate_id=$1 AND event_type='request_received'",[booking.id])).rows[0].n).toBe(1);
});
test("same_idempotency_key_different_body",async()=>{
 const d=await makeDeparture(db),{input}=await makeBooking(db,[await tourItem(db,d.id)]);
 await expect(db.query("SELECT app.submit_booking($1::jsonb)",[JSON.stringify({...input,guest:{...input.guest,fullName:"Different"}})])).rejects.toThrow("IDEMPOTENCY_CONFLICT");
});
test("disabled_staff_cannot_approve",async()=>{
 const actor=await makeActor(db),d=await makeDeparture(db),{booking}=await makeBooking(db,[await tourItem(db,d.id)]);
 await db.query("UPDATE app.staff_profiles SET active=false,revoked_at=now() WHERE id=$1",[actor]);
 await expect(db.query("SELECT app.approve_booking($1,1,$2)",[booking.id,actor])).rejects.toThrow("FORBIDDEN");
});
test("scoped_property_manager_mixed_booking",async()=>{
 const actor=await makeActor(db,"property_manager"),unit=await makeApartment(db),d=await makeDeparture(db);
 await db.query("DELETE FROM app.staff_scopes WHERE staff_id=$1",[actor]);
 await db.query("INSERT INTO app.staff_scopes(staff_id,scope_type,property_id) SELECT $1,'property',property_id FROM app.apartments WHERE id=$2",[actor,unit]);
 const {booking}=await makeBooking(db,[await stayItem(db,unit),await tourItem(db,d.id)]);
 await expect(db.query("SELECT app.approve_booking($1,1,$2)",[booking.id,actor])).rejects.toThrow("SCOPE_FORBIDDEN");
});
test("deposit_threshold",async()=>{
 const actor=await makeActor(db),d=await makeDeparture(db),{booking}=await makeBooking(db,[await tourItem(db,d.id)],"deposit");
 await db.query("SELECT app.approve_booking($1,1,$2)",[booking.id,actor]);
 const a=await makeAttempt(db,booking.id,29999),b=await makeAttempt(db,booking.id,1);
 await db.query("SELECT app.apply_payment_event($1::jsonb)",[JSON.stringify(paymentEvent(a.id,29999))]);
 expect((await db.query("SELECT status FROM app.bookings WHERE id=$1",[booking.id])).rows[0].status).toBe("approved_pending_payment");
 await db.query("SELECT app.apply_payment_event($1::jsonb)",[JSON.stringify(paymentEvent(b.id,1))]);
 expect((await db.query("SELECT status FROM app.bookings WHERE id=$1",[booking.id])).rows[0].status).toBe("confirmed");
});
test("same_transaction_distinct_events",async()=>{
 const actor=await makeActor(db),d=await makeDeparture(db),{booking}=await makeBooking(db,[await tourItem(db,d.id)],"deposit");
 await db.query("SELECT app.approve_booking($1,1,$2)",[booking.id,actor]);
 const a=await makeAttempt(db,booking.id,30000),e=paymentEvent(a.id,30000);
 await db.query("SELECT app.apply_payment_event($1::jsonb)",[JSON.stringify(e)]);
 await db.query("SELECT app.apply_payment_event($1::jsonb)",[JSON.stringify(e)]);
 await db.query("SELECT app.apply_payment_event($1::jsonb)",[JSON.stringify({...e,eventKey:e.eventKey+"-later"})]);
 expect((await db.query("SELECT count(*)::int n FROM app.provider_events WHERE transaction_reference=$1",[e.transactionId])).rows[0].n).toBe(2);
 expect((await db.query("SELECT sum(amount)::text n FROM app.cash_ledger WHERE booking_id=$1",[booking.id])).rows[0].n).toBe("30000");
});
test("late_payment_exception",async()=>{
 const actor=await makeActor(db),d=await makeDeparture(db),{booking}=await makeBooking(db,[await tourItem(db,d.id)],"deposit");
 await db.query("SELECT app.approve_booking($1,1,$2)",[booking.id,actor]);const a=await makeAttempt(db,booking.id,30000);
 await db.query("SELECT app.decide_booking($1,2,$2,'cancel','Guest cancelled')",[booking.id,actor]);
 await db.query("SELECT app.apply_payment_event($1::jsonb)",[JSON.stringify(paymentEvent(a.id,30000))]);
 expect((await db.query("SELECT status FROM app.bookings WHERE id=$1",[booking.id])).rows[0].status).toBe("cancelled");
 expect((await db.query("SELECT kind FROM app.financial_exceptions WHERE booking_id=$1",[booking.id])).rows[0].kind).toBe("late_payment");
});
test("refund_cannot_exceed_receipt",async()=>{
 const actor=await makeActor(db),d=await makeDeparture(db),{booking}=await makeBooking(db,[await tourItem(db,d.id)]);
 await db.query("SELECT app.approve_booking($1,1,$2)",[booking.id,actor]);
 const receipt=(await db.query("SELECT app.record_offline_receipt($1,10000,'EGP','cash','Test receipt',gen_random_uuid()::text,$2) r",[booking.id,actor])).rows[0].r;
 await expect(db.query("SELECT app.request_refund($1,NULL,$2,10001,'Test refund','{}',$3)",[booking.id,receipt.id,actor])).rejects.toThrow("REFUND_EXCEEDS_RECEIPT");
 const refund=(await db.query("SELECT app.request_refund($1,NULL,$2,5000,'Test refund','{}',$3) r",[booking.id,receipt.id,actor])).rows[0].r;
 await db.query("SELECT app.approve_refund($1,1,$2)",[refund.id,actor]);
 await db.query("SELECT app.complete_offline_refund($1,'test-refund-'||$1::uuid::text,$2)",[refund.id,actor]);
 await db.query("SELECT app.complete_offline_refund($1,'test-refund-'||$1::uuid::text,$2)",[refund.id,actor]);
 expect((await db.query("SELECT sum(amount)::text n FROM app.cash_ledger WHERE booking_id=$1",[booking.id])).rows[0].n).toBe("5000");
});
test("change_request_preserves_inventory",async()=>{
 const actor=await makeActor(db),d=await makeDeparture(db),{booking}=await makeBooking(db,[await tourItem(db,d.id)]);
 await db.query("SELECT app.approve_booking($1,1,$2)",[booking.id,actor]);
 await db.query("SELECT app.create_booking_request($1,'change','{}','Later departure please')",[booking.id]);
 expect((await db.query("SELECT status FROM app.bookings WHERE id=$1",[booking.id])).rows[0].status).toBe("confirmed");
 expect((await db.query("SELECT count(*)::int n FROM app.capacity_allocations c JOIN app.booking_items i ON i.id=c.booking_item_id WHERE i.booking_id=$1 AND c.state='confirmed'",[booking.id])).rows[0].n).toBe(1);
});
test("notification_worker_restart",async()=>{
 const {rows}=await db.query("INSERT INTO app.outbox_events(aggregate_type,aggregate_id,aggregate_version,event_type,event_key) VALUES('test',gen_random_uuid(),1,'test',gen_random_uuid()::text) RETURNING id");
 const job=(await db.query("INSERT INTO app.jobs(event_id,kind,job_key,status,lease_owner,lease_until,attempts,run_after) VALUES($1,'test',gen_random_uuid()::text,'running','crashed',now()-interval '1 minute',1,now()-interval '100 years') RETURNING id",[rows[0].id])).rows[0].id;
 const claimed=await db.query("SELECT * FROM app.claim_jobs('restart-test',100,60)");
 expect(claimed.rows.find(r=>r.id===job)?.attempts).toBe(2);
 expect((await db.query("SELECT app.finish_job($1,'wrong-worker',true) done",[job])).rows[0].done).toBe(false);
 expect((await db.query("SELECT app.finish_job($1,'restart-test',true) done",[job])).rows[0].done).toBe(true);
});
test("anonymous_and_runtime_direct_finance_writes_denied",async()=>{
 const c=runtime();await c.connect();
 try {await expect(c.query("INSERT INTO app.cash_ledger(booking_id,source,amount,currency,effect_key) VALUES(gen_random_uuid(),'online',1,'EGP','attack')")).rejects.toMatchObject({code:"42501"});
 await expect(c.query("UPDATE app.capacity_allocations SET seats=999")).rejects.toMatchObject({code:"42501"});}finally{await c.end();}
 await db.query("BEGIN");await db.query("SET LOCAL ROLE anon");
 await expect(db.query("SELECT * FROM app.bookings")).rejects.toMatchObject({code:"42501"});await db.query("ROLLBACK");
});
test("quote_immutable_and_policy_version_bound",async()=>{
 const d=await makeDeparture(db),{quote,input}=await makeBooking(db,[await tourItem(db,d.id)]);
 await expect(db.query("UPDATE app.quotes SET total=1,subtotal=1,initial_due=0 WHERE id=$1",[quote.id])).rejects.toThrow("IMMUTABLE_RECORD");
 const newQuote=(await db.query("SELECT app.create_quote($1::jsonb) q",[JSON.stringify({...quote.inputs,bindingHash:input.bindingHash})])).rows[0].q;
 await expect(db.query("SELECT app.submit_booking($1::jsonb)",[JSON.stringify({...input,quoteId:newQuote.id,idempotencyKey:crypto.randomUUID(),consents:{...input.consents,termsVersion:"invented"}})])).rejects.toThrow("POLICY_VERSION_MISMATCH");
});
test("ledger_is_append_only_even_for_direct_writes",async()=>{
 const actor=await makeActor(db),d=await makeDeparture(db),{booking}=await makeBooking(db,[await tourItem(db,d.id)]);
 await db.query("SELECT app.approve_booking($1,1,$2)",[booking.id,actor]);
 await db.query("SELECT app.record_offline_receipt($1,100,'EGP','cash','Synthetic',gen_random_uuid()::text,$2)",[booking.id,actor]);
 await expect(db.query("UPDATE app.cash_ledger SET amount=999 WHERE booking_id=$1",[booking.id])).rejects.toThrow("IMMUTABLE_RECORD");
 await expect(db.query("DELETE FROM app.cash_ledger WHERE booking_id=$1",[booking.id])).rejects.toThrow("IMMUTABLE_RECORD");
});
test("accepted_revision_atomically_replaces_inventory",async()=>{
 const actor=await makeActor(db),d=await makeDeparture(db),newDeparture=await makeDeparture(db),{booking,input}=await makeBooking(db,[await tourItem(db,d.id)]);
 await db.query("SELECT app.approve_booking($1,1,$2)",[booking.id,actor]);
 const q=(await db.query("SELECT app.create_quote($1::jsonb) q",[JSON.stringify({bindingHash:input.bindingHash,locale:"en",paymentPolicy:"arrival",items:[await tourItem(db,newDeparture.id)]})])).rows[0].q;
 const revision=(await db.query("SELECT app.propose_revision($1,2,$2,$3) r",[booking.id,q.id,actor])).rows[0].r;
 await expect(db.query("SELECT app.apply_revision($1,$2,2,$3)",[booking.id,revision.id,actor])).rejects.toThrow("INVALID_REVISION_STATE");
 await db.query("SELECT app.accept_revision($1,$2)",[booking.id,revision.id]);
 await db.query("SELECT app.apply_revision($1,$2,2,$3)",[booking.id,revision.id,actor]);
 const active=await db.query("SELECT c.departure_id FROM app.capacity_allocations c JOIN app.booking_items i ON i.id=c.booking_item_id WHERE i.booking_id=$1 AND c.state<>'released'",[booking.id]);
 expect(active.rows).toEqual([{departure_id:newDeparture.id}]);
 expect((await db.query("SELECT count(*)::int n FROM app.booking_items WHERE booking_id=$1 AND superseded_at IS NOT NULL",[booking.id])).rows[0].n).toBe(1);
});
test("failed_revision_preserves_original_allocation",async()=>{
 const actor=await makeActor(db),d=await makeDeparture(db),full=await makeDeparture(db),original=await makeBooking(db,[await tourItem(db,d.id)]),occupier=await makeBooking(db,[await tourItem(db,full.id)]);
 await db.query("SELECT app.approve_booking($1,1,$2)",[original.booking.id,actor]);await db.query("SELECT app.approve_booking($1,1,$2)",[occupier.booking.id,actor]);
 const q=(await db.query("SELECT app.create_quote($1::jsonb) q",[JSON.stringify({bindingHash:original.input.bindingHash,locale:"en",paymentPolicy:"arrival",items:[await tourItem(db,full.id)]})])).rows[0].q;
 const revision=(await db.query("SELECT app.propose_revision($1,2,$2,$3) r",[original.booking.id,q.id,actor])).rows[0].r;
 await db.query("SELECT app.accept_revision($1,$2)",[original.booking.id,revision.id]);
 await expect(db.query("SELECT app.apply_revision($1,$2,2,$3)",[original.booking.id,revision.id,actor])).rejects.toThrow("INVENTORY_CONFLICT");
 expect((await db.query("SELECT c.departure_id FROM app.capacity_allocations c JOIN app.booking_items i ON i.id=c.booking_item_id WHERE i.booking_id=$1 AND c.state='confirmed'",[original.booking.id])).rows).toEqual([{departure_id:d.id}]);
});
test("fulfilment_requires_explicit_operational_event",async()=>{
 const actor=await makeActor(db),d=await makeDeparture(db),{booking}=await makeBooking(db,[await tourItem(db,d.id)]);
 await db.query("SELECT app.approve_booking($1,1,$2)",[booking.id,actor]);
 const item=(await db.query("SELECT id FROM app.booking_items WHERE booking_id=$1",[booking.id])).rows[0].id;
 await db.query("SELECT app.fulfil_item($1,'fulfilled','Completed test experience',$2)",[item,actor]);
 expect((await db.query("SELECT status FROM app.bookings WHERE id=$1",[booking.id])).rows[0].status).toBe("completed");
 expect((await db.query("SELECT count(*)::int n FROM app.fulfilment_events WHERE booking_item_id=$1",[item])).rows[0].n).toBe(1);
});
test("approval_reconciles_expired_competing_hold",async()=>{
 const actor=await makeActor(db),d=await makeDeparture(db),old=await makeBooking(db,[await tourItem(db,d.id)],"deposit");
 await db.query("SELECT app.approve_booking($1,1,$2)",[old.booking.id,actor]);
 await db.query("UPDATE app.bookings SET payment_deadline=now()-interval '1 minute' WHERE id=$1",[old.booking.id]);
 const replacement=await makeBooking(db,[await tourItem(db,d.id)]);
 await db.query("SELECT app.approve_booking($1,1,$2)",[replacement.booking.id,actor]);
 expect((await db.query("SELECT status FROM app.bookings WHERE id=$1",[old.booking.id])).rows[0].status).toBe("expired");
 expect((await db.query("SELECT sum(seats)::int n FROM app.capacity_allocations WHERE departure_id=$1 AND state<>'released'",[d.id])).rows[0].n).toBe(1);
});
test("refund_request_retry_is_idempotent",async()=>{
 const actor=await makeActor(db),d=await makeDeparture(db),{booking}=await makeBooking(db,[await tourItem(db,d.id)]);
 await db.query("SELECT app.approve_booking($1,1,$2)",[booking.id,actor]);
 const receipt=(await db.query("SELECT app.record_offline_receipt($1,10000,'EGP','cash','Test',gen_random_uuid()::text,$2) r",[booking.id,actor])).rows[0].r;
 const input={bookingId:booking.id,originalOfflineReceiptId:receipt.id,amountMinor:"5000",reason:"Synthetic refund",policyCalculation:{basis:"operator decision"}},key=crypto.randomUUID();
 const a=(await db.query("SELECT app.request_refund_idempotent($1,$2,$3) r",[JSON.stringify(input),key,actor])).rows[0].r;
 const b=(await db.query("SELECT app.request_refund_idempotent($1,$2,$3) r",[JSON.stringify(input),key,actor])).rows[0].r;
 expect(a.id).toBe(b.id);
 await expect(db.query("SELECT app.request_refund_idempotent($1,$2,$3)",[JSON.stringify({...input,amountMinor:"4000"}),key,actor])).rejects.toThrow("IDEMPOTENCY_CONFLICT");
});
