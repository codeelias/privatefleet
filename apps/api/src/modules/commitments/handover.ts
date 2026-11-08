/**
 * Independent handover evidence (docs/56 section 9): builds the SERVER-clock
 * bracket that alone may establish a delivery timing class. The device and
 * server timestamps being close together proves only that RECORDS arrived
 * close together - so this module ignores the device clock entirely and uses
 * two server-clock records:
 *   start = receipt time of a position fix within the completion radius of
 *           the stop shortly before the completion record arrived
 *   end   = receipt time of the completion evidence itself
 * Without a qualifying position fix there is no independent evidence of
 * physical presence and the caller must report timing_unverified.
 */
import { sql } from "drizzle-orm";
import { withTenant } from "../../db/client.js";

type TxDb = Parameters<Parameters<typeof withTenant>[2]>[0];

const PRESENCE_WINDOW_MINUTES = 30;
export const DEFAULT_HANDOVER_RADIUS_M = 100;

function haversineMetres(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export interface HandoverStopFacts {
  latitude: number;
  longitude: number;
}

/**
 * Returns the server-clock handover bracket, or null when no independent
 * presence evidence exists.
 */
export async function independentHandoverBracket(
  db: TxDb,
  tenantId: string,
  stop: HandoverStopFacts,
  vehicleId: string | null,
  radiusM: number,
  receiptTime: Date | null,
): Promise<{ start: string; end: string } | null> {
  if (vehicleId == null || receiptTime == null) return null;
  const windowStartIso = new Date(receiptTime.getTime() - PRESENCE_WINDOW_MINUTES * 60_000).toISOString();
  const receiptIso = receiptTime.toISOString();
  const fixes = (await db.execute(sql`
    SELECT latitude, longitude, received_at
    FROM location_points
    WHERE tenant_id = ${tenantId} AND vehicle_id = ${vehicleId}
      AND received_at >= ${windowStartIso}::timestamptz
      AND received_at <= ${receiptIso}::timestamptz
    ORDER BY received_at DESC
    LIMIT 500
  `)) as unknown as Array<{
    latitude: number;
    longitude: number;
    received_at: Date | string;
  }>;
  const qualifying = fixes.filter(
    (fix) =>
      haversineMetres(stop.latitude, stop.longitude, fix.latitude, fix.longitude) <= radiusM,
  );
  if (qualifying.length === 0) return null;
  // The most recent qualifying fix: presence is attested at this server time,
  // and the handover happened between presence and evidence receipt.
  const presenceAt = new Date(qualifying[0]!.received_at).toISOString();
  const receipt = receiptTime.toISOString();
  return { start: presenceAt, end: receipt };
}
