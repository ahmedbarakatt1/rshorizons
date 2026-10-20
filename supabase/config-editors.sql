-- Source fragment installed in the configuration/video forward migration.
ALTER TABLE app.properties ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
INSERT INTO app.permissions(code,description) VALUES('media.manage','Manage photo packages, assignments and evidence-backed consent') ON CONFLICT DO NOTHING;
INSERT INTO app.role_permissions(role_id,permission_id) SELECT r.id,p.id FROM app.roles r CROSS JOIN app.permissions p WHERE r.code='owner' AND p.code='media.manage' ON CONFLICT DO NOTHING;
CREATE FUNCTION app.request_refund_idempotent(p_input jsonb,p_key text,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE idem app.idempotency_records; request_hash_value text; key_hash_value text; result jsonb; caller text;
BEGIN
 PERFORM app.assert_staff(p_actor,'refunds.request',(p_input->>'bookingId')::uuid);
 IF length(coalesce(p_key,'')) NOT BETWEEN 8 AND 200 THEN RAISE EXCEPTION 'INVALID_IDEMPOTENCY_KEY';END IF;
 caller:='staff:'||p_actor;key_hash_value:=encode(public.digest(p_key,'sha256'),'hex');request_hash_value:=encode(public.digest(p_input::text,'sha256'),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(caller||':refund:'||key_hash_value,0));
 SELECT * INTO idem FROM app.idempotency_records WHERE caller_scope=caller AND operation='request_refund' AND key_hash=key_hash_value;
 IF FOUND THEN
  IF idem.request_hash<>request_hash_value THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
  SELECT app.money_json(to_jsonb(r)) INTO result FROM app.refund_requests r WHERE r.id=idem.response_reference;
  RETURN result;
 END IF;
 result:=app.request_refund((p_input->>'bookingId')::uuid,(p_input->>'originalTransactionId')::uuid,(p_input->>'originalOfflineReceiptId')::uuid,(p_input->>'amountMinor')::bigint,p_input->>'reason',p_input->'policyCalculation',p_actor);
 INSERT INTO app.idempotency_records(caller_scope,operation,key_hash,request_hash,state,response_reference,expires_at) VALUES(caller,'request_refund',key_hash_value,request_hash_value,'complete',(result->>'id')::uuid,now()+interval '7 days');
 RETURN app.money_json(result);
END $$;
CREATE FUNCTION app.staff_config_edit(p_kind text,p_id uuid,p_expected integer,p_data jsonb,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE target uuid:=coalesce(p_id,gen_random_uuid()); result jsonb; old jsonb; destination uuid; property uuid; booking uuid; item_booking uuid; relation_name text; package_snapshot jsonb; consent app.publication_consents; assignment app.photographer_assignments; owner_role boolean; download_limit integer; variants text[];
BEGIN
 PERFORM app.assert_staff(p_actor,CASE WHEN p_kind IN('properties','apartment_policy_bindings') THEN 'apartments.write' ELSE 'media.manage' END);
 relation_name:=CASE p_kind WHEN 'properties' THEN 'properties' WHEN 'photo_packages' THEN 'photo_packages' WHEN 'gallery_entitlements' THEN 'gallery_entitlements' WHEN 'publication_consents' THEN 'publication_consents' WHEN 'media_rights' THEN 'media_assets' WHEN 'media_subjects' THEN 'media_assets' END;
 IF p_id IS NOT NULL AND relation_name IS NOT NULL THEN
  EXECUTE format('SELECT to_jsonb(t) FROM app.%I t WHERE id=$1 FOR UPDATE',relation_name) INTO old USING p_id;
  IF old IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
  IF p_expected IS DISTINCT FROM (old->>'version')::int THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 END IF;
 IF p_kind='properties' THEN
  destination:=coalesce((p_data->>'destinationId')::uuid,(old->>'destination_id')::uuid);
  -- Property-scoped managers may edit their existing property, but cannot create
  -- another property or move their property into an ungranted destination.
  IF NOT app.scope_allows(p_actor,destination,p_id) OR(old IS NOT NULL AND NOT app.scope_allows(p_actor,(old->>'destination_id')::uuid,p_id)) THEN RAISE EXCEPTION 'SCOPE_FORBIDDEN' USING ERRCODE='42501';END IF;
  IF old IS NOT NULL AND destination<>(old->>'destination_id')::uuid THEN RAISE EXCEPTION 'PARENT_CHANGE_FORBIDDEN';END IF;
  IF p_id IS NULL THEN INSERT INTO app.properties(id,destination_id,name,address,latitude,longitude) VALUES(target,destination,p_data->>'name',p_data->>'address',(p_data->>'latitude')::numeric,(p_data->>'longitude')::numeric);
  ELSE UPDATE app.properties SET name=coalesce(p_data->>'name',name),address=coalesce(p_data->>'address',address),latitude=coalesce((p_data->>'latitude')::numeric,latitude),longitude=coalesce((p_data->>'longitude')::numeric,longitude),active=coalesce((p_data->>'active')::boolean,active),version=version+1 WHERE id=target;END IF;
 ELSIF p_kind='apartment_policy_bindings' THEN
  SELECT a.property_id,p.destination_id INTO property,destination FROM app.apartments a JOIN app.properties p ON p.id=a.property_id WHERE a.id=(p_data->>'apartmentId')::uuid;
  IF property IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
  IF NOT app.scope_allows(p_actor,destination,property) THEN RAISE EXCEPTION 'SCOPE_FORBIDDEN' USING ERRCODE='42501';END IF;
  IF NOT EXISTS(SELECT 1 FROM app.payment_policies WHERE id=(p_data->>'policyId')::uuid AND approved_at IS NOT NULL) THEN RAISE EXCEPTION 'APPROVED_POLICY_REQUIRED';END IF;
  INSERT INTO app.apartment_payment_policies(apartment_id,policy_id) VALUES((p_data->>'apartmentId')::uuid,(p_data->>'policyId')::uuid) ON CONFLICT DO NOTHING;
  result:=jsonb_build_object('apartmentId',p_data->>'apartmentId','policyId',p_data->>'policyId');
 ELSIF p_kind='photo_packages' THEN
  IF NOT EXISTS(SELECT 1 FROM app.staff_scopes WHERE staff_id=p_actor AND scope_type='all') THEN RAISE EXCEPTION 'SCOPE_FORBIDDEN' USING ERRCODE='42501';END IF;
  IF p_id IS NULL THEN INSERT INTO app.photo_packages(id,code,entitlement_rules,price_amount,currency) VALUES(target,p_data->>'code',p_data->'entitlementRules',(p_data->>'priceAmountMinor')::bigint,p_data->>'currency');
  ELSE UPDATE app.photo_packages SET entitlement_rules=coalesce(p_data->'entitlementRules',entitlement_rules),price_amount=coalesce((p_data->>'priceAmountMinor')::bigint,price_amount),active=false,version=version+1 WHERE id=target;END IF;
  IF p_data ? 'locale' THEN INSERT INTO app.photo_package_translations(package_id,locale,title,description) VALUES(target,p_data->>'locale',p_data->>'title',coalesce(p_data->>'description',''))
   ON CONFLICT(package_id,locale) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,approved_at=NULL,approved_by=NULL,version=app.photo_package_translations.version+1;END IF;
  IF coalesce((p_data->>'active')::boolean,false) THEN
   IF EXISTS(SELECT 1 FROM app.locales l WHERE l.enabled AND NOT EXISTS(SELECT 1 FROM app.photo_package_translations t WHERE t.package_id=target AND t.locale=l.code AND t.approved_at IS NOT NULL)) THEN RAISE EXCEPTION 'TRANSLATIONS_UNAPPROVED';END IF;
   UPDATE app.photo_packages SET active=true WHERE id=target;
  END IF;
 ELSIF p_kind='photographer_assignments' THEN
  booking:=(p_data->>'bookingId')::uuid;target:=(p_data->>'staffId')::uuid;
  PERFORM app.assert_staff(p_actor,'media.manage',booking);
  IF NOT EXISTS(SELECT 1 FROM app.bookings WHERE id=booking) THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
  PERFORM app.assert_staff(target,'media.upload',booking);
  SELECT * INTO assignment FROM app.photographer_assignments WHERE staff_id=target AND booking_id=booking FOR UPDATE;
  IF assignment.staff_id IS NOT NULL AND p_expected IS DISTINCT FROM assignment.version THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
  INSERT INTO app.photographer_assignments(staff_id,booking_id,access_starts_at,access_ends_at,revoked_at) VALUES(target,booking,(p_data->>'accessStartsAt')::timestamptz,(p_data->>'accessEndsAt')::timestamptz,CASE WHEN (p_data->>'revoked')::boolean THEN clock_timestamp() ELSE NULL END)
  ON CONFLICT(staff_id,booking_id) DO UPDATE SET access_starts_at=EXCLUDED.access_starts_at,access_ends_at=EXCLUDED.access_ends_at,revoked_at=EXCLUDED.revoked_at,version=app.photographer_assignments.version+1 RETURNING to_jsonb(app.photographer_assignments.*) INTO result;
 ELSIF p_kind='gallery_entitlements' THEN
  SELECT g.booking_id,g.destination_id INTO booking,destination FROM app.galleries g WHERE g.id=coalesce((p_data->>'galleryId')::uuid,(old->>'gallery_id')::uuid) AND g.kind='private';
  IF booking IS NULL THEN RAISE EXCEPTION 'PRIVATE_GALLERY_REQUIRED';END IF;
  PERFORM app.assert_staff(p_actor,'media.manage',booking);
  SELECT EXISTS(SELECT 1 FROM app.staff_roles sr JOIN app.roles r ON r.id=sr.role_id WHERE sr.staff_id=p_actor AND r.code='owner') INTO owner_role;
  IF NOT owner_role AND NOT EXISTS(SELECT 1 FROM app.photographer_assignments WHERE staff_id=p_actor AND booking_id=booking AND revoked_at IS NULL AND clock_timestamp() BETWEEN access_starts_at AND access_ends_at) THEN RAISE EXCEPTION 'PHOTOGRAPHER_ASSIGNMENT_REQUIRED' USING ERRCODE='42501';END IF;
  SELECT bi.booking_id INTO item_booking FROM app.booking_items bi WHERE bi.id=coalesce((p_data->>'bookingItemId')::uuid,(old->>'booking_item_id')::uuid) AND bi.kind IN('photography','addon') AND bi.superseded_at IS NULL;
  IF item_booking IS DISTINCT FROM booking THEN RAISE EXCEPTION 'ENTITLEMENT_BOOKING_MISMATCH';END IF;
  IF p_id IS NULL THEN
   SELECT qi.snapshot->'package' INTO package_snapshot FROM app.booking_items bi JOIN app.quote_items qi ON qi.id=bi.quote_item_id WHERE bi.id=(p_data->>'bookingItemId')::uuid;
   IF package_snapshot IS NULL OR (package_snapshot->>'id')::uuid IS DISTINCT FROM (p_data->>'packageId')::uuid THEN RAISE EXCEPTION 'PURCHASED_PACKAGE_REQUIRED';END IF;
   download_limit:=coalesce((package_snapshot->'entitlement_rules'->>'downloads')::int,0);
   variants:=ARRAY(SELECT jsonb_array_elements_text(p_data->'allowedVariants'));
   IF (p_data->>'allowedCount')::int IS NULL OR (p_data->>'allowedCount')::int>download_limit OR NOT variants <@ ARRAY['preview','thumbnail','web','original','video-poster','video']::text[]
      OR(download_limit=0 AND variants && ARRAY['original','video']::text[]) THEN RAISE EXCEPTION 'PACKAGE_LIMIT_EXCEEDED';END IF;
   INSERT INTO app.gallery_entitlements(id,booking_item_id,gallery_id,package_id,package_snapshot,allowed_variants,allowed_count,expires_at)
   VALUES(target,(p_data->>'bookingItemId')::uuid,(p_data->>'galleryId')::uuid,(package_snapshot->>'id')::uuid,package_snapshot,variants,(p_data->>'allowedCount')::int,(p_data->>'expiresAt')::timestamptz);
  ELSE
   IF p_data ? 'bookingItemId' OR p_data ? 'galleryId' OR p_data ? 'packageId' THEN RAISE EXCEPTION 'PARENT_CHANGE_FORBIDDEN';END IF;
   UPDATE app.gallery_entitlements SET revoked_at=CASE WHEN (p_data->>'revoked')::boolean THEN clock_timestamp() ELSE revoked_at END,expires_at=coalesce((p_data->>'expiresAt')::timestamptz,expires_at),version=version+1 WHERE id=target;
  END IF;
  -- Eligibility derives from booked payment/fulfilment state, never an editor flag.
  UPDATE app.gallery_entitlements ge SET payment_eligible=b.status IN('confirmed','completed') AND coalesce((SELECT sum(amount) FROM app.cash_ledger WHERE booking_id=b.id),0)>=b.total_amount,delivery_eligible=bi.fulfilment_state='fulfilled' FROM app.booking_items bi JOIN app.bookings b ON b.id=bi.booking_id WHERE ge.id=target AND bi.id=ge.booking_item_id;
 ELSIF p_kind IN('media_rights','media_subjects') THEN
  IF p_id IS NULL THEN RAISE EXCEPTION 'ASSET_REQUIRED';END IF;
  IF NOT app.scope_allows(p_actor,NULL,NULL) OR NOT EXISTS(SELECT 1 FROM app.staff_roles sr JOIN app.roles r ON r.id=sr.role_id WHERE sr.staff_id=p_actor AND r.code='owner') THEN RAISE EXCEPTION 'OWNER_REQUIRED' USING ERRCODE='42501';END IF;
  IF p_kind='media_subjects' THEN
   INSERT INTO app.media_subjects(asset_id,guest_id,guardian_guest_id) VALUES(target,(p_data->>'subjectGuestId')::uuid,(p_data->>'guardianGuestId')::uuid) ON CONFLICT DO NOTHING;
   UPDATE app.media_assets SET subjects_reviewed_at=NULL,subjects_reviewed_by=NULL,version=version+1 WHERE id=target;
   UPDATE app.media_derivatives SET visibility='private',version=version+1 WHERE asset_id=target AND visibility='public';
   UPDATE app.galleries SET visibility_state='revoked',version=version+1 WHERE kind='public' AND id IN(SELECT gallery_id FROM app.gallery_assets WHERE asset_id=target);
  ELSE
   IF length(btrim(coalesce(p_data->>'rightsEvidenceRef','')))<3 OR (p_data->>'subjectsReviewed')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'RIGHTS_AND_SUBJECT_REVIEW_REQUIRED';END IF;
   UPDATE app.media_assets SET rights_evidence_ref=p_data->>'rightsEvidenceRef',rights_verified_by=p_actor,rights_verified_at=clock_timestamp(),subjects_reviewed_by=p_actor,subjects_reviewed_at=clock_timestamp(),version=version+1 WHERE id=target;
  END IF;
 ELSIF p_kind='publication_consents' THEN
  -- A consent record is an evidence-backed assertion by the subject/guardian,
  -- never inferred from a purchase. Historical evidence is immutable.
  IF NOT EXISTS(SELECT 1 FROM app.staff_scopes WHERE staff_id=p_actor AND scope_type='all') THEN RAISE EXCEPTION 'SCOPE_FORBIDDEN' USING ERRCODE='42501';END IF;
  IF p_id IS NULL THEN
   IF NOT EXISTS(SELECT 1 FROM app.media_subjects ms WHERE ms.asset_id=(p_data->>'assetId')::uuid AND ms.guest_id=(p_data->>'subjectGuestId')::uuid AND (ms.guest_id=(p_data->>'grantedByGuestId')::uuid OR ms.guardian_guest_id=(p_data->>'grantedByGuestId')::uuid)) THEN RAISE EXCEPTION 'CONSENT_SUBJECT_MISMATCH';END IF;
   INSERT INTO app.publication_consents(id,asset_id,subject_guest_id,granted_by_guest_id,evidence_ref,allowed_uses,expires_at)
   VALUES(target,(p_data->>'assetId')::uuid,(p_data->>'subjectGuestId')::uuid,(p_data->>'grantedByGuestId')::uuid,p_data->>'evidenceRef',ARRAY(SELECT jsonb_array_elements_text(p_data->'allowedUses')),(p_data->>'expiresAt')::timestamptz);
  ELSE
   IF p_data - 'withdrawn' - 'expectedVersion' <> '{}'::jsonb OR (p_data->>'withdrawn')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'CONSENT_EVIDENCE_IMMUTABLE';END IF;
   UPDATE app.publication_consents SET withdrawn_at=coalesce(withdrawn_at,clock_timestamp()),version=version+1 WHERE id=target RETURNING * INTO consent;
   UPDATE app.media_derivatives SET visibility='private',version=version+1 WHERE asset_id=consent.asset_id AND visibility='public';
   UPDATE app.galleries SET visibility_state='revoked',version=version+1 WHERE kind='public' AND id IN(SELECT gallery_id FROM app.gallery_assets WHERE asset_id=consent.asset_id);
  END IF;
 ELSE RAISE EXCEPTION 'INVALID_EDITOR';END IF;
 IF relation_name IS NOT NULL THEN EXECUTE format('SELECT to_jsonb(t) FROM app.%I t WHERE id=$1',relation_name) INTO result USING target;END IF;
 INSERT INTO app.audit_events(actor_type,actor_id,action,target_type,target_id,summary) VALUES('staff',p_actor,CASE WHEN p_id IS NULL THEN 'created' ELSE 'updated' END,p_kind,target,jsonb_build_object('version',result->'version','fields',ARRAY(SELECT jsonb_object_keys(p_data))));
 RETURN app.money_json(result);
END $$;
REVOKE ALL ON FUNCTION app.request_refund_idempotent(jsonb,text,uuid),app.staff_config_edit(text,uuid,integer,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app.request_refund_idempotent(jsonb,text,uuid),app.staff_config_edit(text,uuid,integer,jsonb,uuid) TO tourism_app;
