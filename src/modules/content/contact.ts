import {z} from "zod";
import {query,withTransaction} from "@/server/db";
import {MediaError} from "@/modules/photography/validation";
export const contactInputSchema=z.object({
  name:z.string().trim().min(1).max(200),email:z.email().max(254).optional(),phoneE164:z.string().regex(/^\+[1-9][0-9]{6,14}$/).optional(),
  locale:z.enum(["en","de","pl","fr","ru","uk","es","ar","it","nl"]),
  message:z.string().trim().min(1).max(10000),consent:z.literal(true),privacyVersion:z.string().trim().min(1).max(100),
  website:z.string().max(200).optional()
}).strict().refine(v=>Boolean(v.email||v.phoneE164),{message:"CONTACT_REQUIRED"});
export async function submitContact(input:unknown,context:{rateLimitKeyDigest:string}){
  const data=contactInputSchema.parse(input);
  z.string().regex(/^[0-9a-f]{64}$/).parse(context.rateLimitKeyDigest);
  // Bot trap intentionally returns the same acknowledgement without storing unsolicited content.
  if(data.website)return {accepted:true};
  return withTransaction({type:"system"},async tx=>{
    const limited=await tx.query(`SELECT * FROM app.consume_rate_limit($1,'contact',3600,5)`,[context.rateLimitKeyDigest]);
    if(!limited.rows[0]?.allowed)throw new MediaError("RATE_LIMITED",429);
    const policy=await tx.query(`SELECT 1 FROM app.policy_versions WHERE policy_type='privacy' AND version=$1 AND locale=$2 AND approved_at IS NOT NULL AND effective_at<=now()`,[data.privacyVersion,data.locale]);
    if(!policy.rowCount)throw new MediaError("PRIVACY_POLICY_UNAVAILABLE",503);
    const result=await tx.query(`INSERT INTO app.contact_requests(sender_name,email,phone_e164,locale,message,consent_metadata,retention_deadline) VALUES($1,$2,$3,$4,$5,$6,now()+interval '90 days') RETURNING id`,[data.name,data.email??null,data.phoneE164??null,data.locale,data.message,{privacyVersion:data.privacyVersion,contactResponse:true,marketing:false,source:"contact_form"}]);
    await tx.query(`INSERT INTO app.outbox_events(aggregate_type,aggregate_id,aggregate_version,event_type,event_key,payload) VALUES('contact',$1,1,'contact_received',$2,$3)`,[result.rows[0].id,`contact:${result.rows[0].id}`,{contactRequestId:result.rows[0].id}]);
    return {accepted:true,id:result.rows[0].id};
  });
}
export async function getSocialLinks(){
  const result=await query(`SELECT platform,url FROM app.social_links WHERE active AND verified_at IS NOT NULL ORDER BY platform`);
  return result.rows;
}
