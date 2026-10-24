import {config} from "dotenv";
import {readFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {Client} from "pg";
import {createClient} from "@supabase/supabase-js";
import {z} from "zod";
import {hashLocalPassword,localPasswordEnvironment} from "../src/server/auth/local-password";

config({path:".env.local",quiet:true});
const args=process.argv.slice(2),local=args.includes("--local"),rotate=args.includes("--rotate");
let db:Client|undefined,createdAuthId:string|undefined;
try{
  if(args.includes("--showcase")){
    if(!local)throw new Error("SHOWCASE_IS_LOCAL_ONLY");
    const {database}=JSON.parse(await readFile(".local/showcase.json","utf8"));
    if(!/^tourism_showcase_\d+$/.test(database))throw new Error("INVALID_SHOWCASE_DATABASE");
    for(const key of ["DATABASE_URL","MIGRATION_DATABASE_URL"]){
      const url=new URL(process.env[key]??"");
      if(url.hostname!=="127.0.0.1"||url.port!=="55432")throw new Error("LOCAL_DATABASE_REQUIRED");
      url.pathname=`/${database}`;process.env[key]=url.toString();
    }
  }
  const migrationUrl=new URL(process.env.MIGRATION_DATABASE_URL??"");
  if(local){
    if(!localPasswordEnvironment()||!["127.0.0.1","localhost","[::1]"].includes(migrationUrl.hostname))throw new Error("LOCAL_PROVISIONING_FORBIDDEN");
    const runtimeUrl=new URL(process.env.DATABASE_URL!);
    if(runtimeUrl.host!==migrationUrl.host||runtimeUrl.pathname!==migrationUrl.pathname)throw new Error("DATABASE_TARGET_MISMATCH");
  }else{
    const ref=args[args.indexOf("--project-ref")+1];
    if(!args.includes("--project-ref")||!ref||!/^[a-z0-9]{20}$/.test(ref)||process.env.NEXT_PUBLIC_SUPABASE_URL!==`https://${ref}.supabase.co`)throw new Error("DESIGNATED_SUPABASE_PROJECT_REQUIRED");
    if(!["staging","production"].includes(process.env.APP_ENV??"")||process.env.DEMO_MODE!=="false"||!process.env.SUPABASE_SECRET_KEY)throw new Error("HOSTED_AUTH_CONFIGURATION_REQUIRED");
    const direct=migrationUrl.hostname===`db.${ref}.supabase.co`;
    const pooler=migrationUrl.hostname.endsWith(".pooler.supabase.com")&&decodeURIComponent(migrationUrl.username).endsWith(`.${ref}`);
    if(!direct&&!pooler)throw new Error("DATABASE_TARGET_MISMATCH");
    if(rotate)throw new Error("USE_SUPABASE_PASSWORD_RECOVERY");
  }
  // JSON through stdin keeps credentials out of command arguments, files and logs.
  let input="";
  for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>4096)throw new Error("INPUT_TOO_LARGE");}
  const account=z.object({email:z.email().max(254).transform(v=>v.toLowerCase()),password:z.string().min(12).max(256),name:z.string().trim().min(2).max(150)}).strict().parse(JSON.parse(input));
  input="";
  db=new Client({connectionString:migrationUrl.toString()});await db.connect();
  await db.query("BEGIN");
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended('admin-provision:'||$1,0))",[account.email]);
  const existing=(await db.query("SELECT id FROM auth.users WHERE lower(email)=$1",[account.email])).rows;
  if(existing.length>1)throw new Error("AMBIGUOUS_EXISTING_ACCOUNT");
  let staffId=existing[0]?.id as string|undefined;
  if(staffId){
    if(!local||!rotate)throw new Error("ACCOUNT_ALREADY_EXISTS_USE_EXPLICIT_RECOVERY");
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended('local-staff:'||$1,0))",[staffId]);
    if(!(await db.query("SELECT 1 FROM app.local_staff_credentials WHERE staff_id=$1 AND email=$2",[staffId,account.email])).rowCount)throw new Error("NOT_A_LOCAL_PASSWORD_ACCOUNT");
  }else if(rotate)throw new Error("ACCOUNT_NOT_FOUND");
  else if(local){
    staffId=randomUUID();await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)",[staffId,account.email]);
  }else{
    const auth=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SECRET_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
    const result=await auth.auth.admin.createUser({email:account.email,password:account.password,email_confirm:true});
    if(result.error||!result.data.user)throw new Error("SUPABASE_ACCOUNT_CREATION_FAILED");
    staffId=result.data.user.id;createdAuthId=staffId;
  }
  if(local){
    const {salt,hash}=await hashLocalPassword(account.password);
    if(rotate){
      await db.query("UPDATE app.local_staff_credentials SET password_salt=$2,password_hash=$3,updated_at=now() WHERE staff_id=$1",[staffId,salt,hash]);
      await db.query("UPDATE app.local_operator_sessions SET revoked_at=now() WHERE staff_id=$1 AND revoked_at IS NULL",[staffId]);
    }else{
      await db.query("INSERT INTO app.staff_profiles(id,name,active,mfa_required) VALUES($1,$2,true,true)",[staffId,account.name]);
      await db.query("INSERT INTO app.local_staff_credentials(staff_id,email,password_salt,password_hash) VALUES($1,$2,$3,$4)",[staffId,account.email,salt,hash]);
    }
  }else await db.query("INSERT INTO app.staff_profiles(id,name,active,mfa_required) VALUES($1,$2,true,true)",[staffId,account.name]);
  if(!rotate){
    const role=await db.query("INSERT INTO app.staff_roles(staff_id,role_id) SELECT $1,id FROM app.roles WHERE code='owner' RETURNING role_id",[staffId]);
    if(!role.rowCount)throw new Error("OWNER_ROLE_MISSING");
    await db.query("INSERT INTO app.staff_scopes(staff_id,scope_type) VALUES($1,'all')",[staffId]);
  }
  await db.query("INSERT INTO app.audit_events(actor_type,action,target_type,target_id,summary) VALUES('system',$1,'staff',$2,$3)",[rotate?"local_admin_password_rotated":"administrator_provisioned",staffId,JSON.stringify({mode:local?"local":"supabase",mfaRequired:!local})]);
  await db.query("COMMIT");
  console.log(JSON.stringify({created:!rotate,rotated:rotate,mode:local?"local-preview":"supabase",email:account.email,mfaEnrollmentRequired:!local}));
}catch(error){
  if(db)await db.query("ROLLBACK").catch(()=>{});
  const message=error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:"ADMIN_PROVISIONING_FAILED";
  console.error(message);
  if(createdAuthId)console.error(`Auth user ${createdAuthId} exists without staff authority. Finish provisioning in the designated project before retrying.`);
  process.exitCode=1;
}finally{await db?.end();}
