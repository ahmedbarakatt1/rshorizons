# OpenWA hosting constraints — 2026-10-25

The owner cannot complete Oracle's payment-card verification, cannot provide an always-on computer, and requires **cloud hosting at zero monthly cost without a payment card**. This constraint applies to the OpenWA host. Do not ask the owner to repeat Oracle signup, recommend their computer again, or purchase a server. No replacement provider is designated.

## Current research

| Provider | Evidence | Suitability for this gateway |
|---|---|---|
| Oracle Always Free | [Official FAQ](https://www.oracle.com/cloud/free/faq/) requires an accepted credit/debit card for verification | Blocked by the owner's available payment method; this is not a claim that all Egyptian users are ineligible |
| Northflank Sandbox | [Official billing guide](https://northflank.com/docs/v1/application/billing/pricing-on-northflank) requires a payment method for all plans and excludes the free tier from its production recommendation | Does not solve the card requirement |
| Koyeb Free | [Pricing FAQ](https://www.koyeb.com/docs/faqs/pricing) requires a card; [instance guide](https://www.koyeb.com/docs/reference/instances) excludes persistent volumes and scales free instances down after an idle hour | Does not fit the card, persistence or continuous-session needs |
| Render Free | [Official free-plan guide](https://render.com/docs/free) documents 15-minute idle sleep, ephemeral files and no persistent disk | Cannot preserve this pinned gateway's SQLite/session volume through restarts; no production claim |
| Zeabur Free | [Official free-plan guide](https://zeabur.com/docs/en-US/pricing/free-plan) allows signup without a card but auto-sleeps idle services and recommends a paid plan for continuous execution | Does not provide the required continuously connected session |
| Railway Free | [Official plans](https://docs.railway.com/pricing/plans) provides a small usage allowance | No evidence that the gateway, persistent storage and traffic fit indefinitely; do not present a trial/credit allowance as verified free production hosting |
| ClawCloud Run | [Provider discontinuation notice](https://question.run.claw.cloud/questions/10010000000003261) suspended signup on April23 and free services on May11; direct website/DNS checks also failed | Unavailable. Older indexed pages advertising monthly GitHub credits are stale and must not be used as a recommendation |

No currently available host satisfying all three owner constraints and this gateway's needs has been verified. This is a bounded research result, not proof that no such service can ever exist. Do not weaken persistent storage, restart recovery, authenticated HTTPS or delivery verification just to obtain a free deployment. Do not use trial-account cycling or synthetic keep-alive traffic to evade provider limits.

## Preserved implementation and exact continuation

The pinned OpenWA adapter, signed callbacks, idempotency rules, email fallback and Compose configuration remain intact. No host was created, phone paired, credential shared or message sent. Local protocol tests and earlier CI results remain valid; actual gateway operation remains unverified.

Next executable hosting step requires a genuinely eligible no-card free provider or an owner-designated sponsored server. Verify its current account eligibility, continuous execution, persistent disk, resource capacity, HTTPS, backup/restore and actual gateway send/callback journey before choosing it. If no qualifying host becomes available, production WhatsApp automation remains blocked; any reduced launch scope requires the owner's explicit decision. The existing email integration can be configured independently once its sender domain/account and other release inputs arrive.

The separate Vercel cron/commercial, Supabase64MiB storage and business/provider/UAT launch gates are unchanged. A WhatsApp host alone does not resolve them.
