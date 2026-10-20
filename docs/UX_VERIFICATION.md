# UI verification — 2026-10-20

All results below are local demonstration tests using synthetic inventory and contacts. They do not establish production merchant, provider, staff-authentication or media-publication readiness.

## Implemented surfaces

Ten localized public routes support discovery, destination/category/date/guest filtering, experience and apartment detail, quote-first requests, guest access by deliberate POST redemption, reservation status, pickup instructions, changes/cancellation, proposed revision review, eligible payment billing, public trip photography, private preview/download delivery, reviews, contact and policy content. Arabic has RTL layout and LTR identifiers/amounts. Local demo and publication status remain explicit.

Staff pages cover reservations and decisions; departure/resource calendars and assignments; properties, unit inventory and seasonal rates; transfers and operating manifests; payments/refunds and reconciliation; media upload/processing, packages, photographer access, entitlements, source rights, subject consent and public derivatives; catalog/translations/publication; guest review moderation; durable jobs; role/scoped staff access; invitation/MFA flows; settings/audit and reports. Typed forms call actual `/api/v1` routes. Staff authentication and external payments remain configuration-dependent.

## Executed checks

| Check | Actual result |
|---|---|
| `node node_modules/vitest/vitest.mjs run tests/unit/i18n.test.ts` | 3/3 passed: locale parity, Arabic direction, genuinely translated approval/payment notices. Initial missing-module RED was recorded before implementation. |
| `node scripts/i18n-check.mjs` | Ten dictionaries, 141 nonempty corresponding keys (latest exact run recorded below). Native editorial approval remains a launch gate. |
| `npm run typecheck` | Passed after UI and backend contracts were aligned. |
| Targeted ESLint on app/components/i18n/tests/scripts | Passed, no findings. |
| `node node_modules/@playwright/test/cli.js test tests/e2e/public.spec.ts` | 9/9 passed across Chromium, Firefox, WebKit: every locale, denied private access, Arabic keyboard/RTL/no overflow, real reservation submission remains pending, no checkout Three.js chunk. |
| `E2E_LOCAL_STAFF=1` operations.spec.ts, Chromium | 2/2 passed: local one-use operator login, actual resource creation, actual pending approval, mobile draft editor; apartment date availability/server quote and transfer fields. Token loaded silently from ignored local file. |
| booking-kinds.spec.ts, Chromium | 4/4 passed: apartment stay, transfer, standalone photography, tour plus photography add-on. Each submitted actual POST bookings, asserted HTTP201, pending_review, paymentRequested=false, then opened the scoped reservation status. |
| accessibility.spec.ts | In progress in this record; see final appended result. Tests verify 360/768/1440/1920 layouts, skip-link focus, image loading, no page exceptions, fragment removal and explicit POST redemption. |

The expanded booking tests initially selected a footer access link instead of the receipt-specific link; the locator was corrected and all four scenarios rerun green. Concurrent Playwright invocations once collided over ignored artifacts; final recorded runs are sequential. Transient backend compilation failures during concurrent development were rerun after code stabilized.

## Private browser evidence

`D:/Tourism/.local/evidence/ui/` holds public-desktop.png, public-mobile.png, arabic-contact-mobile.png, previous-trips-mobile.png, admin-overview-desktop.png, admin-booking-desktop.png and admin-content-mobile.png. Public and admin captures were visually inspected. Admin screenshots contain synthetic test references and remain outside Git. The root agent owns final release-build screenshots without the development indicator.

The actual Playwright Agent CLI session is `tourism-ui`. It navigated public/customer pages and inspected snapshot, console and network output. The latest gallery console had 0 errors/0 warnings; public galleries/social API requests returned 200. Historic logs include HMR requests aborted during development reloads, not a claimed production error-free session.

## Design verification

Taste source lint ended at 0 FAIL, 3 WARN (legitimate form/frame outlines and timestamp zero-padding). Impeccable source detector scanned 22 files using regex matching only; no source findings were printed, and runtime contrast/tiny-text checks were explicitly not covered.

