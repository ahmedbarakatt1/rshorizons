# Red Sea Horizons — execution status

Updated 2026-10-24, Africa/Cairo. The full 1,415-line production handoff was read and used as the approved specification. The owner confirmed **Red Sea Horizons** and authorized the supplied trip media for the local gallery. Original files remain preserved.

## Milestones

| Milestone | Status | Evidence and remaining gate |
|---|---|---|
| M0 Foundation and five resources | VERIFIED_LOCAL | All five resources installed, pinned and used; clean `npm ci`, zero reported npm vulnerabilities, Next.js production build |
| M1 Database and authorization | VERIFIED_LOCAL; external Auth onboarding pending |21 applied forward migrations,118 tables with matching generated types, real PostgreSQL17.11; current scopes, revocation, private grants and approved message-template immutability tested; designated Supabase MFA onboarding remains external |
| M2 Catalog, localization and design | VERIFIED_LOCAL; business publication pending | Data-backed public/admin screens, ten locales ×213 keys, RTL; completed reviews page with actual aggregates and invitation form; owner-requested imagery fills photo gaps; human content/translation approvals absent |
| M3 Reservations and inventory | VERIFIED_LOCAL | Quote/request/manual approval/revisions/fulfilment; independent-connection races and all-service browser journeys; private/shared transfers and physical stays |
| M4 Finance, jobs and messaging | VERIFIED_LOCAL / BLOCKED_EXTERNAL | Ledger, source-bound refunds, leases, reminders and callback dedupe tested; owner-selected OpenWA adapter with signed session-bound callbacks and conservative unknown-send handling; actual Paymob/OpenWA/Resend provider evidence absent |
| M5 Media, reviews and contact | VERIFIED_LOCAL with disabled 3D accent | Real image/video processing, private entitlement checks, public-consent guards, retention, verified reviews and contact; static poster ships because current 3D form gate failed |
| M6 Hardening and release candidate | VERIFIED_LOCAL_AND_CI / BLOCKED_EXTERNAL |202 domain tests pass locally; administrator browser workflow and automatic message preview verified. 51 browser checks passed with18 intentional skips. New CI is being recorded; prior run40052027620 remains historical evidence. Hosted staging, UAT, recovery objectives and alert routing require owner inputs |
| M7 Production | BLOCKED_EXTERNAL — NOT DEPLOYED | GitHub repository verified; owner selected Vercel and will deploy using prepared runbooks. Exact host/project, domain, Supabase and OpenWA gateway identities/secrets still absent; approved business content and live-test authorization absent |

## Current application and verification

- Root `D:\Tourism`, Git branch `codex/tourism-production`, baseline implementation commit `eec1d27`. Latest source/artifact scan counts are recorded in `docs/evidence/source-artifact-scan.json`, with zero configured credential/private-path findings. Owner-designated `origin` is `https://github.com/ahmedbarakatt1/rshorizons.git`; source is published on `main`; CI passed for `6c774397a4852a5b98a40e04879d36794344e52c` in run40052027620. The current administrator/authentication update is newer than that historical CI result; see the latest release addendum for its verification. No unrelated account, DNS or host database was modified.
- Local PostgreSQL17.11 uses loopback55432 and ignored `.local/postgres`; the existing host PostgreSQL17.2 is untouched.
- Next.js16.4.2, React19.3.1, Node22.22.2, npm10.9.7, TypeScript6.0.3 and exact root lockfile.
- Release preview: `http://127.0.0.1:3002/en`, run with `node scripts/start-local-showcase.mjs`. It uses the separate synthetic showcase recorded in `.local/showcase.json`; the domain test database is preserved.
- The owner-designated administrator account is provisioned in the local showcase and browser verified at `/admin`. Its supplied password is stored only as a salted scrypt hash. Hosted Supabase/MFA provisioning remains external. The separate one-use operator grant in ignored `.local/operator-access.json` expires after eight hours; no default credential is seeded.
- Current local domain suite: **202 passing tests across44 files**, including real PostgreSQL constraints/concurrency, password/session boundaries, credential rotation and booking acknowledgement deduplication. The previous CI result is separate historical evidence.
- The administrator browser journey signs in with a provisioned password account, changes a seasonal rate, confirms that a new real SQL quote uses it, uploads a photo and signs out. The actual designated account and automatic local booking acknowledgement were separately verified without recording its password. The final three-engine browser sweep passed **51 tests with18 intentional engine-specific skips** against the stable final build.
- Current lint, TypeScript, production build,213-key locale parity and118-table type drift checks passed. Latest remote CI: https://github.com/ahmedbarakatt1/rshorizons/actions/runs/40052027620 .
- Four fresh cold performance samples measured LCP0.872–2.480 seconds and CLS0. Unchanged route payload budgets passed; no field INP or production performance claim.
- Restore evidence:117 tables,44 bookings,20 ledger entries and116 outbox events matched. Separate synthetic storage object SHA-256 matched. Hosted recovery remains unverified.
- Load evidence:32 simultaneous independent PostgreSQL connections requested16 seats;16 approvals,16 inventory conflicts,16 allocated seats.
- The production configuration checker correctly rejects local/demo settings and lists missing credentials/approvals. There is no production deployment URL.

