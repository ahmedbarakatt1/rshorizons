-- Synthetic development catalog only. This file refuses production in db-seed.mjs.
-- No operator passwords, published reviews, real customer identity, or business claims.
-- Reference data is installed by the production migrations.
INSERT INTO app.destinations(id,canonical_slug) SELECT md5('destination:'||slug)::uuid,slug FROM unnest(ARRAY['marsa-alam','al-qusair','hurghada','port-ghalib']) slug ON CONFLICT DO NOTHING;
INSERT INTO app.destination_translations(destination_id,locale,title,slug,description,approved_at)
SELECT d.id,l.code,CASE d.canonical_slug WHEN 'marsa-alam' THEN 'Marsa Alam' WHEN 'al-qusair' THEN 'Al-Qusair' WHEN 'hurghada' THEN 'Hurghada' ELSE 'Port Ghalib' END,d.canonical_slug,'Synthetic destination content for development preview. Operator translations await approval.',now()
FROM app.destinations d CROSS JOIN app.locales l ON CONFLICT DO NOTHING;
INSERT INTO app.categories(id,code,sort_order)
SELECT md5('category:'||code)::uuid,code,n FROM unnest(ARRAY['tours','boat_tours','scuba_diving','shore_dives','snorkeling','desert_safari','beach_buggy','transportation','photography']) WITH ORDINALITY c(code,n) ON CONFLICT DO NOTHING;
INSERT INTO app.category_translations(category_id,locale,label,description) SELECT c.id,l.code,replace(initcap(c.code),'_',' '),'Synthetic catalog category' FROM app.categories c CROSS JOIN app.locales l ON CONFLICT DO NOTHING;
INSERT INTO app.policy_versions(id,policy_type,version,locale,body,approved_at,effective_at)
SELECT md5('policy:'||p||':'||l.code)::uuid,p,'demo-v1',l.code,'Development policy fixture. Not an agency-approved production policy.',now(),now() FROM unnest(ARRAY['terms','privacy','cancellation']) p CROSS JOIN app.locales l ON CONFLICT DO NOTHING;
INSERT INTO app.payment_policies(id,code,version,type,deposit_mode,deposit_value,hold_minutes,approved_at,synthetic)
SELECT md5('payment:'||p)::uuid,'demo-'||p,1,p,CASE WHEN p='deposit' THEN 'basis_points' END,CASE WHEN p='deposit' THEN 3000 ELSE 0 END,60,now(),true FROM unnest(ARRAY['full','deposit','arrival']) p ON CONFLICT DO NOTHING;
INSERT INTO app.services(id,category_id,destination_id,status,duration_minutes,cancellation_policy_version_id,synthetic)
SELECT md5('service:'||c.code)::uuid,c.id,md5('destination:'||CASE WHEN c.code IN('transportation','photography') THEN 'port-ghalib' WHEN c.code IN('desert_safari','beach_buggy') THEN 'hurghada' WHEN c.code='shore_dives' THEN 'al-qusair' ELSE 'marsa-alam' END)::uuid,'published',CASE WHEN c.code='photography' THEN 90 ELSE 240 END,md5('policy:cancellation:en')::uuid,true FROM app.categories c ON CONFLICT DO NOTHING;
INSERT INTO app.service_translations(service_id,locale,slug,title,summary,itinerary,inclusions,exclusions,restrictions,meeting_notes,approved_at)
SELECT s.id,l.code,replace(c.code,'_','-'),CASE c.code WHEN 'tours' THEN 'Red Sea discovery' WHEN 'boat_tours' THEN 'Day on the open sea' WHEN 'scuba_diving' THEN 'Explore beneath the surface' WHEN 'shore_dives' THEN 'Shore dive discovery' WHEN 'snorkeling' THEN 'Reef snorkeling' WHEN 'desert_safari' THEN 'Desert at golden hour' WHEN 'beach_buggy' THEN 'Coastal buggy trail' WHEN 'transportation' THEN 'Private Red Sea transfer' ELSE 'Underwater photography session' END,'Development preview. Details, prices and operating requirements require agency approval.','["Meet the team","Activity briefing","Guided experience","Return"]','["Guide as described in the approved offer"]','["Items outside the accepted quote"]','{"operatorApprovalRequired":true}','Pickup is arranged after staff approval.',now()
FROM app.services s JOIN app.categories c ON c.id=s.category_id CROSS JOIN app.locales l ON CONFLICT DO NOTHING;
INSERT INTO app.service_variants(id,service_id,variant_code,capacity_model,pricing_unit,duration_minutes)
SELECT md5('variant:'||c.code)::uuid,s.id,'standard',CASE WHEN c.code IN('transportation','photography') THEN 'exclusive' ELSE 'departure' END,CASE WHEN c.code IN('transportation','photography') THEN 'booking' ELSE 'person' END,s.duration_minutes FROM app.services s JOIN app.categories c ON c.id=s.category_id ON CONFLICT DO NOTHING;
INSERT INTO app.variant_translations(variant_id,locale,title,description,approved_at) SELECT v.id,l.code,'Standard experience','Development fixture',now() FROM app.service_variants v CROSS JOIN app.locales l ON CONFLICT DO NOTHING;
INSERT INTO app.price_rules(id,variant_id,guest_category,effective_range,currency,amount,priority)
SELECT md5(v.id::text||':'||cat)::uuid,v.id,cat,daterange(current_date,current_date+730,'[)'),'EGP',CASE WHEN cat='child' THEN 60000 ELSE 100000 END,0 FROM app.service_variants v CROSS JOIN unnest(ARRAY['adult','child']) cat ON CONFLICT DO NOTHING;
INSERT INTO app.variant_payment_policies(variant_id,policy_id) SELECT v.id,p.id FROM app.service_variants v CROSS JOIN app.payment_policies p WHERE p.synthetic ON CONFLICT DO NOTHING;
INSERT INTO app.departures(id,variant_id,starts_at,ends_at,seat_capacity,status,cutoff_at)
SELECT md5(v.id::text||':'||n)::uuid,v.id,((current_date+n)+time '09:00') AT TIME ZONE 'Africa/Cairo',((current_date+n)+time '13:00') AT TIME ZONE 'Africa/Cairo',12,'scheduled',((current_date+n)+time '07:00') AT TIME ZONE 'Africa/Cairo'
FROM app.service_variants v CROSS JOIN generate_series(7,21,7) n WHERE v.capacity_model='departure' ON CONFLICT DO NOTHING;
INSERT INTO app.resources(id,kind,code,name,mode,capacity) VALUES
(md5('resource:boat')::uuid,'boat','demo-boat','Synthetic tour boat','exclusive',1),
(md5('resource:vehicle')::uuid,'vehicle','demo-vehicle','Synthetic passenger vehicle','exclusive',1),
(md5('resource:photographer')::uuid,'photographer','demo-photographer','Synthetic photographer schedule','exclusive',1),
(md5('resource:equipment')::uuid,'equipment','demo-equipment','Synthetic mask equipment pool','shared',20) ON CONFLICT DO NOTHING;
INSERT INTO app.resource_details(resource_id,metadata) VALUES(md5('resource:vehicle')::uuid,'{"seats":6,"luggage":6}'),(md5('resource:equipment')::uuid,'{"size":"mixed","sanitizationRequired":true}') ON CONFLICT DO NOTHING;
INSERT INTO app.properties(id,destination_id,name,address) VALUES(md5('property:port-ghalib')::uuid,md5('destination:port-ghalib')::uuid,'Port Ghalib demonstration property','Synthetic address; actual address pending operator approval') ON CONFLICT DO NOTHING;
INSERT INTO app.apartments(id,property_id,unit_code,bedrooms,beds,bathrooms,max_guests,default_rate,currency,min_nights,synthetic)
SELECT md5('apartment:'||n)::uuid,md5('property:port-ghalib')::uuid,'DEMO-'||n,n,2*n,1,2*n,150000*n,'EGP',2,true FROM generate_series(1,3) n ON CONFLICT DO NOTHING;
INSERT INTO app.apartment_translations(apartment_id,locale,slug,title,description,house_rules,approved_at)
SELECT a.id,l.code,lower(a.unit_code),CASE a.unit_code WHEN 'DEMO-1' THEN 'Marina studio' WHEN 'DEMO-2' THEN 'Harbour apartment' ELSE 'Family coastal residence' END,'Synthetic unit for development preview. Agency must approve actual unit details and photographs.','["Agency-managed physical unit","No booking is confirmed until staff approval"]',now() FROM app.apartments a CROSS JOIN app.locales l ON CONFLICT DO NOTHING;
INSERT INTO app.apartment_payment_policies(apartment_id,policy_id) SELECT a.id,p.id FROM app.apartments a CROSS JOIN app.payment_policies p WHERE p.type IN('full','deposit') ON CONFLICT DO NOTHING;
INSERT INTO app.apartment_fee_rules(id,apartment_id,kind,amount,currency,calculation_unit) SELECT md5(a.id::text||':cleaning')::uuid,a.id,'cleaning',25000,'EGP','stay' FROM app.apartments a ON CONFLICT DO NOTHING;
INSERT INTO app.amenities(id,code) SELECT md5('amenity:'||code)::uuid,code FROM unnest(ARRAY['wifi','kitchen','air_conditioning']) code ON CONFLICT DO NOTHING;
INSERT INTO app.amenity_translations(amenity_id,locale,label) SELECT a.id,l.code,replace(initcap(a.code),'_',' ') FROM app.amenities a CROSS JOIN app.locales l ON CONFLICT DO NOTHING;
INSERT INTO app.apartment_amenities SELECT a.id,m.id FROM app.apartments a CROSS JOIN app.amenities m ON CONFLICT DO NOTHING;
INSERT INTO app.service_addons(parent_service_id,addon_variant_id,pricing_unit,min_quantity,max_quantity) VALUES(md5('service:boat_tours')::uuid,md5('variant:photography')::uuid,'booking',1,1) ON CONFLICT DO NOTHING;
INSERT INTO app.photo_packages(code,entitlement_rules,price_amount,currency,active)
VALUES('demo-standard','{"previews":true,"downloads":5}',50000,'EGP',true) ON CONFLICT DO NOTHING;

