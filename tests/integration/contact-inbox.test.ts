import {randomUUID} from "node:crypto";
import {beforeAll,afterAll,expect,test} from "vitest";
import {admin,makeActor} from "../database/helpers";
import {submitContact} from "@/modules/content/contact";
import {route} from "@/server/api/router";
import {newSecret,digestSecret} from "@/server/security";
import pg from "pg";

const db=admin(),base=process.env.APP_BASE_URL??"http://127.0.0.1:3000";
beforeAll(()=>db.connect());afterAll(()=>db.end());
async function login(role="owner"){
  const id=await makeActor(db,role),token=newSecret();
  await db.query("INSERT INTO app.local_operator_sessions(staff_id,token_hash,expires_at,redeemed_at) VALUES($1,$2,now()+interval '1 hour',now())",[id,digestSecret(token)]);
  return {id,cookie:`rsh_local_staff=${token}`};
}
async function call(path:string,cookie="",body?:unknown){
  const response=await route(new Request(`${base}/api/v1/${path}`,{method:body?"PATCH":"GET",headers:{origin:base,cookie,"content-type":"application/json"},...(body?{body:JSON.stringify(body)}:{})}),path.split("?")[0].split("/"));
  return {status:response.status,cache:response.headers.get("cache-control"),body:await response.json()};
}
test("contact submission reaches a protected staff inbox and versioned audited resolution without exposing expired messages",async()=>{
  const owner=await login(),finance=await login("finance");
  const received=await submitContact({name:"Synthetic contact",email:"contact@example.invalid",locale:"en",message:"Please help arrange an accessible pickup.",consent:true,privacyVersion:"demo-v1"},{rateLimitKeyDigest:digestSecret(randomUUID())});
  if(!("id" in received))throw new Error("Contact fixture was not persisted");
  const id=received.id;
  expect((await call("admin/contact")).status).toBe(401);
  expect((await call(`admin/contact/${id}`,finance.cookie)).status).toBe(403);
  const inbox=await call("admin/contact",owner.cookie);expect(inbox.status).toBe(200);expect(inbox.cache).toContain("no-store");
  expect(inbox.body.data.items).toEqual(expect.arrayContaining([expect.objectContaining({id,sender_name:"Synthetic contact",state:"new"})]));
  const detail=await call(`admin/contact/${id}`,owner.cookie);expect(detail.status).toBe(200);expect(detail.body.data.message).toBe("Please help arrange an accessible pickup.");
  expect((await call(`admin/contact/${id}`,finance.cookie,{state:"closed",expectedVersion:1})).status).toBe(403);
  const closed=await call(`admin/contact/${id}`,owner.cookie,{state:"closed",expectedVersion:1});expect(closed.status).toBe(200);expect(closed.body.data).toMatchObject({id,state:"closed",version:2});
  expect((await call(`admin/contact/${id}`,owner.cookie,{state:"replied",expectedVersion:1})).status).toBe(409);
  const stored=(await db.query("SELECT message,state,version FROM app.contact_requests WHERE id=$1",[id])).rows[0];expect(stored).toMatchObject({message:"Please help arrange an accessible pickup.",state:"closed",version:2});
  const audit=(await db.query("SELECT summary FROM app.audit_events WHERE target_id=$1 AND action='contact_state_changed'",[id])).rows;expect(audit).toHaveLength(1);expect(JSON.stringify(audit)).not.toContain("accessible pickup");expect(JSON.stringify(audit)).not.toContain("contact@example.invalid");
  await db.query("UPDATE app.contact_requests SET created_at=now()-interval '2 days',retention_deadline=now()-interval '1 day' WHERE id=$1",[id]);
  expect((await call(`admin/contact/${id}`,owner.cookie)).status).toBe(404);
  expect((await call("admin/contact",owner.cookie)).body.data.items).not.toEqual(expect.arrayContaining([expect.objectContaining({id})]));
});

