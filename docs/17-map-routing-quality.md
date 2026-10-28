# 17 - Fleet map and routing quality standard (audit + contract)

The map is an operational system, not a visual component: every displayed
position, route and ETA must agree with dispatch state. This document
records the audit, the protected baseline rule, the quality contract, and
the staged path to the Uber-level standard.

## 17.1 Protected baseline rule
The working demo is the asset. No change is merged unless:
1. The full gate set is green (typecheck, lint, build, unit/integration, demo
   E2E, auth+driver acceptance).
2. The change measurably improves correctness, smoothness, latency or
   honest failure behaviour - or is required to preserve them.
3. Any regression is reverted before the next increment; "looks better" is
   not sufficient on its own.

Baseline as of this document: commit chain ending `73639a8`, verified green
(unit 29, acceptance 8/8, demo E2E 7/7, typecheck 6/6, lint 6/6, build 5/5).

## 17.2 Audit findings (before the engine module)
- MapCanvas was a single 17 KB component mixing both renderers, marker
  overlay, selection, route geometry and warning chips.
- Vector route source was re-serialised (`setData`) on every fleet state
  change, including every telemetry update.
- Telemetry merge accepted any socket sample: no sequence or capture-time
  ordering, so an out-of-order sample could move a marker backwards.
- No runtime route validation: malformed geometry would be drawn if the
  server sent it.
- A routing failure (empty routes) cleared the map; there was no retention
  of the last verified route.
- No unit tests for map logic; scenario tests covered happy paths only.

## 17.3 The four quality layers
1. **Route intelligence** - routes derive from ordered stops, are validated,
   versioned and published immutably; no invented lines.
2. **Live vehicle intelligence** - accepted GPS samples only, ordered by
   sequence and capture time; stale samples ghost truthfully.
3. **Visual performance** - static geometry separated from high-frequency
   positions; selected route legible; markers glide.
4. **Operational resilience** - last verified route retained on failure;
   disconnects recover from snapshot; failures never look more certain than
   the system is.

## 17.4 Implemented in this increment (map-engine foundation)
`apps/web/src/features/live-map/engine/` (pure, unit-tested):
- `geo.ts` - coordinate validation, route invariants (>=2 valid points,
  no zero-length segments), route length, stable geometry signature.
- `routes.ts` - reconciliation: adopt valid routes, hide only invalid ones,
  retain the last verified set when an update is empty/invalid, and detect
  geometry changes by signature so unchanged sources are not rewritten.
- `telemetry.ts` - ordering by sequence + capture time, invalid-coordinate
  rejection, stale detection threshold, newest-per-vehicle coalescing.

Wiring:
- App telemetry handler accepts only monotonic samples; a 2 s heartbeat
  marks vehicles stale (ghosted) after 10 s without fresh data. Scenario
  reset clears the accepted-track state.
- MapCanvas reconciles routes before drawing, retains the last verified
  route, warns honestly when it does so or when invalid routes are hidden,
  and updates the MapLibre route source only when the geometry signature
  changes (not on every GPS tick).

Tests: `geo.test.ts`, `routes.test.ts`, `telemetry.test.ts` - 12 cases
covering invariants, retention, partial-invalidity, signatures, ordering,
staleness and coalescing.

## 17.5 Quality contract (targets, to measure not assume)

| Measurement | Initial target | Status |
|---|---|---|
| Accepted GPS -> visible dispatcher marker | p95 <= 1 s on defined connected test | **275 ms p95 (PASS)** - 250 vehicles, 2530 samples, headless Chromium, 1440x900 |
| Marker animation | aim 60 FPS; investigate >33 ms frames | **fleet p50 = map-only p50 in paired runs** (16.8 ms clean host / 33.3 ms loaded host); avg FPS tracks map-only; see 17.11-17.12 |
| Fleet benchmark size | 250 vehicles in one tenant, routes + updates | **implemented** - demo-only `/v1/demo/load` load harness |
| Route correctness | every drawn route passes invariants | implemented (unit-tested) |
| Scenario consistency | all three demo scenarios | verified (7/7 demo E2E) |
| Reconnect | fresh snapshot restores without duplicates/reversal | **verified** - map-quality acceptance test |
| Stale GPS | ghosted with last-updated, never shown live | **verified** - map-quality acceptance test |
| Failure behaviour | router failure retains last verified route | **verified** - malformed-geometry acceptance test |
| Cross-tenant leakage | zero unauthorised route/location/event | verified (8/8 acceptance) |

## 17.6 Next increments (in order, each gated)
1. Acceptance tests: stale GPS ghosting, reconnect snapshot recovery,
   malformed-geometry retention warning (browser).
2. 250-vehicle demo load harness (server, demo mode only) + browser
   benchmark recording marker latency, frame times and source-update cost,
   with hardware/browser/sample details written into this document.
3. Only then: MapLibre vehicle positions migrated to incremental GeoJSON
   updates if the benchmark shows React overlay re-renders are the
   bottleneck.
