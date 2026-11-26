import {randomUUID} from "node:crypto";
import {z} from "zod";
import {localeSchema} from "@/modules/bookings/contracts";
import {storage} from "@/integrations/storage";
import {query,withTransaction,type ActorContext,type Transaction} from "@/server/db";
import {MAX_IMAGE_BYTES,MediaError,validateUploadBytes} from "./validation";

const photoFileSchema=z.object({
  mimeType:z.enum(["image/jpeg","image/png","image/webp"]),sizeBytes:z.number().int().positive().max(MAX_IMAGE_BYTES),
  checksumSha256:z.string().regex(/^[a-f0-9]{64}$/),locale:localeSchema
}).strict();
export const tripPhotoIntentSchema=photoFileSchema.extend({retentionDays:z.number().int().min(1).max(3650)});
const evidence=z.string().trim().min(1).max(500);
export const tripPhotoPublicationSchema=z.object({
  caption:z.string().trim().min(1).max(180),rightsEvidenceRef:evidence,subjectsReviewed:z.literal(true),
  subjects:z.array(z.object({
    guestId:z.uuid(),guardianId:z.uuid().optional(),evidenceRef:evidence,expiresAt:z.iso.datetime({offset:true}).optional()
  }).strict()).max(40)
}).strict();

export async function isActiveOwner(tx:Pick<Transaction,"query">,actor:ActorContext){
  if(actor.type!=="staff"||!actor.id)return false;
  const result=await tx.query(`SELECT 1 FROM app.staff_profiles s JOIN app.staff_roles sr ON sr.staff_id=s.id
    JOIN app.roles r ON r.id=sr.role_id WHERE s.id=$1 AND s.active AND s.revoked_at IS NULL AND r.code='owner'`,[actor.id]);
  return Boolean(result.rowCount);
}
async function requireOwner(tx:Transaction,actor:ActorContext){
  if(!await isActiveOwner(tx,actor))throw new MediaError("OWNER_REQUIRED",403);
}
export async function startTripPhoto(actor:ActorContext,input:unknown){
  const declaration=tripPhotoIntentSchema.parse(input);
  const assetId=randomUUID(),key=`${assetId}/source.bin`;
  await withTransaction(actor,async tx=>{
    await requireOwner(tx,actor);
    await tx.query(`INSERT INTO app.media_assets(id,storage_bucket,storage_key,uploaded_by,mime_type,size_bytes,checksum_sha256,trip_photo_locale,retention_deadline)
      VALUES($1,'tourism-private',$2,$3,$4,$5,$6,$7,now()+make_interval(days=>$8))`,
      [assetId,key,actor.id,declaration.mimeType,declaration.sizeBytes,declaration.checksumSha256,declaration.locale,declaration.retentionDays]);
  });
  const store=storage();
  return {assetId,uploadUrl:store.createUploadUrl?await store.createUploadUrl(key):`/api/v1/admin/trip-photos/${assetId}/bytes`};
}
async function findPhoto(tx:Transaction,actor:ActorContext,assetId:string){
  await requireOwner(tx,actor);
  const {rows}=await tx.query(`SELECT a.*,ga.gallery_id,ga.public_derivative_id,g.visibility_state FROM app.media_assets a
    LEFT JOIN app.gallery_assets ga ON ga.asset_id=a.id LEFT JOIN app.galleries g ON g.id=ga.gallery_id
    WHERE a.id=$1 AND a.uploaded_by=$2 AND a.trip_photo_locale IS NOT NULL`,[assetId,actor.id]);
  if(!rows[0])throw new MediaError("NOT_FOUND",404);
  return rows[0];
}
function declarationFor(asset:Record<string,unknown>){
  return photoFileSchema.parse({mimeType:asset.mime_type,sizeBytes:Number(asset.size_bytes),checksumSha256:asset.checksum_sha256,locale:asset.trip_photo_locale});
}
export async function storeTripPhoto(actor:ActorContext,assetId:string,bytes:Buffer){
  const asset=await withTransaction(actor,tx=>findPhoto(tx,actor,assetId));
  if(asset.state!=="quarantine")throw new MediaError("UPLOAD_CLOSED",409);
  const store=storage();
  if(store.mode!=="local-isolated")throw new MediaError("DIRECT_UPLOAD_REQUIRED",409);
  await validateUploadBytes(bytes,declarationFor(asset));
  await store.put(asset.storage_key,bytes,asset.mime_type);
  return {assetId};
}
function alreadyPublished(asset:Record<string,unknown>){
  if(asset.state==="quarantine")return null;
  if(asset.visibility_state==="published"&&asset.public_derivative_id)
    return {galleryId:String(asset.gallery_id),derivativeId:String(asset.public_derivative_id)};
  throw new MediaError("UPLOAD_CLOSED",409);
}
export async function publishTripPhoto(actor:ActorContext,assetId:string,input:unknown){
  const data=tripPhotoPublicationSchema.parse(input);
  const asset=await withTransaction(actor,tx=>findPhoto(tx,actor,assetId));
  const existing=alreadyPublished(asset);
  if(existing)return existing;
  const store=storage(),declaration=declarationFor(asset);
  const image=await validateUploadBytes(await store.read(asset.storage_key),declaration);
  if(image.kind!=="image")throw new MediaError("MEDIA_TYPE_MISMATCH");
  const derivativeId=randomUUID(),key=`${assetId}/${derivativeId}.webp`;
  await store.put(key,image.web,"image/webp");
  let publication;
  try{
    publication=await withTransaction(actor,async tx=>{
      // Lock first, then read the current gallery link under a fresh statement snapshot.
      await tx.query("SELECT id FROM app.media_assets WHERE id=$1 FOR UPDATE",[assetId]);
      const locked=await findPhoto(tx,actor,assetId);
      const existing=alreadyPublished(locked);
      if(existing)return existing;
      await tx.query(`UPDATE app.media_assets SET state='ready',safe_at=now(),width=$2,height=$3,
        rights_evidence_ref=$4,rights_verified_by=$5,rights_verified_at=now(),subjects_reviewed_by=$5,
        subjects_reviewed_at=now(),version=version+1,updated_at=now() WHERE id=$1`,[assetId,image.width,image.height,data.rightsEvidenceRef,actor.id]);
      for(const subject of data.subjects){
        await tx.query("INSERT INTO app.media_subjects(asset_id,guest_id,guardian_guest_id) VALUES($1,$2,$3)",[assetId,subject.guestId,subject.guardianId??null]);
        await tx.query(`INSERT INTO app.publication_consents(asset_id,subject_guest_id,granted_by_guest_id,evidence_ref,allowed_uses,expires_at)
          VALUES($1,$2,$3,$4,ARRAY['website','marketing'],$5)`,[assetId,subject.guestId,subject.guardianId??subject.guestId,subject.evidenceRef,subject.expiresAt??null]);
      }
      await tx.query(`INSERT INTO app.media_derivatives(id,asset_id,kind,storage_bucket,storage_key,visibility,state,approved_by,approved_at,size_bytes,width,height,mime_type)
        VALUES($1,$2,'web','tourism-private',$3,'public','ready',$4,now(),$5,$6,$7,'image/webp')`,[derivativeId,assetId,key,actor.id,image.web.length,image.webWidth,image.webHeight]);
      const gallery=(await tx.query("INSERT INTO app.galleries(kind,title) VALUES('public',$1) RETURNING id",[data.caption])).rows[0];
      await tx.query("INSERT INTO app.gallery_assets(gallery_id,asset_id,public_derivative_id) VALUES($1,$2,$3)",[gallery.id,assetId,derivativeId]);
      await tx.query(`INSERT INTO app.public_gallery_translations(gallery_id,locale,title,approved_by,approved_at) VALUES($1,$2,$3,$4,now())`,[gallery.id,declaration.locale,data.caption,actor.id]);
      await tx.query("UPDATE app.galleries SET visibility_state='published',published_at=now(),version=version+1 WHERE id=$1",[gallery.id]);
      await tx.query(`INSERT INTO app.audit_events(actor_type,actor_id,action,target_type,target_id) VALUES('staff',$1,'trip_photo_published','media_asset',$2)`,[actor.id,assetId]);
      return {galleryId:String(gallery.id),derivativeId};
    });
  }catch(error){
    // Leave the source available for a corrected consent record or a retried publication.
    // A dropped connection during COMMIT can leave its outcome unknown.
    const persisted=await query("SELECT 1 FROM app.media_derivatives WHERE id=$1",[derivativeId]);
    if(!persisted.rowCount)await store.remove(key);
    throw error;
  }
  if(publication.derivativeId!==derivativeId)await store.remove(key);
  return publication;
}
