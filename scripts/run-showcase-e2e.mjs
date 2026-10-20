import {readFileSync} from "node:fs";
import {spawn} from "node:child_process";
process.loadEnvFile(".env.local");
const {database}=JSON.parse(readFileSync(".local/showcase.json","utf8"));
if(!/^tourism_showcase_\d+$/.test(database))throw new Error("Invalid showcase name");
const env={...process.env,APP_BASE_URL:"http://127.0.0.1:3002",E2E_BASE_URL:"http://127.0.0.1:3002",E2E_LOCAL_STAFF:"1"};
for(const key of ["DATABASE_URL","MIGRATION_DATABASE_URL"]){
 const url=new URL(env[key]);if(url.hostname!=="127.0.0.1"||url.port!=="55432")throw new Error("Only isolated local cluster supported");url.pathname=`/${database}`;env[key]=url.toString();
}
const child=spawn(process.execPath,["node_modules/@playwright/test/cli.js","test",...process.argv.slice(2)],{env,windowsHide:true,stdio:"inherit"});
child.on("exit",code=>process.exitCode=code??1);
