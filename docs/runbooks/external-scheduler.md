# External scheduler for Vercel functions

The owner requested a completely free setup and then asked to keep the worker compatible with Vercel. `vercel.json` no longer registers Vercel Cron jobs. Supabase Cron can call the existing protected HTTP endpoints; the worker still performs durable jobs, reminders, hold expiry and auth cleanup. This resolves the cron-frequency configuration issue, **not Vercel Hobby's commercial-use restriction**. No paid plan is authorized. Production remains blocked until hosting eligibility and the existing release gates are resolved.

## Prepared configuration

| Job suffix | Method and path | UTC schedule |
|---|---|---|
| worker | GET `/api/internal/worker` | Every minute |
| monitor | GET `/api/internal/monitor` | Every five minutes |
| retention | GET `/api/internal/retention` | Daily at 02:30 |

The current endpoints require `Authorization: Bearer <CRON_SECRET>` with a matching secret of at least 32 characters. No Vercel-specific user agent is required. Do not move the token into the URL, publish response bodies, or remove authentication. Existing job leases, idempotency, retention approvals and production validation remain authoritative.

Generate an operator script for the exact designated environment, for example:

```powershell
npx --no-install tsx scripts/prepare-supabase-scheduler.ts production https://rshorizons.vercel.app
```

This writes ignored `.local/supabase-scheduler-production.sql`. It performs no remote operations and includes no secret values. Use a separate designated staging project/origin and `staging` argument for staging. Never point staging jobs at the production database or hostname.

## Installation and activation

1. Verify the target Supabase project and its current free-plan limits. Production is `asdlmlizktankblwqocp`. The read-only check on 2026-10-26 found pg_cron 1.6.4 and pg_net 0.20.4 available but not installed; Vault 0.3.1 is installed. No extension, secret or schedule was changed by that check.
2. Enable `pg_cron` and `pg_net` through that project's dashboard. Keep Vault and the `net`/`cron` schemas outside exposed APIs. The generated script intentionally does not install extensions or alter shared grants.
3. In Vault, store the exact environment's Vercel `CRON_SECRET` as `rsh_production_cron_secret` (or `rsh_staging_cron_secret`). Use the secret UI; never paste the value into repository files or job SQL. This is the application's cron credential, not a Supabase service-role key.
4. Review privileges before installation. `pg_net` temporarily places plaintext authorization headers in `net.http_request_queue`. `anon`, `authenticated` and `tourism_app` must not have SELECT on that queue or `vault.decrypted_secrets`. The installer refuses if they do. A database administrator must inspect inherited/PUBLIC grants and remove only the unwanted access without breaking the extension's own executor. Do not grant the web runtime access to Vault or scheduler administration.
5. Run the generated SQL as the project's administrator. It transactionally creates or updates only `rsh-production-worker`, `rsh-production-monitor`, `rsh-production-retention` (or the staging names). **All are paused.** Reapplying pauses them again. The request timeout is 300 seconds, matching the worker/retention route limit. Do not run this script in application migrations or the web build.
6. After a real deployment passes release/readiness checks, verify its exact canonical origin responds directly without redirects or deployment-protection interception. Perform controlled staging invocations and check outcomes. Only then activate those three exact jobs via the Cron dashboard. Configure independent alerts for scheduler failures; a stopped scheduler cannot run its own monitor.
7. Observe at least two worker runs, a monitor run, and a controlled retention dry-run. `cron.job_run_details` success proves SQL queued the HTTP request, **not** that the worker succeeded. Correlate returned request IDs with `net._http_response` status/error and the application's redacted `worker_batch` log. Inspect only IDs, times, HTTP status and errors; avoid response bodies/authorization headers. Confirm unauthorized requests return 401 and do no work.

If the provider project is paused, quota-limited or unavailable, scheduled work stops. A free allocation is not an uptime guarantee. Vercel function invocations still consume its normal usage allowance. Do not reduce the required cadence to daily or rely on page visits to process bookings.

## Rotation, rollback and duplicates

Pause the three exact environment jobs before credential rotation or an unsafe deployment. Rotate Vercel and the matching Vault secret together; verify one controlled call, then resume. Do not activate a second scheduler simultaneously. If reverting to native Vercel cron later, pause/remove these specific jobs first. App rollback does not cancel queued HTTP calls or reverse external effects; existing job leases and idempotency still protect overlapping batches.

Sources: [Supabase Cron](https://supabase.com/docs/guides/cron), [Cron quickstart](https://supabase.com/docs/guides/cron/quickstart), [scheduled HTTP calls and Vault security](https://supabase.com/docs/guides/functions/schedule-functions), [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing), [Hobby use restrictions](https://vercel.com/docs/plans/hobby).
