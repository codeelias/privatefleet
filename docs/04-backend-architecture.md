# 04 - Backend Architecture

**Status:** Draft v1 - for approval.
**Decisions:** [ADR-0002](adr/0002-modular-monolith.md), [ADR-0004](adr/0004-fastify.md), [ADR-0005](adr/0005-drizzle-postgis.md), [ADR-0008](adr/0008-realtime-outbox.md).
**Related:** [07](07-database-design.md) (schema), [08](08-domain-model-and-events.md) (domain), [09](09-realtime-tracking.md) (realtime), [10](10-optimization-integration.md) (optimization).

## 4.1 Stack

Fastify + TypeScript (strict) + zod (validation via `fastify-type-provider-zod`) + Drizzle ORM (raw SQL for spatial work) + `pg` + Socket.IO + pino. One deployable process; the outbox publisher runs in-process (extractable worker later - see [09.4](09-realtime-tracking.md)).

## 4.2 Module anatomy

```
apps/api/src/
+- server.ts                 # composition root: boot, listen, graceful shutdown
+- app.ts                    # buildApp(): Fastify instance for tests and workers
+- config/                   # env parsing (zod) -> typed AppConfig; fail fast at boot
+- lib/                      # shared infrastructure (knows nothing about modules)
|  +- db/                    # pool, transaction helper, tenant-context set_config,
|  |                         # migration runner (app_migrator role)
|  +- events/                # outbox writer + publisher worker (SKIP LOCKED)
|  +- realtime/              # Socket.IO server, room helpers, handshake auth
|  +- auth/                  # JWT sign/verify, current-user decoration, roles
|  +- errors/                # AppError hierarchy -> RFC 9457 responses
|  +- logging/               # pino, request-id, PII redaction
|  +- geo/                   # WKT/GeoJSON helpers, PostGIS utilities
+- modules/                  # vertical slices - one business capability each
   +- identity/              # app users, memberships, refresh tokens, login
   +- tenancy/               # tenants, branding, custom domains (Phase 6)
   +- fleet/                 # drivers, vehicles
   +- jobs/                  # jobs, stops, lifecycle commands
   +- dispatch/              # routes, route stops, assignment, publication
   +- tracking/              # GPS ingestion, current positions, simulator (demo)
   +- optimization/          # OSRM/VROOM adapters, proposals, approval
   +- alerts/                # geofences, geofence events, exception feed
   +- pod/                   # proof of service, presigned upload/download URLs
   +- customer-tracking/     # tracking links, public read-only DTOs
   +- demo/                  # scenario seeds (vertical + region-parameterized),
                             # prospect sandboxes, reset (DEMO_MODE only)
```

Each business module contains:

| File | Responsibility |
|------|----------------|
| `module.ts` | Registers routes/plugins into Fastify; declares module deps. |
| `routes.ts` | HTTP wiring: path, contract schema, authn/z requirements, handler. |
| `service.ts` | Domain logic: state transitions, invariants, cross-aggregate checks. Pure-ish; depends on repos and lib, not on HTTP. |
| `repo/` | Persistence behind an interface: `pg.*.ts` (Drizzle/raw SQL) and `memory.*.ts` (in-memory for DEMO_MODE and fast tests). |
| `events.ts` | The module's outbox event types it emits (typed via contracts). |
| `schemas.ts` | Module-local zod schemas not shared with clients. |
| `*.test.ts` | Unit tests (services, state machines) with in-memory repos. |
| `*.integration.test.ts` | Integration tests against a real Postgres via `buildApp()`. |

## 4.3 Dependency rules

- `lib/` knows nothing about modules; modules import `lib/` and `@privatefleet/contracts`.
- Business modules do **not** import each other's internals. Cross-module reads go through a module's exported public query interface (declared in its `service.ts`); cross-module *reactions* go through events (outbox), never direct calls.
- The only structural exception: `dispatch` reads `jobs`' public query interface (routes are built from job stops). Cycles are forbidden - checked by madge in CI.
- Rationale: each module is independently testable and individually extractable into a service later without redesigning the domain.

## 4.4 API conventions

