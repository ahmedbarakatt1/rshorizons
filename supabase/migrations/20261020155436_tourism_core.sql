-- Authoritative SQL source assembled into an ordered migration after review.
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS app;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
CREATE SCHEMA IF NOT EXISTS auth;
-- Only the isolated PostgreSQL harness lacks Supabase Auth. No password identity is seeded.
-- Supabase's migration operator cannot CREATE in its managed auth schema, even with IF NOT EXISTS.
DO $auth_harness$ BEGIN
 IF to_regclass('auth.users') IS NULL THEN
  CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, created_at timestamptz NOT NULL DEFAULT now());
 END IF;
END $auth_harness$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='tourism_app') THEN CREATE ROLE tourism_app NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF;
END $$;
CREATE FUNCTION app.deny_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'IMMUTABLE_RECORD' USING ERRCODE='55000'; END $$;
CREATE TABLE app.currencies(code text PRIMARY KEY CHECK(code ~ '^[A-Z]{3}$'), exponent smallint NOT NULL CHECK(exponent BETWEEN 0 AND 3),enabled_for_charge boolean NOT NULL DEFAULT false,enabled_for_display boolean NOT NULL DEFAULT true);
CREATE TABLE app.locales(code text PRIMARY KEY CHECK(code IN ('en','de','pl','fr','ru','uk','es','ar','it','nl')),direction text NOT NULL CHECK(direction IN ('ltr','rtl')),enabled boolean NOT NULL DEFAULT true);
CREATE TABLE app.staff_profiles(id uuid PRIMARY KEY REFERENCES auth.users(id),name text NOT NULL,active boolean NOT NULL DEFAULT false,revoked_at timestamptz,mfa_required boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE app.roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text NOT NULL UNIQUE,label text NOT NULL);
CREATE TABLE app.permissions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text NOT NULL UNIQUE,description text NOT NULL);
CREATE TABLE app.role_permissions(role_id uuid REFERENCES app.roles(id),permission_id uuid REFERENCES app.permissions(id),PRIMARY KEY(role_id,permission_id));
CREATE TABLE app.staff_roles(staff_id uuid REFERENCES app.staff_profiles(id),role_id uuid REFERENCES app.roles(id),granted_by uuid REFERENCES app.staff_profiles(id),granted_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(staff_id,role_id));
CREATE TABLE app.staff_permission_grants(staff_id uuid REFERENCES app.staff_profiles(id),permission_id uuid REFERENCES app.permissions(id),limit_amount bigint CHECK(limit_amount>=0),currency text REFERENCES app.currencies(code),PRIMARY KEY(staff_id,permission_id));
CREATE TABLE app.agency_settings(id boolean PRIMARY KEY DEFAULT true CHECK(id),display_name text,legal_name text,contact_channels jsonb NOT NULL DEFAULT '{}',timezone text NOT NULL DEFAULT 'Africa/Cairo' CHECK(timezone='Africa/Cairo'),default_locale text REFERENCES app.locales(code),default_currency text REFERENCES app.currencies(code),booking_enabled boolean NOT NULL DEFAULT false,content_approved_at timestamptz,version integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE app.guests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),full_name text NOT NULL,email text,phone_e164 text CHECK(phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),locale text NOT NULL REFERENCES app.locales(code),country_code text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),CHECK(email IS NOT NULL OR phone_e164 IS NOT NULL));
CREATE TABLE app.guest_accounts(auth_user_id uuid PRIMARY KEY REFERENCES auth.users(id),guest_id uuid NOT NULL UNIQUE REFERENCES app.guests(id),verified_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE app.guest_consents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),guest_id uuid NOT NULL REFERENCES app.guests(id),type text NOT NULL CHECK(type IN('terms','privacy','whatsapp_booking','marketing','public_media')),granted boolean NOT NULL,policy_version text NOT NULL,collection_source text NOT NULL,captured_at timestamptz NOT NULL DEFAULT now(),withdrawn_at timestamptz);
CREATE TABLE app.policy_versions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),policy_type text NOT NULL,version text NOT NULL,locale text NOT NULL REFERENCES app.locales(code),body text NOT NULL,approved_by uuid REFERENCES app.staff_profiles(id),approved_at timestamptz,effective_at timestamptz NOT NULL,UNIQUE(policy_type,version,locale));
CREATE TABLE app.audit_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_type text NOT NULL,actor_id uuid,action text NOT NULL,target_type text NOT NULL,target_id uuid,request_id text,summary jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE app.destinations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),canonical_slug text NOT NULL UNIQUE,active boolean NOT NULL DEFAULT true,latitude numeric,longitude numeric,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE app.destination_translations(destination_id uuid REFERENCES app.destinations(id),locale text REFERENCES app.locales(code),title text NOT NULL,slug text NOT NULL,description text NOT NULL,seo_title text,seo_description text,approved_at timestamptz,PRIMARY KEY(destination_id,locale),UNIQUE(locale,slug));
CREATE TABLE app.categories(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text NOT NULL UNIQUE,sort_order integer NOT NULL DEFAULT 0,active boolean NOT NULL DEFAULT true);
CREATE TABLE app.category_translations(category_id uuid REFERENCES app.categories(id),locale text REFERENCES app.locales(code),label text NOT NULL,description text NOT NULL DEFAULT '',PRIMARY KEY(category_id,locale));
CREATE TABLE app.services(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),category_id uuid NOT NULL REFERENCES app.categories(id),destination_id uuid NOT NULL REFERENCES app.destinations(id),status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','review','published','archived')),duration_minutes integer NOT NULL CHECK(duration_minutes>0),cutoff_minutes integer NOT NULL DEFAULT 60 CHECK(cutoff_minutes>=0),cancellation_policy_version_id uuid REFERENCES app.policy_versions(id),hero_asset_id uuid,synthetic boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),version integer NOT NULL DEFAULT 1);
CREATE TABLE app.service_translations(service_id uuid REFERENCES app.services(id),locale text REFERENCES app.locales(code),slug text NOT NULL,title text NOT NULL,summary text NOT NULL,itinerary jsonb NOT NULL DEFAULT '[]',inclusions jsonb NOT NULL DEFAULT '[]',exclusions jsonb NOT NULL DEFAULT '[]',restrictions jsonb NOT NULL DEFAULT '{}',meeting_notes text NOT NULL DEFAULT '',seo_title text,seo_description text,approved_at timestamptz,PRIMARY KEY(service_id,locale),UNIQUE(locale,slug));
CREATE TABLE app.service_variants(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),service_id uuid NOT NULL REFERENCES app.services(id),variant_code text NOT NULL,capacity_model text NOT NULL CHECK(capacity_model IN('departure','exclusive','shared','none')),pricing_unit text NOT NULL CHECK(pricing_unit IN('person','booking','night','quantity')),duration_minutes integer NOT NULL CHECK(duration_minutes>0),active boolean NOT NULL DEFAULT true,UNIQUE(service_id,variant_code));
CREATE TABLE app.variant_translations(variant_id uuid REFERENCES app.service_variants(id),locale text REFERENCES app.locales(code),title text NOT NULL,description text NOT NULL DEFAULT '',approved_at timestamptz,PRIMARY KEY(variant_id,locale));
CREATE TABLE app.price_rules(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),variant_id uuid NOT NULL REFERENCES app.service_variants(id),guest_category text NOT NULL CHECK(guest_category IN('adult','child','infant','all')),effective_range daterange NOT NULL CHECK(NOT isempty(effective_range) AND NOT lower_inf(effective_range) AND NOT upper_inf(effective_range)),currency text NOT NULL REFERENCES app.currencies(code),amount bigint NOT NULL CHECK(amount>=0),priority integer NOT NULL DEFAULT 0,EXCLUDE USING gist(variant_id WITH =,guest_category WITH =,currency WITH =,priority WITH =,effective_range WITH &&));
CREATE TABLE app.service_addons(parent_service_id uuid REFERENCES app.services(id),addon_variant_id uuid REFERENCES app.service_variants(id),pricing_unit text NOT NULL CHECK(pricing_unit IN('person','booking','quantity')),min_quantity integer NOT NULL DEFAULT 0,max_quantity integer NOT NULL CHECK(max_quantity>=min_quantity),required boolean NOT NULL DEFAULT false,active boolean NOT NULL DEFAULT true,PRIMARY KEY(parent_service_id,addon_variant_id));
CREATE TABLE app.payment_policies(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text NOT NULL,version integer NOT NULL,type text NOT NULL CHECK(type IN('full','deposit','arrival')),deposit_mode text CHECK(deposit_mode IN('fixed','basis_points')),deposit_value bigint NOT NULL DEFAULT 0 CHECK(deposit_value>=0),hold_minutes integer NOT NULL DEFAULT 60 CHECK(hold_minutes BETWEEN 1 AND 10080),balance_due_days integer NOT NULL DEFAULT 0,approved_by uuid REFERENCES app.staff_profiles(id),approved_at timestamptz,synthetic boolean NOT NULL DEFAULT false,UNIQUE(code,version),CHECK(type<>'deposit' OR deposit_mode IS NOT NULL),CHECK(deposit_mode<>'basis_points' OR deposit_value<=10000));
CREATE TABLE app.variant_payment_policies(variant_id uuid REFERENCES app.service_variants(id),policy_id uuid REFERENCES app.payment_policies(id),PRIMARY KEY(variant_id,policy_id));
CREATE TABLE app.pickup_locations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),destination_id uuid REFERENCES app.destinations(id),name text NOT NULL,address text NOT NULL,latitude numeric,longitude numeric,active boolean NOT NULL DEFAULT true);
CREATE TABLE app.variant_pickups(variant_id uuid REFERENCES app.service_variants(id),pickup_id uuid REFERENCES app.pickup_locations(id),surcharge bigint NOT NULL CHECK(surcharge>=0),currency text NOT NULL REFERENCES app.currencies(code),offset_minutes integer NOT NULL DEFAULT 0,PRIMARY KEY(variant_id,pickup_id));
CREATE TABLE app.exchange_rate_snapshots(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),base_currency text NOT NULL REFERENCES app.currencies(code),quote_currency text NOT NULL REFERENCES app.currencies(code),rate numeric(24,12) NOT NULL CHECK(rate>0),source text NOT NULL,observed_at timestamptz NOT NULL);
CREATE TABLE app.departures(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),variant_id uuid NOT NULL REFERENCES app.service_variants(id),starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,seat_capacity integer NOT NULL CHECK(seat_capacity>0),status text NOT NULL DEFAULT 'scheduled' CHECK(status IN('scheduled','closed','cancelled','completed')),cutoff_at timestamptz NOT NULL,CHECK(starts_at<ends_at),CHECK(cutoff_at<=starts_at),version integer NOT NULL DEFAULT 1);
CREATE TABLE app.resources(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text NOT NULL CHECK(kind IN('boat','vehicle','driver','guide','photographer','equipment')),code text NOT NULL UNIQUE,name text NOT NULL,mode text NOT NULL CHECK(mode IN('exclusive','shared')),capacity integer NOT NULL DEFAULT 1 CHECK(capacity>0),active boolean NOT NULL DEFAULT true);
CREATE TABLE app.resource_details(resource_id uuid PRIMARY KEY REFERENCES app.resources(id),metadata jsonb NOT NULL CHECK(jsonb_typeof(metadata)='object'));
CREATE TABLE app.departure_resources(departure_id uuid REFERENCES app.departures(id),resource_id uuid REFERENCES app.resources(id),quantity integer NOT NULL CHECK(quantity>0),role text NOT NULL,PRIMARY KEY(departure_id,resource_id,role));
CREATE TABLE app.properties(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),destination_id uuid NOT NULL REFERENCES app.destinations(id),name text NOT NULL,address text NOT NULL,latitude numeric,longitude numeric,active boolean NOT NULL DEFAULT true);
CREATE TABLE app.staff_scopes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),staff_id uuid NOT NULL REFERENCES app.staff_profiles(id),scope_type text NOT NULL CHECK(scope_type IN('all','destination','property')),destination_id uuid REFERENCES app.destinations(id),property_id uuid REFERENCES app.properties(id),CHECK((scope_type='all' AND destination_id IS NULL AND property_id IS NULL) OR (scope_type='destination' AND destination_id IS NOT NULL AND property_id IS NULL) OR (scope_type='property' AND property_id IS NOT NULL AND destination_id IS NULL)),UNIQUE NULLS NOT DISTINCT(staff_id,scope_type,destination_id,property_id));
CREATE TABLE app.apartments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),property_id uuid NOT NULL REFERENCES app.properties(id),unit_code text NOT NULL,status text NOT NULL DEFAULT 'active' CHECK(status IN('active','closed','archived')),bedrooms integer NOT NULL CHECK(bedrooms>=0),beds integer NOT NULL CHECK(beds>0),bathrooms numeric(4,1) NOT NULL CHECK(bathrooms>0),max_guests integer NOT NULL CHECK(max_guests>0),check_in_time time NOT NULL DEFAULT '15:00',check_out_time time NOT NULL DEFAULT '11:00',cleaning_buffer_days integer NOT NULL DEFAULT 0 CHECK(cleaning_buffer_days>=0),default_rate bigint NOT NULL CHECK(default_rate>=0),currency text NOT NULL REFERENCES app.currencies(code),min_nights integer NOT NULL DEFAULT 1 CHECK(min_nights>0),synthetic boolean NOT NULL DEFAULT false,version integer NOT NULL DEFAULT 1,UNIQUE(property_id,unit_code));
CREATE TABLE app.apartment_translations(apartment_id uuid REFERENCES app.apartments(id),locale text REFERENCES app.locales(code),slug text NOT NULL,title text NOT NULL,description text NOT NULL,house_rules jsonb NOT NULL DEFAULT '[]',seo_title text,seo_description text,approved_at timestamptz,PRIMARY KEY(apartment_id,locale),UNIQUE(locale,slug));
CREATE TABLE app.amenities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text NOT NULL UNIQUE);
CREATE TABLE app.amenity_translations(amenity_id uuid REFERENCES app.amenities(id),locale text REFERENCES app.locales(code),label text NOT NULL,PRIMARY KEY(amenity_id,locale));
CREATE TABLE app.apartment_amenities(apartment_id uuid REFERENCES app.apartments(id),amenity_id uuid REFERENCES app.amenities(id),PRIMARY KEY(apartment_id,amenity_id));
CREATE TABLE app.apartment_rate_rules(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),apartment_id uuid NOT NULL REFERENCES app.apartments(id),date_range daterange NOT NULL CHECK(NOT isempty(date_range) AND NOT lower_inf(date_range) AND NOT upper_inf(date_range)),amount bigint NOT NULL CHECK(amount>=0),currency text NOT NULL REFERENCES app.currencies(code),min_nights integer NOT NULL DEFAULT 1 CHECK(min_nights>0),priority integer NOT NULL DEFAULT 0,EXCLUDE USING gist(apartment_id WITH =,priority WITH =,date_range WITH &&));
CREATE TABLE app.apartment_fee_rules(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),apartment_id uuid NOT NULL REFERENCES app.apartments(id),kind text NOT NULL CHECK(kind IN('cleaning','service','security_deposit')),amount bigint NOT NULL CHECK(amount>=0),currency text NOT NULL REFERENCES app.currencies(code),calculation_unit text NOT NULL CHECK(calculation_unit IN('stay','night')),refundable boolean NOT NULL DEFAULT false);
CREATE TABLE app.apartment_payment_policies(apartment_id uuid REFERENCES app.apartments(id),policy_id uuid REFERENCES app.payment_policies(id),PRIMARY KEY(apartment_id,policy_id));
CREATE TABLE app.quotes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),binding_hash text NOT NULL,locale text NOT NULL REFERENCES app.locales(code),currency text NOT NULL REFERENCES app.currencies(code),subtotal bigint NOT NULL CHECK(subtotal>=0),fees bigint NOT NULL DEFAULT 0 CHECK(fees>=0),taxes bigint NOT NULL DEFAULT 0 CHECK(taxes>=0),discount bigint NOT NULL DEFAULT 0 CHECK(discount>=0),total bigint NOT NULL CHECK(total>=0),initial_due bigint NOT NULL CHECK(initial_due>=0),payment_policy_id uuid NOT NULL REFERENCES app.payment_policies(id),inputs_hash text NOT NULL,inputs jsonb NOT NULL,policy_snapshot jsonb NOT NULL,observed_at timestamptz NOT NULL DEFAULT now(),valid_until timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),CHECK(total=subtotal+fees+taxes-discount),CHECK(initial_due<=total));
CREATE TABLE app.quote_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),quote_id uuid NOT NULL REFERENCES app.quotes(id),position integer NOT NULL,kind text NOT NULL CHECK(kind IN('tour','stay','transfer','photography','addon')),variant_id uuid REFERENCES app.service_variants(id),departure_id uuid REFERENCES app.departures(id),apartment_id uuid REFERENCES app.apartments(id),parent_position integer,title text NOT NULL,quantity integer NOT NULL CHECK(quantity>0),total bigint NOT NULL CHECK(total>=0),initial_due bigint NOT NULL CHECK(initial_due>=0 AND initial_due<=total),snapshot jsonb NOT NULL,UNIQUE(quote_id,position),CHECK((kind='stay' AND apartment_id IS NOT NULL AND variant_id IS NULL) OR (kind<>'stay' AND variant_id IS NOT NULL AND apartment_id IS NULL)));
CREATE TABLE app.bookings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),reference text NOT NULL UNIQUE,primary_guest_id uuid NOT NULL REFERENCES app.guests(id),accepted_quote_id uuid NOT NULL UNIQUE REFERENCES app.quotes(id),status text NOT NULL DEFAULT 'pending_review' CHECK(status IN('pending_review','approved_pending_payment','confirmed','rejected','expired','cancelled','completed')),version integer NOT NULL DEFAULT 1 CHECK(version>0),currency text NOT NULL REFERENCES app.currencies(code),total_amount bigint NOT NULL CHECK(total_amount>=0),initial_due_amount bigint NOT NULL CHECK(initial_due_amount>=0 AND initial_due_amount<=total_amount),approved_by uuid REFERENCES app.staff_profiles(id),approved_at timestamptz,payment_deadline timestamptz,review_deadline timestamptz,price_snapshot jsonb NOT NULL,policy_snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),CHECK(status NOT IN('approved_pending_payment','confirmed','completed') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)));
CREATE TABLE app.booking_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),booking_id uuid NOT NULL REFERENCES app.bookings(id),quote_item_id uuid NOT NULL REFERENCES app.quote_items(id),kind text NOT NULL CHECK(kind IN('tour','stay','transfer','photography','addon')),parent_item_id uuid REFERENCES app.booking_items(id),title_snapshot text NOT NULL,quantity integer NOT NULL CHECK(quantity>0),total_amount bigint NOT NULL CHECK(total_amount>=0),fulfilment_state text NOT NULL DEFAULT 'scheduled' CHECK(fulfilment_state IN('scheduled','check_in','fulfilled','no_show','cancelled')),UNIQUE(id,booking_id));
CREATE TABLE app.tour_booking_items(booking_item_id uuid PRIMARY KEY REFERENCES app.booking_items(id),departure_id uuid NOT NULL REFERENCES app.departures(id),adults integer NOT NULL CHECK(adults>=0),children integer NOT NULL DEFAULT 0 CHECK(children>=0),pickup_snapshot jsonb NOT NULL DEFAULT '{}',CHECK(adults+children>0));
CREATE TABLE app.transfer_booking_items(booking_item_id uuid PRIMARY KEY REFERENCES app.booking_items(id),variant_id uuid NOT NULL REFERENCES app.service_variants(id),pickup text NOT NULL,dropoff text NOT NULL,pickup_at timestamptz NOT NULL,flight_number text,passengers integer NOT NULL CHECK(passengers>0),luggage integer NOT NULL CHECK(luggage>=0),requested_vehicle_kind text NOT NULL DEFAULT 'vehicle');
CREATE TABLE app.photography_booking_items(booking_item_id uuid PRIMARY KEY REFERENCES app.booking_items(id),variant_id uuid NOT NULL REFERENCES app.service_variants(id),package_id uuid,departure_id uuid REFERENCES app.departures(id),session_at timestamptz,delivery_terms_snapshot jsonb NOT NULL DEFAULT '{}');
CREATE TABLE app.addon_booking_items(booking_item_id uuid PRIMARY KEY REFERENCES app.booking_items(id),addon_variant_id uuid NOT NULL REFERENCES app.service_variants(id),parent_booking_item_id uuid NOT NULL REFERENCES app.booking_items(id),quantity integer NOT NULL CHECK(quantity>0),entitlement_snapshot jsonb NOT NULL DEFAULT '{}');
CREATE TABLE app.booking_participants(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),booking_id uuid NOT NULL REFERENCES app.bookings(id),display_name text NOT NULL,age_category text NOT NULL CHECK(age_category IN('adult','child','infant')),guardian_relation text,UNIQUE(id,booking_id));
CREATE TABLE app.item_participants(booking_item_id uuid NOT NULL,participant_id uuid NOT NULL,booking_id uuid NOT NULL,PRIMARY KEY(booking_item_id,participant_id),FOREIGN KEY(booking_item_id,booking_id) REFERENCES app.booking_items(id,booking_id),FOREIGN KEY(participant_id,booking_id) REFERENCES app.booking_participants(id,booking_id));
CREATE TABLE app.dive_requirements(participant_id uuid PRIMARY KEY REFERENCES app.booking_participants(id),certification text,experience jsonb NOT NULL DEFAULT '{}',equipment_sizes jsonb NOT NULL DEFAULT '{}',clearance_status text NOT NULL CHECK(clearance_status IN('pending','cleared','not_cleared')));
CREATE TABLE app.dive_sensitive_records(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),participant_id uuid NOT NULL REFERENCES app.booking_participants(id),encrypted_payload bytea,protected_document_ref text,retention_deadline timestamptz NOT NULL,access_log_id uuid REFERENCES app.audit_events(id),CHECK(encrypted_payload IS NOT NULL OR protected_document_ref IS NOT NULL));
CREATE TABLE app.booking_notes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),booking_id uuid NOT NULL REFERENCES app.bookings(id),author_id uuid REFERENCES app.staff_profiles(id),visibility text NOT NULL CHECK(visibility IN('guest','internal')),body text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE app.booking_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),booking_id uuid NOT NULL REFERENCES app.bookings(id),version integer NOT NULL,event_type text NOT NULL,actor_id uuid REFERENCES app.staff_profiles(id),metadata jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(booking_id,version,event_type));
CREATE TABLE app.booking_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),booking_id uuid NOT NULL REFERENCES app.bookings(id),type text NOT NULL CHECK(type IN('change','cancel')),status text NOT NULL DEFAULT 'open' CHECK(status IN('open','approved','rejected','withdrawn')),proposed_changes jsonb NOT NULL,reason text NOT NULL,resolved_by uuid REFERENCES app.staff_profiles(id),resolved_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE app.booking_revisions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),booking_id uuid NOT NULL REFERENCES app.bookings(id),source_version integer NOT NULL,quote_id uuid NOT NULL REFERENCES app.quotes(id),guest_accepted_at timestamptz,staff_approved_at timestamptz,approved_by uuid REFERENCES app.staff_profiles(id),status text NOT NULL DEFAULT 'proposed' CHECK(status IN('proposed','accepted','applied','rejected','expired')),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE app.access_grants(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),token_hash text NOT NULL UNIQUE CHECK(length(token_hash)>=64),purpose text NOT NULL CHECK(purpose IN('booking','gallery','review')),booking_id uuid REFERENCES app.bookings(id),gallery_id uuid,review_invitation_id uuid,scope text[] NOT NULL,expires_at timestamptz NOT NULL,used_at timestamptz,revoked_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),CHECK((purpose='booking' AND booking_id IS NOT NULL AND gallery_id IS NULL AND review_invitation_id IS NULL) OR (purpose='gallery' AND gallery_id IS NOT NULL AND review_invitation_id IS NULL) OR (purpose='review' AND review_invitation_id IS NOT NULL AND gallery_id IS NULL)));
CREATE TABLE app.guest_sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),session_hash text NOT NULL UNIQUE CHECK(length(session_hash)>=64),grant_id uuid NOT NULL REFERENCES app.access_grants(id),scope text[] NOT NULL,expires_at timestamptz NOT NULL,revoked_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE app.idempotency_records(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),caller_scope text NOT NULL,operation text NOT NULL,key_hash text NOT NULL,request_hash text NOT NULL,state text NOT NULL CHECK(state IN('processing','complete')),response_reference uuid,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(caller_scope,operation,key_hash));
CREATE TABLE app.capacity_allocations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),booking_item_id uuid NOT NULL UNIQUE REFERENCES app.booking_items(id),departure_id uuid NOT NULL REFERENCES app.departures(id),seats integer NOT NULL CHECK(seats>0),state text NOT NULL CHECK(state IN('held','confirmed','released')),expires_at timestamptz,released_at timestamptz,CHECK((state='released')=(released_at IS NOT NULL)));
CREATE TABLE app.apartment_stays(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),booking_item_id uuid NOT NULL UNIQUE REFERENCES app.booking_items(id),apartment_id uuid NOT NULL REFERENCES app.apartments(id),check_in date NOT NULL,check_out date NOT NULL,occupants integer NOT NULL CHECK(occupants>0),state text NOT NULL DEFAULT 'requested' CHECK(state IN('requested','held','confirmed','released','completed')),CHECK(check_in<check_out));
CREATE TABLE app.apartment_inventory(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),apartment_id uuid NOT NULL REFERENCES app.apartments(id),date_range daterange NOT NULL CHECK(NOT isempty(date_range) AND NOT lower_inf(date_range) AND NOT upper_inf(date_range) AND lower_inc(date_range) AND NOT upper_inc(date_range)),kind text NOT NULL CHECK(kind IN('stay','maintenance','owner_block','cleaning')),stay_id uuid REFERENCES app.apartment_stays(id),reason text,expires_at timestamptz,released_at timestamptz,actor_id uuid REFERENCES app.staff_profiles(id),created_at timestamptz NOT NULL DEFAULT now(),CHECK((kind='stay' AND stay_id IS NOT NULL) OR (kind<>'stay' AND stay_id IS NULL AND length(reason)>0)),EXCLUDE USING gist(apartment_id WITH =,date_range WITH &&) WHERE(released_at IS NULL));
CREATE UNIQUE INDEX one_active_stay_inventory ON app.apartment_inventory(stay_id) WHERE released_at IS NULL AND stay_id IS NOT NULL;
CREATE TABLE app.stay_nightly_prices(stay_id uuid REFERENCES app.apartment_stays(id),night_date date NOT NULL,amount bigint NOT NULL CHECK(amount>=0),currency text NOT NULL REFERENCES app.currencies(code),rate_rule_snapshot jsonb NOT NULL,PRIMARY KEY(stay_id,night_date));
CREATE TABLE app.stay_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),stay_id uuid NOT NULL REFERENCES app.apartment_stays(id),event_type text NOT NULL CHECK(event_type IN('checked_in','checked_out','cleaning')),actor_id uuid NOT NULL REFERENCES app.staff_profiles(id),notes text,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE app.resource_blocks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),resource_id uuid NOT NULL REFERENCES app.resources(id),starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,reason text NOT NULL,actor_id uuid NOT NULL REFERENCES app.staff_profiles(id),CHECK(starts_at<ends_at));
CREATE TABLE app.resource_occupancy(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),resource_id uuid NOT NULL REFERENCES app.resources(id),departure_id uuid REFERENCES app.departures(id),booking_item_id uuid REFERENCES app.booking_items(id),manual_block_id uuid REFERENCES app.resource_blocks(id),time_range tstzrange NOT NULL CHECK(NOT isempty(time_range) AND NOT lower_inf(time_range) AND NOT upper_inf(time_range) AND lower_inc(time_range) AND NOT upper_inc(time_range)),quantity integer NOT NULL CHECK(quantity>0),exclusive boolean NOT NULL,released_at timestamptz,CHECK(num_nonnulls(departure_id,booking_item_id,manual_block_id)=1),EXCLUDE USING gist(resource_id WITH =,time_range WITH &&) WHERE(released_at IS NULL AND exclusive));
CREATE UNIQUE INDEX departure_resource_once ON app.resource_occupancy(resource_id,departure_id) WHERE released_at IS NULL AND departure_id IS NOT NULL;
CREATE TABLE app.pickup_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),booking_item_id uuid NOT NULL REFERENCES app.booking_items(id),pickup_location_id uuid REFERENCES app.pickup_locations(id),address_snapshot text NOT NULL,pickup_at timestamptz NOT NULL,vehicle_resource_id uuid REFERENCES app.resources(id),driver_resource_id uuid REFERENCES app.resources(id),instructions text);
CREATE TABLE app.fulfilment_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),booking_item_id uuid NOT NULL REFERENCES app.booking_items(id),state text NOT NULL CHECK(state IN('scheduled','check_in','fulfilled','no_show','cancelled')),actor_id uuid NOT NULL REFERENCES app.staff_profiles(id),notes text,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE app.payment_obligations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),booking_id uuid NOT NULL REFERENCES app.bookings(id),kind text NOT NULL CHECK(kind IN('initial','balance','adjustment')),amount bigint NOT NULL CHECK(amount>=0),currency text NOT NULL REFERENCES app.currencies(code),due_at timestamptz,version integer NOT NULL DEFAULT 1,status text NOT NULL DEFAULT 'open' CHECK(status IN('open','paid','void')),UNIQUE(booking_id,kind,version));
CREATE TABLE app.payment_attempts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),booking_id uuid NOT NULL REFERENCES app.bookings(id),obligation_id uuid NOT NULL REFERENCES app.payment_obligations(id),provider text NOT NULL,environment text NOT NULL CHECK(environment IN('local','sandbox','production')),provider_ref text,request_key text NOT NULL UNIQUE,expected_amount bigint NOT NULL CHECK(expected_amount>0),currency text NOT NULL REFERENCES app.currencies(code),status text NOT NULL DEFAULT 'creating' CHECK(status IN('creating','pending','succeeded','failed','expired','unknown')),checkout_expires_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE app.provider_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),provider text NOT NULL,account text NOT NULL,environment text NOT NULL CHECK(environment IN('local','sandbox','production')),event_key text NOT NULL,event_kind text NOT NULL,transaction_reference text NOT NULL,verified_at timestamptz NOT NULL,payload_redacted jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(provider,account,environment,event_key));
CREATE TABLE app.payment_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),provider text NOT NULL,account text NOT NULL,environment text NOT NULL,transaction_id text NOT NULL,attempt_id uuid NOT NULL REFERENCES app.payment_attempts(id),state text NOT NULL,amount bigint NOT NULL CHECK(amount>=0),currency text NOT NULL REFERENCES app.currencies(code),provider_updated_at timestamptz,UNIQUE(provider,account,environment,transaction_id));
CREATE TABLE app.offline_receipts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),booking_id uuid NOT NULL REFERENCES app.bookings(id),method text NOT NULL CHECK(method IN('cash','bank_transfer')),amount bigint NOT NULL CHECK(amount>0),currency text NOT NULL REFERENCES app.currencies(code),received_by uuid NOT NULL REFERENCES app.staff_profiles(id),received_at timestamptz NOT NULL,reference text,evidence_ref text,verification_status text NOT NULL CHECK(verification_status IN('pending','verified','rejected')),request_key text NOT NULL UNIQUE);
CREATE TABLE app.refund_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),booking_id uuid NOT NULL REFERENCES app.bookings(id),original_transaction_id uuid REFERENCES app.payment_transactions(id),original_offline_receipt_id uuid REFERENCES app.offline_receipts(id),amount bigint NOT NULL CHECK(amount>0),currency text NOT NULL REFERENCES app.currencies(code),reason text NOT NULL,policy_calculation jsonb NOT NULL,requested_by uuid NOT NULL REFERENCES app.staff_profiles(id),approved_by uuid REFERENCES app.staff_profiles(id),approved_at timestamptz,status text NOT NULL DEFAULT 'requested' CHECK(status IN('requested','approved','processing','succeeded','failed','rejected')),version integer NOT NULL DEFAULT 1,CHECK(num_nonnulls(original_transaction_id,original_offline_receipt_id)=1));
CREATE TABLE app.refund_attempts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),refund_request_id uuid NOT NULL REFERENCES app.refund_requests(id),route text NOT NULL,request_key text NOT NULL UNIQUE,external_ref text,state text NOT NULL CHECK(state IN('creating','pending','succeeded','failed','unknown')),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE app.cash_ledger(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),booking_id uuid NOT NULL REFERENCES app.bookings(id),source text NOT NULL CHECK(source IN('online','offline','refund','chargeback','reversal')),amount bigint NOT NULL CHECK(amount<>0),currency text NOT NULL REFERENCES app.currencies(code),transaction_id uuid REFERENCES app.payment_transactions(id),event_id uuid REFERENCES app.provider_events(id),offline_receipt_id uuid REFERENCES app.offline_receipts(id),refund_request_id uuid REFERENCES app.refund_requests(id),effect_key text NOT NULL UNIQUE,effective_at timestamptz NOT NULL DEFAULT now(),actor_id uuid REFERENCES app.staff_profiles(id),CHECK((source IN('online','offline') AND amount>0) OR(source IN('refund','chargeback','reversal') AND amount<0)));
CREATE TABLE app.payment_applications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),ledger_entry_id uuid NOT NULL REFERENCES app.cash_ledger(id),obligation_id uuid NOT NULL REFERENCES app.payment_obligations(id),amount bigint NOT NULL CHECK(amount>0),currency text NOT NULL REFERENCES app.currencies(code),UNIQUE(ledger_entry_id,obligation_id));
CREATE TABLE app.financial_exceptions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),booking_id uuid REFERENCES app.bookings(id),event_id uuid REFERENCES app.provider_events(id),kind text NOT NULL CHECK(kind IN('late_payment','amount_mismatch','dispute','unknown_outcome')),state text NOT NULL DEFAULT 'open' CHECK(state IN('open','resolved')),owner_id uuid REFERENCES app.staff_profiles(id),resolution jsonb,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE app.receipts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),booking_id uuid NOT NULL REFERENCES app.bookings(id),number text NOT NULL UNIQUE,line_snapshot jsonb NOT NULL,amount bigint NOT NULL CHECK(amount>=0),currency text NOT NULL REFERENCES app.currencies(code),issued_at timestamptz NOT NULL DEFAULT now(),private_document_ref text);
CREATE TABLE app.expense_categories(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text NOT NULL UNIQUE,label text NOT NULL);
CREATE TABLE app.expenses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),category_id uuid NOT NULL REFERENCES app.expense_categories(id),amount bigint NOT NULL CHECK(amount>0),currency text NOT NULL REFERENCES app.currencies(code),incurred_on date NOT NULL,supplier text,proof_ref text,actor_id uuid NOT NULL REFERENCES app.staff_profiles(id),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE app.outbox_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),aggregate_type text NOT NULL,aggregate_id uuid NOT NULL,aggregate_version integer NOT NULL,event_type text NOT NULL,payload jsonb NOT NULL DEFAULT '{}',event_key text NOT NULL UNIQUE,occurred_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE app.jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid NOT NULL REFERENCES app.outbox_events(id),kind text NOT NULL,job_key text NOT NULL UNIQUE,status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','running','complete','failed','dead')),run_after timestamptz NOT NULL DEFAULT now(),attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),lease_owner text,lease_until timestamptz,failure_class text,completed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX booking_status_date ON app.bookings(status,created_at);
CREATE INDEX booking_guest ON app.bookings(primary_guest_id);
CREATE INDEX booking_items_booking ON app.booking_items(booking_id);
CREATE INDEX allocations_departure ON app.capacity_allocations(departure_id) WHERE state<>'released';
CREATE INDEX departures_start ON app.departures(starts_at) WHERE status='scheduled';
CREATE INDEX quote_items_quote ON app.quote_items(quote_id);
CREATE INDEX ledger_booking ON app.cash_ledger(booking_id);
CREATE INDEX jobs_eligible ON app.jobs(run_after,lease_until) WHERE status IN('pending','running','failed');
CREATE INDEX grants_booking ON app.access_grants(booking_id);
ALTER TABLE app.booking_items ADD COLUMN superseded_at timestamptz;
CREATE TABLE app.local_operator_sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),staff_id uuid NOT NULL REFERENCES app.staff_profiles(id),token_hash text NOT NULL UNIQUE CHECK(length(token_hash)>=64),expires_at timestamptz NOT NULL,redeemed_at timestamptz,revoked_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());

