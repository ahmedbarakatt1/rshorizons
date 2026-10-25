# Production readiness and flow verification — 2026-10-25

Specification: the complete production handoff plus owner decisions in `DECISIONS.md`. Base: `707eac5`. Continue on the existing authorized review branch; preserve exact npm dependencies, SQL checksums and all business requirements. No new product interview or mockup is needed.

1. Reproduce and fix guest-link recovery and email-to-checkout access with real PostgreSQL regressions.
2. Follow contact submission through the staff inbox and resolve missing operational actions with current authorization.
3. Check complete public/guest/staff flows, including approval, payment boundaries, changes, fulfilment, private media and reviews; inspect English, Arabic and long-language responsive evidence.
4. Run local domain/browser/security/build/dependency and recovery checks; independently review the final change and publish verified source/evidence.
5. Recheck designated hosted configuration and complete eligible deployment tasks. Leave missing paid-plan, domain/provider credentials, approved business content, staging, recovery and UAT evidence explicit. Never enable approval flags without evidence.

## Execution ledger

- Discovery: complete handoff reread; `.codegraph` absent; existing branch and application preserved. Previous source `35fc3c6` passed CI209 domain/55 browser tests; this is historical evidence.
- Recovery: API emits `guest_access_requested`, absent from notification event mapping. Approved-email booking grants also omit `payment:create`, preventing checkout after deliberate redemption. Regression tests written before fixes.
- Contact: alert points to `/admin/contact`, but the current administration navigation/read map has no inbox; reproduce before implementing.
- External setup: owner hosting direction and sender domain/account questions are pending. No billing action is authorized by silence.

## Completed implementation and review

- Recovery: real PostgreSQL tests reproduced HTTP500/unsupported event and forbidden emailed checkout. Fixed UUID typing, durable recovery mapping and booking grant payment scope. Nine focused messaging/recovery cases passed; grants remain hashed, single-use and booking-bound, and payment requires staff approval and persisted obligations.
- Contact: implemented an owner-authorized inbox/detail and versioned resolution. Tests reproduced missing routes, then verified current permissions/global scope, retention exclusion, redacted audit, stale updates and independent-connection races. Migration `20261025180348_contact_inbox.sql` uses security invoker.
- Ruling: contact enquiries have no destination association, so default access is owner-only with global scope and dedicated read/manage permissions. Other staff require an explicit grant; the cost is an extra access setup step if the owner delegates the inbox.
- Release: persisted checks require every guest email event in each enabled language and the configured staff alert. Validate approved production provider, category, subject/body, supported variables and an access link. No real template was approved or sent.
- Final review: two important findings fixed with failing-then-passing regressions: retained contacts beyond 200 are reachable through cursor pagination/server state filtering, and reviewed marketing review invitations are accepted while dispatch still enforces marketing consent. Staff alerts now link directly to the authenticated enquiry.
- Review coverage gap closed: bounded contact retention dry-run/approved cleanup, redacted audit and database deletion denial for active contacts. Migration `20261025181528_contact_retention.sql` grants only expired-row DELETE under RLS. Daily authenticated retention reports contact counts; approval remains false in production.
- Browser corrections: local recovery template v2 puts the URL on its own line; preserves immutable v1. The operations test bootstraps its own one-use operator token so repeated suites do not reuse a redeemed credential.
- Current final checks:217 domain tests/51 files, lint, TypeScript, production build,118-table drift,218 keys in10 locales, zero reported production dependency vulnerabilities, clean25-migration rebuild/real PostgreSQL races and pg_dump/restore passed. Private source/artifact scan found zero configured-secret/private-path matches. Fresh three-engine browser sweep passed57 tests with24 documented skips; desktop contact and recovered-booking screenshots were visually inspected.
- Hosted read-only check: designated Supabase still has23 migrations,118 tables,zero bookings/contacts,one MFA-required owner and zero approved Resend templates. Bookings are disabled. Vercel remains Hobby; its latest deployment is ERROR. Sensitive environment pull placeholders were resolved from private provisioning sources only for read-only preflight, never treated as missing remote secrets.
- Exact next task: finish the browser sweep; publish verified source to existing PR1; apply/verify the two safe forward migrations against the designated empty production database; follow remote CI; record remaining owner/provider/staging/content gates. No main merge, paid upgrade, send or live charge is authorized by silence.

## Published and hosted follow-through

- Source `b60ece1` published to existingPR1. Both forward migrations applied to production with guards checking all23 prior committed checksums. Production now has25 migrations. Read-only `tourism_app` verification proves security-invoker contact resolution, owner-only permission defaults, RLS enabled, anonymous reads denied and DELETE restricted to expired rows. Zero bookings/contacts and booking-disabled state are preserved.
- The post-migration Management API CLI read stalled after login-role initialization and was stopped. The restricted TLS application connection completed the same relevant permission/policy/count verification. Security advisor returned only the existing leaked-password-protection warning; no purchase/plan change was made.
- CI40221138612 exposed a fixture-order problem: four recovery POSTs left a shared local rate-limit bucket which made a later single-use replay assertion return429. Added cleanup of that fixture's guest-access bucket; production throttling is unchanged. Recovery→API sequential regression and the full domain suite are rerun before publishing the correction.
- Exact next task: finish corrected CI, update PR/status with its final result and record the external launch handoff. Owner hosting/domain questions are still unanswered; no approval flag is inferred.
- CI40221458143 passed all217 domain tests/build/security stages, then exposed a browser-fixture environment difference: the worker invoked inside Playwright lacked the generated test TOKEN_HASH_PEPPER while Next loaded it from `.env.local`. Playwright now loads that same file without overriding CI's isolated browser database URLs. A local run deliberately omitted the inherited secret and passed both recovery/contact browser cases. Repeated contact fixtures also reset their isolated contact throttle; production limits are unchanged. Active README/onboarding/notification docs no longer instruct OpenWA setup.