-- Synthetic shared transfer: separate from the private variant. One departure
-- owns the vehicle and driver; individual requests consume seats after approval.
INSERT INTO app.service_variants(id,service_id,variant_code,capacity_model,pricing_unit,duration_minutes)
VALUES(md5('variant:transportation:shared')::uuid,md5('service:transportation')::uuid,'shared','shared','person',240) ON CONFLICT DO NOTHING;
INSERT INTO app.variant_translations(variant_id,locale,title,description,approved_at)
SELECT md5('variant:transportation:shared')::uuid,code,'Shared transfer — development fixture','Synthetic shared departure. Actual route, price and operating terms require agency approval.',now() FROM app.locales ON CONFLICT DO NOTHING;
INSERT INTO app.price_rules(id,variant_id,guest_category,effective_range,currency,amount,priority)
VALUES(md5('price:transportation:shared')::uuid,md5('variant:transportation:shared')::uuid,'all',daterange(current_date,current_date+730,'[)'),'EGP',50000,0) ON CONFLICT DO NOTHING;
INSERT INTO app.variant_payment_policies(variant_id,policy_id)
SELECT md5('variant:transportation:shared')::uuid,id FROM app.payment_policies WHERE synthetic ON CONFLICT DO NOTHING;
INSERT INTO app.departures(id,variant_id,starts_at,ends_at,seat_capacity,status,cutoff_at)
SELECT md5('departure:transportation:shared:'||n)::uuid,md5('variant:transportation:shared')::uuid,((current_date+n)+time '09:00') AT TIME ZONE 'Africa/Cairo',((current_date+n)+time '13:00') AT TIME ZONE 'Africa/Cairo',6,'scheduled',((current_date+n)+time '07:00') AT TIME ZONE 'Africa/Cairo'
FROM generate_series(7,21,7) n ON CONFLICT DO NOTHING;
INSERT INTO app.resources(id,kind,code,name,mode,capacity) VALUES
(md5('resource:shared-transfer:vehicle')::uuid,'vehicle','demo-shared-transfer-vehicle','Synthetic shared transfer vehicle','exclusive',1),
(md5('resource:shared-transfer:driver')::uuid,'driver','demo-shared-transfer-driver','Synthetic shared transfer driver','exclusive',1) ON CONFLICT DO NOTHING;
INSERT INTO app.resource_details(resource_id,metadata) VALUES
(md5('resource:shared-transfer:vehicle')::uuid,'{"seats":6,"luggage":6,"vehicleKind":"van"}') ON CONFLICT DO NOTHING;
INSERT INTO app.resource_occupancy(id,resource_id,departure_id,time_range,quantity,exclusive)
SELECT md5(d.id::text||r.id::text)::uuid,r.id,d.id,tstzrange(d.starts_at-interval '30 minutes',d.ends_at+interval '30 minutes','[)'),1,true
FROM app.departures d CROSS JOIN app.resources r WHERE d.variant_id=md5('variant:transportation:shared')::uuid AND r.code IN('demo-shared-transfer-vehicle','demo-shared-transfer-driver')
ON CONFLICT DO NOTHING;
INSERT INTO app.departure_resources(departure_id,resource_id,quantity,role)
SELECT d.id,r.id,1,r.kind FROM app.departures d CROSS JOIN app.resources r WHERE d.variant_id=md5('variant:transportation:shared')::uuid AND r.code IN('demo-shared-transfer-vehicle','demo-shared-transfer-driver')
ON CONFLICT DO NOTHING;
