/**
 * Route source management for the map engine (docs/17): validation,
 * last-valid-route retention and change detection so static geometry is
 * not re-serialised on every GPS update.
 */
import { routeSignature, validateRoutePath, type RoutePathLike } from "./geo.js";

export interface RouteSet {
  routes: RoutePathLike[];
  /** Combined signature; unchanged means the map source can be left alone. */
  signature: string;
  /** Routes dropped because they failed validation (never drawn). */
  invalidCount: number;
  /** True when a previous valid set is retained after a bad update. */
  usedFallback: boolean;
}

export function routesSignature(routes: RoutePathLike[]): string {
  return routes
    .map((route) => routeSignature(route))
    .sort()
    .join("|");
}

/**
 * Reconciles an incoming route set with the last known-good set.
 * - All routes valid -> adopt them.
 * - Some routes invalid -> draw only valid ones (invalidCount reported).
 * - None valid (or none at all) -> retain the last valid set and flag
 *   fallback; a routing failure must never erase a valid route.
 */
export function reconcileRoutes(
  previousValid: RoutePathLike[],
  incoming: RoutePathLike[],
): RouteSet {
  const valid: RoutePathLike[] = [];
  let invalidCount = 0;
  for (const route of incoming) {
    const result = validateRoutePath(route);
    if (result.valid) {
      valid.push(route);
    } else {
      invalidCount += 1;
    }
  }

  const adopt = valid.length > 0;
  const routes = adopt ? valid : previousValid;
  return {
    routes,
    signature: routesSignature(routes),
    invalidCount,
    usedFallback: !adopt && previousValid.length > 0,
  };
}

/** True when the geometry changed and the map source must be updated. */
export function routesChanged(previousSignature: string, nextSignature: string): boolean {
  return previousSignature !== nextSignature;
}
