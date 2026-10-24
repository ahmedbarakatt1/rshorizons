import {afterAll,afterEach,beforeAll,expect,test,vi} from "vitest";
import {randomUUID,scryptSync} from "node:crypto";
import {admin,makeActor} from "../database/helpers";
import {route} from "@/server/api/router";

const db=admin(),base="http://127.0.0.1:3000";
beforeAll(()=>db.connect());afterAll(()=>db.end());afterEach(()=>vi.unstubAllEnvs());
async function login(email:string,password:string){
  await db.query("DELETE FROM app.rate_limit_buckets WHERE operation IN('staff-auth','staff-password')");
  return route(new Request(`${base}/api/v1/admin/auth/login`,{method:"POST",headers:{origin:base,"content-type":"application/json"},body:JSON.stringify({email,password})}),["admin","auth","login"]);
}
test("local password sign-in rejects an unknown account without requiring cloud Auth",async()=>{
  const response=await login(`${randomUUID()}@example.invalid`,"synthetic-wrong-password");
  expect(response.status).toBe(401);
  expect((await response.json()).error.code).toBe("INVALID_CREDENTIALS");
});

async function credential(){
  const id=await makeActor(db),email=`${randomUUID()}@example.invalid`,password=`synthetic-${randomUUID()}`;
  const salt=randomUUID().replaceAll("-","").repeat(2);
  const hash=scryptSync(password,salt,64,{N:32768,r:8,p:3,maxmem:64*1024*1024}).toString("hex");
  await db.query("INSERT INTO app.local_staff_credentials(staff_id,email,password_salt,password_hash) VALUES($1,$2,$3,$4)",[id,email,salt,hash]);
  return {id,email,password};
}
test("a provisioned administrator signs in, sees management permissions, and logout invalidates the session",async()=>{
  const account=await credential();
  expect((await login(account.email,"wrong-password")).status).toBe(401);
  const response=await login(account.email.toUpperCase(),account.password);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({data:{requiresMfa:false}});
  const setCookie=response.headers.getSetCookie().find(v=>v.startsWith("rsh_local_staff="))!;
  expect(setCookie).toContain("HttpOnly");expect(setCookie).toContain("SameSite=Lax");
  const cookie=setCookie.split(";")[0];
  const session=await route(new Request(`${base}/api/v1/admin/session`,{headers:{cookie}}),["admin","session"]);
  expect(session.status).toBe(200);
  expect((await session.json()).data.permissions).toEqual(expect.arrayContaining(["catalog.write","galleries.manage","media.upload"]));
  const logout=await route(new Request(`${base}/api/v1/admin/auth/logout`,{method:"POST",headers:{cookie,origin:base}}),["admin","auth","logout"]);
  expect(logout.status).toBe(200);
  expect((await route(new Request(`${base}/api/v1/admin/session`,{headers:{cookie}}),["admin","session"])).status).toBe(401);
});
test("disabled staff cannot obtain a local password session",async()=>{
  const account=await credential();await db.query("UPDATE app.staff_profiles SET active=false WHERE id=$1",[account.id]);
  expect((await login(account.email,account.password)).status).toBe(401);
  expect((await db.query("SELECT count(*)::int n FROM app.local_operator_sessions WHERE staff_id=$1",[account.id])).rows[0].n).toBe(0);
});
test("local credentials never authenticate in staging or when demonstration mode is disabled",async()=>{
  const account=await credential();
  vi.stubEnv("APP_ENV","staging");vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL","");vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY","");
  expect((await login(account.email,account.password)).status).toBe(503);
  vi.stubEnv("APP_ENV","test");vi.stubEnv("DEMO_MODE","false");
  expect((await login(account.email,account.password)).status).toBe(503);
});
test("an existing local session cannot cross into a hosted configuration or non-loopback request",async()=>{
  const account=await credential(),response=await login(account.email,account.password);
  expect(response.status).toBe(200);
  const cookie=response.headers.getSetCookie().find(v=>v.startsWith("rsh_local_staff="))!.split(";")[0];
  const session=(origin=base)=>route(new Request(`${origin}/api/v1/admin/session`,{headers:{cookie}}),["admin","session"]);
  expect((await session("https://preview.example.invalid")).status).toBe(401);
  for(const [key,value] of [["VERCEL","1"],["NEXT_PUBLIC_SUPABASE_URL","https://test.supabase.co"],["APP_BASE_URL","https://preview.example.invalid"],["DATABASE_URL","postgres://test@remote.example.invalid/test"]]){
    vi.stubEnv(key,value);expect((await session()).status).toBe(401);vi.unstubAllEnvs();
  }
});
