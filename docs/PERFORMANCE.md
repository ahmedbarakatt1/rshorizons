# Performance evidence — local release candidate

Measured 2026-10-20 against the built Next.js release preview on loopback port 3002. These are cold laboratory samples, not production field measurements, a Lighthouse score, or a throughput guarantee. The first table records the initial release; the owner-requested imagery update is recorded below.

`node scripts/performance-lab.mjs` records Chromium CDP traces and PerformanceObserver measurements. Conditions: Chromium 156.0.8078.4, cache disabled, 4× CPU slowdown, 150 ms network latency, 200,000 bytes/s download and 93,750 bytes/s upload, with 2.5 seconds of observation after page load. Raw traces remain private under `.local/evidence/perf/`. Initial aggregate evidence is in [performance-before-editorial.json](evidence/performance-before-editorial.json); [performance-lab.json](evidence/performance-lab.json) contains the latest run.

| Route | Viewport width | LCP | CLS | Encoded JavaScript | Encoded images |
|---|---:|---:|---:|---:|---:|
| Home `/en` | 1440 px | 2,392 ms | 0 | 155,633 B | 285,912 B |
| Boat request `/en/booking/request?service=boat-tours` | 1440 px | 1,120 ms | 0 | 155,633 B | 0 B |
| Home `/en` | 390 px | 1,320 ms | 0 | 155,633 B | 76,884 B |
| Boat request `/en/booking/request?service=boat-tours` | 390 px | 1,072 ms | 0 | 155,633 B | 0 B |

All samples loaded 522,521 bytes of decoded script. None loaded Three.js or external origins. The observation-window long-task blocking totals were 270, 164, 279 and 155 ms respectively; these diagnostics are not Lighthouse TBT or INP.

## Corrections supported by measurement

The earlier home samples measured 4,256 ms desktop LCP, 3,876 ms mobile LCP and 0.1289 mobile CLS, with 715,014 image bytes. The release now selects 480/960/1440 pixel WebP derivatives through responsive image sizes. The streaming loading state reserves a viewport of space so the footer does not appear and then jump below loaded content. Owner originals remain unchanged.

The photography accent remains disabled after its form-quality failure. Booking routes have no 3D dependency or heavy video SDK. Private guest links do not prefetch. Public scripts, photographs and fonts are served locally.

## Route budgets

[performance-budgets.json](performance-budgets.json) records the initial route budgets. `node scripts/verify-performance-budgets.mjs` compares the recorded lab sample against them and rejects missing/invalid samples. This check does not collect new evidence; run the lab first when code or assets change.

- Each measured route: encoded script ≤190,000 B, decoded script ≤600,000 B, no Three.js, no external origins.
- Home: desktop encoded images ≤350,000 B and mobile ≤100,000 B.
- Booking request: zero image payload in the measured initial form.
- Every sample: CLS ≤0.1. LCP is reported but is not a timing assertion in shared-host CI.

The current single samples meet these budgets. Their narrow scope does not establish budgets for every admin or media delivery screen.

Before launch, repeat on the owner-designated staging domain, including authenticated workflows, slow devices and representative approved assets. Evaluate field p75 LCP ≤2.5 s, INP ≤200 ms and CLS ≤0.1 when sufficient privacy-respecting real traffic exists. See [Google's Core Web Vitals guidance](https://web.dev/articles/vitals) and [Chrome's Performance panel documentation](https://developer.chrome.com/docs/devtools/performance). No field INP was measured locally.

## After the illustrative imagery update

At 19:20 UTC, the same lab harness measured the final generated-image implementation. AVIF sources with WebP fallback keep the existing budgets unchanged.

| Route | Width | LCP | CLS | Encoded JavaScript | Encoded images |
|---|---:|---:|---:|---:|---:|
| Home | 1440 px | 2,416 ms | 0 | 155,935 B | 343,008 B |
| Boat request | 1440 px | 808 ms | 0 | 155,935 B | 0 B |
| Home | 390 px | 1,324 ms | 0 | 155,935 B | 93,793 B |
| Boat request | 390 px | 1,204 ms | 0 | 155,935 B | 0 B |

Decoded JavaScript was 523,531 B per sample. All four budget checks passed; no external origins or Three.js loaded. The initial WebP-only image addition exceeded the homepage budget (472,674 B desktop / 130,094 B mobile), which prompted the AVIF correction. The final comparison is synthetic local evidence, not a field p75 claim.

## After owner photos and video — 2026-10-24

The same four cold Chromium samples (evidence timestamp 2026-10-23T23:20:52Z, Cairo date October 24) passed unchanged budgets. Home LCP was 2,436 ms desktop / 1,288 ms mobile; request LCP was 1,132 / 1,124 ms. CLS remained 0. Encoded JavaScript was 157,127 B (528,622 B decoded); homepage images remained 343,008 B desktop / 93,793 B mobile. No external origin or Three.js loaded. The gallery separately verifies zero MP4 requests before choosing a video, and loads six posters initially. These remain local lab measurements, not production field claims.
