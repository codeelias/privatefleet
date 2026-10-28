# 10 - Optimization Integration (OSRM + VROOM)

**Status:** Draft v1 - for approval.
**Related:** [07](07-database-design.md) (`optimization_runs`), [08](08-domain-model-and-events.md) (route publication), [14](14-roadmap-and-gates.md) (Phase 5; deterministic seeds in Phase 1).

## 10.1 Component responsibilities

| Component | Responsibility |
|-----------|----------------|
| MapLibre GL JS | Render map and route geometry. Supplies no routing itself. |
| PostGIS | Spatial queries, geofences, distance filters, location indexes. |
| OSRM | Road-network travel times/distances (matrix), route geometry, map matching. |
| VROOM | Vehicle assignment, stop sequencing, constraints (time windows, capacity, skills, pickup/delivery pairs). |
| PostgreSQL | Store candidate plans, approved versions, execution data, solver metrics. |

VROOM is a constraint solver - **not an AI model**. The product never labels it AI ([01.6](01-vision-and-principles.md)).

## 10.2 Workflow

1. Dispatcher clicks **Optimize** (route date / driver set / job set).
2. API gathers eligible stops, drivers, vehicles, shift windows, current assignments.
3. OSRM supplies the travel-time matrix (and route geometry for chosen plans).
4. The API adapter maps the business model to VROOM input (see below).
5. VROOM solves; the API validates and stores the result in `optimization_runs` (status `succeeded`/`failed`).
6. UI shows the **proposal**: baseline vs proposed, stop-order diffs, arrival-time changes, violated constraints, unassigned/infeasible work, and why the plan differs.
7. Dispatcher **approves** (or edits and re-optimizes).
8. Approval transaction: validate no conflicting active assignments -> publish new route version (old version -> `superseded`) -> record events -> notify affected drivers.
9. Execution proceeds on the published plan; the driver's live progress feeds ETAs back into the board.

## 10.3 Business -> VROOM mapping

- A job with pickup+dropoff becomes a **shipment** (paired pickup/delivery with the same vehicle) - never two unrelated jobs; precedence and pairing are solver constraints.
- `vehicles`: capacity_units, `required_capabilities` -> VROOM skills, shift windows, start/end (depot).
- `job_stops.window_start/end` -> time windows; `service_seconds` -> service durations.
- Objective (initial): minimize estimated travel time while satisfying all hard constraints; soft penalties for late arrivals, unnecessary reassignment, and workload imbalance come later, weighted explicitly and shown in the UI.
- A technically shortest route that misses a critical appointment is a failure - feasibility and windows outrank raw distance.

## 10.4 Determinism, caching, and honesty

- `input_hash` = deterministic hash of normalized inputs (stops, vehicles, windows, engine version). Identical inputs reuse the stored run (cache hit) instead of re-solving.
- `optimization_runs` records engine + version + inputs + result + metrics - every claim on screen is traceable to a stored run.
- The demo's "Saved X minutes" banners use **seeded, pre-computed, labelled-as-simulated** results unless live OSRM/VROOM containers are configured ([14](14-roadmap-and-gates.md), [ADR-0007](adr/0007-demo-strategy.md)). Fabricated savings presented as verified business results are forbidden ([01.4](01-vision-and-principles.md)).
- Road-network-based estimates are labelled as such; no live-traffic claims until a traffic source exists.

## 10.5 Degradation

- OSRM or VROOM unreachable -> the Optimize action fails with a typed, retryable error and a clear message; everything else keeps working (optimization is an enhancement to manual dispatch, not a dependency of it).
- Infeasible solve -> proposal surfaces the unassigned/infeasible work rather than silently dropping it.

## 10.6 Deployment

- OSRM and VROOM run as separate containers (independent CPU/memory profiles) per [15](15-infrastructure-and-deployment.md): `osrm/osrm-backend` with a prepared extract (e.g., GB), `vroomvrp/vroom-docker` for the solver.
- OSRM extract updates are an operational task (scheduled refresh), not an app concern.




## 10.7 Phase 5 implementation status (2026-10-28)
Provider layer implemented (`apps/api/src/modules/routing/`):
- `OsrmClient`: `/table` matrix (duration+distance, dimension and
  finiteness validated) and `/route` full GeoJSON geometry; typed errors
  for unreachable or malformed responses.
- `VroomClient`: matrix-mode shipments (paired pickup/delivery), typed
  rejection of non-zero solver codes, ordered pickup/delivery ids per
  vehicle, unassigned work surfaced rather than dropped.
- `planShipments`: OSRM matrix -> VROOM solve -> OSRM geometry for the
  exact solved order -> geometry invariant checks (finite coordinates,
  starts at the depot).
- `createRoutingClients`: live providers exist only when both
  `OSRM_BASE_URL` and `VROOM_BASE_URL` are configured; config rejects a
  half-configured pair.
- `src/db/routing-smoke.ts`: manual smoke against a real OSRM server.

Evidence:
- Fake-service tests (`plan.test.ts`, `factory.test.ts`, 6 cases):
  validated plan, infeasible/unassigned surface, malformed geometry
  rejection, OSRM and VROOM unreachable typed errors, factory rules.
- Live OSRM smoke: 3x3 matrix, 524-point geometry, 5.18 km / 857 s for a
  known London request. VROOM runs only via a protocol-faithful fake in
  this environment (no Docker installed); a real container run remains
  the deployment check.

Next: durable `optimization_runs` + tenant route persistence, proposal
preview/publish endpoints with the existing 409 stale-version rejection,
and dispatcher UI wiring. Demo fixtures stay the default offline path.
