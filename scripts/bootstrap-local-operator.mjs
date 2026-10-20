import {config} from "dotenv";
import {Pool} from "pg";
import {randomBytes,createHmac,randomUUID} from "node:crypto";
import {mkdir,writeFile} from "node:fs/promises";
config({path:".env.local",quiet:true});
if(!["development","test"].includes(process.env.APP_ENV)||process.env.DEMO_MODE!=="true")throw new Error("Local bootstrap is forbidden outside isolated demo development/test.");
const pool=new Pool({connectionString:process.env.MIGRATION_DATABASE_URL});
try {
  let {rows}=await pool.query(`SELECT s.id FROM app.staff_profiles s JOIN app.staff_roles sr ON sr.staff_id=s.id JOIN app.roles r ON r.id=sr.role_id WHERE r.code='owner' AND s.active AND s.revoked_at IS NULL LIMIT 1`);
  if(!rows[0]){
    const staffId=randomUUID(),client=await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO auth.users(id,email) VALUES($1,'operator@local.invalid')",[staffId]);
      await client.query("INSERT INTO app.staff_profiles(id,name,active,mfa_required) VALUES($1,'Local demonstration operator',true,true)",[staffId]);
      await client.query("INSERT INTO app.staff_roles(staff_id,role_id) SELECT $1,id FROM app.roles WHERE code='owner'",[staffId]);
      await client.query("INSERT INTO app.staff_scopes(staff_id,scope_type) VALUES($1,'all')",[staffId]);
      await client.query("COMMIT"); rows=[{id:staffId}];
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  }
  const token=randomBytes(32).toString("base64url");
  const hash=createHmac("sha256",process.env.TOKEN_HASH_PEPPER).update(token).digest("hex");
  await pool.query("INSERT INTO app.local_operator_sessions(staff_id,token_hash,expires_at) VALUES($1,$2,now()+interval '8 hours')",[rows[0].id,hash]);
  await mkdir(".local",{recursive:true});
  await writeFile(".local/operator-access.json",JSON.stringify({token,expiresInHours:8,purpose:"One-time local demo operator sign-in; never production"}),{mode:0o600});
  console.log("One-time local operator grant created in ignored .local/operator-access.json. It expires in 8 hours. No default password exists.");
} finally {await pool.end();}