-- Section 5.8–5.9 extension schema. Concatenate after the core app tables.
-- This file is a source fragment, not an independently applied migration.

create table app.media_assets (
  id uuid primary key default gen_random_uuid(),
  storage_bucket text not null check (length(storage_bucket) between 1 and 128),
  storage_key text not null check (length(storage_key) between 1 and 1024),
  uploaded_by uuid not null references app.staff_profiles(id) on delete restrict,
  mime_type text not null check (mime_type ~ '^(image|video)/[a-zA-Z0-9.+-]+$'),
  size_bytes bigint not null check (size_bytes > 0),
  checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  width integer check (width > 0),
  height integer check (height > 0),
  state text not null default 'quarantine' check (state in ('quarantine', 'processing', 'ready', 'rejected', 'deleted')),
  classification text not null default 'private' check (classification in ('private', 'public')),
  -- A classification is intent; original storage never becomes a public object.
  storage_visibility text not null default 'private' check (storage_visibility = 'private'),
  rights_evidence_ref text,
  rights_verified_by uuid references app.staff_profiles(id) on delete restrict,
  rights_verified_at timestamptz,
  subjects_reviewed_by uuid references app.staff_profiles(id) on delete restrict,
  subjects_reviewed_at timestamptz,
  safe_at timestamptz,
  retention_deadline timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  unique (storage_bucket, storage_key),
  check ((rights_verified_at is null) = (rights_verified_by is null)),
  check (rights_verified_at is null or nullif(btrim(rights_evidence_ref), '') is not null),
  check ((subjects_reviewed_at is null) = (subjects_reviewed_by is null)),
  check (state <> 'ready' or safe_at is not null)
);

