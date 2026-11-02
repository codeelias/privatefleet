/**
 * REST request/response contracts shared by api and web (ADR-0003).
 * Demo scenarios and the fleet snapshot follow docs/12.2 fixtures.
 */
import { z } from "zod";
import {
  DriverDtoSchema,
  GeoPointSchema,
  IdSchema,
  JobDtoSchema,
  VehicleDtoSchema,
} from "./domain.js";

export const SCENARIO_NAMES = ["morning-rush", "emergency", "proof"] as const;
export const ScenarioNameSchema = z.enum(SCENARIO_NAMES);
export type ScenarioName = z.infer<typeof ScenarioNameSchema>;

export const AlertAuditEntrySchema = z.object({
  at: z.string().datetime(),
  message: z.string(),
});
export type AlertAuditEntry = z.infer<typeof AlertAuditEntrySchema>;

export const ImportStopSchema = z.object({
  sequenceNo: z.number().int().positive(),
  stopType: z.enum(["pickup", "dropoff", "waypoint"]),
  address: z.string().min(1).max(300),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  windowStart: z.string().datetime().optional(),
  windowEnd: z.string().datetime().optional(),
});
export type ImportStop = z.infer<typeof ImportStopSchema>;

export const ImportJobSchema = z.object({
  jobRef: z.string().min(1).max(80),
  serviceType: z.string().min(1).max(80),
  priority: z.enum(["standard", "urgent", "stat"]),
  stops: z.array(ImportStopSchema).min(1).max(20),
});
export type ImportJob = z.infer<typeof ImportJobSchema>;

export const ImportPreviewRowSchema = z.object({
  row: z.number().int().positive(),
  jobRef: z.string(),
  stopCount: z.number().int().positive(),
  address: z.string(),
  status: z.enum(["valid", "invalid", "duplicate"]),
  errors: z.array(z.string()),
});
export type ImportPreviewRow = z.infer<typeof ImportPreviewRowSchema>;

export const JobImportPreviewSchema = z.object({
  valid: z.number().int().nonnegative(),
  invalid: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  canCommit: z.boolean(),
  preview: z.array(ImportPreviewRowSchema),
  jobs: z.array(ImportJobSchema),
});
export type JobImportPreview = z.infer<typeof JobImportPreviewSchema>;

export const JobImportCommitRequestSchema = z.object({
  jobs: z.array(ImportJobSchema).min(1).max(5000),
});
export type JobImportCommitRequest = z.infer<typeof JobImportCommitRequestSchema>;

export const JobImportCommitResponseSchema = z.object({
  imported: z.number().int().positive(),
  jobIds: z.array(z.string().uuid()),
  references: z.array(z.string()),
});
export type JobImportCommitResponse = z.infer<typeof JobImportCommitResponseSchema>;
export const DeliveryPerformanceRowSchema = z.object({
  routeId: IdSchema,
  routeDate: z.string(),
  routeVersion: z.number().int(),
  jobId: IdSchema,
  jobReference: z.string(),
  stopId: IdSchema,
  stopSequence: z.number().int(),
  address: z.string(),
  stopStatus: z.string(),
  failureCode: z.string().optional(),
  plannedArrivalAt: z.string().datetime().optional(),
  arrivedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  windowStart: z.string().datetime().optional(),
  windowEnd: z.string().datetime().optional(),
  windowKnown: z.boolean(),
  arrivalKnown: z.boolean(),
  onTime: z.enum(["on_time", "early", "late", "unavailable"]),
  arrivalDeltaS: z.number().optional(),
  plannedDistanceM: z.number().optional(),
  plannedDurationS: z.number().optional(),
});
export type DeliveryPerformanceRow = z.infer<typeof DeliveryPerformanceRowSchema>;

export const DeliveryPerformanceReportSchema = z.object({
  generatedAt: z.string().datetime(),
  rows: z.array(DeliveryPerformanceRowSchema),
});
export type DeliveryPerformanceReport = z.infer<typeof DeliveryPerformanceReportSchema>;

