ALTER TABLE app.apartment_inventory ADD CONSTRAINT apartment_inventory_finite_dates CHECK(isfinite(lower(date_range)) AND isfinite(upper(date_range)));
ALTER TABLE app.resource_occupancy ADD CONSTRAINT resource_occupancy_finite_times CHECK(isfinite(lower(time_range)) AND isfinite(upper(time_range)));
ALTER TABLE app.price_rules ADD CONSTRAINT price_rules_finite_dates CHECK(isfinite(lower(effective_range)) AND isfinite(upper(effective_range)));
ALTER TABLE app.apartment_rate_rules ADD CONSTRAINT apartment_rates_finite_dates CHECK(isfinite(lower(date_range)) AND isfinite(upper(date_range)));
CREATE OR REPLACE FUNCTION app.guard_consent_evidence() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
BEGIN
 IF TG_OP='DELETE' OR ROW(NEW.id,NEW.asset_id,NEW.subject_guest_id,NEW.granted_by_guest_id,NEW.evidence_ref,NEW.allowed_uses,NEW.granted_at,NEW.expires_at,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.asset_id,OLD.subject_guest_id,OLD.granted_by_guest_id,OLD.evidence_ref,OLD.allowed_uses,OLD.granted_at,OLD.expires_at,OLD.created_at)
 OR(OLD.withdrawn_at IS NOT NULL AND NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at) THEN RAISE EXCEPTION 'CONSENT_EVIDENCE_IMMUTABLE' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER consent_evidence_immutable BEFORE UPDATE OR DELETE ON app.publication_consents FOR EACH ROW EXECUTE FUNCTION app.guard_consent_evidence();
