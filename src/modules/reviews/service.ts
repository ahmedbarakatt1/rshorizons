import {z} from "zod";
import {query,withTransaction,type ActorContext} from "@/server/db";
import {staffPermission} from "@/modules/photography/access";
import {MediaError} from "@/modules/photography/validation";
import type {PublishedReview,ReviewPage} from "./types";
const locale=z.enum(["en","de","pl","fr","ru","uk","es","ar","it","nl"]);
export const reviewInputSchema=z.object({invitationId:z.uuid(),rating:z.number().int().min(1).max(5),text:z.string().trim().min(1).max(10000),locale,
  displayName:z.enum(["first_name","initials","anonymous"]).default("initials")}).strict();
export function safeDisplayName(fullName:string,preference:"first_name"|"initials"|"anonymous"){
  if(preference==="anonymous")return "Guest";
  const parts=fullName.replace(/[<>]/g,"").trim().split(/\s+/).filter(Boolean);
  return (preference==="first_name"?parts[0]:parts.slice(0,4).map(p=>`${[...p][0]}.`).join(" "))?.slice(0,100)||"Guest";
}
export async function submitReview(actor:ActorContext,input:unknown){
  const data=reviewInputSchema.parse(input);
  if(actor.type!=="guest"||!actor.sessionHash)throw new MediaError("NOT_FOUND",404);
  return withTransaction(actor,async tx=>{
    const result=await tx.query(`SELECT i.id,i.booking_item_id,b.primary_guest_id,g.full_name FROM app.review_invitations i
      JOIN app.booking_items bi ON bi.id=i.booking_item_id JOIN app.bookings b ON b.id=bi.booking_id JOIN app.guests g ON g.id=b.primary_guest_id
      JOIN app.access_grants a ON a.review_invitation_id=i.id AND a.purpose='review'
      JOIN app.guest_sessions s ON s.grant_id=a.id
      WHERE i.id=$1 AND s.session_hash=$2 AND s.expires_at>now() AND s.revoked_at IS NULL AND a.expires_at>now() AND a.revoked_at IS NULL
      AND 'review:submit'=ANY(s.scope) AND 'review:submit'=ANY(a.scope) AND bi.fulfilment_state='fulfilled'
      AND i.eligible_at<=now() AND i.expires_at>now() AND i.revoked_at IS NULL AND i.used_at IS NULL FOR UPDATE OF i`,[data.invitationId,actor.sessionHash]);
    const eligible=result.rows[0];if(!eligible)throw new MediaError("REVIEW_NOT_ELIGIBLE",404);
    const review=await tx.query(`INSERT INTO app.reviews(invitation_id,booking_item_id,primary_guest_id,rating,original_text,original_locale,display_name_preference,public_display_name)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,moderation_state`,[eligible.id,eligible.booking_item_id,eligible.primary_guest_id,data.rating,data.text,data.locale,data.displayName,safeDisplayName(eligible.full_name,data.displayName)]);
    return {id:review.rows[0].id,state:review.rows[0].moderation_state};
  });
}
export const moderationInputSchema=z.object({reviewId:z.uuid(),expectedVersion:z.number().int().positive(),action:z.enum(["publish","reject","withdraw","restore"]),reason:z.string().trim().min(1).max(2000)}).strict();
export async function moderateReview(actor:ActorContext,input:unknown){
  const data=moderationInputSchema.parse(input);
  return withTransaction(actor,async tx=>{
    const staff=await staffPermission(tx,actor,"reviews.moderate");
    // V1 moderation is agency-wide, so require all-scope instead of silently widening a destination grant.
    if(!staff.owner){const scope=await tx.query(`SELECT 1 FROM app.staff_scopes WHERE staff_id=$1 AND scope_type='all'`,[actor.id]);if(!scope.rowCount)throw new MediaError("NOT_FOUND",404);}
    const state={publish:"published",reject:"rejected",withdraw:"withdrawn",restore:"published"}[data.action];
    const result=await tx.query(`UPDATE app.reviews SET moderation_state=$3,published_at=CASE WHEN $3='published' THEN now() ELSE published_at END,version=version+1,updated_at=now() WHERE id=$1 AND version=$2 RETURNING id,version,moderation_state`,[data.reviewId,data.expectedVersion,state]);
    if(!result.rowCount)throw new MediaError("VERSION_CONFLICT",409);
    await tx.query(`INSERT INTO app.review_moderation_events(review_id,actor_id,action,reason) VALUES($1,$2,$3,$4)`,[data.reviewId,actor.id,data.action,data.reason]);
    return result.rows[0];
  });
}
export async function replyToReview(actor:ActorContext,input:{reviewId:string;body:string}){
  const data=z.object({reviewId:z.uuid(),body:z.string().trim().min(1).max(10000)}).strict().parse(input);
  return withTransaction(actor,async tx=>{
    const staff=await staffPermission(tx,actor,"reviews.moderate");
    if(!staff.owner){const scope=await tx.query(`SELECT 1 FROM app.staff_scopes WHERE staff_id=$1 AND scope_type='all'`,[actor.id]);if(!scope.rowCount)throw new MediaError("NOT_FOUND",404);}
    const result=await tx.query(`INSERT INTO app.review_replies(review_id,staff_id,body,published_at) SELECT id,$2,$3,now() FROM app.reviews WHERE id=$1 AND moderation_state='published' RETURNING id`,[data.reviewId,actor.id,data.body]);
    if(!result.rowCount)throw new MediaError("NOT_FOUND",404);
    return result.rows[0];
  });
}
export async function listPublishedReviews(input:{serviceId?:string;cursor?:string}={}){
  if(input.serviceId)z.uuid().parse(input.serviceId);if(input.cursor)z.iso.datetime({offset:true}).parse(input.cursor);
  const result=await query(`SELECT r.id,r.rating,r.original_text text,r.original_locale locale,r.public_display_name display_name,r.submitted_at,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('body',reply.body,'publishedAt',reply.published_at)) FROM app.review_replies reply WHERE reply.review_id=r.id AND reply.published_at IS NOT NULL AND reply.withdrawn_at IS NULL),'[]'::jsonb) replies
    FROM app.reviews r JOIN app.booking_items bi ON bi.id=r.booking_item_id JOIN app.quote_items qi ON qi.id=bi.quote_item_id LEFT JOIN app.service_variants v ON v.id=qi.variant_id
    WHERE r.moderation_state='published' AND ($1::uuid IS NULL OR v.service_id=$1) AND ($2::timestamptz IS NULL OR r.submitted_at<$2)
    ORDER BY r.submitted_at DESC LIMIT 50`,[input.serviceId??null,input.cursor??null]);
  return result.rows;
}

