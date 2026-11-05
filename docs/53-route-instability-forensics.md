# 53 - Route instability incident: forensics and fix strategy

Date: 2026-11-05
Status: implemented and deployed (Phases 0,1,2,4.1,5; Phase 3 counter sites; web feed parity)
Deployed: 2026-11-05 ~17:50 UTC. Live-verified: driver feed serves v123 (60 stops, all completed), v121 superseded, cross-driver stops excluded, J-191/J-202 reconciled, queue shows only B06-001 (badged), route.selected log observed (routeId 64167dfc, version 123, completed).
Scope: why completed stops reappeared as pending, why the plan looked
re-planned, why versions vanished, and why stops outside the geofence
appeared - without any dispatcher action.

## Executive summary

The database did not lose any work. The driver app was served a **five-day-old
route (v121, 2026-11-01, 30 stops) instead of the current one (v123, 60 stops)**
because v123 reached `completed` at 14:22:16 UTC today (the driver's own final
stop) and the "active route" query then fell back to v121 - the only route of
Tom's still marked `in_progress`.

v121 contains different jobs at the same sequence numbers (its seq 2 P, 3 D,
6 D, 8 D are pending), four pending stops belong to **another driver's jobs**
(B04-005, B05-002 - Sarah Reed), and those sit outside the only geofence. That
single mechanism explains every reported symptom.

Root enabler: **supersede only targets routes in status `published`, so a route
that reached `in_progress` is never superseded and becomes immortal.**

## Evidence timeline (UTC)

| Time | Evidence | Meaning |
|---|---|---|
| 2026-11-01 14:42:29 | route v121 published (`in_progress` ever since) | stale plan created |
| 2026-11-02 18:43:59 | v122 published (Tom) | v121 not superseded |
| 2026-11-03 06:46:46 | v123 published (60 stops) | v121 not superseded |
| 2026-11-04 14:07 → 23:13 | 58 x job.arrived/completed (Tom, v123) | normal work |
| 2026-11-05 14:13:26 | v123 seq 59 completed | - |
| 2026-11-05 14:22:16.820875 | v123 seq 60 completed + `route.completed` (same tx) | v123 closes |
| after 14:22:16 | only `in_progress` route for Tom = v121 | resolver serves v121 |

No `optimization_runs` row after 2026-11-03 06:46:39. No `route.published`
in the last 48 h. No `job_events` with `actor_type='system'` in the tenant's
history (232 rows, all `user`). No route row created after 11-03 06:46:46.

## Confirmed root causes (ranked)

### C1 - Immortal `in_progress` route + max-version selection (primary)

- `apps/api/src/modules/optimization/service.ts:353-356` and
  `fleet-service.ts:826-830` supersede **only `status='published'`** routes.
  A route that already reached `in_progress` is skipped forever.
- `apps/api/src/modules/driver/routes.ts:100-110` (and `pg-service.ts:236-244`,
  `388-413`) select `status IN ('published','in_progress') ORDER BY version DESC
  LIMIT 1`. Once the newest route completes, an older `in_progress` route wins.
- Result: Tom was served v121 (30 stops, 5 pending, 4 stops belonging to Sarah).

### C2 - `closeRoute` resets stop statuses to pending (secondary, live residue)

- `apps/api/src/modules/optimization/route-close.ts:59-69` sets
  `status='pending'` for every non-terminal stop of the closed route without
  checking the job's status; `arrived_at` is left behind.
- Live residue: J-191 dropoff and J-202 pickup are `pending` while their jobs
  are `completed` (from `route.closed` 2026-11-01 13:56:23). The queue keeps
  offering them.

### C3 - Version counter can collapse (latent, high severity)

- `fleet-service.ts:163-167` and `793-797` compute the next version from
  routes that are both `status IN ('published','in_progress')` and at the
  current tenant max version. If the max version is terminal, the aggregate is
  empty and `nextVersion` becomes 2 - resurrecting old numbering.
- No unique index on `(tenant_id, vehicle_id, version)` exists.

### C4 - Route lifecycle is version-agnostic (latent)

- `pg-service.ts:1114-1165` updates **every** route containing the completed
  stop, not the driver's active route. One completion can mark a five-day-old
  route `in_progress`/`completed`; when Sarah finishes the leaked stops, Tom
  has no active route and `route-geometry` returns an empty payload.

### C5 - Cross-driver leakage in the driver map feed (data defect)

- `driver/routes.ts:115-137` returns route stops without checking
  `jobs.assigned_driver_id = :driverId`, so a stale route can serve another
  driver's work (4 stops today).

## Ruled out (with evidence)

- **Scheduled/automatic re-optimisation**: no `optimization_runs` after
  11-03 06:46:39; no scheduler in `apps/api/src` (only the demo GPS simulator,
  and `demoMode=false` in production); host scheduled tasks are API, Caddy,
  backup, cloud-backup, health-watch and Tailscale helpers only.
- **Automatic assignment**: all 7 `job.assigned` events are owner actions
  (last 2026-11-03 06:40); zero system events.
- **Publish resetting statuses**: publishing inserts `routes`/`route_stops`
  only and never touches `job_stops` (`service.ts:336-372`,
  `fleet-service.ts:843-867`).
- **Web app**: every mutating call is behind a click (`Board.tsx` has no API
  surface; no mutation in effects/intervals/sockets); a closed browser writes
  nothing.
- **Android app**: only driver-scoped reads and its own commands; no endpoint
  it can call creates work or publishes routes.
- **Seed/demo regeneration**: tenant created 2026-10-29, untouched; stop
  completion history intact (115 completed rows all with `completed_at`).

## Implementation strategy

