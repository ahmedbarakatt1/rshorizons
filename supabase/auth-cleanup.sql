-- Erase only expired authentication material. Preserve foreign-key identities,
-- download records and all financial/audit/consent history.
ALTER TABLE app.guest_sessions ADD COLUMN token_erased_at timestamptz;
ALTER TABLE app.access_grants ADD COLUMN token_erased_at timestamptz;
ALTER TABLE app.local_operator_sessions ADD COLUMN token_erased_at timestamptz;
CREATE INDEX guest_sessions_token_expiry ON app.guest_sessions(expires_at,id) WHERE token_erased_at IS NULL;
CREATE INDEX access_grants_token_expiry ON app.access_grants(expires_at,id) WHERE token_erased_at IS NULL;
CREATE INDEX local_operator_token_expiry ON app.local_operator_sessions(expires_at,id) WHERE token_erased_at IS NULL;
CREATE FUNCTION app.cleanup_expired_auth(p_limit integer DEFAULT 100) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE cutoff timestamptz:=clock_timestamp(); remaining integer:=p_limit; sessions integer:=0; grants integer:=0; operators integer:=0; buckets integer:=0;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'INVALID_CLEANUP_LIMIT';END IF;
 WITH eligible AS(SELECT id FROM app.guest_sessions WHERE expires_at<=cutoff AND token_erased_at IS NULL ORDER BY expires_at,id FOR UPDATE SKIP LOCKED LIMIT remaining)
 UPDATE app.guest_sessions s SET session_hash='expired:'||encode(public.gen_random_bytes(32),'hex'),token_erased_at=cutoff FROM eligible e WHERE s.id=e.id;
 GET DIAGNOSTICS sessions=ROW_COUNT;remaining:=remaining-sessions;
 WITH eligible AS(SELECT id FROM app.access_grants WHERE expires_at<=cutoff AND token_erased_at IS NULL ORDER BY expires_at,id FOR UPDATE SKIP LOCKED LIMIT remaining)
 UPDATE app.access_grants g SET token_hash='expired:'||encode(public.gen_random_bytes(32),'hex'),token_erased_at=cutoff FROM eligible e WHERE g.id=e.id;
 GET DIAGNOSTICS grants=ROW_COUNT;remaining:=remaining-grants;
 WITH eligible AS(SELECT id FROM app.local_operator_sessions WHERE expires_at<=cutoff AND token_erased_at IS NULL ORDER BY expires_at,id FOR UPDATE SKIP LOCKED LIMIT remaining)
 UPDATE app.local_operator_sessions s SET token_hash='expired:'||encode(public.gen_random_bytes(32),'hex'),token_erased_at=cutoff FROM eligible e WHERE s.id=e.id;
 GET DIAGNOSTICS operators=ROW_COUNT;remaining:=remaining-operators;
 WITH eligible AS(SELECT id FROM app.rate_limit_buckets WHERE resets_at<=cutoff ORDER BY resets_at,id FOR UPDATE SKIP LOCKED LIMIT remaining)
 DELETE FROM app.rate_limit_buckets b USING eligible e WHERE b.id=e.id;
 GET DIAGNOSTICS buckets=ROW_COUNT;
 RETURN jsonb_build_object('sessions',sessions,'grants',grants,'operators',operators,'buckets',buckets,'total',sessions+grants+operators+buckets);
END $$;
REVOKE ALL ON FUNCTION app.cleanup_expired_auth(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app.cleanup_expired_auth(integer) TO tourism_app;
