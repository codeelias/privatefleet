/**
 * Canonical domain vocabulary shared by api, web and driver.
 * Values mirror the database CHECK constraints in docs/07 and the
 * state machines in docs/08 - the documentation is the source of truth.
 */
import { z } from "zod";

export const JOB_STATUS = [
  "unassigned",
  "assigned",
  "in_progress",
  "completed",
  "cancelled",
  "failed",
] as const;
export const JobStatusSchema = z.enum(JOB_STATUS);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JOB_PRIORITY = ["standard", "urgent", "stat"] as const;
export const JobPrioritySchema = z.enum(JOB_PRIORITY);
export type JobPriority = z.infer<typeof JobPrioritySchema>;

export const STOP_TYPE = ["pickup", "dropoff", "waypoint"] as const;
export const StopTypeSchema = z.enum(STOP_TYPE);
export type StopType = z.infer<typeof StopTypeSchema>;

export const STOP_STATUS = [
  "pending",
  "arrived",
  "completed",
  "skipped",
  "failed",
] as const;
export const StopStatusSchema = z.enum(STOP_STATUS);
export type StopStatus = z.infer<typeof StopStatusSchema>;

export const ROUTE_STATUS = [
  "draft",
  "published",
  "in_progress",
  "completed",
  "superseded",
  "cancelled",
] as const;
export const RouteStatusSchema = z.enum(ROUTE_STATUS);
export type RouteStatus = z.infer<typeof RouteStatusSchema>;

export const DRIVER_STATUS = [
  "available",
  "on_route",
  "off_duty",
  "suspended",
] as const;
export const DriverStatusSchema = z.enum(DRIVER_STATUS);
export type DriverStatus = z.infer<typeof DriverStatusSchema>;

export const VEHICLE_STATUS = [
  "available",
  "on_route",
  "maintenance",
  "inactive",
] as const;
export const VehicleStatusSchema = z.enum(VEHICLE_STATUS);
export type VehicleStatus = z.infer<typeof VehicleStatusSchema>;

export const AlertSeveritySchema = z.enum(["info", "at_risk", "urgent"]);
export type AlertSeverity = z.infer<typeof AlertSeveritySchema>;

export const IdSchema = z.string().uuid();

export const GeoPointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type GeoPoint = z.infer<typeof GeoPointSchema>;

export const JobStopDtoSchema = z.object({
  id: IdSchema,
  jobId: IdSchema,
  sequenceNo: z.number().int().positive(),
  stopType: StopTypeSchema,
  address: z.string(),
  location: GeoPointSchema,
  status: StopStatusSchema,
  windowStart: z.string().datetime().optional(),
  windowEnd: z.string().datetime().optional(),
  arrivedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  failureCode: z.string().optional(),
  failureNote: z.string().optional(),
  /**
   * Evidence-derived delivery confidence for terminal stops: score 0-100
   * plus the contributing factors. Only present for completed / skipped /
   * failed stops.
   */
  deliveryConfidence: z
    .object({
      score: z.number().int().min(0).max(100),
      factors: z.array(z.string()),
    })
    .optional(),
});
export type JobStopDto = z.infer<typeof JobStopDtoSchema>;

export const JobDtoSchema = z.object({
  id: IdSchema,
  reference: z.string(),
  serviceType: z.string(),
  priority: JobPrioritySchema,
  status: JobStatusSchema,
  stops: z.array(JobStopDtoSchema),
  assignedDriverId: IdSchema.optional(),
  assignedVehicleId: IdSchema.optional(),
  version: z.number().int().positive(),
});
export type JobDto = z.infer<typeof JobDtoSchema>;

export const DriverDtoSchema = z.object({
  id: IdSchema,
  fullName: z.string(),
  status: DriverStatusSchema,
  vehicleId: IdSchema.optional(),
  lastPingAt: z.string().datetime().optional(),
});
export type DriverDto = z.infer<typeof DriverDtoSchema>;

export const VehicleDtoSchema = z.object({
  id: IdSchema,
  registration: z.string(),
  vehicleType: z.string(),
  status: VehicleStatusSchema,
  driverId: IdSchema.optional(),
  location: GeoPointSchema.optional(),
  stale: z.boolean().default(false),
  /** Explicit location provenance; stale is never treated as live. */
  locationStatus: z.enum(["live", "stale", "unknown"]).optional(),
  lastSeenAt: z.string().datetime().optional(),
  /** Device-reported horizontal accuracy in metres, when available. */
  accuracyMetres: z.number().nonnegative().max(5000).optional(),
  /** Device-reported heading in degrees clockwise from north. */
  headingDeg: z.number().min(0).max(360).optional(),
  /** Device-reported ground speed in metres per second. */
  speedMps: z.number().nonnegative().max(120).optional(),
  /** Fused-position provenance and raw-GNSS quality. */
  positionSource: z.enum(["gnss", "fused", "imu", "network"]).optional(),
  satellitesUsed: z.number().int().min(0).max(64).optional(),
  dualFrequency: z.boolean().optional(),
  carrierPhase: z.boolean().optional(),
  ekfConfidence: z.enum(["high", "medium", "low"]).optional(),
  /** RTK precision state from the native pipeline. */
  rtkState: z.enum(["unsupported", "raw_ready", "corrections_ready", "rtk_float", "rtk_fixed"]).optional(),
  correctionAgeMs: z.number().int().nonnegative().optional(),
  /** Stationary-aware classification (unknown/stationary/moving). */
  movementState: z.enum(["unknown", "stationary", "moving"]).optional(),
});
export type VehicleDto = z.infer<typeof VehicleDtoSchema>;


