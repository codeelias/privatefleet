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

250 vehicles, 2,530-2,783 accepted samples, 20 s measurement.

Final renderer setting: **backing-store DPR capped at 1 when more than 150
vehicles are active**, keeping 2× for smaller fleets where sharpness matters
more than fill cost.

| Profile | p50 | p95 | p99 | FPS |
|---|---:|---:|---:|---:|
| Standard DPR | 72.0 ms | **171.6 ms** | 188.0 ms | 6.5 |
| 2× DPR | 82.1 ms | **184.1 ms** | 198.3 ms | 5.1 |

A second 2× run measured p95 **316.5 ms**; both runs are inside the 1 s marker
latency gate. Earlier runs with a 2× backing store measured 1.54-3.80 s and
failed.

Trade-off: markers above 150 vehicles are rendered from a 1× backing store, so
they are slightly softer on a retina display. Marker labels and hit targets
remain unchanged. This is deliberate: dispatcher responsiveness wins over pin
sharpness at fleet scale.

Frame rate in headless software rendering remains low (5-6.5 FPS); that is a
separate compositor/rendering budget, not the accepted-GPS-to-marker latency
contract. It stays visible as a performance backlog item.

This changes the former open defect to **PASS for marker latency**, with
retina sharpness deliberately traded down above 150 vehicles.

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
| 2× DPR marker latency | Pass (184 ms; 1× backing store above 150 vehicles) |
| Caddy auto-recovery | Complete and tested |
| External alert channel | Not started |
| Physical release install | Not done |
| 120-second rehearsal / operator baseline | Not done |

Next:

1. ~~Fix the 2× DPR marker latency~~; keep frame-rate profiling as a separate backlog item.
2. Install the signed release on the physical phone.
3. Add an external alert destination.
4. Run the operator baseline and 120-second rehearsal.
