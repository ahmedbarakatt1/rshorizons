import {randomUUID} from "node:crypto";
import {beforeAll,afterAll,test,expect} from "vitest";
import {admin,makeActor,makeDeparture,makeBooking,tourItem} from "../database/helpers";
import {newSecret,digestSecret} from "@/server/security";
import {route} from "@/server/api/router";
const db=admin(),base="http://127.0.0.1:3000";
beforeAll(()=>db.connect());afterAll(()=>db.end());
async function staff(role:string){
  const id=await makeActor(db,role),token=newSecret();
  await db.query("INSERT INTO app.local_operator_sessions(staff_id,token_hash,expires_at,redeemed_at) VALUES($1,$2,now()+interval '1 hour',now())",[id,digestSecret(token)]);
  return {id,cookie:`rsh_local_staff=${token}`};
}
async function request(path:string,cookie:string,body?:unknown) {
  const response=await route(new Request(`${base}/api/v1/${path}`,{method:body?"POST":"GET",headers:{cookie,origin:base,...body?{"content-type":"application/json"}:{}},...body?{body:JSON.stringify(body)}:{}}),path.split("/"));
  return {status:response.status,data:await response.json()};
}
test("disabled_staff_stale_session_is_denied_on_every_action",async()=>{
  const actor=await staff("owner");
  expect((await request("admin/session",actor.cookie)).status).toBe(200);
  await db.query("UPDATE app.staff_profiles SET active=false,revoked_at=now() WHERE id=$1",[actor.id]);
  expect((await request("admin/session",actor.cookie)).status).toBe(403);
  expect((await request("admin/resources",actor.cookie,{code:`x-${randomUUID()}`,kind:"guide",name:"Forbidden",mode:"exclusive",capacity:1})).status).toBe(403);
});
test("staff_accounts_use_password_only_without_an_authenticator_requirement",async()=>{
  const id=await makeActor(db,"owner");
  const profile=await db.query("SELECT mfa_required FROM app.staff_profiles WHERE id=$1",[id]);
  expect(profile.rows[0].mfa_required).toBe(false);
});
test("operations_cannot_approve_or_read_finance",async()=>{
  const actor=await staff("operations"),departure=await makeDeparture(db),{booking}=await makeBooking(db,[await tourItem(db,departure.id)]);
  expect((await request(`admin/bookings/${booking.id}/approve`,actor.cookie,{expectedVersion:1})).status).toBe(403);
  expect((await request("admin/payments",actor.cookie)).status).toBe(403);
  const detail=await request(`admin/bookings/${booking.id}`,actor.cookie);
  expect(detail.status).toBe(200);expect(detail.data.data.totalAmountMinor).toBeUndefined();
  expect(detail.data.data.items[0].details).toBeUndefined();expect(detail.data.data.revisions).toBeUndefined();
});
test("content_editor_and_photographer_have_no_booking_or_staff_authority",async()=>{
  for(const role of ["content_editor","photographer"]){
    const actor=await staff(role);
    expect((await request("admin/session",actor.cookie)).status).toBe(200);
    expect((await request("admin/bookings",actor.cookie)).status).toBe(403);
    expect((await request("admin/staff",actor.cookie)).status).toBe(403);
  }
});
test("approval_rejects_body_mass_assignment_and_client_price_fields",async()=>{
  const actor=await staff("owner");
  const response=await request(`admin/bookings/${randomUUID()}/approve`,actor.cookie,{expectedVersion:1,status:"confirmed",amount:1,role:"owner"});
  expect(response.status).toBe(400);
});
test("revoked_guest_session_cannot_read_previous_booking",async()=>{
  const departure=await makeDeparture(db),{booking}=await makeBooking(db,[await tourItem(db,departure.id)]),token=newSecret();
  const grant=(await db.query("INSERT INTO app.access_grants(token_hash,purpose,booking_id,scope,expires_at) VALUES($1,'booking',$2,ARRAY['booking:read'],now()+interval '1 hour') RETURNING id",[digestSecret(newSecret()),booking.id])).rows[0].id;
  await db.query("INSERT INTO app.guest_sessions(session_hash,grant_id,scope,expires_at) VALUES($1,$2,ARRAY['booking:read'],now()+interval '1 hour')",[digestSecret(token),grant]);
  const cookie=`rsh_guest=${token}`;expect((await request(`bookings/${booking.reference}`,cookie)).status).toBe(200);
  await db.query("UPDATE app.access_grants SET revoked_at=now() WHERE id=$1",[grant]);
  expect((await request(`bookings/${booking.reference}`,cookie)).status).toBe(404);
});
