# Implementation decisions

The handoff is the approved specification and milestone execution plan. The user expressly requested implementation without another approval/planning stop.

## Hosted configuration — 2026-10-25

The owner designated `ahmedbarakatt1s-projects/rshorizons` on Vercel and classified the supplied Supabase project as production. Official CLIs are authenticated; plugin reauthentication is no longer a setup blocker. Configure only these projects. Separate staging remains required. No paid upgrade, server purchase, DNS change or real guest-message test is authorized yet.

Fresh Supabase initialization exposed two release defects: the local harness attempted CREATE against managed Auth, and required reference data existed only in the synthetic seed. The baseline Auth guard was corrected before its first hosted application. Only two known loopback databases had their exact old baseline checksum reconciled to the guard-only checksum; generic drift validation is unchanged. A forward migration now installs reference data without any staff identity, inventory, price, policy approval or message template. Another forward migration relocates btree_gist into extensions without dropping constraints/data.

Hosted PostgreSQL connections now verify the provider CA and hostname. The application accepts the provider certificate through server-only `DATABASE_SSL_CA` and rejects conflicting URL TLS options. The actual restricted Supavisor connection, invalid CA/hostname rejection, SSL enforcement and backend TLS were tested. Existing local loopback tests remain supported.

The administrator was created through Supabase Admin Auth using protected stdin, then granted the same active owner/all-scope/MFA-required authority as the provisioning script through transactional operator SQL. Its password sign-in passed; owner TOTP enrollment remains outstanding. No local credential hash was copied and no default password was committed.

Gmail may be used for account registration/test receipt. It does not replace the existing Resend verified-domain requirement. Oracle Always Free was selected but its card verification blocks the owner. The owner requires OpenWA hosting to be cloud-only, completely free and without a payment card; an always-on personal computer is unavailable. No compatible replacement host has been verified or designated. Preserve the pinned integration and record this external blocker; do not reduce the automatic-message requirement or buy hosting. See `docs/runbooks/free-openwa-hosting.md`. Keep production booking/publication gates closed while account, plan, provider, content and UAT dependencies remain.

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

## Administrator and automatic guest messages — 2026-10-24

The owner designated the privately recorded administrator email with administrator authority and supplied a password for provisioning. A reusable local preview identity is now supported behind strict local development/test gates, stored only as a randomly salted scrypt hash. It reuses the existing hashed staff sessions and live role/scope checks. Hosted access continues through Supabase Auth plus MFA; a protected provisioning command binds the explicitly designated project and database before creating the initial owner. No account/password is seeded by migrations, committed to source, or copied between environments.

The request for automatic messages applies after successful booking submission. Phone/email field entry alone sends nothing. Existing WhatsApp consent, preferred-channel/email-fallback behavior, immutable approved templates, durable event/jobs, unknown-outcome reconciliation and manual booking approval remain authoritative. The local preview runs the real worker on a minute schedule with external providers disabled and synthetic email previews only. Actual OpenWA and email delivery remain E06/E07 launch gates.

## Reviews, OpenWA and Vercel — 2026-10-24

The owner's latest request specifies a reviews page, `rmyndharis/OpenWA` for WhatsApp and owner-performed Vercel deployment. OpenWA explicitly supersedes the handoff's older Meta-only/unofficial-client prohibition; all consent, marketing classification, durable delivery, fallback and secret requirements remain. The retained Meta adapter is optional and its historical receipts are preserved. OpenWA is a separately hosted persistent gateway, not a Vercel Function. Its documented unofficial-client/account-restriction risk was communicated; no number has been linked or messaged.

The public review page uses the existing verified fulfilled-item invitations, immutable originals and staff moderation. Rating aggregates use only published reviews; negative reviews are included; no testimonial content is invented. New browsing/filtering/privacy UI does not loosen eligibility.

Vercel media uploads now use single-object private storage upload capabilities with overwrite disabled. Finalization still checks actual bytes/checksum/current authority. Downloads stream through current entitlement/consent checks; storage read capabilities remain server-only. Hosted CORS, large transfer and provider tests remain external gates.

## Final local release decisions

- Resend email and Mux signed private video are implemented provider adapters. Selection of an adapter does not designate or authorize an external account or billing plan.
- Keep the 3D accent disabled after its failed form-fidelity gate. The static original illustration remains available; handoff M5 permits a reported failed gate and fallback.
- The measured scroll/entrance opacity effects reduced text contrast. Removed those text fades and kept the single image entrance. Taste's preference for more motion remains an explicitly unresolved aesthetic finding; accessibility takes precedence over increasing a detector score.
- Public marketing photography uses preserved owner originals through responsive, metadata-stripped local derivatives. Local authorization does not fabricate production subject/guardian consent.
- Final browser verification uses a fresh synthetic database separate from repeated domain tests. The test database and evidence remain available; neither was reset.
- No provider send, payment charge, domain operation, external project creation or production deployment has been performed.

## Owner-requested imagery refinement

On 2026-10-20 the owner requested generated or web images for parts without photographs. Six built-in image generations replace the scenery/apartment placeholders with responsive local AVIF/WebP assets. Actual previous-trip media remains untouched. Visible localized illustration labels distinguish generated apartment/vehicle/scenery concepts from the agency's real inventory. Prompts, hashes and asset paths are recorded in `docs/design/editorial-imagery.md`.

## Owner media and repository — 2026-10-24

The owner designated `https://github.com/ahmedbarakatt1/rshorizons` and supplied WhatsApp event/transfer-car photos, expressly requesting use of the original videos. This resolves repository selection and authorizes local asset preparation/use. All 30 videos are included on demand; source footage, private inspection evidence and metadata-stripped local derivatives remain outside Git/deployment. Eight selected WhatsApp photographs add actual boats, evening outings and transportation. No vehicle capacity or event details are inferred from photographs. Production subject/guardian consent remains E10. See `docs/design/owner-media.md`.
