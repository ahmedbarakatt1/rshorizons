import pg from "pg";
import {appendFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {pathToFileURL} from "node:url";

export function ciBrowserEnvironment(env:Record<string,string|undefined>) {
 if(env.CI!=="true"||env.APP_ENV!=="test"||env.DEMO_MODE!=="true"||!env.GITHUB_ENV)throw new Error("Explicit isolated CI mode required.");
 const result:Record<string,string>={};
 for(const name of ["MIGRATION_DATABASE_URL","DATABASE_URL"]){
  const url=new URL(env[name]??"");
  if(url.hostname!=="127.0.0.1"||url.port!=="55432"||url.pathname!=="/tourism_ci")throw new Error("Only the isolated CI cluster is supported.");
  url.pathname="/tourism_ci_browser";result[name]=url.toString();
 }
 return result;
}
async function prepare(){
 process.loadEnvFile(".env.local");
 const env=ciBrowserEnvironment(process.env),db=new pg.Client({connectionString:process.env.MIGRATION_DATABASE_URL});
 await db.connect();
 try{
  // Deliberately fails if the database exists; never reset or drop another run's data.
  await db.query("CREATE DATABASE tourism_ci_browser");
 }finally{await db.end();}
 for(const script of ["scripts/db-migrate.mjs","scripts/db-seed.mjs"])execFileSync(process.execPath,[script],{env:{...process.env,...env},windowsHide:true,stdio:"inherit"});
 appendFileSync(process.env.GITHUB_ENV!,Object.entries(env).map(([key,value])=>`${key}=${value}\n`).join(""));
 console.log("Fresh browser database migrated and seeded; domain-test records preserved separately.");
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await prepare();
