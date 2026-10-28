/**
 * Route geometry fixture generator (demo data, clearly labelled).
 *
 * For every demo scenario and driver, fetches road-following geometry
 * from the public OSRM demo server through that driver's assigned stops
 * (pickup then dropoff, in assignment order, starting at the driver
 * position) and writes a committed fixture so the demo never depends on
 * live routing. It is an out-and-back circuit so the simulator loops.
 *
 * Quality rules (docs/17, diagnostic steps):
 * - request full-resolution GeoJSON (`overview=full`, `geometries=geojson`);
 * - constrain snapping with `radiuses=120` per waypoint (never snap across
 *   blocks or onto service roads far from the stop);
 * - record each waypoint's snap distance so alignment is auditable;
 * - simplify with a 1.5 m Douglas-Peucker tolerance instead of dropping
 *   every Nth vertex, so corners follow the road centreline.
 *
 * Regenerate with:
 *   pnpm --filter @privatefleet/api exec tsx src/db/fetch-route-geometry.ts
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ScenarioName } from "@privatefleet/contracts";
import { DRIVER_SEEDS, JOB_SEEDS } from "../modules/demo/data.js";
import { SCENARIO_ASSIGNMENTS } from "../modules/demo/assignments.js";

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, "..", "modules", "demo", "route-geometry.ts");

interface GeoPoint {
  latitude: number;
  longitude: number;
}

const SCENARIOS: ScenarioName[] = ["morning-rush", "emergency", "proof"];

/** Snap search radius per waypoint (metres). */
const SNAP_RADIUS_M = 120;
/** Maximum accepted waypoint snap distance (metres). */
const MAX_SNAP_M = 100;
/** Geometry simplification tolerance (metres). */
const SIMPLIFY_TOLERANCE_M = 1.5;

/** Metres between two WGS84 points (degrees scaled by metres/degree). */
function distanceMetres(a: GeoPoint, b: GeoPoint): number {
  const dLat = b.latitude - a.latitude;
  const dLon = b.longitude - a.longitude;
  const latRad = ((a.latitude + b.latitude) / 2) * (Math.PI / 180);
  const x = dLon * 111_320 * Math.cos(latRad);
  const y = dLat * 110_540;
  return Math.sqrt(x * x + y * y);
}

/** Local flat projection to metres for segment-distance math. */
function toLocalMetres(points: GeoPoint[], origin: GeoPoint): Array<{ x: number; y: number }> {
  const lonScale = 111_320 * Math.cos((origin.latitude * Math.PI) / 180);
  return points.map((point) => ({
    x: (point.longitude - origin.longitude) * lonScale,
    y: (point.latitude - origin.latitude) * 110_540,
  }));
}

