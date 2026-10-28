# 08 - Domain Model & Events

**Status:** Draft v1 - for approval.
**Related:** [07](07-database-design.md) (schema), [04](04-backend-architecture.md) (where this lives), [09](09-realtime-tracking.md) (delivery).

This document defines the *semantics* of the system: the aggregates, the legal state transitions, the invariants, and the event catalog. It is the single reference for "what may happen, when, and who may cause it".

## 8.1 Aggregates and ownership

| Aggregate | Root | Owns | Key invariants |
|-----------|------|------|----------------|
| Job | `jobs` | `job_stops`, `job_events` | A job's stops are ordered; stop status may never regress silently; cancellation is a dispatcher-only command that force-closes open stops. |
| Route | `routes` | `route_stops` | One active (published/in_progress) route per driver at a time; a job stop belongs to at most one active route; published versions are immutable - changes produce a new version. |
| Driver | `drivers` | membership link, status | A driver must be on shift (available) to be assigned; status transitions are command-driven, not inferred from GPS. |
| Vehicle | `vehicles` | current position (tracking) | A vehicle carries at most one driver's route; positions never regress (sequence ordering). |
| Geofence | `geofences` | `geofence_events` | Entry/exit transitions are stateful (no duplicate entries without an exit). |
| TrackingLink | `customer_tracking_links` | - | Digest-only token storage; expiry and revocation always enforced at read time. |
| OptimizationRun | `optimization_runs` | - | Immutable record of inputs + engine version + result; proposals never mutate live routes. |
| CommandReceipt | `command_receipts` | - | One accepted outcome per (tenant, idempotency key); replays return the stored result. |

## 8.2 State machines

### Job

| Current | Command | Guard | Next | Events |
|---------|---------|-------|------|--------|
| unassigned | `assign` | dispatcher/owner role; driver status = available; stop times satisfiable (impact preview may warn) | assigned | `job.assigned` |
| assigned | `unassign` | dispatcher/owner; not yet in_progress | unassigned | `job.unassigned` |
| assigned | `start` (first stop arrived) | assigned driver only; published route containing the stop | in_progress | `job.started`, `stop.arrived` |
| in_progress | `complete` (all stops completed) | assigned driver; every non-skipped stop completed | completed | `stop.completed`, `job.completed` |
| assigned / in_progress | `cancel` | dispatcher/owner only | cancelled | `job.cancelled` |
| assigned / in_progress | `fail` | exception flow (e.g., undeliverable, force-closed) | failed | `job.failed` |

### JobStop

| Current | Command | Guard | Next | Events |
|---------|---------|-------|------|--------|
| pending | `arrive` | assigned driver; stop belongs to published route | arrived | `stop.arrived` |
| pending / arrived | `complete` | assigned driver; completing from `pending` implies arrival (explicit confirmation required) | completed | `stop.completed`, optional `pod.captured` |
| pending | `skip` | assigned driver + mandatory reason code | skipped | `stop.skipped`, `alert.raised` (exception) |
| pending / arrived | `fail` | exception flow | failed | `stop.failed`, `alert.raised` |

No "reopen" transition: a completed/skipped stop stays recorded; replanning creates a new route version referencing reality, never rewrites history.

### Route

| Current | Command | Guard | Next | Events |
|---------|---------|-------|------|--------|
| draft | `publish` | no conflicting active route for the driver; every stop currently unassigned or in this route (transactional check); version bump | published | `route.published` |
| published | `start` (first stop en route/arrived) | assigned driver | in_progress | `route.in_progress` |
| published / in_progress | `supersede` (new version published) | system-driven via approval | superseded | `route.superseded` |
| in_progress | `complete` (all stops done/skipped) | system-driven | completed | `route.completed` |
| draft / published | `cancel` | dispatcher/owner | cancelled | `route.cancelled` |

### Driver / Vehicle

- Driver: `off_duty -> available -> on_route -> off_duty`; `suspended` reachable from any state by admin (and reversible by admin). Assignment requires `available`.
- Vehicle: `available -> on_route -> available`; `maintenance`/`inactive` set by dispatcher; a vehicle in `maintenance` cannot be assigned.

