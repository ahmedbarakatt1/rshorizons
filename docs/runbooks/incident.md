# Incident response

The agency must designate incident ownership, escalation contacts and recovery objectives before launch. Monitoring sends aggregate operational metrics to the configured HTTPS receiver; it does not include guest contacts or token values.

For a booking, privacy or financial incident:

1. Preserve the deployment identifier, migration head, timestamps, correlation IDs and immutable provider/audit events. Restrict the incident record to authorized staff.
2. Close new intake if correctness is uncertain. Revoke affected staff/grants and rotate compromised credentials through the provider secret manager. Rotating the guest-token pepper invalidates existing hashes; reissue verified scoped links afterward.
3. Inspect dead/stale jobs, financial exceptions, expired payment holds and missing allocations. Correct the cause before retrying an eligible failed job. A lease or retry must never duplicate a financial effect.
4. Reconcile uncertain payment/refund attempts using stored account/environment/receipt references and authenticated provider inquiry. Preserve late money and all ledger entries.
5. For media exposure, withdraw publication/consent, revoke entitlements/grants and verify the gated endpoint immediately denies access. Follow the designated provider's removal/cache process where required.
6. Restore only to isolated recovery infrastructure first. Verify database and media checksums/coverage independently. Use the approved rollback or forward repair.
7. Record the cause, affected scope, corrective action, recovery evidence and owner-approved communications. Do not send customer/legal notices without the designated owner's instructions.

The bounded worker runs through `/api/internal/worker`; monitoring through `/api/internal/monitor`; retention through `/api/internal/retention`. Each requires the cron bearer secret. Never paste it into issue comments, browser URLs or shared logs.
