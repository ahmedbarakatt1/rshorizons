# Public showcase QA release plan

The decision for this release is whether guests can discover a current offer, understand its price, and hand their own message to the correct customer-service number. Staff confirm availability, the final amount and payment details. The current public site also accepts immediately published reviews, exposes approved trip media and supports ten languages. The owner’s decisions dated October 26–29 and November 26, 2026 supersede the original online-checkout and email journeys in the production handoff.

## Risk and coverage

| Priority | Journey and failure to catch | Acceptance evidence |
| --- | --- | --- |
| P0 | A guest chooses an activity and gets another offer or price | In English desktop and Arabic mobile, follow home → each of snorkeling, diving, boat trips and beach buggy → first priced offer → booking. Match the service title and displayed price at every step. Apply the home activity search and refresh availability. Compare the rendered links with the filtered local API response. |
| P0 | A draft creates an order, contacts the wrong person, sends prematurely, or loses details | On English and Arabic desktop and mobile widths, complete a transfer with date, time, party, locations, flight, luggage and notes. Cover both approved numbers and all four payment preferences. Validate required fields, draft focus, the editable text, Unicode and punctuation, the decoded destination URL, blank-draft behavior, the unconfirmed-booking message and form state after editing. Record and block any unexpected API mutation or WhatsApp navigation. |
| P0 | Payment or contact information leads to the wrong recipient | Match the InstaPay address and approved external link, wallet number, the instruction to request bank details, and the warning to confirm before transferring. Check telephone, email and social destinations and accessible names. Stop at the handoff. |
| P0 | Retired sales are still public or bookable | Check both locales for the apartment listing/detail, photography listing/detail, and both old booking query forms. Require a 404 HTTP response, a not-found screen and zero offers or booking form controls. Check sale links on each current booking page. |
| P0 | A public view reveals a private reservation or grants access on navigation | A reference alone yields customer-service contacts. Private responses carry no-store, noindex and nonce-based CSP. A private link fragment leaves the address bar and requires a deliberate redemption action. Use a local synthetic token and intercept its redemption. |
| P0 | A guest photo remains private but appears publicly, or the gallery loses previous trips | On the isolated local fixture, sign in as an owner, upload a synthetic image and verify that a new signed-out context can decode the processed asset alongside the existing collection. The integration suite exercises authority and publication state. Existing gallery tests cover lazy loading, playback and seeking. |
| P1 | Reviews claim success too early, hide feedback, or fail silently | Compare a real read API response to the rendered list. Intercept writes to exercise public and invited submission, consent, Arabic retry with retained input, immediate publication, rating filters, pagination, aggregate accuracy, staff replies and the honest empty state. Integration and database tests cover persistence, authorization and immutable review content. |
| P1 | A language switch drops the route or the layout obstructs the next step | Switch the same activity among all ten languages, check lang, direction, heading and priced offer. Inspect English/Arabic narrow and wide layouts, tab order, focus after form transitions, accessible names, image decoding and horizontal overflow. Run automated WCAG A/AA checks on representative pages and review controls. |
| P1 | Historical staff actions accidentally restart public checkout or messaging | Exercise the existing staff workspace with isolated historical bookings. A consenting guest has a manually opened staff WhatsApp draft. A historical manual-contact queue entry links back to that record. The service-mode integration suite checks that retired API operations are unavailable. |

## Execution

1. Use the root lockfile and the documented isolated PostgreSQL test database and storage. Apply migrations and prepare designated synthetic fixtures. The public activity tests require a priced offer in every active category and a transportation service. The full staff/media tests require a loopback browser origin, a matching application origin, local storage and the same isolated database as the application. Keep local credentials, traces and screenshots in ignored directories.
2. Run lint, type checking, locale parity, dependency audit, a clean Next production build and the real-database test suite. Build and serve with the same application origin used by the browser. Check the readiness endpoint before starting browser tests.
3. Run the tagged public regression across the configured Chromium, Firefox and WebKit projects. The four draft scenarios use desktop and phone-sized viewports. The static imagery inspection and the larger release-page axe scan run once in Chromium. The review axe scan, keyboard checks and flow assertions cover all three engines. Browser emulation does not establish behavior in a native WhatsApp or InstaPay app.
4. Run the full local browser suite with the staff fixture enabled for authenticated and historical workflows, including the owner photo upload. Run that pass by itself so other local runs do not replace the one-time operator grant. Record passes, failures and deliberate engine-specific skips separately.
5. On an authorized deployed candidate, perform read-only smoke checks with English desktop and Arabic mobile. Start on the home page, open all four sections, compare prices with the linked booking form, prepare a draft, inspect contact/payment links, load reviews and decode an image. Record the deployed URL and revision independently of local evidence. Owner UAT covers physical devices, language quality and final content. Real messages, transfers and synthetic public reviews are outside this smoke.

From PowerShell, against an already running **isolated candidate**:

```powershell
$env:E2E_BASE_URL = 'http://127.0.0.1:3000'
npm run test:e2e -- --grep @public-release
$env:E2E_LOCAL_STAFF = '1'
npm run test:e2e
```

A single-engine investigation can append `--project=chromium` to either Playwright command. Use `--reporter=line --output=.local/evidence/<run-name>` for a private local evidence directory. Domain checks with `npm test` include historical service fixtures and the separate current manual-service assertions. A passing historical fixture does not turn checkout or automated email on.

## Release decision

Block promotion for a misdirected payment/contact, a private-data leak, a write from a public booking draft, a bookable retired service, or a broken primary activity or photo-publication journey. For a failed check record the candidate revision and mode, browser, locale, viewport, fixture, steps, expected/observed result, impact and trace or screenshot path. Retest the failing case and its adjacent flow on the fixed candidate. Release evidence should distinguish local fixtures, intercepted review responses, deployed read-only checks and owner UAT. Existing owner approval and deployment gates are tracked in `docs/BLOCKERS.md`.

## Evidence from November 26

- The pre-change optimized build on port 3019 passed 28 of 29 Chromium public checks. The homepage axe scan found four gallery thumbnail links without accessible names. The six retired URLs rendered a 404 screen through HTTP 200. Both findings were reported during the pass.
- The development candidate on port 3026 subsequently returned genuine HTTP 404s for all six retired URLs in English and Arabic. Both focused Chromium tests passed.
