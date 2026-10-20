import {z} from "zod";
import {query,withTransaction} from "@/server/db";
import {storage} from "@/integrations/storage";
import {MediaError} from "./validation";
import {purgeManagedVideo} from "@/integrations/video";

export function mediaRetentionDays(){
  const local=["development","test"].includes(process.env.APP_ENV??"development");
  const configured=process.env.MEDIA_RETENTION_DAYS;
  if(!configured&&!local)throw new MediaError("MEDIA_RETENTION_DAYS_REQUIRED",503);
  const days=Number(configured??90);
  if(!Number.isInteger(days)||days<1||days>3650)throw new MediaError("MEDIA_RETENTION_DAYS_INVALID",503);
  return days;
}
const candidate=`a.retention_deadline IS NOT NULL AND a.retention_deadline<=now() AND a.state IN('quarantine','rejected','ready','deleted')
  AND NOT EXISTS(SELECT 1 FROM app.gallery_assets ga JOIN app.galleries g ON g.id=ga.gallery_id WHERE ga.asset_id=a.id AND g.visibility_state IN('draft','review','published'))
  AND NOT EXISTS(SELECT 1 FROM app.gallery_assets ga JOIN app.gallery_entitlements e ON e.gallery_id=ga.gallery_id WHERE ga.asset_id=a.id AND e.revoked_at IS NULL AND (e.expires_at IS NULL OR e.expires_at>now()))`;
/** Worker-only bounded operation. Tombstone commit precedes irreversible object removal; failures remain retryable. */
export async function cleanupExpiredMedia(input:{dryRun?:boolean;limit?:number}={}){
  const options=z.object({dryRun:z.boolean().default(true),limit:z.number().int().min(1).max(100).default(25)}).parse(input);
  if(!options.dryRun&&process.env.RETENTION_POLICY_APPROVED!=="true")throw new MediaError("RETENTION_POLICY_UNAPPROVED",503);
  const rows=(await query(`SELECT a.id FROM app.media_assets a WHERE ${candidate} ORDER BY a.retention_deadline,a.id LIMIT $1`,[options.limit])).rows;
  const eligibleAssetIds:string[]=rows.map(row=>row.id),purgedAssetIds:string[]=[],failedAssetIds:string[]=[];
  if(options.dryRun)return {dryRun:true,eligibleAssetIds,purgedAssetIds,failedAssetIds};
  const store=storage();
  for(const id of eligibleAssetIds){
    try{
      const keys=await withTransaction({type:"system"},async tx=>{
        const locked=await tx.query("SELECT id FROM app.media_assets WHERE id=$1 FOR UPDATE SKIP LOCKED",[id]);
        if(!locked.rowCount)return null;
        await tx.query("SELECT g.id FROM app.galleries g JOIN app.gallery_assets ga ON ga.gallery_id=g.id WHERE ga.asset_id=$1 FOR UPDATE OF g",[id]);
        await tx.query("SELECT e.id FROM app.gallery_entitlements e JOIN app.gallery_assets ga ON ga.gallery_id=e.gallery_id WHERE ga.asset_id=$1 FOR UPDATE OF e",[id]);
        const asset=(await tx.query(`SELECT a.* FROM app.media_assets a WHERE a.id=$1 AND ${candidate}`,[id])).rows[0];
        if(!asset)return null;
        if(asset.storage_bucket!=="tourism-private")throw new MediaError("RETENTION_BUCKET_UNEXPECTED",500);
        const derivatives=(await tx.query("SELECT storage_bucket,storage_key FROM app.media_derivatives WHERE asset_id=$1",[id])).rows;
        if(derivatives.some(d=>d.storage_bucket!=="tourism-private"))throw new MediaError("RETENTION_BUCKET_UNEXPECTED",500);
        await tx.query("UPDATE app.media_assets SET state='deleted',version=version+1,updated_at=now() WHERE id=$1",[id]);
        await tx.query("UPDATE app.media_derivatives SET state='deleted',visibility='private',version=version+1,updated_at=now() WHERE asset_id=$1",[id]);
        await tx.query("INSERT INTO app.audit_events(actor_type,action,target_type,target_id,summary) VALUES('system','media_retention_tombstoned','media_asset',$1,$2)",[id,{retentionDeadline:asset.retention_deadline,policyApproved:true}]);
        return [...new Set([asset.storage_key,...derivatives.map(d=>d.storage_key)] as string[])];
      });
      if(!keys)continue;
      await purgeManagedVideo(id);
      for(const key of keys)await store.remove(key);
      await withTransaction({type:"system"},async tx=>{
        await tx.query("UPDATE app.media_assets SET retention_deadline=NULL,updated_at=now() WHERE id=$1 AND state='deleted'",[id]);
        await tx.query("INSERT INTO app.audit_events(actor_type,action,target_type,target_id,summary) VALUES('system','media_storage_purged','media_asset',$1,$2)",[id,{objectCount:keys.length,storageMode:store.mode}]);
      });
      purgedAssetIds.push(id);
    }catch{failedAssetIds.push(id);}
  }
  return {dryRun:false,eligibleAssetIds,purgedAssetIds,failedAssetIds};
}
