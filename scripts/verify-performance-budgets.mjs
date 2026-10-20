import {readFileSync} from "node:fs";

const report=JSON.parse(readFileSync("docs/evidence/performance-lab.json","utf8"));
const budgets=JSON.parse(readFileSync("docs/performance-budgets.json","utf8"));
const failures=[];
for(const target of budgets.routes){
 const matches=report.samples.filter(sample=>sample.route===target.route&&sample.width===target.width);
 const label=`${target.route} at ${target.width}px`;
 if(matches.length!==1){failures.push(`${label}: expected exactly one sample`);continue;}
 const sample=matches[0];
 for(const [metric,limit] of Object.entries({...budgets.common,imageEncodedBytes:target.imageEncodedBytes})){
  if(!Number.isFinite(sample[metric])||sample[metric]<0||sample[metric]>limit)failures.push(`${label}: ${metric} exceeds budget or is invalid`);
 }
 if(sample.threeLoaded!==false)failures.push(`${label}: Three.js loaded or result missing`);
 if(!Array.isArray(sample.externalOrigins)||sample.externalOrigins.length)failures.push(`${label}: external origins loaded or result missing`);
}
if(failures.length){
 console.error(failures.join("\n"));
 process.exitCode=1;
}else console.log(`PASS: ${budgets.routes.length} route/viewport samples meet recorded payload, layout and dependency budgets. Evidence timestamp: ${report.at}. This does not collect fresh browser evidence.`);
