import {afterAll,beforeAll,expect,test} from "vitest";
import {randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {admin,runtime} from "../database/helpers";
const db=admin();beforeAll(()=>db.connect());afterAll(()=>db.end());
function provision(input:object,...flags:string[]){
  return spawnSync(process.execPath,["--import","tsx","scripts/provision-admin.ts","--local",...flags],{input:JSON.stringify(input),encoding:"utf8",windowsHide:true,env:process.env});
}
test("explicit local provisioning stores only salted hashes and rotation revokes previous sessions",async()=>{
  const email=`${randomUUID()}@example.invalid`,password=`Synthetic-${randomUUID()}`;
  const created=provision({email,password,name:"Synthetic administrator"});
  expect(created.status,created.stderr).toBe(0);
  expect(created.stdout+created.stderr).not.toContain(password);
  const account=(await db.query("SELECT * FROM app.local_staff_credentials WHERE email=$1",[email])).rows[0];
  expect(account.password_hash).not.toBe(password);expect(account.password_hash).toHaveLength(128);
  expect((await db.query("SELECT app.has_permission($1,'catalog.write') ok,app.has_permission($1,'media.upload') media",[account.staff_id])).rows[0]).toEqual({ok:true,media:true});
  expect(provision({email,password,name:"Synthetic administrator"}).status).toBe(1);
  await db.query("INSERT INTO app.local_operator_sessions(staff_id,token_hash,expires_at,redeemed_at) VALUES($1,$2,now()+interval '1 hour',now())",[account.staff_id,randomUUID().replaceAll("-","").repeat(2)]);
  const rotated=provision({email,password:`Changed-${randomUUID()}`,name:"Synthetic administrator"},"--rotate");
  expect(rotated.status,rotated.stderr).toBe(0);
  expect((await db.query("SELECT password_hash FROM app.local_staff_credentials WHERE email=$1",[email])).rows[0].password_hash).not.toBe(account.password_hash);
  expect((await db.query("SELECT count(*)::int n FROM app.local_operator_sessions WHERE staff_id=$1 AND revoked_at IS NULL",[account.staff_id])).rows[0].n).toBe(0);
});
test("runtime cannot provision or replace password hashes",async()=>{
  const client=runtime();await client.connect();
  try{await expect(client.query("UPDATE app.local_staff_credentials SET password_hash=repeat('a',128)")).rejects.toMatchObject({code:"42501"});}finally{await client.end();}
});
