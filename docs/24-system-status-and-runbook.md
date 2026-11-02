# PrivateFleet — implemented system, status and runbook

Last updated: 2026-11-01  
Commit baseline: `c400476` (native offline evidence queue)  
Environment: LAN pilot at `192.168.1.128`, synthetic data only.

This is the authoritative description of what is actually deployed. It separates
verified capability from pending work so demos and reviews do not confuse the
two.

---

## 1. Deployment topology

```text
Android driver app (Galaxy S22)
  ├── LAN:   https://api.privatefleet.home.arpa
  └── WAN:   https://pf-node.tail060a86.ts.net  (Tailscale Serve)
                    │
Windows host 192.168.1.128
  ├── Caddy :443  app.privatefleet.home.arpa / api.privatefleet.home.arpa
  ├── API Fastify 127.0.0.1:4000
  ├── PostgreSQL/PostGIS 127.0.0.1:5432  (never exposed)
  ├── OSRM 127.0.0.1:5000
  ├── VROOM 127.0.0.1:3000 (Docker, digest-pinned)
  ├── dnsmasq (Docker) :53 for *.privatefleet.home.arpa
  └── Tailscale node pf-node (100.76.118.22)
```

Dispatcher web: `https://app.privatefleet.home.arpa`.

---

## 2. Implemented and verified

| Capability | State | Evidence |
|---|---|---|
| Multi-tenant Postgres/PostGIS with RLS | Deployed | tenants, RLS, migrations |
| Job import (CSV), validation, preview/commit | Deployed | G batch 30 jobs imported |
| Pickup/dropoff pairing and precedence | Deployed | shipment model + tests |
| Fleet optimisation OSRM + VROOM | Deployed | 30-job regression |
| VROOM visit-order preservation | Fixed | `db50c4c`, `a75ebc7` |
| Published geometry/distance consistency | Verified | Mo 134.0 km, Sarah 77.4 km |
| Dispatch policy presets + custom limits | Deployed | revision 42 |
| Per-vehicle override API + UI editor | Deployed | `c38db10` |
| Policy revision stored with proposal | Deployed | proposals rev 40/41 |
| Stale-policy approval rejection | Deployed | `409 STALE_DISPATCH_POLICY` |
| Baseline vs proposal publish gate | Deployed | distance/coverage/working duration |
| Gate scope fix for new work | Deployed | `09317cd` |
| Hard per-vehicle limits | Deployed | 120/200/300 km presets; VROOM max_distance |
| Manual route closure + release work | Deployed | `4409a02`; Tom v100 cancelled |
| Automatic route completion | Deployed | `f0a44f4` |
| Driver app foreground GPS | Deployed | telemetry over LAN and Tailscale |
| Native Android client (no Expo) | Deployed, pilot parity | `apps/driver-native`, screen-off test PASS |
| Native background GPS | Verified | 17 to 25 telemetry rows with screen off |
| Native nearest-stop ordering + paging | Deployed | arrived pinned, pending sorted by GPS distance, 3/6 per page |
| Native encrypted session/queue/evidence | Deployed | Android Keystore AES/GCM, FLAG_SECURE |
| Native offline evidence queue | Deployed | signature/photo survive network loss and sync on reconnect |
| Dispatcher map HUD/dock | Deployed | inset vehicle HUD, centred 46 px taskbar icon, 3-up pager, 440 px popover, bounded assignment sheet |
| POD evidence + durable queue | Deployed | duplicate upload treated as success `69ee6eb` |
| External access via Tailscale Serve | Deployed | `{"status":"ok"}` from mobile data |
| Local DNS via dnsmasq | Deployed | app/api resolve to 192.168.1.128 |
| Customer tracking, alerts, reports | Existing modules | earlier phases |
| Cost-aware assignment recommendations (fuel, running cost, wage, detour) | Deployed, advisory only | `/v1/dispatch/recommendations`, `f0a44f4`+ |

### Route lifecycle (current behaviour)

- `arrive` → stop `arrived`, route moves to `in_progress`.
- `complete` / `skip` → stop terminal, then:
  - if the route still has open stops → stays `in_progress`;
  - if no open stops → route becomes `completed`;
  - driver becomes `available` when no other published/in-progress route exists;
  - outbox event `route.completed` is written.
- Dispatcher can explicitly close a route:
  - API `POST /v1/fleet/routes/close`
  - UI button **Close route and release work**
  - unfinished stops reset to `pending`, unfinished jobs to `unassigned`,
    audit event `route.closed`.

### Dispatch policy

