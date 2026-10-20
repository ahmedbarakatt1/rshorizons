import {readFileSync} from "node:fs";
import {spawn,spawnSync} from "node:child_process";
process.loadEnvFile(".env.local");
const {database}=JSON.parse(readFileSync(".local/showcase.json","utf8"));
if(!/^tourism_showcase_\d+$/.test(database))throw new Error("Invalid showcase name");
const env={...process.env,NEXT_BUILD_DIR:".next-release",APP_BASE_URL:"http://127.0.0.1:3002"};
for(const key of ["DATABASE_URL","MIGRATION_DATABASE_URL"]){
 const url=new URL(env[key]);if(url.hostname!=="127.0.0.1"||url.port!=="55432")throw new Error("Only isolated local cluster supported");url.pathname=`/${database}`;env[key]=url.toString();
}
const bootstrap=spawnSync(process.execPath,["scripts/bootstrap-local-operator.mjs"],{env,windowsHide:true,stdio:"inherit"});if(bootstrap.status!==0)throw new Error("Showcase operator bootstrap failed");
const child=spawn(process.execPath,["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","--port","3002"],{env,windowsHide:true,stdio:"inherit"});
child.on("exit",code=>process.exitCode=code??1);
for(const signal of ["SIGINT","SIGTERM"])process.on(signal,()=>child.kill(signal));
