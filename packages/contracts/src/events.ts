/**
 * Event contracts (docs/08.4 catalog). Every durable business event
 * carries eventId + schemaVersion; consumers must dedupe on eventId
 * and ignore unknown fields (forward compatibility).
 */
import { z } from "zod";
import { IdSchema } from "./domain.js";

export const EVENT_SCHEMA_VERSION = 1;

export const EventEnvelopeSchema = z.object({
  eventId: IdSchema,
  schemaVersion: z.literal(EVENT_SCHEMA_VERSION),
  tenantId: IdSchema,
  aggregateType: z.string(),
  aggregateId: IdSchema,
  type: z.string(),
  occurredAt: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()),
});
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

export const JobAssignedPayloadSchema = z.object({
  jobId: IdSchema,
  driverId: IdSchema,
  vehicleId: IdSchema,
  routeId: IdSchema,
  etaImpactMinutes: z.number(),
});
export type JobAssignedPayload = z.infer<typeof JobAssignedPayloadSchema>;

export const StopArrivedPayloadSchema = z.object({
  jobId: IdSchema,
  stopId: IdSchema,
  driverId: IdSchema,
  capturedAt: z.string().datetime(),
  receivedAt: z.string().datetime(),
});
export type StopArrivedPayload = z.infer<typeof StopArrivedPayloadSchema>;

export const AlertRaisedPayloadSchema = z.object({
  severity: z.enum(["info", "at_risk", "urgent"]),
  title: z.string(),
  relatedJobId: IdSchema.optional(),
  relatedVehicleId: IdSchema.optional(),
});
export type AlertRaisedPayload = z.infer<typeof AlertRaisedPayloadSchema>;

/** Telemetry (non-durable, snapshot-recoverable; docs/09.1). */
export const VehiclePositionSchema = z.object({
  vehicleId: IdSchema,
  driverId: IdSchema,
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  headingDeg: z.number().optional(),
  capturedAt: z.string().datetime(),
  sequenceNo: z.number().int(),
  stale: z.boolean().optional(),
  accuracyMetres: z.number().nonnegative().optional(),
  speedMps: z.number().nonnegative().optional(),
  source: z.enum(["gnss", "fused", "imu", "network"]).optional(),
  satellitesUsed: z.number().int().min(0).max(64).optional(),
  dualFrequency: z.boolean().optional(),
  carrierPhase: z.boolean().optional(),
  ekfConfidence: z.enum(["high", "medium", "low"]).optional(),
  rtkState: z.enum(["unsupported", "raw_ready", "corrections_ready", "rtk_float", "rtk_fixed"]).optional(),
  correctionAgeMs: z.number().int().nonnegative().optional(),
});
export type VehiclePosition = z.infer<typeof VehiclePositionSchema>;
