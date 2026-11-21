# LAN Deployment Evidence - PrivateFleet Pilot Lab

Date: 2026-10-29
Host: `<lan-host>` (Windows 11, native deployment)
Operator: deploy (Administrator)
Data: synthetic only

## Deployed topology

| Component | Detail |
|---|---|
| HTTPS entry | Caddy 2.11.7, internal CA, HTTP/2 + gzip |
| App URL | `https://app.privatefleet.home.arpa` |
| API URL | `https://api.privatefleet.home.arpa` |
| Web | static `apps/web/dist` served by Caddy |
| API | Node 24 + tsx, `127.0.0.1:4000`, SYSTEM startup task `PrivateFleet API` |
| PostgreSQL | 16.10 native, `127.0.0.1:5432`, service `postgresql-x64-16`, data `C:\PostgreSQL\data` |
| PostGIS | 3.6, enabled in database `privatefleet` |
| OSRM | `osrm/osrm-backend:v5.25.0`, loopback `127.0.0.1:5000`, network `privatefleet-routing` |
| VROOM | `vroomvrp/vroom-docker:v1.13.0`, loopback `127.0.0.1:3000`, reaches OSRM as `privatefleet-osrm:5000` |
| Caddy CA | `C:\Caddy\root.crt` (source: `C:\Caddy\data\pki\authorities\local\root.crt`) |
| age key | `C:\privatefleet\age_private_key.txt` (public key also `C:\PrivateFleet\secrets\age.pub`) |
| Database roles | owner `privatefleet`, runtime `privatefleet_app` (RLS active) |
| Synthetic tenant | slug `northstar-couriers-b67e10`, owner `owner@northstar.demo`, PIN `1234` |

Startup tasks: `PrivateFleet API`, `PrivateFleet Caddy`, `PrivateFleet Backup` (daily 02:00),
`PrivateFleet Soak Sampler` (temporary).

## Firewall / exposure (from a LAN client)

| Port | Reachable externally |
|---|---|
| 443 HTTPS | yes |
| 80 HTTP redirect | yes |
| 4000 API | no |
| 5432 PostgreSQL | no |
| 5000 OSRM | no |
| 3000 VROOM | no |

Firewall rules allow 80/443 only from `192.168.1.0/24` on Private/Domain profiles.
No router port forwarding. **Public-internet exposure was not tested from outside the LAN.**

## HTTP proposal/approval gate (through Caddy)

`node http-gate.mjs` against `https://api.privatefleet.home.arpa`:

- proposal 200, expected route version 1
- 3 vehicles, 12 paired shipments, 2 single-stop jobs, 0 unassigned
- stops per route `[12, 10, 4]` = **26**, **2 service stops**
- approval 200
- snapshot 200: routeVersion **2**, 3 routes at version 2, point counts 2367/2134/773, 14 jobs

Identity gate (`fleet-live-gate.ts`) on the deployed database:

- 26 route_stops, 2 persisted service stops
- per-route shipment counts 5/5/2; stop counts 12/10/4
- identity match true, assignments match proposal, 14 units accounted for
- 3 outbox events, version 2, 151 ms propose

## Backups

- Script: `C:\privatefleet\backup.ps1`, scheduled daily 02:00 as SYSTEM
- Encrypted with age public key, SHA-256 sidecar, 30-day retention
- Successful backup: `D:\PrivateFleet_Backups\privatefleet-20261029T005900Z.dump.age`
  (140,008 bytes, SHA-256 `8e5a3806c4398a150c3c18ddb680841334ff59f29ddc205216759983ba8721ea`)
- **Cloud copy unavailable:** SYSTEM/deploy gets `Access is denied` on `G:\My Drive`.
  Off-host backup is therefore **NOT VERIFIED**; only the local USB copy exists.
- Restore drill from the USB backup: decrypt + restore **1.0-1.2 s**,
  jobs 14, routes 3, stops 26, RLS 16 tables, PostGIS 3.6,
  runtime role own jobs 14 / foreign jobs 0 / foreign tenants 0, temp DB dropped.
  Restore used a superuser `--no-owner` restore plus explicit runtime grants because
  the dump does not grant ownership to the migration role.

