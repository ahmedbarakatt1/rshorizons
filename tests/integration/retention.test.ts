import {randomUUID,createHash} from "node:crypto";
import {afterEach,expect,it,vi} from "vitest";
import {admin,makeActor,makeBooking,makeDeparture,tourItem} from "../database/helpers";
import {localStorage} from "@/integrations/storage";
import {cleanupExpiredMedia} from "@/modules/photography/retention";

afterEach(()=>vi.unstubAllEnvs());
it("retention dry-run cannot delete and execution requires explicit approved policy",async()=>{
  vi.stubEnv("APP_ENV","test");vi.stubEnv("STORAGE_PROVIDER","local");vi.stubEnv("RETENTION_POLICY_APPROVED","false");
  const db=admin();await db.connect();
  try{
    const actor=await makeActor(db),asset=randomUUID(),key=`${asset}/source.bin`,bytes=Buffer.from("synthetic retention fixture");
    await localStorage().put(key,bytes,"image/png");
    await db.query("INSERT INTO app.media_assets(id,storage_bucket,storage_key,uploaded_by,mime_type,size_bytes,checksum_sha256,state,safe_at,retention_deadline) VALUES($1,'tourism-private',$2,$3,'image/png',$4,$5,'ready',now(),now()-interval '1 hour')",[asset,key,actor,bytes.length,createHash("sha256").update(bytes).digest("hex")]);
    const dry=await cleanupExpiredMedia({dryRun:true,limit:100});
    expect(dry.eligibleAssetIds).toContain(asset);expect((await localStorage().read(key)).equals(bytes)).toBe(true);
    await expect(cleanupExpiredMedia({dryRun:false,limit:100})).rejects.toThrow("RETENTION_POLICY_UNAPPROVED");
    vi.stubEnv("RETENTION_POLICY_APPROVED","true");
    const live=await cleanupExpiredMedia({dryRun:false,limit:100});
    expect(live.purgedAssetIds).toContain(asset);
    await expect(localStorage().read(key)).rejects.toMatchObject({code:"ENOENT"});
    expect((await db.query("SELECT state FROM app.media_assets WHERE id=$1",[asset])).rows[0].state).toBe("deleted");
  }finally{await db.end();}
});
it("retention excludes active galleries and even unpaid active entitlements",async()=>{
  vi.stubEnv("APP_ENV","test");vi.stubEnv("STORAGE_PROVIDER","local");vi.stubEnv("RETENTION_POLICY_APPROVED","true");
  const db=admin();await db.connect();
  try{
    const actor=await makeActor(db),dep=await makeDeparture(db),{booking}=await makeBooking(db,[await tourItem(db,dep.id)]);
    const item=(await db.query("SELECT id FROM app.booking_items WHERE booking_id=$1",[booking.id])).rows[0].id;
    const gallery=(await db.query("INSERT INTO app.galleries(kind,booking_id,title) VALUES('private',$1,'Synthetic retained') RETURNING id",[booking.id])).rows[0].id;
    const asset=randomUUID(),key=`${asset}/source.bin`;
    await localStorage().put(key,Buffer.from("synthetic"),"image/png");
    await db.query("INSERT INTO app.media_assets(id,storage_bucket,storage_key,uploaded_by,mime_type,size_bytes,checksum_sha256,state,retention_deadline) VALUES($1,'tourism-private',$2,$3,'image/png',9,$4,'quarantine',now()-interval '1 hour')",[asset,key,actor,"a".repeat(64)]);
    await db.query("INSERT INTO app.gallery_assets(gallery_id,asset_id) VALUES($1,$2)",[gallery,asset]);
    expect((await cleanupExpiredMedia({dryRun:true,limit:100})).eligibleAssetIds).not.toContain(asset);
    await db.query("UPDATE app.galleries SET visibility_state='revoked' WHERE id=$1",[gallery]);
    const pack=(await db.query("INSERT INTO app.photo_packages(code,entitlement_rules,price_amount,currency) VALUES($1,'{}',0,'EGP') RETURNING id",[randomUUID()])).rows[0].id;
    await db.query("INSERT INTO app.gallery_entitlements(booking_item_id,gallery_id,package_id,package_snapshot) VALUES($1,$2,$3,'{}')",[item,gallery,pack]);
    expect((await cleanupExpiredMedia({dryRun:false,limit:100})).purgedAssetIds).not.toContain(asset);
    expect((await localStorage().read(key)).toString()).toBe("synthetic");
  }finally{await db.end();}
});
