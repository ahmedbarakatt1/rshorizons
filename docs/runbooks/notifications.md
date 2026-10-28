# Notification operations

Outbox events commit with domain changes. The bounded worker materializes jobs, claims a lease immediately before processing and records complete/failed/dead outcomes. Restarting a process does not remove committed work.

Templates are separate from UI translations. The operator must approve each event/email/locale template and Resend sender before automatic delivery. Production validation requires every supported guest event in every enabled language plus the configured staff alert. Review invitations may use reviewed marketing classification and then require marketing consent. Publication consent is independent.

WhatsApp uses [manual links](whatsapp-links.md), replacing OpenWA/Meta sends. Phone-only events appear as `MANUAL_CONTACT_REQUIRED` in the dashboard; authorized staff open the booking to prepare a consent-checked draft. Preparing or opening a draft does not send a message or create delivery evidence. There is no gateway/QR/server dependency. Real email acceptance and delivery remain separate states.

Local adapters write synthetic `.invalid` previews under ignored `.local/outbox`. They do not send email or WhatsApp. Staging restricts recipients to the configured allowlist. Provider acceptance and actual delivery callbacks have distinct statuses; callbacks are signature-checked and deduplicated.

Review notification/job failures in the staff dashboard. Correct missing templates, disabled consent, sender verification, provider errors or configuration before retrying. Do not change a booking's financial status to repair a failed notification. Pickup/payment reminders recheck current booking/deadline state at delivery.

Recovery requests acknowledge matching and nonmatching details identically. Matching requests enqueue a deduplicated event; the worker generates a hashed, booking-bound, single-use link. Guests deliberately redeem it and receive only scoped access. Payment initiation still requires an approved booking and server-recorded obligations. Staff contact alerts open the protected enquiry detail; inbox resolution is a staff record of work, not an automatic reply.

Alerts cover dead jobs and prolonged pending work. A failed alert delivery must itself be visible in hosting logs/monitoring. Before launch, verify actual approved recipients receive each core journey event and that webhook statuses advance without duplicate sends.
