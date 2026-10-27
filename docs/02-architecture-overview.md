# 02 - Architecture Overview

**Status:** Draft v1 - for approval.
**Depends on:** [01 - Vision & Principles](01-vision-and-principles.md).
**Detailed in:** [03](03-monorepo-layout.md), [04](04-backend-architecture.md), [05](05-web-app-architecture.md), [06](06-driver-app-architecture.md), [07](07-database-design.md), [09](09-realtime-tracking.md), [10](10-optimization-integration.md).

## 2.1 System context (C4 level 1)

| Actor / system | Interaction |
|----------------|-------------|
| **Dispatcher** (browser) | Plans, assigns, monitors, resolves exceptions via the web dashboard. |
| **Driver** (phone/tablet) | Executes stops, reports arrivals/completions/exceptions via the driver app. |
| **Customer** (browser) | Watches a branded, read-only tracking page for their job. |
| **PostgreSQL + PostGIS** | Source of truth: operational state, history, audit events, outbox. |
| **OSRM** | Road-network travel-time/distance matrices and route geometry. |
| **VROOM** | Vehicle-routing optimization (assignment + sequencing + constraints). |
| **Object storage** (S3-compatible) | Proof-of-service photos/signatures; DB stores keys and metadata only. |
| **Tile service** | Vector map tiles for MapLibre (OpenFreeMap initially; see [ADR-0010](adr/0010-map-tiles.md)). |
| **Caddy** | Reverse proxy, TLS (Let's Encrypt), static hosting, custom-domain routing. |

## 2.2 Containers (C4 level 2)

```
                   +------------------+        +-------------------------+
 Dispatcher -----> |  Web App         |        |  Driver App (Expo)      | --- Driver
  (browser)  HTTPS |  React + Vite    |        |  web for demo, native   |
                   +--------+---------+        |  for pilot (Phase 3+)   |
                            | REST + Socket.IO +-----------+-------------+
 Customer ----> (public    |                              | REST + Socket.IO
  browser)      tracking)  v                              v
                   +----------------------------------------------------+
                   |            API - modular monolith (Fastify)        |
                   |   REST commands/queries  /  Socket.IO delivery       |
                   |   outbox publisher worker (in-process)             |
                   +------+--------------+---------------+-------------+
                          |              |               |
               +----------v---+   +------v--------+  +---v--------------+
               | PostgreSQL   |   | Routing       |  | Object storage   |
               | + PostGIS    |   | OSRM + VROOM  |  | S3 / MinIO       |
               | (source of   |   | (containers)  |  | (presigned URLs) |
               |  truth)      |   +---------------+  +------------------+
               +--------------+
```

**Key decision:** the API is a **modular monolith** - one deployable, internally divided into vertical modules (see [04](04-backend-architecture.md)). The outbox publisher runs in the same process initially and is extractable later without schema changes.

## 2.3 Runtime flows

### A. Honey Pot demo scenario (Phase 1)
1. Demo environment boots with `DEMO_MODE=true`: in-memory repositories, seeded Morning Rush data, simulated GPS ticking along seeded route polylines.
2. Prospect drags a STAT job card onto a driver pin -> web sends an assignment command (with `Idempotency-Key`) -> API validates against the in-memory domain -> commits -> outbox -> Socket.IO `tenant:{id}` room -> map, timeline, and ETA panel update in the same second.
3. A demo driver tablet (Expo web build) receives the assignment, taps "Arrived" -> same pipeline in reverse -> dispatcher screen updates.
4. `POST /v1/demo/scenarios/{id}/reset` restores the deterministic seed between prospects.

### B. GPS ingestion (Phase 4+; exercised by the simulator in Phase 1)
Driver device -> authenticated HTTP ping (queued on device when offline) -> API validates session/sequence -> one transaction: insert `location_points`, advance `vehicle_positions_current`, evaluate geofences, write business events to the outbox -> publisher emits telemetry and events to tenant rooms. Details in [09](09-realtime-tracking.md).

### C. Optimization (Phase 5; deterministic seed in Phase 1)
Dispatcher clicks Optimize -> API collects eligible stops -> OSRM matrix -> VROOM solve -> proposal stored in `optimization_runs` -> dispatcher compares and approves -> transactional publication of a new route version -> affected drivers notified. Details in [10](10-optimization-integration.md).

### D. Customer tracking (Phase 6; previewed in Phase 1)
Tracking link (token digest, expiry, per-job scope) -> public read-only endpoint returns a minimal DTO -> branded page renders status timeline + ETA. No dispatcher data, no media, no tenant internals. Details in [11](11-security-and-compliance.md).

## 2.4 Environments

| Env | Purpose | Data | Infrastructure |
|-----|---------|------|----------------|
| `dev` | Local development | Seeded/demo | Docker Compose subset or in-memory (DEMO_MODE) |
| `demo` | The Honey Pot for prospects | Seeded scenarios, reset per session/nightly | Small VPS, Caddy, DEMO_MODE API |
| `staging` | Release validation, restore drills | Mirrors prod schema, synthetic data | Compose stack |
| `prod` | Pilot tenant(s) | Real customer data | Managed VM/hosted Postgres; Caddy; backups |

Full details in [15 - Infrastructure & Deployment](15-infrastructure-and-deployment.md).

## 2.5 Technology summary

| Concern | Choice | Where decided |
|---------|--------|---------------|
| Repo & tooling | pnpm monorepo + Turborepo, TypeScript strict | [03](03-monorepo-layout.md), [ADR-0001](adr/0001-monorepo-pnpm-turborepo.md) |
| Shared contracts | `@privatefleet/contracts` (zod + inferred types) | [ADR-0003](adr/0003-contracts-first.md) |
| API | Fastify + fastify-type-provider-zod, modular monolith | [ADR-0002](adr/0002-modular-monolith.md), [ADR-0004](adr/0004-fastify.md) |
| Data access | Drizzle ORM + raw SQL for PostGIS | [ADR-0005](adr/0005-drizzle-postgis.md) |
| Database | PostgreSQL 16+ + PostGIS 3.4+, RLS | [07](07-database-design.md) |
| Realtime | Socket.IO + transactional outbox; telemetry fast path | [ADR-0008](adr/0008-realtime-outbox.md) |
| Web | React + Vite + TanStack Router/Query + Zustand + Tailwind + dnd-kit + MapLibre GL JS | [ADR-0006](adr/0006-react-stack.md) |
| Driver | Expo (web target for demo, native for pilot) | [ADR-0009](adr/0009-expo-driver-app.md) |
| Routing | OSRM (matrix) + VROOM (VRP) in containers | [10](10-optimization-integration.md) |
| Maps | MapLibre GL JS + OpenFreeMap tiles initially | [ADR-0010](adr/0010-map-tiles.md) |
| Observability | pino structured logs, request IDs, health endpoints | [04](04-backend-architecture.md) |





