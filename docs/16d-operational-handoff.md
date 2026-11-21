# Operational Handoff - PrivateFleet Pilot

Status: **software complete; deployment gates NOT VERIFIED**
Baseline: `11c8a26` plus the limiter edge-case regression (final SHA in the
closing report)
Owner: pilot operator/partner. This document is the runbook; it is not
evidence that the operational steps have been executed.

Nothing in this document authorises public exposure. Complete the
pre-exposure checklist and obtain the signed RPO/RTO and retention decisions
first.

## 1. Deployment checklist (execute in order)

1. **Choose host and DNS.** Record the API host and web host. Point
   `api.<pilot-domain>` and `app.<pilot-domain>` at the deployment host; wait
   for DNS propagation before requesting certificates.
2. **Provision PostgreSQL 16 + PostGIS 3.4.** Keep the database on a private
   network. Create two roles: owner/migrator (`privatefleet`) and runtime
   (`privatefleet_app`); never run the API as the owner. Apply migrations with
   the owner URL, then verify RLS with `src/db/rls.test.ts` or the probe SQL in
   the readiness report.
3. **Provision secrets.**
   - `AUTH_JWT_SECRET`: at least 32 random characters, generated with a CSPRNG
     (`openssl rand -base64 48`). Store in the host secret manager or a
     root-readable env file; never in Git or backups in plaintext.
   - Database passwords for both roles.
   - Optional SMTP/provider secrets when notifications are enabled.
4. **Configure TLS/reverse proxy.** Put Caddy (or an equivalent TLS
   terminator) in front of the API/web. Example Caddyfile:

   ```caddy
   api.<pilot-domain> {
     reverse_proxy 127.0.0.1:4000
     encode zstd gzip
     header {
       Strict-Transport-Security "max-age=31536000; includeSubDomains"
       X-Content-Type-Options "nosniff"
       X-Frame-Options "DENY"
       Referrer-Policy "no-referrer"
     }
   }

   app.<pilot-domain> {
     root * /srv/privatefleet/web
     try_files {path} /index.html
     file_server
     encode zstd gzip
   }
   ```

   Only Caddy listens on 80/443 publicly. The API stays on loopback
   (`127.0.0.1:4000`). Set CORS explicitly; do not use `*`.
5. **Firewall.** Public ingress: 80/443 only (and SSH from the operator's
   restricted address if required). The API port 4000, PostgreSQL 5432 and the
   routing ports 5000/3000 must not accept public traffic.
   - OSRM/VROOM: allow only the API host or the trusted private network/VPN.
   - Verify externally, not just from the LAN: attempt connections from an
     outside network and record the result. A LAN success does **not** prove
     public closure.
6. **Configure environment.** Use the manifest in section 2; run the API as a
   supervised service (systemd, Windows service or container restart policy)
   with `REPOSITORY_MODE=postgres`.
7. **Seed/verify data.** Create the pilot tenant with a real owner account,
   verify login, fleet snapshot, one manual assignment and one live proposal.
8. **Verify health and TLS.** `curl -fsS https://api.<domain>/healthz` returns
   200; certificate chain and HSTS are present; a plain `http://` request
   redirects to HTTPS.
9. **Verify the routing identity gate** against the deployed services:

   ```bash
   OSRM_BASE_URL=https://routing.internal:5000 \
   VROOM_BASE_URL=https://routing.internal:3000 \
   DATABASE_URL=postgres://privatefleet_app:...@db:5432/privatefleet \
   MIGRATION_DATABASE_URL=postgres://privatefleet:...@db:5432/privatefleet \
   AUTH_JWT_SECRET=<32+ chars> ROUTING_DATASET_ID=<pinned dataset> \
   pnpm --filter @privatefleet/api exec tsx src/db/fleet-live-gate.ts
   ```

   Expected: 14 business units, 26 persisted stops (16/6/4), 2 service
   identities, assignments equal to the proposal, version 2, 3 outbox events.
10. **Record the deployment.** Write down image digests, OSM SHA-256, env
    versions, host, certificate expiry and the operator on call.

## 2. Environment variable manifest

