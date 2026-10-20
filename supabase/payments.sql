CREATE FUNCTION app.confirm_if_paid(p_booking uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
DECLARE b app.bookings; paid bigint;
BEGIN
 SELECT * INTO STRICT b FROM app.bookings WHERE id=p_booking FOR UPDATE;
 SELECT coalesce(sum(amount),0) INTO paid FROM app.cash_ledger WHERE booking_id=b.id AND currency=b.currency;
 IF b.status='approved_pending_payment' AND b.approved_at IS NOT NULL AND b.payment_deadline>clock_timestamp() AND paid>=b.initial_due_amount
 AND NOT EXISTS(SELECT 1 FROM app.booking_items i WHERE i.booking_id=b.id AND i.superseded_at IS NULL AND
   (((i.kind='tour' OR(i.kind='transfer' AND EXISTS(SELECT 1 FROM app.quote_items qi WHERE qi.id=i.quote_item_id AND qi.departure_id IS NOT NULL))) AND NOT EXISTS(SELECT 1 FROM app.capacity_allocations c WHERE c.booking_item_id=i.id AND c.state IN('held','confirmed')))
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
 IF a.id IS NOT NULL THEN IF a.booking_id<>p_booking OR a.obligation_id<>p_obligation OR a.provider<>p_provider OR a.environment<>p_environment THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF; RETURN to_jsonb(a); END IF;
 IF b.status NOT IN('approved_pending_payment','confirmed') OR b.approved_at IS NULL THEN RAISE EXCEPTION 'PAYMENT_NOT_ELIGIBLE'; END IF;
 IF b.status='approved_pending_payment' AND b.payment_deadline<=clock_timestamp() THEN RAISE EXCEPTION 'PAYMENT_HOLD_EXPIRED'; END IF;
 SELECT * INTO o FROM app.payment_obligations WHERE id=p_obligation AND booking_id=b.id AND status='open';
 IF o.id IS NULL THEN RAISE EXCEPTION 'OBLIGATION_UNAVAILABLE'; END IF;
 SELECT coalesce(sum(amount),0) INTO paid FROM app.payment_applications WHERE obligation_id=o.id;
 SELECT coalesce(sum(expected_amount),0) INTO pending FROM app.payment_attempts WHERE obligation_id=o.id AND status IN('creating','pending','unknown');
 collectible:=o.amount-paid-pending;
 IF collectible<=0 THEN RAISE EXCEPTION 'PAYMENT_ALREADY_PENDING_OR_PAID'; END IF;
 INSERT INTO app.payment_attempts(booking_id,obligation_id,provider,environment,request_key,expected_amount,currency,checkout_expires_at) VALUES(b.id,o.id,p_provider,p_environment,p_key,collectible,b.currency,coalesce(b.payment_deadline,clock_timestamp()+interval '60 minutes')) RETURNING * INTO a;
 RETURN to_jsonb(a);
END $$;
CREATE FUNCTION app.apply_payment_event(p_event jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
<<payment>>
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
   SELECT least(payment.amount,greatest(0,o.amount-coalesce((SELECT sum(pa.amount) FROM app.payment_applications pa WHERE pa.obligation_id=o.id),0))) INTO applied FROM app.payment_obligations o WHERE o.id=a.obligation_id;
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
   SELECT coalesce(sum(cl.amount) FILTER(WHERE cl.amount>0),0),-coalesce(sum(cl.amount) FILTER(WHERE cl.amount<0),0) INTO captured,refunded FROM app.cash_ledger cl WHERE cl.transaction_id=t.id;
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
 IF r.id IS NOT NULL THEN IF r.booking_id<>p_booking OR r.amount<>p_amount OR r.currency<>p_currency OR r.method<>p_method THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;RETURN to_jsonb(r);END IF;
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
 RETURN to_jsonb(r);
END $$;
CREATE FUNCTION app.request_refund(p_booking uuid,p_transaction uuid,p_offline uuid,p_amount bigint,p_reason text,p_policy jsonb,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE b app.bookings; r app.refund_requests; captured bigint; reserved bigint; bound_policy jsonb; item_policies jsonb;
BEGIN
 PERFORM app.assert_staff(p_actor,'refunds.request',p_booking);
 SELECT * INTO b FROM app.bookings WHERE id=p_booking FOR UPDATE;
 IF p_amount<=0 OR num_nonnulls(p_transaction,p_offline)<>1 OR length(trim(p_reason))<3 THEN RAISE EXCEPTION 'INVALID_REFUND'; END IF;
 SELECT coalesce(sum(amount),0) INTO captured FROM app.cash_ledger WHERE booking_id=b.id AND (transaction_id=p_transaction OR offline_receipt_id=p_offline);
 SELECT coalesce(sum(amount),0) INTO reserved FROM app.refund_requests WHERE booking_id=b.id AND status IN('requested','approved','processing') AND (original_transaction_id=p_transaction OR original_offline_receipt_id=p_offline);
 IF p_amount>captured-reserved THEN RAISE EXCEPTION 'REFUND_EXCEEDS_RECEIPT'; END IF;
 -- The textual policy requires an authorized manual decision; client JSON cannot
 -- invent an automatic entitlement or replace the policy the guest accepted.
 SELECT coalesce(jsonb_agg(jsonb_build_object('bookingItemId',bi.id,'quoteItemId',qi.id,'cancellationPolicy',qi.snapshot->'cancellationPolicy','fees',coalesce(qi.snapshot->'fees','[]')) ORDER BY qi.position),'[]')
 INTO item_policies FROM app.booking_items bi JOIN app.quote_items qi ON qi.id=bi.quote_item_id WHERE bi.booking_id=b.id AND bi.superseded_at IS NULL;
 bound_policy:=jsonb_build_object('manual',true,'calculationMode','authorized_manual_review','acceptedQuoteId',b.accepted_quote_id,
 'acceptedPolicySnapshot',b.policy_snapshot,'acceptedItemPolicies',item_policies,'requestedAmountMinor',p_amount::text,
 'sourceReceiptId',coalesce(p_transaction,p_offline),'sourceKind',CASE WHEN p_transaction IS NOT NULL THEN 'online_transaction' ELSE 'offline_receipt' END,
 'availableAmountMinor',(captured-reserved)::text,'currency',b.currency,'operatorRationale',p_reason,'requestedBy',p_actor);
 INSERT INTO app.refund_requests(booking_id,original_transaction_id,original_offline_receipt_id,amount,currency,reason,policy_calculation,requested_by) VALUES(b.id,p_transaction,p_offline,p_amount,b.currency,p_reason,bound_policy,p_actor) RETURNING * INTO r;
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
 RETURN to_jsonb(r);
END $$;
CREATE FUNCTION app.complete_offline_refund(p_refund uuid,p_key text,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE r app.refund_requests; captured bigint;
BEGIN
 SELECT * INTO r FROM app.refund_requests WHERE id=p_refund;
 PERFORM app.assert_staff(p_actor,'refunds.approve',r.booking_id);
 PERFORM 1 FROM app.bookings WHERE id=r.booking_id FOR UPDATE;
 SELECT * INTO r FROM app.refund_requests WHERE id=p_refund FOR UPDATE;
 IF r.status='succeeded' THEN RETURN to_jsonb(r); END IF;
 IF r.status<>'approved' OR r.original_offline_receipt_id IS NULL THEN RAISE EXCEPTION 'INVALID_REFUND_ROUTE'; END IF;
 SELECT coalesce(sum(amount),0) INTO captured FROM app.cash_ledger WHERE offline_receipt_id=r.original_offline_receipt_id;
 IF r.amount>captured THEN RAISE EXCEPTION 'REFUND_EXCEEDS_RECEIPT'; END IF;
 INSERT INTO app.refund_attempts(refund_request_id,route,request_key,state) VALUES(r.id,'offline',p_key,'succeeded');
 INSERT INTO app.cash_ledger(booking_id,source,amount,currency,offline_receipt_id,refund_request_id,effect_key,actor_id) VALUES(r.booking_id,'refund',-r.amount,r.currency,r.original_offline_receipt_id,r.id,'refund:'||r.id,p_actor);
 UPDATE app.refund_requests SET status='succeeded',version=version+1 WHERE id=r.id RETURNING * INTO r;
 INSERT INTO app.outbox_events(aggregate_type,aggregate_id,aggregate_version,event_type,event_key,payload)
 VALUES('refund',r.id,r.version,'refund_completed',r.id||':completed',jsonb_build_object('bookingId',r.booking_id,'refundId',r.id)) ON CONFLICT DO NOTHING;
 RETURN to_jsonb(r);
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
