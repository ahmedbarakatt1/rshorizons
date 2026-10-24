# Requested resource usage

Administrator follow-up, 2026-10-24: applied Supabase skill (current changelog, official Admin Auth docs and Context7), test-driven-development and systematic-debugging skills, browser workflow guidance and verification-before-completion. Used the requesting-code-review skill for an independent focused security review. The reviewer reproduced a local-session boundary gap; root added a failing regression, unified the local eligibility gate for sign-in and session consumption, and the reviewer confirmed rejection before any local session lookup. Browser evidence exercises actual password login, database-backed price changes and uploads; the owner's credentials never enter committed test fixtures. Hosted account creation and real message delivery remain explicitly unverified.

Updated 2026-10-20. This starts with verified acquisition and explicit application gates. A help command or installation is not proof that a resource improved the product.

| Resource | Actual work so far | Deliverable influenced / evidence | Remaining application gate |
|---|---|---|---|
| Playwright Agent CLI `0.1.22` | Read installed skill; opened Edge headless session `tourism-ui`; navigated `/en`, `/en/experiences`, `/ar/contact`, `/en/gallery`; resized 1440×1000 and 390×844; captured snapshots, screenshots, console and request logs. | Private evidence `.local/evidence/ui/public-desktop.png`, `public-mobile.png`, `arabic-contact-mobile.png`, `previous-trips-mobile.png`; snapshots and console in ignored `.playwright-cli/`. Latest gallery console: 0 errors, 0 warnings; APIs returned 200. | Separate Playwright Test behavior results are recorded in UX_VERIFICATION.md. Final release-build capture belongs to the root release run. |
| Taste `design-taste-frontend` | Read SKILL and app-screen reference; actual draws selected public `uneven-photographs`, seed 1321413145, and admin `framed-sheet`, seed 1295856842. Ran source lint and real Chrome inspector at 1440, 768, 390. | Original [DESIGN.md](../DESIGN.md); unequal real photographs, pale staff frame, semantic tables. Browser findings led to 16px body, 13px minimum captions, removed decorative destination numbers/dividers, two-line tablet headline, additional owner-trip photos and restrained motion. | Latest completed source lint: 0 fail/3 warnings (form/frame borders and legitimate timestamp padding). Inspector reports retained privately; final measured result recorded in UX_VERIFICATION.md. No false clean-gate claim. |
| Impeccable `4.7.0` | Ran `impeccable.cmd context` once; applied context/new-work/craft-floor references; created original PRODUCT.md and DESIGN.md from approved handoff. Ran `impeccable.cmd detect src/app src/components`. | Detector scanned 22 files with regex matching, reported no source findings and explicitly warned that runtime contrast/tiny-text checks were not executed. Actual screenshot review addressed typography, Arabic layout, quiet staff rows, form labels and error states. | Regex detection is not a complete accessibility audit; browser keyboard/RTL/width tests and manual image review supply separate evidence. |
| img2threejs base `2.0.0` | Read full router, intake, gate/self-correction and material contracts; generated an original conceptual reference with imagegen; recorded admission, assessment, detail inventory and five reference-material crops; authored subject-specific spec; generated locked passes; captured actual browser views using Playwright Agent CLI and reproducible Playwright capture; ran silhouette, interior, turntable, full-mesh self-intersection and attachment checks. | `docs/design/three/` holds spec/state, original-reference provenance, comparison sheets and diagnostics. Corrected framing, controls, bevels and fastener hierarchy from visual failures. Structural pass IoU 0.8797; four-angle gate passes; 11,190/11,190 vertices measured with zero inside/undecided. Poster and lazy photography-only island include motion/data/WebGL fallbacks and pause/disposal. | Current form Tier 1 failed (IoU 0.7386, framing/aspect deltas above limits); later material/surface/lighting/runtime gates remain incomplete. Texture seams are a recorded defect. Accent stays disabled with a resumable checkpoint. No claim that installed tools or a passing silhouette prove final fidelity. See three/STATUS.md. |
| getdesign `0.6.26` | Inspected the acquired Airbnb/Apple reference analyses and adaptation notes before direction. The project uses their discovery and clear-price principles, not their proprietary assets or layouts. | [DESIGN.md](../DESIGN.md), Catalog.tsx filters and clear quote totals, PublicShell.tsx navigation, original palette and photography hierarchy. Root acquired the reference files; interface worker inspected and adapted them. | Source provenance retained in design/references/README.md. No claim of reproducing either brand. |

## Ready-to-run local tools

From the repository root on Windows:

