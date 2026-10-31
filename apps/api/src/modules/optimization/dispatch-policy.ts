/**
 * Smart Dispatch policy presets and deterministic resolution.
 * A preset is only a starting point: every effective limit is explicit,
 * versioned and resolved through one function used by optimisation and the
 * publication gate.
 */

export type DispatchPreset = "local" | "balanced" | "extended";

export interface DispatchPolicy {
  preset: DispatchPreset;
  maxDistanceM: number;
  maxTravelTimeS: number;
  /** Travel + waiting + service + breaks; never folded into travel time. */
  maxWorkingDurationS: number;
  maxVisits: number;
  version: number;
}

export interface VehiclePolicyOverride {
  maxDistanceM?: number | undefined;
  maxTravelTimeS?: number | undefined;
  maxWorkingDurationS?: number | undefined;
  maxVisits?: number | undefined;
}

export const PRESET_VALUES: Record<
  DispatchPreset,
  Omit<DispatchPolicy, "preset" | "version">
> = {
  local: {
    maxDistanceM: 120_000,
    maxTravelTimeS: 5 * 3600,
    maxWorkingDurationS: 7 * 3600,
    maxVisits: 30,
  },
  balanced: {
    maxDistanceM: 200_000,
    maxTravelTimeS: 9 * 3600,
    maxWorkingDurationS: 10 * 3600,
    maxVisits: 50,
  },
  extended: {
    maxDistanceM: 300_000,
    maxTravelTimeS: 11 * 3600,
    maxWorkingDurationS: 12 * 3600,
    maxVisits: 70,
  },
};

export class DispatchPolicyError extends Error {
  constructor(readonly code: "POLICY_INVALID") {
    super(code);
  }
}

export function presetPolicy(preset: DispatchPreset, version = 1): DispatchPolicy {
  return { preset, version, ...PRESET_VALUES[preset] };
}

/** One deterministic resolution path; later values must never silently win. */
export function resolveVehiclePolicy(
  base: DispatchPolicy,
  override: VehiclePolicyOverride | undefined,
): DispatchPolicy {
  if (!override) return base;
  return {
    preset: base.preset,
    version: base.version,
    maxDistanceM: override.maxDistanceM ?? base.maxDistanceM,
    maxTravelTimeS: override.maxTravelTimeS ?? base.maxTravelTimeS,
    maxWorkingDurationS:
      override.maxWorkingDurationS ?? base.maxWorkingDurationS,
    maxVisits: override.maxVisits ?? base.maxVisits,
  };
}

export function validatePolicy(policy: DispatchPolicy): void {
  const valid =
    Number.isInteger(policy.maxDistanceM) &&
    policy.maxDistanceM > 0 &&
    policy.maxDistanceM <= 1_000_000 &&
    Number.isInteger(policy.maxTravelTimeS) &&
    policy.maxTravelTimeS > 0 &&
    policy.maxTravelTimeS <= 24 * 3600 &&
    Number.isInteger(policy.maxWorkingDurationS) &&
    policy.maxWorkingDurationS >= policy.maxTravelTimeS &&
    policy.maxWorkingDurationS <= 24 * 3600 &&
    Number.isInteger(policy.maxVisits) &&
    policy.maxVisits > 0 &&
    policy.maxVisits <= 500;
  if (!valid) throw new DispatchPolicyError("POLICY_INVALID");
}

/** Legacy pilot defaults until the policy table is wired into optimisation. */
export const DISPATCH_LIMITS = {
  maxRouteDistanceM: PRESET_VALUES.balanced.maxDistanceM,
  maxRouteTravelTimeS: PRESET_VALUES.balanced.maxTravelTimeS,
  maxRouteTasks: PRESET_VALUES.balanced.maxVisits,
} as const;

