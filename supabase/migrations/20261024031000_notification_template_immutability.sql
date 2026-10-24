-- Template IDs pin durable sends. Once approved, changes require a new versioned row.
ALTER TABLE app.notification_templates ADD COLUMN content_locked_at timestamptz;
UPDATE app.notification_templates t SET content_locked_at=now()
 WHERE approval_status IN('approved','paused','disabled')
 OR EXISTS(SELECT 1 FROM app.notification_deliveries d WHERE d.template_id=t.id);

CREATE FUNCTION app.guard_notification_template() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,app AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.content_locked_at IS NOT NULL THEN RAISE EXCEPTION 'APPROVED_TEMPLATE_IMMUTABLE' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='INSERT' THEN
  NEW.content_locked_at=CASE WHEN NEW.approval_status='approved' THEN now() ELSE NULL END;
 ELSE
  IF OLD.content_locked_at IS NOT NULL AND
    (to_jsonb(NEW)-ARRAY['approval_status','updated_at','version','content_locked_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['approval_status','updated_at','version','content_locked_at'])
  THEN RAISE EXCEPTION 'APPROVED_TEMPLATE_IMMUTABLE' USING ERRCODE='23514'; END IF;
  NEW.content_locked_at=coalesce(OLD.content_locked_at,CASE WHEN NEW.approval_status='approved' THEN now() END);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER notification_template_content_guard BEFORE INSERT OR UPDATE OR DELETE ON app.notification_templates
 FOR EACH ROW EXECUTE FUNCTION app.guard_notification_template();
REVOKE ALL ON FUNCTION app.guard_notification_template() FROM PUBLIC,anon,authenticated;
