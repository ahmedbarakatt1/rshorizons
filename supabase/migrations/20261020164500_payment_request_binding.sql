ALTER TABLE app.payment_attempts ADD COLUMN request_hash text CHECK(request_hash ~ '^[a-f0-9]{64}$');

CREATE FUNCTION app.create_payment_attempt_bound(p_booking uuid,p_obligation uuid,p_key text,p_provider text,p_environment text,p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE prior app.payment_attempts; result jsonb;
BEGIN
 IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'INVALID_REQUEST_HASH';END IF;
 -- The global request-key lock precedes the booking lock in the existing allocator.
 PERFORM pg_advisory_xact_lock(hashtextextended('payment-request:'||p_key,0));
 SELECT * INTO prior FROM app.payment_attempts WHERE request_key=p_key;
 IF prior.id IS NOT NULL THEN
  IF prior.booking_id<>p_booking OR prior.obligation_id<>p_obligation OR prior.provider<>p_provider OR prior.environment<>p_environment OR prior.request_hash IS DISTINCT FROM p_hash THEN
   RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';
  END IF;
  RETURN app.money_json(to_jsonb(prior));
 END IF;
 result:=app.create_payment_attempt(p_booking,p_obligation,p_key,p_provider,p_environment);
 UPDATE app.payment_attempts SET request_hash=p_hash WHERE id=(result->>'id')::uuid RETURNING app.money_json(to_jsonb(payment_attempts)) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION app.create_payment_attempt_bound(uuid,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app.create_payment_attempt_bound(uuid,uuid,text,text,text,text) TO tourism_app;
