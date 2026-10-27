-- Allow unsolicited guest feedback while preserving the verified-trip path.
-- Every review still enters moderation as pending; only staff can publish it.

ALTER TABLE app.reviews ALTER COLUMN invitation_id DROP NOT NULL;
ALTER TABLE app.reviews ALTER COLUMN booking_item_id DROP NOT NULL;
ALTER TABLE app.reviews ALTER COLUMN primary_guest_id DROP NOT NULL;
ALTER TABLE app.reviews ADD COLUMN source text NOT NULL DEFAULT 'verified'
  CHECK(source IN('verified','public'));
ALTER TABLE app.reviews ADD CONSTRAINT reviews_source_integrity CHECK (
  (source='verified' AND invitation_id IS NOT NULL AND booking_item_id IS NOT NULL AND primary_guest_id IS NOT NULL)
  OR
  (source='public' AND invitation_id IS NULL AND booking_item_id IS NULL AND primary_guest_id IS NULL)
);

CREATE OR REPLACE FUNCTION app.enforce_review_submission() RETURNS trigger
LANGUAGE plpgsql SECURITY invoker SET search_path = pg_catalog, app AS $$
DECLARE v_invitation app.review_invitations;
BEGIN
  IF new.source='public' THEN
    IF new.invitation_id IS NOT NULL OR new.booking_item_id IS NOT NULL OR new.primary_guest_id IS NOT NULL THEN
      RAISE EXCEPTION 'Public review cannot claim a verified booking' USING errcode='23514';
    END IF;
    new.submitted_at := now();
    new.moderation_state := 'pending';
    new.published_at := NULL;
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
  UPDATE app.review_invitations SET used_at=now() WHERE id=new.invitation_id;
  RETURN new;
END;
$$;

CREATE OR REPLACE FUNCTION app.protect_review_original() RETURNS trigger
LANGUAGE plpgsql SECURITY invoker SET search_path = pg_catalog, app AS $$
BEGIN
  IF tg_op='DELETE' THEN RAISE EXCEPTION 'Reviews must be withdrawn, not deleted' USING errcode='23514'; END IF;
  IF row(new.id,new.source,new.invitation_id,new.booking_item_id,new.primary_guest_id,new.rating,new.original_text,new.original_locale,new.submitted_at,new.display_name_preference,new.public_display_name)
    IS DISTINCT FROM row(old.id,old.source,old.invitation_id,old.booking_item_id,old.primary_guest_id,old.rating,old.original_text,old.original_locale,old.submitted_at,old.display_name_preference,old.public_display_name)
  THEN RAISE EXCEPTION 'Submitted review identity, rating and text are immutable' USING errcode='23514'; END IF;
  RETURN new;
END;
$$;
