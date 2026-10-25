# Red Sea Horizons — execution status

Updated 2026-10-26, Africa/Cairo. The complete 1,415-line production handoff and confirmed owner decisions remain authoritative. **Production is not live or approved for launch.** Independent application work is implemented and locally verified; outstanding external gates are in `docs/BLOCKERS.md`.

Current change: owner requires completely free services and asked to adapt the worker for Vercel. Native Vercel cron registration is removed. `scripts/prepare-supabase-scheduler.ts` prepares paused Supabase schedules at the original frequencies; no hosted extension, secret or schedule is activated. Vercel Hobby's commercial-use restriction remains independent. Business inbox: `horizonsredsea@gmail.com`; no sender domain or Resend account is confirmed. See `docs/runbooks/external-scheduler.md`. Prior CI below applies to the previous application commit; new focused verification is recorded in the release report.

## Milestones

| Milestone | Current status | Evidence / remaining gate |
|---|---|---|
| M0 Foundation and five resources | VERIFIED_LOCAL | All five resources installed, pinned and used; existing exact npm lockfile preserved |
| M1 Database and authorization | VERIFIED_LOCAL; hosted configured | 25 authoritative migrations/118 tables locally and in designated production. Restricted runtime/TLS, hosted owner password verified; owner MFA enrollment outstanding |
| M2 Catalog, localization and design | VERIFIED_LOCAL; publication pending | Real catalog/admin editors, 10 locales × 218 keys, Arabic RTL, genuine reviews and owner-requested imagery. Approved business content and native translation review missing |
| M3 Reservations and inventory | VERIFIED_LOCAL | Server quotes, requests, manual approval, inventory races, changes, fulfilment, physical stays and private/shared transfers. Recovery and emailed payment permissions repaired |
| M4 Finance, jobs and messaging | VERIFIED_LOCAL / BLOCKED_EXTERNAL | Server-priced obligations, immutable ledger/refunds, durable jobs, email recovery/receipts, manual WhatsApp both directions. Real Paymob/Resend evidence missing |
| M5 Media, reviews and contact | VERIFIED_LOCAL / BLOCKED_EXTERNAL | Photos/videos/private entitlements, verified reviews, paginated contact inbox and approved retention cleanup. Media rights/production Mux/storage evidence missing; failed 3D gate uses approved static fallback |
| M6 Hardening | VERIFIED_LOCAL / VERIFIED_CI | 217 domain tests/51 files; 57 browser passes/24 documented skips; lint/types/build, 25-migration clean rebuild/restore, drift/locales, dependency and private-source/artifact scan passed. Hosted staging/recovery/alerts/UAT missing |
| M7 Production | BLOCKED_EXTERNAL — NOT DEPLOYED | Designated Vercel remains Hobby with failed deployment; minute-cron/commercial compatibility, 64 MiB storage, staging, providers, approved content and UAT unresolved |

## Current application and evidence

- Workspace `D:\Tourism`; branch `codex/tourism-production`; owner repository `https://github.com/ahmedbarakatt1/rshorizons`; existing draft PR1 is the integration target. `main` contains an older candidate; this pass does not merge or enable bookings.
- Preview `http://127.0.0.1:3002/en` uses the isolated synthetic showcase via `node scripts/start-local-showcase.mjs`. Domain tests and rebuild/recovery databases are separate. No owner originals or local credentials are deployed.
- Current stack: Next 16.4.2, React 19.3.1, Node 22.22.2, npm 10.9.7, PostgreSQL 17.11. Existing host PostgreSQL 17.2 remains untouched.
- Fresh 217 domain tests include recovery enumeration/idempotency/single-use, email-to-approved-payment, contact authority/scope/expiry/independent-connection updates, pagination, approved retention and template release gates. All passed.
- Fresh 57 browser cases passed across Chromium/Firefox/WebKit; 24 skips are documented engine-specific/local-fixture duplicates. Flows include every booking kind, real password administrator price change/photo upload, staff approval, lost-link recovery, contact resolution/pagination, review invitation/moderation display, videos/play/seek, WhatsApp drafts, RTL/responsiveness and automated accessibility checks.
- Local database restore matched 118 tables, 44 bookings, 20 ledger entries and 116 outbox events. Separate storage object SHA-256 restoration passed. Hosted recovery remains unverified.
- Current build/lint/types, 150 documented API paths, 118-table drift and 218-key parity across 10 locales passed. `npm audit --omit=dev` reports zero vulnerabilities. Exact configured-credential/private-path scan has zero findings; this is not a penetration-test certification.
- Source screenshots/traces stay ignored under `.local/evidence/ui`, `test-results` and `playwright-report`. Public evidence summaries are in `docs/evidence` and `docs/RELEASE_REPORT.md`.

## Confirmed owner decisions

- Working brand: **Red Sea Horizons**. Production business identity/policies/prices and media rights still need evidence.
- Supabase **asdlmlizktankblwqocp** is production; Vercel project **ahmedbarakatt1s-projects/rshorizons** and **rshorizons.vercel.app** are designated. Separate staging is not designated.
- The designated administrator is provisioned locally and hosted; hosted password sign-in passed and the verification session was signed out. Owner/all scope/MFA requirement are recorded. Owner authenticator enrollment and hosted dashboard verification remain pending.
- **OpenWA is removed.** Manual WhatsApp links use **+201099267451** and **+201220907478** for guests; staff draft links use the booking guest's saved number after current authority/scope/consent checks. A person presses Send. Automated email remains required. No gateway/server/QR requirement remains.
- Original owner photos and all 30 videos are preserved and available in local galleries; no subject/guardian publication consent is inferred. Generated concepts are labelled.
- No paid hosting upgrade, billing enrollment, real message, live charge, unrelated account or DNS change is authorized by silence.

## Exact continuation

1. Source 9ef467d8e73c029bffb21249834fb5607cc84499 is published in existing PR1 and passed CI 40223344217. Both forward migrations are applied and restricted-runtime permissions verified in the designated production database. Continue only the external launch tasks below; do not seed synthetic data.
2. Preserve the owner's free-only budget. The worker now uses external scheduling, prepared but inactive. Resolve commercially eligible hosting, sender setup and the other launch inputs; Hobby's commercial restriction is not removed by changing cron. The production storage 64 MiB requirement previously returned HTTP 402 and remains unmet at 50 MiB.
3. With designated staging, provider secrets and approved content, execute the real sandbox, large-upload/video, callback, recovery, MFA and UAT journeys from `docs/runbooks/deployment.md`. Only then promote and verify the actual production URL and specifically authorized live transaction.

Details and review rulings: `docs/PRODUCTION_READINESS_PASS.md`. Earlier counts/history remain in `docs/RELEASE_REPORT.md`; they do not override this current status. Do not recreate modules or resume OpenWA onboarding.

Latest CI: https://github.com/ahmedbarakatt1/rshorizons/actions/runs/40223344217 — SUCCESS, 217 domain tests and 57 browser passes/24 documented skips. Final evidence: docs/evidence/production-readiness-2026-10-25.json.
