# Red Sea Horizons

A Next.js application for agency-operated Red Sea trips, transfers, stays and photography. Every guest request waits for staff approval. PostgreSQL transactions enforce availability, current authorization and financial effects.

**Release state:** local release candidate implemented and verified; hosted staging, business acceptance and production launch remain externally blocked. No production deployment has been made. See the [release report](docs/RELEASE_REPORT.md), [PROJECT_STATUS.md](PROJECT_STATUS.md), [external dependencies](docs/BLOCKERS.md), and the authoritative [production handoff](CODEX_TOURISM_PRODUCTION_HANDOFF.md).

## Local setup

Use Node22.22.2, npm10.9.7, PostgreSQL17.11 and FFmpeg/ffprobe. Versions are pinned in the root lockfile. PostgreSQL must have `pgcrypto` and `btree_gist`; SQLite cannot replace it.

```powershell
npm ci
npm run db:start
node scripts/configure-local.mjs
npm run db:migrate
npm run db:seed
npm run db:types
node scripts/bootstrap-local-operator.mjs
npm run dev
```

The Windows database helper uses the task-local PostgreSQL binary under `.tooling/postgresql-17.11/pgsql/bin`, or `POSTGRES_BIN`. It creates/reuses only this workspace's loopback cluster on port55432. See [local database setup](docs/runbooks/local-database.md) for installation and Linux/CI alternatives.

Open `http://127.0.0.1:3000/en`. The one-use local operator token is saved in ignored `.local/operator-access.json`; enter it at `/admin`. It expires after eight hours and works only in explicitly enabled development/test demo mode. There is no default staff password. Never copy this grant or `.env.local` into Git.

Owner-supplied trip photos and videos remain in `media/`, including the WhatsApp subfolder. Restore these private originals separately when cloning; they are intentionally absent from Git. Prepare the local gallery with:

```powershell
node src/integrations/storage/prepare-owner-media.mjs
node scripts/prepare-owner-videos.mjs
```

The gallery includes selected event/boat/transfer-car photos and all 30 videos with posters and on-demand playback. See [media preparation and provenance](docs/design/owner-media.md). Production publication uses the consented media workflow. Original images/videos, local derivatives, profiles and database files are excluded from deployment. CI generates its own explicitly synthetic media fixtures.

## Verification

```powershell
npm run lint
npm run typecheck
npm test
npm run db:drift
npm run i18n:check
npx --no-install playwright install chromium firefox webkit
npm run test:e2e
npm run test:a11y
npm run api:spec
npm run build
npm run verify:production
```

`npm test` runs unit, database, integration, contract, security and real concurrency suites. These suites create synthetic records; use an isolated test database. Browser operation tests require `E2E_LOCAL_STAFF=1` and a fresh local operator bootstrap. Production verification intentionally fails on the local configuration.

The browser suite covers all ten locale routes and Arabic RTL, all reservation kinds, approval, reviews, private-access denial, large media transport, keyboard interactions and axe checks. Local Paymob/Resend/Mux contract evidence does not prove a merchant sandbox or live provider journey. Manual WhatsApp draft links require no gateway.

## Structure

- `src/modules`: catalog, bookings, payments, photography, reviews, staff, reports and durable jobs.
- `src/server`: validated API/authentication, database access, private-response handling and environment gates.
- `src/integrations`: Paymob, messaging, private storage and video processing.
- `supabase/migrations`: ordered authoritative SQL; never edit an already applied migration.
- `messages`: ten UI dictionaries; approved database content is separate.
- `docs`: requirements/evidence, OpenAPI, original design, resources and operations runbooks.

No direct anonymous access is allowed to the private application schema. The runtime role cannot administer the database. Customer links use hashed secrets, deliberate POST redemption and scoped HttpOnly sessions. Payment redirects never confirm a booking. Approved policy text and immutable quote snapshots accompany manual financial decisions.

## Deployment

The owner selected Vercel and will deploy. Follow the [Vercel owner setup guide](docs/runbooks/vercel-owner-setup.md) with separate staging/production projects and Supabase credentials. WhatsApp uses [manual links](docs/runbooks/whatsapp-links.md) to the two owner-designated team numbers and consent-checked guest drafts. Paymob, Resend and Mux use server-only secrets. `vercel.json` defines bounded worker, monitor and retention cron jobs; the owner must designate a plan that supports their frequency, duration and commercial use.

Follow [deployment](docs/runbooks/deployment.md), [rollback](docs/runbooks/rollback.md) and [staff training](docs/runbooks/staff.md). Production is deliberately unavailable while demo mode, synthetic catalog data, missing provider credentials, unapproved policies or incomplete locale approvals remain.
