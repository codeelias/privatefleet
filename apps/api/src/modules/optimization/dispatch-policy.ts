/**
 * Smart Dispatch hard limits (tenant defaults; env-overridable for the pilot).
 * These are enforced by VROOM so infeasible work stays unassigned instead of
 * being forced into an overloaded route.
 */
export const DISPATCH_LIMITS = {
  maxRouteDistanceM: Math.round(Number(process.env.DISPATCH_MAX_ROUTE_KM ?? 200) * 1000),
  maxRouteTravelTimeS: Math.round(Number(process.env.DISPATCH_MAX_TRAVEL_HOURS ?? 9) * 3600),
  maxRouteTasks: Math.max(1, Math.round(Number(process.env.DISPATCH_MAX_STOPS ?? 50))),
} as const;