Order matters: stop the bleeding, then repair data, then harden reads, then
add observability. Each step is independently releasable and testable.

### Phase 0 - Safety rails (before any behaviour change)

0.1 Add DB indexes (additive, reversible):
    - unique `(tenant_id, vehicle_id, version)` on `routes`.
    - index `routes (driver_id, status, version desc)`.

0.2 Add an invariant test that fails if any driver has more than one route in
    `('published','in_progress')` - run against a seeded fixture.

### Phase 1 - One active route per driver (fixes C1)

1.1 Supersede is status-agnostic and driver-complete:
    - In `service.ts` and `fleet-service.ts`, supersede **all** earlier
      versions for the affected driver/vehicle with
      `AND status IN ('published','in_progress') AND version < :newVersion`.
1.2 Driver reads choose the newest publish, not the newest still-open route:
    - `driver/routes.ts` and `pg-service.ts` route selection becomes
      `ORDER BY version DESC` over **all** non-draft routes for the driver,
      then assert the selected route is the latest publish; otherwise return
      an explicit `409 ROUTE_STALE`/`503` instead of silently serving old data.
1.3 Backfill: supersede Tom v121, Mo v121 (and any other `in_progress` route
    that is not the driver's latest) as part of the migration.
Acceptance: after deploy, `SELECT driver_id, count(*) FROM routes WHERE
status IN ('published','in_progress') GROUP BY 1` has no driver with >1 row;
`/v1/driver/route-geometry` returns v123-equivalent data for Tom and refuses
rather than falling back.

### Phase 2 - Stop-status integrity (fixes C2)

2.1 `closeRoute` must not reset stops whose job is
    `completed`/`cancelled`, and must clear `arrived_at` (or emit a
    `stop.reset` event) when it does reset.
2.2 Repair the 2 live rows (J-191 dropoff, J-202 pickup): reconcile them to
    `completed` with an audited event, not a silent UPDATE.
2.3 Add a constraint/check job (daily) that reports any
    `status='pending' AND arrived_at IS NOT NULL` or
    `completed_at IS NOT NULL AND status<>'completed'` row.

### Phase 3 - Lifecycle scoping (fixes C4) and version counter (C3)

3.1 `advanceRouteLifecycle` operates on the driver's **active** route only
    (resolve it once, pass `routeId`), never "every route containing the stop".
3.2 Version allocation: `SELECT coalesce(max(version),1)+1 FROM routes
    WHERE tenant_id = $1` (no status/version subquery), plus the unique index
    from Phase 0. Reject `nextVersion <= max(version)` server-side.

### Phase 4 - Feed hygiene (fixes C5)

4.1 `route-geometry` joins `jobs` and filters/marks stops by
    `assigned_driver_id = :driverId`. Leaked stops must never render on a
    driver's map.
4.2 Map/list consistency: document and enforce one source of truth -
    the route plan for map, the assignment queue for list - and make the list
    show a "not on today's plan" badge for stops outside the published route
    (3 such stops exist today: B06-001, J-191, J-202).

### Phase 5 - Observability (make recurrence provable)

5.1 Log at driver route selection: `route.selected routeId version status
    driverId requireRole` and `route.stale_served` when a fallback would be
    needed.
5.2 Emit `route.superseded` and `route.closed` metric counters.
5.3 Health endpoint `/readyz` reports active routes per driver (count) and
    flags >1.

## Test plan (must be green before deploy)

- Unit: route selection picks latest publish; refuses stale fallback.
- Unit: supersede covers `published` and `in_progress`, scoped per driver.
- Unit: closeRoute leaves completed jobs untouched; clears `arrived_at`.
- Integration (existing gates): publish -> complete all stops -> next read
  returns empty/409, never an older plan; two publishes never leave two
  active routes.
- E2E (Playwright): approve -> device map shows the new plan only.
- Data repair verification: the 2 residue rows reconciled, no
  `pending + arrived_at` rows remain.

## Rollback

Each phase is a separate commit; the schema changes are additive (indexes).
Behaviour changes (Phases 1, 3) are guarded by the selection/refusal path, so
reverting the release restores prior behaviour without data loss.

## Out of scope for this fix

- Cross-driver job reassignment policy (why B04-005/B05-002 are still on
  Tom's old route) - needs a dispatch-policy decision, not a code fix.
- Demo/seed data cleanup beyond the 2 residue rows.

## Addendum - round 2 corrections (2026-11-05)

Round-2 re-verification confirmed F1-F5 with refinements and made one
important correction:

1. **Device colour rendering: the earlier "renders only blue pin fills"
   conclusion was WRONG - it was a measurement artifact.** The device
   colour-shifts pin fills: green renders at RGB(76,160,84), orange at
   RGB(233,162,59), both outside the tight tolerance probes used earlier.
   A corrected pixel census finds 5 green + 1 orange + 3 blue pins in
   map-shot-2 and an orange pin in map-shot-1, all with white glyphs/rings.
   The pin colour language has been functioning on this device; the
   "completed looks blue" reports were caused by the v121-vs-v123 route
   selection bug, not the GPU.
2. v121 pending stops refined to 7 (4 Sarah, 1 Tom, 2 Mo); 3 of Sarah's 4
   are outside the geofence, 1 inside.
3. Three version-counter sites share the collapse risk: service.ts:307,
   fleet-service.ts:163/793; plus fleet stats at fleet-service.ts:506.
4. Android: map-screen notes (evidence_note) have no CommandQueue dispatch
   branch - silently dropped (Phase 5).
5. The production host has no git repository; deploys are file copies. The
   fix lives only in the local workspace and is NOT deployed.
6. No database changes since 2026-11-05 15:00 UTC (telemetry only).
