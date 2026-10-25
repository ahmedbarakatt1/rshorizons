# Resend setup for booking and account emails

Checked against the current Resend documentation on 2026-10-24. The adapter exists, but no designated account, sender domain, key or real delivery has been verified. This setup is separate from local `.invalid` message previews.

Owner question on2026-10-25: a regular Gmail account can register for Resend and receive its test emails. Resend's `onboarding@resend.dev` sender is restricted to the account email. Customer delivery through this implementation needs an owned, verified domain; a Gmail address cannot supply DNS ownership for `gmail.com`, and the Vercel project hostname does not provide email-domain control. No Gmail SMTP adapter has been selected or installed. [Resend test sender restrictions](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain).

## Account and sender

1. Sign in to the agency's designated [Resend account](https://resend.com/). Add the owner-approved sending domain or subdomain. An administrator login address does not establish ownership of its domain or authorize it as a sender.
2. Copy the exact DNS records shown by Resend into the designated DNS account. Preserve existing mailbox MX records and other services' records. Check SPF, DKIM and the owner's DMARC policy, then wait for Resend to report the sending domain verified. Do not copy example DNS values from documentation. [Domain setup](https://resend.com/docs/dashboard/domains/introduction), [avoiding MX conflicts](https://resend.com/docs/knowledge-base/how-do-i-avoid-conflicting-with-my-mx-records).
3. Choose a sender mailbox on that verified domain. The app's `EMAIL_FROM` accepts the bare email address, without a display-name wrapper. Confirm which monitored address receives staff notifications; that is a separate setting.
4. Create a sending-only API key scoped to this domain for the target environment. Store it directly in Vercel's server-side environment settings. A sending key is sufficient for the application; account/domain administration credentials do not belong in Vercel. Use separate staging and production keys. [API keys](https://resend.com/docs/dashboard/api-keys/introduction).

## Booking email settings in Vercel

| Name | Value/source |
|---|---|
| `EMAIL_PROVIDER` | `resend` |
| `EMAIL_API_KEY` | Domain-scoped Resend sending key |
| `EMAIL_FROM` | Bare email address on the verified sending domain |
| `EMAIL_WEBHOOK_SECRET` | The callback's actual `whsec_…` signing secret from Resend |
| `RESEND_ACCOUNT_ID` | Recorded identity of the designated Resend account/team; use consistently for receipt attribution |
| `STAFF_NOTIFICATION_EMAIL` | Owner-designated monitored staff mailbox |
| `STAFF_NOTIFICATION_LOCALE` | An enabled, approved locale such as `en` |
| `MESSAGING_SANDBOX_ALLOWLIST` | In staging, comma-separated owner-authorized test email addresses and E.164 phone numbers |
| `MESSAGING_ACCOUNT_VERIFIED` | `true` only after the account/sender and intended test recipients are verified; real delivery evidence is still required |

These are the application's exact names. A marketplace integration that creates `RESEND_API_KEY` does **not** automatically supply `EMAIL_API_KEY`. Likewise this application reads `EMAIL_WEBHOOK_SECRET`, not `RESEND_WEBHOOK_SECRET`. No provider secret uses a `NEXT_PUBLIC_` prefix.

Create a Resend webhook pointing to the stable environment origin plus `/api/v1/webhooks/resend`. Subscribe to `email.sent`, `email.delivered`, `email.bounced`, `email.failed` and `email.complained`. Copy its signing secret into the matching environment, then redeploy. Keep separate callback subscriptions/secrets per environment. The app verifies raw-body Svix signatures and deduplicates event IDs; `email.sent` means accepted, not delivered. [Webhooks](https://resend.com/docs/dashboard/webhooks/introduction).

Keep `CRON_SECRET` set and verify the committed `/api/internal/worker` cron actually runs every minute. The worker sends approved database templates after booking submission; adding an API key alone does not approve template text or start scheduled jobs. See [Vercel setup](vercel-owner-setup.md) and [notification operations](notifications.md).

Production requires approved Resend templates for request receipt/rejection, payment request/receipt, confirmation, booking changes/completion, pickup reminder, cancellation/refund update, private gallery, review invitation and guest-access recovery in all10 enabled guest languages. The staff contact alert requires the configured staff language and opens the authenticated request detail. Launch validation checks approved versions, supported variables, usable subject/body and an access link. Review invitations may retain a reviewed marketing classification; the dispatcher requires marketing consent. Other required operational templates are transactional. Put `{{access_url}}` on its own line to avoid adjoining punctuation in plain-text email clients. The English local-preview templates are drafts for review, not approved production content.

## Optional Supabase Auth email transport

Supabase SMTP configuration handles Auth email, independently of the application's booking API. In Supabase **Authentication → Email → SMTP Settings**, enable custom SMTP with:

| Field | Value |
|---|---|
| Sender email | Approved sender on the verified Resend domain |
| Sender name | `Red Sea Horizons` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | A separate domain-scoped Resend sending key kept in Supabase's SMTP settings |

Use the exact application URL/redirect allowlist for the target environment and keep public registration disabled. SMTP setup does not create the initial administrator; run the protected provisioning procedure in [staff access](staff.md), then complete MFA in `/admin`. This application's Staff screen returns a private invitation link for deliberate sharing; it does not automatically email that link merely because SMTP is configured. [Resend's Supabase SMTP guide](https://resend.com/docs/send-with-supabase-smtp).

## Controlled acceptance test

Use only a recipient explicitly designated by the owner for this test. Approve the corresponding event/channel/locale template before enabling the send. A proposed English `request_received` message for owner review is:

> Subject: Reservation request received — {{reference}}
>
> We received your Red Sea Horizons reservation request {{reference}}. It is awaiting staff review; your booking is not yet confirmed and no payment is requested. Follow your request: {{access_url}}

This text is a **draft**, not a database approval. The same meaning must be reviewed for each enabled booking locale. Only `{{reference}}` and `{{access_url}}` are supported variables.

Submit a controlled booking without WhatsApp consent. Observe one outbox event/job and one email; check the recipient inbox and a signed `email.delivered` receipt in Notifications & jobs. Retry the same booking submission and replay a provider callback to verify deduplication. Record redacted identifiers/statuses in release evidence, never the guest access URL or message body. A booking must remain pending staff approval throughout this acknowledgement test.

WhatsApp now uses [manual links](whatsapp-links.md). Jobs send email independently of WhatsApp consent; no gateway delivery or automatic WhatsApp fallback is attempted. Actual email verification and approved templates remain required. Historical uncertain receipts still require reconciliation before a new automated send.
