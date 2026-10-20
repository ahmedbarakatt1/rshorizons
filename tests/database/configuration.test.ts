import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,expect,test} from "vitest";
import {admin,makeActor,makeBooking,makeDeparture,tourItem} from "./helpers";
const db=admin();beforeAll(()=>db.connect());afterAll(()=>db.end());
async function photoBooking(){
 const actor=await makeActor(db),packageId=randomUUID();
 await db.query("INSERT INTO app.photo_packages(id,code,entitlement_rules,price_amount,currency,active) VALUES($1,$1::uuid::text,'{\"previews\":true,\"downloads\":5}',75000,'EGP',true)",[packageId]);
 await db.query("INSERT INTO app.photo_package_translations(package_id,locale,title,description,approved_by,approved_at) VALUES($1,'en','Synthetic photo package','Five downloads',$2,now())",[packageId,actor]);
 const variant=(await db.query("SELECT id FROM app.service_variants WHERE id=md5('variant:photography')::uuid")).rows[0].id;
 const result=await makeBooking(db,[{kind:"photography",variantId:variant,participants:1,packageId,requestedStart:"2027-10-01T10:00:00+02:00"}]);
 return {...result,actor,packageId};
}
test("photo_package_is_server_priced_and_snapshotted",async()=>{
 const {quote,packageId}=await photoBooking();
 expect(quote.items[0].total).toBe("75000");
 expect(quote.items[0].snapshot.package.id).toBe(packageId);
 expect(quote.items[0].snapshot.package.entitlement_rules.downloads).toBe(5);
});
test("gallery_entitlement_cannot_exceed_purchased_package",async()=>{
 const {booking,actor,packageId}=await photoBooking(),item=(await db.query("SELECT id FROM app.booking_items WHERE booking_id=$1",[booking.id])).rows[0].id;
 const gallery=(await db.query("INSERT INTO app.galleries(kind,booking_id,title) VALUES('private',$1,'Synthetic') RETURNING id",[booking.id])).rows[0].id;
 const data={bookingItemId:item,galleryId:gallery,packageId,allowedVariants:["preview","original"],allowedCount:6};
 await expect(db.query("SELECT app.staff_edit('gallery_entitlements',NULL,NULL,$1,$2)",[JSON.stringify(data),actor])).rejects.toThrow("PACKAGE_LIMIT_EXCEEDED");
 const result=(await db.query("SELECT app.staff_edit('gallery_entitlements',NULL,NULL,$1,$2) r",[JSON.stringify({...data,allowedCount:5}),actor])).rows[0].r;
 expect(result.payment_eligible).toBe(false);expect(result.delivery_eligible).toBe(false);
});
test("variant_translation_edit_revokes_previous_approval",async()=>{
 const actor=await makeActor(db),service=(await db.query("SELECT id FROM app.services LIMIT 1")).rows[0].id;
 const data={serviceId:service,variantCode:"test-"+randomUUID(),capacityModel:"none",pricingUnit:"booking",durationMinutes:60,locale:"en",title:"Draft variant",description:"Fixture"};
 const variant=(await db.query("SELECT app.staff_edit('variants',NULL,NULL,$1,$2) r",[JSON.stringify(data),actor])).rows[0].r;
 await db.query("SELECT app.approve_translation('variants',$1,'en',$2)",[variant.id,actor]);
 await db.query("SELECT app.staff_edit('variants',$1,1,$2,$3)",[variant.id,JSON.stringify({...data,title:"Changed variant"}),actor]);
 expect((await db.query("SELECT approved_at FROM app.variant_translations WHERE variant_id=$1 AND locale='en'",[variant.id])).rows[0].approved_at).toBeNull();
});
test("photographer_assignment_checks_permission_and_version",async()=>{
 const actor=await makeActor(db),photographer=await makeActor(db,"photographer"),d=await makeDeparture(db),{booking}=await makeBooking(db,[await tourItem(db,d.id)]);
 const data={staffId:photographer,bookingId:booking.id,accessStartsAt:"2026-01-01T00:00:00Z",accessEndsAt:"2028-01-01T00:00:00Z"};
 await expect(db.query("SELECT app.staff_edit('photographer_assignments',NULL,NULL,$1,$2)",[JSON.stringify(data),photographer])).rejects.toThrow("FORBIDDEN");
 await db.query("SELECT app.staff_edit('photographer_assignments',NULL,NULL,$1,$2)",[JSON.stringify(data),actor]);
 await expect(db.query("SELECT app.staff_edit('photographer_assignments',NULL,99,$1,$2)",[JSON.stringify({...data,revoked:true}),actor])).rejects.toThrow("VERSION_CONFLICT");
});
test("consent_evidence_cannot_be_edited_and_withdrawal_is_explicit",async()=>{
 const actor=await makeActor(db),d=await makeDeparture(db),{booking}=await makeBooking(db,[await tourItem(db,d.id)]),asset=randomUUID();
 await db.query("INSERT INTO app.media_assets(id,storage_bucket,storage_key,uploaded_by,mime_type,size_bytes,checksum_sha256) VALUES($1,'private',$1::uuid::text,$2,'image/jpeg',100,repeat('a',64))",[asset,actor]);
 await db.query("INSERT INTO app.media_subjects(asset_id,guest_id) VALUES($1,$2)",[asset,booking.primary_guest_id]);
 const data={assetId:asset,subjectGuestId:booking.primary_guest_id,grantedByGuestId:booking.primary_guest_id,evidenceRef:"synthetic-consent-record",allowedUses:["website"]};
 const consent=(await db.query("SELECT app.staff_edit('publication_consents',NULL,NULL,$1,$2) r",[JSON.stringify(data),actor])).rows[0].r;
 await expect(db.query("UPDATE app.publication_consents SET evidence_ref='changed' WHERE id=$1",[consent.id])).rejects.toThrow("CONSENT_EVIDENCE_IMMUTABLE");
 const withdrawn=(await db.query("SELECT app.staff_edit('publication_consents',$1,1,'{\"withdrawn\":true}',$2) r",[consent.id,actor])).rows[0].r;
 expect(withdrawn.withdrawn_at).toBeTruthy();expect(withdrawn.evidence_ref).toBe("synthetic-consent-record");
});
test("explicit_infinity_cannot_create_unbounded_inventory",async()=>{
 const actor=await makeActor(db),apartment=(await db.query("SELECT id FROM app.apartments LIMIT 1")).rows[0].id;
 await db.query("BEGIN");
 try{
  await expect(db.query("INSERT INTO app.apartment_inventory(apartment_id,kind,date_range,actor_id,reason) VALUES($1,'maintenance',daterange('2030-01-01','infinity','[)'),$2,'Fixture')",[apartment,actor])).rejects.toMatchObject({code:"23514"});
 }finally{await db.query("ROLLBACK");}
});
test("fulfilment_rejects_stale_booking_version",async()=>{
 const actor=await makeActor(db),d=await makeDeparture(db),{booking}=await makeBooking(db,[await tourItem(db,d.id)]);
 await db.query("SELECT app.approve_booking($1,1,$2)",[booking.id,actor]);
 const item=(await db.query("SELECT id FROM app.booking_items WHERE booking_id=$1",[booking.id])).rows[0].id;
 await expect(db.query("SELECT app.fulfil_item_versioned($1,'fulfilled','Fixture',1,$2)",[item,actor])).rejects.toThrow("VERSION_CONFLICT");
 await db.query("SELECT app.fulfil_item_versioned($1,'fulfilled','Fixture',2,$2)",[item,actor]);
});
test("invitation_requires_matching_auth_identity_and_stays_inactive",async()=>{
 const owner=await makeActor(db),identity=randomUUID();
 await db.query("INSERT INTO auth.users(id,email) VALUES($1,'invited@example.invalid')",[identity]);
 const args=[identity,"invited@example.invalid","Synthetic invite",["operations"],JSON.stringify([{scopeType:"all"}]),owner];
 const invited=(await db.query("SELECT app.invite_staff($1,$2,$3,$4,$5,$6) r",args)).rows[0].r;
 expect(invited.active).toBe(false);expect(invited.invitationState).toBe("pending_activation");
 await expect(db.query("SELECT app.invite_staff($1,$2,$3,$4,$5,$6)",[identity,"different@example.invalid",...args.slice(2)])).rejects.toThrow("INVITED_AUTH_IDENTITY_REQUIRED");
});
test("invitation_rejects_unknown_roles",async()=>{
 const owner=await makeActor(db),identity=randomUUID();
 await db.query("INSERT INTO auth.users(id,email) VALUES($1,'invited@example.invalid')",[identity]);
 await expect(db.query("SELECT app.invite_staff($1,$2,$3,$4,$5,$6)",[identity,"invited@example.invalid","Synthetic",["not-a-role"],JSON.stringify([{scopeType:"all"}]),owner])).rejects.toThrow("INVALID_ROLES");
});
test("retry_job_requires_scope_even_without_booking_payload",async()=>{
 const actor=await makeActor(db),destination=(await db.query("SELECT id FROM app.destinations LIMIT 1")).rows[0].id;
 await db.query("DELETE FROM app.staff_scopes WHERE staff_id=$1",[actor]);
 await db.query("INSERT INTO app.staff_scopes(staff_id,scope_type,destination_id) VALUES($1,'destination',$2)",[actor,destination]);
 const event=(await db.query("INSERT INTO app.outbox_events(aggregate_type,aggregate_id,aggregate_version,event_type,event_key) VALUES('contact',gen_random_uuid(),1,'contact.requested',gen_random_uuid()::text) RETURNING id")).rows[0].id;
 const job=(await db.query("INSERT INTO app.jobs(event_id,kind,job_key,status) VALUES($1,'notification',gen_random_uuid()::text,'failed') RETURNING id",[event])).rows[0].id;
 await expect(db.query("SELECT app.retry_job($1,$2)",[job,actor])).rejects.toThrow("SCOPE_FORBIDDEN");
});
test("media_rights_and_subject_records_require_owner_evidence_and_version",async()=>{
 const actor=await makeActor(db),photographer=await makeActor(db,"photographer"),asset=randomUUID(),guest=randomUUID();
 await db.query("INSERT INTO app.media_assets(id,storage_bucket,storage_key,uploaded_by,mime_type,size_bytes,checksum_sha256) VALUES($1,'private',$1::uuid::text,$2,'image/jpeg',100,repeat('c',64))",[asset,actor]);
 await db.query("INSERT INTO app.guests(id,full_name,email,locale) VALUES($1,'Synthetic subject','guest@example.invalid','en')",[guest]);
 await expect(db.query("SELECT app.staff_edit('media_rights',$1,1,$2,$3)",[asset,JSON.stringify({rightsEvidenceRef:"synthetic-proof",subjectsReviewed:true}),photographer])).rejects.toThrow("FORBIDDEN");
 await db.query("SELECT app.staff_edit('media_subjects',$1,1,$2,$3)",[asset,JSON.stringify({subjectGuestId:guest}),actor]);
 const result=(await db.query("SELECT app.staff_edit('media_rights',$1,2,$2,$3) r",[asset,JSON.stringify({rightsEvidenceRef:"synthetic-proof",subjectsReviewed:true}),actor])).rows[0].r;
 expect(result.rights_verified_by).toBe(actor);expect(result.subjects_reviewed_by).toBe(actor);
});
