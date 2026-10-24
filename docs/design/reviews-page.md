# Guest reviews page — 2026-10-24

## Direction and scope

This is a code-led **Read** surface within the established Red Sea Horizons website. PRODUCT.md and DESIGN.md remain the authority; no replacement visual world or comparison comp was requested. The page helps a traveler understand published guest feedback, its verification process and the route for submitting an invited review.

The implementation preserves the existing navy, turquoise and sand palette, Georgia public display typography and system body text. A desktop left rail carries the complete rating aggregate and distribution, while the main column gives original reviews and separate agency replies room to read. Hairlines separate entries without turning them into decorative cards. The full-width pale sea invitation section explains eligibility and privacy before presenting secure access or the submission form.

Mobile stacks the summary and feed, retains readable review text and exposes full-size form controls. Arabic uses logical layout, natural letter spacing and the site's Arabic sans-serif treatment. Original review language and direction remain independent of the interface locale. Root design tokens and the established DESIGN.md are unchanged; this note records the surface rather than normalizing the shared design system.

## Implemented behavior

- Published reviews retain the guest's complete original text and rating. Original text and rating remain immutable; public agency replies are distinct and only published, non-withdrawn replies appear.
- The aggregate and distribution include every published review, including critical ratings. Filtering changes the visible result set, not the overall aggregate. Sorting is newest first, with keyset pagination ordered by submission timestamp and ID; the default page holds 12 reviews and the API accepts at most 24.
- Loading, empty, no-match and recoverable failure states are explicit. An empty collection does not display a fabricated zero-star average.
- Existing completed-experience invitation eligibility remains enforced by the server. Secure grant redemption leads to the invited form, which offers initials, first name or anonymous public display and explains that booking/contact details remain private.
- Forty-four new translation keys bring parity to 213 keys in each of the ten supported locales: en, de, pl, fr, ru, uk, es, ar, it and nl. Key parity is not human translation approval.
- The primary desktop and mobile navigation includes Guest reviews. Entry headers allow 100-character display names to wrap on narrow screens. The finishing regression ran red first, then passed in Chromium, Firefox and WebKit.

Primary implementation sources are `src/components/ReviewsPage.tsx`, `src/components/reviews.css`, `src/components/PublicShell.tsx`, `src/components/GuestFlows.tsx`, `src/app/[locale]/[[...path]]/page.tsx`, `src/modules/reviews/service.ts`, `src/modules/reviews/types.ts` and `messages/{en,de,pl,fr,ru,uk,es,ar,it,nl}.json`. Shared styling remains in `src/app/globals.css`.

## Recorded scoped verification

Behavior tests ran red before implementation. The implementation agent reported the following completed results after implementation:

| Check | Result and scope |
|---|---|
| Real PostgreSQL behavior | `npx vitest run tests/database/review-page.test.ts tests/database/media.test.ts tests/integration/reviews.test.ts` — **12 passed** |
| Browser behavior and accessibility | `tests/e2e/reviews.spec.ts` — **5 cases × 3 engines = 15 passed** against the development server on port 3003; this includes the navigation/100-character-name regression |
| Impeccable mechanical detector | `[]` for `src/components/ReviewsPage.tsx` and `src/components/reviews.css` |
| Manual finish review | **ship**, scoped to the three supplied desktop/English mobile/Arabic mobile captures and reviewed source; retained for the subsequent narrow navigation review |

Browser tests use explicitly synthetic intercepted API payloads for rendering, aggregate/filter/pagination, empty/error recovery, invited submission, display-name choice, accessibility and mobile/RTL checks. They do not prove a live invitation or provider delivery. Database behavior is covered separately by the real PostgreSQL tests. No provider message was sent and no fake customer reviews were added to the database for this page. The existing domain test database already contains synthetic reviews.

Taste's browser inspector could not launch Chrome: Chrome exited early with code 0. Playwright browser checks and manual visual inspection supplied the working evidence; the failed Taste launch is not recorded as a successful inspection.

## Evidence and review boundary

Private evidence remains outside Git/deployment:

- `.local/evidence/ui/reviews-desktop.png` — desktop capture, 1440 px wide; synthetic feedback and reply are visibly labeled.
- `.local/evidence/ui/reviews-en-mobile.png` — English mobile capture, 390 px wide, including the invited form.
- `.local/evidence/ui/reviews-ar-mobile.png` — Arabic RTL mobile capture, 390 px wide, including mixed-direction original feedback and the invited form.
- `.local/evidence/ui/reviews-actual-synthetic-desktop.png` — additional read-only browser capture of pre-existing synthetic database records; it is not customer evidence.
- `.local/evidence/ui/reviews-final-navigation.png` — 1280 × 720 desktop viewport showing the final Guest reviews navigation link and active-page underline. It reads the existing domain test database, which contains 21 synthetic published reviews at this capture after tests; those records are not customer evidence.

The finish reviewer opened the first three captures and found no material visual defect within that scope. The review confirmed the established typography/palette, summary and reading-column hierarchy, separate reply treatment, invitation section, Arabic mirroring and honest fixture labels. It did not independently run tests or render the other eight locales. In a subsequent narrow review, the reviewer opened `reviews-final-navigation.png`, checked the shared desktop/mobile link source and the wrapping rule/test, and retained **ship** for navigation integration. The desktop link is readable, separated from adjacent links and visibly current; mobile navigation and 100-character wrapping are supported by the implementation agent's three-engine test results, not a new full-surface visual verdict.

The development server on port 3003 has been stopped. The root agent is starting full production build and browser verification; those results were pending when this note was written. No success for those checks, hosted staging, production deployment, human translation approval or production customer data is claimed here. Update the release evidence only after those checks actually complete.