### Routing & commands
- All endpoints under `/v1`. Resources plural and nested where owned: `/v1/tenants/{tenantId}/drivers`, `/v1/jobs/{jobId}/stops`.
- Reads: `GET` with filtering and cursor pagination (`?status=unassigned&limit=50&cursor=<opaque>`; `limit` capped at 100; order `(created_at, id)`).
- State changes are **explicit commands**: `POST /v1/jobs/{jobId}/assign`, `POST /v1/jobs/{jobId}/stops/{stopId}/complete`, etc. No generic PATCH-to-any-shape endpoints.
- Every state-changing request requires an `Idempotency-Key` header (UUID). Replays return the stored original result (see [08.5](08-domain-model-and-events.md)).

### Validation & typing
- Request/response schemas come from `@privatefleet/contracts` (zod) via `fastify-type-provider-zod`. Handlers receive fully typed input; responses are serialized against the contract.
- No schema in `contracts` may encode internal implementation details (column names, internal errors).

### Errors (RFC 9457 problem+json)
```json
{
  "type": "https://privatefleet.example/errors/conflict",
  "title": "State conflict",
  "status": 409,
  "code": "JOB_VERSION_CONFLICT",
  "detail": "Job was modified concurrently; reload and retry.",
  "uiMessage": "Wait - this job was just updated on a phone. Reload to see the latest progress.",
  "conflict": { "currentVersion": 3 }
}
```
- `code` is a stable machine-readable enum defined in `contracts/errors`.
- `uiMessage` is the only field clients may render directly to users - conversational, non-technical, and ending in a concrete next step ([ADR-0011](adr/0011-empathetic-error-handling.md)).
- `detail` is for logs and support, and never leaks internal state or other tenants' data.

### Auth & tenant context
- `Authorization: Bearer <access-token>`; refresh via `POST /v1/auth/refresh` (rotating refresh tokens, see [11.3](11-security-and-compliance.md)).
- Tenant context is derived **only** from the authenticated membership. `tenant_id` from a header, body, or URL is ignored for authorization (URLs may contain it for routing convenience only, and it must match the session or the request is rejected).
- Roles: `owner`, `admin`, `dispatcher`, `driver`, `viewer` (from `tenant_memberships`). Endpoints declare required roles; default is deny.

### Transactions
`lib/db` provides `withTenantContext({ tenantId, role }, async (tx) => ...)` which:
1. Sets `app.current_tenant_id` (and `app.current_user_id`, `app.current_role`) as transaction-local settings for RLS (see [07.6](07-database-design.md)).
2. Runs the callback in one transaction.
3. Commits; on error rolls back with no partial publication.

## 4.5 Eventing conventions

- Business events are written to `outbox_events` **inside** the same transaction as the state change via `lib/events.write(tx, event)`.
- Event payloads are validated against `contracts/events` schemas at write time.
- The publisher drains and emits; consumers deduplicate by `eventId`. Full rules in [09](09-realtime-tracking.md).

## 4.6 Logging & observability

- pino JSON logs to stdout; request-id attached per request (propagated into events as `requestId` where useful).
- Redaction list for PII (names, phones, emails, addresses, token values) configured centrally in `lib/logging`.
- Health endpoints: `GET /healthz` (liveness) and `GET /readyz` (DB + outbox lag + socket server).
- Metrics collected but lightly: outbox lag, publish failures, socket connections per tenant, ingest rate - emitted as structured logs; Prometheus endpoint only when the pilot demands it.

## 4.7 Configuration

- All config from environment variables parsed by zod into `AppConfig` at boot; missing/invalid values crash immediately with a clear message.
- `DEMO_MODE=true` switches repositories to in-memory implementations and enables `modules/demo`. No demo code may leak into production paths guarded only by `if`.
- Secrets are environment-injected only; never committed (see [11.7](11-security-and-compliance.md)).

## 4.8 Testing conventions

See [12](12-testing-and-quality.md). In short: unit tests target `service.ts` state logic with memory repos; integration tests boot `buildApp()` against a real Postgres (Compose) and cover lifecycle, idempotency, RLS, and outbox behaviour.