```powershell
# CLI entry point (read installed help for a command before new flags).
node .tooling/node_modules/@playwright/cli/playwright-cli.js --help
node .tooling/node_modules/@playwright/cli/playwright-cli.js -s=tourism open http://localhost:3000/en
node .tooling/node_modules/@playwright/cli/playwright-cli.js -s=tourism snapshot
node .tooling/node_modules/@playwright/cli/playwright-cli.js -s=tourism screenshot --filename=.local/evidence/ui/home-en.png
node .tooling/node_modules/@playwright/cli/playwright-cli.js -s=tourism console
node .tooling/node_modules/@playwright/cli/playwright-cli.js -s=tourism requests
node .tooling/node_modules/@playwright/cli/playwright-cli.js -s=tourism close

# Taste: use one coherent project direction and keep approved brand palette/type.
node .agents/skills/design-taste-frontend/scripts/draw.mjs --list sectors
node .agents/skills/design-taste-frontend/scripts/lint.mjs src
node .agents/skills/design-taste-frontend/scripts/inspect.mjs http://localhost:3000/en

# Impeccable: context once per session; playbooks are agent instructions, not shell verbs.
.agents/skills/impeccable/scripts/impeccable.cmd context
node .tooling/node_modules/impeccable/cli/bin/cli.js detect --json src/

# img2threejs: read SKILL.md and follow exact next command at each stage.
python .agents/skills/img2threejs/forge/next.py --help
```

The application commands above are reproducible next steps, **not** execution evidence. Append executed results below rather than marking the table complete from these examples. Playwright Test remains the separate committed regression suite.

## Application evidence

UI execution was performed on 2026-10-20. Commands and actual behavior results are retained in [UX verification](UX_VERIFICATION.md) and [direction evidence](design/evidence/direction.md). Private evidence stays outside Git. Failure history includes the missing i18n module RED test, a Three.js route import exposed by the browser bundle check, invalid text encoding from one shell edit, incorrect test labels, concurrent Playwright artifact collisions, and a token capture issue in development StrictMode. Each is distinguished from a passing final check.

## Release application results

Root completed release-build navigation and inspection with Playwright Agent CLI session `tourism-release`, including gallery snapshot and console output (0 errors and 0 warnings). Separate Playwright Test release runs recorded 25 passing browser tests and 7 passing focused accessibility checks; engine-specific duplicate exclusions are explained in [RELEASE_REPORT.md](RELEASE_REPORT.md).

Taste's final rendered inspection retained 2 failures and 5 warnings. Increasing motion to satisfy its count would reintroduce a measured accessibility problem; the single image entrance remains, while the functional stay CTA was manually checked as a heuristic misclassification. Palette/form/type/video/heading warnings are preserved in the private report. This is actual tool use with explicit unresolved findings, not an all-pass claim.

Impeccable's contrast/readability guidance informed the removal of opacity/color fades after real axe failures. Completed desktop, mobile gallery and Arabic screenshots were inspected after loaded-content assertions. The web-perf skill additionally informed actual Chromium CDP traces, responsive WebP sizing and loading-layout stability. No Chrome DevTools MCP trace or Lighthouse score is claimed; [PERFORMANCE.md](PERFORMANCE.md) describes the measured alternative.

All five requested resources were acquired and applied. The img2threejs form failure and later incomplete gates remain recorded with a disabled feature flag and static fallback. External account, content, human translation and media publication approvals remain independent launch requirements.

## Owner media extension — 2026-10-24

The existing Taste direction and Impeccable readability guidance were retained while integrating actual boats, evening outings, car views and all 30 videos. Playwright Agent CLI session `owner-media` inspected the 1440×1000 gallery, saved gallery/vehicle/evening screenshots, and reported zero console errors or warnings. The session was closed after inspection. Playwright Test verified playback/seek/load-on-demand in all three engines and the full local/remote suite. CI results and retained harness findings are in the release report.

## Reviews, messaging and host readiness — 2026-10-24

Applied the supplied Impeccable, Playwright CLI, test-first/debugging, parallel execution, code-review and verification skills. Impeccable detected no mechanical findings in the reviews UI. The Taste inspector failed to launch Chrome; this is not claimed as a passing inspection. Manual screenshots and Playwright evidence establish the rendered result. Root CLI session `reviews-release` inspected the actual production-build empty reviews page at1440×1000 and recorded zero console errors/warnings, then closed. Full production-artifact browser verification passed47 cases with16 established engine-specific skips.

Context7 and primary upstream source informed Vercel/Supabase transport and the exact OpenWA API. OpenWA commit173916c83b41e622f849ecd380bf36486dfd8cdf was read from the designated repository. Its Compose file passed `docker compose config --quiet` with a synthetic validation-only environment value; no gateway was deployed. A real loopback HTTP fixture plus PostgreSQL tests verify the adapter without contacting WhatsApp. Review found and fixed initial-4xx ambiguity and mutable approved-template content. See release evidence for the193-test result and external verification limits.
