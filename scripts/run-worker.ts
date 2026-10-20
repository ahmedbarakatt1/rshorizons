import {config} from "dotenv";
config({path:".env.local",quiet:true});
const {runJobs}=await import("../src/modules/jobs/worker");
const {pool}=await import("../src/server/db");
try {await runJobs(Number(process.argv[2]??20));}finally{await pool.end();}
