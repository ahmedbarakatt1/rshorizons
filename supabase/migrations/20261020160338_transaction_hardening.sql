-- Runtime cannot mutate inventory or finance tables directly. These narrow routines
-- execute in the private app schema with a fixed search path and explicit checks.
CREATE OR REPLACE FUNCTION app.money_json(p_value jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,app AS $$
DECLARE result jsonb; k text; v jsonb;
BEGIN
 IF jsonb_typeof(p_value)='array' THEN SELECT coalesce(jsonb_agg(app.money_json(value)),'[]') INTO result FROM jsonb_array_elements(p_value);RETURN result;
 ELSIF jsonb_typeof(p_value)='object' THEN
  result:='{}';FOR k,v IN SELECT * FROM jsonb_each(p_value) LOOP
   IF k IN('amount','total','subtotal','fees','taxes','discount','initial_due','initialDue','total_amount','initial_due_amount','deposit_value','expected_amount','default_rate','surcharge','limit_amount') AND jsonb_typeof(v)='number' THEN result:=result||jsonb_build_object(k,v#>>'{}');
   ELSE result:=result||jsonb_build_object(k,app.money_json(v)); END IF;
  END LOOP;RETURN result;
 END IF;RETURN p_value;
END $$;
CREATE OR REPLACE FUNCTION app.emit_booking_event(p_booking uuid,p_event text,p_actor uuid DEFAULT NULL,p_metadata jsonb DEFAULT '{}') RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
DECLARE b app.bookings; e uuid;
BEGIN
 SELECT * INTO STRICT b FROM app.bookings WHERE id=p_booking;
 INSERT INTO app.booking_events(booking_id,version,event_type,actor_id,metadata) VALUES(b.id,b.version,p_event,p_actor,p_metadata) ON CONFLICT DO NOTHING;
 INSERT INTO app.outbox_events(aggregate_type,aggregate_id,aggregate_version,event_type,event_key,payload) VALUES('booking',b.id,b.version,p_event,b.id||':'||b.version||':'||p_event,jsonb_build_object('bookingId',b.id,'status',b.status)) ON CONFLICT DO NOTHING RETURNING id INTO e;
 IF e IS NOT NULL THEN INSERT INTO app.jobs(event_id,kind,job_key) VALUES(e,'notification',e||':notification'); END IF;
 INSERT INTO app.audit_events(actor_type,actor_id,action,target_type,target_id,summary) VALUES(CASE WHEN p_actor IS NULL THEN 'system' ELSE 'staff' END,p_actor,p_event,'booking',b.id,p_metadata);
END $$;
CREATE OR REPLACE FUNCTION app.has_permission(p_actor uuid,p_permission text) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,app AS $$
 SELECT EXISTS(SELECT 1 FROM app.staff_profiles s WHERE s.id=p_actor AND s.active AND s.revoked_at IS NULL AND
 (EXISTS(SELECT 1 FROM app.staff_roles sr JOIN app.role_permissions rp ON rp.role_id=sr.role_id JOIN app.permissions p ON p.id=rp.permission_id WHERE sr.staff_id=s.id AND p.code=p_permission)
 OR EXISTS(SELECT 1 FROM app.staff_permission_grants g JOIN app.permissions p ON p.id=g.permission_id WHERE g.staff_id=s.id AND p.code=p_permission)));
$$;
CREATE OR REPLACE FUNCTION app.scope_allows(p_actor uuid,p_destination uuid,p_property uuid DEFAULT NULL) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,app AS $$
 SELECT EXISTS(SELECT 1 FROM app.staff_scopes WHERE staff_id=p_actor AND (scope_type='all' OR(scope_type='destination' AND destination_id=p_destination) OR(scope_type='property' AND property_id=p_property)));
$$;
CREATE OR REPLACE FUNCTION app.assert_staff(p_actor uuid,p_permission text,p_booking uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
BEGIN
 IF NOT app.has_permission(p_actor,p_permission) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_booking IS NOT NULL AND EXISTS(
  SELECT 1 FROM app.booking_items bi JOIN app.quote_items qi ON qi.id=bi.quote_item_id
  LEFT JOIN app.service_variants v ON v.id=qi.variant_id LEFT JOIN app.services s ON s.id=v.service_id
  LEFT JOIN app.apartments a ON a.id=qi.apartment_id LEFT JOIN app.properties p ON p.id=a.property_id
  WHERE bi.booking_id=p_booking AND NOT app.scope_allows(p_actor,coalesce(s.destination_id,p.destination_id),p.id)
 ) THEN RAISE EXCEPTION 'SCOPE_FORBIDDEN' USING ERRCODE='42501'; END IF;
END $$;

CREATE OR REPLACE FUNCTION app.create_quote(p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE p app.payment_policies; item jsonb; items jsonb:='[]'; snap jsonb; q app.quotes; d app.departures; a app.apartments; v app.service_variants; s app.services; rule app.price_rules; nightly app.apartment_rate_rules; fee app.apartment_fee_rules; n date; cin date; cout date; amount bigint; total bigint:=0; due bigint:=0; itemdue bigint; c text; currency text; qty integer; adults integer; children integer; title text; pos integer:=0; rate bigint; minimum integer; lines jsonb; kind text; terms text; privacy text; parent jsonb;
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

CREATE OR REPLACE FUNCTION app.copy_quote_items(p_booking uuid,p_quote uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
DECLARE qi app.quote_items; bi uuid; stay uuid; x jsonb; parent uuid;
BEGIN
 FOR qi IN SELECT * FROM app.quote_items WHERE quote_id=p_quote ORDER BY position LOOP
  INSERT INTO app.booking_items(booking_id,quote_item_id,kind,title_snapshot,quantity,total_amount) VALUES(p_booking,qi.id,qi.kind,qi.title,qi.quantity,qi.total) RETURNING id INTO bi;
  x:=qi.snapshot;
  CASE qi.kind
   WHEN 'tour' THEN INSERT INTO app.tour_booking_items(booking_item_id,departure_id,adults,children,pickup_snapshot) VALUES(bi,qi.departure_id,coalesce((x->>'adults')::int,0),coalesce((x->>'children')::int,0),coalesce(x->'pickup','{}'));
   WHEN 'stay' THEN
    INSERT INTO app.apartment_stays(booking_item_id,apartment_id,check_in,check_out,occupants) VALUES(bi,qi.apartment_id,(x->>'checkIn')::date,(x->>'checkOut')::date,(x->>'guests')::int) RETURNING id INTO stay;
    INSERT INTO app.stay_nightly_prices(stay_id,night_date,amount,currency,rate_rule_snapshot) SELECT stay,(y->>'date')::date,(y->>'amountMinor')::bigint,q.currency,y FROM jsonb_array_elements(x->'nights') y,app.quotes q WHERE q.id=p_quote;
   WHEN 'transfer' THEN INSERT INTO app.transfer_booking_items(booking_item_id,variant_id,pickup,dropoff,pickup_at,flight_number,passengers,luggage) VALUES(bi,qi.variant_id,x->>'pickup',x->>'dropoff',(x->>'pickupAt')::timestamptz,x->>'flightNumber',(x->>'passengers')::int,coalesce((x->>'luggage')::int,0));
   WHEN 'photography' THEN INSERT INTO app.photography_booking_items(booking_item_id,variant_id,package_id,departure_id,session_at,delivery_terms_snapshot) VALUES(bi,qi.variant_id,(x->>'packageId')::uuid,qi.departure_id,(x->>'requestedStart')::timestamptz,x);
   WHEN 'addon' THEN
    SELECT i.id INTO parent FROM app.booking_items i JOIN app.quote_items z ON z.id=i.quote_item_id WHERE i.booking_id=p_booking AND z.position=qi.parent_position;
    IF parent IS NULL THEN RAISE EXCEPTION 'ADDON_PARENT_REQUIRED'; END IF;
    UPDATE app.booking_items SET parent_item_id=parent WHERE id=bi;
    INSERT INTO app.addon_booking_items(booking_item_id,addon_variant_id,parent_booking_item_id,quantity,entitlement_snapshot) VALUES(bi,qi.variant_id,parent,qi.quantity,x);
  END CASE;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION app.submit_booking(p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE q app.quotes; b app.bookings; g uuid; idem app.idempotency_records; hash text; x jsonb; expected integer;
BEGIN
 IF coalesce((p_input#>>'{consents,termsAccepted}')::boolean,false) IS NOT TRUE OR nullif(p_input#>>'{consents,termsVersion}','') IS NULL OR nullif(p_input#>>'{consents,privacyNoticeVersion}','') IS NULL THEN RAISE EXCEPTION 'POLICY_ACCEPTANCE_REQUIRED'; END IF;
 IF length(coalesce(p_input->>'idempotencyKey',''))<8 THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED'; END IF;
 hash:=encode(public.digest((p_input-'idempotencyKey'-'requestHash')::text,'sha256'),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended((p_input->>'bindingHash')||':'||(p_input->>'idempotencyKey'),0));
 SELECT * INTO idem FROM app.idempotency_records WHERE caller_scope=p_input->>'bindingHash' AND operation='submit_booking' AND key_hash=encode(public.digest(p_input->>'idempotencyKey','sha256'),'hex');
 IF idem.id IS NOT NULL THEN
  IF idem.request_hash<>hash THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
  SELECT * INTO STRICT b FROM app.bookings WHERE id=idem.response_reference;RETURN app.money_json(to_jsonb(b));
 END IF;
 SELECT * INTO q FROM app.quotes WHERE id=(p_input->>'quoteId')::uuid FOR SHARE;
 IF q.id IS NULL OR q.binding_hash<>p_input->>'bindingHash' THEN RAISE EXCEPTION 'QUOTE_NOT_FOUND'; END IF;
 IF q.policy_snapshot->>'termsVersion' IS DISTINCT FROM p_input#>>'{consents,termsVersion}' OR q.policy_snapshot->>'privacyNoticeVersion' IS DISTINCT FROM p_input#>>'{consents,privacyNoticeVersion}' THEN RAISE EXCEPTION 'POLICY_VERSION_MISMATCH'; END IF;
 IF q.valid_until<=clock_timestamp() THEN RAISE EXCEPTION 'QUOTE_EXPIRED'; END IF;
 IF EXISTS(SELECT 1 FROM app.bookings WHERE accepted_quote_id=q.id) THEN RAISE EXCEPTION 'QUOTE_ALREADY_ACCEPTED'; END IF;
 SELECT max(quantity) INTO expected FROM app.quote_items WHERE quote_id=q.id AND kind IN('tour','stay','transfer','photography');
 IF coalesce(jsonb_array_length(p_input->'participants'),0)<coalesce(expected,1) THEN RAISE EXCEPTION 'PARTICIPANTS_REQUIRED'; END IF;
 INSERT INTO app.guests(full_name,email,phone_e164,locale) VALUES(p_input#>>'{guest,fullName}',nullif(p_input#>>'{guest,email}',''),nullif(p_input#>>'{guest,phoneE164}',''),q.locale) RETURNING id INTO g;
 INSERT INTO app.bookings(reference,primary_guest_id,accepted_quote_id,currency,total_amount,initial_due_amount,price_snapshot,policy_snapshot)
 VALUES('TR-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),g,q.id,q.currency,q.total,q.initial_due,to_jsonb(q),q.policy_snapshot) RETURNING * INTO b;
 PERFORM app.copy_quote_items(b.id,q.id);
 FOR x IN SELECT value FROM jsonb_array_elements(p_input->'participants') LOOP
  INSERT INTO app.booking_participants(booking_id,display_name,age_category) VALUES(b.id,x->>'displayName',x->>'ageCategory');
 END LOOP;
 INSERT INTO app.guest_consents(guest_id,type,granted,policy_version,collection_source) VALUES(g,'terms',true,p_input#>>'{consents,termsVersion}','booking'),(g,'privacy',true,p_input#>>'{consents,privacyNoticeVersion}','booking'),(g,'whatsapp_booking',coalesce((p_input#>>'{consents,whatsappBookingUpdates}')::boolean,false),p_input#>>'{consents,privacyNoticeVersion}','booking'),(g,'marketing',coalesce((p_input#>>'{consents,marketing}')::boolean,false),p_input#>>'{consents,privacyNoticeVersion}','booking'),(g,'public_media',coalesce((p_input#>>'{consents,publicMediaUse}')::boolean,false),p_input#>>'{consents,privacyNoticeVersion}','booking');
 INSERT INTO app.idempotency_records(caller_scope,operation,key_hash,request_hash,state,response_reference,expires_at) VALUES(q.binding_hash,'submit_booking',encode(public.digest(p_input->>'idempotencyKey','sha256'),'hex'),hash,'complete',b.id,now()+interval '7 days');
 PERFORM app.emit_booking_event(b.id,'request_received');
 RETURN app.money_json(to_jsonb(b));
END $$;

CREATE OR REPLACE FUNCTION app.allocate_booking(p_booking uuid,p_actor uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
DECLARE b app.bookings; item record; d app.departures; a app.apartments; used integer; exp timestamptz; st text;
BEGIN
 SELECT * INTO STRICT b FROM app.bookings WHERE id=p_booking;
 exp:=b.payment_deadline; st:=CASE WHEN b.initial_due_amount=0 THEN 'confirmed' ELSE 'held' END;
 -- Cross-type lock order is departures, units, resources; UUID order within each.
 PERFORM dep.id FROM app.departures dep WHERE dep.id IN(SELECT t.departure_id FROM app.tour_booking_items t JOIN app.booking_items i ON i.id=t.booking_item_id WHERE i.booking_id=b.id AND i.superseded_at IS NULL) ORDER BY dep.id FOR UPDATE;
 PERFORM unit.id FROM app.apartments unit WHERE unit.id IN(SELECT stay.apartment_id FROM app.apartment_stays stay JOIN app.booking_items i ON i.id=stay.booking_item_id WHERE i.booking_id=b.id AND i.superseded_at IS NULL) ORDER BY unit.id FOR UPDATE;
 FOR item IN SELECT i.id,t.departure_id,t.adults+t.children seats FROM app.booking_items i JOIN app.tour_booking_items t ON t.booking_item_id=i.id WHERE i.booking_id=b.id AND i.superseded_at IS NULL ORDER BY t.departure_id,i.id LOOP
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
 -- Exclusive services require an operational assignment before approval.
 IF EXISTS(SELECT 1 FROM app.booking_items i JOIN app.quote_items qi ON qi.id=i.quote_item_id JOIN app.service_variants v ON v.id=qi.variant_id WHERE i.booking_id=b.id AND i.superseded_at IS NULL AND i.kind IN('transfer','photography') AND v.capacity_model='exclusive' AND NOT EXISTS(SELECT 1 FROM app.resource_occupancy ro WHERE ro.booking_item_id=i.id AND ro.released_at IS NULL)) THEN RAISE EXCEPTION 'RESOURCE_ASSIGNMENT_REQUIRED'; END IF;
EXCEPTION WHEN exclusion_violation THEN RAISE EXCEPTION 'INVENTORY_CONFLICT';
END $$;
CREATE OR REPLACE FUNCTION app.approve_booking(p_booking uuid,p_expected integer,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE b app.bookings; hold integer;
BEGIN
 PERFORM app.assert_staff(p_actor,'bookings.approve',p_booking);
 SELECT * INTO b FROM app.bookings WHERE id=p_booking FOR UPDATE;
 IF b.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF b.version<>p_expected THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
 IF b.status<>'pending_review' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 hold:=coalesce((b.policy_snapshot->>'hold_minutes')::integer,60);
 UPDATE app.bookings SET approved_by=p_actor,approved_at=clock_timestamp(),payment_deadline=CASE WHEN initial_due_amount>0 THEN clock_timestamp()+make_interval(mins=>hold) END WHERE id=b.id;
 PERFORM app.allocate_booking(b.id,p_actor);
 UPDATE app.bookings SET status=CASE WHEN initial_due_amount>0 THEN 'approved_pending_payment' ELSE 'confirmed' END,version=version+1,updated_at=clock_timestamp() WHERE id=b.id RETURNING * INTO b;
 INSERT INTO app.payment_obligations(booking_id,kind,amount,currency,due_at,status,version) VALUES(b.id,'initial',b.initial_due_amount,b.currency,b.payment_deadline,CASE WHEN b.initial_due_amount=0 THEN 'paid' ELSE 'open' END,b.version);
 IF b.total_amount>b.initial_due_amount THEN INSERT INTO app.payment_obligations(booking_id,kind,amount,currency,version) VALUES(b.id,'balance',b.total_amount-b.initial_due_amount,b.currency,b.version); END IF;
 PERFORM app.emit_booking_event(b.id,CASE WHEN b.status='confirmed' THEN 'booking_confirmed' ELSE 'approved_payment_required' END,p_actor);
 RETURN app.money_json(to_jsonb(b));
END $$;
CREATE OR REPLACE FUNCTION app.release_booking(p_booking uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
BEGIN
 PERFORM d.id FROM app.departures d WHERE d.id IN(SELECT departure_id FROM app.capacity_allocations c JOIN app.booking_items i ON i.id=c.booking_item_id WHERE i.booking_id=p_booking) ORDER BY d.id FOR UPDATE;
 PERFORM a.id FROM app.apartments a WHERE a.id IN(SELECT apartment_id FROM app.apartment_stays s JOIN app.booking_items i ON i.id=s.booking_item_id WHERE i.booking_id=p_booking) ORDER BY a.id FOR UPDATE;
 UPDATE app.capacity_allocations SET state='released',released_at=clock_timestamp() WHERE state<>'released' AND booking_item_id IN(SELECT id FROM app.booking_items WHERE booking_id=p_booking);
 UPDATE app.apartment_inventory SET released_at=clock_timestamp() WHERE released_at IS NULL AND stay_id IN(SELECT s.id FROM app.apartment_stays s JOIN app.booking_items i ON i.id=s.booking_item_id WHERE i.booking_id=p_booking);
 UPDATE app.apartment_stays SET state='released' WHERE booking_item_id IN(SELECT id FROM app.booking_items WHERE booking_id=p_booking);
 UPDATE app.resource_occupancy SET released_at=clock_timestamp() WHERE released_at IS NULL AND booking_item_id IN(SELECT id FROM app.booking_items WHERE booking_id=p_booking);
 UPDATE app.payment_attempts SET status='expired' WHERE booking_id=p_booking AND status IN('creating','pending','unknown');
 UPDATE app.payment_obligations SET status='void' WHERE booking_id=p_booking AND status='open';
END $$;
CREATE OR REPLACE FUNCTION app.expire_payment_hold(p_booking uuid,p_now timestamptz DEFAULT clock_timestamp()) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE b app.bookings;
BEGIN
 SELECT * INTO b FROM app.bookings WHERE id=p_booking FOR UPDATE;
 IF b.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF (b.status='approved_pending_payment' AND b.payment_deadline<=p_now) OR (b.status='pending_review' AND b.review_deadline<=p_now) THEN
  PERFORM app.release_booking(b.id);
  UPDATE app.bookings SET status='expired',version=version+1,updated_at=clock_timestamp() WHERE id=b.id RETURNING * INTO b;
  PERFORM app.emit_booking_event(b.id,'booking_expired');
 END IF;
 RETURN app.money_json(to_jsonb(b));
END $$;
CREATE OR REPLACE FUNCTION app.decide_booking(p_booking uuid,p_expected integer,p_actor uuid,p_action text,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE b app.bookings;
BEGIN
 IF p_action NOT IN('reject','cancel') OR length(trim(p_reason))<3 THEN RAISE EXCEPTION 'INVALID_DECISION'; END IF;
 PERFORM app.assert_staff(p_actor,CASE p_action WHEN 'reject' THEN 'bookings.approve' ELSE 'bookings.cancel' END,p_booking);
 SELECT * INTO b FROM app.bookings WHERE id=p_booking FOR UPDATE;
 IF b.version<>p_expected THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
 IF p_action='reject' AND b.status<>'pending_review' OR p_action='cancel' AND b.status NOT IN('pending_review','approved_pending_payment','confirmed') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 PERFORM app.release_booking(b.id);
 UPDATE app.bookings SET status=CASE p_action WHEN 'reject' THEN 'rejected' ELSE 'cancelled' END,version=version+1,updated_at=clock_timestamp() WHERE id=b.id RETURNING * INTO b;
 PERFORM app.emit_booking_event(b.id,CASE p_action WHEN 'reject' THEN 'request_rejected' ELSE 'cancellation_update' END,p_actor,jsonb_build_object('reason',p_reason));
 RETURN app.money_json(to_jsonb(b));
END $$;
CREATE OR REPLACE FUNCTION app.block_apartment(p_apartment uuid,p_start date,p_end date,p_reason text,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE a app.apartments; dest uuid; result app.apartment_inventory;
BEGIN
 PERFORM app.assert_staff(p_actor,'apartments.block');
 SELECT * INTO a FROM app.apartments WHERE id=p_apartment FOR UPDATE;
 SELECT destination_id INTO dest FROM app.properties WHERE id=a.property_id;
 IF NOT app.scope_allows(p_actor,dest,a.property_id) THEN RAISE EXCEPTION 'SCOPE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_start IS NULL OR p_end IS NULL OR p_end<=p_start OR length(trim(p_reason))<3 THEN RAISE EXCEPTION 'INVALID_BLOCK'; END IF;
 INSERT INTO app.apartment_inventory(apartment_id,date_range,kind,reason,actor_id) VALUES(a.id,daterange(p_start,p_end,'[)'),'maintenance',p_reason,p_actor) RETURNING * INTO result;
 INSERT INTO app.audit_events(actor_type,actor_id,action,target_type,target_id,summary) VALUES('staff',p_actor,'apartment_blocked','apartment',a.id,jsonb_build_object('blockId',result.id));
 RETURN to_jsonb(result);
EXCEPTION WHEN exclusion_violation THEN RAISE EXCEPTION 'INVENTORY_CONFLICT';
END $$;
CREATE OR REPLACE FUNCTION app.assign_resource(p_resource uuid,p_departure uuid,p_item uuid,p_start timestamptz,p_end timestamptz,p_quantity integer,p_actor uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE r app.resources; occupied integer; result uuid; booking uuid; dest uuid;
BEGIN
 IF num_nonnulls(p_departure,p_item)<>1 OR p_start>=p_end OR p_quantity<=0 THEN RAISE EXCEPTION 'INVALID_RESOURCE_ASSIGNMENT'; END IF;
 SELECT booking_id INTO booking FROM app.booking_items WHERE id=p_item;
 PERFORM app.assert_staff(p_actor,'operations.write',booking);
 IF p_departure IS NOT NULL THEN
  SELECT s.destination_id INTO dest FROM app.departures d JOIN app.service_variants v ON v.id=d.variant_id JOIN app.services s ON s.id=v.service_id WHERE d.id=p_departure;
  IF NOT app.scope_allows(p_actor,dest,NULL) THEN RAISE EXCEPTION 'SCOPE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 END IF;
 SELECT * INTO r FROM app.resources WHERE id=p_resource AND active FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'RESOURCE_UNAVAILABLE'; END IF;
 SELECT coalesce(sum(quantity),0) INTO occupied FROM app.resource_occupancy WHERE resource_id=r.id AND released_at IS NULL AND time_range && tstzrange(p_start,p_end,'[)');
 IF occupied+p_quantity>r.capacity THEN RAISE EXCEPTION 'RESOURCE_CAPACITY_CONFLICT'; END IF;
 INSERT INTO app.resource_occupancy(resource_id,departure_id,booking_item_id,time_range,quantity,exclusive) VALUES(r.id,p_departure,p_item,tstzrange(p_start,p_end,'[)'),p_quantity,r.mode='exclusive') RETURNING id INTO result;
 IF p_departure IS NOT NULL THEN INSERT INTO app.departure_resources(departure_id,resource_id,quantity,role) VALUES(p_departure,r.id,p_quantity,r.kind); END IF;
 RETURN result;
EXCEPTION WHEN exclusion_violation THEN RAISE EXCEPTION 'RESOURCE_CAPACITY_CONFLICT';
END $$;

CREATE OR REPLACE FUNCTION app.confirm_if_paid(p_booking uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
DECLARE b app.bookings; paid bigint;
BEGIN
 SELECT * INTO STRICT b FROM app.bookings WHERE id=p_booking FOR UPDATE;
 SELECT coalesce(sum(amount),0) INTO paid FROM app.cash_ledger WHERE booking_id=b.id AND currency=b.currency;
 IF b.status='approved_pending_payment' AND b.approved_at IS NOT NULL AND b.payment_deadline>clock_timestamp() AND paid>=b.initial_due_amount
 AND NOT EXISTS(SELECT 1 FROM app.booking_items i WHERE i.booking_id=b.id AND i.superseded_at IS NULL AND
   ((i.kind='tour' AND NOT EXISTS(SELECT 1 FROM app.capacity_allocations c WHERE c.booking_item_id=i.id AND c.state IN('held','confirmed')))
   OR (i.kind='stay' AND NOT EXISTS(SELECT 1 FROM app.apartment_stays s JOIN app.apartment_inventory ai ON ai.stay_id=s.id WHERE s.booking_item_id=i.id AND ai.released_at IS NULL)))) THEN
  UPDATE app.bookings SET status='confirmed',version=version+1,updated_at=clock_timestamp() WHERE id=b.id;
  UPDATE app.capacity_allocations SET state='confirmed',expires_at=NULL WHERE state='held' AND booking_item_id IN(SELECT id FROM app.booking_items WHERE booking_id=b.id AND superseded_at IS NULL);
  UPDATE app.apartment_inventory SET expires_at=NULL WHERE released_at IS NULL AND stay_id IN(SELECT s.id FROM app.apartment_stays s JOIN app.booking_items i ON i.id=s.booking_item_id WHERE i.booking_id=b.id AND i.superseded_at IS NULL);
  UPDATE app.apartment_stays SET state='confirmed' WHERE state='held' AND booking_item_id IN(SELECT id FROM app.booking_items WHERE booking_id=b.id AND superseded_at IS NULL);
  UPDATE app.payment_obligations SET status='paid' WHERE booking_id=b.id AND kind='initial' AND status='open';
  PERFORM app.emit_booking_event(b.id,'booking_confirmed');
 END IF;
END $$;
CREATE OR REPLACE FUNCTION app.create_payment_attempt(p_booking uuid,p_obligation uuid,p_key text,p_provider text,p_environment text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE b app.bookings; o app.payment_obligations; a app.payment_attempts; collectible bigint; pending bigint; paid bigint;
BEGIN
 SELECT * INTO b FROM app.bookings WHERE id=p_booking FOR UPDATE;
 SELECT * INTO a FROM app.payment_attempts WHERE request_key=p_key;
 IF a.id IS NOT NULL THEN IF a.booking_id<>p_booking OR a.obligation_id<>p_obligation OR a.provider<>p_provider OR a.environment<>p_environment THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF; RETURN app.money_json(to_jsonb(a)); END IF;
 IF b.status NOT IN('approved_pending_payment','confirmed') OR b.approved_at IS NULL THEN RAISE EXCEPTION 'PAYMENT_NOT_ELIGIBLE'; END IF;
 IF b.status='approved_pending_payment' AND b.payment_deadline<=clock_timestamp() THEN RAISE EXCEPTION 'PAYMENT_HOLD_EXPIRED'; END IF;
 SELECT * INTO o FROM app.payment_obligations WHERE id=p_obligation AND booking_id=b.id AND status='open';
 IF o.id IS NULL THEN RAISE EXCEPTION 'OBLIGATION_UNAVAILABLE'; END IF;
 SELECT coalesce(sum(amount),0) INTO paid FROM app.payment_applications WHERE obligation_id=o.id;
 SELECT coalesce(sum(expected_amount),0) INTO pending FROM app.payment_attempts WHERE obligation_id=o.id AND status IN('creating','pending','unknown');
 collectible:=o.amount-paid-pending;
 IF collectible<=0 THEN RAISE EXCEPTION 'PAYMENT_ALREADY_PENDING_OR_PAID'; END IF;
 INSERT INTO app.payment_attempts(booking_id,obligation_id,provider,environment,request_key,expected_amount,currency,checkout_expires_at) VALUES(b.id,o.id,p_provider,p_environment,p_key,collectible,b.currency,coalesce(b.payment_deadline,clock_timestamp()+interval '60 minutes')) RETURNING * INTO a;
 RETURN app.money_json(to_jsonb(a));
END $$;
CREATE OR REPLACE FUNCTION app.apply_payment_event(p_event jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
<<payment>>
DECLARE a app.payment_attempts; b app.bookings; e app.provider_events; t app.payment_transactions; ledger uuid; existing app.cash_ledger; amount bigint; captured bigint; refunded bigint; effect text; kind text; new_event boolean:=true; applied bigint;
BEGIN
 SELECT * INTO a FROM app.payment_attempts WHERE id=(p_event->>'attemptId')::uuid;
 IF a.id IS NULL THEN RAISE EXCEPTION 'UNKNOWN_PAYMENT_ATTEMPT'; END IF;
 SELECT * INTO STRICT b FROM app.bookings WHERE id=a.booking_id FOR UPDATE;
 amount:=(p_event->>'amountMinor')::bigint; kind:=p_event->>'kind';
 IF amount<=0 OR p_event->>'currency'<>a.currency OR p_event->>'provider'<>a.provider OR p_event->>'environment'<>a.environment OR nullif(p_event->>'account','') IS NULL THEN RAISE EXCEPTION 'PAYMENT_CORRELATION_MISMATCH'; END IF;
 IF kind NOT IN('succeeded','pending','failed','refunded','reversed','disputed') THEN RAISE EXCEPTION 'INVALID_PAYMENT_EVENT'; END IF;
 IF kind='succeeded' AND amount<>a.expected_amount THEN RAISE EXCEPTION 'PAYMENT_AMOUNT_MISMATCH'; END IF;
 INSERT INTO app.provider_events(provider,account,environment,event_key,event_kind,transaction_reference,verified_at,payload_redacted)
 VALUES(a.provider,p_event->>'account',a.environment,p_event->>'eventKey',kind,p_event->>'transactionId',clock_timestamp(),jsonb_build_object('attemptId',a.id,'amountMinor',amount::text,'currency',a.currency))
 ON CONFLICT DO NOTHING RETURNING * INTO e;
 IF e.id IS NULL THEN
  SELECT * INTO e FROM app.provider_events WHERE provider=a.provider AND account=p_event->>'account' AND environment=a.environment AND event_key=p_event->>'eventKey';
  IF e.payload_redacted->>'attemptId'<>a.id::text OR e.payload_redacted->>'amountMinor'<>amount::text OR e.event_kind<>kind OR e.transaction_reference<>p_event->>'transactionId' THEN RAISE EXCEPTION 'PROVIDER_EVENT_CONFLICT'; END IF;
  RETURN jsonb_build_object('bookingId',b.id,'status',b.status,'duplicate',true);
 END IF;
 SELECT * INTO t FROM app.payment_transactions WHERE provider=a.provider AND account=p_event->>'account' AND environment=a.environment AND transaction_id=p_event->>'transactionId' FOR UPDATE;
 IF t.id IS NULL THEN
  INSERT INTO app.payment_transactions(provider,account,environment,transaction_id,attempt_id,state,amount,currency,provider_updated_at) VALUES(a.provider,p_event->>'account',a.environment,p_event->>'transactionId',a.id,kind,amount,a.currency,clock_timestamp()) RETURNING * INTO t;
 ELSE
  IF t.attempt_id<>a.id OR t.currency<>a.currency THEN RAISE EXCEPTION 'TRANSACTION_CORRELATION_MISMATCH'; END IF;
  UPDATE app.payment_transactions SET state=CASE WHEN kind IN('refunded','reversed','disputed') OR state NOT IN('succeeded','refunded','reversed','disputed') THEN kind ELSE state END,provider_updated_at=clock_timestamp() WHERE id=t.id;
 END IF;
 IF kind='succeeded' THEN
  effect:=t.id||':capture';
  INSERT INTO app.cash_ledger(booking_id,source,amount,currency,transaction_id,event_id,effect_key) VALUES(b.id,'online',amount,b.currency,t.id,e.id,effect) ON CONFLICT(effect_key) DO NOTHING RETURNING id INTO ledger;
  UPDATE app.payment_attempts SET status='succeeded' WHERE id=a.id;
  IF ledger IS NOT NULL THEN
   SELECT least(payment.amount,greatest(0,o.amount-coalesce((SELECT sum(pa.amount) FROM app.payment_applications pa WHERE pa.obligation_id=o.id),0))) INTO applied FROM app.payment_obligations o WHERE o.id=a.obligation_id;
   IF applied>0 THEN INSERT INTO app.payment_applications(ledger_entry_id,obligation_id,amount,currency) VALUES(ledger,a.obligation_id,applied,b.currency); END IF;
   IF b.status='approved_pending_payment' AND b.payment_deadline<=clock_timestamp() THEN PERFORM app.expire_payment_hold(b.id,clock_timestamp());SELECT * INTO b FROM app.bookings WHERE id=b.id; END IF;
   IF b.status IN('expired','cancelled','rejected') THEN
    INSERT INTO app.financial_exceptions(booking_id,event_id,kind) VALUES(b.id,e.id,'late_payment');
   ELSE PERFORM app.confirm_if_paid(b.id); END IF;
   INSERT INTO app.receipts(booking_id,number,line_snapshot,amount,currency) VALUES(b.id,'R-'||upper(replace(ledger::text,'-','')),jsonb_build_array(jsonb_build_object('source','online','amountMinor',amount::text)),amount,b.currency);
   INSERT INTO app.outbox_events(aggregate_type,aggregate_id,aggregate_version,event_type,event_key,payload) VALUES('payment',ledger,1,'payment_received',ledger||':payment_received',jsonb_build_object('bookingId',b.id));
  END IF;
 ELSIF kind IN('refunded','reversed','disputed') THEN
  effect:=t.id||':'||kind||':'||coalesce(nullif(p_event->>'effectKey',''),p_event->>'eventKey');
  IF NOT EXISTS(SELECT 1 FROM app.cash_ledger WHERE effect_key=effect) THEN
   SELECT coalesce(sum(cl.amount) FILTER(WHERE cl.amount>0),0),-coalesce(sum(cl.amount) FILTER(WHERE cl.amount<0),0) INTO captured,refunded FROM app.cash_ledger cl WHERE cl.transaction_id=t.id;
   IF amount>captured-refunded THEN RAISE EXCEPTION 'REFUND_EXCEEDS_RECEIPT'; END IF;
   INSERT INTO app.cash_ledger(booking_id,source,amount,currency,transaction_id,event_id,effect_key) VALUES(b.id,CASE kind WHEN 'refunded' THEN 'refund' WHEN 'disputed' THEN 'chargeback' ELSE 'reversal' END,-amount,b.currency,t.id,e.id,effect);
   IF kind<>'refunded' THEN INSERT INTO app.financial_exceptions(booking_id,event_id,kind) VALUES(b.id,e.id,'dispute'); END IF;
  END IF;
 ELSIF kind='failed' THEN UPDATE app.payment_attempts SET status='failed' WHERE id=a.id AND status<>'succeeded';
 ELSIF kind='pending' THEN UPDATE app.payment_attempts SET status='pending' WHERE id=a.id AND status='creating';
 END IF;
 SELECT * INTO b FROM app.bookings WHERE id=b.id;
 RETURN jsonb_build_object('bookingId',b.id,'status',b.status,'eventId',e.id,'duplicateEffect',ledger IS NULL);
END $$;
CREATE OR REPLACE FUNCTION app.record_offline_receipt(p_booking uuid,p_amount bigint,p_currency text,p_method text,p_reference text,p_key text,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE b app.bookings; r app.offline_receipts; ledger uuid; o app.payment_obligations; remaining bigint; applied bigint;
BEGIN
 PERFORM app.assert_staff(p_actor,'payments.record_offline',p_booking);
 SELECT * INTO b FROM app.bookings WHERE id=p_booking FOR UPDATE;
 SELECT * INTO r FROM app.offline_receipts WHERE request_key=p_key;
 IF r.id IS NOT NULL THEN IF r.booking_id<>p_booking OR r.amount<>p_amount OR r.currency<>p_currency OR r.method<>p_method THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;RETURN app.money_json(to_jsonb(r));END IF;
 IF b.status NOT IN('approved_pending_payment','confirmed','completed') OR b.currency<>p_currency OR p_amount<=0 OR p_method NOT IN('cash','bank_transfer') THEN RAISE EXCEPTION 'INVALID_RECEIPT'; END IF;
 INSERT INTO app.offline_receipts(booking_id,method,amount,currency,received_by,received_at,reference,verification_status,request_key) VALUES(b.id,p_method,p_amount,p_currency,p_actor,clock_timestamp(),p_reference,'verified',p_key) RETURNING * INTO r;
 INSERT INTO app.cash_ledger(booking_id,source,amount,currency,offline_receipt_id,effect_key,actor_id) VALUES(b.id,'offline',p_amount,p_currency,r.id,'offline:'||r.id,p_actor) RETURNING id INTO ledger;
 remaining:=p_amount;
 FOR o IN SELECT * FROM app.payment_obligations WHERE booking_id=b.id AND status='open' ORDER BY CASE kind WHEN 'initial' THEN 0 ELSE 1 END,id LOOP
  SELECT least(remaining,greatest(0,o.amount-coalesce(sum(amount),0))) INTO applied FROM app.payment_applications WHERE obligation_id=o.id;
  IF applied>0 THEN INSERT INTO app.payment_applications(ledger_entry_id,obligation_id,amount,currency) VALUES(ledger,o.id,applied,p_currency);remaining:=remaining-applied;END IF;
 END LOOP;
 IF b.status='approved_pending_payment' AND b.payment_deadline<=clock_timestamp() THEN
  PERFORM app.expire_payment_hold(b.id,clock_timestamp());INSERT INTO app.financial_exceptions(booking_id,kind) VALUES(b.id,'late_payment');
 ELSE PERFORM app.confirm_if_paid(b.id); END IF;
 INSERT INTO app.receipts(booking_id,number,line_snapshot,amount,currency) VALUES(b.id,'R-'||upper(replace(ledger::text,'-','')),jsonb_build_array(jsonb_build_object('source',p_method,'reference',p_reference)),p_amount,p_currency);
 RETURN app.money_json(to_jsonb(r));
END $$;
CREATE OR REPLACE FUNCTION app.request_refund(p_booking uuid,p_transaction uuid,p_offline uuid,p_amount bigint,p_reason text,p_policy jsonb,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE b app.bookings; r app.refund_requests; captured bigint; reserved bigint;
BEGIN
 PERFORM app.assert_staff(p_actor,'refunds.request',p_booking);
 SELECT * INTO b FROM app.bookings WHERE id=p_booking FOR UPDATE;
 IF p_amount<=0 OR num_nonnulls(p_transaction,p_offline)<>1 OR length(trim(p_reason))<3 THEN RAISE EXCEPTION 'INVALID_REFUND'; END IF;
 SELECT coalesce(sum(amount),0) INTO captured FROM app.cash_ledger WHERE booking_id=b.id AND (transaction_id=p_transaction OR offline_receipt_id=p_offline);
 SELECT coalesce(sum(amount),0) INTO reserved FROM app.refund_requests WHERE booking_id=b.id AND status IN('requested','approved','processing') AND (original_transaction_id=p_transaction OR original_offline_receipt_id=p_offline);
 IF p_amount>captured-reserved THEN RAISE EXCEPTION 'REFUND_EXCEEDS_RECEIPT'; END IF;
 INSERT INTO app.refund_requests(booking_id,original_transaction_id,original_offline_receipt_id,amount,currency,reason,policy_calculation,requested_by) VALUES(b.id,p_transaction,p_offline,p_amount,b.currency,p_reason,p_policy,p_actor) RETURNING * INTO r;
 RETURN app.money_json(to_jsonb(r));
END $$;
CREATE OR REPLACE FUNCTION app.approve_refund(p_refund uuid,p_expected integer,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE r app.refund_requests; granted_limit bigint; owner_role boolean;
BEGIN
 SELECT * INTO r FROM app.refund_requests WHERE id=p_refund;
 PERFORM app.assert_staff(p_actor,'refunds.approve',r.booking_id);
 PERFORM 1 FROM app.bookings WHERE id=r.booking_id FOR UPDATE;
 SELECT * INTO r FROM app.refund_requests WHERE id=p_refund FOR UPDATE;
 IF r.version<>p_expected THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
 IF r.status<>'requested' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 SELECT EXISTS(SELECT 1 FROM app.staff_roles sr JOIN app.roles rr ON rr.id=sr.role_id WHERE sr.staff_id=p_actor AND rr.code='owner') INTO owner_role;
 IF NOT owner_role THEN
  SELECT g.limit_amount INTO granted_limit FROM app.staff_permission_grants g JOIN app.permissions p ON p.id=g.permission_id WHERE g.staff_id=p_actor AND p.code='refunds.approve' AND g.currency=r.currency;
  IF granted_limit IS NULL OR r.amount>granted_limit THEN RAISE EXCEPTION 'REFUND_LIMIT_EXCEEDED' USING ERRCODE='42501'; END IF;
 END IF;
 IF r.requested_by=p_actor AND NOT owner_role THEN RAISE EXCEPTION 'SEPARATION_OF_DUTIES_REQUIRED' USING ERRCODE='42501'; END IF;
 UPDATE app.refund_requests SET status='approved',approved_by=p_actor,approved_at=clock_timestamp(),version=version+1 WHERE id=r.id RETURNING * INTO r;
 INSERT INTO app.outbox_events(aggregate_type,aggregate_id,aggregate_version,event_type,event_key,payload) VALUES('refund',r.id,r.version,'refund_approved',r.id||':approved',jsonb_build_object('refundId',r.id));
 RETURN app.money_json(to_jsonb(r));
END $$;
CREATE OR REPLACE FUNCTION app.complete_offline_refund(p_refund uuid,p_key text,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE r app.refund_requests; captured bigint;
BEGIN
 SELECT * INTO r FROM app.refund_requests WHERE id=p_refund;
 PERFORM app.assert_staff(p_actor,'refunds.approve',r.booking_id);
 PERFORM 1 FROM app.bookings WHERE id=r.booking_id FOR UPDATE;
 SELECT * INTO r FROM app.refund_requests WHERE id=p_refund FOR UPDATE;
 IF r.status='succeeded' THEN RETURN app.money_json(to_jsonb(r)); END IF;
 IF r.status<>'approved' OR r.original_offline_receipt_id IS NULL THEN RAISE EXCEPTION 'INVALID_REFUND_ROUTE'; END IF;
 SELECT coalesce(sum(amount),0) INTO captured FROM app.cash_ledger WHERE offline_receipt_id=r.original_offline_receipt_id;
 IF r.amount>captured THEN RAISE EXCEPTION 'REFUND_EXCEEDS_RECEIPT'; END IF;
 INSERT INTO app.refund_attempts(refund_request_id,route,request_key,state) VALUES(r.id,'offline',p_key,'succeeded');
 INSERT INTO app.cash_ledger(booking_id,source,amount,currency,offline_receipt_id,refund_request_id,effect_key,actor_id) VALUES(r.booking_id,'refund',-r.amount,r.currency,r.original_offline_receipt_id,r.id,'refund:'||r.id,p_actor);
 UPDATE app.refund_requests SET status='succeeded',version=version+1 WHERE id=r.id RETURNING * INTO r;
 RETURN app.money_json(to_jsonb(r));
END $$;
CREATE OR REPLACE FUNCTION app.claim_jobs(p_worker text,p_limit integer,p_lease_seconds integer DEFAULT 60) RETURNS SETOF app.jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
BEGIN
 IF length(p_worker)<3 OR p_limit NOT BETWEEN 1 AND 100 OR p_lease_seconds NOT BETWEEN 10 AND 300 THEN RAISE EXCEPTION 'INVALID_LEASE'; END IF;
 RETURN QUERY WITH eligible AS(SELECT id FROM app.jobs WHERE run_after<=clock_timestamp() AND (status IN('pending','failed') OR(status='running' AND lease_until<clock_timestamp())) AND attempts<8 ORDER BY run_after,id FOR UPDATE SKIP LOCKED LIMIT p_limit)
 UPDATE app.jobs j SET status='running',attempts=j.attempts+1,lease_owner=p_worker,lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds) FROM eligible WHERE j.id=eligible.id RETURNING j.*;
END $$;
CREATE OR REPLACE FUNCTION app.finish_job(p_job uuid,p_worker text,p_success boolean,p_failure text DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE count integer;
BEGIN
 UPDATE app.jobs SET status=CASE WHEN p_success THEN 'complete' WHEN attempts>=8 THEN 'dead' ELSE 'failed' END,completed_at=CASE WHEN p_success THEN clock_timestamp() END,failure_class=p_failure,run_after=clock_timestamp()+make_interval(secs=>least(3600,30*power(2,attempts)::integer)),lease_owner=NULL,lease_until=NULL WHERE id=p_job AND status='running' AND lease_owner=p_worker AND lease_until>clock_timestamp();
 GET DIAGNOSTICS count=ROW_COUNT; RETURN count=1;
END $$;

CREATE OR REPLACE FUNCTION app.create_booking_request(p_booking uuid,p_type text,p_changes jsonb,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE b app.bookings; r app.booking_requests;
BEGIN
 SELECT * INTO b FROM app.bookings WHERE id=p_booking FOR SHARE;
 IF b.status NOT IN('pending_review','approved_pending_payment','confirmed') OR p_type NOT IN('change','cancel') OR length(trim(p_reason))<3 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 INSERT INTO app.booking_requests(booking_id,type,proposed_changes,reason) VALUES(b.id,p_type,p_changes,p_reason) RETURNING * INTO r;
 RETURN app.money_json(to_jsonb(r));
END $$;
CREATE OR REPLACE FUNCTION app.propose_revision(p_booking uuid,p_expected integer,p_quote uuid,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE b app.bookings; q app.quotes; r app.booking_revisions;
BEGIN
 PERFORM app.assert_staff(p_actor,'bookings.revise',p_booking);
 SELECT * INTO b FROM app.bookings WHERE id=p_booking FOR UPDATE;
 IF b.version<>p_expected THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
 IF b.status NOT IN('pending_review','approved_pending_payment','confirmed') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 SELECT * INTO q FROM app.quotes WHERE id=p_quote AND valid_until>clock_timestamp();
 IF q.id IS NULL OR q.currency<>b.currency THEN RAISE EXCEPTION 'INVALID_REVISION_QUOTE'; END IF;
 INSERT INTO app.booking_revisions(booking_id,source_version,quote_id) VALUES(b.id,b.version,q.id) RETURNING * INTO r;
 RETURN app.money_json(to_jsonb(r));
END $$;
CREATE OR REPLACE FUNCTION app.accept_revision(p_booking uuid,p_revision uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE r app.booking_revisions;
BEGIN
 SELECT * INTO r FROM app.booking_revisions WHERE id=p_revision AND booking_id=p_booking FOR UPDATE;
 IF r.status<>'proposed' THEN RAISE EXCEPTION 'INVALID_REVISION_STATE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app.quotes WHERE id=r.quote_id AND valid_until>clock_timestamp()) THEN RAISE EXCEPTION 'QUOTE_EXPIRED'; END IF;
 UPDATE app.booking_revisions SET guest_accepted_at=clock_timestamp(),status='accepted' WHERE id=r.id RETURNING * INTO r; RETURN app.money_json(to_jsonb(r));
END $$;
CREATE OR REPLACE FUNCTION app.apply_revision(p_booking uuid,p_revision uuid,p_expected integer,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE b app.bookings; q app.quotes; r app.booking_revisions; paid bigint;
BEGIN
 PERFORM app.assert_staff(p_actor,'bookings.revise',p_booking);
 SELECT * INTO b FROM app.bookings WHERE id=p_booking FOR UPDATE;
 SELECT * INTO r FROM app.booking_revisions WHERE id=p_revision AND booking_id=p_booking FOR UPDATE;
 IF b.version<>p_expected OR r.source_version<>b.version THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
 IF b.status NOT IN('pending_review','approved_pending_payment','confirmed') OR r.status<>'accepted' OR r.guest_accepted_at IS NULL THEN RAISE EXCEPTION 'INVALID_REVISION_STATE'; END IF;
 SELECT * INTO q FROM app.quotes WHERE id=r.quote_id;
 -- Replacement items must all be in scope, before touching original inventory.
 IF EXISTS(SELECT 1 FROM app.quote_items qi LEFT JOIN app.service_variants v ON v.id=qi.variant_id LEFT JOIN app.services s ON s.id=v.service_id LEFT JOIN app.apartments a ON a.id=qi.apartment_id LEFT JOIN app.properties p ON p.id=a.property_id WHERE qi.quote_id=q.id AND NOT app.scope_allows(p_actor,coalesce(s.destination_id,p.destination_id),p.id)) THEN RAISE EXCEPTION 'SCOPE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 PERFORM app.release_booking(b.id);
 UPDATE app.booking_items SET superseded_at=clock_timestamp() WHERE booking_id=b.id AND superseded_at IS NULL;
 SELECT coalesce(sum(amount),0) INTO paid FROM app.cash_ledger WHERE booking_id=b.id;
 UPDATE app.bookings SET accepted_quote_id=q.id,total_amount=q.total,initial_due_amount=q.initial_due,price_snapshot=to_jsonb(q),policy_snapshot=q.policy_snapshot,approved_by=p_actor,approved_at=clock_timestamp(),payment_deadline=CASE WHEN q.initial_due>paid THEN clock_timestamp()+make_interval(mins=>(q.policy_snapshot->>'hold_minutes')::int) END WHERE id=b.id;
 PERFORM app.copy_quote_items(b.id,q.id);
 PERFORM app.allocate_booking(b.id,p_actor);
 UPDATE app.bookings SET status=CASE WHEN q.initial_due>paid THEN 'approved_pending_payment' ELSE 'confirmed' END,version=version+1,updated_at=clock_timestamp() WHERE id=b.id RETURNING * INTO b;
 IF b.status='confirmed' THEN
  UPDATE app.capacity_allocations SET state='confirmed',expires_at=NULL WHERE booking_item_id IN(SELECT id FROM app.booking_items WHERE booking_id=b.id AND superseded_at IS NULL);
  UPDATE app.apartment_stays SET state='confirmed' WHERE booking_item_id IN(SELECT id FROM app.booking_items WHERE booking_id=b.id AND superseded_at IS NULL);
 END IF;
 INSERT INTO app.payment_obligations(booking_id,kind,amount,currency,due_at,version,status) VALUES(b.id,'initial',greatest(0,q.initial_due-paid),b.currency,b.payment_deadline,b.version,CASE WHEN q.initial_due<=paid THEN 'paid' ELSE 'open' END);
 IF q.total>greatest(q.initial_due,paid) THEN INSERT INTO app.payment_obligations(booking_id,kind,amount,currency,version) VALUES(b.id,'balance',q.total-greatest(q.initial_due,paid),b.currency,b.version); END IF;
 IF paid>q.total THEN INSERT INTO app.financial_exceptions(booking_id,kind,resolution) VALUES(b.id,'amount_mismatch',jsonb_build_object('reason','revision_overpayment','amountMinor',(paid-q.total)::text)); END IF;
 UPDATE app.booking_revisions SET status='applied',staff_approved_at=clock_timestamp(),approved_by=p_actor WHERE id=r.id;
 PERFORM app.emit_booking_event(b.id,'booking_changed',p_actor,jsonb_build_object('revisionId',r.id));
 RETURN app.money_json(to_jsonb(b));
END $$;
CREATE OR REPLACE FUNCTION app.fulfil_item(p_item uuid,p_state text,p_note text,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE item app.booking_items; b app.bookings;
BEGIN
 SELECT * INTO item FROM app.booking_items WHERE id=p_item AND superseded_at IS NULL;
 PERFORM app.assert_staff(p_actor,'operations.write',item.booking_id);
 SELECT * INTO b FROM app.bookings WHERE id=item.booking_id FOR UPDATE;
 IF b.status<>'confirmed' OR p_state NOT IN('check_in','fulfilled','no_show','cancelled') THEN RAISE EXCEPTION 'INVALID_FULFILMENT'; END IF;
 IF p_state IN('no_show','cancelled') AND length(trim(p_note))<3 THEN RAISE EXCEPTION 'RESOLUTION_REQUIRED'; END IF;
 UPDATE app.booking_items SET fulfilment_state=p_state WHERE id=item.id RETURNING * INTO item;
 INSERT INTO app.fulfilment_events(booking_item_id,state,actor_id,notes) VALUES(item.id,p_state,p_actor,p_note);
 IF NOT EXISTS(SELECT 1 FROM app.booking_items WHERE booking_id=b.id AND superseded_at IS NULL AND fulfilment_state NOT IN('fulfilled','no_show','cancelled')) THEN
  UPDATE app.bookings SET status='completed',version=version+1,updated_at=clock_timestamp() WHERE id=b.id;
  PERFORM app.emit_booking_event(b.id,'booking_completed',p_actor);
 END IF;
 RETURN to_jsonb(item);
END $$;

CREATE OR REPLACE FUNCTION app.touch_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN NEW.updated_at=clock_timestamp();RETURN NEW;END $$;
CREATE OR REPLACE FUNCTION app.enforce_item_details() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
DECLARE i app.booking_items; target uuid;
BEGIN
 target:=CASE WHEN TG_TABLE_NAME='booking_items' THEN (to_jsonb(NEW)->>'id')::uuid ELSE (to_jsonb(NEW)->>'booking_item_id')::uuid END;
 SELECT * INTO i FROM app.booking_items WHERE id=target;
 IF i.id IS NULL THEN RETURN NULL; END IF;
 IF (i.kind='tour')<>EXISTS(SELECT 1 FROM app.tour_booking_items WHERE booking_item_id=i.id)
 OR (i.kind='stay')<>EXISTS(SELECT 1 FROM app.apartment_stays WHERE booking_item_id=i.id)
 OR (i.kind='transfer')<>EXISTS(SELECT 1 FROM app.transfer_booking_items WHERE booking_item_id=i.id)
 OR (i.kind='photography')<>EXISTS(SELECT 1 FROM app.photography_booking_items WHERE booking_item_id=i.id)
 OR (i.kind='addon')<>EXISTS(SELECT 1 FROM app.addon_booking_items WHERE booking_item_id=i.id) THEN RAISE EXCEPTION 'ITEM_DETAIL_MISMATCH' USING ERRCODE='23514'; END IF;
 IF i.parent_item_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.booking_items p WHERE p.id=i.parent_item_id AND p.booking_id=i.booking_id) THEN RAISE EXCEPTION 'CROSS_BOOKING_PARENT' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION app.enforce_application_limit() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
DECLARE receipt app.cash_ledger; obligation app.payment_obligations; used bigint;
BEGIN
 SELECT * INTO receipt FROM app.cash_ledger WHERE id=NEW.ledger_entry_id FOR UPDATE;
 SELECT * INTO obligation FROM app.payment_obligations WHERE id=NEW.obligation_id FOR UPDATE;
 IF receipt.booking_id<>obligation.booking_id OR receipt.currency<>NEW.currency OR obligation.currency<>NEW.currency OR receipt.amount<=0 THEN RAISE EXCEPTION 'INVALID_PAYMENT_APPLICATION'; END IF;
 SELECT coalesce(sum(amount),0) INTO used FROM app.payment_applications WHERE ledger_entry_id=receipt.id;
 IF used+NEW.amount>receipt.amount THEN RAISE EXCEPTION 'RECEIPT_APPLICATION_EXCEEDED'; END IF;
 SELECT coalesce(sum(amount),0) INTO used FROM app.payment_applications WHERE obligation_id=obligation.id;
 IF used+NEW.amount>obligation.amount THEN RAISE EXCEPTION 'OBLIGATION_APPLICATION_EXCEEDED'; END IF;
 RETURN NEW;
END $$;
GRANT EXECUTE ON FUNCTION app.assert_staff(uuid,text,uuid) TO tourism_app;
GRANT INSERT ON app.outbox_events,app.audit_events,app.booking_events TO tourism_app;
DROP POLICY IF EXISTS runtime_insert ON app.outbox_events;
CREATE POLICY runtime_insert ON app.outbox_events FOR INSERT TO tourism_app WITH CHECK(true);
DROP POLICY IF EXISTS runtime_insert ON app.audit_events;
CREATE POLICY runtime_insert ON app.audit_events FOR INSERT TO tourism_app WITH CHECK(true);
DROP POLICY IF EXISTS runtime_insert ON app.booking_events;
CREATE POLICY runtime_insert ON app.booking_events FOR INSERT TO tourism_app WITH CHECK(true);
