# OpenWA for Red Sea Horizons

The owner selected [rmyndharis/OpenWA](https://github.com/rmyndharis/OpenWA) on 2026-10-24. This replaces the earlier handoff's Meta-only choice. The website runs on Vercel; the gateway runs continuously on a separately designated Docker host with persistent storage. Nothing here creates an account, buys hosting, links a number or sends a message.

Contract inspected: upstream version **0.25.0**, commit **173916c83b41e622f849ecd380bf36486dfd8cdf**, MIT license. Relevant primary sources: [send controller](https://github.com/rmyndharis/OpenWA/blob/173916c83b41e622f849ecd380bf36486dfd8cdf/src/modules/message/message.controller.ts), [idempotency behavior](https://github.com/rmyndharis/OpenWA/blob/173916c83b41e622f849ecd380bf36486dfd8cdf/src/modules/message/idempotency/send-idempotency.interceptor.ts), [callback payload](https://github.com/rmyndharis/OpenWA/blob/173916c83b41e622f849ecd380bf36486dfd8cdf/src/modules/session/message-projector.service.ts), [signature verification](https://github.com/rmyndharis/OpenWA/blob/173916c83b41e622f849ecd380bf36486dfd8cdf/docs/examples/webhook-signature-verification.md).

OpenWA uses unofficial WhatsApp clients. Its own guidance warns of number restrictions/bans and recommends a dedicated number rather than the primary business/personal number. Email remains available for delivery failures. The gateway's number and host must be owner-designated; the adapter does not bypass opt-in or authorize unsolicited sends.

## Gateway host

1. Choose an always-on Docker host with persistent disk and a dedicated gateway HTTPS hostname. Use separate staging and production sessions/credentials. Vercel Functions do not host the Chromium session or its databases.
2. Put a unique random `OPENWA_MASTER_KEY` in that host's secret store. It is the gateway administrator key; **do not place it in Vercel**. From the repository root, run `docker compose -f deploy/openwa/compose.yaml build` then `docker compose -f deploy/openwa/compose.yaml up -d`. The Compose file builds the exact inspected upstream commit. It mounts only gateway data, not the Docker socket.
3. Put the loopback port2785 behind the designated HTTPS reverse proxy. Restrict dashboard access to operators; expose only the necessary authenticated API paths to the website. Do not expose an unauthenticated gateway or forward the primary site's cookies. Keep access logs free of bodies, Authorization headers and query secrets.
4. Open the gateway dashboard, create one session using `whatsapp-web.js`, then the owner scans its QR on the dedicated number. Record the returned session **id** in a restricted release record. Check status `ready` and `engineLoaded=true`. QR/session keys contain credentials: keep them out of Git, screenshots and public evidence.
5. Create an **operator** API key scoped to that session. For staging, also restrict the key's chats to the authorized test recipients. Retain the admin key only on the gateway host. Configure backups of the persistent volume using upstream's online-consistent backup procedure; verify restart and restore preserve the intended session without duplicate messages.

The supplied Compose configuration has not been built on an owner-designated host yet. Gateway operation, QR pairing and real delivery remain external verification steps; local tests exercise the documented HTTP contract with a loopback test server.

## Website configuration

Set server-only Vercel environment variables:

| Variable | Value |
|---|---|
| `WHATSAPP_PROVIDER` | `openwa` |
| `OPENWA_BASE_URL` | Gateway HTTPS origin, e.g. `https://wa.your-domain.example`; no `/api`, credentials, query or fragment |
| `OPENWA_API_KEY` | Session-scoped operator key, not master/admin key |
| `OPENWA_SESSION_ID` | Exact gateway session id |
| `OPENWA_WEBHOOK_SECRET` | Separate random secret of at least32 characters |
| `MESSAGING_ACCOUNT_VERIFIED` | `true` only after intended host/session/number ownership and actual send test are verified |
| `MESSAGING_SANDBOX_ALLOWLIST` | Comma-separated authorized E.164 phone numbers and email addresses in staging |

Meta credentials are optional when OpenWA is selected. `WHATSAPP_PROVIDER=meta` retains the previous adapter and requires the Meta fields listed in `.env.example`; existing delivery history is preserved.

In the gateway session's webhook settings create one subscription:

- URL: `https://YOUR-APPLICATION-DOMAIN/api/v1/webhooks/openwa`
- Events: `message.ack`, `message.failed`
- Secret: the exact `OPENWA_WEBHOOK_SECRET`
- Retries:5 total attempts; use gateway delivery-failure redrive when a longer outage exhausts retries.

The application checks `X-OpenWA-Signature` against the raw bytes, binds the signed session id, deduplicates the signed idempotency key in PostgreSQL and advances statuses monotonically. A delayed signed retry is accepted; a future-dated or wrong-session event is rejected. A callback that beats the accepted-message database write returns an error so the gateway retries. Do not subscribe to incoming messages/QR events; this application does not process customer chat bodies.

## Templates and test journey

Approve a versioned `app.notification_templates` record per event/channel/locale with provider `openwa`. Meta provider-template ids are unnecessary; the agency approves the actual text and its locale. Only `{{reference}}` and `{{access_url}}` variables are accepted. Rendered messages are limited to4096 characters, and link previews are disabled so private links are not fetched. A review invitation remains marketing-classified and requires separate marketing consent. UI translation approval does not approve a message template.

Apply migrations through `20261024031000_notification_template_immutability.sql` before deploying this version. They add OpenWA receipt support, distinguish approved OpenWA text from Meta template identifiers and permanently lock approved template content/identity while allowing operational pause/disable. Changes require a new versioned row. No templates or owner approvals are fabricated by these migrations.

For an authorized staging recipient: submit a request, observe one consented localized update, confirm a delivered/read callback, replay the signed callback and verify no duplicate effects, then withdraw WhatsApp consent and verify email fallback. Test a disconnected gateway and an uncertain timeout. `accepted` means gateway acceptance, not delivery. Unknown outcomes stop for reconciliation; never blindly create a new job/key. In particular, an accepted send whose local receipt write failed must be reconciled before any retry or fallback.

Keep the grant URLs, API keys, phone numbers and QR images in restricted evidence. Record only redacted counts/statuses in the release report. E06 is resolved only after the actual provider journey succeeds.