test("contact access follows current owner activity and global scope",async()=>{
  const owner=await login();
  await db.query("DELETE FROM app.staff_scopes WHERE staff_id=$1",[owner.id]);
  expect((await call("admin/contact",owner.cookie)).status).toBe(403);
  await db.query("INSERT INTO app.staff_scopes(staff_id,scope_type) VALUES($1,'all')",[owner.id]);
  await db.query("UPDATE app.staff_profiles SET active=false WHERE id=$1",[owner.id]);
  expect((await call("admin/contact",owner.cookie)).status).toBe(403);
});

test("staff can page to unresolved retained enquiries beyond the first 200 and filter state on the server",async()=>{
 const owner=await login();
 const inserted=await db.query(`INSERT INTO app.contact_requests(sender_name,email,locale,message,consent_metadata,created_at,retention_deadline)
  SELECT 'Synthetic paged enquiry','paged@example.invalid','en','Please arrange a pickup.','{}',now()-make_interval(secs=>n),now()+interval '90 days' FROM generate_series(1,205) n RETURNING id`);
 const ids=inserted.rows.map(row=>row.id);
 try{
  const seen=new Set<string>();let cursor:string|null=null;
  for(let page=0;page<20;page++){
   const result=await call(`admin/contact?state=new${cursor?`&after=${cursor}`:""}`,owner.cookie);expect(result.status).toBe(200);expect(result.body.data.items.length).toBeLessThanOrEqual(50);
   for(const item of result.body.data.items){expect(item.state).toBe("new");expect(seen.has(item.id)).toBe(false);seen.add(item.id);}
   cursor=result.body.data.nextCursor;if(!cursor)break;
  }
  for(const id of ids)expect(seen.has(id)).toBe(true);
  await db.query("UPDATE app.contact_requests SET state='closed' WHERE id=$1",[ids[0]]);
  const closed=await call("admin/contact?state=closed",owner.cookie);expect(closed.body.data.items.every((item:{state:string})=>item.state==="closed")).toBe(true);expect(closed.body.data.items).toEqual(expect.arrayContaining([expect.objectContaining({id:ids[0]})]));
 }finally{await db.query("DELETE FROM app.contact_requests WHERE id=ANY($1::uuid[])",[ids]);}
});

test("contact resolution serializes independent connections and checks current authority in SQL",async()=>{
 const owner=await login();const request=await submitContact({name:"Synthetic race",email:"race@example.invalid",locale:"en",message:"Please arrange pickup.",consent:true,privacyVersion:"demo-v1"},{rateLimitKeyDigest:digestSecret(randomUUID())});if(!("id" in request))throw new Error("Missing fixture");
 const first=new pg.Client({connectionString:process.env.DATABASE_URL}),second=new pg.Client({connectionString:process.env.DATABASE_URL});await first.connect();await second.connect();
 try{
  await db.query("DELETE FROM app.staff_scopes WHERE staff_id=$1",[owner.id]);
  await expect(first.query("SELECT app.update_contact_state($1,1,'closed',$2)",[request.id,owner.id])).rejects.toThrow("SCOPE_FORBIDDEN");
  await db.query("INSERT INTO app.staff_scopes(staff_id,scope_type) VALUES($1,'all')",[owner.id]);
  const updates=await Promise.allSettled([first.query("SELECT app.update_contact_state($1,1,'closed',$2)",[request.id,owner.id]),second.query("SELECT app.update_contact_state($1,1,'replied',$2)",[request.id,owner.id])]);
  expect(updates.filter(result=>result.status==="fulfilled")).toHaveLength(1);expect(updates.filter(result=>result.status==="rejected").map(result=>String(result.reason))).toEqual([expect.stringContaining("VERSION_CONFLICT")]);
  await db.query("UPDATE app.staff_profiles SET active=false WHERE id=$1",[owner.id]);await expect(first.query("SELECT app.update_contact_state($1,2,'closed',$2)",[request.id,owner.id])).rejects.toThrow("FORBIDDEN");
 }finally{await first.end();await second.end();}
});
