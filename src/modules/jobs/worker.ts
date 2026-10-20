import {randomUUID} from "node:crypto";
import {query} from "@/server/db";
import {processMediaAsset} from "@/modules/photography/service";
import {reconcileAttempt} from "@/modules/payments/service";
import {deliverNotification} from "@/integrations/messaging/notifications";
import {enqueueReminders} from "./reminders";
type Job={id:string;kind:string;event_id:string;attempts:number};
export async function runJobs(limit=20) {
  const worker=`worker-${randomUUID()}`,started=Date.now();
  const cleanup=await query("SELECT app.cleanup_expired_auth(100) AS result");
  await enqueueReminders();
  // Covers all emitters, including a committed event whose process died before enqueue.
  await query(`INSERT INTO app.jobs(event_id,kind,job_key)
    SELECT e.id,CASE WHEN e.event_type='media_processing' THEN 'media_process' WHEN e.event_type='payment_reconciliation_required' THEN 'payment_reconciliation' ELSE 'notification' END,e.id||':dispatch'
    FROM app.outbox_events e WHERE NOT EXISTS(SELECT 1 FROM app.jobs j WHERE j.event_id=e.id)
    ON CONFLICT DO NOTHING`);
  const due=await query("SELECT id FROM app.bookings WHERE status='approved_pending_payment' AND payment_deadline<=now() ORDER BY payment_deadline LIMIT 100");
  let expired=0;for(const booking of due.rows){await query("SELECT app.expire_payment_hold($1)",[booking.id]);expired++;}
  const result={claimed:0,complete:0,failed:0,leaseLost:0,expired,expiredAuthArtifacts:cleanup.rows[0].result.total as number,durationMs:0};
  for(let processed=0;processed<Math.min(50,Math.max(1,limit))&&Date.now()-started<200000;processed++){
    // Claim immediately before processing, so a batch never holds idle expiring leases.
    const {rows}=await query<Job>("SELECT * FROM app.claim_jobs($1,1,120)",[worker]);
    const job=rows[0];if(!job)break;result.claimed++;
    const event=(await query("SELECT id,event_type,aggregate_id,payload FROM app.outbox_events WHERE id=$1",[job.event_id])).rows[0];
    let ok=false,failure:string|null=null;
    try{
      if(!event)throw new Error("EVENT_MISSING");
      if(job.kind==="media_process")await processMediaAsset(String(event.payload.assetId));
      else if(job.kind==="payment_reconciliation")await reconcileAttempt(String(event.aggregate_id));
      else if(job.kind==="notification")await deliverNotification({id:job.id,attempts:job.attempts,event:{id:event.id,event_type:event.event_type,aggregate_id:event.aggregate_id,payload:event.payload}});
      else throw new Error("UNSUPPORTED_JOB_KIND");
      ok=true;
    }catch(error){
      const code=(error as {code?:string}).code;
      failure=code&&/^[A-Z0-9_]{1,80}$/.test(code)?code:error instanceof Error&&/^[A-Z0-9_]{1,80}$/.test(error.message)?error.message:"JOB_PROCESSING_FAILED";
    }
    const finished=await query("SELECT app.finish_job($1,$2,$3,$4) AS finished",[job.id,worker,ok,failure]);
    if(!finished.rows[0].finished)result.leaseLost++;else if(ok)result.complete++;else result.failed++;
  }
  result.durationMs=Date.now()-started;
  console.info(JSON.stringify({event:"worker_batch",...result}));
  return result;
}
export async function operationalMetrics(){
  const {rows}=await query(`SELECT
    (SELECT count(*)::int FROM app.jobs WHERE status='dead') AS "deadJobs",
    (SELECT coalesce(max(extract(epoch FROM now()-created_at))::int,0) FROM app.jobs WHERE status IN('pending','failed','running')) AS "oldestPendingJobSeconds",
    (SELECT count(*)::int FROM app.financial_exceptions WHERE state='open') AS "openFinancialExceptions",
    (SELECT count(*)::int FROM app.bookings WHERE status='approved_pending_payment' AND payment_deadline<now()-interval '5 minutes') AS "staleHolds",
    (SELECT count(*)::int FROM app.booking_items i JOIN app.bookings b ON b.id=i.booking_id WHERE b.status='confirmed' AND i.superseded_at IS NULL AND ((i.kind='tour' AND NOT EXISTS(SELECT 1 FROM app.capacity_allocations a WHERE a.booking_item_id=i.id AND a.state='confirmed')) OR (i.kind='stay' AND NOT EXISTS(SELECT 1 FROM app.apartment_stays s JOIN app.apartment_inventory ai ON ai.stay_id=s.id WHERE s.booking_item_id=i.id AND ai.released_at IS NULL)))) AS "missingAllocations"`);
  return rows[0] as {deadJobs:number;oldestPendingJobSeconds:number;openFinancialExceptions:number;staleHolds:number;missingAllocations:number};
}
export async function sendOperationalAlert() {
  const metrics=await operationalMetrics();
  const unhealthy=metrics.deadJobs>0||metrics.oldestPendingJobSeconds>900||metrics.openFinancialExceptions>0||metrics.staleHolds>0||metrics.missingAllocations>0;
  if(unhealthy){
    const destination=process.env.MONITORING_ALERT_URL;
    if(!destination)throw new Error("ALERT_DESTINATION_UNCONFIGURED");
    if(new URL(destination).protocol!=="https:")throw new Error("ALERT_DESTINATION_INVALID");
    const response=await fetch(destination,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({service:"red-sea-horizons",environment:process.env.APP_ENV,metrics}),redirect:"error",signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error("ALERT_DELIVERY_FAILED");
  }
  return {unhealthy,metrics};
}
