# ADR-0013 - Routing geometry is engine-produced, validated and versioned

**Status:** accepted (2026-10-28)

## Context
The map must show a road-following route for the selected vehicle. A renderer
can draw anything, including straight lines that look plausible but are not a
legal road path. Demo fixtures exist so the pitch works offline; they must not
be mistaken for a routing engine, and production geometry must never be
invented by the UI.

## Decision
1. **The renderer never invents a route.** MapLibre/Leaflet only display
   geometry that passed validation. Straight-line fallbacks are forbidden.
2. **Demo fixtures are precomputed OSRM road geometry**, clearly labelled as
   demo data, derived from the same assignments the scenario shows, and
   stored in `apps/api/src/modules/demo/route-geometry.ts`.
3. **Production pipeline (Phase 5)** is OSRM-driven and versioned:
   validate state -> OSRM Table (cost matrix) -> VROOM (ordered stops) ->
   OSRM Route reconstruction against that exact order -> validation ->
   immutable route version -> publish.
4. **Optimisation and routing stay separate.** VROOM decides who/when;
   OSRM decides how the roads connect. Optimisation alone never proves the
   drawn geometry is correct.
5. **Three map layers stay distinct:** published planned route, latest
   accepted GPS position, historical (map-matched) trace. A marker is never
   moved along the planned line and presented as live GPS.

## Required route invariants (validation layer)
- Coordinates finite, in range, and ordered `[longitude, latitude]` (RFC 7946).
- Valid GeoJSON `LineString` with at least two positions.
- Route origin matches the vehicle position (demo: <= 150 m; production:
  engine-reported snap distance per waypoint, location-sensitive).
- Ordered stops are visited in the approved sequence; each stop is near its
  own leg, not merely somewhere near the whole route.
- ETA legs agree with route-leg durations plus service/waiting time.
- Geometry, stops, ETAs and assignment share one immutable route version.
- No route / invalid geometry / stale proposal returns a typed error
  (ADR-0011) and the previously published route remains visible.

## Consequences
- Demo and production proofs stay separate: fixtures prove UI + simulator +
  validation wiring; only live OSRM/VROOM tests prove engine integration.
- Demo fixtures must cover every scenario (including Proof of Service), and
  tests must assert scenario consistency after each reset.
- Phase 5 adds live adapters and engine-integration tests; the validation
  layer and layer separation already exist and do not change.

## Rejected alternatives
- **Straight-line geometry between stops:** visually misleading, violates the
  honesty rule; rejected.
- **UI-side routing calls:** couples rendering to network failures and hides
  validation; rejected.
- **VROOM without OSRM reconstruction:** stop order without verified road
  geometry; rejected.
- **Custom road-graph shortest path:** re-implementing Contraction
  Hierarchies is out of scope; delegated to OSRM.