```text
Local:          120 km / 5 h travel / 7 h working / 30 visits
Balanced Urban: 200 km / 9 h travel / 10 h working / 50 visits
Extended:       300 km / 11 h travel / 12 h working / 70 visits
```

- One tenant revision covers preset, advanced values and all vehicle overrides.
- Optimisation and approval use the same revision.
- Working duration is `travel + 5 min × visits` — an estimate, **not** legal
  drivers' hours compliance.
- A new job set is not compared against the old baseline for distance/coverage;
  only identical job sets are regression-checked. Hard limits always apply.

### External access

```text
Tailscale host:  pf-node  (100.76.118.22)
Serve:           https://pf-node.tail060a86.ts.net → 127.0.0.1:4000
Phone:           g (100.124.180.48), galaxy-s22 (100.123.137.123)
```

- Serve is tailnet-only; Funnel is not used.
- PostgreSQL stays bound to `127.0.0.1:5432`.
- Native APK uses `BuildConfig.API_BASE=https://pf-node.tail060a86.ts.net`
  (compiled at build; `apps/driver-native/app/build.gradle`).
- The Expo APK remains as a legacy fallback and uses `EXPO_PUBLIC_API_URL`.
- DNS takeover on Tailscale is disabled so dnsmasq and `.home.arpa` keep working.

### Local DNS

```text
Container: privatefleet-dns (dnsmasq), port 53 UDP/TCP
Records:   *.privatefleet.home.arpa → 192.168.1.128
Upstream:  192.168.1.254 (BT Hub)
```

Windows ICS DNS proxy is disabled because it held port 53. Docker restart policy
is `unless-stopped`.

---

## 3. API surface relevant to dispatch

| Method/path | Purpose |
|---|---|
| `POST /v1/jobs/import` / commit | CSV import |
| `POST /v1/optimization/fleet-run` | Constraint-checked proposal |
| `POST /v1/optimization/fleet/:runId/approve` | Publish plan |
| `POST /v1/fleet/routes/close` | Close stale route, release work |
| `GET/PATCH /v1/dispatch-policy` | Presets, limits, overrides |
| `POST /v1/jobs/:id/stops/:id/arrive` | Driver arrival |
| `POST /v1/jobs/:id/stops/:id/complete` | Complete with proof policy |
| `POST /v1/jobs/:id/stops/:id/skip` | Failure/skip |
| `POST /v1/telemetry` | GPS samples |

---

## 4. Operations runbook

### Start or restart the API

```powershell
# On the host, as an administrator/SYSTEM task
C:\privatefleet\hard-restart-api.ps1     # kills tsx then starts scheduled task
curl.exe -s http://127.0.0.1:4000/healthz
```

Scheduled task: **PrivateFleet API** → `start-api.ps1` → `tsx src/server.ts`.
If the API exits, read `C:\PrivateFleet\logs\api.log` and
`C:\Temp\api-start-full.log`. A common failure is deploying `fleet-service.ts`
without its new import (`dispatch-policy.ts`).

### VROOM

```text
Container: privatefleet-vroom
Image:     ghcr.io/vroom-project/vroom-docker@sha256:247d5683d6745c755d718a156d16b16aac80baccc276a003a68b986c13883b08
Port:      127.0.0.1:3000
Rollback:  privatefleet-vroom-rc2 (v1.14.0-rc.2, stopped)
```

See `docs/23-vroom-115-deployment.md`.

### DNS

```powershell
docker ps --filter name=privatefleet-dns
docker restart privatefleet-dns
# host check
nslookup app.privatefleet.home.arpa 192.168.1.128
```

If DNS stops after a host reboot, confirm Docker Desktop starts the container.
Phones fall back to `8.8.8.8`; `.home.arpa` will fail until dnsmasq is back.

See `docs/27-stage-plan-review-and-build-order.md` for the consolidated stage
review and `docs/29-build-status-ledger.md` for the authoritative five-state
build ledger.
See `docs/28-dispatcher-map-interaction.md` for the live-map HUD, dock and
assignment-sheet interaction contract.

### Tailscale

```powershell
& "C:\Program Files\Tailscale\tailscale.exe" status
& "C:\Program Files\Tailscale\tailscale.exe" serve status
```

Serve config persists. Phone must be signed into the same tailnet account.

### Database

- Local only: `127.0.0.1:5432`.
- Backups: existing `.dump.age` jobs write to Google Drive; restore drill is
  still pending.
- Do not expose 5432 through Tailscale, port forwarding or Funnel.

---

## 5. Known data issues

1. **Cross-tenant duplicate-looking records are not integrity failures.**
   The unique `(tenant_id, reference)` index is enforced live. `J-191` and
   `J-202` appearing twice are different tenants; verify the tenant before use.