export const TripSegmentSchema = z.object({
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  durationS: z.number().int().nonnegative(),
  distanceM: z.number().nonnegative(),
  points: z.number().int().nonnegative(),
  maxSpeedMps: z.number().nonnegative().optional(),
  startLocation: GeoPointSchema,
  endLocation: GeoPointSchema,
});
export type TripSegment = z.infer<typeof TripSegmentSchema>;

export const StopSegmentSchema = z.object({
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  durationS: z.number().int().nonnegative(),
  maxRadiusM: z.number().nonnegative(),
  points: z.number().int().nonnegative(),
  location: GeoPointSchema,
});
export type StopSegment = z.infer<typeof StopSegmentSchema>;

export const TripReportSchema = z.object({
  generatedAt: z.string().datetime(),
  vehicleId: IdSchema,
  from: z.string().datetime(),
  to: z.string().datetime(),
  segments: z.array(TripSegmentSchema),
});
export type TripReport = z.infer<typeof TripReportSchema>;

export const StopReportSchema = z.object({
  generatedAt: z.string().datetime(),
  vehicleId: IdSchema,
  from: z.string().datetime(),
  to: z.string().datetime(),
  segments: z.array(StopSegmentSchema),
});
export type StopReport = z.infer<typeof StopReportSchema>;

export const TrackingTokenCreateSchema = z.object({
  id: IdSchema,
  token: z.string(),
  expiresAt: z.string().datetime(),
  url: z.string(),
});
export type TrackingTokenCreate = z.infer<typeof TrackingTokenCreateSchema>;

export const PublicTrackingStopSchema = z.object({
  sequence: z.number().int(),
  address: z.string(),
  status: z.string(),
  arrivedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
});
export type PublicTrackingStop = z.infer<typeof PublicTrackingStopSchema>;

export const PublicTrackingResponseSchema = z.object({
  jobReference: z.string(),
  status: z.string(),
  eta: z.string().datetime().optional(),
  driverName: z.string().optional(),
  vehicleRegistration: z.string().optional(),
  position: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
      capturedAt: z.string().datetime(),
      stale: z.boolean(),
    })
    .optional(),
  stops: z.array(PublicTrackingStopSchema),
  /** Remaining uncompleted stops, for progress copy. */
  remainingStops: z.number().int().nonnegative().optional(),
  /** Whether the ETA is a planned schedule or a live-blended estimate. */
  etaMethod: z.enum(["live", "planned"]).optional(),
  /** Trust level of the displayed arrival, derived from fix age. */
  etaConfidence: z.enum(["high", "medium", "low"]).optional(),
  /** Customer-facing promise state derived from ETA vs drop-off window. */
  delayStatus: z.enum(["on_time", "late", "unknown"]).optional(),
  /** Timestamp of the last usable position (null when unavailable). */
  lastUpdateAt: z.string().datetime().optional(),
  /** True when the vehicle is inside an enabled geofence linked to this job. */
  inCustomerZone: z.boolean().optional(),
  customerZoneName: z.string().optional(),
  /** Privacy-safe proof summary: counts only, never personal media. */
  proof: z
    .object({
      photos: z.number().int().nonnegative(),
      signatures: z.number().int().nonnegative(),
      lastRecordedAt: z.string().datetime().optional(),
    })
    .optional(),
});
export type PublicTrackingResponse = z.infer<typeof PublicTrackingResponseSchema>;

export const GeofenceDtoSchema = z.object({
  id: IdSchema,
  name: z.string(),
  geojson: z.string(),
  enabled: z.boolean(),
  jobId: IdSchema.optional(),
  /** Empty array = applies to every vehicle; otherwise only these drivers. */
  driverIds: z.array(IdSchema).default([]),
  createdAt: z.string().datetime(),
});
export type GeofenceDto = z.infer<typeof GeofenceDtoSchema>;

export const GeofenceListSchema = z.object({ geofences: z.array(GeofenceDtoSchema) });
export type GeofenceList = z.infer<typeof GeofenceListSchema>;

