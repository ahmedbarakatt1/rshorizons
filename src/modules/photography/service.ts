import {randomUUID} from "node:crypto";
import {z} from "zod";
import {query,withTransaction,type ActorContext,type Transaction} from "@/server/db";
import {digestSecret,newSecret} from "@/server/security";
import {storage} from "@/integrations/storage";
import {processPrivateVideo} from "@/integrations/video";
import {authorizeGallery,privateHeaders,staffPermission} from "./access";
import {MediaError,uploadInputSchema,validateUploadBytes} from "./validation";
import {mediaRetentionDays} from "./retention";
export {uploadInputSchema,MediaError};
const uuid=z.uuid();
export const downloadInputSchema=z.object({galleryId:uuid,assetIds:z.array(uuid).min(1).max(100),derivative:z.enum(["preview","web","video","original"])}).strict();
// Re-read authoritative current money/fulfilment on every authorization. Stored eligibility flags
// are additional staff release gates, never a substitute for paid/fulfilled booking state.
const entitlementEligibility=`e.payment_eligible AND e.delivery_eligible AND e.revoked_at IS NULL
  AND (e.expires_at IS NULL OR e.expires_at>now()) AND bi.superseded_at IS NULL AND bi.kind IN('photography','addon')
  AND bi.fulfilment_state='fulfilled' AND b.status IN('confirmed','completed')
  AND g.booking_id=b.id AND g.kind='private'
  AND e.package_id::text=qi.snapshot->'package'->>'id'
  AND e.package_snapshot=qi.snapshot->'package'
  AND e.allowed_count IS NOT NULL AND e.allowed_count>0
  AND e.allowed_count<=coalesce((qi.snapshot->'package'->'entitlement_rules'->>'downloads')::integer,0)
  AND coalesce((SELECT sum(l.amount) FROM app.cash_ledger l WHERE l.booking_id=b.id AND l.currency=b.currency),0)>=b.total_amount`;
const entitlementRelations=`app.gallery_entitlements e JOIN app.booking_items bi ON bi.id=e.booking_item_id
  JOIN app.bookings b ON b.id=bi.booking_id JOIN app.quote_items qi ON qi.id=bi.quote_item_id JOIN app.galleries g ON g.id=e.gallery_id`;

