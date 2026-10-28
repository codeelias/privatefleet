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
| Accepted GPS -> visible dispatcher marker | p95 <= 1 s on defined connected test | pending benchmark |
| Marker animation | aim 60 FPS; investigate >33 ms frames | pending benchmark |
| Fleet benchmark size | 250 vehicles in one tenant, routes + updates | pending harness |
| Route correctness | every drawn route passes invariants | implemented (unit-tested) |
| Scenario consistency | all three demo scenarios | verified (7/7 demo E2E) |
| Reconnect | fresh snapshot restores without duplicates/reversal | acceptance test next |
| Stale GPS | ghosted with last-updated, never shown live | implemented; test next |
| Failure behaviour | router failure retains last verified route | implemented; test next |
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
