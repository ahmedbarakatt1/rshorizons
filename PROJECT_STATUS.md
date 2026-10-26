# Red Sea Horizons — execution status

2026-10-26 publication update: owner approved the supplied media for publication and supplied Instagram `horizonsrs2026` and TikTok `@red.sea.horizons`; Red Sea Horizons remains the displayed operator name and no street address is requested. Public showcase media is being moved to the private Supabase bucket and served through the application. The current synthetic catalog and prices remain visibly labelled as a personal demonstration.

## Owner scope update — 2026-10-26: WhatsApp completion

The owner now requests customer-service completion on WhatsApp, visible bank transfer/InstaPay options, social/contact links and no automated email. This supersedes earlier online checkout, automatic email and booking-worker launch requirements. Public forms prepare editable WhatsApp drafts only; they do not create reservations or take payment. Customer service confirms availability, price and payment details. The two designated numbers and Gmail inbox are linked. Owner supplied InstaPay address abdohassan8123@instapay and its ipn.eg payment link; both are displayed. Owner supplied e-wallet number 01201338200, Instagram `horizonsrs2026` and TikTok `@red.sea.horizons`; all are linked. Bank details remain intentionally customer-service supplied. Existing admin/catalog/media controls and historical records are retained.

No automated test suites were run for this change, as requested. TypeScript compilation passed. The local transfer flow was manually exercised through draft review with InstaPay and the second team number; no message was sent. Private screenshot: .local/evidence/ui/whatsapp-booking/review.png. Historical CI results below do not verify this new flow. Preview: http://127.0.0.1:3003/en. No production deployment occurred.

Next: add owner-supplied payment/social details, approve public business content/media, and resolve a commercially eligible host within the free-only budget. Paymob, Resend and booking-minute cron activation are not required for this flow. Operational private-media/retention dependencies remain separate.

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

### Vercel reauthentication and production check — 2026-10-26
Vercel CLI sign-in succeeded. Fresh team API response confirms the designated team remains on Hobby. Production environment downloaded only into ignored .local; Vercel withheld four sensitive values, so placeholder-related database/secret validation failures are not evidence that those hosted secrets are invalid. Actual missing release inputs include owner approval flags, private-video provider settings, monitoring destination, sensitive-data key reference and approved media retention days. No deployment, purchase, approval-flag override or secret publication occurred. The new WhatsApp flow does not require Resend or Paymob. Next action: resolve hosting eligibility within the owner's free-only requirement and the remaining production content/media configuration before deployment.

## New owner-requested Vercel project — 2026-10-26
Created `red-sea-horizons` (`prj_PLDW1lxqYbutWyeWfwEFBI8uVPfj`) under the existing designated team and linked `ahmedbarakatt1/rshorizons`. Node 22.x / Next.js configured. Production-only variables connect the existing Supabase project `asdlmlizktankblwqocp`, including restricted runtime DB + verified CA, public Supabase URL/publishable key, sensitive server key and the three public-showcase safeguards. Read-only verification returned current_user tourism_app, 3 currencies, verified TLS and Supabase Auth settings HTTP 200. No secrets were printed or committed. Local .vercel link now points to the new project; prior link backed up under ignored .local. Existing rshorizons project retained. Git integration defaults production branch to main; current WhatsApp work remains on codex/tourism-production. No paid service was created. Dashboard: https://vercel.com/ahmedbarakatt1s-projects/red-sea-horizons

Latest deployment request: current prices and payment details explicitly approved by owner. The visibly labelled showcase catalog was promoted by authoritative migration without guests, bookings, staff passwords or customer data. Prepared owner-approved media derivatives were uploaded to the private Supabase bucket and are served only through allowlisted application routes. Production release verification and the Next.js build passed locally against the hosted data before deployment.

## Personal showcase production deployment — 2026-10-26

Vercel deployment `dpl_G7dshfrJioNoDWRcGPDQy7gLph1K` is Ready and aliased to `https://red-sea-horizons.vercel.app`. Manual Playwright browser evidence confirmed: the public demonstration banner is visible; experience and apartment prices render from hosted Supabase data; contact shows both WhatsApp numbers, Gmail, Instagram and TikTok; payment options show the approved InstaPay and e-wallet details; an experience request creates an editable prefilled WhatsApp link to the selected customer-service number without writing a booking or sending a message; 18 gallery images load with non-zero dimensions; a selected owner video reaches readyState 4 without error; `/en/reviews`, `/ar/contact` and `/api/v1/health/ready` return HTTP 200; and `/admin` presents the staff sign-in screen. The browser console had no public-flow errors; the signed-out admin page records the expected 401 session probe.

Next task: owner UAT of the live personal showcase, followed by replacement/approval of demonstration service copy, operating schedules, legal policies and native translations before removing the demonstration banner or enabling reservations. No address is requested, and online booking, automated email and automated WhatsApp remain intentionally disabled.
