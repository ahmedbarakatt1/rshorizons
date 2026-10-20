import {writeFileSync,mkdirSync} from "node:fs";
import {performance} from "node:perf_hooks";
import {admin,runtime,makeActor,makeDeparture,makeBooking,tourItem} from "../tests/database/helpers";
const url=new URL(process.env.MIGRATION_DATABASE_URL??"");
if(url.hostname!=="127.0.0.1"||url.port!=="55432"||process.env.APP_ENV==="production")throw new Error("Load verification is restricted to the isolated synthetic cluster.");
const db=admin();await db.connect();
const clients=Array.from({length:32},()=>runtime());
try{
 const actor=await makeActor(db),departure=await makeDeparture(db,16),bookings=[];
 for(let n=0;n<clients.length;n++)bookings.push((await makeBooking(db,[await tourItem(db,departure.id)],"arrival")).booking.id);
 await Promise.all(clients.map(client=>client.connect()));
 const pids=await Promise.all(clients.map(async client=>(await client.query("SELECT pg_backend_pid() pid")).rows[0].pid));
 const start=performance.now(),latencies:number[]=[];
 const outcomes=await Promise.all(clients.map(async(client,index)=>{
  const began=performance.now();try{await client.query("SELECT app.approve_booking($1,1,$2)",[bookings[index],actor]);return "approved";}
  catch(error){const message=error instanceof Error?error.message:"unexpected";if(message!=="INVENTORY_CONFLICT")throw error;return "capacity_conflict";}
  finally{latencies.push(performance.now()-began);}
 }));
 const elapsed=performance.now()-start,counts=(await db.query("SELECT coalesce(sum(seats),0)::int allocated,count(*)::int allocations FROM app.capacity_allocations WHERE departure_id=$1 AND state<>'released'",[departure.id])).rows[0];
 const approved=outcomes.filter(result=>result==="approved").length;
 if(approved!==16||counts.allocated!==16||counts.allocations!==16||new Set(pids).size!==32)throw new Error("Concurrent capacity invariant failed.");
 latencies.sort((a,b)=>a-b);
 const report={at:new Date().toISOString(),environment:"isolated loopback PostgreSQL17.11 with synthetic records",workload:{independentConnections:32,approvalRequests:32,departureSeats:16,partySize:1,paymentPolicy:"arrival"},results:{approved,capacityConflicts:32-approved,allocatedSeats:counts.allocated},durationMs:Math.round(elapsed),latencyMs:{p50:Math.round(latencies[15]),p95:Math.round(latencies[30]),max:Math.round(latencies[31])},invariant:"PASS: exactly16 allocations; no overselling",limitations:"Local concurrency evidence, not production throughput or latency capacity planning."};
 mkdirSync("docs/evidence",{recursive:true});writeFileSync("docs/evidence/local-load.json",JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));
}finally{await Promise.all(clients.map(client=>client.end()));await db.end();}