create table app.media_subjects (
  asset_id uuid not null references app.media_assets(id) on delete restrict,
  guest_id uuid not null references app.guests(id) on delete restrict,
  guardian_guest_id uuid references app.guests(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (asset_id, guest_id),
  check (guardian_guest_id is null or guardian_guest_id <> guest_id)
);

create table app.publication_consents (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null,
  subject_guest_id uuid not null,
  granted_by_guest_id uuid not null references app.guests(id) on delete restrict,
  evidence_ref text not null check (length(btrim(evidence_ref)) > 0),
  allowed_uses text[] not null check (cardinality(allowed_uses) > 0 and allowed_uses <@ array['marketing', 'social', 'website', 'print']::text[]),
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  foreign key (asset_id, subject_guest_id) references app.media_subjects(asset_id, guest_id) on delete restrict,
  check (expires_at is null or expires_at > granted_at),
  check (withdrawn_at is null or withdrawn_at >= granted_at)
);
create index publication_consents_subject_idx on app.publication_consents(asset_id, subject_guest_id, granted_at desc);

create table app.media_derivatives (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references app.media_assets(id) on delete restrict,
  kind text not null check (kind in ('thumbnail', 'web', 'preview', 'original', 'video-poster')),
  storage_bucket text not null,
  storage_key text not null,
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  state text not null default 'processing' check (state in ('processing', 'ready', 'rejected', 'deleted')),
  width integer check (width > 0),
  height integer check (height > 0),
  size_bytes bigint check (size_bytes > 0),
  approved_by uuid references app.staff_profiles(id) on delete restrict,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  unique (storage_bucket, storage_key),
  unique (id, asset_id),
  check (kind <> 'original' or visibility = 'private'),
  check ((approved_at is null) = (approved_by is null)),
  check (visibility <> 'public' or (approved_at is not null and state = 'ready'))
);
create index media_derivatives_asset_idx on app.media_derivatives(asset_id, kind);

create table app.media_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references app.jobs(id) on delete restrict,
  asset_id uuid not null references app.media_assets(id) on delete restrict,
  kind text not null check (kind in ('scan', 'metadata', 'thumbnail', 'preview', 'public_derivative', 'video_transcode')),
  provider_ref text,
  status text not null default 'queued' check (status in ('queued', 'processing', 'succeeded', 'failed')),
  failure_code text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0)
);
comment on table app.media_processing_jobs is 'Media-specific job projection. app.jobs owns leases, attempts, retry scheduling and execution.';
create index media_processing_jobs_asset_idx on app.media_processing_jobs(asset_id, status);

