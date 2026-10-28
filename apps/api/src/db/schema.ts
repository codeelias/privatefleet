/**
 * Phase 2 schema (docs/03, ADR-0005): tenancy-first Postgres with RLS.
 * Every operational table carries tenant_id; ids stay uuid; PostGIS
 * geometry is added by post-migration SQL (raw SQL is the approved
 * escape hatch for spatial indexes).
 */
import {
  bigint,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["owner", "dispatcher", "admin"]);
export const driverStatusEnum = pgEnum("driver_status", [
  "available",
  "on_route",
  "off_duty",
  "suspended",
]);
export const vehicleStatusEnum = pgEnum("vehicle_status", [
  "available",
  "on_route",
  "maintenance",
]);
export const jobStatusEnum = pgEnum("job_status", [
  "unassigned",
  "assigned",
  "in_progress",
  "completed",
  "skipped",
  "cancelled",
]);
export const jobPriorityEnum = pgEnum("job_priority", ["standard", "urgent", "stat"]);
export const stopTypeEnum = pgEnum("stop_type", ["pickup", "dropoff"]);
export const routeStatusEnum = pgEnum("route_status", [
  "draft",
  "published",
  "in_progress",
  "completed",
  "superseded",
  "cancelled",
]);
export const optimizationStatusEnum = pgEnum("optimization_status", [
  "pending",
  "running",
  "succeeded",
  "failed",
]);
export const alertSeverityEnum = pgEnum("alert_severity", ["urgent", "at_risk", "info"]);
export const alertStatusEnum = pgEnum("alert_status", ["open", "acknowledged", "resolved"]);
export const actorTypeEnum = pgEnum("actor_type", ["user", "driver", "system"]);

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    theme: jsonb("theme").$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
  },
  (t) => [uniqueIndex("tenants_slug_uq").on(t.slug)],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRoleEnum("role").notNull().default("owner"),
    createdAt,
  },
  (t) => [uniqueIndex("users_tenant_email_uq").on(t.tenantId, t.email)],
);

export const vehicles = pgTable(
  "vehicles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    registration: text("registration").notNull(),
    vehicleType: text("vehicle_type").notNull(),
    status: vehicleStatusEnum("status").notNull().default("available"),
    driverId: uuid("driver_id"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    capturedAt: timestamp("captured_at", { withTimezone: true }),
    createdAt,
  },
  (t) => [
    uniqueIndex("vehicles_tenant_registration_uq").on(t.tenantId, t.registration),
    index("vehicles_tenant_idx").on(t.tenantId),
  ],
);

export const drivers = pgTable(
  "drivers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    phone: text("phone"),
    status: driverStatusEnum("status").notNull().default("available"),
    /** Argon2id hash of the driver PIN (Phase 3 device login). */
    pinHash: text("pin_hash"),
    vehicleId: uuid("vehicle_id"),
    lastPingAt: timestamp("last_ping_at", { withTimezone: true }),
    createdAt,
  },
  (t) => [index("drivers_tenant_idx").on(t.tenantId)],
);

export const locationPoints = pgTable(
  "location_points",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    driverId: uuid("driver_id").references(() => drivers.id, { onDelete: "set null" }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    accuracyMetres: doublePrecision("accuracy_metres"),
    headingDeg: doublePrecision("heading_deg"),
    speedMps: doublePrecision("speed_mps"),
    /** Server-assigned monotonic per-vehicle sequence. */
    sequenceNo: bigint("sequence_no", { mode: "number" }).notNull(),
  },
  (t) => [
    uniqueIndex("location_points_vehicle_sequence_uq").on(t.vehicleId, t.sequenceNo),
    index("location_points_vehicle_captured_idx").on(t.vehicleId, t.capturedAt),
  ],
);

export const routes = pgTable(
  "routes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    routeDate: date("route_date").notNull(),
    driverId: uuid("driver_id").notNull(),
    vehicleId: uuid("vehicle_id").notNull(),
    status: routeStatusEnum("status").notNull().default("draft"),
    version: integer("version").notNull().default(1),
    plannedDistanceM: bigint("planned_distance_m", { mode: "number" }),
    plannedDurationS: integer("planned_duration_s"),
    /** Validated road geometry persisted at publish time (Phase 5). */
    geometry: jsonb("geometry").$type<Array<{ latitude: number; longitude: number }>>(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt,
  },
  (t) => [
    uniqueIndex("routes_tenant_id_id_uq").on(t.tenantId, t.id),
    index("routes_tenant_status_idx").on(t.tenantId, t.status),
  ],
);

