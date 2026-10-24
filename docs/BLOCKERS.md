# External launch dependencies

E01 is resolved: the designated repository contains the source and its CI is passing. Remaining rows are `BLOCKED_EXTERNAL` until their evidence is supplied and verified; these do not block independent implementation.

| ID | Owner | Required single next action | Impact / exact destination |
|---|---|---|---|
| E01 | Resolved | Owner-designated `ahmedbarakatt1/rshorizons`; source published to `main`; [latest CI passed](https://github.com/ahmedbarakatt1/rshorizons/actions/runs/40052027620) for reviews/OpenWA/Vercel implementation | Production deployment secrets/environment configuration remain dependent on E02–E14 |
| E02 | Agency owner | Vercel selected; owner will deploy. Configure the designated commercial account/project and plan using `docs/runbooks/vercel-owner-setup.md` | Provider and self-deployment choice resolved; exact project, plan, environment secrets and actual deployment URL remain unverified; no purchase is authorized |
| E03 | Agency owner | Designate the domain and DNS account | `APP_BASE_URL`, canonical domain, HTTPS and DNS verification |
| E04 | Agency owner | Supply separate staging/production Supabase project access via secret storage | Runtime/migration DB roles, Auth, storage, redirect allowlists, backup rehearsal |
| E05 | Merchant owner | Supply Paymob sandbox/live account configuration and enabled methods | Paymob environment variables, real sandbox evidence, callback verification and live-test authorization |
| E06 | Messaging owner | OpenWA selected. Designate its persistent host/HTTPS origin, dedicated number, paired session, session-scoped API key, webhook secret, approved locale text and test recipients | `docs/runbooks/openwa.md`; website is on Vercel, gateway is separate. Actual gateway pairing/send/callback evidence remains absent. Meta credentials are not required for OpenWA; consent and email fallback remain mandatory |
| E07 | Agency owner | Designate the Resend account and verify the sender domain | Implemented Resend adapter; account credentials, SPF/DKIM/DMARC and real delivery/callback evidence are still required |
| E08 | Agency operator | Approve catalog, prices, deposits, fees, capacity, schedules and apartment inventory | Published catalog/payment policy versions; demo prices cannot launch |
| E09 | Agency/legal owner | Approve legal identity, contact/social URLs, terms/privacy/cancellation/safety content | Agency settings and approved policy versions; brand name alone is not legal identity approval |
| E10 | Content owner | Confirm media rights and subject/guardian publication consent | Explicit consent records and approved public derivatives; supplied originals are not automatically public |
| E11 | Language reviewers | Approve all ten public/booking-critical translations | Translation approval records; local translation coverage is not human approval |
| E12 | Agency owner | Initial administrator designated as the privately recorded administrator email, all-scope owner role; local account provisioned and browser verified. Designate the hosted Supabase project and complete its password/MFA setup | `docs/runbooks/staff.md`; local credentials never become production defaults. Other staff addresses/scopes and hosted MFA verification remain outstanding |
| E13 | Operations owner | Designate the Mux account/environment and monitoring destination | Implemented signed private Mux playback/retention; actual account/billing approval, processing verification, alerts and cron ownership remain required |
| E14 | Agency owner | Approve UAT, recovery/retention objectives and designated live-test transaction amount/contacts | M6 release gate and M7 authorized production journey |

Working brand was resolved: owner confirmed **Red Sea Horizons** on 2026-10-20. Production deployment has not been attempted because E02–E14 remain unverified. E01 repository selection/access is resolved; see the release addendum for publication and CI results.