create table app.photo_packages (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  entitlement_rules jsonb not null check (jsonb_typeof(entitlement_rules) = 'object'),
  price_amount bigint not null check (price_amount >= 0),
  currency text not null references app.currencies(code) on delete restrict,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0)
);

create table app.photo_package_translations (
  package_id uuid not null references app.photo_packages(id) on delete restrict,
  locale text not null references app.locales(code) on delete restrict,
  title text not null check (length(btrim(title)) > 0),
  description text not null,
  approved_by uuid references app.staff_profiles(id) on delete restrict,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  primary key (package_id, locale),
  check ((approved_at is null) = (approved_by is null))
);

create table app.galleries (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('public', 'private')),
  booking_id uuid references app.bookings(id) on delete restrict,
  destination_id uuid references app.destinations(id) on delete restrict,
  visibility_state text not null default 'draft' check (visibility_state in ('draft', 'review', 'published', 'revoked', 'expired')),
  expires_at timestamptz,
  title text not null,
  assigned_photographer_id uuid references app.staff_profiles(id) on delete restrict,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  check ((kind = 'private' and booking_id is not null) or (kind = 'public' and booking_id is null)),
  check (visibility_state <> 'published' or published_at is not null),
  check (expires_at is null or expires_at > created_at)
);
create index galleries_booking_idx on app.galleries(booking_id) where booking_id is not null;
create index galleries_publication_idx on app.galleries(kind, visibility_state, published_at desc);