function pointSegmentDistance(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  let t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

/** Douglas-Peucker simplification in metres; endpoints always kept. */
function simplify(points: GeoPoint[], toleranceMetres: number): GeoPoint[] {
  if (points.length <= 2) {
    return points;
  }
  const origin = points[0];
  if (!origin) {
    return points;
  }
  const local = toLocalMetres(points, origin);
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const range = stack.pop();
    if (!range) {
      break;
    }
    const [start, end] = range;
    let maxDistance = 0;
    let maxIndex = -1;
    for (let index = start + 1; index < end; index += 1) {
      const point = local[index];
      const first = local[start];
      const last = local[end];
      if (!point || !first || !last) {
        continue;
      }
      const distance = pointSegmentDistance(point, first, last);
      if (distance > maxDistance) {
        maxDistance = distance;
        maxIndex = index;
      }
    }
    if (maxDistance > toleranceMetres && maxIndex > 0) {
      keep[maxIndex] = true;
      stack.push([start, maxIndex], [maxIndex, end]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

interface OsrmResult {
  geometry: GeoPoint[];
  snapped: GeoPoint[];
}

async function osrmRoute(waypoints: GeoPoint[]): Promise<OsrmResult> {
  const coords = waypoints.map((p) => `${p.longitude},${p.latitude}`).join(";");
  const radiuses = waypoints.map(() => String(SNAP_RADIUS_M)).join(";");
  const url =
    `https://router.project-osrm.org/route/v1/driving/${coords}` +
    `?geometries=geojson&overview=full&continue_straight=false&radiuses=${radiuses}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`OSRM ${res.status} for ${url}`);
  }
  const body = (await res.json()) as {
    routes?: Array<{ geometry: { coordinates: Array<[number, number]> } }>;
    waypoints?: Array<{ location: [number, number] | { latitude?: number; longitude?: number; lat?: number; lon?: number } }>;
  };
  const coordinates = body.routes?.[0]?.geometry.coordinates;
  if (!coordinates) {
    throw new Error("OSRM returned no route geometry");
  }
  const geometry = coordinates.map(([longitude, latitude]) => ({ latitude, longitude }));
  // Demo servers have returned both a [lon, lat] tuple and an object here.
  const snapped = (body.waypoints ?? []).map((waypoint) => {
    const location = waypoint.location;
    if (Array.isArray(location)) {
      return { latitude: location[1] as number, longitude: location[0] as number };
    }
    return {
      latitude: (location.latitude ?? location.lat) as number,
      longitude: (location.longitude ?? location.lon) as number,
    };
  });
  return { geometry, snapped };
}

/** First index at/after `from` within tolerance of the waypoint. */
function waypointIndex(points: GeoPoint[], waypoint: GeoPoint, from: number): number {
  for (let index = from; index < points.length; index += 1) {
    const point = points[index];
    if (point && distanceMetres(point, waypoint) <= 120) {
      return index;
    }
  }
  return -1;
}

function driverWaypoints(scenario: ScenarioName, driver: number): GeoPoint[] {
  const seed = DRIVER_SEEDS[driver];
  if (!seed) {
    return [];
  }
  const points: GeoPoint[] = [{ ...seed.start }];
  for (const assignment of SCENARIO_ASSIGNMENTS[scenario].filter((a) => a.driver === driver)) {
    const job = JOB_SEEDS.find((candidate) => candidate.reference === assignment.ref);
    if (!job) {
      continue;
    }
    points.push({ latitude: job.pickup.latitude, longitude: job.pickup.longitude });
    points.push({ latitude: job.dropoff.latitude, longitude: job.dropoff.longitude });
  }
  // OSRM rejects duplicate consecutive coordinates; jobs can share a
  // stop location (e.g. consecutive drops at the same site).
  return points.filter(
    (point, index) => index === 0 || distanceMetres(points[index - 1]!, point) > 1,
  );
}

async function main(): Promise<void> {
  const lines: string[] = [];
  lines.push("/**");
  lines.push(" * DEMO ROUTE GEOMETRY - precomputed with the public OSRM demo");
  lines.push(" * server and committed as fixtures (docs/16.5, docs/17, ADR-0013).");
  lines.push(" * Full-resolution road geometry, 1.5 m Douglas-Peucker simplified,");
  lines.push(" * with waypoint snap distances recorded for alignment auditing.");
  lines.push(" * Explicitly demo data; Phase 5 replaces it with live OSRM/VROOM.");
  lines.push(" * Generated by src/db/fetch-route-geometry.ts - do not edit by hand.");
  lines.push(" */");
  lines.push('import type { GeoPoint } from "@privatefleet/contracts";');
  lines.push("");
  lines.push("export interface DemoRoute {");
  lines.push("  points: GeoPoint[];");
  lines.push("  /** Outbound indices of the engine-snapped waypoints, in order. */");
  lines.push("  waypoints: number[];");
  lines.push("  /** Snap distance in metres for each requested waypoint. */");
  lines.push("  snapMetres: number[];");
  lines.push("}");
  lines.push("");
  lines.push("export const ROUTE_GEOMETRY: Record<string, Record<string, DemoRoute>> = {");

  for (const scenario of SCENARIOS) {
    lines.push(`  "${scenario}": {`);
    for (const [driverIndex, seed] of DRIVER_SEEDS.entries()) {
      const requested = driverWaypoints(scenario, driverIndex);
      if (requested.length < 2) {
        continue;
      }
      const { geometry, snapped } = await osrmRoute(requested);
      const snapMetres = requested.map((waypoint, index) => {
        const snap = snapped[index];
        return snap ? Number(distanceMetres(waypoint, { ...snap }).toFixed(1)) : -1;
      });
      const worstSnap = Math.max(...snapMetres);
      if (worstSnap > MAX_SNAP_M || snapMetres.some((value) => value < 0)) {
        throw new Error(
          `${scenario}/${seed.vehicleRegistration}: waypoint snap ${worstSnap} m exceeds ${MAX_SNAP_M} m`,
        );
      }
      const simplified = simplify(geometry, SIMPLIFY_TOLERANCE_M);
      // Out-and-back circuit so the simulator loops without teleporting.
      const inbound = [...simplified].reverse().slice(1);
      const circuit = [...simplified, ...inbound];

      const indices: number[] = [];
      let cursor = 0;
      for (const waypoint of requested) {
        const index = waypointIndex(simplified, waypoint, cursor);
        if (index < 0) {
          throw new Error(
            `${scenario}/${seed.vehicleRegistration}: OSRM route does not pass waypoints in order`,
          );
        }
        indices.push(index);
        cursor = index;
      }

      lines.push(`    // driver ${driverIndex}: ${seed.vehicleRegistration}`);
      lines.push(`    "${seed.vehicleId}": {`);
      lines.push(`      waypoints: [${indices.join(", ")}],`);
      lines.push(`      snapMetres: [${snapMetres.join(", ")}],`);
      lines.push("      points: [");
      for (const point of circuit) {
        lines.push(`        { latitude: ${point.latitude}, longitude: ${point.longitude} },`);
      }
      lines.push("      ],");
      lines.push("    },");
      console.log(
        `${scenario}/${seed.vehicleRegistration}: ${circuit.length} points, max snap ${worstSnap} m`,
      );
    }
    lines.push("  },");
  }
  lines.push("};");
  lines.push("");
  writeFileSync(target, lines.join("\n"), "utf8");
  console.log(`wrote ${target}`);
}

await main();



