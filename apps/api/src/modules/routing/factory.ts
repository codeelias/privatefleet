/**
 * Routing client factory: live providers are enabled only when both
 * endpoints are configured. Demo keeps fixtures and never reaches here.
 */
import { OsrmClient } from "./osrm.js";
import { VroomClient } from "./vroom.js";
import { RoutingError, type RoutingClients } from "./types.js";

export interface RoutingEndpoints {
  osrmBaseUrl?: string | undefined;
  vroomBaseUrl?: string | undefined;
}

export function createRoutingClients(
  endpoints: RoutingEndpoints,
  fetchFn: typeof fetch = fetch,
): RoutingClients {
  if (!endpoints.osrmBaseUrl || !endpoints.vroomBaseUrl) {
    throw new RoutingError(
      "ROUTING_NOT_CONFIGURED",
      "OSRM_BASE_URL and VROOM_BASE_URL must both be configured",
    );
  }
  const osrm = new OsrmClient(endpoints.osrmBaseUrl, fetchFn);
  const vroom = new VroomClient(endpoints.vroomBaseUrl, fetchFn);
  return {
    matrix: (points) => osrm.matrix(points),
    route: (points) => osrm.route(points),
    solve: (vehicles, shipments, matrices, locationCount) =>
      vroom.solve(vehicles, shipments, matrices, locationCount),
  };
}
