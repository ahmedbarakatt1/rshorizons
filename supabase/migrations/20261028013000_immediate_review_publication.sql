-- Owner decision: guest reviews publish immediately. Staff may withdraw or restore
-- individual reviews, but there is no approval queue.

CREATE OR REPLACE FUNCTION app.enforce_review_submission() RETURNS trigger
LANGUAGE plpgsql SECURITY invoker SET search_path = pg_catalog, app AS $$
DECLARE v_invitation app.review_invitations;
BEGIN
  IF new.source='public' THEN
    IF new.invitation_id IS NOT NULL OR new.booking_item_id IS NOT NULL OR new.primary_guest_id IS NOT NULL THEN
      RAISE EXCEPTION 'Public review cannot claim a verified booking' USING errcode='23514';
    END IF;
    new.submitted_at := now();
    new.moderation_state := 'published';
    new.published_at := now();
    RETURN new;
  END IF;

  SELECT * INTO v_invitation FROM app.review_invitations WHERE id=new.invitation_id FOR UPDATE;
  IF NOT FOUND OR v_invitation.booking_item_id<>new.booking_item_id
    OR v_invitation.eligible_at>now() OR v_invitation.expires_at<=now()
    OR v_invitation.used_at IS NOT NULL OR v_invitation.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Review invitation is unavailable' USING errcode='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM app.booking_items bi JOIN app.bookings b ON b.id=bi.booking_id
    WHERE bi.id=new.booking_item_id AND bi.fulfilment_state='fulfilled'
      AND b.primary_guest_id=new.primary_guest_id
  ) THEN RAISE EXCEPTION 'Review requires the completed item and its primary guest' USING errcode='23514'; END IF;

  new.submitted_at := now();
  new.moderation_state := 'published';
  new.published_at := now();
  UPDATE app.review_invitations SET used_at=now() WHERE id=new.invitation_id;
  RETURN new;
END;
$$;

UPDATE app.reviews
SET moderation_state='published',
    published_at=coalesce(published_at,now()),
    version=version+1,
    updated_at=now()
WHERE moderation_state='pending';
