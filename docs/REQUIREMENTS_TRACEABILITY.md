# Requirements traceability

Specification: `CODEX_TOURISM_PRODUCTION_HANDOFF.md`, unchanged. Evidence is local unless explicitly stated. Production and real-provider gates remain open; code existence is not production verification.

| Requirements | Implementation | Executed verification / remaining gate |
|---|---|---|
| Five resources, original design, M0 | `.agents/skills`, `.tooling` lockfile, PRODUCT.md, DESIGN.md | Acquisition and application ledgers in TOOLS_VERIFICATION.md / TOOL_USAGE.md; actual inspectors and captures |
| G01 ten locales, Arabic RTL | `messages`, `src/i18n`, localized routes |218 keys ×10; unit parity; ten-locale and RTL keyboard browser tests on3 engines; native editorial approval external |
| G02/G03 approved catalog and offer details | `src/modules/catalog`, catalog/detail/editors | API contracts; effective-date/priority/unapproved-variant pricing regression; actual itinerary, restrictions, pickup and quote fees |
| G04/G05 requests await manual review | `src/modules/bookings`, SQL and forward migrations | workflows/API/browser: pending receipt, no payment, no allocation; idempotent retries |
| G06/G07 supported payment policy and eligible payment | quote snapshots/obligations, `src/modules/payments` | full/deposit/arrival, immutable policies, server prices, initial threshold, request-bound checkout; actual Paymob merchant sandbox external |
| G08 secure booking management | `src/server/auth`, guest flows, revisions | scoped hashed grants, deliberate POST redemption, revocation, change/cancellation preserve inventory, accepted replacement atomicity |
| G09/S04 physical apartments | apartment inventory/rates/fees, staff stays | half-open ranges, cleaning buffer, manual-block race, checkout/stay quote browser, versioned staff operations |
| G10/S03 transfers and manifests | shared departures and resource routines, transport/admin manifest | vehicle type/passengers/collective luggage, driver coverage, no per-guest exclusive vehicle reservation, shared last-seat race |
| G11/G13/S07 photo packages and delivery | photography module, packages, assignments, private storage, video | real bytes/FFmpeg, current paid and fulfilled package limits, assignment/IDOR/revocation, signed Mux callbacks; live Mux/storage external |
| G12 past-trip media and bounded 3D | local responsive derivatives, consented public proxy, lazy 3D island | owner photographs used locally with hashes; publication rights/subject consent external; 3D form gate failed so static poster retained |
| G14 verified reviews | reviews/invitations/moderation/replies | completed item only, one invitation use, immutable original/rating, safe display names |
| G15 contact/social | contact/privacy/rate limit/outbox, protected inbox, verified social links | API/DB/browser submission, cursor pagination, scope/current authority, versioned resolution, independent-connection race, approved retention and expired-row RLS; real empty states |
| G16/S09 messaging/reliability | leased outbox jobs, reminders, monitor, Resend and manual WhatsApp links | durable email recovery and approved checkout scopes, marketing consent, multilingual template gate, unknown outcomes, authenticated callbacks, manual drafts/current consent; live email/alerts external |
| S01/S02 approval and scope | current permissions, transaction routines, admin queue | last-seat/mixed-scope/disabled-staff denial, all-item rollback, actual staff browser approval |
| S05 finances | immutable ledger/refund routines/reconciliation/reports | duplicate/distinct events, late payment, deposit threshold, refund caps and separation, provider-parent correlation, scoped period cash/receivables/liabilities |
| S06 content workflow | typed catalog/variant/apartment/CMS editors, translations/publication | version/scope checks, edit revokes approval, all-locale publish guard, consent controls; approved agency texts/content absent |
| S08 staff lifecycle | Supabase invitations/MFA/current roles/scopes | identity mismatch/last-owner/revocation tests, local one-use browser access; owner-designated real staff invitation/MFA journey external |
| M6 recovery/privacy/security | CI, release gates, retention, runbooks |217 domain tests;57 browser passes/24 documented skips; clean25-migration rebuild, DB and object restoration; load, performance and artifact scan; staging recovery/UAT still external |
| M7 actual production deployment | Vercel config, safe release sequence, production gates |BLOCKED_EXTERNAL; no production URL or live verification claimed |

## Required named regressions

Each name below maps to executable tests. See the release report and `docs/evidence` for actual run outputs; some names share one scenario with several assertions.

| Named cases | Executable file |
|---|---|
| request_does_not_confirm; duplicate_request_is_idempotent; same_idempotency_key_different_body | `tests/database/workflows.test.ts`; public browser tests also check receipt |
| disabled_staff_cannot_approve; scoped_property_manager_mixed_booking | `tests/database/workflows.test.ts` |
| deposit_threshold; same_transaction_distinct_events; late_payment_exception; refund_cannot_exceed_receipt | `tests/database/workflows.test.ts` |
| change_request_preserves_inventory; notification_worker_restart | `tests/database/workflows.test.ts` |
| last_seat_two_approvals; apartment_approval_races_manual_block; adjacent_stays_and_cleaning_buffer; multi_item_failure_rolls_back | `tests/concurrency/approval.test.ts` |
| shared_departure_resource_not_per_guest_exclusive; payment_vs_expiry | `tests/concurrency/approval.test.ts` |
| bad_signature_no_financial_effect; redirect_cannot_mark_paid | `tests/integration/api.test.ts` |
| guest_link_prefetch | `tests/integration/api.test.ts` |
| private_gallery_idor; public_gallery_requires_consent; review_completed_item_only | `tests/integration/media.test.ts` |
| whatsapp_opt_out | `tests/integration/messaging.test.ts` |
| ten_locale_key_parity; arabic_form_keyboard_flow | `tests/unit/i18n.test.ts`; `tests/e2e/public.spec.ts` |
| cairo_dst_scheduling | `tests/database/time.test.ts` |
| checkout_no_threejs | `tests/e2e/public.spec.ts`; `scripts/performance-lab.mjs` additionally inspects fetched script bodies |
| production_no_demo_secrets | `tests/unit/environment.test.ts`; actual `npm run verify:production` fails local configuration |

Additional adversarial tests are in `tests/security/release-review.test.ts`, including model reclassification, parent-date photography pricing, wrong resource kind, full photographer coverage, transfer luggage, shared-transfer races, pickup fee binding and server-bound refund policy evidence. Database and contract refund tests cover exact claim/finalization and provider correlation.

The browser matrix deliberately runs the five specialized service-kind submissions and staff mutation scenario in Chromium; locale, request, access, responsive and keyboard journeys also run in Firefox and WebKit. Those documented engine-specific exclusions are not skipped security or financial domain tests.
