# Vercel owner setup

The owner selected Vercel and will perform deployment. This guide prepares that handoff; it does not record a deployment. The designated repository is `ahmedbarakatt1/rshorizons`. Account/project identity, domain, hosted secrets, provider evidence, approved business content and UAT remain release gates in `docs/BLOCKERS.md`.

For the current administrator/login and messaging setup, start with [service onboarding](service-onboarding.md). [Resend setup](email.md) separates booking email variables from Supabase Auth SMTP settings.

Verified2026-10-25: `ahmedbarakatt1s-projects/rshorizons` is linked to the correct GitHub repository and has `rshorizons.vercel.app`. Node22, `npm ci` and the release-gated build command are configured. The project remains undeployed on Hobby. Core production database/Auth variables are present; additional service credentials and approvals are still missing.

## 1. Project settings

Import the designated repository into the agency's approved Vercel team. Use a commercially eligible plan that supports the committed cron frequencies. Hobby is restricted to noncommercial personal use and cannot run the per-minute worker. Review current charges before approving a plan. [Vercel Hobby](https://vercel.com/docs/plans/hobby), [cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

| Setting | Value |
|---|---|
| Framework preset | Next.js |
| Root directory | Repository root (`./`) |
| Install command | `npm ci` (committed in `vercel.json`) |
| Build command | `npm run verify:release && npm run build` (keep the release gate) |
| Output directory | Next.js default; do not set `out` or use static export |
| Node.js version | 22.x; compatible with the committed Node engine range |
| Production source branch | `main`, after the candidate commit passes CI and staging |
| Function region | `fra1` currently; review proximity to the designated Supabase database before launch |
| Worker / retention duration | 300 seconds, exported by their route handlers |

Vercel manages Node minor/patch updates; record the actual build Node/npm versions instead of assuming an exact patch. Keep exact dependency versions and the root lockfile. Do not set `NEXT_BUILD_DIR`; `.next-release` is for local release testing. [Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).

Do not override the build command to bypass missing configuration. `verify:release` deliberately rejects undefined/development environments and production credentials in Vercel Preview. Its production path also checks persisted approvals and synthetic data. A successful Next build alone is not a release approval.

## 2. Isolate staging from production

Use separate owner-designated Vercel projects and Supabase projects for staging and production. The staging project's Vercel Production environment may use `APP_ENV=staging`; this lets its scheduled jobs run against isolated sandbox services. Vercel Preview deployments do not replace scheduled staging verification. Protect staging access while allowing authenticated provider callbacks to their exact routes. Keep untrusted branch previews disabled or free of agency database/provider secrets.

| Application setting | Staging | Production |
|---|---|---|
| `APP_ENV` | `staging` | `production` |
| `APP_BASE_URL` | Exact stable staging HTTPS origin | Exact canonical HTTPS origin |
| `DEMO_MODE` | `false` for release acceptance | `false` |
| `BOOKING_ENABLED` | Open only for controlled testing | Open after owner launch acceptance |
| `PAYMOB_MODE` | `sandbox` | `live` |
| `STAGING_ISOLATION_CONFIRMED` | `true` after verification | Not used as a production approval |
| `MESSAGING_SANDBOX_ALLOWLIST` | Designated test recipients only | Omit unless deliberately restricting sends |
| `STORAGE_PROVIDER` | `supabase` | `supabase` |
| `VIDEO_PROVIDER` | `mux`, isolated environment | `mux`, designated production environment |
| `EMAIL_PROVIDER` | `resend`, isolated sender/account | `resend`, verified production sender |
| `WHATSAPP_PROVIDER` | `links` | `links` |

Enter actual values through Vercel's environment-variable UI/secret storage. Use `.env.example` as the full name inventory. Do not upload `.env.local`, `.local`, `.tooling`, original media, profiles or private evidence. Those paths are excluded from deployment. Keep `MIGRATION_DATABASE_URL`, Supabase deployment tokens and account-management tokens in a separate operator/CI secret store; they are not web-runtime secrets.

Only the Supabase URL and publishable key use `NEXT_PUBLIC_`. Database credentials, Supabase secret key, signing keys, Paymob/Resend/Mux secrets, cron secret and token pepper remain server-only. Set `CRON_SECRET` and `TOKEN_HASH_PEPPER` to separate random values of at least 32 characters. Approval flags are evidence acknowledgements; do not set them merely to make a build pass. Public environment values are compiled into browser assets, so rebuild for the correct target environment.

## 3. Database, authentication and storage

1. In the designated Supabase project, configure a separate restricted `tourism_app` runtime login and operator/migration login. Keep `app` outside exposed Data API schemas. Use the supported pooled runtime connection from that project's connection panel, with TLS and a restricted username; use a direct or session connection appropriate to migrations for the separate operator credential. The app uses `pg` transactions and transaction-local actor settings. Check total connection pressure across Vercel instances; each app pool currently allows ten clients.
   Set `DATABASE_SSL_CA` to the provider's downloaded root certificate PEM. Hosted runtime always verifies certificates and hostnames. A `sslmode=verify-full` URL is supported; other SSL URL options are rejected because pg would replace the trusted SSL configuration. Do not use `rejectUnauthorized=false`. Enable Supabase SSL enforcement and verify both the client connection and `pg_stat_ssl`. [Supabase SSL](https://supabase.com/docs/guides/platform/ssl-enforcement), [pg SSL precedence](https://node-postgres.com/features/ssl).
