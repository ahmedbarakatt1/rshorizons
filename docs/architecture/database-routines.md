# Private database routines

The trusted server connects as `tourism_app`. Browser roles cannot use the `app` schema. Staff actor IDs must come from verified, current server sessions; SQL rechecks active staff, permissions and applicable destination/property scopes. Guest ownership and grant scope are checked in the server before calling guest routines. SQL migration credentials are never used by request handlers.

Money columns are integer minor units. JSON returned by booking, quote, finance and configuration functions passes through `app.money_json`, preserving money as decimal strings. PostgreSQL `bigint` values returned as ordinary columns also remain strings in `pg`.

| Routine | Contract |
| --- | --- |
| `create_quote(input jsonb)` | Server prices discriminated items. Input includes binding hash, locale, payment policy and items. Add-on `parentPosition` is **zero-based** and must reference an earlier eligible parent. Optional photography/add-on `packageId` must be an active package with approved locale text; its price and delivery cap are snapshotted. |
| `submit_booking(input jsonb)` | Consumes an immutable, unexpired, caller-bound quote; validates exact accepted policy versions, contacts and participants. The same key/body returns the same request; changed content conflicts. No inventory is allocated. |
| `approve_booking(booking, expectedVersion, actor)` | Locks target and expired competing bookings, checks scope/state/version/current eligibility, allocates every item or none, writes obligations and outbox in the same transaction. |
| `decide_booking(booking, expectedVersion, actor, action, reason)` | Explicit reject/cancel with scoped permission, state/version checks and atomic inventory release. |
| `expire_payment_hold(booking, now)` | Booking lock serializes with payment. Expiry releases allocations in the same transaction and retains history. |
| `create_booking_request`, `propose_revision`, `accept_revision`, `apply_revision` | Requests do not release inventory. An accepted replacement is applied atomically; failure retains original allocations and records. |
| `fulfil_item_versioned(item, state, note, expectedBookingVersion, actor)` | Locks the booking, rejects stale version and records the operational event. |
| `create_payment_attempt(booking, obligation, key, provider, environment)` | Reserves only the remaining collectible amount under booking lock; unresolved attempts block another request. |
| `claim_payment_creation(attempt)` | One caller gets `true` and may invoke the provider. Persisted claim precedes external I/O. |
| `finish_payment_creation(attempt, providerRef, checkoutUrl, state)` | Persists private correlation and checkout URL or an unknown outcome. |
| `apply_payment_event(event)` | Called only after verified provider correlation. Delivery IDs dedupe inbox records; semantic transaction effect IDs dedupe cash ledger. Late payments remain recorded without restoring expired inventory. |
| `request_refund_idempotent(input, key, actor)` | Exact source receipt, scope, canonical request hash, advisory serialization and cumulative cap. Input fields are `bookingId`, exactly one original source ID, `amountMinor`, `reason`, `policyCalculation`. |
| `approve_refund(refund, expectedVersion, actor)` | Requires permission, current scope, configured finance limits and separation of duties; owner exception is explicit. |
| `claim_online_refund(refund, expectedVersion, actor)` | Persists an unknown attempt and exception before network I/O. Exactly one caller may invoke the provider. Returns attempt `id`, `refund_request_id`, original transaction IDs, provider/account/environment, decimal-string `amount`, `currency`, request key and version. |
| `save_online_refund_reference(attempt, providerRef)` | Saves a returned reference or null unknown outcome; never marks a refund successful from a POST response alone. |
| `complete_online_refund(attempt, providerRefundId)` | Called only after authenticated provider inquiry verifies parent/account/environment/currency/amount/success. Locks original receipt domain, rechecks net cap, appends one negative effect, closes the request/exception and emits outbox. Callback-first and reconciliation-first use the same semantic key. |
| `complete_offline_refund(refund, key, actor)` | Explicit approved offline route, original receipt cap and one ledger effect. |
| `staff_edit(kind, id, expectedVersion, data, actor)` | Fixed relation allowlists, typed values, current permission/scope, optimistic versions and audit. Covers catalog, units, resources, content, operations and media configuration. |
| `invite_staff(authId, email, name, roles[], scopes, actor)` | Owner with all scopes only; identity/email must already exist in Auth. Creates inactive staff pending activation, records audit, and never sends a message. |
| `retry_job(job, actor)` | Failed/dead jobs only; live leases cannot be stolen. Booking aggregates use aggregate ID for scope; jobs without a booking require all scopes. |

Provider reference uniqueness is namespaced by provider, account and environment. Online refund completion does not issue a provider request. A crash, timeout or unverified response remains an unknown outcome and blocks another refund on the same original receipt until reconciliation.

Common domain errors use stable message codes with SQLSTATE `P0001`, including `VERSION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `INVENTORY_CONFLICT`, `REFUND_EXCEEDS_RECEIPT`, `REFUND_OUTCOME_PENDING` and `REFUND_CORRELATION_MISMATCH`. Permission/scope failures use `42501`. Referential, uniqueness and check failures retain PostgreSQL constraint SQLSTATEs; HTTP handlers must map them without returning raw query details.

Configuration editors cannot approve their own translation write implicitly. Editing text clears approval; publication requires approved enabled locales. Rights and subject review require an owner with all scopes, the current asset version and supplied evidence. Consent insertion names the subject and authorized grantor; withdrawal preserves evidence and revokes public delivery. Gallery entitlement limits come from the purchased quote snapshot rather than current mutable package settings.

The SQL fragments at `supabase/*.sql` aid review. Only ordered `supabase/migrations/*.sql` files are authoritative for deployment. Applied migrations are checksum checked and never rewritten. Local reassembly helpers refuse to overwrite nonempty generated migrations.
