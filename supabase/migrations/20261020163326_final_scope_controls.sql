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
   INSERT INTO app.apartments(id,property_id,unit_code,bedrooms,beds,bathrooms,max_guests,default_rate,currency,min_nights,cleaning_buffer_days)
   VALUES(target,property,p_data->>'unitCode',(p_data->>'bedrooms')::int,(p_data->>'beds')::int,(p_data->>'bathrooms')::numeric,(p_data->>'maxGuests')::int,(p_data->>'nightlyAmountMinor')::bigint,p_data->>'currency',coalesce((p_data->>'minNights')::int,1),coalesce((p_data->>'cleaningBufferDays')::int,0));
  ELSE
   IF property<>(existing->>'property_id')::uuid THEN RAISE EXCEPTION 'PARENT_CHANGE_FORBIDDEN'; END IF;
   UPDATE app.apartments SET default_rate=coalesce((p_data->>'nightlyAmountMinor')::bigint,default_rate),min_nights=coalesce((p_data->>'minNights')::int,min_nights),version=version+1 WHERE id=target;
  END IF;
  IF p_data ? 'locale' THEN INSERT INTO app.apartment_translations(apartment_id,locale,slug,title,description,house_rules) VALUES(target,p_data->>'locale',p_data->>'slug',p_data->>'title',p_data->>'description',coalesce(p_data->'houseRules','[]'))
   ON CONFLICT(apartment_id,locale) DO UPDATE SET slug=EXCLUDED.slug,title=EXCLUDED.title,description=EXCLUDED.description,house_rules=EXCLUDED.house_rules,approved_at=NULL; END IF;
 ELSIF p_kind='resources' THEN
  IF NOT EXISTS(SELECT 1 FROM app.staff_scopes WHERE staff_id=p_actor AND scope_type='all') THEN RAISE EXCEPTION 'SCOPE_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF p_id IS NULL THEN INSERT INTO app.resources(id,kind,code,name,mode,capacity) VALUES(target,p_data->>'kind',p_data->>'code',p_data->>'name',p_data->>'mode',(p_data->>'capacity')::int);
  ELSE
   IF EXISTS(SELECT 1 FROM app.resource_occupancy WHERE resource_id=target AND released_at IS NULL) AND (p_data ? 'mode' OR p_data ? 'capacity') THEN RAISE EXCEPTION 'RESOURCE_IN_USE'; END IF;
   UPDATE app.resources SET name=coalesce(p_data->>'name',name),active=coalesce((p_data->>'active')::boolean,active),version=version+1 WHERE id=target;
  END IF;
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
CREATE OR REPLACE FUNCTION app.retry_job(p_job uuid,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE j app.jobs; booking uuid;
BEGIN
 SELECT * INTO j FROM app.jobs WHERE id=p_job FOR UPDATE;
 IF j.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 SELECT CASE WHEN aggregate_type='booking' THEN aggregate_id ELSE (payload->>'bookingId')::uuid END INTO booking FROM app.outbox_events WHERE id=j.event_id;
 PERFORM app.assert_staff(p_actor,'notifications.retry',booking);
 IF booking IS NULL AND NOT app.scope_allows(p_actor,NULL,NULL) THEN RAISE EXCEPTION 'SCOPE_FORBIDDEN' USING ERRCODE='42501';END IF;
 IF booking IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.bookings WHERE id=booking) THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 IF j.status NOT IN('failed','dead') OR j.lease_until>clock_timestamp() THEN RAISE EXCEPTION 'JOB_NOT_RETRYABLE';END IF;
 UPDATE app.jobs SET status='pending',attempts=0,run_after=clock_timestamp(),lease_owner=NULL,lease_until=NULL,failure_class=NULL WHERE id=j.id RETURNING * INTO j;
 INSERT INTO app.audit_events(actor_type,actor_id,action,target_type,target_id) VALUES('staff',p_actor,'job_retried','job',j.id);RETURN to_jsonb(j);
END $$;
CREATE OR REPLACE FUNCTION app.staff_config_edit(p_kind text,p_id uuid,p_expected integer,p_data jsonb,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
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
CREATE OR REPLACE FUNCTION app.invite_staff(p_identity uuid,p_email text,p_name text,p_roles text[],p_scopes jsonb,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE result jsonb;
BEGIN
 PERFORM app.assert_staff(p_actor,'staff.manage');
 IF NOT EXISTS(SELECT 1 FROM app.staff_roles sr JOIN app.roles r ON r.id=sr.role_id WHERE sr.staff_id=p_actor AND r.code='owner') OR NOT app.scope_allows(p_actor,NULL,NULL) THEN RAISE EXCEPTION 'OWNER_REQUIRED' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_identity AND lower(email)=lower(p_email)) THEN RAISE EXCEPTION 'INVITED_AUTH_IDENTITY_REQUIRED';END IF;
 IF coalesce(cardinality(p_roles),0)=0 OR EXISTS(SELECT 1 FROM unnest(p_roles) AS requested(code) WHERE NOT EXISTS(SELECT 1 FROM app.roles r WHERE r.code=requested.code)) THEN RAISE EXCEPTION 'INVALID_ROLES';END IF;
 IF jsonb_typeof(p_scopes)<>'array' OR jsonb_array_length(p_scopes)=0 THEN RAISE EXCEPTION 'INVALID_SCOPES';END IF;
 result:=app.staff_edit('staff',NULL,NULL,jsonb_build_object('authUserId',p_identity,'name',p_name,'roles',to_jsonb(p_roles),'scopes',p_scopes),p_actor);
 RETURN result||jsonb_build_object('invitationState','pending_activation');
END $$;