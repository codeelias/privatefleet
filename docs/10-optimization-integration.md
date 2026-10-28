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

Durable plans + publication implemented (2026-10-28):
- Migration `0004` adds `routes` (geometry persisted at publish),
  `route_stops` and `optimization_runs`, all tenant-scoped and included in
  the RLS policy loop.
- `createProposal` loads the driver's pending pickup/dropoff pairs, runs
  OSRM matrix -> VROOM -> road geometry, stores the run with input hash,
  engine/version and metrics, and reuses a stored run for identical inputs.
- `approveProposal` is one tenant transaction: version check (409
  `ROUTE_VERSION_STALE`), insert the published route + ordered stops,
  supersede the previous published route, link the run and write the
  `route.published` outbox event. Re-approval is idempotent.
- `GET /v1/fleet/state` now returns persisted published routes and the
  authoritative tenant `routeVersion` from the database.
- Endpoints (`POST /v1/optimization/run`, `POST /v1/optimization/:runId/approve`)
  are dispatcher-only; live routing returns typed 503 when OSRM/VROOM are
  not configured, so manual dispatch keeps working.

Evidence: service tests (3) cover persistence/cache, publish -> snapshot
version 2 with route_stops, stale rejection and idempotent re-approval;
API suite 40/40; demo E2E 13/13; auth acceptance 9/9.

Dispatcher UI (2026-10-28): in postgres mode the Route Optimisation screen
calls the live endpoint, renders engine/version/run id, distance and
duration, the solved stop order, unassigned work, and publishes through
the stale-version-checked approval call. Demo mode keeps the seeded
simulated proposal exactly as before.

Acceptance: `apps/e2e/tests-auth/optimization-live.spec.ts` runs the real
UI against the postgres API with a protocol-faithful fake OSRM/VROOM
service (`apps/e2e/support/fake-routing.mjs`), publishes, and verifies
`routeVersion` 2 with one published route. Note for future harness work:
Node 22 `fetch` rejects port 4190 (undici blocked-port list); the fake
service uses 4191.

Remaining: multi-vehicle planning (current live run plans one driver),
real OSRM/VROOM containers as the deployment check, and background
location on the native driver app.



## 10.8 Real-service gate passed (2026-10-28)
The deployment gate ran against real, offline-loaded containers on the
Windows Docker Desktop host: OSRM v5.25.0 (image a16438df8826) and VROOM
v1.13.0 (image ae19c5666266), with the pinned Geofabrik Greater London
extract (sha256 CFD5085...BBD0D) prepared via car.lua/MLD. Through the
production HTTP path: proposal in 146 ms, 6 ordered stops, 0 unassigned,
16,692 m / 2,697 s, 1,465 geometry points; stale approval 409
ROUTE_VERSION_STALE; published version 2; snapshot returned the route;
1 run, 6 route_stops, 1 outbox event. Outage check: 502
VROOM_UNAVAILABLE with the snapshot unchanged.

The gate exposed four adapter defects invisible to fakes, now fixed:
amount/capacity mismatch, non-integer VROOM ids, float matrix entries, and
duplicate matrix locations. Evidence and commands live in [16b - Production
deployment runbook](16-production-deployment-runbook.md) section 9.


## 10.9 Fleet-wide multi-vehicle optimisation (2026-10-28)
`planFleet` builds one VROOM request for all eligible vehicles and pending
shipment pairs (deduplicated matrix locations, integer ids and matrices,
per-vehicle road geometry in the exact solved order). The proposal persists
the full fleet snapshot it solved against (assignments, expected fleet
version, dataset id) in `optimization_runs`, and its input hash includes
assignment state so a changed fleet cannot reuse a stale proposal.

Approval is one tenant transaction against the current fleet version:
verify assignments unchanged (`409 ROUTE_VERSION_STALE` otherwise),
supersede previous published routes for the affected vehicles, insert every
new route + ordered route_stops at one shared version, update job
assignments, link the run through `route_ids`, and emit one
`route.published` event per route. Concurrent approvals collapse to one
publication; a failed insert rolls back every route and event.

Evidence: 5 deterministic fake-service tests (multi-vehicle solve,
unassigned surface, atomic publish, stale + concurrent approvals, rollback,
cache invalidation, tenant isolation); real-service fleet gate (3 vehicles,
12 shipments, 8 matrix locations, 3 routes of 5/5/2 shipments, version 2,
781 ms); preservation gate with VROOM stopped (geometry checksums and route
version unchanged, typed 502, manual assignment 200).

Not yet modelled: capacity/skills constraints and per-stop service durations
(adapter support exists; domain fields do not), and dispatcher UI rendering
of fleet proposals.

## 10.10 Dispatcher fleet UI (2026-10-28)
Postgres-mode Optimization screen consumes the fleet proposal contract directly:
per-vehicle route panels with ordered stops and explicit unit types, per-route
and fleet totals, solver-provided absolute arrivals only, an unassigned panel
with structured reasons, and one atomic approval. Stale approvals (409) are
explained without retrying; failures keep the previously published plan; a
successful approval invalidates the authoritative fleet query so the map and
board re-render persisted routes. Demo mode remains fixture-driven and
unchanged.
