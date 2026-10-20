import {config} from "dotenv";
import {readEnvironment} from "../src/server/env";
config({path:".env.local",quiet:true});
let close:()=>Promise<void>=async()=>{};
try{
  const target=process.env.APP_ENV;
  if(target!=="staging"&&target!=="production")throw new Error("Deployment requires an explicitly designated staging or production environment.");
  if(process.env.VERCEL_ENV==="preview"&&target!=="staging")throw new Error("Preview builds cannot receive production configuration.");
  readEnvironment(target);
  if(target==="production"){
    const {pool}=await import("../src/server/db");
    close=()=>pool.end();
    const {productionDataProblems}=await import("../src/server/env/release-data");
    const problems=await productionDataProblems();
    if(problems.length)throw new Error(`Production data validation rejected: ${problems.join(", ")}`);
  }
  console.log(`${target} configuration and applicable data checks passed. Account, provider end-to-end and owner UAT evidence still require verification.`);
}catch(error){
  console.error(error instanceof Error?error.message:"Configuration rejected");process.exitCode=1;
}finally{await close();}
