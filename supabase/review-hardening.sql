-- A client-selected discriminant cannot change a sellable's inventory model.
CREATE OR REPLACE FUNCTION app.item_kind_matches_variant(p_kind text,p_category text,p_capacity text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,app AS $$
 SELECT CASE
  WHEN p_kind='tour' THEN p_capacity='departure' AND p_category IN('tours','boat_tours','scuba_diving','shore_dives','snorkeling','desert_safari','beach_buggy')
  WHEN p_kind='transfer' THEN p_category='transportation' AND p_capacity IN('exclusive','shared','departure')
  WHEN p_kind='photography' THEN p_category='photography' AND p_capacity IN('exclusive','shared')
  WHEN p_kind='addon' THEN p_category='photography' AND p_capacity IN('exclusive','shared','none')
  ELSE false END;
$$;
REVOKE ALL ON FUNCTION app.item_kind_matches_variant(text,text,text) FROM PUBLIC,anon,authenticated;


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
DECLARE p app.payment_policies; item jsonb; items jsonb:='[]'; snap jsonb; q app.quotes; d app.departures; a app.apartments; v app.service_variants; s app.services; rule app.price_rules; nightly app.apartment_rate_rules; fee app.apartment_fee_rules; n date; cin date; cout date; amount bigint; total bigint:=0; due bigint:=0; itemdue bigint; c text; currency text; qty integer; adults integer; children integer; title text; pos integer:=0; rate bigint; minimum integer; lines jsonb; kind text; terms text; privacy text; parent jsonb; photo_package app.photo_packages; service_start timestamptz; service_end timestamptz; fee_lines jsonb; fee_amount bigint; fees_total bigint:=0; cancellation jsonb; pickup_record record;
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
   IF kind='tour' AND nullif(item->>'pickupId','') IS NOT NULL THEN
    SELECT pl.id,pl.name,pl.address,vp.surcharge,vp.currency,vp.offset_minutes INTO pickup_record
    FROM app.variant_pickups vp JOIN app.pickup_locations pl ON pl.id=vp.pickup_id
    WHERE vp.variant_id=v.id AND pl.id=(item->>'pickupId')::uuid AND pl.active AND pl.destination_id=s.destination_id;
    IF pickup_record.id IS NULL THEN RAISE EXCEPTION 'PICKUP_UNAVAILABLE';END IF;
    IF pickup_record.currency<>c THEN RAISE EXCEPTION 'CURRENCY_MISMATCH';END IF;
    amount:=amount+pickup_record.surcharge;fees_total:=fees_total+pickup_record.surcharge;
    fee_lines:=fee_lines||jsonb_build_array(jsonb_build_object('kind','pickup','amountMinor',pickup_record.surcharge::text,'unitAmountMinor',pickup_record.surcharge::text,'quantity',1,'calculationUnit','booking','currency',c,'refundable',false));
    snap:=snap||jsonb_build_object('pickup',jsonb_build_object('id',pickup_record.id,'name',pickup_record.name,'address',pickup_record.address,'surchargeAmountMinor',pickup_record.surcharge::text,'currency',c,'offsetMinutes',pickup_record.offset_minutes,'estimatedPickupAt',d.starts_at+make_interval(mins=>pickup_record.offset_minutes)));
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

CREATE OR REPLACE FUNCTION app.allocate_booking(p_booking uuid,p_actor uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
DECLARE b app.bookings; item record; d app.departures; a app.apartments; used integer; exp timestamptz; st text; service_start timestamptz; service_end timestamptz; required_seats integer; required_luggage integer;
BEGIN
 SELECT * INTO STRICT b FROM app.bookings WHERE id=p_booking;
 IF EXISTS(SELECT 1 FROM app.booking_items i JOIN app.quote_items qi ON qi.id=i.quote_item_id
 JOIN app.service_variants v ON v.id=qi.variant_id JOIN app.services s ON s.id=v.service_id JOIN app.categories c ON c.id=s.category_id
 WHERE i.booking_id=b.id AND i.superseded_at IS NULL AND NOT app.item_kind_matches_variant(i.kind,c.code,v.capacity_model)) THEN
 RAISE EXCEPTION 'ITEM_KIND_VARIANT_MISMATCH';END IF;
 exp:=b.payment_deadline; st:=CASE WHEN b.initial_due_amount=0 THEN 'confirmed' ELSE 'held' END;
 -- Cross-type lock order is departures, units, resources; UUID order within each.
 PERFORM dep.id FROM app.departures dep WHERE dep.id IN(SELECT qi.departure_id FROM app.quote_items qi JOIN app.booking_items i ON i.quote_item_id=qi.id WHERE i.booking_id=b.id AND i.superseded_at IS NULL AND i.kind IN('tour','transfer') AND qi.departure_id IS NOT NULL) ORDER BY dep.id FOR UPDATE;
 PERFORM unit.id FROM app.apartments unit WHERE unit.id IN(SELECT stay.apartment_id FROM app.apartment_stays stay JOIN app.booking_items i ON i.id=stay.booking_item_id WHERE i.booking_id=b.id AND i.superseded_at IS NULL) ORDER BY unit.id FOR UPDATE;
 FOR item IN SELECT i.id,qi.departure_id,i.quantity seats FROM app.booking_items i JOIN app.quote_items qi ON qi.id=i.quote_item_id WHERE i.booking_id=b.id AND i.superseded_at IS NULL AND i.kind IN('tour','transfer') AND qi.departure_id IS NOT NULL ORDER BY qi.departure_id,i.id LOOP
  SELECT * INTO STRICT d FROM app.departures WHERE id=item.departure_id;
  IF d.status<>'scheduled' OR d.cutoff_at<=clock_timestamp() THEN RAISE EXCEPTION 'DEPARTURE_UNAVAILABLE'; END IF;
  SELECT coalesce(sum(seats),0) INTO used FROM app.capacity_allocations WHERE departure_id=d.id AND state<>'released';
  IF used+item.seats>d.seat_capacity THEN RAISE EXCEPTION 'INVENTORY_CONFLICT'; END IF;
  INSERT INTO app.capacity_allocations(booking_item_id,departure_id,seats,state,expires_at) VALUES(item.id,d.id,item.seats,st,exp);
 END LOOP;
 FOR item IN SELECT s.* FROM app.apartment_stays s JOIN app.booking_items i ON i.id=s.booking_item_id WHERE i.booking_id=b.id AND i.superseded_at IS NULL ORDER BY s.apartment_id,s.id LOOP
  SELECT * INTO STRICT a FROM app.apartments WHERE id=item.apartment_id;
  IF a.status<>'active' OR item.occupants>a.max_guests OR item.check_out-item.check_in<a.min_nights OR item.check_in<current_date THEN RAISE EXCEPTION 'INVALID_STAY'; END IF;
  INSERT INTO app.apartment_inventory(apartment_id,date_range,kind,stay_id,expires_at,actor_id) VALUES(a.id,daterange(item.check_in,item.check_out+a.cleaning_buffer_days,'[)'),'stay',item.id,exp,p_actor);
  UPDATE app.apartment_stays SET state=st WHERE id=item.id;
 END LOOP;
 -- Assignments must cover this exact service and consume physical capacity.
 -- A departure photographer can serve all attached add-ons without reserving the
 -- same exclusive resource again for each guest on that departure.
 PERFORM r.id FROM app.resources r WHERE r.id IN(
  SELECT ro.resource_id FROM app.resource_occupancy ro JOIN app.booking_items i ON i.id=ro.booking_item_id WHERE i.booking_id=b.id AND i.superseded_at IS NULL AND ro.released_at IS NULL
  UNION SELECT ro.resource_id FROM app.resource_occupancy ro JOIN app.quote_items qi ON qi.departure_id=ro.departure_id JOIN app.booking_items i ON i.quote_item_id=qi.id WHERE i.booking_id=b.id AND i.superseded_at IS NULL AND ro.released_at IS NULL
 ) ORDER BY r.id FOR UPDATE;
 FOR item IN SELECT i.id,i.kind,i.quantity,qi.snapshot,qi.departure_id,v.capacity_model,s.cutoff_minutes,v.duration_minutes
 FROM app.booking_items i JOIN app.quote_items qi ON qi.id=i.quote_item_id JOIN app.service_variants v ON v.id=qi.variant_id JOIN app.services s ON s.id=v.service_id
 WHERE i.booking_id=b.id AND i.superseded_at IS NULL AND (i.kind IN('transfer','photography') OR(i.kind='addon' AND v.capacity_model<>'none')) ORDER BY i.id LOOP
  service_start:=coalesce((item.snapshot->>'serviceStartsAt')::timestamptz,(item.snapshot->>'pickupAt')::timestamptz,(item.snapshot->>'requestedStart')::timestamptz);
  service_end:=coalesce((item.snapshot->>'serviceEndsAt')::timestamptz,service_start+make_interval(mins=>item.duration_minutes));
  IF item.kind IN('addon','transfer') AND item.departure_id IS NOT NULL THEN SELECT starts_at,ends_at INTO service_start,service_end FROM app.departures WHERE id=item.departure_id;END IF;
  IF item.kind='transfer' THEN
   required_seats:=(item.snapshot->>'passengers')::int;required_luggage:=coalesce((item.snapshot->>'luggage')::int,0);
   IF item.departure_id IS NOT NULL THEN
    SELECT seat_capacity INTO required_seats FROM app.departures WHERE id=item.departure_id;
    SELECT coalesce(sum(t.luggage),0)::int INTO required_luggage FROM app.transfer_booking_items t JOIN app.capacity_allocations ca ON ca.booking_item_id=t.booking_item_id WHERE ca.departure_id=item.departure_id AND ca.state<>'released';
   END IF;
  END IF;
  IF service_start IS NULL OR service_start<=clock_timestamp()+make_interval(mins=>item.cutoff_minutes) THEN RAISE EXCEPTION 'START_UNAVAILABLE';END IF;
  IF NOT EXISTS(SELECT 1 FROM app.resource_occupancy ro JOIN app.resources r ON r.id=ro.resource_id LEFT JOIN app.resource_details rd ON rd.resource_id=r.id
   WHERE ((item.departure_id IS NULL AND ro.booking_item_id=item.id) OR(item.kind IN('addon','transfer') AND item.departure_id IS NOT NULL AND ro.departure_id=item.departure_id))
   AND ro.released_at IS NULL AND r.active AND ro.time_range @> tstzrange(service_start,service_end,'[)')
   AND r.kind=CASE WHEN item.kind='transfer' THEN 'vehicle' ELSE 'photographer' END
   AND (r.mode='exclusive' OR ro.quantity>=CASE WHEN item.kind='transfer' AND item.departure_id IS NOT NULL THEN required_seats ELSE item.quantity END)
   AND (item.kind<>'transfer' OR(coalesce((rd.metadata->>'seats')::int,0)>=required_seats AND coalesce((rd.metadata->>'luggage')::int,0)>=required_luggage))
  ) THEN RAISE EXCEPTION 'RESOURCE_ASSIGNMENT_REQUIRED';END IF;
  IF item.kind='transfer' AND NOT EXISTS(SELECT 1 FROM app.resource_occupancy ro JOIN app.resources r ON r.id=ro.resource_id
   WHERE r.kind='driver' AND r.mode='exclusive' AND r.active AND ro.released_at IS NULL
   AND ((item.departure_id IS NULL AND ro.booking_item_id=item.id) OR(item.departure_id IS NOT NULL AND ro.departure_id=item.departure_id))
   AND ro.time_range @> tstzrange(service_start,service_end,'[)')) THEN RAISE EXCEPTION 'DRIVER_ASSIGNMENT_REQUIRED';END IF;
 END LOOP;
EXCEPTION WHEN exclusion_violation THEN RAISE EXCEPTION 'INVENTORY_CONFLICT';
END $$;

CREATE OR REPLACE FUNCTION app.confirm_if_paid(p_booking uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
DECLARE b app.bookings; paid bigint;
BEGIN
 SELECT * INTO STRICT b FROM app.bookings WHERE id=p_booking FOR UPDATE;
 SELECT coalesce(sum(amount),0) INTO paid FROM app.cash_ledger WHERE booking_id=b.id AND currency=b.currency;
 IF b.status='approved_pending_payment' AND b.approved_at IS NOT NULL AND b.payment_deadline>clock_timestamp() AND paid>=b.initial_due_amount
 AND NOT EXISTS(SELECT 1 FROM app.booking_items i WHERE i.booking_id=b.id AND i.superseded_at IS NULL AND
   (((i.kind='tour' OR(i.kind='transfer' AND EXISTS(SELECT 1 FROM app.quote_items qi WHERE qi.id=i.quote_item_id AND qi.departure_id IS NOT NULL))) AND NOT EXISTS(SELECT 1 FROM app.capacity_allocations c WHERE c.booking_item_id=i.id AND c.state IN('held','confirmed')))
   OR (i.kind='stay' AND NOT EXISTS(SELECT 1 FROM app.apartment_stays s JOIN app.apartment_inventory ai ON ai.stay_id=s.id WHERE s.booking_item_id=i.id AND ai.released_at IS NULL)))) THEN
  UPDATE app.bookings SET status='confirmed',version=version+1,updated_at=clock_timestamp() WHERE id=b.id;
  UPDATE app.capacity_allocations SET state='confirmed',expires_at=NULL WHERE state='held' AND booking_item_id IN(SELECT id FROM app.booking_items WHERE booking_id=b.id AND superseded_at IS NULL);
  UPDATE app.apartment_inventory SET expires_at=NULL WHERE released_at IS NULL AND stay_id IN(SELECT s.id FROM app.apartment_stays s JOIN app.booking_items i ON i.id=s.booking_item_id WHERE i.booking_id=b.id AND i.superseded_at IS NULL);
  UPDATE app.apartment_stays SET state='confirmed' WHERE state='held' AND booking_item_id IN(SELECT id FROM app.booking_items WHERE booking_id=b.id AND superseded_at IS NULL);
  UPDATE app.payment_obligations SET status='paid' WHERE booking_id=b.id AND kind='initial' AND status='open';
  PERFORM app.emit_booking_event(b.id,'booking_confirmed');
 END IF;
END $$;

CREATE OR REPLACE FUNCTION app.request_refund(p_booking uuid,p_transaction uuid,p_offline uuid,p_amount bigint,p_reason text,p_policy jsonb,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE b app.bookings; r app.refund_requests; captured bigint; reserved bigint; bound_policy jsonb; item_policies jsonb;
BEGIN
 PERFORM app.assert_staff(p_actor,'refunds.request',p_booking);
 SELECT * INTO b FROM app.bookings WHERE id=p_booking FOR UPDATE;
 IF p_amount<=0 OR num_nonnulls(p_transaction,p_offline)<>1 OR length(trim(p_reason))<3 THEN RAISE EXCEPTION 'INVALID_REFUND'; END IF;
 SELECT coalesce(sum(amount),0) INTO captured FROM app.cash_ledger WHERE booking_id=b.id AND (transaction_id=p_transaction OR offline_receipt_id=p_offline);
 SELECT coalesce(sum(amount),0) INTO reserved FROM app.refund_requests WHERE booking_id=b.id AND status IN('requested','approved','processing') AND (original_transaction_id=p_transaction OR original_offline_receipt_id=p_offline);
 IF p_amount>captured-reserved THEN RAISE EXCEPTION 'REFUND_EXCEEDS_RECEIPT'; END IF;
 -- The textual policy requires an authorized manual decision; client JSON cannot
 -- invent an automatic entitlement or replace the policy the guest accepted.
 SELECT coalesce(jsonb_agg(jsonb_build_object('bookingItemId',bi.id,'quoteItemId',qi.id,'cancellationPolicy',qi.snapshot->'cancellationPolicy','fees',coalesce(qi.snapshot->'fees','[]')) ORDER BY qi.position),'[]')
 INTO item_policies FROM app.booking_items bi JOIN app.quote_items qi ON qi.id=bi.quote_item_id WHERE bi.booking_id=b.id AND bi.superseded_at IS NULL;
 bound_policy:=jsonb_build_object('manual',true,'calculationMode','authorized_manual_review','acceptedQuoteId',b.accepted_quote_id,
 'acceptedPolicySnapshot',b.policy_snapshot,'acceptedItemPolicies',item_policies,'requestedAmountMinor',p_amount::text,
 'sourceReceiptId',coalesce(p_transaction,p_offline),'sourceKind',CASE WHEN p_transaction IS NOT NULL THEN 'online_transaction' ELSE 'offline_receipt' END,
 'availableAmountMinor',(captured-reserved)::text,'currency',b.currency,'operatorRationale',p_reason,'requestedBy',p_actor);
 INSERT INTO app.refund_requests(booking_id,original_transaction_id,original_offline_receipt_id,amount,currency,reason,policy_calculation,requested_by) VALUES(b.id,p_transaction,p_offline,p_amount,b.currency,p_reason,bound_policy,p_actor) RETURNING * INTO r;
 RETURN app.money_json(to_jsonb(r));
END $$;