## 8.3 Invariants (tested, not aspirational)

1. Commands are idempotent per (tenant, idempotency key) - replay returns the stored result ([08.5](#85-idempotency)).
2. A job stop may be part of **at most one active route**; enforced in the publication transaction, not by a simplistic unique index that would block legitimate draft planning.
3. A driver has at most one active route; enforced transactionally at publication.
4. Publication never mutates the published plan a driver is executing - the old version becomes `superseded` only after the new version is validated and stored.
5. Optimistic concurrency: mutations on `jobs`/`routes` require the client's `version`; mismatch -> 409 `JOB_VERSION_CONFLICT` with the current version returned.
6. Events are emitted **only** from committed transactions (outbox) and carry `eventId` + `schemaVersion`.
7. A driver command (arrive/complete/skip) validates against **current** assignment and stop state; stale or cross-assignment commands are rejected with a conflict result ([06.4](06-driver-app-architecture.md)).
8. Status is never inferred from GPS. Position data updates `vehicle_positions_current` only; business state changes only via commands.

## 8.4 Event catalog

All business events travel through the outbox. Payloads are zod-validated against `@privatefleet/contracts/events`; every payload includes `eventId`, `schemaVersion`, `tenantId`, `aggregateType`, `aggregateId`, `occurredAt`.

| Event | Emitted when | Payload highlights | Consumers |
|-------|--------------|--------------------|-----------|
| `job.created` | job accepted | reference, priority, stops summary | web (queue), alerts |
| `job.assigned` / `job.unassigned` | assignment command accepted | jobId, driverId, routeId, ETA deltas | web (map, board), driver app, tracking page |
| `job.started` / `job.completed` / `job.cancelled` / `job.failed` | lifecycle transitions | status, actor, reason | web, tracking page, alerts |
| `stop.arrived` / `stop.completed` / `stop.skipped` / `stop.failed` | stop transitions | stopId, capturedAt/receivedAt, reason code | web, tracking page, alerts |
| `route.published` / `route.superseded` / `route.in_progress` / `route.completed` / `route.cancelled` | route version transitions | routeId, version, driverId, planned metrics | web (board, map), driver app |
| `proposal.ready` | optimization run succeeded | runId, inputHash, metrics, unassigned count | web (optimization screen) |
| `pod.captured` | proof of service stored | stopId, kind, media metadata (no public URL) | web (POD vault), tracking page (completion flag only) |
| `geofence.entered` / `geofence.exited` | validated boundary transition | geofenceId, vehicleId, dwell | alerts |
| `alert.raised` / `alert.resolved` | exception lifecycle | severity, type, related aggregate | web (alert console) |
| `tracking.link.created` / `tracking.link.revoked` | link lifecycle | jobId, expiresAt (never the token) | - (audit) |

**Telemetry (not outbox):** `vehicle.position` - direct socket emission after commit, at-most-once per transport, recoverable via snapshot ([ADR-0008](adr/0008-realtime-outbox.md), [09](09-realtime-tracking.md)).

**Compatibility rules:** consumers must ignore unknown fields (forward-compatible additions only). A breaking change requires a new `schemaVersion` and a documented dual-publish window.

## 8.5 Idempotency

- Client generates a UUID `Idempotency-Key` per user action (not per HTTP retry).
- On command receipt: if `command_receipts` has (tenant, key) -> return the stored `result` (same response, no side effects).
- Otherwise execute in one transaction: state change + event(s) + receipt row. Concurrent duplicates of the same key are resolved by the primary key on (tenant, idempotency_key) - the loser re-reads the receipt.
- Driver offline queue keys are stable across retries ([06.4](06-driver-app-architecture.md)).

## 8.6 Where this lives

State machines are plain TypeScript functions in each module's `service.ts` (`canTransition(state, command, context)` -> allowed transitions), unit-tested exhaustively ([12](12-testing-and-quality.md)). The database CHECK constraints mirror the enum members but never the transition logic - transition law lives in code, in one place per aggregate.



