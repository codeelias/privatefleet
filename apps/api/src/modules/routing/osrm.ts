/**
 * OSRM HTTP adapter (docs/10.1): table for matrices, route for road
 * geometry. Every response is validated before it can influence a plan.
 */
import type { GeoPoint } from "@privatefleet/contracts";
import {
  isValidPoint,
  RoutingError,
  type OsrmMatrix,
  type OsrmRoute,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 8_000;

interface TableResponse {
  code?: string;
  durations?: Array<Array<number | null>>;
  distances?: Array<Array<number | null>>;
}

interface RouteResponse {
  code?: string;
  routes?: Array<{
    distance?: number;
    duration?: number;
    geometry?: { coordinates?: Array<[number, number]> };
  }>;
}

export class OsrmClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  private coordinates(points: GeoPoint[]): string {
    for (const point of points) {
      if (!isValidPoint(point)) {
        throw new RoutingError("ROUTING_INVALID_RESPONSE", "invalid input coordinate");
      }
    }
    return points.map((point) => `${point.longitude},${point.latitude}`).join(";");
  }

  private async getJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn(url, { signal: controller.signal });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new RoutingError(
          "OSRM_UNAVAILABLE",
          `OSRM responded ${response.status}${detail ? ": " + detail.slice(0, 220) : ""}`,
        );
      }
      return (await response.json()) as unknown;
    } catch (err) {
      if (err instanceof RoutingError) {
        throw err;
      }
      throw new RoutingError("OSRM_UNAVAILABLE", "OSRM could not be reached");
    } finally {
      clearTimeout(timer);
    }
  }

  async matrix(points: GeoPoint[]): Promise<OsrmMatrix> {
    if (points.length < 2) {
      throw new RoutingError("ROUTING_INVALID_RESPONSE", "matrix needs at least two points");
    }
    const url = `${this.baseUrl.replace(/\/$/, "")}/table/v1/driving/${this.coordinates(
      points,
    )}?annotations=duration,distance`;
    const body = (await this.getJson(url)) as TableResponse;
    if (body.code !== "Ok" || !body.durations || !body.distances) {
      throw new RoutingError("ROUTING_INVALID_RESPONSE", "OSRM table response is invalid");
    }
    const size = points.length;
    if (body.durations.length !== size || body.distances.length !== size) {
      throw new RoutingError("ROUTING_INVALID_RESPONSE", "OSRM matrix dimensions mismatch");
    }
    const durations = body.durations.map((row) => {
      if (row.length !== size || row.some((value) => !Number.isFinite(value))) {
        throw new RoutingError("ROUTING_INVALID_RESPONSE", "OSRM durations are not finite");
      }
      return row as number[];
    });
    const distances = body.distances.map((row) => {
      if (row.length !== size || row.some((value) => !Number.isFinite(value))) {
        throw new RoutingError("ROUTING_INVALID_RESPONSE", "OSRM distances are not finite");
      }
      return row as number[];
    });
    return { durations, distances };
  }

  async route(points: GeoPoint[]): Promise<OsrmRoute> {
    if (points.length < 2) {
      throw new RoutingError("ROUTING_INVALID_RESPONSE", "route needs at least two points");
    }
    const url =
      `${this.baseUrl.replace(/\/$/, "")}/route/v1/driving/${this.coordinates(points)}` +
      "?overview=full&geometries=geojson&steps=false";
    const body = (await this.getJson(url)) as RouteResponse;
    if (body.code !== "Ok") {
      throw new RoutingError("OSRM_UNAVAILABLE", "OSRM could not route the plan");
    }
    const route = body.routes?.[0];
    const coordinates = route?.geometry?.coordinates;
    if (!route || !coordinates || coordinates.length < 2) {
      throw new RoutingError("ROUTING_INVALID_RESPONSE", "OSRM route geometry missing");
    }
    const geometry = coordinates.map(([longitude, latitude]) => ({ latitude, longitude }));
    return {
      points: geometry,
      distanceMetres: Number(route.distance ?? 0),
      durationSeconds: Number(route.duration ?? 0),
    };
  }
}

