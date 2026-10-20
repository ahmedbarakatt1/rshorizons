# Red Sea Horizons

Read `PROJECT_STATUS.md`, `docs/DECISIONS.md`, `docs/BLOCKERS.md` and the full production handoff before continuing.

The handoff is the approved specification and execution plan. Preserve every confirmed business requirement. Continue independent work when external credentials/approvals are missing. Do not publish unapproved claims or use another project's accounts.

Use npm with exact versions and the committed root lockfile. SQL migrations are authoritative; use real PostgreSQL for constraints/concurrency. No application code may trust browser prices, roles, inventory or payment success. All reservations require staff approval.

Keep originals, local credentials, browser profiles, private evidence and local database files outside Git/deployment. The supplied brand board informs the owner-approved working brand, Red Sea Horizons; publication rights for source media still require evidence.

## CodeGraph

If `.codegraph/` exists at repository root, use CodeGraph before grep/find/file reads for code understanding. Otherwise skip CodeGraph; indexing is the owner's decision.

## Cloudflare

Use the cf CLI unless the project has Wrangler configuration. Do not infer domain/account ownership or alter unrelated DNS.

## Verification and continuation

Write behavior tests first, run them, implement, and record actual results. Browser evidence is required for working user flows. Never label code verified just because it exists. Update status with exact next task before context boundaries.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
