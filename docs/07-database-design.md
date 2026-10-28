# 07 - Database Design

**Status:** Draft v1 - for approval.
**Decisions:** [ADR-0005](adr/0005-drizzle-postgis.md).
**Related:** [08](08-domain-model-and-events.md) (semantics), [09](09-realtime-tracking.md) (hot/cold split), [11](11-security-and-compliance.md) (RLS).

## 7.1 Conventions

- Tables: plural `snake_case`. Primary key `id uuid DEFAULT gen_random_uuid()`.
- **Every tenant-owned table carries `tenant_id`** and declares `UNIQUE (tenant_id, id)`. Foreign keys between tenant-owned tables are **composite**: `FOREIGN KEY (tenant_id, x_id) REFERENCES x (tenant_id, id)`. Cross-tenant references are structurally impossible.
- Timestamps: `timestamptz`. `created_at`/`updated_at` defaults; no client-supplied timestamps for state columns (`captured_at` vs `received_at` distinguish device time from server time).
- No PG enum types - `CHECK` constraints instead (migration-friendlier). No soft deletes - explicit status columns plus the immutable audit log.
- Positions use `geography(Point, 4326)` (metric spatial math); polygons use `geography(Polygon, 4326)`. GiST indexes on all spatial columns that are queried.
- JSONB for structured payloads (branding, event payloads, solver results); `text[]` for capability sets.

## 7.2 Module -> table map

| Module | Tables |
|--------|--------|
| tenancy | `tenants` |
| identity | `app_users`, `tenant_memberships`, `refresh_tokens` |
| fleet | `drivers`, `vehicles` |
| jobs | `jobs`, `job_stops` |
| dispatch | `routes`, `route_stops` |
| tracking | `vehicle_positions_current`, `location_points` |
| history | `job_events` |
| idempotency | `command_receipts` |
| pod | `proof_of_service` |
| optimization | `optimization_runs` |
| events | `outbox_events` |
| alerts | `geofences`, `geofence_events` |
| customer-tracking | `customer_tracking_links` |

## 7.3 Core schema

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

