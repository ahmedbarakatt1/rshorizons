ALTER TABLE app.apartments ADD COLUMN IF NOT EXISTS cancellation_policy_version_id uuid REFERENCES app.policy_versions(id);
CREATE OR REPLACE FUNCTION app.staff_edit(p_kind text,p_id uuid,p_expected integer,p_data jsonb,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE permission text; existing jsonb; result jsonb; target uuid; destination uuid; property uuid; parent uuid; allowed text; val text; row_version integer; setting app.agency_settings; scoped_book uuid;
BEGIN
 IF p_kind IN('properties','apartment_policy_bindings','photo_packages','photographer_assignments','gallery_entitlements','publication_consents','media_rights','media_subjects') THEN RETURN app.staff_config_edit(p_kind,p_id,p_expected,p_data,p_actor);END IF;
 IF p_kind IN('resources_block','stay_event','departure_assignment','staff_access','financial_exception','pickup','apartment_block') THEN RETURN app.staff_operation(p_kind,p_id,p_expected,p_data,p_actor);END IF;
 permission:=CASE WHEN p_kind IN('services','variants','prices','payment_policy_bindings') THEN 'catalog.write' WHEN p_kind IN('departures','resources','pickups','dive_clearance') THEN 'operations.write' WHEN p_kind IN('apartments','apartment_rates') THEN 'apartments.write' WHEN p_kind='galleries' THEN 'galleries.manage' WHEN p_kind IN('pages','social_links') THEN 'content.write' WHEN p_kind IN('staff','settings') THEN 'staff.manage' ELSE NULL END;
 IF permission IS NULL THEN RAISE EXCEPTION 'INVALID_EDITOR'; END IF;
 PERFORM app.assert_staff(p_actor,permission);
 target:=coalesce(p_id,gen_random_uuid());
 -- The relation is selected from a fixed allowlist, never supplied by a caller.
 allowed:=CASE p_kind WHEN 'services' THEN 'services' WHEN 'variants' THEN 'service_variants' WHEN 'departures' THEN 'departures' WHEN 'resources' THEN 'resources' WHEN 'apartments' THEN 'apartments' WHEN 'galleries' THEN 'galleries' WHEN 'pages' THEN 'cms_pages' WHEN 'social_links' THEN 'social_links' WHEN 'staff' THEN 'staff_profiles' END;
 IF p_id IS NOT NULL AND allowed IS NOT NULL THEN
  EXECUTE format('SELECT to_jsonb(t) FROM app.%I t WHERE id=$1 FOR UPDATE',allowed) INTO existing USING p_id;
  IF existing IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  row_version:=(existing->>'version')::integer;
  IF p_expected IS NULL OR p_expected<>row_version THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
 END IF;
 IF p_kind='services' THEN
  destination:=coalesce((p_data->>'destinationId')::uuid,(existing->>'destination_id')::uuid);
  IF NOT app.scope_allows(p_actor,destination,NULL) OR (existing IS NOT NULL AND NOT app.scope_allows(p_actor,(existing->>'destination_id')::uuid,NULL)) THEN RAISE EXCEPTION 'SCOPE_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF p_id IS NULL THEN
   INSERT INTO app.services(id,category_id,destination_id,duration_minutes,cutoff_minutes,status,cancellation_policy_version_id) VALUES(target,(p_data->>'categoryId')::uuid,destination,(p_data->>'durationMinutes')::int,coalesce((p_data->>'cutoffMinutes')::int,60),'draft',(p_data->>'cancellationPolicyVersionId')::uuid);
  ELSE
   UPDATE app.services SET category_id=coalesce((p_data->>'categoryId')::uuid,category_id),destination_id=destination,duration_minutes=coalesce((p_data->>'durationMinutes')::int,duration_minutes),cutoff_minutes=coalesce((p_data->>'cutoffMinutes')::int,cutoff_minutes),cancellation_policy_version_id=coalesce((p_data->>'cancellationPolicyVersionId')::uuid,cancellation_policy_version_id),status='draft',version=version+1 WHERE id=target;
  END IF;
  IF p_data ? 'locale' THEN INSERT INTO app.service_translations(service_id,locale,slug,title,summary,itinerary,inclusions,exclusions,restrictions,meeting_notes)
   VALUES(target,p_data->>'locale',p_data->>'slug',p_data->>'title',p_data->>'summary',coalesce(p_data->'itinerary','[]'),coalesce(p_data->'inclusions','[]'),coalesce(p_data->'exclusions','[]'),coalesce(p_data->'restrictions','{}'),coalesce(p_data->>'meetingNotes',''))
   ON CONFLICT(service_id,locale) DO UPDATE SET slug=EXCLUDED.slug,title=EXCLUDED.title,summary=EXCLUDED.summary,itinerary=EXCLUDED.itinerary,inclusions=EXCLUDED.inclusions,exclusions=EXCLUDED.exclusions,restrictions=EXCLUDED.restrictions,meeting_notes=EXCLUDED.meeting_notes,approved_at=NULL;
  END IF;
 ELSIF p_kind='variants' THEN
  parent:=coalesce((p_data->>'serviceId')::uuid,(existing->>'service_id')::uuid);
  SELECT destination_id INTO destination FROM app.services WHERE id=parent;
  IF NOT app.scope_allows(p_actor,destination,NULL) THEN RAISE EXCEPTION 'SCOPE_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF p_id IS NULL THEN INSERT INTO app.service_variants(id,service_id,variant_code,capacity_model,pricing_unit,duration_minutes) VALUES(target,parent,p_data->>'variantCode',p_data->>'capacityModel',p_data->>'pricingUnit',(p_data->>'durationMinutes')::int);
  ELSE
   IF parent<>(existing->>'service_id')::uuid THEN RAISE EXCEPTION 'PARENT_CHANGE_FORBIDDEN'; END IF;
   UPDATE app.service_variants SET active=coalesce((p_data->>'active')::boolean,active),duration_minutes=coalesce((p_data->>'durationMinutes')::int,duration_minutes),version=version+1 WHERE id=target;
  END IF;
  IF p_data ? 'locale' THEN
   IF nullif(btrim(p_data->>'title'),'') IS NULL THEN RAISE EXCEPTION 'TRANSLATION_TITLE_REQUIRED';END IF;
   INSERT INTO app.variant_translations(variant_id,locale,title,description) VALUES(target,p_data->>'locale',p_data->>'title',coalesce(p_data->>'description',''))
   ON CONFLICT(variant_id,locale) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,approved_at=NULL;
  END IF;
 ELSIF p_kind='departures' THEN
  parent:=coalesce((p_data->>'variantId')::uuid,(existing->>'variant_id')::uuid);
  SELECT s.destination_id INTO destination FROM app.service_variants v JOIN app.services s ON s.id=v.service_id WHERE v.id=parent;
  IF NOT app.scope_allows(p_actor,destination,NULL) THEN RAISE EXCEPTION 'SCOPE_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF p_id IS NULL THEN INSERT INTO app.departures(id,variant_id,starts_at,ends_at,seat_capacity,cutoff_at) VALUES(target,parent,(p_data->>'startsAt')::timestamptz,(p_data->>'endsAt')::timestamptz,(p_data->>'seatCapacity')::int,(p_data->>'cutoffAt')::timestamptz);
  ELSE
   IF EXISTS(SELECT 1 FROM app.capacity_allocations WHERE departure_id=target AND state<>'released') OR EXISTS(SELECT 1 FROM app.resource_occupancy WHERE departure_id=target AND released_at IS NULL) THEN RAISE EXCEPTION 'ACTIVE_DEPARTURE_REQUIRES_REVIEWED_REVISION'; END IF;
   IF parent<>(existing->>'variant_id')::uuid THEN RAISE EXCEPTION 'PARENT_CHANGE_FORBIDDEN'; END IF;
   UPDATE app.departures SET starts_at=(p_data->>'startsAt')::timestamptz,ends_at=(p_data->>'endsAt')::timestamptz,seat_capacity=(p_data->>'seatCapacity')::int,cutoff_at=(p_data->>'cutoffAt')::timestamptz,version=version+1 WHERE id=target;
  END IF;
 ELSIF p_kind='apartments' THEN
  property:=coalesce((p_data->>'propertyId')::uuid,(existing->>'property_id')::uuid);
  SELECT destination_id INTO destination FROM app.properties WHERE id=property;
  IF NOT app.scope_allows(p_actor,destination,property) THEN RAISE EXCEPTION 'SCOPE_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF p_id IS NULL THEN
   INSERT INTO app.apartments(id,property_id,unit_code,bedrooms,beds,bathrooms,max_guests,default_rate,currency,min_nights,cleaning_buffer_days,check_in_time,check_out_time,cancellation_policy_version_id)
   VALUES(target,property,p_data->>'unitCode',(p_data->>'bedrooms')::int,(p_data->>'beds')::int,(p_data->>'bathrooms')::numeric,(p_data->>'maxGuests')::int,(p_data->>'nightlyAmountMinor')::bigint,p_data->>'currency',coalesce((p_data->>'minNights')::int,1),coalesce((p_data->>'cleaningBufferDays')::int,0),coalesce((p_data->>'checkInTime')::time,'15:00'),coalesce((p_data->>'checkOutTime')::time,'11:00'),(p_data->>'cancellationPolicyVersionId')::uuid);
  ELSE
   IF property<>(existing->>'property_id')::uuid THEN RAISE EXCEPTION 'PARENT_CHANGE_FORBIDDEN'; END IF;
   IF EXISTS(SELECT 1 FROM app.apartment_inventory WHERE apartment_id=target AND released_at IS NULL) AND (
    (p_data ? 'cleaningBufferDays' AND (p_data->>'cleaningBufferDays')::int<>(existing->>'cleaning_buffer_days')::int) OR
    (p_data ? 'maxGuests' AND (p_data->>'maxGuests')::int<(existing->>'max_guests')::int)
   ) THEN RAISE EXCEPTION 'ACTIVE_STAY_REQUIRES_REVIEWED_REVISION';END IF;
   IF p_data ? 'currency' AND p_data->>'currency'<>existing->>'currency' THEN RAISE EXCEPTION 'CURRENCY_CHANGE_REQUIRES_NEW_UNIT';END IF;
   UPDATE app.apartments SET default_rate=coalesce((p_data->>'nightlyAmountMinor')::bigint,default_rate),min_nights=coalesce((p_data->>'minNights')::int,min_nights),cleaning_buffer_days=coalesce((p_data->>'cleaningBufferDays')::int,cleaning_buffer_days),check_in_time=coalesce((p_data->>'checkInTime')::time,check_in_time),check_out_time=coalesce((p_data->>'checkOutTime')::time,check_out_time),bedrooms=coalesce((p_data->>'bedrooms')::int,bedrooms),beds=coalesce((p_data->>'beds')::int,beds),bathrooms=coalesce((p_data->>'bathrooms')::numeric,bathrooms),max_guests=coalesce((p_data->>'maxGuests')::int,max_guests),cancellation_policy_version_id=coalesce((p_data->>'cancellationPolicyVersionId')::uuid,cancellation_policy_version_id),version=version+1 WHERE id=target;
  END IF;
  IF p_data ? 'cancellationPolicyVersionId' AND NOT EXISTS(SELECT 1 FROM app.policy_versions WHERE id=(p_data->>'cancellationPolicyVersionId')::uuid AND policy_type='cancellation' AND approved_at IS NOT NULL) THEN RAISE EXCEPTION 'APPROVED_POLICY_REQUIRED';END IF;
  IF p_data ? 'amenityIds' THEN
   DELETE FROM app.apartment_amenities WHERE apartment_id=target;
   INSERT INTO app.apartment_amenities(apartment_id,amenity_id) SELECT target,value::uuid FROM jsonb_array_elements_text(p_data->'amenityIds') ON CONFLICT DO NOTHING;
  END IF;
  IF p_data ? 'cleaningFeeMinor' THEN
   DELETE FROM app.apartment_fee_rules WHERE apartment_id=target AND kind='cleaning';
   INSERT INTO app.apartment_fee_rules(apartment_id,kind,amount,currency,calculation_unit,refundable) SELECT target,'cleaning',(p_data->>'cleaningFeeMinor')::bigint,currency,'stay',false FROM app.apartments WHERE id=target;
  END IF;
  IF p_data ? 'locale' THEN INSERT INTO app.apartment_translations(apartment_id,locale,slug,title,description,house_rules) VALUES(target,p_data->>'locale',p_data->>'slug',p_data->>'title',p_data->>'description',coalesce(p_data->'houseRules','[]'))
   ON CONFLICT(apartment_id,locale) DO UPDATE SET slug=EXCLUDED.slug,title=EXCLUDED.title,description=EXCLUDED.description,house_rules=EXCLUDED.house_rules,approved_at=NULL; END IF;
 ELSIF p_kind='resources' THEN
  IF NOT EXISTS(SELECT 1 FROM app.staff_scopes WHERE staff_id=p_actor AND scope_type='all') THEN RAISE EXCEPTION 'SCOPE_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF p_data ? 'metadata' AND (jsonb_typeof(p_data->'metadata')<>'object' OR coalesce((p_data->'metadata'->>'seats')::int,0) NOT BETWEEN 1 AND 500 OR coalesce((p_data->'metadata'->>'luggage')::int,-1) NOT BETWEEN 0 AND 500) THEN RAISE EXCEPTION 'INVALID_VEHICLE_CAPACITY';END IF;
  IF p_id IS NULL AND p_data->>'kind'='vehicle' AND NOT p_data ? 'metadata' THEN RAISE EXCEPTION 'VEHICLE_CAPACITY_REQUIRED';END IF;
  IF p_id IS NULL THEN INSERT INTO app.resources(id,kind,code,name,mode,capacity) VALUES(target,p_data->>'kind',p_data->>'code',p_data->>'name',p_data->>'mode',(p_data->>'capacity')::int);
  ELSE
   IF (p_data ? 'kind' AND p_data->>'kind'<>existing->>'kind') OR (p_data ? 'code' AND p_data->>'code'<>existing->>'code') THEN RAISE EXCEPTION 'RESOURCE_IDENTITY_IMMUTABLE';END IF;
   IF EXISTS(SELECT 1 FROM app.resource_occupancy WHERE resource_id=target AND released_at IS NULL) AND (
    (p_data ? 'mode' AND p_data->>'mode'<>existing->>'mode') OR
    (p_data ? 'capacity' AND (p_data->>'capacity')::int<>(existing->>'capacity')::int) OR
    (p_data ? 'metadata' AND p_data->'metadata' IS DISTINCT FROM (SELECT metadata FROM app.resource_details WHERE resource_id=target)) OR
    (p_data ? 'active' AND NOT (p_data->>'active')::boolean)
   ) THEN RAISE EXCEPTION 'RESOURCE_IN_USE'; END IF;
   UPDATE app.resources SET name=coalesce(p_data->>'name',name),mode=coalesce(p_data->>'mode',mode),capacity=coalesce((p_data->>'capacity')::int,capacity),active=coalesce((p_data->>'active')::boolean,active),version=version+1 WHERE id=target;
  END IF;
  IF p_data ? 'metadata' THEN INSERT INTO app.resource_details(resource_id,metadata) VALUES(target,p_data->'metadata') ON CONFLICT(resource_id) DO UPDATE SET metadata=EXCLUDED.metadata;END IF;
 ELSIF p_kind='galleries' THEN
  scoped_book:=coalesce((p_data->>'bookingId')::uuid,(existing->>'booking_id')::uuid);
  PERFORM app.assert_staff(p_actor,'galleries.manage',scoped_book);
  IF scoped_book IS NULL AND NOT app.scope_allows(p_actor,(p_data->>'destinationId')::uuid,NULL) THEN RAISE EXCEPTION 'SCOPE_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF p_id IS NULL THEN INSERT INTO app.galleries(id,kind,booking_id,title,destination_id,expires_at,assigned_photographer_id) VALUES(target,p_data->>'kind',scoped_book,p_data->>'title',(p_data->>'destinationId')::uuid,(p_data->>'expiresAt')::timestamptz,(p_data->>'assignedPhotographerId')::uuid);
  ELSE
   IF scoped_book IS DISTINCT FROM (existing->>'booking_id')::uuid THEN RAISE EXCEPTION 'PARENT_CHANGE_FORBIDDEN'; END IF;
   UPDATE app.galleries SET title=coalesce(p_data->>'title',title),expires_at=coalesce((p_data->>'expiresAt')::timestamptz,expires_at),version=version+1 WHERE id=target;
  END IF;
 ELSIF p_kind='pages' THEN
  IF NOT EXISTS(SELECT 1 FROM app.staff_scopes WHERE staff_id=p_actor AND scope_type='all') THEN RAISE EXCEPTION 'SCOPE_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF p_id IS NULL THEN INSERT INTO app.cms_pages(id,page_key) VALUES(target,p_data->>'pageKey'); ELSE UPDATE app.cms_pages SET status='draft',version=version+1 WHERE id=target; END IF;
  INSERT INTO app.cms_translations(page_id,locale,slug,title,structured_body) VALUES(target,p_data->>'locale',p_data->>'slug',p_data->>'title',p_data->'body')
  ON CONFLICT(page_id,locale) DO UPDATE SET slug=EXCLUDED.slug,title=EXCLUDED.title,structured_body=EXCLUDED.structured_body,approved_at=NULL,approved_by=NULL,version=app.cms_translations.version+1;
 ELSIF p_kind='prices' THEN
  parent:=(p_data->>'variantId')::uuid;SELECT s.destination_id INTO destination FROM app.service_variants v JOIN app.services s ON s.id=v.service_id WHERE v.id=parent;
  IF NOT app.scope_allows(p_actor,destination,NULL) THEN RAISE EXCEPTION 'SCOPE_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF p_id IS NOT NULL THEN RAISE EXCEPTION 'CREATE_NEW_PRICE_VERSION'; END IF;
  INSERT INTO app.price_rules(id,variant_id,guest_category,effective_range,currency,amount,priority) VALUES(target,parent,p_data->>'guestCategory',daterange((p_data->>'from')::date,(p_data->>'to')::date,'[)'),p_data->>'currency',(p_data->>'amountMinor')::bigint,(p_data->>'priority')::int);
  SELECT to_jsonb(t) INTO result FROM app.price_rules t WHERE id=target;
 ELSIF p_kind='apartment_rates' THEN
  parent:=(p_data->>'apartmentId')::uuid;SELECT a.property_id,p.destination_id INTO property,destination FROM app.apartments a JOIN app.properties p ON p.id=a.property_id WHERE a.id=parent;
  IF NOT app.scope_allows(p_actor,destination,property) THEN RAISE EXCEPTION 'SCOPE_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF p_id IS NOT NULL THEN RAISE EXCEPTION 'CREATE_NEW_PRICE_VERSION'; END IF;
  INSERT INTO app.apartment_rate_rules(id,apartment_id,date_range,amount,currency,min_nights,priority) VALUES(target,parent,daterange((p_data->>'from')::date,(p_data->>'to')::date,'[)'),(p_data->>'amountMinor')::bigint,p_data->>'currency',coalesce((p_data->>'minNights')::int,1),(p_data->>'priority')::int);
  SELECT to_jsonb(t) INTO result FROM app.apartment_rate_rules t WHERE id=target;
 ELSIF p_kind='payment_policy_bindings' THEN
  parent:=(p_data->>'variantId')::uuid;SELECT s.destination_id INTO destination FROM app.service_variants v JOIN app.services s ON s.id=v.service_id WHERE v.id=parent;
  IF NOT app.scope_allows(p_actor,destination,NULL) THEN RAISE EXCEPTION 'SCOPE_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM app.payment_policies WHERE id=(p_data->>'policyId')::uuid AND approved_at IS NOT NULL) THEN RAISE EXCEPTION 'APPROVED_POLICY_REQUIRED'; END IF;
  INSERT INTO app.variant_payment_policies VALUES(parent,(p_data->>'policyId')::uuid) ON CONFLICT DO NOTHING;result:=jsonb_build_object('variantId',parent,'policyId',p_data->>'policyId');
 ELSIF p_kind='social_links' THEN
  IF NOT EXISTS(SELECT 1 FROM app.staff_scopes WHERE staff_id=p_actor AND scope_type='all') THEN RAISE EXCEPTION 'SCOPE_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF p_id IS NULL THEN INSERT INTO app.social_links(id,platform,url,active) VALUES(target,p_data->>'platform',p_data->>'url',false);ELSE UPDATE app.social_links SET url=p_data->>'url',active=false,verified_at=NULL,verified_by=NULL,version=version+1 WHERE id=target;END IF;
 ELSIF p_kind='staff' THEN
  IF NOT EXISTS(SELECT 1 FROM app.staff_roles sr JOIN app.roles r ON r.id=sr.role_id WHERE sr.staff_id=p_actor AND r.code='owner') THEN RAISE EXCEPTION 'OWNER_REQUIRED' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM app.staff_scopes WHERE staff_id=p_actor AND scope_type='all') THEN RAISE EXCEPTION 'SCOPE_FORBIDDEN' USING ERRCODE='42501';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('staff-owner-invariant',0));
  IF p_id IS NOT NULL AND EXISTS(SELECT 1 FROM app.staff_profiles sp JOIN app.staff_roles sr ON sr.staff_id=sp.id JOIN app.roles rr ON rr.id=sr.role_id WHERE sp.id=target AND sp.active AND sp.revoked_at IS NULL AND rr.code='owner')
   AND ((p_data->>'active')::boolean=false OR(p_data ? 'roles' AND NOT p_data->'roles' ? 'owner') OR(p_data ? 'scopes' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_data->'scopes') sc WHERE coalesce(sc->>'type',sc->>'scopeType')='all')))
   AND NOT EXISTS(SELECT 1 FROM app.staff_profiles sp JOIN app.staff_roles sr ON sr.staff_id=sp.id JOIN app.roles rr ON rr.id=sr.role_id JOIN app.staff_scopes sc ON sc.staff_id=sp.id AND sc.scope_type='all' WHERE sp.id<>target AND sp.active AND sp.revoked_at IS NULL AND rr.code='owner') THEN RAISE EXCEPTION 'LAST_ACTIVE_OWNER';END IF;
  IF p_id IS NULL THEN target:=(p_data->>'authUserId')::uuid;INSERT INTO app.staff_profiles(id,name,active) VALUES(target,p_data->>'name',false);
  ELSE UPDATE app.staff_profiles SET active=coalesce((p_data->>'active')::boolean,active),revoked_at=CASE WHEN (p_data->>'active')::boolean=false THEN clock_timestamp() WHEN (p_data->>'active')::boolean=true THEN NULL ELSE revoked_at END,version=version+1 WHERE id=target;END IF;
  IF p_data ? 'roles' THEN DELETE FROM app.staff_roles WHERE staff_id=target;INSERT INTO app.staff_roles(staff_id,role_id,granted_by) SELECT target,r.id,p_actor FROM jsonb_array_elements_text(p_data->'roles') x JOIN app.roles r ON r.code=x;END IF;
  IF p_data ? 'scopes' THEN DELETE FROM app.staff_scopes WHERE staff_id=target;INSERT INTO app.staff_scopes(staff_id,scope_type,destination_id,property_id) SELECT target,coalesce(x->>'type',x->>'scopeType'),(x->>'destinationId')::uuid,(x->>'propertyId')::uuid FROM jsonb_array_elements(p_data->'scopes') x;END IF;
  UPDATE app.local_operator_sessions SET revoked_at=clock_timestamp() WHERE staff_id=target AND revoked_at IS NULL;
 ELSIF p_kind='settings' THEN
  SELECT * INTO setting FROM app.agency_settings WHERE id FOR UPDATE;
  IF p_expected IS DISTINCT FROM setting.version THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  IF coalesce((p_data->>'bookingEnabled')::boolean,false) AND setting.content_approved_at IS NULL THEN RAISE EXCEPTION 'BUSINESS_APPROVAL_REQUIRED'; END IF;
  UPDATE app.agency_settings SET display_name=coalesce(p_data->>'displayName',display_name),legal_name=coalesce(p_data->>'legalName',legal_name),contact_channels=coalesce(p_data->'contactChannels',contact_channels),booking_enabled=coalesce((p_data->>'bookingEnabled')::boolean,booking_enabled),version=version+1 WHERE id RETURNING to_jsonb(app.agency_settings.*) INTO result;
 ELSIF p_kind='pickups' THEN
  parent:=(p_data->>'bookingItemId')::uuid;SELECT booking_id INTO scoped_book FROM app.booking_items WHERE id=parent;PERFORM app.assert_staff(p_actor,'operations.write',scoped_book);
  INSERT INTO app.pickup_assignments(id,booking_item_id,address_snapshot,pickup_at,vehicle_resource_id,driver_resource_id,instructions) VALUES(target,parent,p_data->>'address',(p_data->>'pickupAt')::timestamptz,(p_data->>'vehicleId')::uuid,(p_data->>'driverId')::uuid,p_data->>'instructions');
  SELECT to_jsonb(t) INTO result FROM app.pickup_assignments t WHERE id=target;
 ELSIF p_kind='dive_clearance' THEN
  parent:=(p_data->>'participantId')::uuid;SELECT booking_id INTO scoped_book FROM app.booking_participants WHERE id=parent;PERFORM app.assert_staff(p_actor,'operations.write',scoped_book);
  INSERT INTO app.dive_requirements(participant_id,certification,experience,equipment_sizes,clearance_status) VALUES(parent,p_data->>'certification',coalesce(p_data->'experience','{}'),coalesce(p_data->'equipmentSizes','{}'),p_data->>'clearanceStatus')
  ON CONFLICT(participant_id) DO UPDATE SET certification=EXCLUDED.certification,experience=EXCLUDED.experience,equipment_sizes=EXCLUDED.equipment_sizes,clearance_status=EXCLUDED.clearance_status;
  SELECT to_jsonb(t) INTO result FROM app.dive_requirements t WHERE participant_id=parent;
 END IF;
 IF allowed IS NOT NULL THEN EXECUTE format('SELECT to_jsonb(t) FROM app.%I t WHERE id=$1',allowed) INTO result USING target; END IF;
 INSERT INTO app.audit_events(actor_type,actor_id,action,target_type,target_id,summary) VALUES('staff',p_actor,CASE WHEN p_id IS NULL THEN 'created' ELSE 'updated' END,p_kind,target,jsonb_build_object('version',result->'version','fields',ARRAY(SELECT jsonb_object_keys(p_data))));
 RETURN app.money_json(result);
END $$;
