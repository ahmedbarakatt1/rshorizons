import type {ActorContext,Transaction} from "@/server/db";
import {MediaError} from "./validation";
export const privateHeaders={"Cache-Control":"private, no-store, max-age=0","Pragma":"no-cache","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"};
export async function staffPermission(tx:Transaction,actor:ActorContext,permission:string){
  if(actor.type!=="staff"||!actor.id)throw new MediaError("NOT_FOUND",404);
  const {rows}=await tx.query(`SELECT p.id,EXISTS(SELECT 1 FROM app.staff_roles sr JOIN app.roles r ON r.id=sr.role_id WHERE sr.staff_id=p.id AND r.code='owner') AS owner
    FROM app.staff_profiles p WHERE p.id=$1 AND p.active AND p.revoked_at IS NULL AND (
    EXISTS(SELECT 1 FROM app.staff_roles sr JOIN app.role_permissions rp ON rp.role_id=sr.role_id JOIN app.permissions pe ON pe.id=rp.permission_id WHERE sr.staff_id=p.id AND pe.code=$2)
    OR EXISTS(SELECT 1 FROM app.staff_permission_grants g JOIN app.permissions pe ON pe.id=g.permission_id WHERE g.staff_id=p.id AND pe.code=$2))`,[actor.id,permission]);
  if(!rows[0])throw new MediaError("NOT_FOUND",404);
  return rows[0] as {id:string;owner:boolean};
}
export async function authorizeGallery(tx:Transaction,actor:ActorContext,galleryId:string,permission="galleries.manage"){
  const {rows}=await tx.query(`SELECT * FROM app.galleries WHERE id=$1`,[galleryId]);
  const gallery=rows[0];
  if(!gallery)throw new MediaError("NOT_FOUND",404);
  if(actor.type==="staff"){
    const staff=await staffPermission(tx,actor,permission);
    if(!staff.owner){
      const assignment=gallery.booking_id?await tx.query(`SELECT 1 FROM app.photographer_assignments WHERE staff_id=$1 AND booking_id=$2 AND access_starts_at<=now() AND access_ends_at>now() AND revoked_at IS NULL`,[actor.id,gallery.booking_id]):null;
      const scope=await tx.query(`SELECT 1 FROM app.staff_scopes WHERE staff_id=$1 AND (scope_type='all' OR (scope_type='destination' AND destination_id=$2))`,[actor.id,gallery.destination_id]);
      // Private galleries require the explicit, time-bounded photographer assignment.
      if(gallery.kind==="private"?!assignment?.rowCount:!scope.rowCount)throw new MediaError("NOT_FOUND",404);
    }
    return {gallery,sessionId:null as string|null,grantId:null as string|null};
  }
  if(actor.type!=="guest"||!actor.sessionHash||gallery.kind!=="private"||gallery.visibility_state!=="published"||(gallery.expires_at&&new Date(gallery.expires_at)<=new Date()))throw new MediaError("NOT_FOUND",404);
  const session=await tx.query(`SELECT s.id,s.grant_id FROM app.guest_sessions s JOIN app.access_grants a ON a.id=s.grant_id
    WHERE s.session_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND a.revoked_at IS NULL AND a.expires_at>now()
    AND 'gallery:read'=ANY(s.scope)
    AND 'gallery:read'=ANY(a.scope)
    AND ((a.purpose='gallery' AND a.gallery_id=$2) OR (a.purpose='booking' AND a.booking_id=$3))`,[actor.sessionHash,galleryId,gallery.booking_id]);
  if(!session.rows[0])throw new MediaError("NOT_FOUND",404);
  return {gallery,sessionId:session.rows[0].id as string,grantId:session.rows[0].grant_id as string};
}