| Variable | Required | Example / notes |
|---|---|---|
| `REPOSITORY_MODE` | yes | `postgres` (demo mode is fixture-only) |
| `DATABASE_URL` | yes | `postgres://privatefleet_app:...@db:5432/privatefleet` (runtime, RLS) |
| `MIGRATION_DATABASE_URL` | migrations | owner role, never exposed to the API process |
| `AUTH_JWT_SECRET` | yes | >= 32 random characters; rotate via the documented procedure |
| `AUTH_ACCESS_TTL_SECONDS` | no | default `900` (15 min) |
| `AUTH_REFRESH_TTL_DAYS` | no | default `30` |
| `AUTH_ATTEMPT_WINDOW_SECONDS` | no | default `60` |
| `AUTH_MAX_ATTEMPTS_ACCOUNT` | no | default `5` |
| `AUTH_MAX_ATTEMPTS_IP` | no | default `50` (shared-IP aggregate) |
| `CORS_ORIGINS` | yes in production | comma-separated exact web origins, e.g. `https://app.<domain>` |
| `OSRM_BASE_URL` | yes for live routing | private URL, e.g. `http://routing.internal:5000` |
| `VROOM_BASE_URL` | yes for live routing | private URL, e.g. `http://routing.internal:3000` |
| `ROUTING_DATASET_ID` | yes | pinned dataset identifier, e.g. `greater-london-2026-10-28` |
| `ROUTING_MAX_MATRIX_LOCATIONS` | no | default `100`; do not exceed OSRM `max-table-size` |
| `VROOM_MAX_TASKS` | no | default `1000`; keep until capacity evidence changes it |
| `PORT` | no | default `4000`; bind behind the proxy |
| `LOG_LEVEL` | no | `info` in production; no secrets/PII in logs |
| `TZ` / timezone | recommended | record it; solver windows are absolute |

## 3. Backup and recovery runbook

### 3.1 Business decisions (must be signed before go-live)

> **RPO = ____ hours. RTO = ____ hours.** Signed by: ______________
> Date: __________. Backup frequency and PITR choice follow from these.

- **PITR decision:** if the agreed RPO is shorter than the pg_dump interval
  (for example RPO < 24 h with daily dumps), WAL archiving is required.
  Enable `archive_mode=on`, set `archive_command` to copy WAL to encrypted
  off-host storage, and test a point-in-time restore. If the RPO is >= the
  dump interval, document that acceptance and skip PITR for the pilot.
- **Retention:** backups retained for ____ days, encrypted at rest, access
  restricted to named operators. Retention of backup material must satisfy the
  same legal decisions as the data itself.

### 3.2 Scheduled encrypted off-host backup

Linux cron example (run as the backup user, `PGPASSFILE` mode 0600):

```bash
# /etc/cron.d/privatefleet-backup
15 2 * * * backup /usr/local/bin/privatefleet-backup.sh >> /var/log/privatefleet-backup.log 2>&1
```

```bash
#!/usr/bin/env bash
set -euo pipefail
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DUMP=/var/backups/privatefleet/${STAMP}.dump
mkdir -p "$(dirname "$DUMP")"
pg_dump -h 127.0.0.1 -U privatefleet -Fc -d privatefleet -f "$DUMP"
age -r "$BACKUP_AGE_RECIPIENT" -o "${DUMP}.age" "$DUMP"
sha256sum "${DUMP}.age" >> "${DUMP}.age.sha256"
# Off-host: S3-compatible target with versioning + object lock where available.
aws s3 cp "${DUMP}.age" "s3://<backup-bucket>/privatefleet/${STAMP}.dump.age" \
  --sse AES256
aws s3 cp "${DUMP}.age.sha256" "s3://<backup-bucket>/privatefleet/${STAMP}.dump.age.sha256"
rm -f "$DUMP"
# Prune local encrypted copies older than the approved retention.
find /var/backups/privatefleet -name '*.age' -mtime +<retention-days> -delete
```

Windows Task Scheduler equivalent: run a PowerShell script with
`pg_dump.exe -Fc`, encrypt with `age`/GPG, upload with `aws s3 cp`, and log
exit codes. Alert on any non-zero exit or missing daily object.

