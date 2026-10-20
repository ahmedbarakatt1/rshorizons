# Rollback and recovery

Record the previously verified deployment URL/commit and current migration head before every release. Prefer backward-compatible migrations; an application rollback is not a database rollback.

If the new deployment fails, close booking intake through approved environment/settings controls, retain the database and provider inbox, and promote the previously verified compatible deployment. Keep signed webhook ingestion available when safe so paid money is not lost. Stop execution of new provider refunds if their result is uncertain; reconcile known attempts before retrying.

Do not run down migrations, delete ledger rows, reset production, restore a backup over live data or release inventory blindly. A schema incompatibility requires a reviewed forward repair or restore into a separate recovery project. Compare booking, ledger, outbox and storage coverage before switching traffic.

Re-enable intake only after readiness, guest/staff denial tests, quote/approval, payment reconciliation, lease processing and storage checks pass. Record affected references and times privately, with correlation IDs in the incident report. See [backup/restore](backup-restore.md) for independent database and object recovery.
