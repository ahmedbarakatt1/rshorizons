-- Owner-selected OpenWA gateway. Preserve immutable delivery receipts and existing Meta rows.
ALTER TABLE app.messaging_webhook_receipts DROP CONSTRAINT messaging_webhook_receipts_provider_check;
ALTER TABLE app.messaging_webhook_receipts ADD CONSTRAINT messaging_webhook_receipts_provider_check
  CHECK(provider IN('resend','meta','openwa'));

-- OpenWA sends agency-approved localized text. Meta still requires approved provider template IDs/languages.
ALTER TABLE app.notification_templates DROP CONSTRAINT notification_templates_check;
ALTER TABLE app.notification_templates ADD CONSTRAINT notification_templates_check CHECK (
  channel <> 'whatsapp' OR approval_status <> 'approved' OR
  (provider='meta' AND provider_template_id IS NOT NULL AND provider_language IS NOT NULL) OR
  (provider='openwa' AND length(trim(body_template)) BETWEEN 1 AND 4096)
);
