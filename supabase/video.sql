-- Server-only provider correlation and delivery deduplication. No raw payloads.
CREATE TABLE app.video_ingestions(
 asset_id uuid PRIMARY KEY REFERENCES app.media_assets(id),
 provider text NOT NULL,
 provider_upload_id text UNIQUE,
 provider_asset_id text UNIQUE,
 state text NOT NULL CHECK(state IN('creating','uploading','processing','ready','failed','unknown')),
 attempt_key text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.provider_webhook_events(
 id text PRIMARY KEY,
 provider text NOT NULL,
 event_type text NOT NULL,
 body_hash text NOT NULL CHECK(body_hash ~ '^[a-f0-9]{64}$'),
 received_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.video_ingestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.provider_webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY runtime_read ON app.video_ingestions FOR SELECT TO tourism_app USING(true);
CREATE POLICY runtime_insert ON app.video_ingestions FOR INSERT TO tourism_app WITH CHECK(true);
CREATE POLICY runtime_update ON app.video_ingestions FOR UPDATE TO tourism_app USING(true) WITH CHECK(true);
CREATE POLICY runtime_read ON app.provider_webhook_events FOR SELECT TO tourism_app USING(true);
CREATE POLICY runtime_insert ON app.provider_webhook_events FOR INSERT TO tourism_app WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON app.video_ingestions TO tourism_app;
GRANT SELECT,INSERT ON app.provider_webhook_events TO tourism_app;
REVOKE ALL ON app.video_ingestions,app.provider_webhook_events FROM PUBLIC,anon,authenticated;
CREATE TRIGGER provider_webhook_events_immutable BEFORE UPDATE OR DELETE ON app.provider_webhook_events FOR EACH ROW EXECUTE FUNCTION app.deny_mutation();
CREATE TRIGGER video_ingestions_updated_at BEFORE UPDATE ON app.video_ingestions FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
ALTER TABLE app.media_derivatives DROP CONSTRAINT media_derivatives_kind_check;
ALTER TABLE app.media_derivatives ADD CONSTRAINT media_derivatives_kind_check CHECK(kind IN('thumbnail','web','preview','original','video-poster','video'));
ALTER TABLE app.media_derivatives ADD COLUMN mime_type text NOT NULL DEFAULT 'image/webp' CHECK(mime_type ~ '^(image|video)/[a-zA-Z0-9.+-]+$');
ALTER TABLE app.gallery_entitlements DROP CONSTRAINT gallery_entitlements_allowed_variants_check;
ALTER TABLE app.gallery_entitlements ADD CONSTRAINT gallery_entitlements_allowed_variants_check CHECK(cardinality(allowed_variants)>0 AND allowed_variants <@ ARRAY['thumbnail','web','preview','original','video-poster','video']::text[]);
CREATE TABLE app.messaging_webhook_receipts(
 provider text NOT NULL CHECK(provider IN('resend','meta')),
 account text NOT NULL,
 environment text NOT NULL CHECK(environment IN('local','sandbox','production')),
 event_key text NOT NULL,
 event_kind text NOT NULL,
 provider_message_id text,
 verified_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(provider,account,environment,event_key)
);
ALTER TABLE app.messaging_webhook_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY runtime_read ON app.messaging_webhook_receipts FOR SELECT TO tourism_app USING(true);
CREATE POLICY runtime_insert ON app.messaging_webhook_receipts FOR INSERT TO tourism_app WITH CHECK(true);
GRANT SELECT,INSERT ON app.messaging_webhook_receipts TO tourism_app;
REVOKE ALL ON app.messaging_webhook_receipts FROM PUBLIC,anon,authenticated;
CREATE TRIGGER messaging_webhook_receipts_immutable BEFORE UPDATE OR DELETE ON app.messaging_webhook_receipts FOR EACH ROW EXECUTE FUNCTION app.deny_mutation();
