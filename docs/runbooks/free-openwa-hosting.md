# Earlier OpenWA cloud-hosting assessment — 2026-10-25

This records the earlier request for cloud hosting at zero monthly cost without a payment card, after Oracle signup failed. The owner's subsequent **host locally** instruction supersedes the cloud-only restriction. The designated Windows gateway is now running; follow [local setup](local-openwa.md) for current status. The research below is retained as history, not a direction to restart the cloud search or reject local hosting. No purchase is authorized.

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

## Result of the earlier search

At the end of this cloud search, no host had been created, phone paired, credential shared or message sent. The pinned adapter, signed callbacks, idempotency rules, email fallback and Compose configuration were preserved. Subsequent native local build/runtime/authorization/persistence checks are recorded in [local setup](local-openwa.md); pairing and real delivery remain pending.

If the owner later returns to cloud hosting, verify current account eligibility, continuous execution, persistent disk, resource capacity, HTTPS, backup/restore and the actual gateway send/callback journey before choosing a provider. The current continuation is owner pairing of the local gateway, then paired recovery and authenticated HTTPS for Vercel. Email configuration can proceed independently when its sender domain/account and other release inputs arrive.

The separate Vercel cron/commercial, Supabase64MiB storage and business/provider/UAT launch gates are unchanged. A WhatsApp host alone does not resolve them.