Taste first real browser inspection reported nine failures; corrections made body text 16px, readable captions at least13px, a stronger primary picture, two-line headlines at768px, seven honest owner photographs, and removed decorative numbers/dividers. Second measured review showed two remaining findings (motion count and CTA links misclassified as eyebrows); both prompted a final refinement and reinspection. Final result is appended below, with any remaining warnings preserved. Private reports: `.local/evidence/ui/taste-public/`, `taste-public-final/`, `taste-public-reviewed/`.

No hosted payment, real outbound email/WhatsApp, production invitation acceptance or merchant refund is called verified from this local exercise. Those require the actual provider environments and approved launch data. Full WCAG conformance/native translation review/performance budgets are not inferred from these smoke checks.

## Final release evidence

The preceding entries preserve intermediate runs. The final built preview on port 3002 supersedes their counts:

- Complete browser matrix: **25 passed, 14 deliberate engine-specific skips, 0 failed**. It includes five specialized requests (stay, private transfer, shared transfer, standalone photography and tour photography add-on), staff resource creation and manual approval, and the shared public/RTL/access/quote flows across Chromium, Firefox and WebKit.
- Explicit final accessibility subset: **7 passed, 2 deliberate engine-specific skips, 0 failed**. Axe runs on representative public, gallery, contact, request and private-entry pages in Chromium. Keyboard, responsive widths and private-link behavior also run in Firefox and WebKit.
- Locale parity: **149 keys in each of ten languages**. Human approval remains external.
- Full domain tests: **162 passed**. Browser tokens and staff identities are synthetic local test data.

Final screenshots are `release-public-desktop.png`, `release-gallery-mobile.png` and `release-arabic-mobile.png` under `.local/evidence/ui/`, alongside the existing staff captures. They were visually inspected after checking actual headings and image decoding. The earlier release captures had caught loading placeholders; readiness assertions and new captures corrected the evidence, rather than presenting those placeholders as a finished interface.

The initial axe failure exposed text opacity and button color transitions with insufficient transient contrast. Those effects were removed. A private-page header assertion exposed `/my-booking` missing from proxy matching; it now receives private cache/referrer/indexing controls. A subsequent WebKit viewport run exposed navigation-prefetch cancellation contaminating the next viewport's console collector. Each viewport now opens an independent page, retains real error assertions and closes only after checks. The final explicit subset passed without retrying away failures.

Final Taste rendered inspection: **2 FAIL / 5 WARN**, retained in `.local/evidence/ui/taste-release/report.json`. One failure asks for more moving elements; the release deliberately keeps a single image entrance after removing the measured contrast problem. The other is a heuristic treating the functional “Request this stay” link as an eyebrow before a later heading. Remaining warnings cover the functional form frame, owner-approved pale palette, type-scale variety, absent background video and terse mobile heading. Actual owner photos and descriptive text are visible. These are documented design findings, not a clean Taste gate claim. Impeccable source detection also remains distinct from axe and manual rendered inspection.

The `tourism-release` Playwright Agent CLI session inspected the actual release gallery; final console query reported **0 errors, 0 warnings**. Performance traces drove responsive derivative sizing and loading-layout corrections; see [PERFORMANCE.md](PERFORMANCE.md) for measured results and limits. The 3D accent remains disabled after its failed form-quality gate.

## Owner-requested image replacement

Generated imagery replaced the catalog scenery and apartment placeholders after the initial release. All six subjects loaded in the browser, with localized labels and alt descriptions. The original hero and four previous-trip gallery images remained unchanged. The final scoped run passed 8 browser/accessibility tests, with 4 intentional duplicate exclusions, across the same three-engine responsive/access matrix. Unit/localization checks passed 6 tests; parity is now 150 keys per language.

New captures under `.local/evidence/ui/` are `editorial-home-desktop.png`, `editorial-experiences.png`, `editorial-apartments-desktop.png` and `editorial-apartments-arabic-mobile.png`. Desktop and Arabic mobile crops/captions were visually inspected, and the open in-app preview was refreshed. AVIF/WebP sources keep the original route payload budgets; no layout shift appeared in the final lab samples. See [imagery provenance](design/editorial-imagery.md).
