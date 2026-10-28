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

export const AlertDtoSchema = z.object({
  id: IdSchema,
  severity: z.enum(["info", "at_risk", "urgent"]),
  title: z.string(),
  relatedJobId: IdSchema.optional(),
  relatedVehicleId: IdSchema.optional(),
  createdAt: z.string().datetime(),
  entity: z.string(),
  location: z.string(),
  freshness: z.string(),
  recommendedAction: z.string(),
  acknowledged: z.boolean(),
  audit: z.array(AlertAuditEntrySchema),
});
export type AlertDto = z.infer<typeof AlertDtoSchema>;

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

export const RoutePathSchema = z.object({
  vehicleId: IdSchema,
  driverId: IdSchema.optional(),
  points: z.array(GeoPointSchema).min(2),
  /** Server-assigned immutable route version (bumped on every publish). */
  version: z.number().int().nonnegative(),
});
export type RoutePath = z.infer<typeof RoutePathSchema>;

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