export const AlertDtoSchema = z.object({
  id: IdSchema,
  severity: z.enum(["info", "at_risk", "urgent"]),
  title: z.string(),
  relatedJobId: IdSchema.optional(),
  relatedStopId: IdSchema.optional(),
  relatedVehicleId: IdSchema.optional(),
  failureCode: z.string().optional(),
  createdAt: z.string().datetime(),
  entity: z.string(),
  location: z.string(),
  freshness: z.string(),
  recommendedAction: z.string(),
  acknowledged: z.boolean(),
  audit: z.array(AlertAuditEntrySchema),
});
export type AlertDto = z.infer<typeof AlertDtoSchema>;

export const FAILURE_REASON_CODES = [
  "RECIPIENT_UNAVAILABLE",
  "DELIVERY_REFUSED",
  "ADDRESS_ACCESS_PROBLEM",
  "ITEM_DAMAGED",
  "VEHICLE_OPERATIONAL_PROBLEM",
  "OTHER",
] as const;
export const FailureReasonCodeSchema = z.enum(FAILURE_REASON_CODES);
export type FailureReasonCode = z.infer<typeof FailureReasonCodeSchema>;

export const EVIDENCE_KINDS = ["signature", "photo", "failure_photo"] as const;
export const EvidenceKindSchema = z.enum(EVIDENCE_KINDS);
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

export const StopEvidenceDtoSchema = z.object({
  id: IdSchema,
  kind: EvidenceKindSchema,
  mimeType: z.string(),
  byteSize: z.number().int().positive(),
  contentHash: z.string(),
  capturedAt: z.string().datetime().optional(),
  uploadedBy: IdSchema.optional(),
  dataBase64: z.string().optional(),
});
export type StopEvidenceDto = z.infer<typeof StopEvidenceDtoSchema>;

export const EvidenceListSchema = z.object({
  evidence: z.array(StopEvidenceDtoSchema),
});
export type EvidenceList = z.infer<typeof EvidenceListSchema>;

export const ProofPolicySchema = z.object({
  serviceType: z.string(),
  requireRecipient: z.boolean(),
  requireSignature: z.boolean(),
  requirePhoto: z.boolean(),
  requireFailurePhoto: z.boolean(),
});
export type ProofPolicy = z.infer<typeof ProofPolicySchema>;

export const ServiceZoneSchema = z.object({
  id: IdSchema,
  name: z.string(),
  status: z.enum(["ok", "unexpected_exit", "no_arrivals"]),
  vehiclesInside: z.number().int().nonnegative(),
  note: z.string(),
});
export type ServiceZone = z.infer<typeof ServiceZoneSchema>;

export const OptimizedStopSchema = z.object({
  jobId: IdSchema,
  jobRef: z.string(),
  address: z.string(),
  stopType: z.enum(["pickup", "dropoff", "waypoint"]),
  arrivalAt: z.string().datetime(),
  feasible: z.boolean(),
});
export type OptimizedStop = z.infer<typeof OptimizedStopSchema>;

/**
 * Seeded demo proposal (docs/10.4): labelled simulated until the routing
 * engine ships in Phase 5. Metric values are the documented demo figures.
 */
export const OptimizationProposalSchema = z.object({
  runId: IdSchema,
  driverId: IdSchema,
  driverName: z.string(),
  demoMode: z.literal(true),
  engine: z.literal("seeded-demo"),
  engineVersion: z.string(),
  status: z.literal("succeeded"),
  published: z.boolean(),
  publishedAt: z.string().datetime().optional(),
  baseline: z.object({
    distanceMiles: z.number(),
    durationMinutes: z.number().int(),
    atRiskWindows: z.number().int(),
    stops: z.array(OptimizedStopSchema),
  }),
  proposal: z.object({
    distanceMiles: z.number(),
    durationMinutes: z.number().int(),
    feasibleWindows: z.boolean(),
    stops: z.array(OptimizedStopSchema),
  }),
  savedMinutes: z.number().int(),
  savedMiles: z.number(),
});
export type OptimizationProposal = z.infer<typeof OptimizationProposalSchema>;