### 3.3 Restore drill (repeat against the off-host copy, not only local)

```bash
aws s3 cp s3://<bucket>/privatefleet/<stamp>.dump.age /tmp/restore.age
age -d -i <backup-identity> -o /tmp/restore.dump /tmp/restore.age
runuser -u postgres -- createdb -O privatefleet privatefleet_restore_test
runuser -u postgres -- psql -d privatefleet_restore_test -c 'CREATE EXTENSION IF NOT EXISTS postgis;'
runuser -u postgres -- pg_restore -d privatefleet_restore_test --no-owner /tmp/restore.dump
# verify migrations, PostGIS, RLS counts, representative counts/checksums,
# then connect as privatefleet_app and repeat the cross-tenant probe.
```

Record: restore start/end, RTO achieved, row/checksum reconciliation, failures,
and the owner of the recurring quarterly drill. Do not claim recovery
readiness until an **off-host** backup has been restored successfully.

## 4. Load and soak protocol

Use synthetic tenants only. Never load real customer records.

### 4.1 Single-batch capacity

```bash
OSRM_BASE_URL=http://<routing-host>:5000 \
VROOM_BASE_URL=http://<routing-host>:3000 \
DATABASE_URL=postgres://privatefleet_app:...@db:5432/privatefleet \
MIGRATION_DATABASE_URL=postgres://privatefleet:...@db:5432/privatefleet \
AUTH_JWT_SECRET=<secret> \
pnpm --filter @privatefleet/api exec tsx src/db/load-smoke.ts \
  --vehicles=100 --jobs=850 --hubs=80
```

Record `proposeMs`, `matrixMs`, `solveMs`, `geometryMs`, matrix size, routes,
unassigned count and the exact workload shape. The 100/850 workload was
measured at 6.34 s in the controlled environment; that is not a guarantee for
the deployed host.

### 4.2 Sustained soak and concurrency

Run for **30 minutes** against the deployed stack, mixing:

- 1 optimisation request every 30 s (100 vehicles / 850 jobs fixture);
- 20 concurrent fleet-snapshot reads per second (`k6` or equivalent);
- 5 telemetry batches per second across synthetic drivers;
- one dependency-outage window (stop VROOM for 60 s, then restart) to verify
  bounded 502s and unchanged published routes.

Capture at minimum:

| Metric | Provisional pilot target (not an SLA) |
|---|---|
| API p50/p95/p99 latency | p95 < 1 s reads, p95 < 12 s optimisation |
| Solver latency p95 | < 5 s for 100/850 |
| Error rate | < 1% 5xx over the soak |
| DB pool saturation | < 80% for 95% of samples |
| API CPU / memory | < 70% CPU, no unbounded RSS growth |
| Restart/OOM events | 0 |
| Outage behaviour | 502 typed, no partial publication, recovery after restart |

Record tool versions, host size, DB size and timestamps with the results.

## 5. Data retention decisions (business/legal, not engineering)

Fill in and obtain sign-off:

| Data | Retention period | Export/deletion rule | Owner |
|---|---|---|---|
| `location_points` (driver GPS) | ______ | ______ | ______ |
| `optimization_runs` (proposals/results) | ______ | ______ | ______ |
| Customer addresses (`job_stops`) | ______ | ______ | ______ |
| `outbox`/audit events | ______ | ______ | ______ |
| Backups (off-host) | ______ | ______ | ______ |

Do not invent values. Retention must be compatible with the pilot contract,
privacy law and the RPO/RTO signed above.

## 6. Pre-exposure checklist (all must be checked)

- [ ] Auth limiter verified in the deployed environment; shared-IP aggregate
      behaviour understood by the operator.
- [ ] TLS active, certificate valid, HTTP redirected to HTTPS.
- [ ] Public ingress limited to 80/443; API 4000, DB 5432 and routing
      5000/3000 verified closed from an external network.
- [ ] CORS restricted to exact web origins; no wildcard.
- [ ] Secrets provisioned (JWT >= 32 chars, DB roles separated) and not in Git.
- [ ] Migrations applied; RLS probe passes with the runtime role.
- [ ] Encrypted off-host backup scheduled; one **off-host** restore drill
      passed and timed.
