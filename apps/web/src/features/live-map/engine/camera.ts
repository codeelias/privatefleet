/**
 * Camera planning for follow mode. Kept pure so adaptive zoom and look-ahead
 * are testable independently of MapLibre/Leaflet.
 */
import type { GeoPoint } from "@privatefleet/contracts";

export interface CameraPlan {
  center: GeoPoint;
  zoom: number;
  bearing: number;
  lookAheadM: number;
}

export function adaptiveFollowZoom(speedMps: number): number {
  if (!Number.isFinite(speedMps) || speedMps < 0) return 16;
  if (speedMps >= 18) return 13.8;
  if (speedMps >= 12) return 14.2;
  if (speedMps >= 5) return 15.1;
  return 16;
}

export function planFollowCamera(
  point: GeoPoint,
  headingDeg: number,
  speedMps: number,
  bearingUp: boolean,
): CameraPlan {
  const speed = Number.isFinite(speedMps) ? Math.max(0, Math.min(40, speedMps)) : 0;
  const heading = Number.isFinite(headingDeg) ? ((headingDeg % 360) + 360) % 360 : 0;
  const lookAheadM = Math.min(70, 18 + speed * 3);
  const bearingRad = (heading * Math.PI) / 180;
  const latitude = point.latitude + (Math.cos(bearingRad) * lookAheadM) / 110_540;
  const longitude =
    point.longitude +
    (Math.sin(bearingRad) * lookAheadM) /
      (111_320 * Math.cos((point.latitude * Math.PI) / 180));
  return {
    center: { latitude, longitude },
    zoom: adaptiveFollowZoom(speed),
    bearing: bearingUp ? heading : 0,
    lookAheadM,
  };
}
