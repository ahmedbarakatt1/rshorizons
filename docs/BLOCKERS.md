# External launch dependencies

E01 is now owner-designated and access-verified. Remaining rows are `BLOCKED_EXTERNAL` until their evidence is supplied and verified; these do not block independent implementation.

| ID | Owner | Required single next action | Impact / exact destination |
|---|---|---|---|
| E01 | Agency owner / implementation | Owner designated `ahmedbarakatt1/rshorizons` on 2026-10-24; repository identity, push access and enabled Actions verified; `origin` configured | Source published to `main`; First CI domain/build gates passed; corrected browser harness verification pending; deployment secrets/protected release environment depend on hosting inputs |
| E02 | Agency owner | Designate an approved commercial Vercel account/project and billing plan | Production hosting, project IDs, deployment token; no purchase is authorized |
| E03 | Agency owner | Designate the domain and DNS account | `APP_BASE_URL`, canonical domain, HTTPS and DNS verification |
| E04 | Agency owner | Supply separate staging/production Supabase project access via secret storage | Runtime/migration DB roles, Auth, storage, redirect allowlists, backup rehearsal |
| E05 | Merchant owner | Supply Paymob sandbox/live account configuration and enabled methods | Paymob environment variables, real sandbox evidence, callback verification and live-test authorization |
| E06 | Messaging owner | Supply Meta number/app credentials, approved locale templates and allowlisted test recipients | WhatsApp adapter and signature/callback tests; opt-in enforcement remains mandatory |
| E07 | Agency owner | Designate the Resend account and verify the sender domain | Implemented Resend adapter; account credentials, SPF/DKIM/DMARC and real delivery/callback evidence are still required |
| E08 | Agency operator | Approve catalog, prices, deposits, fees, capacity, schedules and apartment inventory | Published catalog/payment policy versions; demo prices cannot launch |
| E09 | Agency/legal owner | Approve legal identity, contact/social URLs, terms/privacy/cancellation/safety content | Agency settings and approved policy versions; brand name alone is not legal identity approval |
| E10 | Content owner | Confirm media rights and subject/guardian publication consent | Explicit consent records and approved public derivatives; supplied originals are not automatically public |
| E11 | Language reviewers | Approve all ten public/booking-critical translations | Translation approval records; local translation coverage is not human approval |
| E12 | Agency owner | Designate staff invitation addresses, scopes and initial MFA owner | Invite-only Auth bootstrap; no default credentials |
| E13 | Operations owner | Designate the Mux account/environment and monitoring destination | Implemented signed private Mux playback/retention; actual account/billing approval, processing verification, alerts and cron ownership remain required |
| E14 | Agency owner | Approve UAT, recovery/retention objectives and designated live-test transaction amount/contacts | M6 release gate and M7 authorized production journey |

Working brand was resolved: owner confirmed **Red Sea Horizons** on 2026-10-20. Production deployment has not been attempted because E02–E14 remain unverified. E01 repository selection/access is resolved; see the release addendum for publication and CI results.
