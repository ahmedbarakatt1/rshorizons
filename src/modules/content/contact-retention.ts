import {query,withTransaction} from "@/server/db";
import {AppError} from "@/server/http/errors";
export async function cleanupExpiredContacts(options:{dryRun:boolean;limit:number}) {
 if(!Number.isInteger(options.limit)||options.limit<1||options.limit>1000)throw new AppError("INVALID_LIMIT",400);
 if(options.dryRun){
  const {rows}=await query("SELECT id FROM app.contact_requests WHERE retention_deadline<=now() ORDER BY retention_deadline,id LIMIT $1",[options.limit]);
  return {dryRun:true,eligibleIds:rows.map(row=>row.id as string),purgedIds:[] as string[]};
 }
 if(process.env.RETENTION_POLICY_APPROVED!=="true")throw new AppError("RETENTION_POLICY_UNAPPROVED",503);
 return withTransaction({type:"system"},async tx=>{
  const {rows}=await tx.query(`WITH candidates AS (
   SELECT id FROM app.contact_requests WHERE retention_deadline<=now() ORDER BY retention_deadline,id LIMIT $1 FOR UPDATE SKIP LOCKED
  ) DELETE FROM app.contact_requests WHERE id IN(SELECT id FROM candidates) AND retention_deadline<=now() RETURNING id`,[options.limit]);
  const ids=rows.map(row=>row.id as string);
  await tx.query(`INSERT INTO app.audit_events(actor_type,action,target_type,target_id,summary)
   SELECT 'system','contact_retention_purged','contact_request',id,'{"policyApproved":true}'::jsonb FROM unnest($1::uuid[]) id`,[ids]);
  return {dryRun:false,eligibleIds:ids,purgedIds:ids};
 });
}