export const reviewPageInputSchema=z.object({
 serviceId:z.uuid().optional(),cursor:z.uuid().optional(),rating:z.coerce.number().int().min(1).max(5).optional(),
 limit:z.coerce.number().int().min(1).max(24).default(12)
}).strict();

export async function listReviewPage(input:z.input<typeof reviewPageInputSchema>={}):Promise<ReviewPage>{
 const data=reviewPageInputSchema.parse(input);
 // One statement keeps aggregate and page consistent. The ID cursor retains PostgreSQL's full timestamp precision.
 const result=await query<{items:PublishedReview[];total:number;average:number|null;ratings:Record<string,number>;filtered_total:number}>(`
  WITH published AS (
   SELECT r.* FROM app.reviews r
   JOIN app.booking_items bi ON bi.id=r.booking_item_id
   JOIN app.quote_items qi ON qi.id=bi.quote_item_id
   LEFT JOIN app.service_variants v ON v.id=qi.variant_id
   WHERE r.moderation_state='published' AND ($1::uuid IS NULL OR v.service_id=$1)
  ), filtered AS (SELECT * FROM published WHERE $2::integer IS NULL OR rating=$2),
  page AS (
   SELECT * FROM filtered WHERE $3::uuid IS NULL OR (submitted_at,id)<(SELECT submitted_at,id FROM app.reviews WHERE id=$3)
   ORDER BY submitted_at DESC,id DESC LIMIT $4
  )
  SELECT (SELECT count(*)::integer FROM published) total,(SELECT round(avg(rating),1)::float FROM published) average,
   (SELECT jsonb_object_agg(star,(SELECT count(*)::integer FROM published WHERE rating=star)) FROM generate_series(1,5) star) ratings,
   (SELECT count(*)::integer FROM filtered) filtered_total,
   COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'rating',r.rating,'text',r.original_text,'locale',r.original_locale,
    'display_name',r.public_display_name,'submitted_at',r.submitted_at,'replies',
    COALESCE((SELECT jsonb_agg(jsonb_build_object('body',reply.body,'publishedAt',reply.published_at) ORDER BY reply.published_at,reply.id)
     FROM app.review_replies reply WHERE reply.review_id=r.id AND reply.published_at IS NOT NULL AND reply.withdrawn_at IS NULL),'[]'::jsonb))
    ORDER BY r.submitted_at DESC,r.id DESC) FROM page r),'[]'::jsonb) items`,
  [data.serviceId??null,data.rating??null,data.cursor??null,data.limit+1]);
 const row=result.rows[0],hasMore=row.items.length>data.limit,items=row.items.slice(0,data.limit);
 return {items,summary:{total:row.total,average:row.average,ratings:row.ratings},filteredTotal:row.filtered_total,nextCursor:hasMore?items.at(-1)!.id:null};
}
