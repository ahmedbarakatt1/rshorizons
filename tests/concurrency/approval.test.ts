import {beforeAll,afterAll,expect,test} from "vitest";
import {admin,makeActor,makeDeparture,makeApartment,makeBooking,tourItem,stayItem,race,makeAttempt,paymentEvent} from "../database/helpers";
const db=admin();
beforeAll(()=>db.connect());afterAll(()=>db.end());
test("last_seat_two_approvals",async()=>{
 const actor=await makeActor(db),d=await makeDeparture(db,1),item=await tourItem(db,d.id);
 const a=await makeBooking(db,[item]),b=await makeBooking(db,[item]);
 const r=await race(db,"SELECT id FROM app.departures WHERE id=$1 FOR UPDATE",[d.id],[c=>c.query("SELECT app.approve_booking($1,1,$2)",[a.booking.id,actor]),c=>c.query("SELECT app.approve_booking($1,1,$2)",[b.booking.id,actor])]);
 expect(r.filter(x=>x.status==="fulfilled")).toHaveLength(1);
 expect(r.filter(x=>x.status==="rejected")).toHaveLength(1);
 expect((await db.query("SELECT sum(seats)::int n FROM app.capacity_allocations WHERE departure_id=$1 AND state<>'released'",[d.id])).rows[0].n).toBe(1);
});
test("apartment_approval_races_manual_block",async()=>{
 const actor=await makeActor(db),unit=await makeApartment(db),item=await stayItem(db,unit),a=await makeBooking(db,[item]);
 const r=await race(db,"SELECT id FROM app.apartments WHERE id=$1 FOR UPDATE",[unit],[c=>c.query("SELECT app.approve_booking($1,1,$2)",[a.booking.id,actor]),c=>c.query("SELECT app.block_apartment($1,$2,$3,'Maintenance',$4)",[unit,item.checkIn,item.checkOut,actor])]);
 expect(r.filter(x=>x.status==="fulfilled")).toHaveLength(1);
 expect((await db.query("SELECT count(*)::int n FROM app.apartment_inventory WHERE apartment_id=$1 AND released_at IS NULL",[unit])).rows[0].n).toBe(1);
});
test("adjacent_stays_and_cleaning_buffer",async()=>{
 const actor=await makeActor(db),unit=await makeApartment(db);
 const a=await makeBooking(db,[await stayItem(db,unit,45,2)]),b=await makeBooking(db,[await stayItem(db,unit,47,2)]);
 const adjacent=await race(db,"SELECT id FROM app.apartments WHERE id=$1 FOR UPDATE",[unit],[c=>c.query("SELECT app.approve_booking($1,1,$2)",[a.booking.id,actor]),c=>c.query("SELECT app.approve_booking($1,1,$2)",[b.booking.id,actor])]);
 expect(adjacent.every(r=>r.status==="fulfilled")).toBe(true);
 const buffered=await makeApartment(db,1),x=await makeBooking(db,[await stayItem(db,buffered,45,2)]),y=await makeBooking(db,[await stayItem(db,buffered,47,2)]);
 const blocked=await race(db,"SELECT id FROM app.apartments WHERE id=$1 FOR UPDATE",[buffered],[c=>c.query("SELECT app.approve_booking($1,1,$2)",[x.booking.id,actor]),c=>c.query("SELECT app.approve_booking($1,1,$2)",[y.booking.id,actor])]);
 expect(blocked.filter(r=>r.status==="fulfilled")).toHaveLength(1);
 expect(blocked.find(r=>r.status==="rejected")).toMatchObject({reason:{message:"INVENTORY_CONFLICT"}});
});
test("multi_item_failure_rolls_back",async()=>{
 const actor=await makeActor(db),d=await makeDeparture(db,2),unit=await makeApartment(db),stay=await stayItem(db,unit);
 await db.query("SELECT app.block_apartment($1,$2,$3,'Maintenance',$4)",[unit,stay.checkIn,stay.checkOut,actor]);
 const b=await makeBooking(db,[await tourItem(db,d.id),stay]);
 const other=await makeBooking(db,[await tourItem(db,d.id)]);
 const approvals=await race(db,"SELECT id FROM app.departures WHERE id=$1 FOR UPDATE",[d.id],[c=>c.query("SELECT app.approve_booking($1,1,$2)",[b.booking.id,actor]),c=>c.query("SELECT app.approve_booking($1,1,$2)",[other.booking.id,actor])]);
 expect(approvals[0]).toMatchObject({status:"rejected",reason:{message:"INVENTORY_CONFLICT"}});
 expect(approvals[1].status).toBe("fulfilled");
 expect((await db.query("SELECT count(*)::int n FROM app.capacity_allocations c JOIN app.booking_items i ON i.id=c.booking_item_id WHERE i.booking_id=$1",[b.booking.id])).rows[0].n).toBe(0);
 expect((await db.query("SELECT status,version FROM app.bookings WHERE id=$1",[b.booking.id])).rows[0]).toMatchObject({status:"pending_review",version:1});
 expect((await db.query("SELECT count(*)::int n FROM app.outbox_events WHERE aggregate_id=$1 AND event_type<>'request_received'",[b.booking.id])).rows[0].n).toBe(0);
});
test("shared_departure_resource_not_per_guest_exclusive",async()=>{
 const actor=await makeActor(db),d=await makeDeparture(db,2);
 const resource=(await db.query("INSERT INTO app.resources(kind,code,name,mode,capacity) VALUES('boat',gen_random_uuid()::text,'Synthetic boat','exclusive',1) RETURNING id")).rows[0].id;
 await db.query("SELECT app.assign_resource($1,$2,NULL,$3,$4,1,$5)",[resource,d.id,d.starts_at,d.ends_at,actor]);
 const a=await makeBooking(db,[await tourItem(db,d.id)]),b=await makeBooking(db,[await tourItem(db,d.id)]);
 const approvals=await race(db,"SELECT id FROM app.departures WHERE id=$1 FOR UPDATE",[d.id],[c=>c.query("SELECT app.approve_booking($1,1,$2)",[a.booking.id,actor]),c=>c.query("SELECT app.approve_booking($1,1,$2)",[b.booking.id,actor])]);
 expect(approvals.every(r=>r.status==="fulfilled")).toBe(true);
 expect((await db.query("SELECT count(*)::int n FROM app.resource_occupancy WHERE departure_id=$1",[d.id])).rows[0].n).toBe(1);
 expect((await db.query("SELECT sum(seats)::int n FROM app.capacity_allocations WHERE departure_id=$1",[d.id])).rows[0].n).toBe(2);
});
test("payment_vs_expiry",async()=>{
 const actor=await makeActor(db),d=await makeDeparture(db),b=await makeBooking(db,[await tourItem(db,d.id)],"deposit");
 await db.query("SELECT app.approve_booking($1,1,$2)",[b.booking.id,actor]);
 const a=await makeAttempt(db,b.booking.id,30000),event=paymentEvent(a.id,30000);
 await db.query("UPDATE app.bookings SET payment_deadline=clock_timestamp()-interval '1 second' WHERE id=$1",[b.booking.id]);
 await race(db,"SELECT id FROM app.bookings WHERE id=$1 FOR UPDATE",[b.booking.id],[c=>c.query("SELECT app.apply_payment_event($1::jsonb)",[JSON.stringify(event)]),c=>c.query("SELECT app.expire_payment_hold($1,clock_timestamp())",[b.booking.id])]);
 expect((await db.query("SELECT status FROM app.bookings WHERE id=$1",[b.booking.id])).rows[0].status).toBe("expired");
 expect((await db.query("SELECT sum(amount)::text n FROM app.cash_ledger WHERE booking_id=$1",[b.booking.id])).rows[0].n).toBe("30000");
 expect((await db.query("SELECT count(*)::int n FROM app.capacity_allocations c JOIN app.booking_items i ON i.id=c.booking_item_id WHERE i.booking_id=$1 AND c.state<>'released'",[b.booking.id])).rows[0].n).toBe(0);
});
test("payment_link_creation_has_one_external_request_claim",async()=>{
 const actor=await makeActor(db),d=await makeDeparture(db),{booking}=await makeBooking(db,[await tourItem(db,d.id)],"deposit");
 await db.query("SELECT app.approve_booking($1,1,$2)",[booking.id,actor]);
 const obligation=(await db.query("SELECT id FROM app.payment_obligations WHERE booking_id=$1 AND kind='initial'",[booking.id])).rows[0].id;
 const attempt=(await db.query("SELECT app.create_payment_attempt($1,$2,gen_random_uuid()::text,'local','local') a",[booking.id,obligation])).rows[0].a;
 const results=await race(db,"SELECT id FROM app.payment_attempts WHERE id=$1 FOR UPDATE",[attempt.id],[c=>c.query("SELECT app.claim_payment_creation($1) claimed",[attempt.id]),c=>c.query("SELECT app.claim_payment_creation($1) claimed",[attempt.id])]);
 const claimed=results.map(r=>r.status==="fulfilled"?(r.value as {rows:{claimed:boolean}[]}).rows[0].claimed:false);
 expect(claimed.filter(Boolean)).toHaveLength(1);
 await expect(db.query("SELECT app.create_payment_attempt($1,$2,gen_random_uuid()::text,'local','local')",[booking.id,obligation])).rejects.toThrow("PAYMENT_ALREADY_PENDING_OR_PAID");
});