CREATE OR REPLACE FUNCTION app.fulfil_item_versioned(p_item uuid,p_state text,p_note text,p_expected integer,p_actor uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE booking uuid; current_version integer;
BEGIN
 SELECT bi.booking_id INTO booking FROM app.booking_items bi WHERE bi.id=p_item AND bi.superseded_at IS NULL;
 IF booking IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 PERFORM app.assert_staff(p_actor,'operations.write',booking);
 SELECT version INTO current_version FROM app.bookings WHERE id=booking FOR UPDATE;
 IF current_version IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 PERFORM app.fulfil_item(p_item,p_state,p_note,p_actor);
END $$;
CREATE OR REPLACE FUNCTION app.invite_staff(p_identity uuid,p_email text,p_name text,p_roles text[],p_scopes jsonb,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE result jsonb;
BEGIN
 PERFORM app.assert_staff(p_actor,'staff.manage');
 IF NOT EXISTS(SELECT 1 FROM app.staff_roles sr JOIN app.roles r ON r.id=sr.role_id WHERE sr.staff_id=p_actor AND r.code='owner') OR NOT app.scope_allows(p_actor,NULL,NULL) THEN RAISE EXCEPTION 'OWNER_REQUIRED' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_identity AND lower(email)=lower(p_email)) THEN RAISE EXCEPTION 'INVITED_AUTH_IDENTITY_REQUIRED';END IF;
 IF cardinality(p_roles)=0 OR EXISTS(SELECT 1 FROM unnest(p_roles) code WHERE NOT EXISTS(SELECT 1 FROM app.roles r WHERE r.code=code)) THEN RAISE EXCEPTION 'INVALID_ROLES';END IF;
 IF jsonb_typeof(p_scopes)<>'array' OR jsonb_array_length(p_scopes)=0 THEN RAISE EXCEPTION 'INVALID_SCOPES';END IF;
 result:=app.staff_edit('staff',NULL,NULL,jsonb_build_object('authUserId',p_identity,'name',p_name,'roles',to_jsonb(p_roles),'scopes',p_scopes),p_actor);
 RETURN result||jsonb_build_object('invitationState','pending_activation');
END $$;
REVOKE ALL ON FUNCTION app.guard_consent_evidence(),app.fulfil_item_versioned(uuid,text,text,integer,uuid),app.invite_staff(uuid,text,text,text[],jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app.fulfil_item_versioned(uuid,text,text,integer,uuid),app.invite_staff(uuid,text,text,text[],jsonb,uuid) TO tourism_app;

CREATE OR REPLACE FUNCTION app.create_quote(p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE p app.payment_policies; item jsonb; items jsonb:='[]'; snap jsonb; q app.quotes; d app.departures; a app.apartments; v app.service_variants; s app.services; rule app.price_rules; nightly app.apartment_rate_rules; fee app.apartment_fee_rules; n date; cin date; cout date; amount bigint; total bigint:=0; due bigint:=0; itemdue bigint; c text; currency text; qty integer; adults integer; children integer; title text; pos integer:=0; rate bigint; minimum integer; lines jsonb; kind text; terms text; privacy text; parent jsonb; photo_package app.photo_packages;
BEGIN
 IF length(coalesce(p_input->>'bindingHash',''))<32 THEN RAISE EXCEPTION 'INVALID_BINDING'; END IF;
 IF jsonb_array_length(p_input->'items') NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'INVALID_ITEMS'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app.locales WHERE code=p_input->>'locale' AND enabled) THEN RAISE EXCEPTION 'INVALID_LOCALE'; END IF;
 SELECT * INTO p FROM app.payment_policies WHERE type=p_input->>'paymentPolicy' AND approved_at IS NOT NULL ORDER BY version DESC LIMIT 1;
 IF p.id IS NULL THEN RAISE EXCEPTION 'PAYMENT_POLICY_UNAVAILABLE'; END IF;
 SELECT version INTO terms FROM app.policy_versions WHERE policy_type='terms' AND locale=p_input->>'locale' AND approved_at IS NOT NULL AND effective_at<=clock_timestamp() ORDER BY effective_at DESC LIMIT 1;
 SELECT version INTO privacy FROM app.policy_versions WHERE policy_type='privacy' AND locale=p_input->>'locale' AND approved_at IS NOT NULL AND effective_at<=clock_timestamp() ORDER BY effective_at DESC LIMIT 1;
 IF terms IS NULL OR privacy IS NULL THEN RAISE EXCEPTION 'APPROVED_POLICY_REQUIRED'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_input->'items') LOOP
  kind:=item->>'kind'; amount:=0; lines:='[]'; snap:=item; qty:=1; title:=NULL; c:=NULL;
  IF kind='stay' THEN
   SELECT * INTO a FROM app.apartments WHERE id=(item->>'apartmentId')::uuid AND status='active';
   IF a.id IS NULL THEN RAISE EXCEPTION 'SELLABLE_UNAVAILABLE'; END IF;
   cin:=(item->>'checkIn')::date; cout:=(item->>'checkOut')::date; qty:=(item->>'guests')::integer;
   IF cin IS NULL OR cout IS NULL OR cin<current_date OR cout<=cin OR cout-cin>90 OR qty NOT BETWEEN 1 AND a.max_guests THEN RAISE EXCEPTION 'INVALID_STAY'; END IF;
   IF NOT EXISTS(SELECT 1 FROM app.apartment_payment_policies WHERE apartment_id=a.id AND policy_id=p.id) THEN RAISE EXCEPTION 'INCOMPATIBLE_PAYMENT_POLICY'; END IF;
   c:=a.currency; minimum:=a.min_nights;
   FOR n IN SELECT generate_series(cin,cout-1,'1 day')::date LOOP
    SELECT * INTO nightly FROM app.apartment_rate_rules WHERE apartment_id=a.id AND date_range @> n ORDER BY priority DESC LIMIT 1;
    rate:=coalesce(nightly.amount,a.default_rate); minimum:=greatest(minimum,coalesce(nightly.min_nights,1));
    IF nightly.id IS NOT NULL AND nightly.currency<>c THEN RAISE EXCEPTION 'CURRENCY_MISMATCH'; END IF;
    amount:=amount+rate; lines:=lines||jsonb_build_array(jsonb_build_object('date',n,'amountMinor',rate::text,'rateRuleId',nightly.id));
   END LOOP;
   IF cout-cin<minimum THEN RAISE EXCEPTION 'MINIMUM_STAY'; END IF;
   FOR fee IN SELECT * FROM app.apartment_fee_rules WHERE apartment_id=a.id ORDER BY id LOOP
    IF fee.currency<>c THEN RAISE EXCEPTION 'CURRENCY_MISMATCH'; END IF;
    amount:=amount+fee.amount*CASE WHEN fee.calculation_unit='night' THEN cout-cin ELSE 1 END;
   END LOOP;
   SELECT t.title INTO title FROM app.apartment_translations t WHERE apartment_id=a.id AND locale=p_input->>'locale' AND approved_at IS NOT NULL;
   snap:=snap||jsonb_build_object('nights',lines,'cleaningBufferDays',a.cleaning_buffer_days,'minNights',minimum);
  ELSIF kind IN('tour','transfer','photography','addon') THEN
   SELECT * INTO v FROM app.service_variants WHERE id=(item->>'variantId')::uuid AND active;
   SELECT * INTO s FROM app.services WHERE id=v.service_id AND status='published';
   IF v.id IS NULL OR s.id IS NULL THEN RAISE EXCEPTION 'SELLABLE_UNAVAILABLE'; END IF;
   IF NOT EXISTS(SELECT 1 FROM app.variant_payment_policies WHERE variant_id=v.id AND policy_id=p.id) THEN RAISE EXCEPTION 'INCOMPATIBLE_PAYMENT_POLICY'; END IF;
   IF kind='tour' THEN
    SELECT * INTO d FROM app.departures WHERE id=(item->>'departureId')::uuid AND variant_id=v.id AND status='scheduled' AND cutoff_at>clock_timestamp();
    IF d.id IS NULL THEN RAISE EXCEPTION 'DEPARTURE_UNAVAILABLE'; END IF;
    adults:=coalesce((item->>'adults')::integer,0); children:=coalesce((item->>'children')::integer,0); qty:=adults+children; n:=(d.starts_at AT TIME ZONE 'Africa/Cairo')::date;
    IF adults<0 OR children<0 OR qty NOT BETWEEN 1 AND d.seat_capacity THEN RAISE EXCEPTION 'INVALID_PARTICIPANTS'; END IF;
   ELSE
    qty:=coalesce((item->>'quantity')::integer,(item->>'passengers')::integer,(item->>'participants')::integer,1); adults:=qty; children:=0;
    n:=coalesce((item->>'pickupAt')::timestamptz,(item->>'requestedStart')::timestamptz,now())::date;
    IF qty NOT BETWEEN 1 AND 100 OR n<current_date THEN RAISE EXCEPTION 'INVALID_QUANTITY'; END IF;
   END IF;
   SELECT * INTO rule FROM app.price_rules WHERE variant_id=v.id AND guest_category IN('adult','all') AND effective_range @> n ORDER BY priority DESC,(guest_category='adult') DESC LIMIT 1;
   IF rule.id IS NULL THEN RAISE EXCEPTION 'PRICE_UNAVAILABLE'; END IF;
   c:=rule.currency; amount:=rule.amount*CASE WHEN v.pricing_unit='person' THEN adults WHEN v.pricing_unit='quantity' THEN qty ELSE 1 END;
   lines:=jsonb_build_array(jsonb_build_object('category','adult','quantity',adults,'unitAmountMinor',rule.amount::text));
   IF children>0 THEN
    SELECT * INTO rule FROM app.price_rules WHERE variant_id=v.id AND guest_category IN('child','all') AND effective_range @> n ORDER BY priority DESC,(guest_category='child') DESC LIMIT 1;
    IF rule.id IS NULL OR rule.currency<>c THEN RAISE EXCEPTION 'CHILD_PRICE_UNAVAILABLE'; END IF;
    IF v.pricing_unit='person' THEN amount:=amount+rule.amount*children; END IF;
    lines:=lines||jsonb_build_array(jsonb_build_object('category','child','quantity',children,'unitAmountMinor',rule.amount::text));
   END IF;
   IF kind='addon' THEN
    IF (item->>'parentPosition')::integer IS NULL OR (item->>'parentPosition')::integer NOT BETWEEN 0 AND pos-1 THEN RAISE EXCEPTION 'ADDON_PARENT_REQUIRED'; END IF;
    parent:=p_input->'items'->(item->>'parentPosition')::integer;
    IF parent->>'kind'='addon' OR NOT EXISTS(SELECT 1 FROM app.service_addons sa JOIN app.service_variants pv ON pv.service_id=sa.parent_service_id WHERE pv.id=(parent->>'variantId')::uuid AND sa.addon_variant_id=v.id AND sa.active AND qty BETWEEN sa.min_quantity AND sa.max_quantity) THEN RAISE EXCEPTION 'INVALID_ADDON'; END IF;
   END IF;
   SELECT t.title INTO title FROM app.service_translations t WHERE service_id=s.id AND locale=p_input->>'locale' AND approved_at IS NOT NULL;
   IF NOT EXISTS(SELECT 1 FROM app.variant_translations WHERE variant_id=v.id AND locale=p_input->>'locale' AND approved_at IS NOT NULL) THEN RAISE EXCEPTION 'TRANSLATION_UNAVAILABLE';END IF;
   IF item ? 'packageId' THEN
    IF kind NOT IN('photography','addon') OR NOT EXISTS(SELECT 1 FROM app.categories WHERE id=s.category_id AND code='photography') THEN RAISE EXCEPTION 'INVALID_PHOTO_PACKAGE';END IF;
    SELECT pp.* INTO photo_package FROM app.photo_packages pp JOIN app.photo_package_translations pt ON pt.package_id=pp.id AND pt.locale=p_input->>'locale' AND pt.approved_at IS NOT NULL WHERE pp.id=(item->>'packageId')::uuid AND pp.active;
    IF photo_package.id IS NULL THEN RAISE EXCEPTION 'PACKAGE_UNAVAILABLE';END IF;
    c:=photo_package.currency;amount:=photo_package.price_amount;
    lines:=jsonb_build_array(jsonb_build_object('packageId',photo_package.id,'quantity',1,'unitAmountMinor',amount::text));
    snap:=snap||jsonb_build_object('package',app.money_json(to_jsonb(photo_package)));
   END IF;
   snap:=snap||jsonb_build_object('lines',lines,'durationMinutes',v.duration_minutes);
  ELSE RAISE EXCEPTION 'INVALID_ITEM_KIND';
  END IF;
  IF title IS NULL THEN RAISE EXCEPTION 'TRANSLATION_UNAVAILABLE'; END IF;
  IF currency IS NOT NULL AND currency<>c THEN RAISE EXCEPTION 'MIXED_CURRENCY'; END IF; currency:=c;
  IF NOT EXISTS(SELECT 1 FROM app.currencies WHERE code=c AND enabled_for_charge) THEN RAISE EXCEPTION 'CURRENCY_NOT_CHARGEABLE'; END IF;
  itemdue:=CASE p.type WHEN 'full' THEN amount WHEN 'arrival' THEN 0 ELSE least(amount,CASE p.deposit_mode WHEN 'fixed' THEN p.deposit_value ELSE (amount*p.deposit_value+9999)/10000 END) END;
  total:=total+amount; due:=due+itemdue;
  items:=items||jsonb_build_array(jsonb_build_object('position',pos,'kind',kind,'variantId',item->>'variantId','departureId',item->>'departureId','apartmentId',item->>'apartmentId','parentPosition',item->'parentPosition','title',title,'quantity',qty,'total',amount,'initialDue',itemdue,'snapshot',snap));pos:=pos+1;
 END LOOP;
 INSERT INTO app.quotes(binding_hash,locale,currency,subtotal,total,initial_due,payment_policy_id,inputs_hash,inputs,policy_snapshot,valid_until)
 VALUES(p_input->>'bindingHash',p_input->>'locale',currency,total,total,due,p.id,encode(public.digest(p_input::text,'sha256'),'hex'),p_input,to_jsonb(p)||jsonb_build_object('termsVersion',terms,'privacyNoticeVersion',privacy),clock_timestamp()+interval '20 minutes') RETURNING * INTO q;
 INSERT INTO app.quote_items(quote_id,position,kind,variant_id,departure_id,apartment_id,parent_position,title,quantity,total,initial_due,snapshot)
 SELECT q.id,(x->>'position')::integer,x->>'kind',(x->>'variantId')::uuid,(x->>'departureId')::uuid,(x->>'apartmentId')::uuid,(x->>'parentPosition')::integer,x->>'title',(x->>'quantity')::integer,(x->>'total')::bigint,(x->>'initialDue')::bigint,x->'snapshot' FROM jsonb_array_elements(items) x;
 RETURN app.money_json(to_jsonb(q)||jsonb_build_object('items',items));
END $$;
CREATE OR REPLACE FUNCTION app.staff_config_edit(p_kind text,p_id uuid,p_expected integer,p_data jsonb,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE target uuid:=coalesce(p_id,gen_random_uuid()); result jsonb; old jsonb; destination uuid; property uuid; booking uuid; item_booking uuid; relation_name text; package_snapshot jsonb; consent app.publication_consents; assignment app.photographer_assignments; owner_role boolean; download_limit integer; variants text[];
BEGIN
 PERFORM app.assert_staff(p_actor,CASE WHEN p_kind IN('properties','apartment_policy_bindings') THEN 'apartments.write' ELSE 'media.manage' END);
 relation_name:=CASE p_kind WHEN 'properties' THEN 'properties' WHEN 'photo_packages' THEN 'photo_packages' WHEN 'gallery_entitlements' THEN 'gallery_entitlements' WHEN 'publication_consents' THEN 'publication_consents' END;
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