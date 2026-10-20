import {createClient} from "@supabase/supabase-js";
import {query,withTransaction,type ActorContext} from "@/server/db";
import {AppError} from "@/server/http/errors";
import {digestSecret,newSecret} from "@/server/security";

export type StaffActor=ActorContext&{type:"staff";id:string;name:string;aal:"aal2"};
export type GuestActor=ActorContext&{type:"guest";id:string;sessionHash:string;bookingId:string;scope:string[]};
export function cookieValue(request:Request,name:string) {
  const found=request.headers.get("cookie")?.split(";").map(c=>c.trim()).find(c=>c.startsWith(`${name}=`));
  if(!found)return undefined;
  try{return decodeURIComponent(found.slice(name.length+1));}catch{return undefined;}
}
export function sessionCookie(name:string,value:string,maxAge=7200) {
  return `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${process.env.APP_ENV==="production"||process.env.APP_ENV==="staging"?"; Secure":""}`;
}
export function localEnvironment() {
  return ["development","test"].includes(process.env.APP_ENV??"development")&&process.env.DEMO_MODE==="true";
}
function authClient() {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if(!url||!key)throw new AppError("AUTH_NOT_CONFIGURED",503,"Staff sign-in is awaiting the agency Auth configuration.");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
}
export async function getStaff(request:Request,permission?:string,bookingId?:string):Promise<StaffActor> {
  const localToken=cookieValue(request,"rsh_local_staff");
  let staffId:string|undefined,aal="aal1";
  if(localToken&&localEnvironment()) {
    const {rows}=await query<{staff_id:string}>(`SELECT staff_id FROM app.local_operator_sessions WHERE token_hash=$1 AND expires_at>now() AND redeemed_at IS NOT NULL AND revoked_at IS NULL`,[digestSecret(localToken)]);
    staffId=rows[0]?.staff_id;
    if(staffId)aal="aal2";
  } else {
    const token=cookieValue(request,"rsh_staff_access");
    if(!token)throw new AppError("UNAUTHENTICATED",401);
    const auth=authClient();
    const {data,error}=await auth.auth.getUser(token);
    if(error||!data.user)throw new AppError("UNAUTHENTICATED",401);
    const claims=await auth.auth.getClaims(token);
    if(claims.error||claims.data?.claims.sub!==data.user.id)throw new AppError("UNAUTHENTICATED",401);
    staffId=data.user.id;aal=String(claims.data.claims.aal??"aal1");
  }
  if(!staffId)throw new AppError("UNAUTHENTICATED",401);
  const {rows}=await query<{name:string;active:boolean;revoked_at:Date|null;mfa_required:boolean}>(`SELECT name,active,revoked_at,mfa_required FROM app.staff_profiles WHERE id=$1`,[staffId]);
  const staff=rows[0];
  if(!staff?.active||staff.revoked_at)throw new AppError("STAFF_DISABLED",403);
  if(staff.mfa_required&&aal!=="aal2")throw new AppError("MFA_REQUIRED",403,"Complete multi-factor authentication.");
  if(permission)await query("SELECT app.assert_staff($1,$2,$3)",[staffId,permission,bookingId??null]);
  return {type:"staff",id:staffId,name:staff.name,aal:"aal2"};
}
export async function loginStaff(email:string,password:string) {
  const auth=authClient();
  const {data,error}=await auth.auth.signInWithPassword({email,password});
  if(error||!data.session)throw new AppError("INVALID_CREDENTIALS",401,"Sign-in failed.");
  const {rows}=await query("SELECT id FROM app.staff_profiles WHERE id=$1 AND active AND revoked_at IS NULL",[data.user.id]);
  if(!rows.length)throw new AppError("STAFF_DISABLED",403);
  const {data:claims}=await auth.auth.getClaims(data.session.access_token);
  return {accessToken:data.session.access_token,refreshToken:data.session.refresh_token,requiresMfa:claims?.claims.aal!=="aal2"};
}
export async function localLogin(token:string) {
  if(!localEnvironment())throw new AppError("NOT_FOUND",404);
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new AppError("INVALID_CREDENTIALS",401);
  const hash=digestSecret(token);
  const replacement=newSecret();
  const {rows}=await query("UPDATE app.local_operator_sessions SET token_hash=$2,redeemed_at=now() WHERE token_hash=$1 AND expires_at>now() AND redeemed_at IS NULL AND revoked_at IS NULL RETURNING staff_id",[hash,digestSecret(replacement)]);
  if(!rows.length)throw new AppError("INVALID_CREDENTIALS",401);
  return replacement;
}
export async function getGuest(request:Request,reference?:string):Promise<GuestActor> {
  const token=cookieValue(request,"rsh_guest");
  if(!token)throw new AppError("UNAUTHENTICATED",401);
  const hash=digestSecret(token);
  const {rows}=await query<{id:string;booking_id:string;scope:string[]}>(`SELECT s.id,b.id AS booking_id,ARRAY(SELECT unnest(s.scope) INTERSECT SELECT unnest(g.scope)) AS scope FROM app.guest_sessions s JOIN app.access_grants g ON g.id=s.grant_id LEFT JOIN app.galleries gallery ON gallery.id=g.gallery_id LEFT JOIN app.review_invitations ri ON ri.id=g.review_invitation_id LEFT JOIN app.booking_items bi ON bi.id=ri.booking_item_id JOIN app.bookings b ON b.id=coalesce(g.booking_id,gallery.booking_id,bi.booking_id) WHERE s.session_hash=$1 AND s.expires_at>now() AND s.revoked_at IS NULL AND g.revoked_at IS NULL AND g.expires_at>now() AND ($2::text IS NULL OR (b.reference=$2 AND 'booking:read'=ANY(s.scope) AND 'booking:read'=ANY(g.scope)))`,[hash,reference??null]);
  if(!rows[0])throw new AppError("NOT_FOUND",404);
  return {type:"guest",id:rows[0].id,sessionHash:hash,bookingId:rows[0].booking_id,scope:rows[0].scope};
}
export async function redeemGuestGrant(token:string) {
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new AppError("GRANT_EXPIRED",410);
  const sessionToken=newSecret();
  const reference=await withTransaction({type:"system"},async tx=>{
    const {rows}=await tx.query(`UPDATE app.access_grants SET used_at=now() WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() AND revoked_at IS NULL RETURNING id,scope,booking_id,expires_at`,[digestSecret(token)]);
    const grant=rows[0];
    if(!grant)throw new AppError("GRANT_EXPIRED",410);
    await tx.query(`INSERT INTO app.guest_sessions(session_hash,grant_id,scope,expires_at) VALUES($1,$2,$3,least($4,now()+interval '12 hours'))`,[digestSecret(sessionToken),grant.id,grant.scope,grant.expires_at]);
    const booking=await tx.query("SELECT b.reference,g.purpose,g.gallery_id,g.review_invitation_id FROM app.access_grants g LEFT JOIN app.galleries gallery ON gallery.id=g.gallery_id LEFT JOIN app.review_invitations ri ON ri.id=g.review_invitation_id LEFT JOIN app.booking_items bi ON bi.id=ri.booking_item_id LEFT JOIN app.bookings b ON b.id=coalesce(g.booking_id,gallery.booking_id,bi.booking_id) WHERE g.id=$1",[grant.id]);
    return booking.rows[0];
  });
  return {sessionToken,reference:reference.reference,purpose:reference.purpose,galleryId:reference.gallery_id,invitationId:reference.review_invitation_id};
}
export async function issueGuestSession(bookingId:string) {
  const token=newSecret(),sessionToken=newSecret();
  await withTransaction({type:"system"},async tx=>{
    const {rows}=await tx.query(`INSERT INTO app.access_grants(token_hash,purpose,booking_id,scope,expires_at,used_at) VALUES($1,'booking',$2,ARRAY['booking:read','booking:request','payment:create','gallery:read','review:create'],now()+interval '30 days',now()) RETURNING id,scope`,[digestSecret(token),bookingId]);
    await tx.query(`INSERT INTO app.guest_sessions(session_hash,grant_id,scope,expires_at) VALUES($1,$2,$3,now()+interval '12 hours')`,[digestSecret(sessionToken),rows[0].id,rows[0].scope]);
  });
  return sessionToken;
}
