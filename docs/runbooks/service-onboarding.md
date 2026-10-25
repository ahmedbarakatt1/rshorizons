# Connect administrator login and booking messages

This is the working sequence for the owner's Vercel deployment. Use the verified current state below and the detailed linked guides. Configuration is partly complete; production has not been deployed.

## Current access check — 2026-10-25

| Service | Actual result | Next owner input |
|---|---|---|
| Supabase | Official CLI authenticated; owner designated production. 25 migrations/118 tables, required reference data, restricted login, verified TLS, invite-only Auth and administrator password are verified | Separate staging, authenticator enrollment,64 MiB storage capacity and hosted recovery |
| Vercel | Official CLI authenticated to `ahmedbarakatt1s-projects/rshorizons`; correct GitHub repository and `rshorizons.vercel.app` verified; Node 22/build gate/core runtime variables configured | Hobby plan cannot satisfy commercial minute-cron deployment; remaining provider inputs and approvals still required |
| WhatsApp | Owner replaced OpenWA with manual links to two designated numbers and scoped staff-to-guest drafts; Vercel selects links | Hosted UAT verifies destinations; no host, QR, tunnel or gateway credential needed |
| Resend | Application adapter prepared; no account/sender/key/callback configured | Designated account and owner-controlled sending domain |

The existing Vercel Supabase integration points to the designated project. Added production-only `DATABASE_URL`, `DATABASE_SSL_CA`, `APP_ENV`, `APP_BASE_URL`, `DEMO_MODE`, `BOOKING_ENABLED`, `STORAGE_PROVIDER`, `CRON_SECRET`, `TOKEN_HASH_PEPPER`, `WHATSAPP_PROVIDER`, `EMAIL_PROVIDER` and `VIDEO_PROVIDER`. Sensitive values remain in Vercel secret storage and ignored operator files. Unused privileged integration variables `POSTGRES_PASSWORD`, `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`, `SUPABASE_JWT_SECRET` and legacy duplicate `SUPABASE_SERVICE_ROLE_KEY` were removed; restricted `DATABASE_URL` and required `SUPABASE_SECRET_KEY` remain. Recheck this separation after reconnecting an integration because it may reinstall defaults. Removal from Vercel does not rotate or revoke provider credentials. Bookings remain disabled. No synthetic catalog, policy approval, real guest message, payment, DNS operation or paid upgrade was performed.

Vercel's automatic preview and production attempts both ended in ERROR: Hobby permits daily cron only, rejecting `* * * * *`. Neither produced a live deployment. Earlier application verification passed [GitHub CI 40208411106](https://github.com/ahmedbarakatt1/rshorizons/actions/runs/40208411106) for source `ab0f80bc54ba25b06ec7d454566a0660d3f1c532`:209 domain tests and51 browser tests passed, with18 intentional browser skips.

Hosted boundary checks: verified CA/hostname connection as `tourism_app`; wrong CA and wrong hostname rejected; SSL enforcement enabled and `pg_stat_ssl` true. A temporary private storage probe uploaded/downloaded correctly, rejected anonymous/public reads and was removed. The latest security advisor reports one Auth warning: leaked-password protection is disabled. The earlier extension warning is resolved. The global64 MiB storage update failed with HTTP 402 and explicitly requires a paid plan; the private bucket uses the actual50 MiB ceiling until resolved.

Administrator Auth creation used the server Admin API with protected stdin. Staff authority was installed transactionally through the designated project's official CLI query, with the same profile/owner/all-scope/audit checks as `scripts/provision-admin.ts`; no operator database password was exported. The real password sign-in returned `aal1`, and the verification session was signed out. MFA enrollment is still an owner action. Keep `[auth].enable_signup=false` while `[auth.email].enable_signup=true`: the latter maps to the email provider switch and disabling it also disables password sign-in.

The owner may use Gmail to register for Resend and receive tests. Resend's default sender can send only to the account email; customer delivery requires an owned verified sender domain. No Gmail SMTP adapter or unapproved sender was substituted. [Resend testing restriction](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain).