export const LiveProposalStopSchema = z.object({
  jobId: IdSchema,
  jobRef: z.string(),
  stopId: IdSchema,
  stopType: z.enum(["pickup", "dropoff", "service"]),
  address: z.string(),
  /** Solver-provided arrival time; absent when the solver gave none. */
  arrivalAt: z.string().datetime().optional(),
});
export type LiveProposalStop = z.infer<typeof LiveProposalStopSchema>;

/**
 * Phase 5 live proposal from OSRM/VROOM. Arrival times are omitted until
 * the solver's schedule is validated for display; no ETAs are invented.
 */
export const LiveOptimizationProposalSchema = z.object({
  runId: IdSchema,
  driverId: IdSchema,
  driverName: z.string(),
  demoMode: z.literal(false),
  engine: z.literal("osrm+vroom"),
  engineVersion: z.string(),
  status: z.literal("succeeded"),
  published: z.boolean(),
  publishedAt: z.string().datetime().optional(),
  inputHash: z.string(),
  matrixSize: z.number().int().nonnegative(),
  proposal: z.object({
    distanceMetres: z.number().nonnegative(),
    durationSeconds: z.number().nonnegative(),
    stops: z.array(LiveProposalStopSchema),
    unassigned: z.array(IdSchema),
    geometry: z.array(GeoPointSchema).min(2),
  }),
});
export type LiveOptimizationProposal = z.infer<typeof LiveOptimizationProposalSchema>;

export const FleetProposedRouteSchema = z.object({
  driverId: IdSchema,
  vehicleId: IdSchema,
  driverName: z.string(),
  stops: z.array(LiveProposalStopSchema),
  geometry: z.array(GeoPointSchema).min(2),
  distanceMetres: z.number().nonnegative(),
  durationSeconds: z.number().nonnegative(),
});
export type FleetProposedRoute = z.infer<typeof FleetProposedRouteSchema>;

export const FleetOptimizationProposalSchema = z.object({
  runId: IdSchema,
  demoMode: z.literal(false),
  engine: z.literal("osrm+vroom"),
  engineVersion: z.string(),
  status: z.literal("succeeded"),
  scope: z.enum(["fleet", "subset"]),
  published: z.boolean(),
  publishedAt: z.string().datetime().optional(),
  publishedVersion: z.number().int().nonnegative().optional(),
  inputHash: z.string(),
  /** Fleet version the proposal must be approved against. */
  expectedRouteVersion: z.number().int().nonnegative(),
  matrixSize: z.number().int().nonnegative(),
  vehicleCount: z.number().int().nonnegative(),
  shipmentCount: z.number().int().nonnegative(),
  singleStopJobCount: z.number().int().nonnegative(),
  totalDistanceMetres: z.number().nonnegative(),
  totalDurationSeconds: z.number().nonnegative(),
  vehicles: z.array(FleetProposedRouteSchema),
  unassigned: z.array(
    z.object({ jobId: IdSchema, reason: z.string().optional() }),
  ),
  datasetVersion: z.string(),
  /** Current published plan at proposal time (Stage 2 baseline comparison). */
  baseline: z
    .object({
      routeCount: z.number().int().nonnegative(),
      assignedStops: z.number().int().nonnegative(),
      distanceMetres: z.number().nonnegative(),
      durationSeconds: z.number().nonnegative(),
      unassignedJobs: z.number().int().nonnegative(),
      jobIds: z.array(IdSchema).optional(),
    })
    .optional(),
  policy: z
    .object({
      revision: z.number().int().nonnegative(),
      preset: z.string(),
      effective: z.array(
        z.object({
          vehicleId: IdSchema,
          maxDistanceM: z.number().nonnegative(),
          maxTravelTimeS: z.number().nonnegative(),
          maxWorkingDurationS: z.number().nonnegative(),
          maxVisits: z.number().int().nonnegative(),
        }),
      ),
    })
    .optional(),
  /** Deterministic publish gate derived from baseline vs proposal. */
  gate: z
    .object({
      allowed: z.boolean(),
      reasons: z.array(z.string()),
    })
    .optional(),
});
export type FleetOptimizationProposal = z.infer<typeof FleetOptimizationProposalSchema>;