export const routeStops = pgTable(
  "route_stops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    routeId: uuid("route_id")
      .notNull()
      .references(() => routes.id, { onDelete: "cascade" }),
    jobStopId: uuid("job_stop_id")
      .notNull()
      .references(() => jobStops.id, { onDelete: "cascade" }),
    sequenceNo: integer("sequence_no").notNull(),
    plannedArrivalAt: timestamp("planned_arrival_at", { withTimezone: true }),
    plannedDepartureAt: timestamp("planned_departure_at", { withTimezone: true }),
    legDistanceM: integer("leg_distance_m"),
    legDurationS: integer("leg_duration_s"),
    status: text("status").notNull().default("planned"),
  },
  (t) => [
    uniqueIndex("route_stops_route_sequence_uq").on(t.routeId, t.sequenceNo),
    uniqueIndex("route_stops_route_stop_uq").on(t.routeId, t.jobStopId),
  ],
);

export const optimizationRuns = pgTable(
  "optimization_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    routeId: uuid("route_id"),
    inputHash: text("input_hash").notNull(),
    engine: text("engine").notNull(),
    engineVersion: text("engine_version").notNull(),
    request: jsonb("request").notNull(),
    result: jsonb("result"),
    metrics: jsonb("metrics"),
    status: optimizationStatusEnum("status").notNull().default("pending"),
    error: text("error"),
    createdAt,
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("optimization_runs_input_hash_idx").on(t.tenantId, t.inputHash, t.createdAt)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    reference: text("reference").notNull(),
    // Tenant-configurable service labels ("STAT pickup", "Clinic", ...)
    serviceType: text("service_type").notNull(),
    priority: jobPriorityEnum("priority").notNull().default("standard"),
    status: jobStatusEnum("status").notNull().default("unassigned"),
    assignedDriverId: uuid("assigned_driver_id"),
    assignedVehicleId: uuid("assigned_vehicle_id"),
    version: integer("version").notNull().default(0),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex("jobs_tenant_reference_uq").on(t.tenantId, t.reference),
    index("jobs_tenant_status_idx").on(t.tenantId, t.status),
  ],
);

export const jobStops = pgTable(
  "job_stops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    stopType: stopTypeEnum("stop_type").notNull(),
    address: text("address").notNull(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("pending"),
    arrivedAt: timestamp("arrived_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("job_stops_job_sequence_uq").on(t.jobId, t.sequence),
    index("job_stops_tenant_idx").on(t.tenantId),
  ],
);

export const jobEvents = pgTable(
  "job_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    actorType: actorTypeEnum("actor_type").notNull(),
    actorId: uuid("actor_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
  },
  (t) => [index("job_events_job_idx").on(t.jobId, t.createdAt)],
);

export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    severity: alertSeverityEnum("severity").notNull(),
    status: alertStatusEnum("status").notNull().default("open"),
    title: text("title").notNull(),
    entity: text("entity").notNull(),
    location: text("location").notNull(),
    freshness: text("freshness").notNull(),
    recommendedAction: text("recommended_action").notNull(),
    reference: text("reference"),
    createdAt,
    actedAt: timestamp("acted_at", { withTimezone: true }),
  },
  (t) => [index("alerts_tenant_status_idx").on(t.tenantId, t.status)],
);

/** Transactional outbox (ADR-0008): written in the command transaction. */
export const outbox = pgTable(
  "outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt,
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [index("outbox_unpublished_idx").on(t.publishedAt, t.createdAt)],
);

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    userId: uuid("user_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    replacedBy: uuid("replaced_by"),
    createdAt,
  },
  (t) => [uniqueIndex("refresh_tokens_hash_uq").on(t.tokenHash)],
);

/** Command idempotency: replay returns the stored response (docs/04.5). */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    tenantId: uuid("tenant_id").notNull(),
    key: text("key").notNull(),
    endpoint: text("endpoint").notNull(),
    requestHash: text("request_hash").notNull(),
    statusCode: integer("status_code").notNull(),
    response: jsonb("response").$type<Record<string, unknown>>().notNull(),
    createdAt,
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.key] })],
);

/** Demo scenario isolation: each demo tenant owns a seeded scenario. */
export const demoScenarios = pgTable(
  "demo_scenarios",
  {
    tenantId: uuid("tenant_id").primaryKey(),
    scenario: text("scenario").notNull(),
    seededAt: timestamp("seeded_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const tenantTables = [
  tenants,
  users,
  vehicles,
  drivers,
  jobs,
  jobStops,
  jobEvents,
  alerts,
  outbox,
  refreshTokens,
  idempotencyKeys,
  demoScenarios,
] as const;

/** Tables isolated by tenant_id (tenants itself keys on id). */
export const tenantScopedTables = [
  users,
  vehicles,
  drivers,
  jobs,
  jobStops,
  jobEvents,
  alerts,
  outbox,
  refreshTokens,
  idempotencyKeys,
  demoScenarios,
] as const;