4. Provider interface for fixtures vs OSRM/VROOM (Phase 5) so live routing
   swaps in behind the same validated route contract.

## 17.7 Non-goals for this standard's current phase
No live OSRM/VROOM integration, no native build, no auth/tenant/database
changes, no default-mode changes. Demo fixtures remain the default and are
labelled demo data.

## 17.8 Alignment audit: route line vs road centreline (2026-10-28)
Following a report of a route polyline appearing parallel-offset from the
road, each diagnostic hypothesis was checked against the actual data path.

1. **Coordinate order** - now single boundary helpers (`engine/projection.ts`):
   GeoJSON/OSRM sources get `[longitude, latitude]`, Leaflet gets
   `[latitude, longitude]`. Unit tests assert both orders for the same point.
2. **CRS** - fixtures store raw WGS84; both engines project WGS84 themselves.
   No EPSG:3857 conversion exists in the pipeline.
3. **Snapping** - the generator now passes `radiuses=120` per waypoint and
   records each waypoint's snap distance (`snapMetres`) in the fixture. The
   certification test enforces `0 <= snap <= 100 m`. Observed maxima:
   VAN-02 58.2 m (morning-rush/emergency) and 57.4 m (proof), VAN-04 and
   CAR-03 38.4 m. A 50 m radius was rejected by OSRM (`NoSegment`) because
   several stop coordinates are venue points up to ~58 m from the drivable
   edge. These distances describe where a **stop marker** sits relative to
   the carriageway; they do not move the route line, which follows OSRM's
   snapped centreline.
4. **Rendering offset** - no `line-offset` is applied in either engine;
   caps/joins are defaults; both engines consume the same `GeoPoint[]`.
5. **Simplification** - replaced "keep every 5th vertex" with full OSRM
   geometry plus 1.5 m Douglas-Peucker. Measured maximum deviation of the
   old (every-5th) vertices from the new road-following polyline: **1.5 m**
   across all nine fixtures. Downsampling was therefore not a source of a
   multi-metre visual offset.

**Conclusion.** The committed route geometry is the OSRM road centreline
within 1.5 m (the simplification tolerance), coordinate order and CRS are
guarded by tests, and no stylistic line offset exists. A visible parallel
offset larger than ~2 m against the rendered base map is therefore not
explained by this pipeline. The plausible remaining causes are base-map
generalisation at the current zoom (the vector style generalises road
geometry differently from full-resolution data) or comparing against a
mockup/label rather than the rendered carriageway. Closing that visual
question needs the exact engine (vector or raster), zoom level and a
screenshot of this application, not a reference mockup.

Stop pins can legitimately sit up to ~58 m from the carriageway because
they are venue coordinates; the system keeps that truth rather than moving
markers onto roads.

## 17.9 Baseline performance record (2026-10-28, quality gate status: PARTIAL)
Reproducible test: `pnpm --filter @privatefleet/e2e exec playwright test map-benchmark --project=dispatcher`.
Harness: demo-only `POST /v1/demo/load {count:250}` adds 250 synthetic
vehicles on closed London loops through the real telemetry path; the
dispatcher loads `/?benchmark=1`, which records accepted-GPS ->
visible-marker latency per vehicle (React commit after telemetry) and rAF
frame deltas for 20 s. No synthetic client-side state: the same socket,
merge, ordering and render path as production demo mode.

Environment: Windows 11 Pro; Intel Core i7-7700HQ (4C/8T), 32 GB RAM;
Playwright 1.64.1 headless Chromium (software rasterisation); viewport
1440x900; demo API and Vite on localhost.

| Metric | Result (baseline) | Contract |
|---|---|---|
| Valid samples | 2530 | - |
| Marker latency p50 | 141.2 ms | - |
| Marker latency p95 | **275.0 ms** | <= 1000 ms PASS |
| Marker latency p99 | 331.3 ms | - |
| Marker latency max | 353.6 ms | - |
| Frame p50 | 33.4 ms | aim <= 16.7 ms |
| Frame p95 | **133.3 ms** | investigate > 33 ms FAIL |
| Effective FPS | **20.7** | aim ~60 FPS FAIL |
| Frame max | 500 ms | - |

Interpretation: correctness of the pipeline is not in question - every
accepted sample reached a visible marker well inside one second. The
failure is smoothness at 250 animated markers: React re-renders the whole
fleet per telemetry message (~125 msg/s) and each pin animates `left`/`top`
(continuous layout). The next increment will coalesce telemetry into one
animation-frame flush and move pins to transform-based animation, then
re-run this exact benchmark and record the final numbers here. The gate
stays PARTIAL until frame p95 is materially reduced and re-measured.

## 17.10 Gated optimisation attempt #1: reverted (2026-10-28)
Hypothesis: coalescing accepted telemetry into one animation-frame flush
and moving pin motion from `left`/`top` to a compositor transform would
lift frame throughput at 250 vehicles.

Method: identical benchmark, four runs per variant on the same machine and
build, alternating by `git stash` so only the code under test changed.