create table app.gallery_assets (
  gallery_id uuid not null references app.galleries(id) on delete restrict,
  asset_id uuid not null references app.media_assets(id) on delete restrict,
  display_order integer not null default 0 check (display_order >= 0),
  public_derivative_id uuid,
  preview_allowed boolean not null default true,
  download_allowed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  primary key (gallery_id, asset_id),
  foreign key (public_derivative_id, asset_id) references app.media_derivatives(id, asset_id) on delete restrict
);
create index gallery_assets_asset_idx on app.gallery_assets(asset_id, gallery_id);

create table app.gallery_entitlements (
  id uuid primary key default gen_random_uuid(),
  booking_item_id uuid not null references app.booking_items(id) on delete restrict,
  gallery_id uuid not null references app.galleries(id) on delete restrict,
  package_id uuid not null references app.photo_packages(id) on delete restrict,
  package_snapshot jsonb not null check (jsonb_typeof(package_snapshot) = 'object'),
  payment_eligible boolean not null default false,
  delivery_eligible boolean not null default false,
  allowed_variants text[] not null default array['preview']::text[],
  allowed_count integer check (allowed_count >= 0),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  unique (booking_item_id, gallery_id),
  check (cardinality(allowed_variants) > 0 and allowed_variants <@ array['thumbnail', 'web', 'preview', 'original', 'video-poster']::text[])
);
create index gallery_entitlements_gallery_idx on app.gallery_entitlements(gallery_id);

create table app.photographer_assignments (
  staff_id uuid not null references app.staff_profiles(id) on delete restrict,
  booking_id uuid not null references app.bookings(id) on delete restrict,
  access_starts_at timestamptz not null,
  access_ends_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  primary key (staff_id, booking_id),
  check (access_starts_at < access_ends_at)
);
create index photographer_assignments_booking_idx on app.photographer_assignments(booking_id);

create table app.download_events (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid references app.access_grants(id) on delete restrict,
  session_id uuid references app.guest_sessions(id) on delete restrict,
  derivative_id uuid not null references app.media_derivatives(id) on delete restrict,
  action text not null check (action in ('preview', 'download', 'denied')),
  reason_code text,
  created_at timestamptz not null default now(),
  check (grant_id is not null or session_id is not null)
);
create index download_events_session_idx on app.download_events(session_id, created_at desc);
create index download_events_derivative_idx on app.download_events(derivative_id, created_at desc);
create trigger download_events_immutable before update or delete on app.download_events
for each row execute function app.deny_mutation();

create table app.public_gallery_translations (
  gallery_id uuid not null references app.galleries(id) on delete restrict,
  locale text not null references app.locales(code) on delete restrict,
  title text not null,
  description text not null default '',
  captions jsonb not null default '{}'::jsonb check (jsonb_typeof(captions) = 'object'),
  approved_by uuid references app.staff_profiles(id) on delete restrict,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  primary key (gallery_id, locale),
  check ((approved_at is null) = (approved_by is null))
);

-- Read-time eligibility is also mandatory: time can expire without a row write.
create function app.asset_publication_eligible(p_asset_id uuid) returns boolean
language sql stable security invoker set search_path = pg_catalog, app as $$
  select exists (
    select 1 from app.media_assets a
    where a.id = p_asset_id and a.state = 'ready' and a.safe_at is not null
      and a.rights_verified_at is not null and a.subjects_reviewed_at is not null
      and not exists (
        select 1 from app.media_subjects s
        where s.asset_id = a.id and not exists (
          select 1 from app.publication_consents c
          where c.asset_id = s.asset_id and c.subject_guest_id = s.guest_id
            and c.granted_by_guest_id = coalesce(s.guardian_guest_id, s.guest_id)
            and 'marketing' = any(c.allowed_uses) and c.granted_at <= now()
            and c.withdrawn_at is null and (c.expires_at is null or c.expires_at > now())
        )
      )
  );
$$;

create function app.assert_public_gallery(p_gallery_id uuid) returns void
language plpgsql security invoker set search_path = pg_catalog, app as $$
declare v_gallery app.galleries;
begin
  select * into v_gallery from app.galleries where id = p_gallery_id for update;
  if not found or v_gallery.kind <> 'public' or v_gallery.visibility_state <> 'published' then return; end if;
  if (v_gallery.expires_at is not null and v_gallery.expires_at <= now())
    or not exists (select 1 from app.gallery_assets where gallery_id = p_gallery_id)
    or exists (
      select 1 from app.gallery_assets ga
      join app.media_assets a on a.id = ga.asset_id
      left join app.media_derivatives d on d.id = ga.public_derivative_id and d.asset_id = ga.asset_id
      where ga.gallery_id = p_gallery_id and (
        not app.asset_publication_eligible(a.id) or d.id is null
        or d.visibility <> 'public' or d.state <> 'ready' or d.kind = 'original'
        or d.approved_at is null
        or exists (
          select 1 from app.media_assets original_asset
          where original_asset.storage_bucket = d.storage_bucket and original_asset.storage_key = d.storage_key
        )
      )
    )
  then raise exception 'Public gallery requires safe media, rights, subject consent and approved public derivatives' using errcode = '23514';
  end if;
end;
$$;

create function app.assert_public_asset(p_asset_id uuid) returns void
language plpgsql security invoker set search_path = pg_catalog, app as $$
begin
  perform 1 from app.media_assets where id = p_asset_id for update;
  if exists (
    select 1 from app.media_derivatives d join app.media_assets a on a.id = d.asset_id
    where d.asset_id = p_asset_id and d.visibility = 'public' and (
      not app.asset_publication_eligible(a.id)
      or exists (
        select 1 from app.media_assets original_asset
        where original_asset.storage_bucket = d.storage_bucket and original_asset.storage_key = d.storage_key
      )
    )
  ) then raise exception 'Public derivative requires current rights and consent and a separate object' using errcode = '23514'; end if;
end;
$$;

create function app.enforce_public_gallery() returns trigger
language plpgsql security invoker set search_path = pg_catalog, app as $$
declare v_gallery_id uuid; v_asset_id uuid; v_old_asset_id uuid;
begin
  if tg_table_name = 'galleries' then
    perform app.assert_public_gallery(new.id);
  elsif tg_table_name = 'gallery_assets' then
    if tg_op <> 'INSERT' then perform app.assert_public_gallery(old.gallery_id); end if;
    if tg_op <> 'DELETE' then perform app.assert_public_gallery(new.gallery_id); end if;
  else
    if tg_table_name = 'media_assets' then
      v_asset_id := new.id;
      v_old_asset_id := old.id;
    else
      if tg_op <> 'DELETE' then v_asset_id := new.asset_id; end if;
      if tg_op <> 'INSERT' then v_old_asset_id := old.asset_id; end if;
    end if;
    if v_asset_id is not null then perform app.assert_public_asset(v_asset_id); end if;
    if v_old_asset_id is not null and v_old_asset_id is distinct from v_asset_id then
      perform app.assert_public_asset(v_old_asset_id);
    end if;
    for v_gallery_id in
      select distinct gallery_id from app.gallery_assets
      where asset_id in (v_asset_id, v_old_asset_id) order by gallery_id
    loop perform app.assert_public_gallery(v_gallery_id); end loop;
  end if;
  return null;
end;
$$;

create constraint trigger galleries_publication_guard after insert or update on app.galleries
deferrable initially deferred for each row execute function app.enforce_public_gallery();
create constraint trigger gallery_assets_publication_guard after insert or update or delete on app.gallery_assets
deferrable initially deferred for each row execute function app.enforce_public_gallery();
create constraint trigger media_assets_publication_guard after update on app.media_assets
deferrable initially deferred for each row execute function app.enforce_public_gallery();
create constraint trigger media_subjects_publication_guard after insert or update or delete on app.media_subjects
deferrable initially deferred for each row execute function app.enforce_public_gallery();
create constraint trigger media_derivatives_publication_guard after insert or update or delete on app.media_derivatives
deferrable initially deferred for each row execute function app.enforce_public_gallery();
create constraint trigger publication_consents_publication_guard after insert or update or delete on app.publication_consents
deferrable initially deferred for each row execute function app.enforce_public_gallery();

create function app.enforce_gallery_entitlement() returns trigger
language plpgsql security invoker set search_path = pg_catalog, app as $$
begin
  if not exists (
    select 1 from app.galleries g join app.booking_items bi on bi.booking_id = g.booking_id
    where g.id = new.gallery_id and g.kind = 'private' and bi.id = new.booking_item_id
  ) then raise exception 'Gallery entitlement must belong to the same private booking' using errcode = '23514'; end if;
  return new;
end;
$$;
create trigger gallery_entitlement_booking_guard before insert or update on app.gallery_entitlements
for each row execute function app.enforce_gallery_entitlement();

create function app.revalidate_gallery_entitlements() returns trigger
language plpgsql security invoker set search_path = pg_catalog, app as $$
begin
  if exists (
    select 1 from app.gallery_entitlements e
    join app.galleries g on g.id = e.gallery_id
    join app.booking_items bi on bi.id = e.booking_item_id
    where ((tg_table_name = 'galleries' and g.id = new.id)
       or (tg_table_name = 'booking_items' and bi.id = new.id))
      and (g.kind <> 'private' or g.booking_id is distinct from bi.booking_id)
  ) then raise exception 'Gallery entitlement must retain the same private booking' using errcode = '23514'; end if;
  return null;
