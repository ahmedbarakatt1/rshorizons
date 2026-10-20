import {withTransaction} from "@/server/db";
/** Technical defaults: one pickup reminder within24h and one payment reminder within6h.
 * Unique event keys include the scheduled instant; changes create a distinct durable event.
 * Delivery rechecks current status/time so a delayed worker cannot send an obsolete reminder.
 */
export async function enqueueReminders(){
  return withTransaction({type:"system"},async tx=>{
    const pickups=await tx.query(`WITH candidates AS (
      SELECT b.id,b.version,p.id AS pickup_id,p.pickup_at,'pickup-reminder:'||p.id||':'||extract(epoch FROM p.pickup_at)::text AS key
      FROM app.pickup_assignments p JOIN app.booking_items i ON i.id=p.booking_item_id JOIN app.bookings b ON b.id=i.booking_id
      WHERE b.status='confirmed' AND i.superseded_at IS NULL AND i.fulfilment_state IN('scheduled','check_in')
      AND p.pickup_at>now() AND p.pickup_at<=now()+interval '24 hours'
    ), inserted AS (
      INSERT INTO app.outbox_events(aggregate_type,aggregate_id,aggregate_version,event_type,event_key,payload)
      SELECT 'booking',c.id,c.version,'pickup_reminder',c.key,jsonb_build_object('bookingId',c.id,'pickupId',c.pickup_id,'pickupAt',c.pickup_at)
      FROM candidates c WHERE NOT EXISTS(SELECT 1 FROM app.outbox_events e WHERE e.event_key=c.key)
      ORDER BY c.pickup_at LIMIT 100 ON CONFLICT DO NOTHING RETURNING id
    ) INSERT INTO app.jobs(event_id,kind,job_key) SELECT id,'notification',id||':notification' FROM inserted ON CONFLICT DO NOTHING RETURNING id`);
    const payments=await tx.query(`WITH candidates AS (
      SELECT b.id,b.version,b.payment_deadline,'payment-reminder:'||b.id||':'||extract(epoch FROM b.payment_deadline)::text AS key
      FROM app.bookings b WHERE b.status='approved_pending_payment' AND b.payment_deadline>now() AND b.payment_deadline<=now()+interval '6 hours'
    ), inserted AS (
      INSERT INTO app.outbox_events(aggregate_type,aggregate_id,aggregate_version,event_type,event_key,payload)
      SELECT 'booking',c.id,c.version,'payment_reminder',c.key,jsonb_build_object('bookingId',c.id,'deadline',c.payment_deadline)
      FROM candidates c WHERE NOT EXISTS(SELECT 1 FROM app.outbox_events e WHERE e.event_key=c.key)
      ORDER BY c.payment_deadline LIMIT 100 ON CONFLICT DO NOTHING RETURNING id
    ) INSERT INTO app.jobs(event_id,kind,job_key) SELECT id,'notification',id||':notification' FROM inserted ON CONFLICT DO NOTHING RETURNING id`);
    return {pickups:pickups.rowCount??0,payments:payments.rowCount??0};
  });
}
