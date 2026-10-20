import {randomBytes} from "node:crypto";
import {afterAll,beforeAll,expect,test} from "vitest";
import {admin,makeActor,makeBooking,makeDeparture,tourItem} from "./helpers";
const db=admin();beforeAll(()=>db.connect());afterAll(()=>db.end());
test("expired_auth_cleanup_is_bounded_and_preserves_history_and_live_tokens",async()=>{
 await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
 try{
  const actor=await makeActor(db),d=await makeDeparture(db),{booking}=await makeBooking(db,[await tourItem(db,d.id)]);
  const expiredHash=randomBytes(32).toString("hex"),liveHash=randomBytes(32).toString("hex");
  const expiredGrant=(await db.query("INSERT INTO app.access_grants(token_hash,purpose,booking_id,scope,expires_at) VALUES($1,'booking',$2,ARRAY['booking:read'],'1900-01-01') RETURNING id",[expiredHash,booking.id])).rows[0].id;
  const liveGrant=(await db.query("INSERT INTO app.access_grants(token_hash,purpose,booking_id,scope,expires_at) VALUES($1,'booking',$2,ARRAY['booking:read'],now()+interval '1 hour') RETURNING id",[liveHash,booking.id])).rows[0].id;
  const session=(await db.query("INSERT INTO app.guest_sessions(session_hash,grant_id,scope,expires_at) VALUES($1,$2,ARRAY['booking:read'],'1900-01-01') RETURNING id",[expiredHash,expiredGrant])).rows[0].id;
  const operator=(await db.query("INSERT INTO app.local_operator_sessions(staff_id,token_hash,expires_at) VALUES($1,$2,'1900-01-01') RETURNING id",[actor,expiredHash])).rows[0].id;
  const bucket=(await db.query("INSERT INTO app.rate_limit_buckets(key_digest,operation,window_started_at,window_seconds,counter,resets_at) VALUES($1,'cleanup-test','1900-01-01 00:00:00+00',60,1,'1900-01-01 00:01:00+00') RETURNING id",[expiredHash])).rows[0].id;
  const counts=async()=>(await db.query("SELECT (SELECT count(*) FROM app.cash_ledger)::text finance,(SELECT count(*) FROM app.audit_events)::text audit,(SELECT count(*) FROM app.publication_consents)::text consent")).rows[0];
  const before=await counts();
  const first=(await db.query("SELECT app.cleanup_expired_auth(1) r")).rows[0].r;
  expect(first.total).toBe(1);
  for(let n=0;n<5;n++)await db.query("SELECT app.cleanup_expired_auth(1000)");
  for(const [table,id,column] of [["access_grants",expiredGrant,"token_hash"],["guest_sessions",session,"session_hash"],["local_operator_sessions",operator,"token_hash"]]){
   const row=(await db.query(`SELECT ${column} AS hash,token_erased_at FROM app.${table} WHERE id=$1`,[id])).rows[0];
   expect(row.hash).not.toBe(expiredHash);expect(row.token_erased_at).toBeTruthy();
  }
  expect((await db.query("SELECT token_hash,token_erased_at FROM app.access_grants WHERE id=$1",[liveGrant])).rows[0]).toEqual({token_hash:liveHash,token_erased_at:null});
  expect((await db.query("SELECT 1 FROM app.rate_limit_buckets WHERE id=$1",[bucket])).rowCount).toBe(0);
  expect(await counts()).toEqual(before);
 }finally{await db.query("ROLLBACK");}
});
test("auth_cleanup_rejects_unbounded_batch",async()=>{
 await expect(db.query("SELECT app.cleanup_expired_auth(1001)")).rejects.toThrow("INVALID_CLEANUP_LIMIT");
 await expect(db.query("SELECT app.cleanup_expired_auth(0)")).rejects.toThrow("INVALID_CLEANUP_LIMIT");
});