export const RouteWaypointSchema = z.object({
  /** Stable within a route version: routeId:waypoint:<sequence>. */
  id: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  kind: z.enum(["origin", "job_stop", "destination"]),
  jobStopId: IdSchema.optional(),
  jobId: IdSchema.optional(),
  stopType: z.enum(["pickup", "dropoff", "service"]).optional(),
  location: GeoPointSchema,
  /** Absolute planner arrival; null when the plan has no absolute basis. */
  plannedArrivalAt: z.string().datetime().nullable().optional(),
});
export type RouteWaypoint = z.infer<typeof RouteWaypointSchema>;

export const RouteStepSchema = z.object({
  /** Human-readable instruction derived from the OSRM manoeuvre. */
  instruction: z.string().min(1),
  maneuver: z.string().min(1),
  modifier: z.string().optional(),
  exit: z.number().int().nonnegative().optional(),
  roadName: z.string().optional(),
  distanceM: z.number().nonnegative(),
  durationS: z.number().nonnegative(),
  location: GeoPointSchema.optional(),
});
export type RouteStep = z.infer<typeof RouteStepSchema>;

export const RouteLegSchema = z.object({
  /** Stable within a route version: routeId:leg:<sequence>. */
  id: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  fromWaypointId: z.string().min(1),
  toWaypointId: z.string().min(1),
  /** Geometry assembled from the matching OSRM leg ordered steps. */
  points: z.array(GeoPointSchema).min(2),
  distanceM: z.number().nonnegative(),
  estimatedDurationS: z.number().nonnegative(),
  /** OSRM turn-by-turn steps, ordered within the leg. */
  steps: z.array(RouteStepSchema).optional(),
});
export type RouteLeg = z.infer<typeof RouteLegSchema>;

export const RoutePathSchema = z.object({
  vehicleId: IdSchema,
  driverId: IdSchema.optional(),
  points: z.array(GeoPointSchema).min(2),
  /** Server-assigned immutable route version (bumped on every publish). */
  version: z.number().int().nonnegative(),
  /** Optional for demo/legacy fixtures; PostgreSQL published routes provide them. */
  waypoints: z.array(RouteWaypointSchema).optional(),
  legs: z.array(RouteLegSchema).optional(),
});
export type RoutePath = z.infer<typeof RoutePathSchema>;

// --- Phase 4: authenticated device telemetry (docs/09) ----------------

export const TelemetrySampleSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  capturedAt: z.string().datetime(),
  accuracyMetres: z.number().nonnegative().max(5000).optional(),
  headingDeg: z.number().min(0).max(360).optional(),
  speedMps: z.number().nonnegative().max(120).optional(),
  /** Fused-position provenance and GNSS quality (native EKF). */
  source: z.enum(["gnss", "fused", "imu", "network"]).optional(),
  satellitesUsed: z.number().int().min(0).max(64).optional(),
  dualFrequency: z.boolean().optional(),
  carrierPhase: z.boolean().optional(),
  ekfConfidence: z.enum(["high", "medium", "low"]).optional(),
  /** RTK precision state; fixed/float can only come from a real solver. */
  rtkState: z.enum(["unsupported", "raw_ready", "corrections_ready", "rtk_float", "rtk_fixed"]).optional(),
  correctionAgeMs: z.number().int().nonnegative().optional(),
});
export type TelemetrySample = z.infer<typeof TelemetrySampleSchema>;

export const TelemetryBatchSchema = z.object({
  samples: z.array(TelemetrySampleSchema).min(1).max(50),
});
export type TelemetryBatch = z.infer<typeof TelemetryBatchSchema>;

export const TelemetryIngestResultSchema = z.object({
  accepted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  results: z.array(
    z.object({
      status: z.enum(["accepted", "stale", "invalid"]),
      capturedAt: z.string(),
      sequenceNo: z.number().int().optional(),
      reason: z.string().optional(),
    }),
  ),
  lastPosition: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
      capturedAt: z.string(),
      sequenceNo: z.number().int(),
    })
    .optional(),
});
export type TelemetryIngestResult = z.infer<typeof TelemetryIngestResultSchema>;

// --- Phase 2 auth contracts (docs/04, ADR-0005 auth decision) ---------

