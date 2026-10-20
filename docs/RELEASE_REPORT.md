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
| Source/artifact scan | 938 source files, 569 build files and 17 deployment traces inspected; zero findings | [source-artifact-scan.json](evidence/source-artifact-scan.json); limited scan, not penetration testing |
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
