/**
 * Tenant dispatch policy persistence. One revision per tenant covers the
 * preset, advanced limits and every vehicle override; all writes increment
 * it atomically so optimisation and approval can compare one number.
 */
import { sql } from "drizzle-orm";
import { withTenant, type DbHandle } from "../../db/client.js";
import {
  presetPolicy,
  resolveVehiclePolicy,
  validatePolicy,
  type DispatchPolicy,
  type DispatchPreset,
  type VehiclePolicyOverride,
} from "./dispatch-policy.js";

export interface PolicyOverrideRecord extends VehiclePolicyOverride {
  vehicleId: string;
}

export interface PolicySnapshot {
  revision: number;
  preset: DispatchPreset;
  policy: DispatchPolicy;
  overrides: PolicyOverrideRecord[];
}

export class DispatchPolicyConflict extends Error {
  constructor(readonly code: "DISPATCH_POLICY_CONFLICT" | "DISPATCH_POLICY_INVALID") {
    super(code);
  }
}

interface PolicyRow {
  preset: DispatchPreset;
  max_distance_m: number;
  max_travel_time_s: number;
  max_working_duration_s: number;
  max_visits: number;
  revision: number;
}

interface OverrideRow {
  vehicle_id: string;
  max_distance_m: number | null;
  max_travel_time_s: number | null;
  max_working_duration_s: number | null;
  max_visits: number | null;
}

export interface PolicyUpdate {
  expectedRevision: number;
  preset?: DispatchPreset | undefined;
  maxDistanceM?: number | undefined;
  maxTravelTimeS?: number | undefined;
  maxWorkingDurationS?: number | undefined;
  maxVisits?: number | undefined;
  overrides?: PolicyOverrideRecord[] | undefined;
}

function toPolicy(row: PolicyRow): DispatchPolicy {
  return {
    preset: row.preset,
    maxDistanceM: Number(row.max_distance_m),
    maxTravelTimeS: Number(row.max_travel_time_s),
    maxWorkingDurationS: Number(row.max_working_duration_s),
    maxVisits: Number(row.max_visits),
    version: Number(row.revision),
  };
}

async function readSnapshot(
  db: Parameters<Parameters<typeof withTenant>[2]>[0],
  tenantId: string,
): Promise<PolicySnapshot> {
  await db.execute(sql`
    INSERT INTO dispatch_policies (tenant_id)
    VALUES (${tenantId})
    ON CONFLICT (tenant_id) DO NOTHING
  `);
  const rows = (await db.execute(sql`
    SELECT preset, max_distance_m, max_travel_time_s, max_working_duration_s,
           max_visits, revision
    FROM dispatch_policies WHERE tenant_id = ${tenantId}
  `)) as unknown as PolicyRow[];
  const row = rows[0];
  if (!row) throw new DispatchPolicyConflict("DISPATCH_POLICY_INVALID");
  const overrides = (await db.execute(sql`
    SELECT vehicle_id, max_distance_m, max_travel_time_s,
           max_working_duration_s, max_visits
    FROM dispatch_policy_overrides WHERE tenant_id = ${tenantId}
    ORDER BY vehicle_id
  `)) as unknown as OverrideRow[];
  return {
    revision: Number(row.revision),
    preset: row.preset,
    policy: toPolicy(row),
    overrides: overrides.map((override) => ({
      vehicleId: override.vehicle_id,
      ...(override.max_distance_m !== null
        ? { maxDistanceM: Number(override.max_distance_m) }
        : {}),
      ...(override.max_travel_time_s !== null
        ? { maxTravelTimeS: Number(override.max_travel_time_s) }
        : {}),
      ...(override.max_working_duration_s !== null
        ? { maxWorkingDurationS: Number(override.max_working_duration_s) }
        : {}),
      ...(override.max_visits !== null ? { maxVisits: Number(override.max_visits) } : {}),
    })),
  };
}

