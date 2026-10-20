import {randomUUID} from "node:crypto";
import {beforeAll,afterAll,test,expect} from "vitest";
import {route} from "@/server/api/router";
import {newSecret,digestSecret} from "@/server/security";
import {admin,makeActor,makeDeparture,tourItem} from "../database/helpers";
const db=admin(),base="http://127.0.0.1:3000";
let staffCookie:string,guestCookie:string,bindingCookie:string,bookingId:string,reference:string;
async function call(path:string,method="GET",body?:unknown,cookie="",headers:Record<string,string>={}){
  const response=await route(new Request(`${base}/api/v1/${path}`,{method,headers:{origin:base,...body?{"content-type":"application/json"}:{},cookie,...headers},...body?{body:JSON.stringify(body)}:{}}),path.split("?")[0].split("/"));
  return {response,json:await response.json()};
}
beforeAll(async()=>{
  await db.connect();const actor=await makeActor(db),token=newSecret();
  await db.query("INSERT INTO app.local_operator_sessions(staff_id,token_hash,expires_at,redeemed_at) VALUES($1,$2,now()+interval '1 hour',now())",[actor,digestSecret(token)]);
  staffCookie=`rsh_local_staff=${token}`;
});
afterAll(()=>db.end());
test("public_catalog_and_policy_contract_use_database",async()=>{
  const catalog=await call("catalog?locale=ar"),policies=await call("policies/current?locale=ar");
  expect(catalog.response.status).toBe(200);expect(catalog.json.data.services.length).toBeGreaterThan(0);
  expect(policies.json.data.terms).toBe("demo-v1");expect(policies.json.data.privacy).toBe("demo-v1");
});
test("guest_request_staff_approval_real_runtime_boundary",async()=>{
  const departure=await makeDeparture(db,4),item=await tourItem(db,departure.id,1);
  const quoted=await call("quotes","POST",{locale:"en",paymentPolicy:"arrival",items:[item]});
  expect(quoted.response.status,JSON.stringify(quoted.json)).toBe(201);
  bindingCookie=quoted.response.headers.getSetCookie()[0].split(";")[0];
  expect(quoted.json.data.totalAmountMinor).toBe("100000");
  const body={quoteId:quoted.json.data.id,guest:{fullName:"API synthetic guest",email:"api@example.invalid",locale:"en"},participants:[{displayName:"API Guest",ageCategory:"adult"}],consents:{termsAccepted:true,whatsappBookingUpdates:false,marketing:false,publicMediaUse:false,termsVersion:quoted.json.data.policyVersions.terms,privacyNoticeVersion:quoted.json.data.policyVersions.privacy}};
  const requested=await call("bookings","POST",body,bindingCookie,{"idempotency-key":randomUUID()});
  expect(requested.response.status,JSON.stringify(requested.json)).toBe(201);expect(requested.json.data.status).toBe("pending_review");expect(requested.json.data.paymentRequested).toBe(false);
  reference=requested.json.data.reference;guestCookie=requested.response.headers.getSetCookie()[0].split(";")[0];
  const detail=await call(`bookings/${reference}`,"GET",undefined,guestCookie);
  expect(detail.response.status,JSON.stringify(detail.json)).toBe(200);bookingId=detail.json.data.id;
  const approval=await call(`admin/bookings/${bookingId}/approve`,"POST",{expectedVersion:1},staffCookie);
  expect(approval.response.status,JSON.stringify(approval.json)).toBe(200);expect(approval.json.data.status).toBe("confirmed");
  const changed=await call(`bookings/${reference}/change-requests`,"POST",{reason:"Prefer the next departure",proposedChanges:{message:"Next day please"}},guestCookie);
  expect(changed.response.status,JSON.stringify(changed.json)).toBe(201);
  const still=await call(`bookings/${reference}`,"GET",undefined,guestCookie);
  expect(still.json.data.status).toBe("confirmed");expect(still.json.data.requests).toHaveLength(1);
  const conflict=await call(`admin/bookings/${bookingId}/cancel`,"POST",{expectedVersion:1,reason:"Stale tab"},staffCookie);
  expect(conflict.response.status,JSON.stringify(conflict.json)).toBe(409);
});
test("guest_link_prefetch and guest access IDOR/CSRF are rejected",async()=>{
  const noSession=await call(`bookings/${reference}`);expect(noSession.response.status).toBe(401);
  const wrong=await call("bookings/RSH-NOT-OWNED","GET",undefined,guestCookie);expect(wrong.response.status).toBe(404);
  const csrf=await call("quotes","POST",{},bindingCookie,{origin:"https://attacker.invalid"});expect(csrf.response.status).toBe(403);
  const token=newSecret();const grant=await db.query("INSERT INTO app.access_grants(token_hash,purpose,booking_id,scope,expires_at) VALUES($1,'booking',$2,ARRAY['booking:read'],now()+interval '1 hour') RETURNING id",[digestSecret(token),bookingId]);
  const prefetch=await call(`guest-access/redeem?token=${token}`);expect(prefetch.response.status).toBe(404);
  expect((await db.query("SELECT used_at FROM app.access_grants WHERE id=$1",[grant.rows[0].id])).rows[0].used_at).toBeNull();
  const redeemed=await call("guest-access/redeem","POST",{token});expect(redeemed.response.status).toBe(200);
  const replay=await call("guest-access/redeem","POST",{token});expect(replay.response.status).toBe(410);
});
test("staff_editor_and_admin_read_endpoints_are_executable",async()=>{
  for(const endpoint of ["session","summary","lookups","services","departures","apartments","stays","pickup-locations","variant-pickups","resources","transport","guests","payments","refunds","financial-exceptions","galleries","pages","reviews","notification-deliveries","jobs","staff","audit-events","settings","reports/bookings","reports/finance","reports/occupancy"]){
    const result=await call(`admin/${endpoint}`,"GET",undefined,staffCookie);
    expect(result.response.status,`${endpoint}: ${JSON.stringify(result.json)}`).toBe(200);
  }
  const resource=await call("admin/resources","POST",{code:`test-${randomUUID()}`,kind:"guide",name:"Synthetic guide",mode:"exclusive",capacity:1},staffCookie);
  expect(resource.response.status,JSON.stringify(resource.json)).toBe(201);
  const result=await call(`admin/resources/${resource.json.data.id}/blocks`,"POST",{startsAt:"2031-01-01T10:00:00Z",endsAt:"2031-01-01T12:00:00Z",reason:"Synthetic maintenance",expectedVersion:1},staffCookie);
  expect(result.response.status,JSON.stringify(result.json)).toBe(200);
});
test("bad_signature_no_financial_effect",async()=>{
  const before=(await db.query("SELECT count(*)::int n FROM app.cash_ledger")).rows[0].n;
  const event=await call("webhooks/paymob","POST",{type:"TRANSACTION",obj:{}});
  expect(event.response.status).toBe(401);
  expect((await db.query("SELECT count(*)::int n FROM app.cash_ledger")).rows[0].n).toBe(before);
});
test("redirect_cannot_mark_paid",async()=>{
 const snapshot=async()=>(await db.query("SELECT b.status,b.version,(SELECT count(*) FROM app.cash_ledger l WHERE l.booking_id=b.id)::int ledger FROM app.bookings b WHERE b.id=$1",[bookingId])).rows[0];
 const before=await snapshot();
 const redirect=await call(`bookings/${reference}?payment=success&success=true&amount_cents=99999999`,"GET",undefined,guestCookie);
 expect(redirect.response.status).toBe(200);
 const callback=await call("webhooks/paymob?success=true&hmac=forged","GET");
 expect(callback.response.status).toBe(404);
 expect(await snapshot()).toEqual(before);
});
