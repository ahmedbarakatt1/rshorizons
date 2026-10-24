# Notification operations

Outbox events commit with domain changes. The bounded worker materializes jobs, claims a lease immediately before processing and records complete/failed/dead outcomes. Restarting a process does not remove committed work.

Templates are separate from UI translations. The operator must approve the event/channel/locale template and provider name before it can send. The owner selected OpenWA: WhatsApp requires booking-update opt-in and approved localized text; see [gateway setup](openwa.md). The retained Meta adapter requires Meta-approved templates if explicitly selected. Email fallback uses a verified Resend sender. Marketing/publication consent is not inferred from a booking update preference.

Local adapters write synthetic `.invalid` previews under ignored `.local/outbox`. They do not send email or WhatsApp. Staging restricts recipients to the configured allowlist. Provider acceptance and actual delivery callbacks have distinct statuses; callbacks are signature-checked and deduplicated.

Review notification/job failures in the staff dashboard. Correct missing templates, disabled consent, sender verification, provider errors or configuration before retrying. Do not change a booking's financial status to repair a failed notification. Pickup/payment reminders recheck current booking/deadline state at delivery.

Alerts cover dead jobs and prolonged pending work. A failed alert delivery must itself be visible in hosting logs/monitoring. Before launch, verify actual approved recipients receive each core journey event and that webhook statuses advance without duplicate sends.
