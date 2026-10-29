# LAN Deployment Evidence - PrivateFleet Pilot Lab

Date: 2026-10-29
Host: `192.168.1.128` (Windows 11, native deployment)
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

## Full soak (100 vehicles / 850 jobs)

Run 2026-10-29 01:50-02:20 UTC, 1,809 s, against the 100/850 tenant:

- reads: **3,300 completed** (about **1.8/s**, not the requested 20/s), 0 errors,
  p50/p95/p99 **4,123 / 7,287 / 7,742 ms**
- optimisation: **55 runs**, 55 approved, 0 normal failures,
  p50/p95/p99 **5,184 / 5,904 / 6,089 ms**
- telemetry: **825 x HTTP 200** (about 0.46/s, not the requested 5/s), no errors
- deliberate 60 s VROOM outage: published routeVersion stayed **20 -> 20 -> 20**;
  fleet proposal returned **502 VROOM_UNAVAILABLE**; snapshot stayed 200
- resources: API CPU **+1,550 s** (~85% of one core), memory avg **614 MB**
  (max 749 MB), DB sessions avg 10.8 / max 11; no OOM/restart observed

**Verdict: FAIL on read throughput and telemetry rate.** The API could not
sustain 20 fleet-snapshot reads/s or 5 telemetry batches/s at this fleet size;
the snapshot payload/latency is the bottleneck. Optimisation latency and outage
preservation passed. Do not raise the routing limits; first reduce the fleet
snapshot read model/payload (pagination or summary endpoint) and rerun this
exact soak.

## Known gaps

1. Cloud backup now succeeds via interactive user Amela: the Google Drive folder
   contains the encrypted backup and checksum. External-device download/sync
   verification is still pending; the task requires Amela to be logged in.
2. Public-internet exposure was not verified (LAN-only test).
3. Caddy uses an internal CA; each client must trust `C:\Caddy\root.crt`.
4. Windows Schannel clients need revocation soft-fail (`curl --ssl-no-revoke`);
   browsers may require the CA to be trusted and may warn about revocation.
5. Soak workload scale differs from the 100/850 load; resource thresholds are provisional.
6. age private key is still on the host; move it offline and remove it after handoff.