-- -- TENANCY ----------------------------------------------------------------
CREATE TABLE tenants (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name          text NOT NULL,
    slug          text NOT NULL UNIQUE,          -- for branded tracking pages
    custom_domain text UNIQUE,                   -- Phase 6 (verified only)
    timezone      text NOT NULL DEFAULT 'Europe/London',
    branding      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- logo, colors, fonts
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- -- IDENTITY ---------------------------------------------------------------
CREATE TABLE app_users (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email        text NOT NULL,
    display_name text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX app_users_email_lower_uq ON app_users (lower(email));

CREATE TABLE tenant_memberships (
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    user_id   uuid NOT NULL REFERENCES app_users(id),
    role      text NOT NULL CHECK (role IN ('owner','admin','dispatcher','driver','viewer')),
    status    text NOT NULL DEFAULT 'active' CHECK (status IN ('active','invited','suspended')),
    PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE refresh_tokens (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    uuid NOT NULL REFERENCES tenants(id),
    user_id      uuid NOT NULL REFERENCES app_users(id),
    token_digest text NOT NULL UNIQUE,           -- sha256 of the token; raw never stored
    family_id    uuid NOT NULL,                  -- rotation family for reuse detection
    expires_at   timestamptz NOT NULL,
    revoked_at   timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- -- FLEET ------------------------------------------------------------------
CREATE TABLE drivers (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    uuid NOT NULL REFERENCES tenants(id),
    user_id      uuid,
    full_name    text NOT NULL,
    status       text NOT NULL DEFAULT 'off_duty'
                 CHECK (status IN ('available','on_route','off_duty','suspended')),
    capabilities text[] NOT NULL DEFAULT '{}',
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_memberships (tenant_id, user_id)
);

CREATE TABLE vehicles (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      uuid NOT NULL REFERENCES tenants(id),
    registration   text NOT NULL,
    vehicle_type   text NOT NULL,                -- courier_van | sedan | stretcher | ...
    capacity_units integer CHECK (capacity_units IS NULL OR capacity_units >= 0),
    status         text NOT NULL DEFAULT 'available'
                   CHECK (status IN ('available','on_route','maintenance','inactive')),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, registration)
);

-- -- JOBS -------------------------------------------------------------------
CREATE TABLE jobs (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             uuid NOT NULL REFERENCES tenants(id),
    reference             text NOT NULL,         -- client's booking reference
    service_type          text NOT NULL,
    priority              text NOT NULL DEFAULT 'standard'
                          CHECK (priority IN ('standard','urgent','stat')),
    status                text NOT NULL DEFAULT 'unassigned'
                          CHECK (status IN ('unassigned','assigned','in_progress',
                                            'completed','cancelled','failed')),
    window_start          timestamptz,
    window_end            timestamptz,
    required_capabilities text[] NOT NULL DEFAULT '{}',
    created_by_user_id    uuid,
    version               integer NOT NULL DEFAULT 1,   -- optimistic concurrency
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, reference),
    FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES tenant_memberships (tenant_id, user_id),
    CHECK (window_start IS NULL OR window_end IS NULL OR window_end >= window_start)
);

CREATE TABLE job_stops (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenants(id),
    job_id          uuid NOT NULL,
    sequence_no     integer NOT NULL CHECK (sequence_no > 0),
    stop_type       text NOT NULL CHECK (stop_type IN ('pickup','dropoff','waypoint')),
    address         text NOT NULL,
    location        geography(Point, 4326) NOT NULL,
    window_start    timestamptz,
    window_end      timestamptz,
    service_seconds integer NOT NULL DEFAULT 0 CHECK (service_seconds >= 0),
    status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','arrived','completed','skipped','failed')),
    arrived_at      timestamptz,
    completed_at    timestamptz,
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, job_id, sequence_no),
    FOREIGN KEY (tenant_id, job_id) REFERENCES jobs (tenant_id, id)
);
CREATE INDEX job_stops_location_gix ON job_stops USING GIST (location);

-- -- DISPATCH (route versions) ----------------------------------------------
CREATE TABLE routes (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid NOT NULL REFERENCES tenants(id),
    route_date          date NOT NULL,
    driver_id           uuid NOT NULL,
    vehicle_id          uuid NOT NULL,
    status              text NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','published','in_progress',
                                          'completed','superseded','cancelled')),
    version             integer NOT NULL DEFAULT 1,
    planned_distance_m  bigint,
    planned_duration_s  integer,
    published_at        timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, driver_id)  REFERENCES drivers  (tenant_id, id),
    FOREIGN KEY (tenant_id, vehicle_id) REFERENCES vehicles (tenant_id, id)
);

CREATE TABLE route_stops (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            uuid NOT NULL REFERENCES tenants(id),
    route_id             uuid NOT NULL,
    job_stop_id          uuid NOT NULL,
    sequence_no          integer NOT NULL CHECK (sequence_no > 0),
    planned_arrival_at   timestamptz,
    planned_departure_at timestamptz,
    leg_distance_m       integer,
    leg_duration_s       integer,
    status               text NOT NULL DEFAULT 'planned'
                         CHECK (status IN ('planned','en_route','arrived',
                                           'completed','skipped','cancelled')),
    FOREIGN KEY (tenant_id, route_id)    REFERENCES routes    (tenant_id, id),
    FOREIGN KEY (tenant_id, job_stop_id) REFERENCES job_stops (tenant_id, id),
    UNIQUE (tenant_id, route_id, sequence_no),
    UNIQUE (tenant_id, route_id, job_stop_id)
);

-- -- TRACKING: hot path + history -------------------------------------------
CREATE TABLE vehicle_positions_current (     -- fast lookup for the fleet map
    tenant_id         uuid NOT NULL,
    vehicle_id        uuid NOT NULL,
    driver_id         uuid,
    location          geography(Point, 4326) NOT NULL,
    heading_deg       real,
    speed_mps         real,
    accuracy_m        real,
    device_session_id uuid NOT NULL,
    sequence_no       bigint NOT NULL,
    captured_at       timestamptz NOT NULL,
    received_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, vehicle_id),
    FOREIGN KEY (tenant_id, vehicle_id) REFERENCES vehicles (tenant_id, id),
    FOREIGN KEY (tenant_id, driver_id)  REFERENCES drivers  (tenant_id, id)
);
CREATE INDEX vehicle_positions_current_gix ON vehicle_positions_current USING GIST (location);

