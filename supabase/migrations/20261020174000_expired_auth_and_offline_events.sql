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
 INSERT INTO app.outbox_events(aggregate_type,aggregate_id,aggregate_version,event_type,event_key,payload)
 VALUES('payment',ledger,1,'payment_received',ledger||':payment_received',jsonb_build_object('bookingId',b.id)) ON CONFLICT DO NOTHING;
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
 INSERT INTO app.outbox_events(aggregate_type,aggregate_id,aggregate_version,event_type,event_key,payload)
 VALUES('refund',r.id,r.version,'refund_completed',r.id||':completed',jsonb_build_object('bookingId',r.booking_id,'refundId',r.id)) ON CONFLICT DO NOTHING;
 RETURN app.money_json(to_jsonb(r));
END $$;