2. Apply the ordered SQL migrations once from a protected operator/CI environment, using `npm ci` then `npm run db:migrate`. The command uses `MIGRATION_DATABASE_URL` and records checksums in `migration.applied`. Never add migrations to the Vercel build/start command; multiple builds must not race schema changes. Never run the synthetic seed or local bootstrap scripts in production.
3. Configure invite-only Supabase Auth, exact staging/production redirect allowlists, the initial administrator designated privately by the owner and MFA. Use the protected stdin provisioning command in [Staff training and access](staff.md); the local account and its hash are not deployment seed data. Confirm inactive staff and revoked scopes are denied immediately. No default staff password exists.
4. Create `tourism-private` with `public=false`. Set its object limit to **67,108,864 bytes (64 MiB)** and allowed MIME types to `image/jpeg`, `image/png`, `image/webp`, `video/mp4`. Ensure the project/plan limit permits that size. Do not grant anonymous object listing/read/update/delete or general authenticated bucket access. App-issued capabilities authorize only individual uploads; finalization still verifies exact declared size, checksum, decoded MIME and current assignment.
5. Keep separate database and object backups. Rehearse restoration in isolated staging and record owner-approved retention and recovery objectives.

Browser uploads go directly to the private bucket via a path-specific signed URL, with overwrite disabled. Supabase upload URLs last two hours; an issued capability may upload during that window, but it cannot make an object ready or public, and finalization rechecks current staff authority. Never log or persist these capability URLs in analytics. The bucket limit is important because direct uploads reach storage before the app validates their bytes. [Signed uploads](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl), [upload options](https://supabase.com/docs/reference/javascript/file-buckets-uploadtosignedurl).

For downloads and public gallery videos, the application rechecks current entitlements/consent and then streams storage bytes. Short-lived storage read URLs stay on the server; the browser receives no storage read capability. Subsequent requests reauthorize, including video seek requests. Revocation cannot claw back bytes already downloaded or stop a response already authorized. No-store headers remain applied. This avoids Vercel's buffered payload limit without making buckets public. [Vercel file-size guidance](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions).

## 4. External services and callbacks

WhatsApp uses [manual click-to-chat links](whatsapp-links.md). No gateway, QR, server, tunnel, WhatsApp API credentials or callback is required. The designated production variable is already `WHATSAPP_PROVIDER=links`; retain automated Resend email configuration.

Production video processing uses Mux; the FFmpeg/FFprobe path is explicitly limited to development/test and is excluded from deployment. Configure the designated Mux environment, signing key and webhook secret. This app keeps its own private source and derivative objects in Supabase; Mux processing does not remove storage backup or retention requirements.

| Provider | Callback below the environment's `APP_BASE_URL` |
|---|---|
| Paymob | `/api/v1/webhooks/paymob` (merchant-supported HMAC integration) |
| Resend | `/api/v1/webhooks/resend` |
| Mux | `/api/v1/webhooks/mux` |

Configure provider accounts and exact callbacks separately for staging and production. Test signatures, duplicate events, account/session/environment mismatch and failure paths. Accepted sends are not delivered/read messages. Keep staff WhatsApp consent checks; automated jobs use email. Complete actual sandbox delivery/receipt and payment evidence before production. Verify sender-domain email DNS without changing unrelated records.

## 5. Cron, monitoring and release

The committed schedule is UTC:

| Path | Schedule | Purpose |
|---|---|---|
| `/api/internal/worker` | Every minute | Durable notification/payment/media work, reminders, hold expiry, auth cleanup |
| `/api/internal/monitor` | Every five minutes | Redacted operational alerting |
| `/api/internal/retention` | Daily at 02:30 UTC | Approved media retention; dry-run without approval |

Verify these jobs appear and actually execute in the target project's Cron Jobs view. Vercel supplies `Authorization: Bearer <CRON_SECRET>` automatically; the endpoints reject missing/short/wrong secrets. Do not put the secret in a URL. Confirm `MONITORING_ALERT_URL` reaches the designated HTTPS receiver and test a controlled failure alert. Cron invocations can overlap; durable leases and idempotent processing remain necessary. [Vercel cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

Follow [the release procedure](deployment.md) after all release inputs are available. Keep automatic assignment of the public domain disabled until the staged production candidate is checked. With an inspected, pinned Vercel CLI in the owner environment, confirm the project identity, deploy the production candidate using `vercel --prod --skip-domain`, verify the actual returned URL, then promote that exact deployment with `vercel promote <verified-deployment-url>`. Do not reuse a staging build carrying staging variables. Record the CLI version and output. [Vercel CLI deployment](https://vercel.com/docs/cli/deploying-from-cli).

Before promotion, verify `/api/v1/health/live` and `/api/v1/health/ready`, locale/reviews pages, secure cookies, no-store private responses, canonical HTTPS redirects, provider signatures, and unauthorized media access. On hosted staging, upload an actual supported file larger than 4.5 MB, complete processing, download it, play/seek a video, revoke access and repeat the access request. Confirm the upload network goes browser → Supabase and downloads stream without a 413 or buffered response error. Local transport mocks cannot prove hosted storage CORS or Vercel streaming behavior.

After owner-approved UAT, promote and perform only the authorized live transaction/contact journey. Record actual URL, candidate commit, migration head, cron execution, alert routing, recovery evidence, provider receipts and rollback target in `docs/RELEASE_REPORT.md`. Application rollback does not undo migrations, messages, payments or deleted objects.

## Local evidence for the Vercel media transport change

The added tests use real PostgreSQL for upload authorization/finalization and explicit provider-response mocks for Supabase. A 5 MiB browser upload is checked against mocked storage in Chromium, Firefox and WebKit; no external provider is contacted. Production host, Supabase storage, Mux and email journeys remain unverified until the owner configures the designated services. Exact command results belong in the release report; do not treat this guide as evidence of deployment.
