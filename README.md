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

Owner-supplied trip photos remain in `media/`. Local optimized derivatives can be regenerated with `node src/integrations/storage/prepare-owner-media.mjs`; production publication uses the consented media workflow. Original images/videos, local profiles and database files are excluded from deployment.

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

The browser suite covers all ten locale routes and Arabic RTL, all reservation kinds, approval, private-access denial, keyboard interactions and axe checks. Local Paymob/Meta/Resend/Mux contract evidence does not prove a merchant sandbox or live provider journey.

## Structure

- `src/modules`: catalog, bookings, payments, photography, reviews, staff, reports and durable jobs.
- `src/server`: validated API/authentication, database access, private-response handling and environment gates.
- `src/integrations`: Paymob, messaging, private storage and video processing.
- `supabase/migrations`: ordered authoritative SQL; never edit an already applied migration.
- `messages`: ten UI dictionaries; approved database content is separate.
- `docs`: requirements/evidence, OpenAPI, original design, resources and operations runbooks.

No direct anonymous access is allowed to the private application schema. The runtime role cannot administer the database. Customer links use hashed secrets, deliberate POST redemption and scoped HttpOnly sessions. Payment redirects never confirm a booking. Approved policy text and immutable quote snapshots accompany manual financial decisions.

## Deployment

Use the owner-designated Vercel and Supabase projects with separate staging/production credentials. Paymob, Meta WhatsApp, Resend and Mux are configured through server-only secrets. `vercel.json` defines bounded worker, monitor and retention cron jobs; the owner must designate a plan that supports their frequency and duration.

Follow [deployment](docs/runbooks/deployment.md), [rollback](docs/runbooks/rollback.md) and [staff training](docs/runbooks/staff.md). Production is deliberately unavailable while demo mode, synthetic catalog data, missing provider credentials, unapproved policies or incomplete locale approvals remain.
