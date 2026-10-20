# Implementation decisions

The handoff is the approved specification and milestone execution plan. The user expressly requested implementation without another approval/planning stop.

| ID | Decision | Reason / consequence |
|---|---|---|
| D01 | Initialize this workspace, npm only, exact pinned versions, SQL migrations authoritative | No existing application or repository to preserve beyond supplied files |
| D02 | Working brand: Red Sea Horizons | Owner confirmed in chat on 2026-10-20; legal identity/domain/content still require approval |
| D03 | Single Next.js App Router application; modular server services; `pg` transactions | Matches approved architecture; no REST-based multi-call inventory transactions |
| D04 | Isolated local PostgreSQL instance on loopback, own data folder and credentials | Proves real exclusion/locking behavior without touching unrelated databases |
| D05 | Draft/demo inventory stays visibly synthetic; production gate prohibits demo/intake without approvals | Local fixtures enable complete independent work without invented business claims |
| D06 | Public design uses supplied navy/turquoise/sand visual direction; originals remain outside public files | Brand board is a design reference; media publication consent is separately required |
| D07 | Resource installers isolated under `.tooling`; application dependencies remain in root lockfile | Prevents design-tool installer dependencies from entering runtime/deployment bundles |
| D08 | Narrow parallel ownership of database, tools and UI; root integrates and reviews | Reduces latency without concurrent edits of shared application rules |
| D09 | Provider events and webhook inbox may share one append-only authority | Avoid duplicate event pipelines; record final choice in ERD and contracts |
| D10 | Use the owner's media folder for actual previous-trip gallery imagery | Owner expressly authorized this on 2026-10-20. Preserve originals and source hashes; publish optimized derivatives with factual captions. Record required subject consents without inventing them. |

## Interface ledger

- M0 environment validation is called by production verification and server dependency initialization. Production failures must be explicit, not replaced by local defaults.
- M1 database transactions are shared by M3 approval, M4 payment/expiry and M5 entitlement checks. These must serialize on the same booking/inventory locks.
- M2 public catalog exposes only published/approved content; local demo is a visible, server-controlled exception, never a production fallback.
- M3 quote snapshots bind booking totals/policies; M4 consumes persisted obligations rather than request amounts.
- M4 domain events and M5 delivery use durable jobs; external provider calls occur after transaction commit.
- Guest tokens are hashed and redeemed by POST into scoped cookies; GET/prefetch never consumes them.

No confirmed business requirement is removed by these implementation choices.

## Final local release decisions

- Resend email and Mux signed private video are implemented provider adapters. Selection of an adapter does not designate or authorize an external account or billing plan.
- Keep the 3D accent disabled after its failed form-fidelity gate. The static original illustration remains available; handoff M5 permits a reported failed gate and fallback.
- The measured scroll/entrance opacity effects reduced text contrast. Removed those text fades and kept the single image entrance. Taste's preference for more motion remains an explicitly unresolved aesthetic finding; accessibility takes precedence over increasing a detector score.
- Public marketing photography uses preserved owner originals through responsive, metadata-stripped local derivatives. Local authorization does not fabricate production subject/guardian consent.
- Final browser verification uses a fresh synthetic database separate from repeated domain tests. The test database and evidence remain available; neither was reset.
- No provider send, payment charge, domain operation, external project creation or production deployment has been performed.

## Owner-requested imagery refinement

On 2026-10-20 the owner requested generated or web images for parts without photographs. Six built-in image generations replace the scenery/apartment placeholders with responsive local AVIF/WebP assets. Actual previous-trip media remains untouched. Visible localized illustration labels distinguish generated apartment/vehicle/scenery concepts from the agency's real inventory. Prompts, hashes and asset paths are recorded in `docs/design/editorial-imagery.md`.