end;
$$;
create constraint trigger gallery_entitlements_gallery_change_guard after update on app.galleries
deferrable initially deferred for each row execute function app.revalidate_gallery_entitlements();
create constraint trigger gallery_entitlements_item_change_guard after update on app.booking_items
deferrable initially deferred for each row execute function app.revalidate_gallery_entitlements();

create table app.review_invitations (
  id uuid primary key default gen_random_uuid(),
  booking_item_id uuid not null unique references app.booking_items(id) on delete restrict,
  eligible_at timestamptz not null,
  sent_at timestamptz,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  unique (id, booking_item_id),
  check (expires_at > eligible_at),
  check (used_at is null or (used_at >= eligible_at and used_at < expires_at))
);

create table app.reviews (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null unique,
  booking_item_id uuid not null unique references app.booking_items(id) on delete restrict,
  primary_guest_id uuid not null references app.guests(id) on delete restrict,
  rating smallint not null check (rating between 1 and 5),
  original_text text not null check (length(original_text) between 1 and 10000),
  original_locale text not null references app.locales(code) on delete restrict,
  submitted_at timestamptz not null default now(),
  moderation_state text not null default 'pending' check (moderation_state in ('pending', 'published', 'rejected', 'withdrawn')),
  display_name_preference text not null default 'initials' check (display_name_preference in ('first_name', 'initials', 'anonymous')),
  public_display_name text not null check (length(public_display_name) between 1 and 100),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  foreign key (invitation_id, booking_item_id) references app.review_invitations(id, booking_item_id) on delete restrict,
  check (moderation_state <> 'published' or published_at is not null)
);
create index reviews_public_idx on app.reviews(moderation_state, submitted_at desc);
create index reviews_guest_idx on app.reviews(primary_guest_id);

create function app.enforce_review_submission() returns trigger
language plpgsql security invoker set search_path = pg_catalog, app as $$
declare v_invitation app.review_invitations;
begin
  select * into v_invitation from app.review_invitations where id = new.invitation_id for update;
  if not found or v_invitation.booking_item_id <> new.booking_item_id
    or v_invitation.eligible_at > now() or v_invitation.expires_at <= now()
    or v_invitation.used_at is not null or v_invitation.revoked_at is not null then
    raise exception 'Review invitation is unavailable' using errcode = '23514';
  end if;
  if not exists (
    select 1 from app.booking_items bi join app.bookings b on b.id = bi.booking_id
    where bi.id = new.booking_item_id and bi.fulfilment_state = 'fulfilled'
      and b.primary_guest_id = new.primary_guest_id
  ) then raise exception 'Review requires the completed item and its primary guest' using errcode = '23514'; end if;
  new.submitted_at := now();
  update app.review_invitations set used_at = now() where id = new.invitation_id;
  return new;
end;
$$;
create trigger review_submission_guard before insert on app.reviews
for each row execute function app.enforce_review_submission();

create function app.protect_review_original() returns trigger
language plpgsql security invoker set search_path = pg_catalog, app as $$
begin
  if tg_op = 'DELETE' then raise exception 'Reviews must be withdrawn, not deleted' using errcode = '23514'; end if;
  if row(new.id, new.invitation_id, new.booking_item_id, new.primary_guest_id, new.rating, new.original_text, new.original_locale, new.submitted_at)
    is distinct from row(old.id, old.invitation_id, old.booking_item_id, old.primary_guest_id, old.rating, old.original_text, old.original_locale, old.submitted_at)
  then raise exception 'Submitted review identity, rating and text are immutable' using errcode = '23514'; end if;
  return new;
end;
$$;
create trigger review_original_immutable before update or delete on app.reviews
for each row execute function app.protect_review_original();

create table app.review_moderation_events (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references app.reviews(id) on delete restrict,
  actor_id uuid not null references app.staff_profiles(id) on delete restrict,
  action text not null check (action in ('publish', 'reject', 'withdraw', 'restore')),
  reason text not null check (length(btrim(reason)) > 0),
  created_at timestamptz not null default now()
);
create index review_moderation_events_review_idx on app.review_moderation_events(review_id, created_at desc);
create trigger review_moderation_events_immutable before update or delete on app.review_moderation_events
for each row execute function app.deny_mutation();

create table app.review_replies (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references app.reviews(id) on delete restrict,
  staff_id uuid not null references app.staff_profiles(id) on delete restrict,
  body text not null check (length(body) between 1 and 10000),
  published_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0)
);
create index review_replies_review_idx on app.review_replies(review_id, published_at);

create table app.cms_pages (
  id uuid primary key default gen_random_uuid(),
  page_key text not null unique check (page_key ~ '^[a-z0-9][a-z0-9_-]*$'),
  status text not null default 'draft' check (status in ('draft', 'review', 'published', 'archived')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  check (status <> 'published' or published_at is not null)
);

create table app.cms_translations (
  page_id uuid not null references app.cms_pages(id) on delete restrict,
  locale text not null references app.locales(code) on delete restrict,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9/-]*$'),
  title text not null,
  structured_body jsonb not null check (jsonb_typeof(structured_body) = 'array'),
  seo_title text,
  seo_description text,
  approved_by uuid references app.staff_profiles(id) on delete restrict,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  primary key (page_id, locale),
  unique (locale, slug),
  check ((approved_at is null) = (approved_by is null))
);

create table app.social_links (
  id uuid primary key default gen_random_uuid(),
  platform text not null unique check (platform in ('facebook', 'instagram', 'tiktok', 'whatsapp')),
  url text not null,
  active boolean not null default false,
  verified_by uuid references app.staff_profiles(id) on delete restrict,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  check (
    (platform = 'facebook' and url ~ '^https://(www\.)?facebook\.com/[^[:space:]?#@]+([?][^[:space:]#]*)?$')
    or (platform = 'instagram' and url ~ '^https://(www\.)?instagram\.com/[^[:space:]?#@]+/?$')
    or (platform = 'tiktok' and url ~ '^https://(www\.)?tiktok\.com/@[^[:space:]?#/]+/?$')
    or (platform = 'whatsapp' and url ~ '^https://wa\.me/[1-9][0-9]{6,14}$')
  ),
  check (not active or (verified_by is not null and verified_at is not null))
);

create table app.contact_requests (
  id uuid primary key default gen_random_uuid(),
  sender_name text not null check (length(sender_name) between 1 and 200),
  email text,
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  locale text not null references app.locales(code) on delete restrict,
  message text not null check (length(message) between 1 and 10000),
  state text not null default 'new' check (state in ('new', 'assigned', 'replied', 'closed', 'spam')),
  assigned_to uuid references app.staff_profiles(id) on delete restrict,
  consent_metadata jsonb not null check (jsonb_typeof(consent_metadata) = 'object'),
  retention_deadline timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  check (nullif(btrim(email), '') is not null or phone_e164 is not null),
  check (retention_deadline > created_at)
);
create index contact_requests_queue_idx on app.contact_requests(state, created_at);
create index contact_requests_retention_idx on app.contact_requests(retention_deadline);

create table app.notification_templates (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  channel text not null check (channel in ('email', 'whatsapp')),
  locale text not null references app.locales(code) on delete restrict,
  template_version integer not null check (template_version > 0),
  provider text not null,
  provider_template_id text,
  provider_language text,
  approval_status text not null default 'draft' check (approval_status in ('draft', 'pending', 'approved', 'rejected', 'paused', 'disabled')),
  category text not null check (category in ('transactional', 'utility', 'authentication', 'marketing')),
  subject_template text,
  body_template text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  unique (event_type, channel, locale, template_version),
  check (channel <> 'whatsapp' or approval_status <> 'approved' or (provider_template_id is not null and provider_language is not null))
);

create table app.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references app.jobs(id) on delete restrict,
  template_id uuid references app.notification_templates(id) on delete restrict,
  channel text not null check (channel in ('email', 'whatsapp')),
  attempt integer not null check (attempt > 0),
  provider text not null,
  provider_message_id text,
  status text not null default 'queued' check (status in ('queued', 'submitted', 'accepted', 'delivered', 'read', 'failed', 'suppressed', 'unknown')),
  error_class text,
  submitted_at timestamptz,
  accepted_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  unique (job_id, channel, attempt),
  unique (provider, provider_message_id),
  check (status <> 'delivered' or delivered_at is not null),
  check (status <> 'read' or (delivered_at is not null and read_at is not null)),
  check (status <> 'failed' or failed_at is not null)
);
create index notification_deliveries_pending_idx on app.notification_deliveries(status, created_at) where status in ('queued', 'submitted', 'accepted', 'unknown');

create table app.integration_health (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  environment text not null check (environment in ('development', 'staging', 'production')),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  status text not null default 'unknown' check (status in ('unknown', 'healthy', 'degraded', 'unavailable')),
  safe_diagnostics jsonb not null default '{}'::jsonb check (jsonb_typeof(safe_diagnostics) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  unique (provider, environment)
);

create table app.security_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('authentication', 'access', 'rate_limit', 'privilege', 'session_revoked', 'suspicious_activity')),
  severity text not null check (severity in ('info', 'warning', 'critical')),
  correlation_id uuid not null,
  staff_id uuid references app.staff_profiles(id) on delete restrict,
  guest_session_id uuid references app.guest_sessions(id) on delete restrict,
  redacted_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(redacted_metadata) = 'object'),
  retention_deadline timestamptz not null,
  created_at timestamptz not null default now(),
  check (retention_deadline > created_at)
);
create index security_events_correlation_idx on app.security_events(correlation_id, created_at desc);
create index security_events_retention_idx on app.security_events(retention_deadline);
create trigger security_events_immutable before update or delete on app.security_events
for each row execute function app.deny_mutation();

create table app.rate_limit_buckets (
  id uuid primary key default gen_random_uuid(),
  key_digest text not null check (key_digest ~ '^[0-9a-f]{64}$'),
  operation text not null check (length(operation) between 1 and 100),
  window_started_at timestamptz not null,
  window_seconds integer not null check (window_seconds between 1 and 86400),
  counter bigint not null check (counter >= 0),
  resets_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  unique (key_digest, operation, window_started_at, window_seconds),
  check (resets_at = window_started_at + make_interval(secs => window_seconds))
);
create index rate_limit_buckets_expiry_idx on app.rate_limit_buckets(resets_at);

