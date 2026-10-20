CREATE FUNCTION app.create_booking_request(p_booking uuid,p_type text,p_changes jsonb,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE b app.bookings; r app.booking_requests;
BEGIN
 SELECT * INTO b FROM app.bookings WHERE id=p_booking FOR SHARE;
 IF b.status NOT IN('pending_review','approved_pending_payment','confirmed') OR p_type NOT IN('change','cancel') OR length(trim(p_reason))<3 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 INSERT INTO app.booking_requests(booking_id,type,proposed_changes,reason) VALUES(b.id,p_type,p_changes,p_reason) RETURNING * INTO r;
 RETURN to_jsonb(r);
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
 RETURN to_jsonb(r);
END $$;
CREATE FUNCTION app.accept_revision(p_booking uuid,p_revision uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE r app.booking_revisions;
BEGIN
 SELECT * INTO r FROM app.booking_revisions WHERE id=p_revision AND booking_id=p_booking FOR UPDATE;
 IF r.status<>'proposed' THEN RAISE EXCEPTION 'INVALID_REVISION_STATE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app.quotes WHERE id=r.quote_id AND valid_until>clock_timestamp()) THEN RAISE EXCEPTION 'QUOTE_EXPIRED'; END IF;
 UPDATE app.booking_revisions SET guest_accepted_at=clock_timestamp(),status='accepted' WHERE id=r.id RETURNING * INTO r; RETURN to_jsonb(r);
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
 RETURN to_jsonb(b);
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
