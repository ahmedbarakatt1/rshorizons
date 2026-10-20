import pg from "pg";
import {readFileSync,readdirSync,writeFileSync,mkdirSync} from "node:fs";
import {createHash} from "node:crypto";
process.loadEnvFile(".env.local");
const url=new URL(process.env.MIGRATION_DATABASE_URL??"");
if(url.hostname!=="127.0.0.1"||url.port!=="55432"||process.env.APP_ENV==="production")throw new Error("Showcase creation restricted to isolated local cluster.");
const name=`tourism_showcase_${Date.now()}`,admin=new pg.Client({connectionString:url.toString()});await admin.connect();
try{await admin.query(`CREATE DATABASE "${name}"`);}finally{await admin.end();}
url.pathname=`/${name}`;const db=new pg.Client({connectionString:url.toString()});await db.connect();
try{
 await db.query("CREATE SCHEMA migration;CREATE TABLE migration.applied(version text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())");
 for(const file of readdirSync("supabase/migrations").filter(name=>name.endsWith(".sql")).sort()){
  const sql=readFileSync(`supabase/migrations/${file}`,"utf8");if(!sql.trim())throw new Error("Empty migration");
  await db.query("BEGIN");try{await db.query(sql);await db.query("INSERT INTO migration.applied(version,checksum) VALUES($1,$2)",[file,createHash("sha256").update(sql).digest("hex")]);await db.query("COMMIT");}catch(error){await db.query("ROLLBACK");throw error;}
 }
 await db.query(readFileSync("supabase/seed.sql","utf8"));
 mkdirSync(".local",{recursive:true});writeFileSync(".local/showcase.json",JSON.stringify({database:name,createdAt:new Date().toISOString()}));
 console.log(`Fresh synthetic showcase prepared: ${name}. Main test database preserved.`);
}finally{await db.end();}
