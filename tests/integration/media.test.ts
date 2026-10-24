import {randomUUID,randomBytes,createHash} from "node:crypto";
import {afterAll,beforeAll,expect,it} from "vitest";
import sharp from "sharp";
import {admin,makeActor,makeBooking,makeDeparture,tourItem} from "../database/helpers";
import {createUploadIntent,receiveUpload,finalizeUpload,processMediaAsset,getGalleryManifest,issueDownloadGrant,streamAsset,servePrivateAsset,publishGallery} from "@/modules/photography/service";
import {submitReview,moderateReview} from "@/modules/reviews/service";
import {localStorage} from "@/integrations/storage";

const db=admin();
beforeAll(async()=>{await db.connect();process.env.STORAGE_PROVIDER="local";process.env.APP_ENV="test";});
afterAll(async()=>{await db.end();});
async function fixture(photo=false){
  const ownerId=await makeActor(db),photographerId=await makeActor(db,"photographer");
  const departure=await makeDeparture(db,8);
  const packageId=photo?randomUUID():null;
  if(packageId){
    await db.query(`INSERT INTO app.photo_packages(id,code,entitlement_rules,price_amount,currency,active) VALUES($1,$1::uuid::text,'{"previews":true,"downloads":1}',75000,'EGP',true)`,[packageId]);
    await db.query(`INSERT INTO app.photo_package_translations(package_id,locale,title,description,approved_by,approved_at) VALUES($1,'en','Synthetic photo package','One download',$2,now())`,[packageId,ownerId]);
  }
  const variant=(await db.query("SELECT id FROM app.service_variants WHERE id=md5('variant:photography')::uuid")).rows[0].id;
  const {booking}=await makeBooking(db,photo?[{kind:"photography",variantId:variant,participants:1,packageId,requestedStart:"2027-10-01T10:00:00+02:00"}]:[await tourItem(db,departure.id)]);
  const galleryId=randomUUID();
  await db.query(`INSERT INTO app.galleries(id,kind,booking_id,title,visibility_state,published_at) VALUES($1,'private',$2,'Synthetic private gallery','published',now())`,[galleryId,booking.id]);
  await db.query(`INSERT INTO app.photographer_assignments(staff_id,booking_id,access_starts_at,access_ends_at) VALUES($1,$2,now()-interval '1 hour',now()+interval '1 day')`,[photographerId,booking.id]);
  const sessionHash=randomBytes(32).toString("hex"),grantId=randomUUID(),sessionId=randomUUID();
  await db.query(`INSERT INTO app.access_grants(id,token_hash,purpose,gallery_id,scope,expires_at) VALUES($1,$2,'gallery',$3,ARRAY['gallery:read'],now()+interval '1 day')`,[grantId,randomBytes(32).toString("hex"),galleryId]);
  await db.query(`INSERT INTO app.guest_sessions(id,session_hash,grant_id,scope,expires_at) VALUES($1,$2,$3,ARRAY['gallery:read'],now()+interval '1 day')`,[sessionId,sessionHash,grantId]);
  return {owner:{type:"staff" as const,id:ownerId},photographer:{type:"staff" as const,id:photographerId},guest:{type:"guest" as const,sessionHash},galleryId,bookingId:booking.id,sessionId,grantId,packageId};
}
it("private_gallery_idor",async()=>{
  const a=await fixture(),b=await fixture();
  expect((await getGalleryManifest(a.guest,a.galleryId)).id).toBe(a.galleryId);
  await expect(getGalleryManifest(b.guest,a.galleryId)).rejects.toMatchObject({status:404});
  await expect(streamAsset(b.guest,{galleryId:a.galleryId,derivativeId:randomUUID()})).rejects.toMatchObject({status:404});
  await expect(localStorage().read("../outside.png")).rejects.toThrow("STORAGE_KEY_INVALID");
  await db.query("UPDATE app.guest_sessions SET scope=ARRAY['booking:read'] WHERE id=$1",[a.sessionId]);
  await expect(getGalleryManifest(a.guest,a.galleryId)).rejects.toMatchObject({status:404});
});
it("wrong_photographer_cannot_upload",async()=>{
  const a=await fixture(),b=await fixture();
  await expect(createUploadIntent(b.photographer,{galleryId:a.galleryId,mimeType:"image/png",sizeBytes:10,checksumSha256:"a".repeat(64)})).rejects.toMatchObject({status:404});
});
it("real_processing_download_entitlement_and_immediate_revocation",async()=>{
  const f=await fixture(true);
  const bytes=await sharp({create:{width:16,height:16,channels:3,background:"#146e80"}}).png().toBuffer();
  const intent=await createUploadIntent(f.photographer,{galleryId:f.galleryId,mimeType:"image/png",sizeBytes:bytes.length,checksumSha256:createHash("sha256").update(bytes).digest("hex")});
  await receiveUpload(intent.assetId,f.photographer,bytes);
  expect((await finalizeUpload(intent.assetId,f.photographer)).state).toBe("processing");
  expect((await getGalleryManifest(f.guest,f.galleryId)).assets).toHaveLength(0);
  await processMediaAsset(intent.assetId);
  expect((await getGalleryManifest(f.guest,f.galleryId)).assets).toHaveLength(1);
  await expect(issueDownloadGrant(f.guest,{galleryId:f.galleryId,assetIds:[intent.assetId],derivative:"original"})).rejects.toThrow("DOWNLOAD_NOT_ENTITLED");
  const item=(await db.query(`SELECT id FROM app.booking_items WHERE booking_id=$1 LIMIT 1`,[f.bookingId])).rows[0].id;
  await db.query(`INSERT INTO app.gallery_entitlements(booking_item_id,gallery_id,package_id,package_snapshot,payment_eligible,delivery_eligible,allowed_variants,allowed_count) SELECT $1,$2,$3,qi.snapshot->'package',true,true,ARRAY['original'],1 FROM app.booking_items bi JOIN app.quote_items qi ON qi.id=bi.quote_item_id WHERE bi.id=$1`,[item,f.galleryId,f.packageId]);
  await db.query(`UPDATE app.gallery_assets SET download_allowed=true WHERE gallery_id=$1`,[f.galleryId]);
  // Historical true flags cannot authorize a pending/unpaid/unfulfilled booking.
  await expect(async()=>{await issueDownloadGrant(f.guest,{galleryId:f.galleryId,assetIds:[intent.assetId],derivative:"original"});}).rejects.toThrow("DOWNLOAD_NOT_ENTITLED");
  const resource=(await db.query("INSERT INTO app.resources(kind,code,name,mode) VALUES('photographer',$1,'Synthetic camera operator','exclusive') RETURNING id",[randomUUID()])).rows[0].id;
  await db.query("SELECT app.assign_resource($1,NULL,$2,'2027-10-01T10:00:00+02:00','2027-10-01T14:00:00+02:00',1,$3)",[resource,item,f.owner.id]);
  await db.query("SELECT app.approve_booking($1,1,$2)",[f.bookingId,f.owner.id]);
  const receipt=(await db.query("SELECT app.record_offline_receipt($1,75000,'EGP','cash','Synthetic paid package',gen_random_uuid()::text,$2) r",[f.bookingId,f.owner.id])).rows[0].r;
  await expect(issueDownloadGrant(f.guest,{galleryId:f.galleryId,assetIds:[intent.assetId],derivative:"original"})).rejects.toThrow("DOWNLOAD_NOT_ENTITLED");
  await db.query("UPDATE app.booking_items SET fulfilment_state='fulfilled' WHERE id=$1",[item]);
  const download=await issueDownloadGrant(f.guest,{galleryId:f.galleryId,assetIds:[intent.assetId],derivative:"original"});
  const asset=await streamAsset(f.guest,{galleryId:f.galleryId,derivativeId:download.assets[0].derivativeId,downloadToken:download.token});
  expect(asset.bytes.equals(bytes)).toBe(true);
  expect(asset.headers["Cache-Control"]).toContain("no-store");
  const response=await servePrivateAsset(new Request("https://app.example.test/media"),f.guest,{galleryId:f.galleryId,derivativeId:download.assets[0].derivativeId,downloadToken:download.token});
  expect(Buffer.from(await response.arrayBuffer()).equals(bytes)).toBe(true);
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  const refund=(await db.query("SELECT app.request_refund($1,NULL,$2,1,'Synthetic refund','{}',$3) r",[f.bookingId,receipt.id,f.owner.id])).rows[0].r;
  await db.query("SELECT app.approve_refund($1,1,$2)",[refund.id,f.owner.id]);
  await db.query("SELECT app.complete_offline_refund($1,$2,$3)",[refund.id,randomUUID(),f.owner.id]);
  await expect(streamAsset(f.guest,{galleryId:f.galleryId,derivativeId:download.assets[0].derivativeId,downloadToken:download.token})).rejects.toThrow("DOWNLOAD_NOT_ENTITLED");
  await expect(servePrivateAsset(new Request("https://app.example.test/media"),f.guest,{galleryId:f.galleryId,derivativeId:download.assets[0].derivativeId,downloadToken:download.token})).rejects.toThrow("DOWNLOAD_NOT_ENTITLED");
  expect((await getGalleryManifest(f.guest,f.galleryId)).assets[0].downloadAllowed).toBe(false);
  await db.query("SELECT app.record_offline_receipt($1,1,'EGP','cash','Synthetic re-payment',gen_random_uuid()::text,$2)",[f.bookingId,f.owner.id]);
  await db.query(`UPDATE app.gallery_entitlements SET revoked_at=now() WHERE gallery_id=$1`,[f.galleryId]);
  await expect(streamAsset(f.guest,{galleryId:f.galleryId,derivativeId:download.assets[0].derivativeId,downloadToken:download.token})).rejects.toThrow("DOWNLOAD_NOT_ENTITLED");
});
it("public_gallery_requires_consent",async()=>{
  const f=await fixture(),galleryId=randomUUID();
  await db.query(`INSERT INTO app.galleries(id,kind,title) VALUES($1,'public','Synthetic pending consent')`,[galleryId]);
  const assetId=randomUUID();
  await db.query(`INSERT INTO app.media_assets(id,storage_bucket,storage_key,uploaded_by,mime_type,size_bytes,checksum_sha256,state,safe_at) VALUES($1,'tourism-private',$2,$3,'image/png',1,$4,'ready',now())`,[assetId,`${assetId}/source.bin`,f.owner.id,"a".repeat(64)]);
  await db.query(`INSERT INTO app.gallery_assets(gallery_id,asset_id) VALUES($1,$2)`,[galleryId,assetId]);
  await expect(publishGallery(f.owner,{galleryId,expectedVersion:1})).rejects.toMatchObject({code:"23514"});
});
it("review_completed_item_only",async()=>{
  const f=await fixture(),invitationId=randomUUID(),grantId=randomUUID(),sessionHash=randomBytes(32).toString("hex");
  const item=(await db.query(`SELECT id FROM app.booking_items WHERE booking_id=$1 LIMIT 1`,[f.bookingId])).rows[0].id;
  await db.query(`INSERT INTO app.review_invitations(id,booking_item_id,eligible_at,expires_at) VALUES($1,$2,now()-interval '1 hour',now()+interval '1 day')`,[invitationId,item]);
  await db.query(`INSERT INTO app.access_grants(id,token_hash,purpose,review_invitation_id,scope,expires_at) VALUES($1,$2,'review',$3,ARRAY['review:submit'],now()+interval '1 day')`,[grantId,randomBytes(32).toString("hex"),invitationId]);
  await db.query(`INSERT INTO app.guest_sessions(session_hash,grant_id,scope,expires_at) VALUES($1,$2,ARRAY['review:submit'],now()+interval '1 day')`,[sessionHash,grantId]);
  const guest={type:"guest" as const,sessionHash},input={invitationId,rating:1,text:"Synthetic critical feedback",locale:"en",displayName:"initials"};
  await expect(submitReview(guest,input)).rejects.toThrow("REVIEW_NOT_ELIGIBLE");
  await db.query(`UPDATE app.booking_items SET fulfilment_state='fulfilled' WHERE id=$1`,[item]);
  const review=await submitReview(guest,input);
  expect(review.state).toBe("pending");
  await expect(submitReview(guest,input)).rejects.toThrow("REVIEW_NOT_ELIGIBLE");
  await moderateReview(f.owner,{reviewId:review.id,expectedVersion:1,action:"publish",reason:"Relevant verified feedback"});
  const result=(await db.query(`SELECT rating,original_text FROM app.reviews WHERE id=$1`,[review.id])).rows[0];
  expect(result.rating).toBe(1);
  expect((await db.query(`SELECT count(*)::int n FROM app.review_moderation_events WHERE review_id=$1`,[review.id])).rows[0].n).toBe(1);
});
