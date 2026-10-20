# Design reference provenance and adaptation

Retrieved 2026-10-20 using the inspected, locally pinned `getdesign@0.6.26` CLI. The package contains the references; retrieval did not require paid/private access. Telemetry was disabled. Explicit separate `--out` paths prevented overwriting the root project `DESIGN.md`.

| Reference | Source | Local file | SHA-256 |
|---|---|---|---|
| Airbnb | [getdesign Airbnb analysis](https://getdesign.md/airbnb/design-md) | `airbnb/DESIGN.md` | `add34130d67209ad105346d60fe2b290728b9711683969db4b7760e29477a5fe` |
| Apple | [getdesign Apple analysis](https://getdesign.md/apple/design-md) | `apple/DESIGN.md` | `83fbc614443a9b3d7569e9956a43e7b8740f9d0f939f58b8154f7a7cec3002b2` |

Package source: [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md); package registry provenance and integrity are saved in `../../tools/evidence/registry-getdesign.json`. Registry `gitHead` is `870e8f286519f850edf5be1e0e37024878f8f6fd`; that commit's raw root license URL returned 404. The public repository's current MIT license was therefore checked and retained as [LICENSE.getdesign](LICENSE.getdesign), with observed repository HEAD `3b605329240ce735b510037cca322f1831fdd7f8`. The npm manifest also declares MIT. These analyses do not grant trademark, photography or proprietary font rights.

## Original project adaptation

The approved handoff and supplied project brand assets outrank these references.

- **Airbnb input:** group destination/date/guest choices clearly, keep photography close to practical trip information, place price basis and request controls together, and make apartment details easy to scan. Adapt this to manual approval with “Request reservation” and explicit pending status. Never import instant-confirmation language, marketplace host onboarding, fabricated review scores or brand badges.
- **Apple input:** use generous spacing around the principal image, clear headline/body hierarchy, few competing action colors and restrained transitions. Let underwater imagery carry atmosphere. Keep travel safety/policy/pricing text legible and visible; marketing restraint is not permission to hide required disclosures.
- **Original expression:** use the project's sea/sand direction and agency-specific approved material. Derive layout, tokens, button behavior and public/admin differences in the root `DESIGN.md`. Admin screens use dense aligned operational tables and explicit states, rather than copying a consumer marketplace page.
- **Typography:** do not redistribute Airbnb Cereal/Circular or Apple SF font binaries. Use the chosen licensed/open/system project fonts and test Arabic plus long translations.
- **Components:** patterns inform structure only. Do not copy competitor logos, wording, complete pages, photography, recognizable branded search chrome or proprietary icons. Apply the project's accessibility and touch-target requirements even where reference microtext is smaller.
- **Motion:** preserve readable static content, reduced motion and booking speed. A 3D accent is isolated to photography and must pass its own performance gate.

These are reference-analysis observations and proposed transfer rules, not a claim that a competitor's present production site was audited or that every proposed treatment is already implemented here.
