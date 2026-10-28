/**
 * Coordinate-order boundary (docs/17). OSRM/GeoJSON use [longitude,
 * latitude]; Leaflet uses [latitude, longitude]. Every conversion goes
 * through these named helpers so a swapped axis is a type-level mistake,
 * not a silent 200 km drift.
 */
import type { GeoPoint } from "./geo.js";

export type LngLat = [longitude: number, latitude: number];
export type LatLng = [latitude: number, longitude: number];

/** OSRM / GeoJSON LineString order. */
export function toGeoJsonCoordinates(points: GeoPoint[]): LngLat[] {
  return points.map((point) => [point.longitude, point.latitude]);
}

/** Leaflet LatLng order. */
export function toLeafletLatLngs(points: GeoPoint[]): LatLng[] {
  return points.map((point) => [point.latitude, point.longitude]);
}
