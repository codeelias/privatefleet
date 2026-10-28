# 09 - Real-Time Tracking

**Status:** Draft v1 - for approval.
**Decisions:** [ADR-0008](adr/0008-realtime-outbox.md).
**Related:** [07](07-database-design.md) (tables), [08](08-domain-model-and-events.md) (events), [04](04-backend-architecture.md) (lib/realtime).

## 9.1 The golden rules

1. **PostgreSQL is the source of truth; Socket.IO is the notification transport.** A socket frame is never treated as durable state.
2. **Ingestion is authenticated HTTP with a device-side queue.** (A successful HTTP request still only counts after the DB commit.)
3. **Ordering and idempotency:** stable `device_session_id` + monotonically increasing `sequence_no`; duplicates rejected; late points can never roll a current position backwards.
4. **Persist, then publish:** history insert, current-position advance, geofence evaluation, and business-event outbox writes commit in one transaction.
5. **Two transport classes:**
   - *Business events* -> transactional outbox -> at-least-once delivery -> consumers dedupe by `eventId`.
   - *Telemetry* (`vehicle.position`) -> direct socket emission after commit -> best-effort, loss tolerable -> recovery via snapshot fetch.
   Rationale: routing every 5-second GPS ping through the outbox adds latency and table churn without improving correctness; business state changes must never be lost.
6. **Reconnect = snapshot, then live.** A client that reconnects fetches `GET /v1/fleet/state`, then resumes the socket stream.

## 9.2 Ingestion flow (driver device -> API)

1. Device queues pings locally (expo-sqlite) when offline.
2. `POST /v1/tracking/positions` (authenticated, rate-limited) with `{ deviceSessionId, sequenceNo, location, accuracyM, capturedAt }`.
3. Validation: driver on shift; device session matches the assigned vehicle's session; `sequenceNo` monotonic; `capturedAt` within tolerance (no future timestamps); coordinates sane.
4. One transaction:
   - `INSERT INTO location_points ...` (UNIQUE rejects duplicates).
   - Advance `vehicle_positions_current` **only if** `sequence_no` is newer.
   - Evaluate active geofences for the tenant ([9.5](#95-geofence-pipeline-stateful-not-naive-point-in-polygon)); on genuine transition -> `geofence_events` + `alert.raised` business event via outbox.
   - Business events (if any) -> outbox.
5. After commit: telemetry emitted to `tenant:{tenantId}` room (coalesced <=1 Hz per vehicle); outbox publisher delivers business events.

## 9.3 Outbox publisher

- In-process worker in Phase 1-pilot: claim batch with `SELECT ... FROM outbox_events WHERE published_at IS NULL ORDER BY created_at, id LIMIT n FOR UPDATE SKIP LOCKED`.
- Emit to the correct rooms (derived from event + tenant, server-side), mark `published_at`, record `attempts`/`last_error` on failure, retry with backoff.
- Idempotent delivery: consumers dedupe on `eventId` (Socket.IO may deliver more than once).
- Extractable to a standalone worker later **without schema changes** - the table is the contract.
- "Published" means a durable publication attempt was recorded - not that every browser received it. Clients still recover via snapshot + replay cursor if a business event must not be missed (Phase 4+: `/v1/events?since=<cursor>` endpoint for the web app; the demo relies on snapshot recovery, which is sufficient at demo scale).

## 9.4 Socket rooms & authorization

- Handshake is authenticated (JWT). Room membership is computed **server-side** from verified membership - clients can never join arbitrary rooms.
- Rooms: `tenant:{tenantId}` (fleet-wide updates) and `job:{jobId}` (job-scoped updates for dispatchers and the customer tracking preview).
- Tenant room names are server-derived; a client-supplied `tenant_id` is ignored for authorization ([11.4](11-security-and-compliance.md)).

## 9.5 Geofence pipeline (stateful, not naive point-in-polygon)

1. Store boundary + type per geofence.
2. Evaluate accepted pings against enabled fences (`ST_Covers` includes boundary points).
3. Compare against the **last membership state** per (vehicle, fence).
4. Detect a genuine enter/exit transition only.
5. Apply accuracy, dwell-time (default e.g. 30 s), and duplicate-suppression rules before recording - a vehicle oscillating near a boundary must not spam alerts.
6. Record `geofence_events`, emit business events via outbox.

A single point-in-polygon hit proves nothing about arrival or completion; the driver's explicit command remains authoritative for job state ([08.3](08-domain-model-and-events.md) invariant 8).

## 9.6 Backpressure & limits

- Ingestion rate limit per driver (burst ~1/2 s, steady 5-10 s; configured per tenant in Phase 4+).
- Telemetry broadcast coalesced (<=1 Hz per vehicle per room) to keep dispatcher UIs cheap.
- Payload caps on the socket and HTTP layers; oversized/overspaced pings are rejected with a typed error, not silently dropped.

## 9.7 Staleness & recovery

- `vehicle_positions_current` rows carry `captured_at`; the UI labels positions older than the threshold (e.g. 60 s) as stale instead of animating ghosts.
- `GET /v1/fleet/state` returns the authorized snapshot: current positions, active jobs, published routes, unresolved alerts - everything the dashboard needs to rebuild after a disconnect.

## 9.8 Demo simulator (Phase 1)

- `modules/tracking/simulator.ts`: moves demo vehicles along seeded route polylines at realistic speeds with a demo device session, calling the **same ingestion path** as real devices - the demo exercises the production pipeline (tx -> outbox -> socket) from day one.
- Powers the "Emergency" scenario trigger (STAT job injected mid-route) and the dispatcher map movement.
- Exists only under `DEMO_MODE`; no production code path branches on it.

## 9.9 Operational health

Structured metrics (logs now, Prometheus only if the pilot needs it): outbox lag, publish failure count, socket connections per tenant, ingest rate per driver, stale-position rate. Dashboards are Phase 6; the *data* exists from Phase 1.





## 9.10 Phase 4 implementation status (2026-10-28)
Real telemetry ingestion now exists (not demo-only):
- `POST /v1/telemetry` (driver device token only): a batch of 1-50
  samples; the vehicle is derived server-side from the authenticated
  driver, never from the body.
- One tenant-scoped transaction per batch: append to `location_points`
  (server-assigned monotonic `sequence_no`), advance the hot
  `vehicles.latitude/longitude/captured_at`, refresh
  `drivers.last_ping_at`.
- Monotonic acceptance: samples at or before the current position are
  rejected as stale (reported per sample); future samples beyond a 5 min
  tolerance are invalid.
- Socket.IO handshakes are authenticated in production (access token ->
  tenant room, server-derived). Telemetry publishes to the tenant room
  only; per-vehicle coalescing (1 s) bounds dispatcher updates.
- Snapshot recovery reads the hot columns, so a reconnect restores the
  newest accepted position with the existing staleness rule.
- Verification: `apps/api/src/modules/tracking/telemetry.test.ts` (3:
  ordering/snapshot, replay + spoofed vehicle, auth) and
  `apps/api/src/lib/realtime.test.ts` (2: tenant room isolation,
  unauthenticated rejection).

Remaining for Phase 4 completeness: geofence transitions, per-device
rate limits, background location on the Expo app, and an end-to-end
field-style test through the driver app.
