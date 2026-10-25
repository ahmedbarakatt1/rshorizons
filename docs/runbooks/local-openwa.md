# OpenWA on the owner's Windows computer

On2026-10-25 the owner instructed **host locally**, superseding the earlier cloud-only constraint for the OpenWA gateway. This computer is now the designated host. The website remains designated for Vercel; the application database remains the designated production Supabase project.

## Local instance

The RSH Compose project is `rsh-whatsapp`. It uses the inspected upstream source commit `173916c83b41e622f849ecd380bf36486dfd8cdf`, image `rsh-openwa:173916c83b41`, and dedicated volume `rsh-whatsapp_gateway-data`. The expected local address is `http://127.0.0.1:2786`.

Another project's existing OpenWA container occupies port2785. Do not use that container's account, keys, sessions or volume. The ignored `.local/openwa/compose.local.yaml` selects the separate loopback port and local dashboard settings:

```yaml
services:
  gateway:
    ports: !override
      - "127.0.0.1:2786:2785"
    environment:
      CSP_UPGRADE_INSECURE_REQUESTS: "false"
      CORS_ORIGINS: "http://127.0.0.1:2786"
      WEBHOOK_SHUTDOWN_DRAIN_MS: "15000"
```

The local HTTP dashboard needs the CSP override; it does not change the committed production HTTPS settings. The drain interval exceeds the gateway webhook timeout. The generated master key is in `.local/openwa/gateway.env`, in a directory restricted to the current Windows user's SID. Secrets, browser profile, QR data and logs stay out of Git and deployment. The application receives only its dedicated session-scoped operator credential; never install the master key in Vercel. The operator key and separate callback secret are prepared in the private local credential store, not yet installed into Vercel.

## Start and stop

Run from `D:\Tourism` after Docker Desktop's Linux engine is running:

```powershell
docker compose --env-file .local/openwa/gateway.env -f deploy/openwa/compose.yaml -f .local/openwa/compose.local.yaml up -d --no-build gateway
docker compose --env-file .local/openwa/gateway.env -f deploy/openwa/compose.yaml -f .local/openwa/compose.local.yaml ps
```

To stop only this gateway:

```powershell
docker compose --env-file .local/openwa/gateway.env -f deploy/openwa/compose.yaml -f .local/openwa/compose.local.yaml stop gateway
```

Never append `--volumes` to a removal command: the dedicated volume holds the WhatsApp session and databases. `unless-stopped` restarts the container when Docker starts, except after an intentional stop. Docker Desktop's existing automatic-login-start preference has not been changed. After restarting Windows, open Docker Desktop and verify this gateway is healthy. The computer and internet connection must remain available for WhatsApp automation.

## Pairing and verification

Open the local dashboard and sign in with the locally protected master key. Use the dedicated `rshorizons-production` session. The owner scans the displayed QR through WhatsApp **Linked devices → Link a device**, using the intended business number. QR codes and account data must not enter public evidence. Verify `ready` and `engineLoaded=true`, followed by a controlled restart with the paired account. An unpaired session record surviving restart proves database persistence only, not paired WhatsApp recovery.

No message is sent merely by hosting the gateway or displaying the QR. Designate a test recipient and approved text before verifying real delivery and signed callbacks. Follow [the gateway integration guide](openwa.md) for scoped credentials, session-bound callbacks and consent.

## Vercel connection still needs HTTPS

Vercel cannot reach this computer through `127.0.0.1`. A stable authenticated HTTPS route to this gateway is required before setting `OPENWA_BASE_URL` in Vercel. The public route must expose only required authenticated API paths; keep gateway administration local. Do not forward router port2786 or expose the Docker daemon. A temporary testing tunnel is not a verified production endpoint.

Provider connection, actual send/callback evidence, approved message templates and the existing production release gates remain required. Do not set `MESSAGING_ACCOUNT_VERIFIED=true` just because the local health endpoint responds.

## Host repair performed

Docker Desktop4.35.1 initially crashed while removing the stale `userAnalyticsOtlpHttp.sock` runtime endpoint. With the newly started Docker processes stopped and the runtime folder contents verified, that folder was moved to `run-stale-rsh-20261025` beside Docker's runtime directory. Restart then returned Docker Engine27.3.1 on Linux/x86_64. Existing images, volumes and unrelated application configuration were not reset. Docker automatically resumed the older project's restart-enabled containers; none of their credentials or sessions were reused.

## Current verification

Actual checks on2026-10-25:

- Exact upstream image built natively for Linux/x86_64; both SQLite readiness checks passed. Container has a read-only root filesystem, dedicated persistent volume and a2GiB memory limit; Docker daemon is not mounted.
- Master key validates as administrator. A separate operator key validates with scope restricted to the single RSH session. Anonymous session access returns401; key administration and another session return403 for the operator key.
- Controlled gateway restart preserved the unpaired session identity and operator key. This proves database/key persistence only; paired recovery and backup/restore remain unverified.
- Headed Edge browser signed in through the actual API-key form and rendered the session QR. Session reports `qr_ready`, `engineLoaded=true`, no paired phone. The owner must scan it; no QR screenshot or phone is recorded publicly.
- Local image ID: `sha256:b032ebba767d4798b848b9e470b6c05170d7d93e844e1c698225cbf681329f9f`. Private pre-pairing dashboard evidence: `.local/openwa/dashboard-before-pairing.png`.

No real message, public tunnel, Vercel OpenWA connection, paired restart or delivery callback is verified. Production messaging verification remains false. The upstream gateway warns that API-key hashing has no pepper configured; generated keys are high-entropy random values. Adding a pepper requires a planned key rotation because it changes verification of existing keys.