- [ ] RPO/RTO signed; PITR decision recorded.
- [ ] Data retention/export decisions signed.
- [ ] 30-minute soak and dependency-outage test completed with metrics.
- [ ] Pilot tenant, owner account and support/on-call ownership recorded.

Until every box is checked: **NOT VERIFIED, no public exposure, no pilot
sign-off.**

## 7. Known limitations carried into the pilot

- The auth limiter is process-local; multiple API instances need sticky
  sessions or a shared limiter.
- Remaining dependency advisories are Expo/Metro build-tool paths; they do not
  enter the API runtime but must be upgraded separately.
- Single-batch solver ceiling: 1000 tasks and 100 distinct matrix locations.
  Batch larger fleets or raise the VROOM/OSRM limits only after evidence.
- No native background GPS/geofencing yet; the driver web app requires the
  device to keep the page active for continuous tracking.

## 8. Executed LAN deployment (2026-10-29)

- Host: `<lan-host>`; app `https://app.privatefleet.home.arpa`; API
  `https://api.privatefleet.home.arpa`.
- PostgreSQL 16.10 native (`C:\PostgreSQL\16`, service `postgresql-x64-16`),
  PostGIS 3.6, database `privatefleet`, RLS active.
- Caddy 2.11.7 native, internal CA; CA certificate at `C:\Caddy\root.crt`.
- API: Node 24 + tsx, `127.0.0.1:4000`, startup task `PrivateFleet API`;
  web static from `C:\privatefleet\apps\web\dist`.
- OSRM/VROOM rebound to `127.0.0.1:5000/3000`; VROOM reaches OSRM over the
  `privatefleet-routing` Docker network.
- Firewall: only 80/443 reachable from `192.168.1.0/24`; API/DB/routing ports
  confirmed closed from a LAN client. No router port forwarding.
- Lab decisions accepted 2026-10-29: RPO 24 h, RTO 4 h, daily backups, no PITR,
  locations 7 d, optimisation runs 30 d, outbox/backups 30 d, synthetic
  addresses purged with the dataset.
- Backup task `PrivateFleet Backup` runs daily 02:00 as SYSTEM; first encrypted
  backup at `D:\PrivateFleet_Backups\privatefleet-20261029T005900Z.dump.age`.
- Cloud copy now succeeds via task `PrivateFleet Cloud Backup` under interactive
  user `Alemnesh\Amela`: `G:\My Drive\PrivateFleet_Backups\privatefleet-20261029T005900Z.dump.age`
  plus checksum, SHA-256 matching the USB copy. A restore of the Google Drive copy
  passed (RTO 2.4 s, 26 stops, RLS 16, foreign rows 0). The task requires Amela to
  be logged on; external-device download/sync verification is still pending.
- Restore drill from the USB backup: 1.0-1.2 s, 14 jobs, 3 routes, 26 stops,
  16 RLS tables, PostGIS 3.6; runtime role saw 0 foreign rows. Temporary
  restore database dropped.
- age private key: `C:\privatefleet\age_private_key.txt`; move offline and
  remove from the host after handoff.

### 8.1 Soak result (2026-10-29)

Final instrumented 100/850 open-loop soak (1,800 s): **35,999/35,999 reads at
20.0/s**, 0 errors, p50/p95/p99 **65/133/250 ms**; telemetry **8,997 x 200 at
5.0/s**; 59 optimisations, 56 approved, 3 failures all 502 VROOM_UNAVAILABLE
inside the outage, p95 5,739 ms; route geometry p95 702 ms. Ordinary non-outage
5xx: **0/59 = 0.0%**. VROOM outage left routeVersion 200 unchanged.

API pool: 897 samples, max 10, total avg 9.59, idle avg 8.37, checked-out avg
1.23 / max 7, saturation avg 12%, p95 30%, **100% of samples <80%**, DB lock
waiters 0. Client-side pool wait queue is not exposed by postgres.js.

CPU/memory were not re-sampled in this run (previous: 40.4% of one core, memory
avg 376 MB / max 516 MB). Do not raise routing limits.