CREATE TABLE location_points (               -- append-only GPS history
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         uuid NOT NULL,
    vehicle_id        uuid NOT NULL,
    driver_id         uuid,
    device_session_id uuid NOT NULL,
    sequence_no       bigint NOT NULL,
    location          geography(Point, 4326) NOT NULL,
    accuracy_m        real,
    captured_at       timestamptz NOT NULL,
    received_at       timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, vehicle_id) REFERENCES vehicles (tenant_id, id),
    FOREIGN KEY (tenant_id, driver_id)  REFERENCES drivers  (tenant_id, id),
    UNIQUE (tenant_id, vehicle_id, device_session_id, sequence_no)  -- duplicate pings rejected
);
CREATE INDEX location_points_vehicle_time_idx ON location_points (tenant_id, vehicle_id, captured_at DESC);
CREATE INDEX location_points_gix ON location_points USING GIST (location);
```

## 7.4 Remaining tables (added via migrations, same conventions)

```sql
-- HISTORY: immutable audit + realtime trigger source
CREATE TABLE job_events (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id     uuid NOT NULL REFERENCES tenants(id),
    job_id        uuid NOT NULL,
    job_stop_id   uuid,
    driver_id     uuid,
    actor_user_id uuid,
    event_type    text NOT NULL,       -- arrived_pickup | departed | arrived_dropoff
                                       -- | pod_captured | exception | status_changed | ...
    payload       jsonb NOT NULL DEFAULT '{}'::jsonb,   -- reason codes, media keys, notes
    location      geography(Point, 4326),
    created_at    timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, job_id) REFERENCES jobs (tenant_id, id),
    FOREIGN KEY (tenant_id, job_stop_id) REFERENCES job_stops (tenant_id, id)
);
CREATE INDEX job_events_job_time_idx ON job_events (tenant_id, job_id, created_at DESC);

-- IDEMPOTENCY: one row per accepted command
CREATE TABLE command_receipts (
    tenant_id       uuid NOT NULL REFERENCES tenants(id),
    idempotency_key uuid NOT NULL,
    command_type    text NOT NULL,
    aggregate_type  text NOT NULL,
    aggregate_id    uuid NOT NULL,
    result          jsonb NOT NULL,     -- original response/event ids to replay
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, idempotency_key)
);

-- PROOF OF SERVICE: media stays in object storage; DB holds keys + metadata
CREATE TABLE proof_of_service (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         uuid NOT NULL REFERENCES tenants(id),
    job_stop_id       uuid NOT NULL,
    kind              text NOT NULL CHECK (kind IN ('photo','signature','note')),
    object_key        text NOT NULL,    -- private bucket key; never a public URL
    content_type      text NOT NULL,
    size_bytes        bigint NOT NULL,
    sha256            text NOT NULL,
    captured_by_user_id uuid NOT NULL,
    captured_at       timestamptz NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, job_stop_id) REFERENCES job_stops (tenant_id, id)
);

-- OPTIMIZATION: inputs, solver, results, metrics - proposal first, approval later
CREATE TABLE optimization_runs (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    uuid NOT NULL REFERENCES tenants(id),
    route_id     uuid,                   -- set when a proposal is approved/published
    input_hash   text NOT NULL,          -- deterministic hash of inputs (caching)
    engine       text NOT NULL,          -- 'vroom' | 'seeded-demo'
    engine_version text NOT NULL,
    request      jsonb NOT NULL,         -- normalized VROOM payload
    result       jsonb,                  -- solver output
    metrics      jsonb,                  -- distance_m, duration_s, unassigned_count
    status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','running','succeeded','failed')),
    error        text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    started_at   timestamptz,
    finished_at  timestamptz,
    UNIQUE (tenant_id, id)
);
CREATE INDEX optimization_runs_input_hash_idx ON optimization_runs (tenant_id, input_hash, created_at DESC);