export async function createUploadIntent(actor:ActorContext,input:unknown){
  const data=uploadInputSchema.parse(input),store=storage();
  const intent=await withTransaction(actor,async tx=>{
    await authorizeGallery(tx,actor,data.galleryId,"media.upload");
    const id=randomUUID(),key=`${id}/source.bin`;
    await tx.query(`INSERT INTO app.media_assets(id,storage_bucket,storage_key,uploaded_by,mime_type,size_bytes,checksum_sha256,retention_deadline) VALUES($1,'tourism-private',$2,$3,$4,$5,$6,now()+make_interval(days=>$7))`,[id,key,actor.id,data.mimeType,data.sizeBytes,data.checksumSha256,mediaRetentionDays()]);
    await tx.query(`INSERT INTO app.gallery_assets(gallery_id,asset_id) VALUES($1,$2)`,[data.galleryId,id]);
    return {assetId:id,state:"quarantine",uploadUrl:`/api/v1/admin/media/${id}/bytes`,method:"PUT",maxBytes:data.sizeBytes,storageMode:store.mode};
  });
  // External capability creation follows commit. A failed provider call leaves only
  // a quarantined, retention-bound record; no job or publication can begin.
  if(store.createUploadUrl)intent.uploadUrl=await store.createUploadUrl(`${intent.assetId}/source.bin`);
  return intent;
}
async function assetForStaff(tx:Transaction,actor:ActorContext,assetId:string){
  const {rows}=await tx.query(`SELECT a.*,ga.gallery_id FROM app.media_assets a JOIN app.gallery_assets ga ON ga.asset_id=a.id WHERE a.id=$1`,[assetId]);
  if(!rows.length)throw new MediaError("NOT_FOUND",404);
  for(const row of rows)await authorizeGallery(tx,actor,row.gallery_id,"media.upload");
  return rows[0];
}
export async function receiveUpload(assetId:string,actor:ActorContext,bytes:Buffer){
  uuid.parse(assetId);
  const asset=await withTransaction(actor,tx=>assetForStaff(tx,actor,assetId));
  if(asset.state!=="quarantine")throw new MediaError("UPLOAD_CLOSED",409);
  // Verifies exact declared bytes before storing. Finalization rechecks the persisted object.
  await validateUploadBytes(bytes,{mimeType:asset.mime_type,sizeBytes:Number(asset.size_bytes),checksumSha256:asset.checksum_sha256});
  try{await storage().put(asset.storage_key,bytes,asset.mime_type);}catch(error){if((error as NodeJS.ErrnoException).code==="EEXIST")throw new MediaError("UPLOAD_ALREADY_STORED",409);throw error;}
  return {assetId,state:"quarantine"};
}
export async function finalizeUpload(assetId:string,actor:ActorContext){
  uuid.parse(assetId);
  const asset=await withTransaction(actor,tx=>assetForStaff(tx,actor,assetId));
  if(["ready","processing"].includes(asset.state))return {assetId,state:asset.state};
  if(asset.state!=="quarantine")throw new MediaError("UPLOAD_CLOSED",409);
  await validateUploadBytes(await storage().read(asset.storage_key),{mimeType:asset.mime_type,sizeBytes:Number(asset.size_bytes),checksumSha256:asset.checksum_sha256});
  return withTransaction(actor,async tx=>{
    await assetForStaff(tx,actor,assetId);
    const changed=await tx.query(`UPDATE app.media_assets SET state='processing',version=version+1,updated_at=now() WHERE id=$1 AND state='quarantine' RETURNING version`,[assetId]);
    if(!changed.rowCount)return {assetId,state:"processing"};
    const event=await tx.query(`INSERT INTO app.outbox_events(aggregate_type,aggregate_id,aggregate_version,event_type,event_key,payload) VALUES('media',$1,$2,'media_processing',$3,$4) RETURNING id`,[assetId,changed.rows[0].version,`media-process:${assetId}`,{assetId}]);
    const job=await tx.query(`INSERT INTO app.jobs(event_id,kind,job_key) VALUES($1,'media_process',$2) RETURNING id`,[event.rows[0].id,`media-process:${assetId}`]);
    await tx.query(`INSERT INTO app.media_processing_jobs(job_id,asset_id,kind) VALUES($1,$2,$3)`,[job.rows[0].id,assetId,asset.mime_type==="video/mp4"?"video_transcode":"preview"]);
    return {assetId,state:"processing"};
  });
}
/** Invoked by the durable worker only after claim; no processing success is inferred from upload completion. */
export async function processMediaAsset(assetId:string){
  uuid.parse(assetId);
  const {rows}=await query(`SELECT * FROM app.media_assets WHERE id=$1`,[assetId]),asset=rows[0];
  if(!asset||asset.state==="ready")return;
  if(asset.state!=="processing")throw new MediaError("MEDIA_NOT_PROCESSING",409);
  const store=storage();
  try{
    const source=await store.read(asset.storage_key);
    const result=await validateUploadBytes(source,{mimeType:asset.mime_type,sizeBytes:Number(asset.size_bytes),checksumSha256:asset.checksum_sha256});
    const video=result.kind==="video"?await processPrivateVideo(assetId,source):null;
    const width=video?.width??(result.kind==="image"?result.width:0),height=video?.height??(result.kind==="image"?result.height:0);
    const outputs=video?[{kind:"preview",bytes:video.poster,mime:"image/webp"},{kind:"video",bytes:video.bytes,mime:"video/mp4"}]
      :result.kind==="image"?["preview","thumbnail","web"].map(kind=>({kind,bytes:result[kind as "preview"|"thumbnail"|"web"],mime:"image/webp"})):[];
    const derivatives:{id:string;key:string;kind:string;bytes:number;mime:string}[]=[];
    for(const output of outputs){
      const id=randomUUID(),key=`${assetId}/${id}.${output.mime==="video/mp4"?"mp4":"webp"}`;
      await store.put(key,output.bytes,output.mime);
      derivatives.push({id,key,kind:output.kind,bytes:output.bytes.length,mime:output.mime});
    }
    await withTransaction({type:"system"},async tx=>{
      await tx.query(`SELECT id FROM app.media_assets WHERE id=$1 FOR UPDATE`,[assetId]);
      const current=await tx.query(`SELECT state FROM app.media_assets WHERE id=$1`,[assetId]);
      if(current.rows[0]?.state!=="processing")return;
      for(const d of derivatives)await tx.query(`INSERT INTO app.media_derivatives(id,asset_id,kind,storage_bucket,storage_key,state,size_bytes,mime_type,width,height) VALUES($1,$2,$3,'tourism-private',$4,'ready',$5,$6,$7,$8)`,[d.id,assetId,d.kind,d.key,d.bytes,d.mime,width,height]);
      await tx.query(`INSERT INTO app.media_derivatives(asset_id,kind,storage_bucket,storage_key,state,size_bytes,width,height,mime_type) VALUES($1,'original','tourism-private',$2,'ready',$3,$4,$5,$6)`,[assetId,asset.storage_key,asset.size_bytes,width,height,asset.mime_type]);
      await tx.query(`UPDATE app.media_assets SET state='ready',width=$2,height=$3,safe_at=now(),version=version+1,updated_at=now() WHERE id=$1`,[assetId,width,height]);
      await tx.query(`UPDATE app.media_processing_jobs SET status='succeeded',completed_at=now(),failure_code=NULL WHERE asset_id=$1`,[assetId]);
    });
  }catch(error){
    const code=error instanceof MediaError?error.code:"MEDIA_PROCESSING_FAILED";
    await query(`UPDATE app.media_processing_jobs SET status='failed',failure_code=$2 WHERE asset_id=$1`,[assetId,code]);
    // Provider outages and processing delays keep quarantine intact for a durable retry.
    if(error instanceof MediaError&&error.status<500)await query(`UPDATE app.media_assets SET state='rejected',version=version+1 WHERE id=$1 AND state='processing'`,[assetId]);
    throw error;
  }
}
export async function getGalleryManifest(actor:ActorContext,galleryId:string){
  uuid.parse(galleryId);
  return withTransaction(actor,async tx=>{
    const {gallery}=await authorizeGallery(tx,actor,galleryId);
    const assets=await tx.query(`SELECT a.id,d.id derivative_id,d.width,d.height,d.kind,(ga.download_allowed AND EXISTS(SELECT 1 FROM ${entitlementRelations} WHERE e.gallery_id=ga.gallery_id AND ${entitlementEligibility} AND 'original'=ANY(e.allowed_variants))) AS download_allowed FROM app.gallery_assets ga JOIN app.media_assets a ON a.id=ga.asset_id
      JOIN app.media_derivatives d ON d.asset_id=a.id WHERE ga.gallery_id=$1 AND ga.preview_allowed AND a.state='ready' AND a.safe_at IS NOT NULL
      AND d.state='ready' AND d.visibility='private' AND d.kind='preview' ORDER BY ga.display_order,a.id`,[galleryId]);
    return {id:gallery.id,title:gallery.title,expiresAt:gallery.expires_at,assets:assets.rows.map(a=>({id:a.id,width:a.width,height:a.height,downloadAllowed:a.download_allowed,previewUrl:`/api/v1/galleries/${galleryId}/assets/${a.derivative_id}`}))};
  });
}
async function liveEntitlement(tx:Transaction,galleryId:string,kind:string){
  const {rows}=await tx.query(`SELECT e.* FROM ${entitlementRelations} WHERE e.gallery_id=$1 AND ${entitlementEligibility} AND $2=ANY(e.allowed_variants)
    ORDER BY e.id FOR UPDATE OF e`,[galleryId,kind]);
  if(!rows.length)throw new MediaError("DOWNLOAD_NOT_ENTITLED",403);
  return rows[0];
}
export async function issueDownloadGrant(actor:ActorContext,input:unknown){
  const data=downloadInputSchema.parse(input),assetIds=[...new Set(data.assetIds)];
  return withTransaction(actor,async tx=>{
    const {sessionId}=await authorizeGallery(tx,actor,data.galleryId);
    if(!sessionId)throw new MediaError("GUEST_SESSION_REQUIRED",403);
    const e=await liveEntitlement(tx,data.galleryId,data.derivative);
    const derivatives=await tx.query(`SELECT d.id,d.asset_id FROM app.gallery_assets ga JOIN app.media_assets a ON a.id=ga.asset_id JOIN app.media_derivatives d ON d.asset_id=a.id
      WHERE ga.gallery_id=$1 AND ga.asset_id=ANY($2::uuid[]) AND ga.download_allowed AND a.state='ready' AND a.safe_at IS NOT NULL AND d.state='ready' AND d.visibility='private' AND d.kind=$3`,[data.galleryId,assetIds,data.derivative]);
    if(derivatives.rows.length!==assetIds.length)throw new MediaError("NOT_FOUND",404);
    const existing=await tx.query(`SELECT DISTINCT s FROM app.access_grants a CROSS JOIN LATERAL unnest(a.scope) s WHERE a.gallery_id=$1 AND a.purpose='gallery' AND s LIKE 'asset:%'`,[data.galleryId]);
    const reserved=new Set([...existing.rows.map(r=>String(r.s).slice(6)),...assetIds]);
    if(e.allowed_count!==null&&reserved.size>e.allowed_count)throw new MediaError("DOWNLOAD_LIMIT",403);
    const token=newSecret(),scope=[`session:${sessionId}`,`entitlement:${e.id}`,`entitlement-version:${e.version}`,...assetIds.map(id=>`asset:${id}`),...derivatives.rows.map(d=>`download:${d.id}`)];
    const result=await tx.query(`INSERT INTO app.access_grants(token_hash,purpose,gallery_id,scope,expires_at) VALUES($1,'gallery',$2,$3,least(now()+interval '2 minutes',coalesce($4::timestamptz,'infinity'::timestamptz))) RETURNING expires_at`,[digestSecret(token),data.galleryId,scope,e.expires_at]);
    return {token,expiresAt:result.rows[0].expires_at,assets:derivatives.rows.map(d=>({assetId:d.asset_id,derivativeId:d.id,url:`/api/v1/galleries/${data.galleryId}/assets/${d.id}`}))};
  });
}
/** Token travels in an authorization header, never a logged URL. Bytes are never cached. */
async function authorizedPrivateAsset(actor:ActorContext,input:{galleryId:string;derivativeId:string;downloadToken?:string}){
  uuid.parse(input.galleryId);uuid.parse(input.derivativeId);
  const authorized=await withTransaction(actor,async tx=>{
    const {sessionId,grantId}=await authorizeGallery(tx,actor,input.galleryId);
    const result=await tx.query(`SELECT d.*,a.state asset_state,ga.preview_allowed,ga.download_allowed FROM app.media_derivatives d JOIN app.media_assets a ON a.id=d.asset_id JOIN app.gallery_assets ga ON ga.asset_id=a.id
      WHERE ga.gallery_id=$1 AND d.id=$2 AND a.state='ready' AND a.safe_at IS NOT NULL AND d.state='ready' AND d.visibility='private'`,[input.galleryId,input.derivativeId]);
    const d=result.rows[0];if(!d)throw new MediaError("NOT_FOUND",404);
    if(input.downloadToken){
      if(!sessionId||!d.download_allowed)throw new MediaError("NOT_FOUND",404);
      const grants=await tx.query(`SELECT id,scope FROM app.access_grants WHERE token_hash=$1 AND purpose='gallery' AND gallery_id=$2 AND expires_at>now() AND revoked_at IS NULL
        AND $3=ANY(scope) AND $4=ANY(scope)`,[digestSecret(input.downloadToken),input.galleryId,`session:${sessionId}`,`download:${d.id}`]);
      if(!grants.rows[0])throw new MediaError("NOT_FOUND",404);
      const entitlement=await liveEntitlement(tx,input.galleryId,d.kind);
      if(!grants.rows[0].scope.includes(`entitlement:${entitlement.id}`)||!grants.rows[0].scope.includes(`entitlement-version:${entitlement.version}`))throw new MediaError("NOT_FOUND",404);
      await tx.query(`INSERT INTO app.download_events(grant_id,session_id,derivative_id,action) VALUES($1,$2,$3,'download')`,[grants.rows[0].id,sessionId,d.id]);
    }else{
      if(d.kind!=="preview"||!d.preview_allowed)throw new MediaError("DOWNLOAD_GRANT_REQUIRED",403);
      if(sessionId)await tx.query(`INSERT INTO app.download_events(grant_id,session_id,derivative_id,action) VALUES($1,$2,$3,'preview')`,[grantId,sessionId,d.id]);
    }
    return d;
  });
  return {storageKey:authorized.storage_key as string,mimeType:authorized.kind==="original"?"application/octet-stream":authorized.mime_type as string,
    headers:{...privateHeaders,...(input.downloadToken?{"Content-Disposition":`attachment; filename="media-${authorized.asset_id}.${authorized.kind==="original"?"bin":authorized.mime_type==="video/mp4"?"mp4":"webp"}"`}:{})}};
}
export async function streamAsset(actor:ActorContext,input:{galleryId:string;derivativeId:string;downloadToken?:string}){
  const {storageKey,...metadata}=await authorizedPrivateAsset(actor,input);
  return {...metadata,bytes:await storage().read(storageKey)};
}
export async function servePrivateAsset(request:Request,actor:ActorContext,input:{galleryId:string;derivativeId:string;downloadToken?:string}){
  const asset=await authorizedPrivateAsset(actor,input);
  return storage().serve(request,asset.storageKey,asset.mimeType,asset.headers);
}
export async function listPublicGalleries(locale:string){
  const result=await query(`SELECT g.id,t.title,t.description,
    (SELECT jsonb_agg(jsonb_build_object('id',d.id,'url','/api/v1/galleries/public/assets/'||d.id::text,'width',d.width,'height',d.height,'mimeType',d.mime_type) ORDER BY ga.display_order) FROM app.gallery_assets ga JOIN app.media_derivatives d ON d.id=ga.public_derivative_id WHERE ga.gallery_id=g.id AND d.visibility='public' AND d.state='ready' AND d.approved_at IS NOT NULL AND app.asset_publication_eligible(ga.asset_id)) assets
    FROM app.galleries g JOIN app.public_gallery_translations t ON t.gallery_id=g.id AND t.locale=$1
    WHERE g.kind='public' AND g.visibility_state='published' AND t.approved_at IS NOT NULL AND (g.expires_at IS NULL OR g.expires_at>now())
    AND EXISTS(SELECT 1 FROM app.gallery_assets ga WHERE ga.gallery_id=g.id)
    AND NOT EXISTS(SELECT 1 FROM app.gallery_assets ga LEFT JOIN app.media_derivatives d ON d.id=ga.public_derivative_id WHERE ga.gallery_id=g.id AND (d.id IS NULL OR NOT app.asset_publication_eligible(ga.asset_id) OR d.state<>'ready' OR d.visibility<>'public'))
    ORDER BY g.published_at DESC LIMIT 50`,[locale]);
  return result.rows;
}
async function authorizedPublicDerivative(derivativeId:string){
  uuid.parse(derivativeId);
  const result=await query(`SELECT d.storage_key,d.mime_type FROM app.media_derivatives d JOIN app.gallery_assets ga ON ga.public_derivative_id=d.id JOIN app.galleries g ON g.id=ga.gallery_id
    WHERE d.id=$1 AND d.kind<>'original' AND d.visibility='public' AND d.state='ready' AND d.approved_at IS NOT NULL AND app.asset_publication_eligible(d.asset_id)
    AND g.kind='public' AND g.visibility_state='published' AND (g.expires_at IS NULL OR g.expires_at>now()) LIMIT 1`,[derivativeId]);
  if(!result.rows[0])throw new MediaError("NOT_FOUND",404);
  return {storageKey:result.rows[0].storage_key as string,mimeType:result.rows[0].mime_type as string,headers:privateHeaders};
}
export async function streamPublicDerivative(derivativeId:string){
  const {storageKey,...metadata}=await authorizedPublicDerivative(derivativeId);
  return {...metadata,bytes:await storage().read(storageKey)};
}
export async function servePublicDerivative(request:Request,derivativeId:string){
  const asset=await authorizedPublicDerivative(derivativeId);
  return storage().serve(request,asset.storageKey,asset.mimeType,asset.headers);
}
export async function createApprovedPublicDerivative(actor:ActorContext,input:{assetId:string;galleryId:string;expectedVersion:number}){
  uuid.parse(input.assetId);uuid.parse(input.galleryId);
  const source=await withTransaction(actor,async tx=>{
    await staffPermission(tx,actor,"content.publish");
    const {gallery}=await authorizeGallery(tx,actor,input.galleryId,"galleries.manage");
    if(gallery.kind!=="public"||gallery.version!==input.expectedVersion)throw new MediaError("VERSION_CONFLICT",409);
    const {rows}=await tx.query(`SELECT d.storage_key,d.kind,d.mime_type,d.width,d.height FROM app.media_derivatives d WHERE d.asset_id=$1 AND ((d.kind='web' AND d.mime_type='image/webp') OR (d.kind='video' AND d.mime_type='video/mp4')) AND d.state='ready' AND d.visibility='private' AND app.asset_publication_eligible($1) ORDER BY d.created_at LIMIT 1`,[input.assetId]);
    if(!rows[0])throw new MediaError("PUBLICATION_NOT_ELIGIBLE",422);
    return rows[0];
  });
  // Separate object; never change an original's bucket ACL, path or visibility.
  const derivativeId=randomUUID(),key=`${input.assetId}/${derivativeId}.${source.kind==="video"?"mp4":"webp"}`,bytes=await storage().read(source.storage_key);
  await storage().put(key,bytes,source.mime_type);
  return withTransaction(actor,async tx=>{
    await staffPermission(tx,actor,"content.publish");
    await authorizeGallery(tx,actor,input.galleryId,"galleries.manage");
    const changed=await tx.query(`UPDATE app.galleries SET version=version+1 WHERE id=$1 AND version=$2 RETURNING version`,[input.galleryId,input.expectedVersion]);
    if(!changed.rowCount)throw new MediaError("VERSION_CONFLICT",409);
    await tx.query(`INSERT INTO app.media_derivatives(id,asset_id,kind,storage_bucket,storage_key,visibility,state,size_bytes,approved_by,approved_at,mime_type,width,height) VALUES($1,$2,$6,'tourism-private',$3,'public','ready',$4,$5,now(),$7,$8,$9)`,[derivativeId,input.assetId,key,bytes.length,actor.id,source.kind,source.mime_type,source.width,source.height]);
    await tx.query(`INSERT INTO app.gallery_assets(gallery_id,asset_id,public_derivative_id) VALUES($1,$2,$3) ON CONFLICT(gallery_id,asset_id) DO UPDATE SET public_derivative_id=excluded.public_derivative_id`,[input.galleryId,input.assetId,derivativeId]);
    return {derivativeId,version:changed.rows[0].version};
  });
}
export async function publishGallery(actor:ActorContext,input:{galleryId:string;expectedVersion:number}){
  return withTransaction(actor,async tx=>{
    const {gallery}=await authorizeGallery(tx,actor,uuid.parse(input.galleryId));
    if(gallery.kind==="public")await staffPermission(tx,actor,"content.publish");
    const ready=await tx.query(`SELECT count(*)::int total,count(*) FILTER(WHERE a.state='ready' AND a.safe_at IS NOT NULL)::int ready FROM app.gallery_assets ga JOIN app.media_assets a ON a.id=ga.asset_id WHERE ga.gallery_id=$1`,[gallery.id]);
    if(!ready.rows[0].total||ready.rows[0].total!==ready.rows[0].ready)throw new MediaError("GALLERY_NOT_READY",422);
    const updated=await tx.query(`UPDATE app.galleries SET visibility_state='published',published_at=now(),version=version+1 WHERE id=$1 AND version=$2 RETURNING id,version`,[gallery.id,input.expectedVersion]);
    if(!updated.rowCount)throw new MediaError("VERSION_CONFLICT",409);
    // Deferred SQL publication guards enforce separate public derivative, rights and every subject's consent.
    await tx.query(`INSERT INTO app.outbox_events(aggregate_type,aggregate_id,aggregate_version,event_type,event_key,payload) VALUES('gallery',$1,$2,'gallery_ready',$3,$4)`,[gallery.id,updated.rows[0].version,`gallery-ready:${gallery.id}:${updated.rows[0].version}`,{galleryId:gallery.id,bookingId:gallery.booking_id}]);
    return updated.rows[0];
  });
}
