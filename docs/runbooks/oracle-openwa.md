# OpenWA on Oracle Always Free

Oracle signup remains blocked by the owner's available payment card. The owner's later **host locally** instruction supersedes the intervening cloud-only preference; the Windows gateway is now running as recorded in [local setup](local-openwa.md). The instructions below and [cloud assessment](free-openwa-hosting.md) are retained for reference, not an instruction to retry signup. No Oracle tenancy, home region, instance, public address or gateway hostname has been designated. No successful ARM build, WhatsApp pairing or delivery is claimed.

## Account and instance

Complete [Oracle signup](https://signup.cloud.oracle.com/) in the owner's browser. Keep identity verification, payment details and passwords on Oracle's site. Record the selected home region and confirm the console shows Always Free eligibility before creating resources. Do not upgrade the account or substitute a paid shape when free capacity is unavailable.

Use these proposed settings in **Compute → Instances → Create instance**, after creating a dedicated compartment and public subnet for this gateway:

| Setting | Proposed value |
|---|---|
| Compartment | `rshorizons` |
| Instance name | `rsh-openwa-prod` |
| Region | Owner's actual home region |
| Shape | `VM.Standard.A1.Flex`, marked Always Free eligible |
| Processor / memory | 2 OCPUs / 4 GB RAM |
| Image | Canonical Ubuntu 24.04 LTS, ARM64, eligible platform image |
| Boot volume | 50 GB; keep total eligible boot/block storage within the account allowance |
| Networking | Dedicated VCN/public subnet, internet gateway/default route and public IPv4 |
| SSH | Public key only; retain the private key in the owner's protected local credential directory |
| Paid extras | None; review the complete cost estimate before creating |

The current shared A1 allowance is 1,500 OCPU-hours and 9,000 GB-hours monthly, equivalent to 2 OCPUs/12 GB, plus 200 GB eligible block storage. Existing resources consume the same allowance. Capacity can be unavailable, and Oracle can reclaim idle instances. Check the console and [current Always Free terms](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm); do not assume the older 4-OCPU allowance. Oracle's [first Linux instance guide](https://docs.oracle.com/en-us/iaas/Content/Compute/tutorials/first-linux-instance/overview.htm) explains compartments, networks and SSH.

Initially allow inbound TCP22 only from the operator's actual public IP `/32`. Inspect both security lists and network security groups: an unrestricted default SSH rule would defeat the narrower rule. Keep port2785 closed externally. Preserve required Oracle image networking rules; do not flush host firewalls. Later, the selected HTTPS proxy needs TCP443 and its certificate-validation path, usually TCP80. DNS ownership and the exact hostname must be designated before configuring them. No NAT gateway or load balancer is needed for this single public instance.

## Install the pinned gateway

Connect as `ubuntu` with the protected SSH private key. Verify the instance's host-key fingerprint through the owner's Oracle console before accepting it. Confirm `uname -m` reports `aarch64` and the selected memory/disk are available.

Install Docker Engine and the Compose plugin using Docker's [official Ubuntu apt repository instructions](https://docs.docker.com/engine/install/ubuntu/). Record the installed versions. Use `sudo docker` rather than granting unnecessary users root-equivalent Docker group membership. The upstream pinned Dockerfile supports native ARM Chromium; this host must still prove it builds and runs.

Create a protected deployment directory:

```bash
sudo install -d -m 0700 -o ubuntu -g ubuntu /opt/rsh-openwa
```

Copy only the reviewed `deploy/openwa/compose.yaml` from this repository to `/opt/rsh-openwa/compose.yaml` using SCP. Do not copy the application `.env.local`, Supabase operator credentials or source media. Verify the copied file's SHA-256 against the local source. Keep the upstream source commit pinned to `173916c83b41e622f849ecd380bf36486dfd8cdf`.

Generate the gateway master key on the server without printing it. The following shell block refuses to replace an existing secret:

```bash
cd /opt/rsh-openwa
(
  set -eu
  umask 077
  set -C
  gateway_key="$(openssl rand -hex 32)"
  printf 'OPENWA_MASTER_KEY=%s\n' "$gateway_key" > .env
)
sudo docker compose --env-file .env -f compose.yaml config --quiet
sudo docker compose --env-file .env -f compose.yaml build gateway
sudo docker compose --env-file .env -f compose.yaml up -d gateway
sudo docker compose --env-file .env -f compose.yaml ps
curl --fail --silent --show-error http://127.0.0.1:2785/api/health/ready
```

Do not print unrestricted `docker compose config` or container environment inspection: these contain the master key. A healthy HTTP response proves gateway readiness only; pairing and real delivery remain separate checks. If the native build fails, inspect the actual failure before changing image versions, privileges or memory settings.

The committed service binds `127.0.0.1:2785`, mounts persistent `gateway-data`, restarts after reboot, limits container memory to2GB, and does not mount the Docker socket. Do not use `down --volumes`: the volume contains session credentials and gateway databases.

## Pair privately, then expose the required API

Before public HTTPS is configured, the owner can access the dashboard using an SSH tunnel from their computer:

```text
ssh -i PATH_TO_PRIVATE_KEY -L 127.0.0.1:2785:127.0.0.1:2785 ubuntu@INSTANCE_PUBLIC_IP
```

Open `http://127.0.0.1:2785` locally while that connection remains open. Retrieve the master key privately on the server when needed; never put it in chat or Vercel. Pair the owner-designated dedicated WhatsApp number, keep QR/session credentials out of screenshots, and create a session-scoped operator API key. Follow the exact session, webhook signature and consent requirements in [OpenWA setup](openwa.md).

The SSH tunnel is for operator setup only. Vercel needs a stable publicly trusted HTTPS gateway origin. Once the owner supplies a hostname and DNS account, configure a host reverse proxy to the loopback port, restrict dashboard/administration to operators, and expose only the application's required authenticated API paths. Do not expose raw port2785 or disable TLS checks. This step remains pending until the hostname and server are designated.

## Evidence before connecting production messages

Record a successful native build and image ID, healthy readiness, paired session readiness, externally verified HTTPS, unauthenticated API rejection and denial of external port2785. Verify the session survives a controlled gateway restart. Use upstream's consistent database/session backup procedure and an isolated restore rehearsal before relying on the persistent volume; do not copy live SQLite files as a purported consistent backup.

Then install only the session-scoped key, gateway origin, session ID and separate webhook secret in the designated Vercel environment. Use an owner-designated test recipient and approved message text to verify send, signed delivered/read callback, duplicate callback handling and email fallback. Keep `MESSAGING_ACCOUNT_VERIFIED` unset until that evidence exists. Production guest sends remain subject to consent and staff approval rules.

The current Vercel Hobby cron restriction, Supabase64MiB storage requirement, separate staging and remaining business/provider approvals are independent release gates. A free Oracle instance does not resolve them. Record hosting limits and interruption/recovery arrangements with the owner; an Always Free VM is not an uptime guarantee.

## Verification at preparation time

The existing Compose file is checked locally with Docker Compose's parser and a temporary non-production placeholder key. Docker Desktop's Linux engine is unavailable in this workspace, so no container build or runtime result is claimed. Native ARM build, session persistence, HTTPS and real sends await the owner's Oracle account/server and designated phone.
