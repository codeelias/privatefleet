# Route State Enrichment (Stage 1) and £10K Readiness

Status: approved scope, documentation-first. No UI, GPS-filtering, camera or
style changes are part of this stage.

## 1. Purpose

Add the missing route-plan state that the map and reporting layers need:
ordered waypoints, router-derived legs, and planner-derived arrival times.
Route **progress** is deliberately excluded; it belongs to a later contract.

## 2. Contract (additive, backward compatible)

```ts
type RouteWaypoint = {
  id: string;                 // stable: routeId:waypoint:<sequence>
  sequence: number;
  kind: "origin" | "job_stop" | "destination";
  jobStopId?: string;
  jobId?: string;
  stopType?: "pickup" | "dropoff";
  location: GeoPoint;
  plannedArrivalAt?: string | null;
};

type RouteLeg = {
  id: string;                 // stable: routeId:leg:<sequence>
  sequence: number;
  fromWaypointId: string;
  toWaypointId: string;
  points: GeoPoint[];         // existing GeoPoint convention, not raw GeoJSON
  distanceM: number;
  estimatedDurationS: number;
};

type RoutePath = {
  vehicleId: string;
  driverId?: string;
  version: number;
  points: GeoPoint[];         // unchanged authoritative full geometry
  waypoints?: RouteWaypoint[];
  legs?: RouteLeg[];
};
```

- Waypoints are optional on the wire so demo fixtures and older consumers keep
  working; PostgreSQL published routes must provide them.
- Steps are **not persisted**. They are used only to assemble leg geometry and
  are discarded; manoeuvre data is a later stage.
- Origin/destination waypoints have synthetic stable IDs. Job-stop waypoints use
  the persisted `route_stops.job_stop_id`.

## 3. Leg construction rules

1. OSRM request: `overview=full&geometries=geojson&steps=true`.
2. OSRM returns one leg per adjacent input coordinate. Do **not** derive legs by
   nearest-point slicing of the full geometry.
3. Assemble each leg from its ordered step geometries, removing only duplicated
   consecutive boundary coordinates.
4. Pair OSRM leg index with the persisted waypoint index:
   `leg[i]` is between `waypoints[i]` and `waypoints[i + 1]`.
5. The coordinate order submitted to OSRM must be exactly the persisted order:
   origin → `route_stops.sequence_no` → destination.
6. Full route geometry remains authoritative and unchanged.

## 4. Persistence

Migration adds to `routes`:

- `waypoints jsonb`
- `legs jsonb`

Publish writes them in the same transaction/version as `geometry` and
`route_stops`. Route re-optimisation creates a new version; legs never cross
versions.

`route_stops.planned_arrival_at` is populated from the planner's absolute
arrival value. If no absolute plan epoch exists, it is written as `NULL` and
reported as unavailable. OSRM duration must never be converted into a planned
arrival.

## 5. Acceptance tests

1. `N` ordered waypoints produce `N-1` adjacent legs.
2. Every leg's `fromWaypointId`/`toWaypointId` match its adjacent waypoints.
3. Every persisted `route_stops` row appears exactly once, in sequence.
4. Consecutive leg geometry meets at the intended waypoint within 2 m
   (OSRM snaps to the road network; exact equality is not required).
5. A loop/revisited-road fixture yields correct leg assignment.
6. A republish creates a new route version and new legs; old legs are not reused.
7. Existing `points` consumers and demo snapshots continue to work.

## 6. Documentation standard

Every increment must include:

- contract and migration in the repo;
- assumptions and rejected alternatives;
- test commands and PASS/FAIL/NOT VERIFIED evidence;
- operational note (rollback, re-run, known limits);
- updated release/deployment notes.

## 7. £10K price assessment

**Current verdict: not yet £10K as an off-the-shelf software licence. It can be
£10K as a supported pilot/implementation package, with conditions.**

What already supports the price:

- real dispatch, optimisation, POD, alerts, reporting and customer tracking;
- tenant isolation and RLS, evidence storage, CSV ingestion;
- deployed LAN stack with backups and restore evidence.

What does not yet justify a £10K product licence:

- native background tracking is not verified on a physical device;
- no HA/PITR, no independent-device restore proof, no monitoring/SLA;
- single-instance rate limiters and no multi-instance story;
- one demo tenant, no billing/subscription, limited field support;
- no quantified customer ROI case yet.

Recommended packaging:

1. **£2.5–5K paid pilot** (6–8 weeks): deployment, data import, training,
   one customer workflow, success metrics.
2. **£10K annual licence** only after: physical-device tracking evidence,
   30-day operational stability, documented RPO/RTO, and a measured dispatcher
   time saving (e.g. hours/week) or failed-delivery reduction.
3. Price on **outcome** (dispatch hours saved, proof-of-delivery disputes
   reduced), not feature count. The map aesthetics are a selling aid, not the
   value itself.

No customer should be told the system is "finished"; the honest claim is
"production pilot with verified dispatch, reporting and customer tracking;
native background tracking pending device verification."
