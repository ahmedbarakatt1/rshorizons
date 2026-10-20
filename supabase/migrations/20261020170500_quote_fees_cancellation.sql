-- Approved cancellation text is immutable inside each accepted quote snapshot.
CREATE OR REPLACE FUNCTION app.cancellation_snapshot(p_policy uuid,p_locale text,p_demo boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,app AS $$
DECLARE selected app.policy_versions; canonical app.policy_versions;
BEGIN
 IF p_policy IS NULL AND p_demo THEN
  SELECT * INTO selected FROM app.policy_versions WHERE policy_type='cancellation' AND version='demo-v1' AND locale=p_locale AND approved_at IS NOT NULL AND effective_at<=now();
 ELSE
  SELECT * INTO canonical FROM app.policy_versions WHERE id=p_policy AND policy_type='cancellation' AND approved_at IS NOT NULL AND effective_at<=now();
  SELECT * INTO selected FROM app.policy_versions WHERE policy_type='cancellation' AND version=canonical.version AND locale=p_locale AND approved_at IS NOT NULL AND effective_at<=now();
 END IF;
 IF selected.id IS NULL THEN RAISE EXCEPTION 'CANCELLATION_POLICY_UNAPPROVED';END IF;
 RETURN jsonb_build_object('id',selected.id,'version',selected.version,'locale',selected.locale,'body',selected.body,'effectiveAt',selected.effective_at);
END $$;
REVOKE ALL ON FUNCTION app.cancellation_snapshot(uuid,text,boolean) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION app.create_quote(p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE p app.payment_policies; item jsonb; items jsonb:='[]'; snap jsonb; q app.quotes; d app.departures; a app.apartments; v app.service_variants; s app.services; rule app.price_rules; nightly app.apartment_rate_rules; fee app.apartment_fee_rules; n date; cin date; cout date; amount bigint; total bigint:=0; due bigint:=0; itemdue bigint; c text; currency text; qty integer; adults integer; children integer; title text; pos integer:=0; rate bigint; minimum integer; lines jsonb; kind text; terms text; privacy text; parent jsonb; photo_package app.photo_packages; service_start timestamptz; service_end timestamptz; fee_lines jsonb; fee_amount bigint; fees_total bigint:=0; cancellation jsonb;
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
  kind:=item->>'kind'; service_start:=NULL; service_end:=NULL; fee_lines:='[]'; cancellation:=NULL; amount:=0; lines:='[]'; snap:=item; qty:=1; title:=NULL; c:=NULL;
  IF kind='stay' THEN
   SELECT * INTO a FROM app.apartments WHERE id=(item->>'apartmentId')::uuid AND status='active';
   IF a.id IS NULL THEN RAISE EXCEPTION 'SELLABLE_UNAVAILABLE'; END IF;
   cancellation:=app.cancellation_snapshot(a.cancellation_policy_version_id,p_input->>'locale',a.synthetic);
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
    fee_amount:=fee.amount*CASE WHEN fee.calculation_unit='night' THEN cout-cin ELSE 1 END;
    amount:=amount+fee_amount;fees_total:=fees_total+fee_amount;
    fee_lines:=fee_lines||jsonb_build_array(jsonb_build_object('ruleId',fee.id,'kind',fee.kind,'unitAmountMinor',fee.amount::text,'amountMinor',fee_amount::text,'currency',fee.currency,'calculationUnit',fee.calculation_unit,'quantity',CASE WHEN fee.calculation_unit='night' THEN cout-cin ELSE 1 END,'refundable',fee.refundable));
   END LOOP;
   SELECT t.title INTO title FROM app.apartment_translations t WHERE apartment_id=a.id AND locale=p_input->>'locale' AND approved_at IS NOT NULL;
   snap:=snap||jsonb_build_object('nights',lines,'cleaningBufferDays',a.cleaning_buffer_days,'minNights',minimum);
  ELSIF kind IN('tour','transfer','photography','addon') THEN
   SELECT * INTO v FROM app.service_variants WHERE id=(item->>'variantId')::uuid AND active;
   SELECT * INTO s FROM app.services WHERE id=v.service_id AND status='published';
   IF v.id IS NULL OR s.id IS NULL THEN RAISE EXCEPTION 'SELLABLE_UNAVAILABLE'; END IF;
   cancellation:=app.cancellation_snapshot(s.cancellation_policy_version_id,p_input->>'locale',s.synthetic);
   IF NOT app.item_kind_matches_variant(kind,(SELECT code FROM app.categories WHERE id=s.category_id),v.capacity_model) THEN RAISE EXCEPTION 'ITEM_KIND_VARIANT_MISMATCH';END IF;
   IF NOT EXISTS(SELECT 1 FROM app.variant_payment_policies WHERE variant_id=v.id AND policy_id=p.id) THEN RAISE EXCEPTION 'INCOMPATIBLE_PAYMENT_POLICY'; END IF;
   IF kind='tour' THEN
    SELECT * INTO d FROM app.departures WHERE id=(item->>'departureId')::uuid AND variant_id=v.id AND status='scheduled' AND cutoff_at>clock_timestamp();
    IF d.id IS NULL THEN RAISE EXCEPTION 'DEPARTURE_UNAVAILABLE'; END IF;
    adults:=coalesce((item->>'adults')::integer,0); children:=coalesce((item->>'children')::integer,0); qty:=adults+children; n:=(d.starts_at AT TIME ZONE 'Africa/Cairo')::date;
    IF adults<0 OR children<0 OR qty NOT BETWEEN 1 AND d.seat_capacity THEN RAISE EXCEPTION 'INVALID_PARTICIPANTS'; END IF;
   ELSE
    qty:=coalesce((item->>'quantity')::integer,(item->>'passengers')::integer,(item->>'participants')::integer,1); adults:=qty; children:=0;
    IF kind='addon' THEN
     IF (item->>'parentPosition')::integer IS NULL OR (item->>'parentPosition')::integer NOT BETWEEN 0 AND pos-1 THEN RAISE EXCEPTION 'ADDON_PARENT_REQUIRED';END IF;
     parent:=p_input->'items'->(item->>'parentPosition')::integer;
     IF parent->>'kind'='tour' THEN
      SELECT starts_at,ends_at INTO service_start,service_end FROM app.departures WHERE id=(parent->>'departureId')::uuid AND variant_id=(parent->>'variantId')::uuid AND status='scheduled' AND cutoff_at>clock_timestamp();
      IF item ? 'departureId' AND item->>'departureId' IS DISTINCT FROM parent->>'departureId' THEN RAISE EXCEPTION 'ADDON_DEPARTURE_MISMATCH';END IF;
      item:=item||jsonb_build_object('departureId',parent->>'departureId');
     ELSE
      service_start:=coalesce((parent->>'pickupAt')::timestamptz,(parent->>'requestedStart')::timestamptz);
      SELECT service_start+make_interval(mins=>duration_minutes) INTO service_end FROM app.service_variants WHERE id=(parent->>'variantId')::uuid;
     END IF;
    ELSIF kind='transfer' AND v.capacity_model IN('shared','departure') THEN
     IF nullif(item->>'departureId','') IS NULL THEN RAISE EXCEPTION 'SHARED_DEPARTURE_REQUIRED';END IF;
     SELECT * INTO d FROM app.departures WHERE id=(item->>'departureId')::uuid AND variant_id=v.id AND status='scheduled' AND cutoff_at>clock_timestamp();
     IF d.id IS NULL OR qty>d.seat_capacity THEN RAISE EXCEPTION 'DEPARTURE_UNAVAILABLE';END IF;
     IF date_trunc('milliseconds',(item->>'pickupAt')::timestamptz) IS DISTINCT FROM date_trunc('milliseconds',d.starts_at) THEN RAISE EXCEPTION 'SHARED_PICKUP_TIME_MISMATCH';END IF;
     service_start:=d.starts_at;service_end:=d.ends_at;
    ELSE
     IF kind='transfer' AND nullif(item->>'departureId','') IS NOT NULL THEN RAISE EXCEPTION 'EXCLUSIVE_DEPARTURE_FORBIDDEN';END IF;
     service_start:=CASE kind WHEN 'transfer' THEN (item->>'pickupAt')::timestamptz ELSE (item->>'requestedStart')::timestamptz END;
     service_end:=service_start+make_interval(mins=>v.duration_minutes);
    END IF;
    IF service_start IS NULL OR service_start<=clock_timestamp()+make_interval(mins=>s.cutoff_minutes) THEN RAISE EXCEPTION 'START_UNAVAILABLE';END IF;
    n:=(service_start AT TIME ZONE 'Africa/Cairo')::date;
    snap:=snap||jsonb_build_object('serviceStartsAt',service_start,'serviceEndsAt',service_end);
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
  snap:=snap||jsonb_build_object('fees',fee_lines,'cancellationPolicy',cancellation);
  IF currency IS NOT NULL AND currency<>c THEN RAISE EXCEPTION 'MIXED_CURRENCY'; END IF; currency:=c;
  IF NOT EXISTS(SELECT 1 FROM app.currencies WHERE code=c AND enabled_for_charge) THEN RAISE EXCEPTION 'CURRENCY_NOT_CHARGEABLE'; END IF;
  itemdue:=CASE p.type WHEN 'full' THEN amount WHEN 'arrival' THEN 0 ELSE least(amount,CASE p.deposit_mode WHEN 'fixed' THEN p.deposit_value ELSE (amount*p.deposit_value+9999)/10000 END) END;
  total:=total+amount; due:=due+itemdue;
  items:=items||jsonb_build_array(jsonb_build_object('position',pos,'kind',kind,'variantId',item->>'variantId','departureId',item->>'departureId','apartmentId',item->>'apartmentId','parentPosition',item->'parentPosition','title',title,'quantity',qty,'total',amount,'initialDue',itemdue,'snapshot',snap));pos:=pos+1;
 END LOOP;
 INSERT INTO app.quotes(binding_hash,locale,currency,subtotal,fees,total,initial_due,payment_policy_id,inputs_hash,inputs,policy_snapshot,valid_until)
 VALUES(p_input->>'bindingHash',p_input->>'locale',currency,total-fees_total,fees_total,total,due,p.id,encode(public.digest(p_input::text,'sha256'),'hex'),p_input,to_jsonb(p)||jsonb_build_object('termsVersion',terms,'privacyNoticeVersion',privacy),clock_timestamp()+interval '20 minutes') RETURNING * INTO q;
 INSERT INTO app.quote_items(quote_id,position,kind,variant_id,departure_id,apartment_id,parent_position,title,quantity,total,initial_due,snapshot)
 SELECT q.id,(x->>'position')::integer,x->>'kind',(x->>'variantId')::uuid,(x->>'departureId')::uuid,(x->>'apartmentId')::uuid,(x->>'parentPosition')::integer,x->>'title',(x->>'quantity')::integer,(x->>'total')::bigint,(x->>'initialDue')::bigint,x->'snapshot' FROM jsonb_array_elements(items) x;
 RETURN app.money_json(to_jsonb(q)||jsonb_build_object('items',items));
END $$;
