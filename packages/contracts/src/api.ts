/**
 * REST request/response contracts shared by api and web (ADR-0003).
 * Demo scenarios and the fleet snapshot follow docs/12.2 fixtures.
 */
import { z } from "zod";
import {
  DriverDtoSchema,
  IdSchema,
  JobDtoSchema,
  VehicleDtoSchema,
} from "./domain.js";

export const SCENARIO_NAMES = ["morning-rush", "emergency", "proof"] as const;
export const ScenarioNameSchema = z.enum(SCENARIO_NAMES);
export type ScenarioName = z.infer<typeof ScenarioNameSchema>;

export const AlertDtoSchema = z.object({
  id: IdSchema,
  severity: z.enum(["info", "at_risk", "urgent"]),
  title: z.string(),
  relatedJobId: IdSchema.optional(),
  relatedVehicleId: IdSchema.optional(),
  createdAt: z.string().datetime(),
});
export type AlertDto = z.infer<typeof AlertDtoSchema>;

export const FleetStateSchema = z.object({
  tenantId: IdSchema,
  scenario: ScenarioNameSchema.optional(),
  demoMode: z.boolean(),
  drivers: z.array(DriverDtoSchema),
  vehicles: z.array(VehicleDtoSchema),
  jobs: z.array(JobDtoSchema),
  alerts: z.array(AlertDtoSchema),
  serverTime: z.string().datetime(),
});
export type FleetState = z.infer<typeof FleetStateSchema>;

export const ScenariosListSchema = z.object({
  scenarios: z.array(ScenarioNameSchema),
  current: ScenarioNameSchema,
});
export type ScenariosList = z.infer<typeof ScenariosListSchema>;

export const AssignmentPreviewSchema = z.object({
  jobId: IdSchema,
  driverId: IdSchema,
  demoMode: z.boolean(),
  etaImpactMinutes: z.number().int().nonnegative(),
  message: z.string(),
  constraintsViolated: z.array(z.string()),
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
