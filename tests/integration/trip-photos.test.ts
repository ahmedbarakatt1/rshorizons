import {createHash} from "node:crypto";
import {afterAll,beforeAll,expect,it} from "vitest";
import sharp from "sharp";
import {admin,makeActor} from "../database/helpers";
import {startTripPhoto,storeTripPhoto,publishTripPhoto} from "@/modules/photography/trip-photos";
import {listPublicGalleries,streamPublicDerivative} from "@/modules/photography/service";

const db=admin();
beforeAll(async()=>{if(!["127.0.0.1","localhost"].includes(new URL(process.env.MIGRATION_DATABASE_URL!).hostname))throw new Error("Loopback fixture database required");await db.connect();process.env.STORAGE_PROVIDER="local";process.env.APP_ENV="test";});
afterAll(()=>db.end());

it("publishes one processed owner photo across locales, keeps the source private and safely retries",async()=>{
  const owner={type:"staff" as const,id:await makeActor(db)};
  const editor={type:"staff" as const,id:await makeActor(db,"content_editor")};
  const bytes=await sharp({create:{width:30,height:20,channels:3,background:"#4488aa"}}).png().toBuffer();
  const declaration={mimeType:"image/png",sizeBytes:bytes.length,checksumSha256:createHash("sha256").update(bytes).digest("hex"),locale:"ar",retentionDays:30};
  await expect(startTripPhoto(editor,declaration)).rejects.toMatchObject({status:403});
  const {assetId}=await startTripPhoto(owner,declaration);
  const input={caption:"رحلة بحرية",rightsEvidenceRef:"isolated rights record",subjectsReviewed:true,subjects:[]};
  await expect(storeTripPhoto(editor,assetId,bytes)).rejects.toMatchObject({status:403});
  await storeTripPhoto(owner,assetId,bytes);
  await expect(publishTripPhoto(editor,assetId,input)).rejects.toMatchObject({status:403});
  await expect(publishTripPhoto(owner,assetId,{...input,subjectsReviewed:false})).rejects.toThrow();
  await expect(publishTripPhoto(owner,assetId,{...input,rightsEvidenceRef:""})).rejects.toThrow();
  const [first,second]=await Promise.all([publishTripPhoto(owner,assetId,input),publishTripPhoto(owner,assetId,input)]);
  expect(first).toEqual(second);
  const {derivativeId,galleryId}=first;
  const publicBytes=await streamPublicDerivative(derivativeId);
  expect(publicBytes.mimeType).toBe("image/webp");
  expect(publicBytes.bytes.equals(bytes)).toBe(false);
  expect((await listPublicGalleries("en")).find(g=>g.id===galleryId)).toMatchObject({title:input.caption,caption_locale:"ar"});
  await expect(streamPublicDerivative(assetId)).rejects.toMatchObject({status:404});
  expect((await db.query("SELECT count(*)::int n FROM app.media_processing_jobs WHERE asset_id=$1",[assetId])).rows[0].n).toBe(0);
  await db.query("UPDATE app.galleries SET visibility_state='revoked' WHERE id=$1",[galleryId]);
  await expect(streamPublicDerivative(derivativeId)).rejects.toMatchObject({status:404});
});

it("keeps consent evidence private and checks the guardian permission expiry when a guest requests the photo",async()=>{
  const owner={type:"staff" as const,id:await makeActor(db)};
  const people=await db.query("INSERT INTO app.guests(full_name,email,locale) VALUES('Fixture guest','guest@example.invalid','en'),('Fixture guardian','guardian@example.invalid','en') RETURNING id");
  const [guestId,guardianId]=people.rows.map(row=>row.id);
  const bytes=await sharp({create:{width:28,height:18,channels:3,background:"#667788"}}).jpeg().toBuffer();
  const intent=await startTripPhoto(owner,{mimeType:"image/jpeg",sizeBytes:bytes.length,checksumSha256:createHash("sha256").update(bytes).digest("hex"),locale:"en",retentionDays:10});
  await storeTripPhoto(owner,intent.assetId,bytes);
  const subject={guestId,guardianId,evidenceRef:"Private guardian agreement"};
  const details={caption:"Family outing",rightsEvidenceRef:"Private licence",subjectsReviewed:true,subjects:[subject]};
  await expect(publishTripPhoto(owner,intent.assetId,{...details,subjects:[{...subject,evidenceRef:""}]})).rejects.toThrow();
  await expect(publishTripPhoto(owner,intent.assetId,{...details,subjects:[{...subject,expiresAt:"2020-01-01T00:00:00Z"}]})).rejects.toThrow();
  expect((await db.query("SELECT state FROM app.media_assets WHERE id=$1",[intent.assetId])).rows[0].state).toBe("quarantine");
  const published=await publishTripPhoto(owner,intent.assetId,details);
  const consent=(await db.query("SELECT granted_by_guest_id,allowed_uses FROM app.publication_consents WHERE asset_id=$1",[intent.assetId])).rows[0];
  expect(consent).toEqual({granted_by_guest_id:guardianId,allowed_uses:["website","marketing"]});
  const result=(await listPublicGalleries("ar")).find(gallery=>gallery.id===published.galleryId);
  expect(result).toBeDefined();expect(JSON.stringify(result)).not.toContain("Private");
  // Advance this isolated fixture's timeline. Runtime requests still use the normal
  // restricted connection and read an unmodified, published gallery with expired consent.
  await db.query("BEGIN");
  try{
    await db.query("SET LOCAL session_replication_role='replica'");
    await db.query("UPDATE app.publication_consents SET granted_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE asset_id=$1",[intent.assetId]);
    await db.query("COMMIT");
  }catch(error){await db.query("ROLLBACK");throw error;}
  expect((await listPublicGalleries("en")).some(g=>g.id===published.galleryId)).toBe(false);
  await expect(streamPublicDerivative(published.derivativeId)).rejects.toMatchObject({status:404});
  await db.query("UPDATE app.galleries SET visibility_state='revoked' WHERE id=$1",[published.galleryId]);
});
