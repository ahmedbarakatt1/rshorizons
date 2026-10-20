import {test,expect,beforeAll,afterAll} from "vitest";
import {admin,makeActor,makeDeparture,makeBooking,tourItem} from "../database/helpers";
import {enqueueReminders} from "@/modules/jobs/reminders";
const db=admin();
beforeAll(()=>db.connect());afterAll(()=>db.end());
test("pickup_reminders_are_durable_deduplicated_and_skip_expired_pickups",async()=>{
  const actor=await makeActor(db),departure=await makeDeparture(db,4),{booking}=await makeBooking(db,[await tourItem(db,departure.id)]);
  await db.query("SELECT app.approve_booking($1,1,$2)",[booking.id,actor]);
  const item=(await db.query("SELECT id FROM app.booking_items WHERE booking_id=$1",[booking.id])).rows[0].id;
  const future=(await db.query("INSERT INTO app.pickup_assignments(booking_item_id,address_snapshot,pickup_at) VALUES($1,'Synthetic pickup',now()+interval '2 hours') RETURNING id",[item])).rows[0].id;
  const expired=(await db.query("INSERT INTO app.pickup_assignments(booking_item_id,address_snapshot,pickup_at) VALUES($1,'Synthetic old pickup',now()-interval '2 hours') RETURNING id",[item])).rows[0].id;
  await enqueueReminders();await enqueueReminders();
  const events=await db.query("SELECT e.id,j.id AS job_id FROM app.outbox_events e LEFT JOIN app.jobs j ON j.event_id=e.id WHERE e.event_type='pickup_reminder' AND e.aggregate_id=$1",[booking.id]);
  expect(events.rows).toHaveLength(1);expect(events.rows[0].job_id).toBeTruthy();
  expect((await db.query("SELECT payload FROM app.outbox_events WHERE id=$1",[events.rows[0].id])).rows[0].payload.pickupId).toBe(future);
  expect((await db.query("SELECT 1 FROM app.outbox_events WHERE payload->>'pickupId'=$1",[expired])).rowCount).toBe(0);
});