## 1. Designate the services

The production Supabase project and Vercel team/project are already designated. Remaining non-secret inputs include the separate staging destination, eligible hosting plan, domain and Resend account choice. A stable designated Vercel staging hostname can be used before final DNS; email still requires a verified sending domain. Never infer domain ownership from the administrator email. OpenWA hosting is retired and must not be requested again.

Use provider sign-in and secret settings for keys/passwords. Keep staging and production separate. Hosting purchases, paid plan upgrades, authenticator enrollment are owner steps; no purchase is authorized by this checklist.

## 2. Supabase and administrator

After the project is designated and accessible:

1. Inspect existing schemas/tables and confirm the project belongs to this application before applying anything. Use the committed SQL migrations through `npm run db:migrate` from the protected operator environment. There are currently 25 migrations, including production reference data and contact operations/retention; do not run a synthetic seed in the hosted project. The designated production database already has all 25 applied with checksums.
2. Configure the restricted `tourism_app` login separately from the migration credential. The initial migration creates it as `NOLOGIN`; enable its login and set a unique password privately for the runtime. Keep `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEDB` and `NOCREATEROLE`. Do not grant broad schema/table ownership or migration permissions. Inspect the existing role before changing it.
3. Obtain actual connection endpoints from **Connect** in that project. Use the transaction pooler for Vercel runtime and direct/session connection for migrations, with verified TLS. The pooled runtime username is the restricted role plus project reference, not the dashboard's default `postgres` username. Do not invent the pooler hostname. [Supabase connections](https://supabase.com/docs/guides/database/connecting-to-postgres).
4. Put `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` in the correct Vercel environment. Keep `MIGRATION_DATABASE_URL` and management tokens only in the operator secret store. Keep `app` outside exposed Data API schemas.
5. Disable public sign-up/anonymous sign-in, set the exact Auth URL/redirect allowlist and enable TOTP MFA. Create the private `tourism-private` bucket as specified in [Vercel setup](vercel-owner-setup.md).
6. Provision the designated administrator through [the protected stdin command](staff.md#provisioning-and-password-rotation), bound to the exact project reference. Sign in at `/admin` and complete authenticator enrollment. Verify price changes, media controls and sign-out against hosted data. The existing local account is not migrated automatically.

## 3. Email and WhatsApp

Complete [Resend setup](email.md): verified domain, domain-scoped sending key, signed callback and the application's exact `EMAIL_*` variable names. Configure separate Supabase SMTP if Auth emails are needed.

Use [manual WhatsApp links](whatsapp-links.md). Guests choose one of the two owner-designated team numbers. Staff prepare a draft for a saved, consented guest number from the reservation. The person presses Send; the website makes no WhatsApp delivery claim.

Review the [English email draft pack](../launch/email-templates.en.draft.json), approve versioned templates for all enabled locales, and designate test recipients. Merely entering contact details does not send; a successful reservation submission creates the acknowledgement job. Staff approval is still required for every reservation.

## 4. Hosted verification

Deploy the isolated staging environment after configuration validation passes. Confirm administrator login/MFA and permissions; a booking with an email receives one delivered email even when WhatsApp consent is given; duplicate submission/email callbacks do not duplicate effects; team links and authorized staff drafts open the intended WhatsApp destination without changing booking or delivery state. Verify the minute worker in Vercel's Cron Jobs view. The current schedule needs a plan with per-minute cron support; Hobby is daily only. [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

Record actual results and remaining failures in the release report. Production still requires the existing Paymob, media, business-content, translation, recovery and UAT gates. Configuring these three services alone does not satisfy those independent launch requirements. Do not change approval flags or bypass `verify:release` just to obtain a deployment.

Current production-readiness results and the latest tested source are recorded in PROJECT_STATUS.md and docs/evidence/production-readiness-2026-10-25.json. Historical counts above describe the earlier onboarding source.
