# Reviews, OpenWA and Vercel extension — 2026-10-24

This addendum is the latest local application result. The older sections below retain the baseline history. Owner requested the reviews page, selected OpenWA and will perform Vercel deployment. Production remains **not deployed**.

Implemented published-review aggregation/filtering/pagination, original text and public replies, privacy choices and invitation-only accessible submission across ten locales. No customer reviews were invented. Added the exact `rmyndharis/OpenWA` HTTP adapter, HMAC/session-bound delivery callbacks, consent/template gates, unknown-send reconciliation and email fallback. Two migrations add OpenWA receipts and freeze approved notification content. Vercel media uploads now use a private single-object upload capability; reads stream after current authorization/consent checks.

Fresh combined verification:

| Check | Result |
|---|---|
| `npm test` |193 passed,40 files; real PostgreSQL17.11 |
| `node scripts/run-showcase-e2e.mjs` |47 passed,16 intentional duplicate-engine skips; production build,3 engines |
| `npm run lint`, `npm run typecheck` |Passed |
| `NEXT_BUILD_DIR=.next-release npm run build` |Passed |
| `npm run db:drift` |117 tables match;20 ordered migrations applied locally and to separate showcase |
| `npm run i18n:check` |10 locales ×213 keys; human approval remains external |
| `docker compose -f deploy/openwa/compose.yaml config --quiet` |Passed with synthetic admin value; no build/start/pairing |
| `npm run verify:release` |Correctly rejected development environment; no approval bypass |
| Source/artifact scan |Zero configured credential/private-path findings; exact counts in `docs/evidence/source-artifact-scan.json` |
| GitHub CI |[Run40052027620 passed](https://github.com/ahmedbarakatt1/rshorizons/actions/runs/40052027620) for implementation6c774397a4852a5b98a40e04879d36794344e52c:193 domain tests,47 browser tests,16 intentional skips; clean migrations, recovery,build and scans |
| Fresh public-route performance |Four cold samples passed unchanged budgets; LCP872–2480ms,CLS0,158757B encoded script; local lab only |

Evidence: `docs/evidence/reviews-openwa-domain.txt`, `docs/evidence/reviews-openwa-browser.txt`; private inspected production screenshot `.local/evidence/ui/reviews-production-preview.png`, plus mobile/RTL/provider-mock captures described in `docs/design/reviews-page.md`. Root Playwright CLI recorded0 console errors and0 warnings. Provider-mock browser tests prove application behavior, not live Supabase CORS/OpenWA/Mux delivery. OpenWA integration tests use a real loopback HTTP server and real database; no messages reach WhatsApp.

Failure history: new OpenWA tests first rejected the missing signature/provider schema; configuration tests first required stale Meta secrets; initial engine4xx tests exposed unsafe automatic fallback; database tests exposed mutable approved message content. All were fixed with passing regression checks. The independent reviewer found no remaining important issue in the scoped follow-up review.

Deployment handoff: `docs/runbooks/vercel-owner-setup.md`, `docs/runbooks/openwa.md`, pinned `deploy/openwa/compose.yaml`. E02 provider/self-deployment and E06 integration choices are resolved; exact accounts/host/domain/session/secrets, approved text/content, hosted large-media verification and actual provider receipts remain external. The implementation is published on main and passed remote CI. Follow-up documentation-only commits preserve the tested application code.

# Red Sea Horizons — local release report

Recorded 2026-10-20, Africa/Cairo. **Local release candidate verified. Hosted staging acceptance and M7 production remain `BLOCKED_EXTERNAL`; nothing is deployed to production.** The handoff remains the approved specification.

## Source and running application

- Workspace: `D:\Tourism`; branch: `codex/tourism-production`; implementation commit: **`eec1d27`** (`Build Red Sea Horizons reservation and operations platform`). A subsequent documentation-only commit records this identity and final continuation state.
- No remote repository has been designated, created or pushed.
- Actual local release URL: `http://127.0.0.1:3002/en`. Browser tests and performance measurements exercised this built application.
- Preview startup: `node scripts/start-local-showcase.mjs`. It uses a separate synthetic showcase database. Current connection metadata and the one-use local staff grant stay in ignored `.local/` files.
- Production URL, public domain/HTTPS verification, external deployment ID and hosted rollback target: **not available**.
- Node 22.22.2, npm 10.9.7, Next.js 16.4.2, React 19.3.1, TypeScript 6.0.3 and PostgreSQL 17.11. Exact npm versions and integrity are committed in lockfiles.

## Implemented scope and milestone boundaries

| Milestone | Local result | External work still required |
|---|---|---|
| M0 | Workspace, exact dependencies, all five requested resources installed and exercised, original design | Owner-designated repository and commercial hosting |
| M1 | 18 SQL migrations, 117 tables, generated types, RLS, current staff scopes/MFA checks and hashed guest grants | Hosted Supabase projects, real staff invite/MFA onboarding |
| M2 | Public catalog/details/filtering, ten locales with 149 keys, Arabic RTL, responsive public/admin interfaces | Approved inventory, business/legal content, rights and human translation review |
| M3 | Server quotes, pending requests, manual decisions, atomic seat/stay/resource allocation, changes, cancellation, revisions, pickups and fulfilment | Staff acceptance with approved operating data |
| M4 | Bound Paymob checkout/webhook/inquiry/refund adapters, immutable ledger, offline verification, durable jobs, Resend/Meta notification adapters and callbacks | Actual merchant sandbox/live and approved-recipient messaging evidence |
| M5 | Quarantine and real image/video processing, private packages/downloads, consented public media, verified reviews/contact; 3D fallback | Hosted private storage/Mux processing, publication/subject consent; optional 3D accent remains disabled |
| M6 | Local domain/browser/security/concurrency checks, lab performance, separate DB/object recovery, runbooks and release gates | Hosted staging verification, routed alerts, cron ownership, recovery objectives, business UAT |
| M7 | Production configuration and deployment runbook prepared; unsafe local deployment rejected | Owner-designated accounts/domain/secrets/content and authorized live journey |

All guest requests require staff approval. Prices, roles, inventory and payment success remain server-authoritative. No confirmed business requirement was removed to accommodate missing credentials.

See [requirements traceability](REQUIREMENTS_TRACEABILITY.md), [OpenAPI](openapi.json) (148 paths), [security model](SECURITY.md), [schema/ERD](architecture/ERD.md), and [staff guide](runbooks/staff.md).

## Executed verification

| Check | Actual result | Evidence |
|---|---|---|
| Clean locked install | 271 packages added; 272 audited; 0 reported npm vulnerabilities | [npm-ci-final.txt](evidence/npm-ci-final.txt); not a security certification |
| ESLint and TypeScript | Both exited 0 on final source | [static-final.txt](evidence/static-final.txt) |
| Domain suite `npm test` | **32 files, 162 passed, 0 failed** | [domain-final.txt](evidence/domain-final.txt) |
| Required command groups | Unit 28, DB 57, integration 33, contract 7, concurrency 7, security 30 in final combined suite; individual commands were also executed earlier, before the two final regressions | [domain-final.txt](evidence/domain-final.txt); named tests in traceability |
| Full release browser matrix | **25 passed, 14 deliberate engine-specific skips, 0 failed** | [browser-final.txt](evidence/browser-final.txt) |
| Final explicit accessibility matrix | **7 passed, 2 deliberate engine-specific skips, 0 failed** | [accessibility-final.txt](evidence/accessibility-final.txt) |
| Locale parity | 10 locales ×149 nonempty keys | [static-final.txt](evidence/static-final.txt) |
| Generated DB type drift | Matches all 117 tables | [static-final.txt](evidence/static-final.txt) |
| Production artifact | Next.js build exited 0 | [build-final.txt](evidence/build-final.txt) |
| Clean database rehearsal | All 18 migrations applied to a new database; then 63 DB/concurrency tests passed at rehearsal time | [database-clean-rehearsal.txt](evidence/database-clean-rehearsal.txt) |
| Database dump/restore | 117 tables, 44 bookings, 20 ledger entries, 116 outbox events matched | [database-restore.json](evidence/database-restore.json) |
| Separate object recovery | Synthetic 16 KiB object restored with identical SHA-256; traversal denied | [storage-restore.json](evidence/storage-restore.json) |
| Coordinated load | 32 independent connections requested 16 seats: 16 approvals, 16 conflicts, exactly 16 allocated | [local-load.json](evidence/local-load.json) |
| Performance lab | Four route/viewport samples; LCP 1.072–2.392 s, CLS 0; no Three.js or external origins | [performance report](PERFORMANCE.md), [raw aggregate](evidence/performance-lab.json) |
| Recorded route budgets | All four samples meet payload/layout/dependency budgets | [static-final.txt](evidence/static-final.txt) |
| Source/artifact scan | Zero findings; latest scan after imagery update covers 985 source files, 567 build files and 17 deployment traces | [source-artifact-scan.json](evidence/source-artifact-scan.json); limited scan, not penetration testing |
| Production/release gates | Correctly rejected local demo mode and missing designated environments/secrets/approvals | [production-gate-final.txt](evidence/production-gate-final.txt), [release-gate-final.txt](evidence/release-gate-final.txt) |

The browser matrix runs public locale, Arabic keyboard, request/access, responsive and apartment/transfer quote journeys in Chromium, Firefox and WebKit. Five specialized service submissions, the staff mutation scenario and axe audit run in Chromium; their Firefox/WebKit duplicates are explicitly skipped. No critical financial, authorization or concurrency domain tests are skipped. Accessibility results are automated checks, not a full WCAG or screen-reader certification.

The full browser run was followed by a focused accessibility rerun after deterministic viewport-test isolation and capture-readiness corrections. The domain run includes the final Cairo DST and forged payment redirect regressions. The clean-DB rehearsal occurred before the DST test was added; no migrations changed afterward.

CI is configured in `.github/workflows/verify.yml`, including isolated PostgreSQL, real media tools, all domain groups, build scanning and browser tests. **GitHub Actions has not run**, because no owner-designated remote is available.

## Browser, design and resource evidence

The five resource versions and acquisition checks are in [TOOLS_VERIFICATION.md](TOOLS_VERIFICATION.md); actual application is in [TOOL_USAGE.md](TOOL_USAGE.md).

- Playwright Agent CLI 0.1.22: actual public/Arabic/gallery navigation, snapshots and console inspection. Final `tourism-release` gallery inspection reported 0 errors and 0 warnings.
- Taste: pinned revision `63aba5f43b5056758b15bbe7d683da8c86a7a7ad`; source and rendered reviews changed typography, composition and mobile layout. Final rendered report retains **2 failures and 5 warnings**, explained in [UX verification](UX_VERIFICATION.md).
- Impeccable 4.7.0: original design/context, source detector and rendered corrections; real contrast failures led to removal of text opacity and color fades.
- img2threejs base 2.0.0: reference/spec/generation/mesh/visual checks executed. Structural silhouette passed at IoU 0.8797; current form gate failed at 0.7386. **Accent disabled**; material/lighting/runtime completion is not claimed. [Checkpoint](design/three/STATUS.md).
- getdesign 0.6.26: acquired Airbnb/Apple reference analyses, applied discovery and price-clarity principles to an original project design.

Finished screenshots were inspected after waiting for actual headings, decoded images and gallery content, not loading placeholders. Private evidence remains in `D:/Tourism/.local/evidence/ui/`: `release-public-desktop.png`, `release-gallery-mobile.png`, `release-arabic-mobile.png`, `admin-overview-desktop.png`, `admin-booking-desktop.png`, and `admin-content-mobile.png`. Profiles, traces, tokens, screenshots and owner originals are excluded from Git/deployment.

Measured fixes included effective approved catalog pricing, missing private-page cache headers, transient contrast failures, streaming layout shifts and oversized images. The WebKit viewport harness now uses independent pages so previous-navigation prefetch cancellation cannot contaminate a subsequent viewport's error collection; errors during each visit remain asserted. Earlier failures are not represented as successful runs.

## Operations and external launch work

The latest migration is **`20261020175000_pickup_editors.sql`**. Local SQL constraints, inventory races, restore and load evidence use real PostgreSQL, not an in-memory replacement. The existing unrelated host PostgreSQL installation remains untouched.

Worker, monitoring and retention routes and `vercel.json` schedules exist. Their local code/authorization paths are tested. No hosted scheduled invocation, provider send, merchant charge, refund, DNS change, account purchase or production alert delivery has occurred.

All E01–E14 in [BLOCKERS.md](BLOCKERS.md) remain unverified. The exact next action and owner are listed for each: designate repository, eligible Vercel account, domain/DNS, separate Supabase projects, Paymob merchant configuration, Meta credentials/templates/test recipients, Resend sender/account, approved inventory/prices/policies, legal/contact/social content, media consent, translation reviewers, staff invitations/MFA owner, Mux/monitoring, and UAT/recovery/live-test authorization.

The owner confirmed the working brand and local use of previous-trip media. This does not establish legal identity, production publication consent or approved operating claims.

After those inputs arrive, verify account/project/domain identities, configure secret storage, deploy and test staging, rehearse hosted DB and object recovery, complete UAT, then execute [deployment](runbooks/deployment.md) with [rollback](runbooks/rollback.md). Record the actual production URL, commit, callbacks, cron/alerts and authorized end-to-end live evidence here. Until then, M7 remains uncompleted.

## Subsequent owner-requested imagery update — 2026-10-20

Six generated editorial images now fill the desert, buggy, boat, transfer, coastline and apartment placeholders. Owner trip imagery and the previous-trip gallery remain intact. Visible localized illustration labels distinguish these concepts from actual inventory. Files, prompts, provenance and regeneration are documented in [editorial-imagery.md](design/editorial-imagery.md).

Verification for this scoped change: 6 targeted unit/localization tests passed; 8 focused browser/accessibility tests passed with 4 deliberate engine-specific duplicate skips; lint, TypeScript and production build passed. Locale parity now covers **150 keys in all ten languages**. The browser run checks all six subjects, responsive source selection, Arabic/mobile layout, existing owner-photo references and no generated images in the previous-trip gallery. These targeted results do not imply a new run of the entire earlier domain suite.

The final image pass meets the unchanged route budgets: homepage image payload 343,008 B desktop / 93,793 B mobile, CLS 0, with no third-party image host or Three.js. [Updated performance evidence](PERFORMANCE.md). Safe logs: [unit](evidence/imagery-unit-green.txt), [browser](evidence/imagery-browser-green.txt), [build](evidence/imagery-build.txt).

New private screenshots were inspected: `.local/evidence/ui/editorial-home-desktop.png`, `editorial-experiences.png`, `editorial-apartments-desktop.png`, and `editorial-apartments-arabic-mobile.png`. The owner's open local preview was refreshed and the new imagery visually confirmed.

## Owner media and repository update — 2026-10-24

The owner designated `ahmedbarakatt1/rshorizons`; GitHub returned the exact repository identity, empty initial history, push/admin access and enabled Actions. The local remote now points only to that repository. Source is published to `main` (`dac6011`). A manual GitHub Actions run (`40040938298`) is checking the clean Linux environment. The initial push did not create a run, so the workflow now also supports an explicit manual trigger. Hosting, domain, provider identities/secrets and business approvals remain E02–E14; production is not deployed.

Eight WhatsApp images supply boat, evening and vehicle photography. The gallery retains four earlier dive photographs and includes all 30 owner videos, optimized to H.264/MP4 up to 960 pixels with posters. Total video derivatives: 121,301,620 bytes, fetched only after selection. The three homepage owner photos are also retained. All 15 prepared photographs and all 30 video derivatives passed metadata/format/hash inspection. Public production galleries support approved processed video copies, correct MIME/dimensions, HEAD and byte-range requests while rechecking current publication eligibility. Originals and private derivatives cannot be requested through public URLs. Existing database guards/columns are reused; no schema migration was needed for this change.

Tests were written before implementation. The initial browser test found zero video players; the public-video integration test rejected an otherwise eligible video because the old selector allowed only image derivatives. Both regressions now pass. The first build exposed a Buffer/Response typing issue and an optional test lookup; both were corrected before the passing build.

- Unit suite: 31 passed. Security suite: 32 passed.
- Targeted PostgreSQL/media checks: media database tests, existing image/gallery integration, public-video publication/revocation/ranges, and real FFmpeg processing/provider-signature tests passed (17 database/integration cases across the recorded runs).
- Browser release subset: 5 passed, 4 deliberate duplicate engine skips. The new media flow passed in Chromium, Firefox and WebKit: no initial MP4 download, real decode/playback, seeking, all 30 entries revealed, car hero, Arabic mobile layout and automated accessibility.
- Lint, TypeScript, Next production build and 169-key parity across ten locales passed.
- Source/artifact scan: 1,000 source files, 559 build files, 17 traces, zero findings before documentation publication. This is a targeted configured-secret/private-path scan, not a general security certification.

Private screenshots: `.local/evidence/ui/owner-videos-desktop.png`, `owner-gallery-arabic.png`, plus the refreshed release/gallery/illustration captures. The in-app gallery was opened and visually inspected. [Media preparation evidence](evidence/owner-media.json) contains non-sensitive registry metadata/hashes; source provenance and originals remain private.

The fresh performance run also passed the unchanged four route/viewport budgets; see [performance](PERFORMANCE.md). Playwright Agent CLI inspected the gallery at 1440×1000 and saved `owner-gallery-preview.png`.

### First remote CI findings

Run `40040938298` passed all 168 then-current domain tests, clean migrations, storage recovery, production build and source scan. Its browser stage exposed an older four-photo accessibility expectation and reused the catalog populated by domain-test fixtures. The run was stopped after those failures. The expectation now checks 12 actual photographs, and CI prepares a separate fresh browser database without dropping the domain database. CI now runs the built production application rather than a development server. The isolation helper has two passing guard tests; lint/types pass. The full local release browser suite passed **29 tests with 16 deliberate skips**, and the additional accessibility run passed all six three-engine cases. This replaces the earlier scoped-only browser result; it does not label the stopped CI run successful.

The corrected CI run `40043370586` passed all 170 domain tests and every setup/build/recovery gate, including the separate browser database. It passed 28 browser cases and failed one Firefox accessibility case: `decode()` ran immediately after scrolling, before a lazy image request began. The saved trace showed successful WebP responses. The test now waits for `complete && naturalWidth > 0` before decoding, retaining failure for unavailable or broken images. No application media errors are suppressed.

### Final remote verification — SUCCESS

[GitHub CI run 40044050864](https://github.com/ahmedbarakatt1/rshorizons/actions/runs/40044050864) passed for source `ce6a0a0ecf27f2049720e5293e28eb8b18f1f572`. Exact results: **170 domain tests** (33 unit, 57 database, 7 concurrency, 34 integration, 7 contract, 32 security), **29 browser tests passed / 16 intentional skips**, ten locales ×169 keys, migration/type drift, clean production build, storage recovery and source/artifact scan. The browser suite used a separately migrated/seeded PostgreSQL database and the built production application. Both earlier CI findings are retained above; neither unsuccessful run is represented as a pass.

The repository contains no owner originals, local derivatives, profiles, database files or `.env.local`. Documentation-only updates after the tested commit do not change application code. E01 is resolved; E02–E14 remain external production gates. Local real-media screenshots were inspected at `owner-gallery-preview.png`, `owner-transport.png` and `owner-evenings.png` under `.local/evidence/ui/`. The local gallery remains at `http://127.0.0.1:3002/en/gallery`.
