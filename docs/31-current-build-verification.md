# 31 - Current-build verification and recovery

Date: 2026-11-02  
Environment: LAN pilot host `192.168.1.128`, synthetic data.  
Purpose: Stage A evidence on the current schema and UI.

---

## 1. E2E result

Command:

```powershell
pnpm --filter @privatefleet/e2e test
```

Result:

```text
16 passed
16 skipped (mobile duplicates of desktop-only map/benchmark tests)
exit 0
duration 2.6 min
```

Coverage includes:

- dispatcher assignment flow with impact preview
- emergency drag assignment
- driver proof-of-service flow
- live map movement and route consistency
- stale GPS ghosts
- reconnect snapshot recovery
- malformed-geometry retention
- vector and raster map engines
- 250-vehicle benchmark measurements

Test changes required by the new map chrome:

- the queue is now opened explicitly through the **Open unassigned jobs** dock
- raster-specific assertions use `?map=raster`
- selected-route stroke assertions use the current `6/4` line weights

No application behaviour was weakened to make tests pass.

---

## 2. Restore drill

Backup used:

```text
C:\PrivateFleet\backups\pre-retire-load-20261101-230125.dump
773,152,927 bytes
```

Restore target: isolated `privatefleet_restore_verify`, created by the
superuser role, restored with `pg_restore --no-owner --no-privileges
--exit-on-error --jobs=4`, then dropped.

Result:

```text
restore_exit=0
restore_seconds=243.5
jobs=940
routes=21565
stops=1109
location_points=31867
evidence=46
policies=2
geometry_stops=1109/1109
RLS tables=24
```

This is a full pre-retirement snapshot, so counts intentionally include the
retired load tenant. Production was not modified.

The encrypted production backup path remains separately gated by the offline
age key; this drill proves the database/geometry restore path, not key custody.

---

## 3. Load benchmark

250 vehicles, 2,530 accepted samples, 20 s measurement:

| Profile | p50 | p95 | p99 | FPS |
|---|---:|---:|---:|---:|
| Standard DPR | 59.1 ms | **123.0 ms** | 137.8 ms | 9.2 |
| 2× DPR | 72.7 ms | **1,538.3 ms** | 1,563.3 ms | 8.3 |

Interpretation:

- standard-DPR marker latency is comfortably inside the 1 s gate
- the 2× DPR profile has a **1.5 s p95**, so the high-DPI interactive gate is
  **not met**
- frame rate remains low in both profiles; this is a marker-animation cost, not
  a route/solver issue

After restoring the intended 1.5x DPR cap above 150 vehicles, repeated benchmark
runs still measured 2× p95 between **1.54 s and 3.80 s**; the test host was
visibly slower across both profiles on the repeat runs (standard p95 varied
123-205 ms). The cap is a real lightweighting measure but is not sufficient.

This remains an open performance defect and must not be presented as a green
high-DPI load result.

Likely areas: 250 promoted DOM pins plus canvas redraw, DPR backing store, and
browser throttling in headless mode. The next step is profiling at 2× DPR with
the React overlay removed from the measurement, not simply relaxing the gate.

---

## 4. Caddy outage and watchdog

During verification, Caddy stopped listening on 443 while the API stayed
healthy on localhost. External web/API returned `000`.

Recovery:

- started `PrivateFleet Caddy` scheduled task
- web/API returned 200
- hardened the task with restart-on-failure (3 attempts, 1-minute interval,
  no execution time limit, start when available)

A `PrivateFleet Health Watch` task now runs every 5 minutes. It checks:

```text
API localhost:4000/healthz
API public https://api.privatefleet.home.arpa/healthz
Web public https://app.privatefleet.home.arpa/
PostgreSQL 127.0.0.1:5432
VROOM 127.0.0.1:3000
OSRM 127.0.0.1:5000
```

If public web/API fails while the local API is healthy, it runs the Caddy task,
waits, rechecks, and logs the outcome.

Controlled recovery test:

```text
before=000
health-watch status=recovered
after=200
```

Log: `C:\PrivateFleet\logs\health-watch.log`.

Limitation: this is local automatic recovery plus a log, not an external
paging/email alert channel. A human still has to read the log or notice the
outage.

---

## 5. Stage A status

| Item | State |
|---|---|
| E2E on current build | Complete |
| Restore drill | Complete |
| Standard-DPR load | Pass |
| 2× DPR load | **Fail, open** |
| Caddy auto-recovery | Complete and tested |
| External alert channel | Not started |
| Physical release install | Not done |
| 120-second rehearsal / operator baseline | Not done |

Next:

1. Investigate and fix the 2× DPR marker latency.
2. Install the signed release on the physical phone.
3. Add an external alert destination.
4. Run the operator baseline and 120-second rehearsal.
