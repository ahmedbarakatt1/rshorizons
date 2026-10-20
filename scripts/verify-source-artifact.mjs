import {execFileSync} from "node:child_process";
import {existsSync,readFileSync,readdirSync,realpathSync,statSync,writeFileSync,mkdirSync} from "node:fs";
import {resolve,relative,dirname,join} from "node:path";
import {parse} from "dotenv";

const env={...(existsSync(".env.local")?parse(readFileSync(".env.local")):{}),...process.env};
const sensitive=Object.entries(env).filter(([key,value])=>/(SECRET|PASSWORD|PEPPER|PRIVATE_KEY|DATABASE_URL|API_TOKEN|WHATSAPP_TOKEN|EMAIL_API_KEY)/.test(key)&&typeof value==="string"&&value.length>=20);
for(const key of ["DATABASE_URL","MIGRATION_DATABASE_URL"])if(env[key]){const url=new URL(env[key]);if(url.password.length>=20)sensitive.push([`${key}_PASSWORD`,decodeURIComponent(url.password)]);}
const candidates=[...new Set(execFileSync("git",["ls-files","--cached","--others","--exclude-standard","-z"],{encoding:"utf8"}).split("\0").filter(Boolean))];
const findings=[];
function scan(path,label){
 const bytes=readFileSync(path);
 for(const [name,value] of sensitive)if(bytes.includes(Buffer.from(value)))findings.push({file:label,kind:"configured credential match",name});
 if(/-----BEGIN (?:RSA )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]{100,}-----END/.test(bytes.toString("utf8")))findings.push({file:label,kind:"private key material"});
}
for(const file of candidates){
 if(/^(?:\.local\/|media\/|\.playwright|test-results\/|playwright-report\/|\.env(?!\.example$))/.test(file))findings.push({file,kind:"private path candidate"});
 if(existsSync(file)&&statSync(file).isFile())scan(file,file);
}
const output=process.env.NEXT_BUILD_DIR===".next-release"?".next-release":".next";
let buildFiles=0,traces=0;const visited=new Set();
function walk(path){
 const real=realpathSync(path);if(visited.has(real))return;visited.add(real);
 for(const entry of readdirSync(path,{withFileTypes:true})){
  const file=join(path,entry.name);
  if(statSync(file).isDirectory())walk(file);else{
   buildFiles++;scan(file,relative(".",file).replaceAll("\\","/"));
   if(file.endsWith(".nft.json")){
    traces++;
    for(const dependency of JSON.parse(readFileSync(file,"utf8")).files??[]){
     const local=relative(resolve("."),resolve(dirname(file),dependency)).replaceAll("\\","/");
     if(/^(?:\.local\/|\.tooling\/|\.agents\/|media\/|\.env|docs\/|tests\/)/.test(local))findings.push({file:relative(".",file),kind:"private/development build trace",dependency:local});
    }
   }
  }
 }
}
if(existsSync(output))walk(output);
const report={at:new Date().toISOString(),sourceFiles:candidates.length,buildDirectory:output,buildFiles,fileTraces:traces,findings,limitations:"Exact configured credential and private-path scan; not a general secrets-detection or penetration-testing certification."};
mkdirSync("docs/evidence",{recursive:true});
writeFileSync("docs/evidence/source-artifact-scan.json",JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({...report,findings:findings.map(({file,kind})=>({file,kind}))},null,2));
if(findings.length)process.exitCode=1;
