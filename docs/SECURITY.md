# Security model and release boundaries

This is an agency-operated application with public guest checkout, scoped private access and invite-only staff. A booking is not confirmed until authorized staff approve it and any initial payment obligation is satisfied.

## Data and authorization

`app` is a private PostgreSQL schema with RLS and no anonymous/authenticated Data API access. Runtime credentials are distinct from migration credentials and cannot bypass RLS or administer the server. Narrow `SECURITY DEFINER` routines perform inventory and financial mutations with a fixed search path. Server code validates current staff activity, permission and destination/property scope; role strings from browsers are never accepted.

Staff use Supabase email/password identity and an invited active profile. The owner chose password-only administration on 2026-10-27, so an authenticator code is not required at login. Roles, scopes, active status and revocation are still checked against current database state on protected actions; login attempts are throttled, cookies are HttpOnly, and logout clears cookies and revokes the provider session when configured. The local one-use operator mechanism remains unavailable outside development/test demo mode.

Customer secrets are cryptographically random and HMAC-hashed using a server pepper. POST redemption consumes the one-use grant; GET and link scanners do not. Sessions use the intersection of current grant/session scopes. Guessed booking references, gallery IDs, derivative IDs and object keys do not confer access.

## Funds and inventory

Quotes use server rules, effective service dates, integer minor units, explicit fees and accepted policy versions. Guest submissions remain pending. Approvals serialize on the booking and inventory rows and allocate all items atomically. Physical stays use half-open date ranges with cleaning buffers; shared transfers reserve passenger seats once per booking and reuse departure-level vehicle/driver assignments.

Payment attempts bind idempotency keys to the full validated request. A signed, correctly correlated provider event or authenticated reconciliation is required for financial effects. Late payments remain in the ledger with an exception; they cannot resurrect expired inventory. Unknown checkout/refund outcomes are reconciled without a blind second financial request.

Refunds bind the original receipt, current refundable cap, immutable accepted policies and the authorized operator's rationale. Policy bodies are approved text, so the recorded calculation is explicitly manual. Approval and execution are separate. Money, provider events and audit records are append-only.

## Media and privacy

Uploads are quarantined, bounded and validated from bytes. Images are decoded and metadata-stripped before delivery; videos use bounded local FFmpeg in tests and a signed private Mux adapter in deployed environments. Originals stay in a private bucket.

Private downloads check current guest scope, paid and fulfilled purchased-package entitlement, asset/gallery state, expiry, revocation and entitlement version on every request. Download tokens travel in a header and expire quickly. Public derivatives require source rights and subject/guardian evidence; a private package is not marketing consent.

Retention defaults to a dry run until the policy is approved. Active galleries and entitlements are preserved. Tombstones commit before object removal; failed object/provider deletion remains retryable. Unknown provider-upload references require reconciliation, never guessed deletion. Expired authentication hashes are erased in bounded batches while referenced records and financial/audit history remain.

## Browser and operational controls

Cookie mutations require the exact configured Origin. Private API/pages use no-store/noindex and no-referrer behavior. CSP uses per-request nonces; production excludes unsafe-eval. Logs contain error codes and correlation IDs instead of secrets, raw webhook bodies or customer contacts. Upload paths are explicit private keys with traversal rejection.

Durable outbox events, leases, retries and dead-letter records survive process restarts. Workers are bearer-authenticated, bounded and idempotent. Monitor metrics cover dead/stale jobs, unresolved financial exceptions, stale holds and missing confirmed allocations.

## Verification limits

Actual negative/race tests live in `tests/security`, `tests/database`, `tests/concurrency` and `tests/integration`. Browser evidence, restore evidence and exact final results belong in the release report. No local test establishes live provider configuration, native-language approval, legal compliance, production penetration-test coverage or a production recovery objective.

Report a suspected incident to the owner-designated incident contact once configured. Follow [incident response](runbooks/incident.md) and [privacy operations](runbooks/privacy.md); do not erase financial evidence to resolve an incident.
