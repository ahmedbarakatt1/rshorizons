import {createClient} from "@supabase/supabase-js";
import type {StaffActor} from "@/server/auth";
import {query,withTransaction} from "@/server/db";
import {AppError} from "@/server/http/errors";

export async function inviteStaff(actor:StaffActor,input:{email:string;name?:string;roles:string[];scopes:{scopeType:string;destinationId?:string;propertyId?:string}[]}){
  const allowed=await query("SELECT app.has_permission($1,'staff.manage') AND EXISTS(SELECT 1 FROM app.staff_scopes WHERE staff_id=$1 AND scope_type='all') AS allowed",[actor.id]);
  if(!allowed.rows[0]?.allowed)throw new AppError("FORBIDDEN",403);
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY,base=process.env.APP_BASE_URL;
  if(!url||!key||!base)throw new AppError("AUTH_NOT_CONFIGURED",503,"Staff invitations require the agency's Auth project.");
  const scopes=input.scopes.length?input.scopes:[{scopeType:"all"}];
  const auth=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  // Generate, but do not automatically send, an invitation. The authenticated owner
  // receives the link only after current database roles and scopes have been committed.
  // A failed database commit leaves an Auth identity without any application access.
  const {data,error}=await auth.auth.admin.generateLink({type:"invite",email:input.email,options:{redirectTo:new URL("/admin/invite",base).href}});
  if(error||!data.user||!data.properties?.hashed_token)throw new AppError("INVITATION_UNAVAILABLE",409,"The invitation could not be created. Check the Auth account before retrying.");
  const result=await withTransaction(actor,async tx=>(await tx.query("SELECT app.invite_staff($1,$2,$3,$4,$5,$6) AS result",[data.user.id,input.email,input.name??input.email,input.roles,JSON.stringify(scopes),actor.id])).rows[0].result);
  // Fragment delivery prevents logs and link-prefetch GET requests consuming the token.
  const invitationUrl=new URL("/admin/invite",base);invitationUrl.hash=new URLSearchParams({token:data.properties.hashed_token}).toString();
  return {...result,invitationUrl:invitationUrl.href,requiresMfa:true,delivery:"owner_shares_link"};
}