2. **Duplicate driver names exist across tenants** (for example two Sarah Reed
   and two Tom Cole records). They are isolated by tenant; they still confuse
   demos and must be retired with the load/E2E tenant.
3. **Load-test tenant retired** on 2026-11-01 after a 773 MB backup. Only
   Northstar remains; global route-version pollution is gone.
4. **Historical published routes** can remain for drivers omitted from a later
   plan. Manual closure and automatic completion reduce this, but an audited
   cleanup is still needed.
5. Live counts and route versions change during testing. Query the fleet state
   or run `scripts/audit-status.ps1`; do not quote a stale snapshot.

## 6## 6. Pending / not implemented

See `docs/29-build-status-ledger.md` for the authoritative five-state ledger:
completed, started-but-unfinished, uncompleted/superseded, not yet started and
next.

| Item | State |
|---|---|
| Driver "Request more jobs" request/decision loop | Deployed; assignment/re-optimisation unfinished |
| Automatic partial assignment explanation beyond `SOLVER_UNASSIGNED` | Partial |
| Dispatch-origin resolver (depot, confirmation, fresh GPS) | Not started |
| Native background GPS / screen-off tracking | Deployed and verified |
| Native release signing | Complete (RSA 4096, 1.0.1, verified); update channel not defined |
| Duplicate job-reference constraint | **Already enforced**; cross-tenant only |
| Demo/load tenant isolation and audited reset | Load tenant retired; reset procedure still to be written |
| Current-build E2E / restore | Complete: 16 passed, 243.5 s restore |
| 2x-DPR 250-vehicle performance | Open: p95 1.54 s |
| Restore drill on current schema | Not started; pre-retirement dump retained |
| Tailscale ACL/MFA hardening | Not started |
| External health alert channel | Not started; local watchdog + auto-recovery deployed |
| 30-day reliability evidence and SLA | Not started |

## 7. Test status

- Current-build E2E: **16 passed / 16 skipped / exit 0** (2.6 min).
- Restore drill on the pre-retirement backup: **243.5 s, exit 0**, 1,109
  geometry stops, 24 RLS tables.
- 250-vehicle load at standard DPR: **p95 123 ms**.
- 250-vehicle load at 2x DPR: **p95 1,538 ms** - open performance defect.
- Last full API suite: 90/90 pass before the latest native/web-only changes; it
  should be rerun in the next assurance pass.
- Visit-order regression, policy resolver and 30-job VROOM regression pass.
- Web production build and typecheck pass.
- Native screen-off GPS, offline command and offline evidence are verified on
  the physical Galaxy S22.

## 8. Relevant commits

```text
db50c4c  fix(routing): preserve vroom visit order
a75ebc7  test(routing): lock interleaved visit ordering
0bcc562  fix(optimization): baseline latest route version
f9d0987  feat(dispatch): versioned policy presets
8a5fd9a  feat(dispatch): policy tables
a0853cd  feat(dispatch): policy revision + API
d89f5a2  feat(dispatch): complete policy integration
648ee00  fix(dispatch): enable RLS on policy tables
25fb288  feat(dispatch): hard vehicle limits
dfc4c4a  ops(vroom): pin v1.15.0
42ab2a3  fix(map): keep stale off-route vehicles selectable
0b04d49  feat(fleet): location provenance
c38db10  feat(policy): vehicle override editor
4409a02  feat(dispatch): close stale routes
70d00db  fix(map): explain missing route
09317cd  fix(optimization): baseline scope comparison
69ee6eb  fix(driver): duplicate evidence is success
f0a44f4  feat(routes): auto-complete routes/release drivers
```

## 9. Cost-aware recommendations

Endpoint: `GET /v1/dispatch/recommendations` (dispatcher only).
Advisory only; it never assigns or publishes.

Incremental cost per candidate job:

```text
added fuel       = detour km × FUEL_PENCE_PER_KM
added vehicle    = detour km × VEHICLE_PENCE_PER_KM
added wage       = added minutes / 60 × DRIVER_PENCE_PER_HOUR
```

Defaults (environment-overridable): fuel 12p/km, vehicle 8p/km,
driver £15/h, maximum detour 4 km.

A job is only recommended when:

- pickup and drop-off are both within the detour threshold of an existing
  published route,
- the route stays within its visit, distance, travel-time and working-time
  policy limits.

Each suggestion includes the driver, vehicle, added km, added minutes,
incremental £ cost, current route estimated cost and a plain-language reason.
The dispatcher decides whether to assign. Detour estimates are geometric with a
1.4 road factor, not a re-optimisation; they are directional, not a substitute
for running the solver.
