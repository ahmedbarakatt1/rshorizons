import {z} from "zod";
import {createClient} from "@supabase/supabase-js";
import {query} from "@/server/db";
import {cookieValue,loginStaff,localLogin,sessionCookie,getStaff} from "@/server/auth";
import {digestSecret} from "@/server/security";
import {readJson,success,rateLimit} from "@/server/http/request";
import {AppError} from "@/server/http/errors";
import {localPasswordEnvironment,loginLocalPassword} from "@/server/auth/local-password";
export async function authRoute(request:Request,parts:string[]){
  if(parts[0]!=="admin"||parts[1]!=="auth"||request.method!=="POST")return undefined;
  await rateLimit(request,"staff-auth",10);
  const action=parts[2];
  if(action==="local") {
    const {token}=z.object({token:z.string().max(200)}).strict().parse(await readJson(request));
    return success({authenticated:true},200,[sessionCookie("rsh_local_staff",await localLogin(token,request.url),28800)]);
  }
  if(action==="login") {
    const input=z.object({email:z.email().transform(value=>value.toLowerCase()),password:z.string().min(1).max(256)}).strict().parse(await readJson(request));
    await rateLimit(request,"staff-password",5,input.email);
    if(localPasswordEnvironment()){
      const token=await loginLocalPassword(input.email,input.password,request.url);
      return success({requiresMfa:false},200,[sessionCookie("rsh_local_staff",token,28800),sessionCookie("rsh_staff_access","",0),sessionCookie("rsh_staff_refresh","",0)]);
    }
    const result=await loginStaff(input.email,input.password);
    return success({requiresMfa:result.requiresMfa},200,[sessionCookie("rsh_staff_access",result.accessToken,3600),sessionCookie("rsh_staff_refresh",result.refreshToken,86400)]);
  }
  if(action==="logout"){
    const local=cookieValue(request,"rsh_local_staff");
    if(local)await query("UPDATE app.local_operator_sessions SET revoked_at=now() WHERE token_hash=$1",[digestSecret(local)]);
    const access=cookieValue(request,"rsh_staff_access"),url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;
    if(access&&url&&key){
      const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
      const result=await client.auth.admin.signOut(access,"local");
      if(result.error)throw new AppError("SIGN_OUT_UNAVAILABLE",503);
    }
    return success({signedOut:true},200,["rsh_staff_access","rsh_staff_refresh","rsh_local_staff"].map(n=>sessionCookie(n,"",0)));
  }
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if(!url||!key)throw new AppError("AUTH_NOT_CONFIGURED",503);
  const auth=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  if(action==="invite-accept"){
    const input=z.object({token:z.string().min(32).max(256),password:z.string().min(12).max(256)}).strict().parse(await readJson(request));
    const result=await auth.auth.verifyOtp({token_hash:input.token,type:"invite"});
    if(result.error||!result.data.session||!result.data.user)throw new AppError("INVITATION_EXPIRED",410);
    const active=await query("SELECT id FROM app.staff_profiles WHERE id=$1 AND active AND revoked_at IS NULL",[result.data.user.id]);
    if(!active.rows.length)throw new AppError("STAFF_DISABLED",403);
    const updated=await auth.auth.updateUser({password:input.password});if(updated.error)throw new AppError("PASSWORD_REJECTED",422);
    return success({requiresMfa:false},200,[sessionCookie("rsh_staff_access",result.data.session.access_token,3600),sessionCookie("rsh_staff_refresh",result.data.session.refresh_token,86400)]);
  }
  const access=cookieValue(request,"rsh_staff_access"),refresh=cookieValue(request,"rsh_staff_refresh");
  if(!access||!refresh)throw new AppError("UNAUTHENTICATED",401);
  const {data,error}=await auth.auth.setSession({access_token:access,refresh_token:refresh});
  if(error||!data.user)throw new AppError("UNAUTHENTICATED",401);
  const active=await query("SELECT id FROM app.staff_profiles WHERE id=$1 AND active AND revoked_at IS NULL",[data.user.id]);if(!active.rows.length)throw new AppError("STAFF_DISABLED",403);
  if(action==="refresh"){
    if(!data.session)throw new AppError("UNAUTHENTICATED",401);
    return success({refreshed:true},200,[sessionCookie("rsh_staff_access",data.session.access_token,3600),sessionCookie("rsh_staff_refresh",data.session.refresh_token,86400)]);
  }
  if(action==="mfa") {
    const operation=parts[3];
    if(operation==="enroll"){
      const result=await auth.auth.mfa.enroll({factorType:"totp",friendlyName:"Agency authenticator"});if(result.error)throw new AppError("MFA_ENROLLMENT_FAILED",400);
      return success(result.data);
    }
    if(operation==="factors"){const result=await auth.auth.mfa.listFactors();if(result.error)throw new AppError("MFA_UNAVAILABLE",503);return success({factors:result.data.totp});}
    if(operation==="challenge"){
      const {factorId}=z.object({factorId:z.guid()}).strict().parse(await readJson(request));
      const result=await auth.auth.mfa.challenge({factorId});if(result.error)throw new AppError("MFA_CHALLENGE_FAILED",400);return success(result.data);
    }
    if(operation==="verify"){
      const input=z.object({factorId:z.guid(),challengeId:z.guid(),code:z.string().regex(/^\d{6}$/)}).strict().parse(await readJson(request));
      const result=await auth.auth.mfa.verify(input);if(result.error)throw new AppError("MFA_VERIFICATION_FAILED",401);
      return success({verified:true},200,[sessionCookie("rsh_staff_access",result.data.access_token,3600),sessionCookie("rsh_staff_refresh",result.data.refresh_token,86400)]);
    }
  }
  await getStaff(request);
  throw new AppError("NOT_FOUND",404);
}
