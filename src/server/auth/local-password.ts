import {randomBytes,scrypt,timingSafeEqual} from "node:crypto";
import {query,withTransaction} from "@/server/db";
import {digestSecret,newSecret} from "@/server/security";
import {AppError} from "@/server/http/errors";

function loopback(value:string|undefined){
  try{return ["127.0.0.1","localhost","[::1]"].includes(new URL(value??"").hostname);}catch{return false;}
}
// This identity store is for the isolated preview only. Hosted staff always use Supabase Auth + MFA.
export function localPasswordEnvironment(requestUrl?:string){
  return ["development","test"].includes(process.env.APP_ENV??"")&&process.env.DEMO_MODE==="true"&&process.env.VERCEL!=="1"
    &&!process.env.NEXT_PUBLIC_SUPABASE_URL&&loopback(process.env.DATABASE_URL)&&loopback(process.env.APP_BASE_URL)
    &&(requestUrl===undefined||loopback(requestUrl));
}
function derive(password:string,salt:string):Promise<Buffer>{
  return new Promise((resolve,reject)=>scrypt(password,salt,64,{N:32768,r:8,p:3,maxmem:64*1024*1024},(error,key)=>error?reject(error):resolve(key)));
}
export async function hashLocalPassword(password:string){
  if(password.length<12||password.length>256)throw new Error("PASSWORD_LENGTH_INVALID");
  const salt=randomBytes(32).toString("hex");
  return {salt,hash:(await derive(password,salt)).toString("hex")};
}
export async function loginLocalPassword(email:string,password:string,requestUrl:string){
  if(!localPasswordEnvironment(requestUrl))throw new AppError("NOT_FOUND",404);
  const normalized=email.trim().toLowerCase();
  const {rows}=await query<{staff_id:string;password_hash:string;password_salt:string}>("SELECT staff_id,password_hash,password_salt FROM app.local_staff_credentials WHERE email=$1",[normalized]);
  const record=rows[0];
  const candidate=await derive(password,record?.password_salt??"0".repeat(64));
  const expected=Buffer.from(record?.password_hash??"0".repeat(128),"hex");
  if(!timingSafeEqual(candidate,expected)||!record)throw new AppError("INVALID_CREDENTIALS",401,"Sign-in failed.");
  const token=newSecret();
  await withTransaction({type:"system"},async tx=>{
    // Coordinate with local password rotation without granting the runtime credential-write privileges.
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('local-staff:'||$1,0))",[record.staff_id]);
    const active=await tx.query(`SELECT s.id FROM app.staff_profiles s JOIN app.local_staff_credentials c ON c.staff_id=s.id
      WHERE s.id=$1 AND s.active AND s.revoked_at IS NULL AND c.password_hash=$2`,[record.staff_id,record.password_hash]);
    if(!active.rowCount)throw new AppError("INVALID_CREDENTIALS",401,"Sign-in failed.");
    await tx.query("INSERT INTO app.local_operator_sessions(staff_id,token_hash,expires_at,redeemed_at) VALUES($1,$2,now()+interval '8 hours',now())",[record.staff_id,digestSecret(token)]);
  });
  return token;
}
