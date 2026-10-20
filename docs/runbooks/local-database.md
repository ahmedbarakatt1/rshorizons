# Isolated local PostgreSQL

Run `npm run db:start`, `npm run db:migrate`, `npm run db:seed`, then `npm run db:drift`.

The bootstrap owns only `D:\Tourism\.local\postgres\data`, database `tourism` on loopback port 55432 (or a free nearby port on first creation). It generates separate migration and runtime credentials into ignored `.env.local`. It does not inspect, modify, stop, or replace other PostgreSQL services.

This workstation's existing PostgreSQL 17.2 binaries were used only to initialize the isolated cluster. The cluster now runs PostgreSQL 17.11 from `.tooling/postgresql-17.11/pgsql/bin`. The archive came from the [PostgreSQL Windows download page](https://www.postgresql.org/download/windows/) → [EDB binary archives](https://www.enterprisedb.com/download-postgresql-binaries). Archive SHA-256: `80379b2c04d51c30225532e0ae04509899141e9957ed096fe749d7fd9df8f82f`. The ZIP executables are not Authenticode-signed; this records provenance and a local integrity hash, not a publisher signature. The host's old installation remains untouched.

For another Windows workstation, install a supported patched PostgreSQL binary distribution and set `POSTGRES_BIN` to its `bin` directory. On Linux CI the workflow starts PostgreSQL 17.11 in an isolated container with random credentials and uses the same migrations/seed/tests. CI has not been executed on a remote runner yet.

Only SQL migrations change the schema. `db-migrate.mjs` checks prior checksums and applies each new migration transactionally. Do not run development fragment refresh/assembly scripts against staging or production. Do not edit an applied migration. Create the next file using the inspected Supabase CLI: `npx --yes supabase@2.121.0 migration new descriptive_name`.

The seed is explicitly synthetic and refuses production. It contains four destinations, nine service categories, 21 initial departures, three physical apartment units, roles/permissions and test pricing policies. It creates no staff passwords or fake reviews. Seed translations are development fixtures requiring agency review before release.

Database checks: `npm run test:db`, `npm run test:concurrency`. The race harness holds the contested row on a third connection until both independent transactions are waiting for PostgreSQL locks. Test records are synthetic and isolated by UUID. The last-owner test uses a rollback-only transaction.

No reset or drop command is part of routine setup. Rehearsal databases remain available for inspection. To stop the isolated cluster, run its selected `pg_ctl -D D:\Tourism\.local\postgres\data -m fast -w stop`. Confirm that exact resolved path before any cleanup; never point it at another installation's data directory.
