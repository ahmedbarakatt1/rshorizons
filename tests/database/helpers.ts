import {randomBytes, randomUUID} from "node:crypto";
import pg, {type Client} from "pg";
try {process.loadEnvFile(".env.local");} catch { /* CI may provide environment variables without a local file. */ }
export const admin = () => new pg.Client({connectionString:process.env.MIGRATION_DATABASE_URL});
export const runtime = () => new pg.Client({connectionString:process.env.DATABASE_URL});
export async function makeActor(db:Client, role="owner", active=true) {
 const id=randomUUID();
 await db.query("INSERT INTO auth.users(id,email) VALUES($1,'operator@example.invalid')",[id]);
 await db.query("INSERT INTO app.staff_profiles(id,name,active) VALUES($1,'Synthetic test operator',$2)",[id,active]);
 await db.query("INSERT INTO app.staff_roles(staff_id,role_id) SELECT $1,id FROM app.roles WHERE code=$2",[id,role]);
 await db.query("INSERT INTO app.staff_scopes(staff_id,scope_type) VALUES($1,'all')",[id]);
 return id;
}
export async function makeDeparture(db:Client, capacity=1) {
 const result=await db.query("INSERT INTO app.departures(variant_id,starts_at,ends_at,seat_capacity,cutoff_at) VALUES(md5('variant:boat_tours')::uuid,now()+interval '40 days',now()+interval '40 days 4 hours',$1,now()+interval '39 days') RETURNING *",[capacity]);
 return result.rows[0];
}
export async function makeApartment(db:Client,buffer=0) {
 const id=randomUUID();
 await db.query("INSERT INTO app.apartments(id,property_id,unit_code,bedrooms,beds,bathrooms,max_guests,cleaning_buffer_days,default_rate,currency,min_nights,synthetic) SELECT $1,id,$1::uuid::text,1,2,1,4,$2,100000,'EGP',1,true FROM app.properties LIMIT 1",[id,buffer]);
 await db.query("INSERT INTO app.apartment_translations(apartment_id,locale,slug,title,description,approved_at) VALUES($1,'en',$1::uuid::text,'Synthetic test stay','Fixture',now())",[id]);
 await db.query("INSERT INTO app.apartment_payment_policies(apartment_id,policy_id) SELECT $1,id FROM app.payment_policies",[id]);
 return id;
}
export async function makeBooking(db:Client,items:Record<string,unknown>[],policy="arrival") {
 const bindingHash=randomBytes(32).toString("hex");
 const quote=(await db.query("SELECT app.create_quote($1::jsonb) q",[JSON.stringify({bindingHash,locale:"en",paymentPolicy:policy,items})])).rows[0].q;
 const input={quoteId:quote.id,bindingHash,idempotencyKey:randomUUID(),guest:{fullName:"Synthetic test guest",email:"guest@example.invalid",locale:"en"},participants:Array.from({length:4},(_,i)=>({displayName:`Participant ${i+1}`,ageCategory:"adult"})),consents:{termsAccepted:true,termsVersion:"demo-v1",privacyNoticeVersion:"demo-v1"}};
 const booking=(await db.query("SELECT app.submit_booking($1::jsonb) b",[JSON.stringify(input)])).rows[0].b;
 return {booking,quote,input};
}
export const tour=(departureId:string,adults=1)=>({kind:"tour",variantId:"",departureId,adults,children:0});
export async function tourItem(db:Client,departureId:string,adults=1) {
 const {rows}=await db.query("SELECT variant_id FROM app.departures WHERE id=$1",[departureId]);
 return {...tour(departureId,adults),variantId:rows[0].variant_id};
}
export async function stayItem(db:Client,apartmentId:string,offset=45,nights=2) {
 const {rows}=await db.query("SELECT (current_date+$1::integer)::text a,(current_date+$1::integer+$2::integer)::text b",[offset,nights]);
 return {kind:"stay",apartmentId,checkIn:rows[0].a,checkOut:rows[0].b,guests:1};
}
export async function makeAttempt(db:Client,bookingId:string,amount:number) {
 const {rows}=await db.query("INSERT INTO app.payment_attempts(booking_id,obligation_id,provider,environment,request_key,expected_amount,currency,status) SELECT b.id,o.id,'local','local',$2,$3,b.currency,'pending' FROM app.bookings b JOIN app.payment_obligations o ON o.booking_id=b.id AND o.kind='initial' AND o.status='open' WHERE b.id=$1 ORDER BY o.version DESC LIMIT 1 RETURNING *",[bookingId,randomUUID(),amount]);
 return rows[0];
}
export function paymentEvent(attemptId:string,amount:number,overrides:Record<string,unknown>={}) {
 return {attemptId,provider:"local",account:"synthetic-merchant",environment:"local",eventKey:randomUUID(),transactionId:randomUUID(),kind:"succeeded",amountMinor:String(amount),currency:"EGP",...overrides};
}
// Three physical connections: a gate holds a contested row until both independent
// transactions have reached a PostgreSQL lock wait. No sequential simulation.
export async function race(db:Client, gateSql:string,gateValues:unknown[], operations:((client:Client)=>Promise<unknown>)[]) {
 const gate=admin(), clients=operations.map(()=>runtime());
 await gate.connect();await Promise.all(clients.map(c=>c.connect()));
 try{
  await gate.query("BEGIN");await gate.query(gateSql,gateValues);
  await Promise.all(clients.map(c=>c.query("BEGIN")));
  const pids=await Promise.all(clients.map(async c=>(await c.query("SELECT pg_backend_pid() p")).rows[0].p));
  const tasks=operations.map(async(op,i)=>{try{const result=await op(clients[i]);await clients[i].query("COMMIT");return result;}catch(error){await clients[i].query("ROLLBACK");throw error;}});
  const settled=Promise.allSettled(tasks);
  let waiting=false;
  for(let n=0;n<100;n++){
   const q=await db.query("SELECT count(*)::int n FROM pg_stat_activity WHERE pid=ANY($1) AND wait_event_type='Lock'",[pids]);
   if(q.rows[0].n===operations.length){waiting=true;break;}
   await new Promise(r=>setTimeout(r,10));
  }
  await gate.query("COMMIT");
  const results=await settled;
  if(!waiting) throw new Error("Race barrier failed: both clients did not reach a real database lock wait.");
  return results;
 } finally {await gate.end();await Promise.all(clients.map(c=>c.end()));}
}
