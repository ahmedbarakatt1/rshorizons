CREATE UNIQUE INDEX refund_attempts_provider_reference_unique ON app.refund_attempts(route,external_ref) WHERE external_ref IS NOT NULL;
CREATE FUNCTION app.claim_online_refund(p_refund uuid,p_expected integer,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE r app.refund_requests; t app.payment_transactions; a app.refund_attempts; captured bigint;
BEGIN
 SELECT * INTO r FROM app.refund_requests WHERE id=p_refund;
 IF r.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 PERFORM app.assert_staff(p_actor,'refunds.approve',r.booking_id);
 PERFORM 1 FROM app.bookings WHERE id=r.booking_id FOR UPDATE;
 SELECT * INTO r FROM app.refund_requests WHERE id=p_refund FOR UPDATE;
 IF r.status='succeeded' THEN RAISE EXCEPTION 'REFUND_ALREADY_COMPLETE';END IF;
 IF EXISTS(SELECT 1 FROM app.refund_attempts WHERE refund_request_id=r.id) THEN RAISE EXCEPTION 'REFUND_OUTCOME_PENDING';END IF;
 IF r.version IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 IF r.status<>'approved' OR r.original_transaction_id IS NULL OR r.approved_at IS NULL THEN RAISE EXCEPTION 'INVALID_REFUND_ROUTE';END IF;
 SELECT * INTO t FROM app.payment_transactions WHERE id=r.original_transaction_id FOR UPDATE;
 IF t.currency<>r.currency THEN RAISE EXCEPTION 'REFUND_CORRELATION_MISMATCH';END IF;
 IF EXISTS(SELECT 1 FROM app.refund_attempts pending JOIN app.refund_requests pr ON pr.id=pending.refund_request_id WHERE pr.original_transaction_id=t.id AND pending.state IN('creating','pending','unknown')) THEN RAISE EXCEPTION 'ORIGINAL_REFUND_OUTCOME_PENDING';END IF;
 SELECT coalesce(sum(amount),0) INTO captured FROM app.cash_ledger WHERE transaction_id=t.id AND booking_id=r.booking_id;
 IF r.amount>captured THEN RAISE EXCEPTION 'REFUND_EXCEEDS_RECEIPT';END IF;
 INSERT INTO app.refund_attempts(refund_request_id,route,request_key,state) VALUES(r.id,t.provider||':'||t.account||':'||t.environment,'refund:'||r.id,'unknown') RETURNING * INTO a;
 UPDATE app.refund_requests SET status='processing',version=version+1 WHERE id=r.id RETURNING * INTO r;
 INSERT INTO app.financial_exceptions(booking_id,kind,dedupe_key) VALUES(r.booking_id,'unknown_outcome','refund:'||a.id) ON CONFLICT(dedupe_key) DO NOTHING;
 INSERT INTO app.audit_events(actor_type,actor_id,action,target_type,target_id,summary) VALUES('staff',p_actor,'refund_claimed','refund',r.id,jsonb_build_object('attemptId',a.id));
 RETURN app.money_json(to_jsonb(a)||jsonb_build_object('original_transaction_id',t.id,'transaction_id',t.transaction_id,'provider',t.provider,'account',t.account,'environment',t.environment,'amount',r.amount::text,'currency',r.currency,'version',r.version));
END $$;
CREATE FUNCTION app.save_online_refund_reference(p_attempt uuid,p_provider_ref text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE a app.refund_attempts; r app.refund_requests;
BEGIN
 SELECT * INTO a FROM app.refund_attempts WHERE id=p_attempt;
 IF a.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 SELECT * INTO r FROM app.refund_requests WHERE id=a.refund_request_id;
 PERFORM 1 FROM app.bookings WHERE id=r.booking_id FOR UPDATE;
 PERFORM 1 FROM app.refund_requests WHERE id=r.id FOR UPDATE;
 SELECT * INTO a FROM app.refund_attempts WHERE id=p_attempt FOR UPDATE;
 IF a.external_ref IS NOT NULL AND p_provider_ref IS NOT NULL AND a.external_ref<>p_provider_ref THEN RAISE EXCEPTION 'REFUND_CORRELATION_MISMATCH';END IF;
 IF a.state='succeeded' THEN RETURN to_jsonb(a);END IF;
 IF a.route='offline' OR a.state NOT IN('creating','pending','unknown') THEN RAISE EXCEPTION 'INVALID_REFUND_ROUTE';END IF;
 UPDATE app.refund_attempts SET external_ref=coalesce(p_provider_ref,external_ref),state='unknown' WHERE id=a.id RETURNING * INTO a;
 INSERT INTO app.financial_exceptions(booking_id,kind,dedupe_key) VALUES(r.booking_id,'unknown_outcome','refund:'||a.id) ON CONFLICT(dedupe_key) DO NOTHING;
 RETURN to_jsonb(a);
END $$;
CREATE FUNCTION app.complete_online_refund(p_attempt uuid,p_provider_ref text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE a app.refund_attempts; r app.refund_requests; t app.payment_transactions; effect text; prior app.cash_ledger; captured bigint; event uuid;
BEGIN
 IF nullif(btrim(p_provider_ref),'') IS NULL THEN RAISE EXCEPTION 'REFUND_CORRELATION_MISMATCH';END IF;
 SELECT * INTO a FROM app.refund_attempts WHERE id=p_attempt;
 IF a.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 SELECT * INTO r FROM app.refund_requests WHERE id=a.refund_request_id;
 PERFORM 1 FROM app.bookings WHERE id=r.booking_id FOR UPDATE;
 SELECT * INTO r FROM app.refund_requests WHERE id=r.id FOR UPDATE;
 SELECT * INTO a FROM app.refund_attempts WHERE id=p_attempt FOR UPDATE;
 SELECT * INTO t FROM app.payment_transactions WHERE id=r.original_transaction_id FOR UPDATE;
 IF t.id IS NULL OR a.route<>t.provider||':'||t.account||':'||t.environment OR(a.external_ref IS NOT NULL AND a.external_ref<>p_provider_ref) THEN RAISE EXCEPTION 'REFUND_CORRELATION_MISMATCH';END IF;
 IF a.state='succeeded' AND r.status='succeeded' THEN RETURN app.money_json(to_jsonb(r));END IF;
 IF r.status<>'processing' OR a.state NOT IN('creating','pending','unknown') THEN RAISE EXCEPTION 'INVALID_REFUND_STATE';END IF;
 effect:=t.id||':refunded:'||p_provider_ref;
 SELECT * INTO prior FROM app.cash_ledger WHERE effect_key=effect;
 IF prior.id IS NOT NULL THEN
  IF prior.booking_id<>r.booking_id OR prior.transaction_id<>t.id OR prior.amount<>-r.amount OR prior.currency<>r.currency OR(prior.refund_request_id IS NOT NULL AND prior.refund_request_id<>r.id) THEN RAISE EXCEPTION 'REFUND_CORRELATION_MISMATCH';END IF;
 ELSE
  SELECT coalesce(sum(amount),0) INTO captured FROM app.cash_ledger WHERE transaction_id=t.id AND booking_id=r.booking_id;
  IF r.amount>captured THEN RAISE EXCEPTION 'REFUND_EXCEEDS_RECEIPT';END IF;
  INSERT INTO app.cash_ledger(booking_id,source,amount,currency,transaction_id,refund_request_id,effect_key) VALUES(r.booking_id,'refund',-r.amount,r.currency,t.id,r.id,effect);
 END IF;
 UPDATE app.refund_attempts SET state='succeeded',external_ref=p_provider_ref WHERE id=a.id;
 UPDATE app.refund_requests SET status='succeeded',version=version+1 WHERE id=r.id RETURNING * INTO r;
 UPDATE app.financial_exceptions SET state='resolved',resolution=jsonb_build_object('verifiedProviderRefund',p_provider_ref,'refundId',r.id),version=version+1 WHERE dedupe_key='refund:'||a.id AND state='open';
 INSERT INTO app.outbox_events(aggregate_type,aggregate_id,aggregate_version,event_type,event_key,payload) VALUES('refund',r.id,r.version,'refund_completed',r.id||':completed',jsonb_build_object('bookingId',r.booking_id,'refundId',r.id)) ON CONFLICT DO NOTHING RETURNING id INTO event;
 IF event IS NOT NULL THEN INSERT INTO app.jobs(event_id,kind,job_key) VALUES(event,'notification',event||':notification');END IF;
 INSERT INTO app.audit_events(actor_type,action,target_type,target_id,summary) VALUES('system','refund_completed','refund',r.id,jsonb_build_object('attemptId',a.id));
 RETURN app.money_json(to_jsonb(r));
END $$;
REVOKE ALL ON FUNCTION app.claim_online_refund(uuid,integer,uuid),app.save_online_refund_reference(uuid,text),app.complete_online_refund(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app.claim_online_refund(uuid,integer,uuid),app.save_online_refund_reference(uuid,text),app.complete_online_refund(uuid,text) TO tourism_app;