## Continuation

1. Read `docs/RELEASE_REPORT.md` for exact commands, outcomes, limitations and private browser evidence paths. Preserve the local implementation; do not recreate completed modules.
2. The owner selected Vercel and will deploy. Follow `docs/runbooks/vercel-owner-setup.md` with the designated hosting/domain/Supabase identities from E02–E04, then configure separate staging credentials through secret storage. OpenWA needs a separate persistent gateway; see `docs/runbooks/openwa.md`. No unrelated accounts may be reused.
3. The initial administrator identity/scope is now designated; follow `docs/runbooks/staff.md` to provision its hosted Supabase account and enroll MFA. With the remaining E05–E14 inputs, verify real provider sandboxes, hosted recovery, content/translation approval, staff MFA onboarding and UAT. Follow the deployment runbook and verify the actual production URL before marking M7 complete.

All previous parallel workers have stopped. Root completed integration and recorded the local verification. Preserve originals, local secrets, profiles, private evidence and database files outside Git/deployment. Do not infer that an earlier scaffold-only status still applies.

## Latest scoped update

The owner requested generated or web images for areas without photography. Six generated images now cover desert, buggy, boats, transfers, coast and apartments, with responsive AVIF/WebP and localized illustration labels. Owner trip media remains unchanged. Targeted verification: 6 unit/localization tests and 8 browser/accessibility checks passed; 4 documented duplicate engine checks skipped. Lint, types and build passed; 150-key parity and unchanged performance budgets passed. Exact imagery/provenance/evidence is in `docs/design/editorial-imagery.md` and the release-report addendum. Production blockers and the next external task above remain unchanged.

## Owner media update — 2026-10-24

Eight selected WhatsApp photos now supply actual boats, evening outings and transfer-car views, alongside the existing underwater photos. The boat/transfer catalog uses actual owner photographs in the showcase. All 30 original videos have optimized silent MP4 derivatives and posters, available in six-at-a-time gallery batches with click-to-play and seeking. The source files and local derivatives remain ignored. Approved production galleries now support video MIME/dimensions and single byte ranges under the existing consent guards. No new migration was necessary; existing authoritative video derivative columns/constraints are used.

Current verification: 31 unit tests and 32 security tests passed, plus the targeted media database/integration checks. Five release browser checks passed, including actual playback/seeking in Chromium, Firefox and WebKit; four existing duplicate engine checks were deliberately skipped. Lint, types, build and 169-key parity across ten locales passed. The source/artifact scan found zero configured credential/private-path matches. See `docs/design/owner-media.md` and the release addendum.

Exact next task: continue E02–E14 when owner-designated infrastructure/approvals arrive. Production is not deployed.

Final remote result: **SUCCESS**, run `40044050864`, tested source `ce6a0a0ecf27f2049720e5293e28eb8b18f1f572`. The workflow rebuilt both isolated databases, ran all domain and browser checks against the production artifact, verified recovery and scanned deployment traces. E01 repository publication and CI are resolved. M7 remains blocked on the remaining owner inputs; no production URL exists.

## Reviews, OpenWA and Vercel update — 2026-10-24

The owner requested a full reviews page, selected `rmyndharis/OpenWA` for WhatsApp and will deploy on Vercel. The reviews page is linked in desktop/mobile navigation and implements published-only aggregates, filtering, pagination, replies and invitation-only submission with name privacy. The OpenWA adapter uses the pinned upstream API contract, local approved text, explicit consent, signed session-bound durable callbacks and conservative unknown-send reconciliation. Two forward migrations add provider support and permanently freeze approved template content. Existing Meta delivery history remains valid.

Vercel uploads now bypass its request-body limit using immutable object-specific private upload capabilities; finalization still validates bytes and current authority. Downloads stream through current permission/consent checks with storage read capabilities kept on the server. Configuration/runbooks are in `docs/runbooks/vercel-owner-setup.md`, `docs/runbooks/openwa.md` and `deploy/openwa/compose.yaml`.

Verified locally and in GitHub CI:193 domain tests,47 browser tests,16 documented skips,lint,types,build,213-key locale parity,117-table drift and zero source/artifact scan findings. A loopback HTTP gateway fixture verifies OpenWA protocol behavior; no actual gateway host/number has been connected. Latest remote result isSUCCESS for6c774397a4852a5b98a40e04879d36794344e52c,run40052027620. Exact next task: owner configures designated Vercel/Supabase staging and the separate OpenWA gateway from the two setup guides, then completes hosted verification and E02–E14 before production. No deployment or real WhatsApp send has occurred.
