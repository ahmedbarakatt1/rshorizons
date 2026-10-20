# Database and object recovery

Local verification is recorded in [database-restore.json](../evidence/database-restore.json) and [database-clean-rehearsal.txt](../evidence/database-clean-rehearsal.txt). `node scripts/db-rehearse.mjs` creates new uniquely named databases in the isolated loopback cluster, applies every nonempty ordered migration, seeds synthetic records, runs database/concurrency tests, creates a custom-format `pg_dump`, restores it into a second new database, and compares booking, ledger, outbox and table counts. It never drops or resets the main local database.

Run `node --import tsx scripts/db-storage-rehearse.mjs` for a separate local object-storage recovery rehearsal. It exercises the application's actual local private-storage adapter using a synthetic 16 KiB object, copies a backup into a distinct destination, verifies SHA-256 identity, and verifies path traversal denial. Results are recorded in [storage-restore.json](../evidence/storage-restore.json). This proves the local adapter workflow only.

Production database and object storage are separate recovery domains. A database dump does not contain gallery originals, derivative files, or provider state. Before production release, the owner must approve recovery-time and recovery-point objectives, retention, backup encryption and a protected storage location. Hosted Supabase database and storage recovery must be rehearsed in the owner-designated staging project before marking this gate verified.

During a recovery:

1. Disable new intake and pause unsafe payment/media/notification workers while preserving existing records.
2. Record migration versions and the time boundaries of both database and object backups.
3. Restore into a new isolated target, then restore object keys and verify checksums against media metadata.
4. Verify private-bucket denial, guest entitlement checks, RLS and staff revocation before exposing the target.
5. Reconcile provider transactions received after the backup. Replay verified inbox events idempotently; do not assume restoring a database reverses a charge or an external message.
6. Inspect active seat/stay/resource allocations, financial exceptions and pending job leases. Expired leases can be reclaimed; active leases must not be stolen.
7. Route traffic only after documented checks pass and the owner-designated deployment gate is satisfied.

Current production/hosted recovery status: `BLOCKED_EXTERNAL`. No owner-designated Supabase project, production bucket, provider merchant state or approved recovery objectives were available for this local work.
