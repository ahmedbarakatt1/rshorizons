import {randomUUID} from "node:crypto";
import {afterAll, afterEach, beforeAll, beforeEach, expect, test} from "vitest";
import pg from "pg";

try { process.loadEnvFile(".env.local"); } catch { /* CI may provide environment variables without a local file. */ }
const db = new pg.Client({connectionString: process.env.MIGRATION_DATABASE_URL});

beforeAll(async () => { await db.connect(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await db.query("BEGIN"); });
afterEach(async () => { await db.query("ROLLBACK"); });

async function identityFixture() {
  const staffId = randomUUID();
  const guestId = randomUUID();
  await db.query("INSERT INTO app.locales(code,direction) VALUES('en','ltr') ON CONFLICT DO NOTHING");
  await db.query("INSERT INTO app.currencies(code,exponent) VALUES('EUR',2) ON CONFLICT DO NOTHING");
  await db.query("INSERT INTO auth.users(id,email) VALUES($1,'staff@example.invalid')", [staffId]);
  await db.query("INSERT INTO app.staff_profiles(id,name,active) VALUES($1,'Synthetic media tester',true)", [staffId]);
  await db.query("INSERT INTO app.guests(id,full_name,email,locale) VALUES($1,'Synthetic media guest','guest@example.invalid','en')", [guestId]);
  return {staffId, guestId};
}

async function assetFixture() {
  const {staffId, guestId} = await identityFixture();
  const assetId = randomUUID();
  await db.query(`INSERT INTO app.media_assets
    (id,storage_bucket,storage_key,uploaded_by,mime_type,size_bytes,checksum_sha256,state,
     rights_evidence_ref,rights_verified_by,rights_verified_at,subjects_reviewed_by,subjects_reviewed_at,safe_at)
    VALUES($1,'private-originals',$1::uuid::text,$2,'image/jpeg',1000,repeat('a',64),'ready',
      'synthetic-evidence',$2,now(),$2,now(),now())`, [assetId, staffId]);
  await db.query("INSERT INTO app.media_subjects(asset_id,guest_id) VALUES($1,$2)", [assetId, guestId]);
  return {staffId, guestId, assetId};
}

async function grantConsent(assetId: string, guestId: string) {
  await db.query(`INSERT INTO app.publication_consents(asset_id,subject_guest_id,granted_by_guest_id,evidence_ref,allowed_uses)
    VALUES($1,$2,$2,'synthetic-evidence',ARRAY['marketing'])`, [assetId, guestId]);
}

test("public_media_requires_consent_for_every_recorded_subject", async () => {
  const {assetId, guestId} = await assetFixture();
  const otherGuestId = randomUUID();
  await grantConsent(assetId, guestId);
  await db.query("INSERT INTO app.guests(id,full_name,email,locale) VALUES($1,'Synthetic second subject','guest@example.invalid','en')", [otherGuestId]);
  await db.query("INSERT INTO app.media_subjects(asset_id,guest_id) VALUES($1,$2)", [assetId, otherGuestId]);
  let result = await db.query("SELECT app.asset_publication_eligible($1) AS eligible", [assetId]);
  expect(result.rows[0].eligible).toBe(false);
  await grantConsent(assetId, otherGuestId);
  result = await db.query("SELECT app.asset_publication_eligible($1) AS eligible", [assetId]);
  expect(result.rows[0].eligible).toBe(true);
});

test("public_gallery_requires_a_separate_approved_derivative", async () => {
  const {assetId, guestId} = await assetFixture();
  await grantConsent(assetId, guestId);
  const galleryId = randomUUID();
  await db.query(`INSERT INTO app.galleries(id,kind,title,visibility_state,published_at)
    VALUES($1,'public','Synthetic public gallery','published',now())`, [galleryId]);
  await db.query("INSERT INTO app.gallery_assets(gallery_id,asset_id) VALUES($1,$2)", [galleryId, assetId]);
  await expect(db.query("SET CONSTRAINTS ALL IMMEDIATE")).rejects.toMatchObject({code: "23514"});
});

test("public_derivatives_cannot_expose_the_original_object_key", async () => {
  const {assetId, guestId, staffId} = await assetFixture();
  await grantConsent(assetId, guestId);
  await db.query(`INSERT INTO app.media_derivatives(asset_id,kind,storage_bucket,storage_key,visibility,state,approved_by,approved_at)
    VALUES($1,'web','private-originals',$1::uuid::text,'public','ready',$2,now())`, [assetId, staffId]);
  await expect(db.query("SET CONSTRAINTS ALL IMMEDIATE")).rejects.toMatchObject({code: "23514"});
});

test("consent_revocation_requires_withdrawing_public_delivery_in_the_same_transaction", async () => {
  const {assetId, guestId, staffId} = await assetFixture();
  await grantConsent(assetId, guestId);
  const derivativeId = randomUUID();
  const galleryId = randomUUID();
  await db.query(`INSERT INTO app.media_derivatives(id,asset_id,kind,storage_bucket,storage_key,visibility,state,approved_by,approved_at)
    VALUES($1,$2,'web','approved-derivatives',$1::uuid::text,'public','ready',$3,now())`, [derivativeId, assetId, staffId]);
  await db.query(`INSERT INTO app.galleries(id,kind,title,visibility_state,published_at)
    VALUES($1,'public','Synthetic public gallery','published',now())`, [galleryId]);
  await db.query("INSERT INTO app.gallery_assets(gallery_id,asset_id,public_derivative_id) VALUES($1,$2,$3)", [galleryId, assetId, derivativeId]);
  await db.query("SET CONSTRAINTS ALL IMMEDIATE");
  await db.query("SET CONSTRAINTS ALL DEFERRED");
  await db.query("UPDATE app.publication_consents SET withdrawn_at=now() WHERE asset_id=$1", [assetId]);
  const result = await db.query("SELECT app.asset_publication_eligible($1) AS eligible", [assetId]);
  expect(result.rows[0].eligible).toBe(false);
  await db.query("UPDATE app.galleries SET visibility_state='revoked' WHERE id=$1", [galleryId]);
  await db.query("UPDATE app.media_derivatives SET visibility='private' WHERE id=$1", [derivativeId]);
  await db.query("SET CONSTRAINTS ALL IMMEDIATE");
});

async function reviewFixture(fulfilmentState = "fulfilled") {
  const {staffId, guestId} = await identityFixture();
  const destinationId = randomUUID(), categoryId = randomUUID(), serviceId = randomUUID();
  const variantId = randomUUID(), policyId = randomUUID(), quoteId = randomUUID();
  const quoteItemId = randomUUID(), bookingId = randomUUID(), itemId = randomUUID(), invitationId = randomUUID();
  await db.query("INSERT INTO app.destinations(id,canonical_slug) VALUES($1,$1::uuid::text)", [destinationId]);
  await db.query("INSERT INTO app.categories(id,code) VALUES($1,$1::uuid::text)", [categoryId]);
  await db.query("INSERT INTO app.services(id,category_id,destination_id,duration_minutes) VALUES($1,$2,$3,60)", [serviceId, categoryId, destinationId]);
  await db.query(`INSERT INTO app.service_variants(id,service_id,variant_code,capacity_model,pricing_unit,duration_minutes)
    VALUES($1,$2,'test','exclusive','booking',60)`, [variantId, serviceId]);
  await db.query("INSERT INTO app.payment_policies(id,code,version,type) VALUES($1,$1::uuid::text,1,'arrival')", [policyId]);
  await db.query(`INSERT INTO app.quotes(id,binding_hash,locale,currency,subtotal,total,initial_due,payment_policy_id,inputs_hash,inputs,policy_snapshot,valid_until)
    VALUES($1,'synthetic','en','EUR',100,100,0,$2,'synthetic','{}','{}',now()+interval '1 hour')`, [quoteId, policyId]);
  await db.query(`INSERT INTO app.quote_items(id,quote_id,position,kind,variant_id,title,quantity,total,initial_due,snapshot)
    VALUES($1,$2,0,'transfer',$3,'Synthetic transfer',1,100,0,'{}')`, [quoteItemId, quoteId, variantId]);
  await db.query(`INSERT INTO app.bookings(id,reference,primary_guest_id,accepted_quote_id,status,currency,total_amount,initial_due_amount,approved_by,approved_at,price_snapshot,policy_snapshot)
    VALUES($1,$1::uuid::text,$2,$3,'completed','EUR',100,0,$4,now(),'{}','{}')`, [bookingId, guestId, quoteId, staffId]);
  await db.query(`INSERT INTO app.booking_items(id,booking_id,quote_item_id,kind,title_snapshot,quantity,total_amount,fulfilment_state)
    VALUES($1,$2,$3,'transfer','Synthetic transfer',1,100,$4)`, [itemId, bookingId, quoteItemId, fulfilmentState]);
  await db.query(`INSERT INTO app.transfer_booking_items(booking_item_id,variant_id,pickup,dropoff,pickup_at,passengers,luggage)
    VALUES($1,$2,'Synthetic pickup','Synthetic dropoff',now(),1,0)`, [itemId, variantId]);
  await db.query(`INSERT INTO app.review_invitations(id,booking_item_id,eligible_at,expires_at)
    VALUES($1,$2,now()-interval '1 hour',now()+interval '1 day')`, [invitationId, itemId]);
  return {guestId, itemId, invitationId};
}

async function submitReview(fixture: {guestId: string; itemId: string; invitationId: string}) {
  return db.query(`INSERT INTO app.reviews(invitation_id,booking_item_id,primary_guest_id,rating,original_text,original_locale,public_display_name)
    VALUES($1,$2,$3,1,'Synthetic critical review','en','Anonymous') RETURNING id`,
  [fixture.invitationId, fixture.itemId, fixture.guestId]);
}

test("review_requires_completed_item", async () => {
  const fixture = await reviewFixture("scheduled");
  await expect(submitReview(fixture)).rejects.toMatchObject({code: "23514"});
});

test("review_requires_the_bookings_actual_primary_guest", async () => {
  const fixture = await reviewFixture();
  const otherGuestId = randomUUID();
  await db.query("INSERT INTO app.guests(id,full_name,email,locale) VALUES($1,'Synthetic other guest','guest@example.invalid','en')", [otherGuestId]);
  await expect(submitReview({...fixture, guestId: otherGuestId})).rejects.toMatchObject({code: "23514"});
});

test("critical_review_can_publish_but_submitted_rating_is_immutable", async () => {
  const fixture = await reviewFixture();
  const result = await submitReview(fixture);
  await db.query("UPDATE app.reviews SET moderation_state='published',published_at=now() WHERE id=$1", [result.rows[0].id]);
  const invitation = await db.query("SELECT used_at IS NOT NULL AS used FROM app.review_invitations WHERE id=$1", [fixture.invitationId]);
  expect(invitation.rows[0].used).toBe(true);
  await expect(db.query("UPDATE app.reviews SET rating=5 WHERE id=$1", [result.rows[0].id])).rejects.toMatchObject({code: "23514"});
});

test("shared_rate_limit_stops_at_the_limit", async () => {
  const digest = randomUUID().replaceAll("-", "").repeat(2);
  const first = await db.query("SELECT * FROM app.consume_rate_limit($1,'synthetic-contact',3600,1)", [digest]);
  const second = await db.query("SELECT * FROM app.consume_rate_limit($1,'synthetic-contact',3600,1)", [digest]);
  expect(first.rows[0].allowed).toBe(true);
  expect(second.rows[0].allowed).toBe(false);
  expect(second.rows[0].remaining).toBe("0");
});