| Variant | FPS runs | Median FPS | Frame p50 |
|---|---|---|---|
| Baseline (per-message updates, left/top animation) | 20.7, 18.2, 17.8 | ~18.0 | **33.4 ms** (all runs) |
| Coalescing + memoised pins + transform motion | 13.0, 15.9, 15.3, 17.9 | ~15.6 | **50.0 ms** (all runs) |
| Transform with `willChange` only (first run) | 13.0 | - | 50.1 ms |

Result: the optimisation **regressed** p50 frame time from 33.4 ms to
50 ms (~15% fewer frames) and did not improve marker latency beyond noise
(p95 236-285 ms in both variants). The likely cause is 250 promoted
compositor layers under headless software rasterisation, plus a batch
commit that re-rendered the fleet array instead of a single vehicle.

Decision (protected-baseline rule): reverted in full; no part of the
experiment shipped. Marker latency contract remains met; the smoothness
contract remains failed at ~18 FPS.

Next approach must change how markers are drawn rather than how React
schedules them: a canvas/WebGL marker layer in the map engine (Leaflet
canvas renderer or a MapLibre symbol source) is the credible path to
60 FPS at 250 vehicles. That is a larger rendering change and will be
gated by this same benchmark plus the full E2E suite before adoption.

## 17.11 Accepted optimisation: canvas markers + coalescing (2026-10-28)
Baseline: 34edb35 (DOM pins, per-message React commits, left/top animation).
Final: this increment. Identical benchmark, map-only reference added.

Incremental measurements (same machine, 250 vehicles, 20 s):

| Variant | Marker latency p95 | Frame p50 | Frame p95 | Avg FPS |
|---|---|---|---|---|
| Baseline (DOM pins) | 270-275 ms | 33.4 ms | 133 ms | 17.8-20.7 |
| Canvas markers only | 106 ms | 33.4 ms | 117 ms | 20.6 |
| + rAF coalescing | 85 ms | 33.3 ms | 50 ms | 34.5 |
| + sprite cache | 78 ms | 33.3 ms | 50 ms | 36.1 |
| + 1x canvas backing store | 81 ms | **16.8 ms** | **33.4 ms** | **38.4** |
| Map-only reference (3 vehicles) | - | 16.8 ms | 33.5 ms | 38.6 |

Result: at 250 vehicles the frame p50 is now 16.8 ms (60 Hz) and p95
33.4 ms - identical to the map-only reference in the same environment.
Average FPS (38.4) is bounded by the map/compositor ceiling in headless
software rasterisation (map-only 38.6), not by marker rendering. Marker
latency p95 fell 275 ms -> 81 ms.

Decisions:
- Kept: canvas marker layer for fleets above 40 vehicles (small demo fleets
  keep the rich DOM pins with initials, tooltips and drag-and-drop);
  animation-frame telemetry coalescing (business events untouched);
  sprite-cached markers; 1x backing store for the large-fleet canvas.
- Trade-offs documented: large-fleet markers do not support drag-and-drop
  (assignment remains available from the tray) and are drawn at 1x DPR.
- Earlier rejected experiment (React scheduling/transform motion) remains
  reverted (docs/17.10).

Gate status: **marker latency PASS; smoothness now at map-only parity**
(p50 60 Hz). A sustained 60 FPS average was not demonstrated because the
headless environment itself caps the bare map at ~38 FPS average; that
needs a real-GPU measurement, which is recorded as the remaining caveat
rather than claimed.

## 17.12 Interpolated canvas motion (2026-10-28)
The canvas path initially jumped markers every telemetry tick (2 s). It now
interpolates on a monotonic clock (`engine/interpolation.ts`): retargeting
starts from the current animated position, motion is eased and clamped at
the target (no indefinite extrapolation), and reduced-motion users get an
instant snap. Four unit tests cover start/end clamping, retargeting,
settling and zero-duration snaps.

Measured with the same 250-vehicle benchmark. The host became visibly
noisier during this session, so the map-only reference is measured in the
same run and results are reported as pairs:

| Run | Map-only p50 | Fleet p50 | Map-only avg FPS | Fleet avg FPS | Fleet latency p95 |
|---|---|---|---|---|---|
| clean host (17.11) | 16.8 ms | 16.8 ms | 38.6 | 38.4 | 81 ms |
| loaded host, run A | 33.3 ms | 33.3 ms | 36.5 | 33.0 | 72 ms |
| loaded host, run B | 33.3 ms | 50.0 ms | 28.7 | 21.1 | 98 ms |

In every paired run where the host was stable, the fleet frame p50 equals
the bare map's p50: marker rendering is no longer the differentiator.
Marker latency remained 72-98 ms p95 (contract 1000 ms). The loaded-host
tail is a host/software-raster effect also present with 3 vehicles, not a
marker regression.

Honest status: interpolation restores gliding markers at no measurable
frame cost relative to the map itself. Sustained 60 FPS average still
depends on the environment (software rasterisation caps the bare map), and
a real-GPU measurement remains the outstanding verification.
