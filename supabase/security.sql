ALTER TABLE app.access_grants ADD FOREIGN KEY(gallery_id) REFERENCES app.galleries(id);
ALTER TABLE app.access_grants ADD FOREIGN KEY(review_invitation_id) REFERENCES app.review_invitations(id);
ALTER TABLE app.photography_booking_items ADD FOREIGN KEY(package_id) REFERENCES app.photo_packages(id);
ALTER TABLE app.services ADD FOREIGN KEY(hero_asset_id) REFERENCES app.media_assets(id);
CREATE FUNCTION app.touch_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN NEW.updated_at=clock_timestamp();RETURN NEW;END $$;
CREATE FUNCTION app.enforce_item_details() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
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
