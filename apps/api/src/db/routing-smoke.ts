/**
 * One-off live smoke for the routing adapters (not a CI test):
 * validates the OSRM request/response shape against a real server.
 */
import { OsrmClient } from "../modules/routing/osrm.js";

const base = process.env.OSRM_BASE_URL ?? "https://router.project-osrm.org";
const osrm = new OsrmClient(base);
const points = [
  { latitude: 51.515, longitude: -0.132 },
  { latitude: 51.5204, longitude: -0.1046 },
  { latitude: 51.5265, longitude: -0.078 },
];
const matrix = await osrm.matrix(points);
const route = await osrm.route(points);
console.log(
  JSON.stringify({
    base,
    matrix: `${matrix.durations.length}x${matrix.durations[0]?.length}`,
    routePoints: route.points.length,
    distanceMetres: Math.round(route.distanceMetres),
    durationSeconds: Math.round(route.durationSeconds),
    firstPoint: route.points[0],
  }),
);