-- OUTBOX: written in the same tx as the state change, drained by the publisher
CREATE TABLE outbox_events (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id     uuid NOT NULL REFERENCES tenants(id),
    aggregate_type text NOT NULL,
    aggregate_id  uuid NOT NULL,
    event_type    text NOT NULL,
    payload       jsonb NOT NULL,
    published_at  timestamptz,           -- NULL = pending
    attempts      integer NOT NULL DEFAULT 0,
    last_error    text,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_pending_idx ON outbox_events (created_at, id)
    WHERE published_at IS NULL;

-- ALERTS / GEOFENCES
CREATE TABLE geofences (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  uuid NOT NULL REFERENCES tenants(id),
    name       text NOT NULL,
    boundary   geography(Polygon, 4326) NOT NULL,
    fence_type text NOT NULL DEFAULT 'inclusion' CHECK (fence_type IN ('inclusion','exclusion')),
    enabled    boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id)
);
CREATE INDEX geofences_gix ON geofences USING GIST (boundary);

CREATE TABLE geofence_events (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id     uuid NOT NULL,
    geofence_id   uuid NOT NULL,
    vehicle_id    uuid NOT NULL,
    driver_id     uuid,
    transition    text NOT NULL CHECK (transition IN ('enter','exit')),
    dwell_seconds integer,
    created_at    timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, geofence_id) REFERENCES geofences (tenant_id, id),
    FOREIGN KEY (tenant_id, vehicle_id)  REFERENCES vehicles (tenant_id, id)
);
CREATE INDEX geofence_events_time_idx ON geofence_events (tenant_id, created_at DESC);

-- CUSTOMER TRACKING: unguessable, expiring, revocable, job-scoped
CREATE TABLE customer_tracking_links (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        uuid NOT NULL REFERENCES tenants(id),
    job_id           uuid NOT NULL,
    token_digest     text NOT NULL UNIQUE,   -- sha256; raw token never stored
    expires_at       timestamptz NOT NULL,
    revoked_at       timestamptz,
    created_by_user_id uuid NOT NULL,
    last_accessed_at timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, job_id) REFERENCES jobs (tenant_id, id)
);
```

## 7.5 Indexing and hot/cold separation

- The fleet map reads **only** `vehicle_positions_current` (one row per vehicle) - never a scan of GPS history.
- `location_points` is append-only with a per-vehicle time index and a GiST index for spatial history queries (replay, deviation checks).
- The outbox index targets only pending rows (`WHERE published_at IS NULL`).

## 7.6 Row-level security (defence-in-depth layer 3)

Three isolation layers, in order: **app-layer authorization** (roles on endpoints), **composite foreign keys** (structure), **RLS** (database). None alone is trusted.

```sql
-- Roles: app_runtime = application (no BYPASSRLS), app_migrator = migrations
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs FORCE ROW LEVEL SECURITY;

CREATE POLICY jobs_tenant_isolation ON jobs
USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
-- Equivalent policies on every tenant-owned table.
```

```sql
-- Per transaction (lib/db withTenantContext):
BEGIN;
SELECT set_config('app.current_tenant_id', $1, true);  -- 'true' = transaction-local
-- ... tenant-scoped queries and writes ...
COMMIT;
```

- The transaction-local setting is safe with pooled connections.
- `app_runtime` is **not** superuser and cannot bypass RLS; migrations run as `app_migrator` only in deployment/CI.
- The same policy template applies to `tenant_id`-scoped and history tables.

## 7.7 Migrations

- Drizzle schema files live per module (`repo/schema.ts`); `drizzle-kit generate` produces SQL migration files committed to the repo.
- Migrations are **append-only**: never edit an applied migration; fix forward.
- Each migration must state its rollback plan in the PR description ([13](13-development-methodology.md) DoD). Down migrations exist for the pilot phase.
- Migration execution: at boot in dev; as an explicit `migrate` step in CI/deploy, running as `app_migrator`.

## 7.8 Retention (decided now, enforced in Phase 6)

| Data | Policy |
|------|--------|
| `location_points` | Declarative monthly partitioning; retain 13 months, then detach/drop (or archive to cold storage if a tenant contract requires longer). |
| `job_events`, `command_receipts` | Keep for the tenant agreement duration (default 24 months); audit exports on demand. |
| `outbox_events` | Purge published rows after 7 days. |
| POD media | Object-storage lifecycle rules mirroring the tenant agreement. |

Retention rules are config and must exist before the pilot accepts real data, not after.