## Load (deployed stack, real OSRM/VROOM)

`load-smoke.ts --vehicles=100 --jobs=850 --hubs=80`:

- propose **5,293 ms**; matrix 205 ms (89 locations); solve 1,956 ms; geometry 1,733 ms
- 90 routes, 0 unassigned, 97 shipments, 767 single-stop jobs
- 5,240,515 m / 579,859 s of route duration

## Read-path optimisation

The earlier build returned **11,364,655 bytes / 2,295 ms** for one fleet snapshot
(240,880 route points, 864 jobs, 961 stops). The fix separates route geometry and
enables gzip on the API host:

| Read | Before | After |
|---|---|---|
| Fleet polling (/state?includeRoutes=false) | 11.36 MB, 2.3 s | **567,769 bytes, 97 ms** |
| Route geometry (/fleet/routes) | included every read | **10,796,917 bytes, 671 ms**, fetched once per published version |

## Final instrumented soak (100 vehicles / 850 jobs)

Open-loop run 2026-10-29 09:31:46-10:01:46 UTC, **1,800 s**:

- reads: **35,999 scheduled / 35,999 completed at 20.0/s**, 0 failed, 0 dropped,
  0 5xx; p50/p95/p99 **65 / 133 / 250 ms**
- telemetry: **8,999 scheduled, 8,997 x HTTP 200 at 5.0/s**
- optimisation: **59 runs, 56 approved, 3 failures**, all **502 VROOM_UNAVAILABLE**
  inside the deliberate outage; p50/p95/p99 **5,388 / 5,739 / 5,808 ms**
- route geometry: 56 fetches, p95 **702 ms**
- VROOM outage: routeVersion **200 -> 200 -> 200**; proposal **502
  VROOM_UNAVAILABLE**; VROOM restarted at 09:42:47.704Z
- **ordinary non-outage 5xx: 0 / 59 = 0.0%**
- API pool: **897 samples** at 2 s; configured max **10**, total avg **9.59**,
  idle avg **8.37**, checked-out avg **1.23** / max **7**, saturation avg **12%**,
  **p95 30%**, **100% of samples < 80%**, DB lock waiters max **0**
- CPU/memory were not re-sampled in this instrumentation-only run; the previous
  run measured **40.4% of one core**, memory avg 376 MB / max 516 MB

Failure attribution: the three failures occurred at 09:41:47.716, 09:42:17.551
and 09:42:47.551, all within the outage window 09:41:46.804-09:42:47.704 and
all returned 502 VROOM_UNAVAILABLE. The harness's live inOutage flag was false
because outageEnd was null during the outage; that bug is fixed, and the
classification above uses the exact outage window and VROOM StartedAt.

**Verdict: PASS on throughput, read latency, telemetry, optimisation latency,
pool saturation and ordinary 5xx.** CPU for this exact run is **NOT VERIFIED**
(previous 40.4% remains the latest resource measurement). Client-side pool wait
queue is not exposed by postgres.js, so only DB lock waiters (0) are reported.
Do not raise routing limits.

## Known gaps

1. Cloud backup now succeeds via interactive user Amela: the Google Drive folder
   contains the encrypted backup and checksum. External-device download/sync
   verification is still pending; the task requires Amela to be logged in.
2. Public-internet exposure was not verified (LAN-only test).
3. Caddy uses an internal CA; each client must trust `C:\Caddy\root.crt`.
4. Windows Schannel clients need revocation soft-fail (`curl --ssl-no-revoke`);
   browsers may require the CA to be trusted and may warn about revocation.
5. CPU for the final instrumentation-only soak was NOT re-sampled (previous
   40.4% of one core). Client-side pool wait queue is not exposed by postgres.js;
   only DB lock waiters (0) are reported.
   itself consumed one app-role connection, and the 3 optimisation failures were
   clustered around the deliberate outage.
6. age private key is still on the host; move it offline and remove it after handoff.