export async function getDispatchPolicy(
  handle: DbHandle,
  tenantId: string,
): Promise<PolicySnapshot> {
  return withTenant(handle, tenantId, (db) => readSnapshot(db, tenantId));
}

/** Effective limits for one vehicle, always carrying the tenant revision. */
export function effectivePolicy(
  snapshot: PolicySnapshot,
  vehicleId: string,
): DispatchPolicy {
  return resolveVehiclePolicy(
    snapshot.policy,
    snapshot.overrides.find((override) => override.vehicleId === vehicleId),
  );
}

export async function updateDispatchPolicy(
  handle: DbHandle,
  tenantId: string,
  input: PolicyUpdate,
): Promise<PolicySnapshot> {
  return withTenant(handle, tenantId, async (db) => {
    const current = await readSnapshot(db, tenantId);
    const base = presetPolicy(input.preset ?? current.preset, current.revision);
    const presetChanged = Boolean(input.preset && input.preset !== current.preset);
    const next: DispatchPolicy = {
      ...base,
      maxDistanceM:
        input.maxDistanceM ??
        (presetChanged ? base.maxDistanceM : current.policy.maxDistanceM),
      maxTravelTimeS:
        input.maxTravelTimeS ??
        (presetChanged ? base.maxTravelTimeS : current.policy.maxTravelTimeS),
      maxWorkingDurationS:
        input.maxWorkingDurationS ??
        (presetChanged
          ? base.maxWorkingDurationS
          : current.policy.maxWorkingDurationS),
      maxVisits:
        input.maxVisits ??
        (presetChanged ? base.maxVisits : current.policy.maxVisits),
    };
    try {
      validatePolicy(next);
      for (const override of input.overrides ?? []) {
        validatePolicy(resolveVehiclePolicy(next, override));
      }
    } catch {
      throw new DispatchPolicyConflict("DISPATCH_POLICY_INVALID");
    }
    if (input.expectedRevision !== current.revision) {
      throw new DispatchPolicyConflict("DISPATCH_POLICY_CONFLICT");
    }
    const updated = (await db.execute(sql`
      UPDATE dispatch_policies
      SET preset = ${next.preset},
          max_distance_m = ${next.maxDistanceM},
          max_travel_time_s = ${next.maxTravelTimeS},
          max_working_duration_s = ${next.maxWorkingDurationS},
          max_visits = ${next.maxVisits},
          revision = revision + 1,
          updated_at = now()
      WHERE tenant_id = ${tenantId} AND revision = ${input.expectedRevision}
      RETURNING revision
    `)) as unknown as Array<{ revision: number }>;
    if (!updated[0]) {
      throw new DispatchPolicyConflict("DISPATCH_POLICY_CONFLICT");
    }
    if (input.overrides) {
      const vehicleIds = input.overrides.map((override) => override.vehicleId);
      if (vehicleIds.length > 0) {
        const owned = (await db.execute(sql`
          SELECT id FROM vehicles
          WHERE tenant_id = ${tenantId}
            AND id IN (${sql.join(
              vehicleIds.map((id) => sql`${id}`),
              sql`, `,
            )})
        `)) as unknown as Array<{ id: string }>;
        if (owned.length !== new Set(vehicleIds).size) {
          throw new DispatchPolicyConflict("DISPATCH_POLICY_INVALID");
        }
      }
      await db.execute(sql`
        DELETE FROM dispatch_policy_overrides WHERE tenant_id = ${tenantId}
      `);
      for (const override of input.overrides) {
        await db.execute(sql`
          INSERT INTO dispatch_policy_overrides
            (tenant_id, vehicle_id, max_distance_m, max_travel_time_s,
             max_working_duration_s, max_visits)
          VALUES
            (${tenantId}, ${override.vehicleId}, ${override.maxDistanceM ?? null},
             ${override.maxTravelTimeS ?? null},
             ${override.maxWorkingDurationS ?? null},
             ${override.maxVisits ?? null})
        `);
      }
    }
    return readSnapshot(db, tenantId);
  });
}