create function app.consume_rate_limit(p_key_digest text, p_operation text, p_window_seconds integer, p_limit integer)
returns table (allowed boolean, remaining bigint, resets_at timestamptz)
language plpgsql security invoker set search_path = pg_catalog, app as $$
declare v_start timestamptz; v_count bigint; v_reset timestamptz;
begin
  if p_key_digest is null or p_key_digest !~ '^[0-9a-f]{64}$'
    or p_operation is null or length(p_operation) not between 1 and 100
    or p_window_seconds is null or p_window_seconds not between 1 and 86400
    or p_limit is null or p_limit < 1 then
    raise exception 'Invalid rate-limit parameters' using errcode = '22023';
  end if;
  v_start := to_timestamp(floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds);
  insert into app.rate_limit_buckets(key_digest, operation, window_started_at, window_seconds, counter, resets_at)
  values (p_key_digest, p_operation, v_start, p_window_seconds, 1, v_start + make_interval(secs => p_window_seconds))
  on conflict (key_digest, operation, window_started_at, window_seconds)
  do update set counter = least(app.rate_limit_buckets.counter, 2147483647::bigint) + 1, updated_at = now()
  returning counter, app.rate_limit_buckets.resets_at into v_count, v_reset;
  return query select v_count <= p_limit, greatest(p_limit::bigint - v_count, 0::bigint), v_reset;
end;
$$;

-- No browser grants or permissive policies are introduced here. The final
-- migration phase enables RLS and grants only the server's required operations.

