import {config} from "dotenv";
import {readFile} from "node:fs/promises";
import pg from "pg";
config({path:".env.local",quiet:true});
if(!["development","test"].includes(process.env.APP_ENV)||process.env.DEMO_MODE!=="true"||process.env.VERCEL==="1")throw new Error("Local notification fixtures are forbidden in hosted environments.");
const url=new URL(process.env.MIGRATION_DATABASE_URL??"");
if(!["localhost","127.0.0.1"].includes(url.hostname))throw new Error("Isolated local database required.");
if(process.argv.includes("--showcase")){
  const {database}=JSON.parse(await readFile(".local/showcase.json","utf8"));
  if(!/^tourism_showcase_\d+$/.test(database)||url.port!=="55432")throw new Error("Invalid showcase target.");
  url.pathname=`/${database}`;
}
const templates={
  guest_access_requested:["Your booking access — {{reference}}","Use this private link to view reservation {{reference}} and its current status. If you did not request it, you can ignore this message.\n\n{{access_url}}"],
  request_received:["Request received — {{reference}}","We received your reservation request {{reference}}. It is awaiting staff review; your booking is not yet confirmed and no payment is requested. Follow your request: {{access_url}}"],
  approved_payment_required:["Payment requested — {{reference}}","Staff approved request {{reference}}. View the approved amount and payment deadline using your private booking link: {{access_url}}"],
  booking_confirmed:["Booking confirmed — {{reference}}","Your booking {{reference}} is confirmed. View your itinerary and any remaining balance: {{access_url}}"],
  request_rejected:["Request update — {{reference}}","Staff reviewed request {{reference}}. Open your private booking link for the decision: {{access_url}}"],
  payment_received:["Payment recorded — {{reference}}","A payment was recorded for {{reference}}. Review the current booking status and balance: {{access_url}}"],
  booking_changed:["Booking update — {{reference}}","Your booking details for {{reference}} have changed. Review the latest arrangements: {{access_url}}"],
  cancellation_update:["Reservation update — {{reference}}","The status of reservation {{reference}} has changed. Review the current decision and any payment details: {{access_url}}"],
  booking_completed:["Thank you — {{reference}}","Thank you for joining Red Sea Horizons. Your booking {{reference}} is complete. View its details: {{access_url}}"],
  refund_update:["Refund update — {{reference}}","A refund update is available for {{reference}}. View the recorded amount and current status: {{access_url}}"],
  gallery_ready:["Your gallery is ready — {{reference}}","Your private gallery for {{reference}} is ready. Open your personal gallery link: {{access_url}}"],
  review_invitation:["Share your experience — {{reference}}","You can share a review of your completed experience {{reference}}: {{access_url}}"],
  pickup_reminder:["Pickup reminder — {{reference}}","Your pickup for {{reference}} is approaching. Check the latest time and meeting instructions: {{access_url}}"]
};
const db=new pg.Client({connectionString:url.toString()});await db.connect();
try{
  await db.query("BEGIN");
  for(const [event,[subject,body]] of Object.entries(templates))await db.query(`INSERT INTO app.notification_templates(event_type,channel,locale,template_version,provider,approval_status,category,subject_template,body_template)
    VALUES($1,'email','en',$4,'local','approved','transactional',$2,$3) ON CONFLICT DO NOTHING`,[event,subject,body,event==="guest_access_requested"?2:1]);
  await db.query("COMMIT");
  console.log("English local-only message previews prepared. No real email/WhatsApp template was approved or sent.");
}catch(error){await db.query("ROLLBACK");throw error;}finally{await db.end();}