export const TenantSummarySchema = z.object({
  id: IdSchema,
  slug: z.string(),
  name: z.string(),
});
export type TenantSummary = z.infer<typeof TenantSummarySchema>;

export const AuthUserSchema = z.object({
  id: IdSchema,
  email: z.string().email(),
  role: z.enum(["owner", "dispatcher", "admin"]),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

export const AuthTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive(),
  tokenType: z.literal("Bearer"),
});
export type AuthTokens = z.infer<typeof AuthTokensSchema>;

export const AuthSessionSchema = z.object({
  tenant: TenantSummarySchema,
  user: AuthUserSchema,
  tokens: AuthTokensSchema,
});
export type AuthSession = z.infer<typeof AuthSessionSchema>;

export const RegisterRequestSchema = z.object({
  tenantName: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(10).max(200),
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z.object({
  tenantSlug: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const RefreshRequestSchema = z.object({
  refreshToken: z.string().min(20),
});
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

// --- Phase 3 driver device auth (docs/06) -----------------------------

export const DriverLoginRequestSchema = z.object({
  tenantSlug: z.string().min(1).max(120),
  driverId: IdSchema,
  pin: z.string().min(4).max(32),
});
export type DriverLoginRequest = z.infer<typeof DriverLoginRequestSchema>;

export const DriverSessionSchema = z.object({
  driver: DriverDtoSchema,
  tokens: AuthTokensSchema,
});
export type DriverSession = z.infer<typeof DriverSessionSchema>;

export const DriverQueueSchema = z.object({
  driver: DriverDtoSchema,
  jobs: z.array(JobDtoSchema),
});
export type DriverQueue = z.infer<typeof DriverQueueSchema>;


export const FleetStateSchema = z.object({
  tenantId: IdSchema,
  scenario: ScenarioNameSchema.optional(),
  demoMode: z.boolean(),
  drivers: z.array(DriverDtoSchema),
  vehicles: z.array(VehicleDtoSchema),
  jobs: z.array(JobDtoSchema),
  alerts: z.array(AlertDtoSchema),
  serviceZones: z.array(ServiceZoneSchema),
  routes: z.array(RoutePathSchema),
  /** Current authoritative route version for this tenant. */
  routeVersion: z.number().int().nonnegative(),
  serverTime: z.string().datetime(),
  publishedPlan: OptimizationProposalSchema.optional(),
});
export type FleetState = z.infer<typeof FleetStateSchema>;

/** Route geometry is fetched separately from the fleet summary/state. */
export const FleetRoutesResponseSchema = z.object({
  routes: z.array(RoutePathSchema),
  routeVersion: z.number().int().nonnegative(),
});
export type FleetRoutesResponse = z.infer<typeof FleetRoutesResponseSchema>;

export const ScenariosListSchema = z.object({
  scenarios: z.array(ScenarioNameSchema),
  current: ScenarioNameSchema,
});
export type ScenariosList = z.infer<typeof ScenariosListSchema>;

export const EtaCascadeEntrySchema = z.object({
  address: z.string(),
  arrivalDeltaMinutes: z.number().int(),
});
export type EtaCascadeEntry = z.infer<typeof EtaCascadeEntrySchema>;

export const AssignmentPreviewSchema = z.object({
  jobId: IdSchema,
  driverId: IdSchema,
  demoMode: z.boolean(),
  etaImpactMinutes: z.number().int().nonnegative(),
  message: z.string(),
  constraintsViolated: z.array(z.string()),
  etaCascade: z.array(EtaCascadeEntrySchema),
});
export type AssignmentPreview = z.infer<typeof AssignmentPreviewSchema>;

export const AssignRequestSchema = z.object({
  jobId: IdSchema,
  driverId: IdSchema,
});

export const AssignResponseSchema = z.object({
  jobId: IdSchema,
  driverId: IdSchema,
  vehicleId: IdSchema,
  status: z.literal("assigned"),
  etaImpactMinutes: z.number().int().nonnegative(),
});
export type AssignResponse = z.infer<typeof AssignResponseSchema>;