-- Runtime cannot mutate inventory or finance tables directly. These narrow routines
-- execute in the private app schema with a fixed search path and explicit checks.
CREATE FUNCTION app.money_json(p_value jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,app AS $$
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
CREATE FUNCTION app.emit_booking_event(p_booking uuid,p_event text,p_actor uuid DEFAULT NULL,p_metadata jsonb DEFAULT '{}') RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
DECLARE b app.bookings; e uuid;
BEGIN
 SELECT * INTO STRICT b FROM app.bookings WHERE id=p_booking;
 INSERT INTO app.booking_events(booking_id,version,event_type,actor_id,metadata) VALUES(b.id,b.version,p_event,p_actor,p_metadata) ON CONFLICT DO NOTHING;
 INSERT INTO app.outbox_events(aggregate_type,aggregate_id,aggregate_version,event_type,event_key,payload) VALUES('booking',b.id,b.version,p_event,b.id||':'||b.version||':'||p_event,jsonb_build_object('bookingId',b.id,'status',b.status)) ON CONFLICT DO NOTHING RETURNING id INTO e;
 IF e IS NOT NULL THEN INSERT INTO app.jobs(event_id,kind,job_key) VALUES(e,'notification',e||':notification'); END IF;
 INSERT INTO app.audit_events(actor_type,actor_id,action,target_type,target_id,summary) VALUES(CASE WHEN p_actor IS NULL THEN 'system' ELSE 'staff' END,p_actor,p_event,'booking',b.id,p_metadata);
END $$;
CREATE FUNCTION app.has_permission(p_actor uuid,p_permission text) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,app AS $$
 SELECT EXISTS(SELECT 1 FROM app.staff_profiles s WHERE s.id=p_actor AND s.active AND s.revoked_at IS NULL AND
 (EXISTS(SELECT 1 FROM app.staff_roles sr JOIN app.role_permissions rp ON rp.role_id=sr.role_id JOIN app.permissions p ON p.id=rp.permission_id WHERE sr.staff_id=s.id AND p.code=p_permission)
 OR EXISTS(SELECT 1 FROM app.staff_permission_grants g JOIN app.permissions p ON p.id=g.permission_id WHERE g.staff_id=s.id AND p.code=p_permission)));
$$;
CREATE FUNCTION app.scope_allows(p_actor uuid,p_destination uuid,p_property uuid DEFAULT NULL) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,app AS $$
 SELECT EXISTS(SELECT 1 FROM app.staff_scopes WHERE staff_id=p_actor AND (scope_type='all' OR(scope_type='destination' AND destination_id=p_destination) OR(scope_type='property' AND property_id=p_property)));
$$;
CREATE FUNCTION app.assert_staff(p_actor uuid,p_permission text,p_booking uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
BEGIN
 IF NOT app.has_permission(p_actor,p_permission) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_booking IS NOT NULL AND EXISTS(
  SELECT 1 FROM app.booking_items bi JOIN app.quote_items qi ON qi.id=bi.quote_item_id
  LEFT JOIN app.service_variants v ON v.id=qi.variant_id LEFT JOIN app.services s ON s.id=v.service_id
  LEFT JOIN app.apartments a ON a.id=qi.apartment_id LEFT JOIN app.properties p ON p.id=a.property_id
  WHERE bi.booking_id=p_booking AND NOT app.scope_allows(p_actor,coalesce(s.destination_id,p.destination_id),p.id)
 ) THEN RAISE EXCEPTION 'SCOPE_FORBIDDEN' USING ERRCODE='42501'; END IF;
END $$;

CREATE FUNCTION app.create_quote(p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE p app.payment_policies; item jsonb; items jsonb:='[]'; snap jsonb; q app.quotes; d app.departures; a app.apartments; v app.service_variants; s app.services; rule app.price_rules; nightly app.apartment_rate_rules; fee app.apartment_fee_rules; n date; cin date; cout date; amount bigint; total bigint:=0; due bigint:=0; itemdue bigint; c text; currency text; qty integer; adults integer; children integer; title text; pos integer:=0; rate bigint; minimum integer; lines jsonb; kind text;
BEGIN
 IF length(coalesce(p_input->>'bindingHash',''))<32 THEN RAISE EXCEPTION 'INVALID_BINDING'; END IF;
 IF jsonb_array_length(p_input->'items') NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'INVALID_ITEMS'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app.locales WHERE code=p_input->>'locale' AND enabled) THEN RAISE EXCEPTION 'INVALID_LOCALE'; END IF;
 SELECT * INTO p FROM app.payment_policies WHERE type=p_input->>'paymentPolicy' AND approved_at IS NOT NULL ORDER BY version DESC LIMIT 1;
 IF p.id IS NULL THEN RAISE EXCEPTION 'PAYMENT_POLICY_UNAVAILABLE'; END IF;
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
   IF kind='addon' AND NOT EXISTS(SELECT 1 FROM app.service_addons sa WHERE sa.addon_variant_id=v.id AND sa.active AND qty BETWEEN sa.min_quantity AND sa.max_quantity) THEN RAISE EXCEPTION 'INVALID_ADDON'; END IF;
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
 VALUES(p_input->>'bindingHash',p_input->>'locale',currency,total,total,due,p.id,encode(public.digest(p_input::text,'sha256'),'hex'),p_input,to_jsonb(p),clock_timestamp()+interval '20 minutes') RETURNING * INTO q;
 INSERT INTO app.quote_items(quote_id,position,kind,variant_id,departure_id,apartment_id,parent_position,title,quantity,total,initial_due,snapshot)
 SELECT q.id,(x->>'position')::integer,x->>'kind',(x->>'variantId')::uuid,(x->>'departureId')::uuid,(x->>'apartmentId')::uuid,(x->>'parentPosition')::integer,x->>'title',(x->>'quantity')::integer,(x->>'total')::bigint,(x->>'initialDue')::bigint,x->'snapshot' FROM jsonb_array_elements(items) x;
 RETURN app.money_json(to_jsonb(q)||jsonb_build_object('items',items));
END $$;

CREATE FUNCTION app.copy_quote_items(p_booking uuid,p_quote uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
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
CREATE FUNCTION app.submit_booking(p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE q app.quotes; b app.bookings; g uuid; idem app.idempotency_records; hash text; x jsonb; expected integer;
BEGIN
 IF coalesce((p_input#>>'{consents,termsAccepted}')::boolean,false) IS NOT TRUE OR nullif(p_input#>>'{consents,termsVersion}','') IS NULL OR nullif(p_input#>>'{consents,privacyNoticeVersion}','') IS NULL THEN RAISE EXCEPTION 'POLICY_ACCEPTANCE_REQUIRED'; END IF;
 IF length(coalesce(p_input->>'idempotencyKey',''))<8 THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED'; END IF;
 hash:=encode(public.digest((p_input-'idempotencyKey'-'requestHash')::text,'sha256'),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(p_input->>'bindingHash'||':'||p_input->>'idempotencyKey',0));
 SELECT * INTO idem FROM app.idempotency_records WHERE caller_scope=p_input->>'bindingHash' AND operation='submit_booking' AND key_hash=encode(public.digest(p_input->>'idempotencyKey','sha256'),'hex');
 IF idem.id IS NOT NULL THEN
  IF idem.request_hash<>hash THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
  SELECT * INTO STRICT b FROM app.bookings WHERE id=idem.response_reference;RETURN app.money_json(to_jsonb(b));
 END IF;
 SELECT * INTO q FROM app.quotes WHERE id=(p_input->>'quoteId')::uuid FOR SHARE;
 IF q.id IS NULL OR q.binding_hash<>p_input->>'bindingHash' THEN RAISE EXCEPTION 'QUOTE_NOT_FOUND'; END IF;
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

CREATE FUNCTION app.allocate_booking(p_booking uuid,p_actor uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
DECLARE b app.bookings; item record; d app.departures; a app.apartments; used integer; exp timestamptz; st text;
BEGIN
 SELECT * INTO STRICT b FROM app.bookings WHERE id=p_booking;
 exp:=b.payment_deadline; st:=CASE WHEN b.initial_due_amount=0 THEN 'confirmed' ELSE 'held' END;
 -- Cross-type lock order is departures, units, resources; UUID order within each.
 PERFORM d.id FROM app.departures d WHERE d.id IN(SELECT t.departure_id FROM app.tour_booking_items t JOIN app.booking_items i ON i.id=t.booking_item_id WHERE i.booking_id=b.id AND i.superseded_at IS NULL) ORDER BY d.id FOR UPDATE;
 PERFORM a.id FROM app.apartments a WHERE a.id IN(SELECT s.apartment_id FROM app.apartment_stays s JOIN app.booking_items i ON i.id=s.booking_item_id WHERE i.booking_id=b.id AND i.superseded_at IS NULL) ORDER BY a.id FOR UPDATE;
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
CREATE FUNCTION app.approve_booking(p_booking uuid,p_expected integer,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
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
CREATE FUNCTION app.release_booking(p_booking uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
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
CREATE FUNCTION app.expire_payment_hold(p_booking uuid,p_now timestamptz DEFAULT clock_timestamp()) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
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
CREATE FUNCTION app.decide_booking(p_booking uuid,p_expected integer,p_actor uuid,p_action text,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
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
CREATE FUNCTION app.block_apartment(p_apartment uuid,p_start date,p_end date,p_reason text,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
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
CREATE FUNCTION app.assign_resource(p_resource uuid,p_departure uuid,p_item uuid,p_start timestamptz,p_end timestamptz,p_quantity integer,p_actor uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
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

CREATE FUNCTION app.confirm_if_paid(p_booking uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
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
CREATE FUNCTION app.create_payment_attempt(p_booking uuid,p_obligation uuid,p_key text,p_provider text,p_environment text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
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
CREATE FUNCTION app.apply_payment_event(p_event jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
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
   SELECT least(amount,greatest(0,o.amount-coalesce((SELECT sum(pa.amount) FROM app.payment_applications pa WHERE pa.obligation_id=o.id),0))) INTO applied FROM app.payment_obligations o WHERE o.id=a.obligation_id;
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
   SELECT coalesce(sum(amount) FILTER(WHERE amount>0),0),-coalesce(sum(amount) FILTER(WHERE amount<0),0) INTO captured,refunded FROM app.cash_ledger WHERE transaction_id=t.id;
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
CREATE FUNCTION app.record_offline_receipt(p_booking uuid,p_amount bigint,p_currency text,p_method text,p_reference text,p_key text,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
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
CREATE FUNCTION app.request_refund(p_booking uuid,p_transaction uuid,p_offline uuid,p_amount bigint,p_reason text,p_policy jsonb,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
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
CREATE FUNCTION app.approve_refund(p_refund uuid,p_expected integer,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
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
CREATE FUNCTION app.complete_offline_refund(p_refund uuid,p_key text,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
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
CREATE FUNCTION app.claim_jobs(p_worker text,p_limit integer,p_lease_seconds integer DEFAULT 60) RETURNS SETOF app.jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
BEGIN
 IF length(p_worker)<3 OR p_limit NOT BETWEEN 1 AND 100 OR p_lease_seconds NOT BETWEEN 10 AND 300 THEN RAISE EXCEPTION 'INVALID_LEASE'; END IF;
 RETURN QUERY WITH eligible AS(SELECT id FROM app.jobs WHERE run_after<=clock_timestamp() AND (status IN('pending','failed') OR(status='running' AND lease_until<clock_timestamp())) AND attempts<8 ORDER BY run_after,id FOR UPDATE SKIP LOCKED LIMIT p_limit)
 UPDATE app.jobs j SET status='running',attempts=j.attempts+1,lease_owner=p_worker,lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds) FROM eligible WHERE j.id=eligible.id RETURNING j.*;
END $$;
CREATE FUNCTION app.finish_job(p_job uuid,p_worker text,p_success boolean,p_failure text DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE count integer;
BEGIN
 UPDATE app.jobs SET status=CASE WHEN p_success THEN 'complete' WHEN attempts>=8 THEN 'dead' ELSE 'failed' END,completed_at=CASE WHEN p_success THEN clock_timestamp() END,failure_class=p_failure,run_after=clock_timestamp()+make_interval(secs=>least(3600,30*power(2,attempts)::integer)),lease_owner=NULL,lease_until=NULL WHERE id=p_job AND status='running' AND lease_owner=p_worker AND lease_until>clock_timestamp();
 GET DIAGNOSTICS count=ROW_COUNT; RETURN count=1;
END $$;

CREATE FUNCTION app.create_booking_request(p_booking uuid,p_type text,p_changes jsonb,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE b app.bookings; r app.booking_requests;
BEGIN
 SELECT * INTO b FROM app.bookings WHERE id=p_booking FOR SHARE;
 IF b.status NOT IN('pending_review','approved_pending_payment','confirmed') OR p_type NOT IN('change','cancel') OR length(trim(p_reason))<3 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 INSERT INTO app.booking_requests(booking_id,type,proposed_changes,reason) VALUES(b.id,p_type,p_changes,p_reason) RETURNING * INTO r;
 RETURN app.money_json(to_jsonb(r));
END $$;
CREATE FUNCTION app.propose_revision(p_booking uuid,p_expected integer,p_quote uuid,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
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
CREATE FUNCTION app.accept_revision(p_booking uuid,p_revision uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE r app.booking_revisions;
BEGIN
 SELECT * INTO r FROM app.booking_revisions WHERE id=p_revision AND booking_id=p_booking FOR UPDATE;
 IF r.status<>'proposed' THEN RAISE EXCEPTION 'INVALID_REVISION_STATE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app.quotes WHERE id=r.quote_id AND valid_until>clock_timestamp()) THEN RAISE EXCEPTION 'QUOTE_EXPIRED'; END IF;
 UPDATE app.booking_revisions SET guest_accepted_at=clock_timestamp(),status='accepted' WHERE id=r.id RETURNING * INTO r; RETURN app.money_json(to_jsonb(r));
END $$;
CREATE FUNCTION app.apply_revision(p_booking uuid,p_revision uuid,p_expected integer,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
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
CREATE FUNCTION app.fulfil_item(p_item uuid,p_state text,p_note text,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
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

ALTER TABLE app.access_grants ADD FOREIGN KEY(gallery_id) REFERENCES app.galleries(id);
ALTER TABLE app.access_grants ADD FOREIGN KEY(review_invitation_id) REFERENCES app.review_invitations(id);
ALTER TABLE app.photography_booking_items ADD FOREIGN KEY(package_id) REFERENCES app.photo_packages(id);
ALTER TABLE app.services ADD FOREIGN KEY(hero_asset_id) REFERENCES app.media_assets(id);
CREATE FUNCTION app.touch_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN NEW.updated_at=clock_timestamp();RETURN NEW;END $$;
CREATE FUNCTION app.enforce_item_details() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
DECLARE i app.booking_items; target uuid;
BEGIN
 target:=CASE WHEN TG_TABLE_NAME='booking_items' THEN NEW.id ELSE NEW.booking_item_id END;
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
CREATE CONSTRAINT TRIGGER item_details AFTER INSERT OR UPDATE ON app.booking_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.enforce_item_details();
CREATE FUNCTION app.enforce_application_limit() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
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
CREATE TRIGGER payment_application_guard BEFORE INSERT ON app.payment_applications FOR EACH ROW EXECUTE FUNCTION app.enforce_application_limit();
DO $$
DECLARE r record; n text;
BEGIN
 FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='app' LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',r.tablename);
  EXECUTE format('CREATE POLICY runtime_read ON app.%I FOR SELECT TO tourism_app USING (true)',r.tablename);
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='app' AND table_name=r.tablename AND column_name='updated_at') THEN
   EXECUTE format('CREATE TRIGGER touch_updated_at BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()',r.tablename);
  END IF;
 END LOOP;
 FOREACH n IN ARRAY ARRAY['quotes','quote_items','guest_consents','audit_events','exchange_rate_snapshots','booking_events','stay_nightly_prices','stay_events','fulfilment_events','provider_events','cash_ledger','payment_applications','receipts','outbox_events'] LOOP
  EXECUTE format('CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.deny_mutation()',n);
 END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC,anon,authenticated,tourism_app;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC,anon,authenticated,tourism_app;
REVOKE ALL ON SCHEMA app FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA app TO tourism_app;
GRANT SELECT ON ALL TABLES IN SCHEMA app TO tourism_app;
REVOKE ALL ON app.dive_sensitive_records FROM tourism_app;
-- Server-only operational writes. Browser roles have neither schema access nor grants.
DO $$
DECLARE n text;
BEGIN
 FOREACH n IN ARRAY ARRAY['access_grants','guest_sessions','local_operator_sessions','booking_requests','booking_notes','pickup_assignments','media_assets','media_subjects','publication_consents','media_derivatives','media_processing_jobs','photo_packages','photo_package_translations','galleries','gallery_assets','gallery_entitlements','photographer_assignments','download_events','public_gallery_translations','review_invitations','reviews','review_moderation_events','review_replies','cms_pages','cms_translations','social_links','contact_requests','notification_templates','notification_deliveries','integration_health','security_events','rate_limit_buckets','jobs'] LOOP
  EXECUTE format('GRANT INSERT,UPDATE ON app.%I TO tourism_app',n);
  EXECUTE format('CREATE POLICY runtime_insert ON app.%I FOR INSERT TO tourism_app WITH CHECK (true)',n);
  EXECUTE format('CREATE POLICY runtime_update ON app.%I FOR UPDATE TO tourism_app USING (true) WITH CHECK (true)',n);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION app.create_quote(jsonb),app.submit_booking(jsonb),app.approve_booking(uuid,integer,uuid),app.expire_payment_hold(uuid,timestamptz),app.decide_booking(uuid,integer,uuid,text,text),app.block_apartment(uuid,date,date,text,uuid),app.assign_resource(uuid,uuid,uuid,timestamptz,timestamptz,integer,uuid),app.create_payment_attempt(uuid,uuid,text,text,text),app.apply_payment_event(jsonb),app.record_offline_receipt(uuid,bigint,text,text,text,text,uuid),app.request_refund(uuid,uuid,uuid,bigint,text,jsonb,uuid),app.approve_refund(uuid,integer,uuid),app.complete_offline_refund(uuid,text,uuid),app.claim_jobs(text,integer,integer),app.finish_job(uuid,text,boolean,text),app.create_booking_request(uuid,text,jsonb,text),app.propose_revision(uuid,integer,uuid,uuid),app.accept_revision(uuid,uuid),app.apply_revision(uuid,uuid,integer,uuid),app.fulfil_item(uuid,text,text,uuid),app.has_permission(uuid,text),app.scope_allows(uuid,uuid,uuid) TO tourism_app;
-- Catalog is read through validated server queries; there are no private-schema Data API grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.consume_rate_limit(text,text,integer,integer),app.asset_publication_eligible(uuid),app.assert_public_gallery(uuid),app.assert_public_asset(uuid),app.money_json(jsonb) TO tourism_app;
