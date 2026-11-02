/**
 * Phase 4 telemetry gate (docs/09, docs/14): authenticated device pings
 * are durability-first, monotonic and tenant-scoped. Out-of-order samples
 * are rejected; the snapshot shows the newest accepted position; a driver
 * token can only move its own assigned vehicle.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../app.js";
import { loadConfig, migrationDatabaseUrl } from "../../config.js";
import { closeDb, createDb, type DbHandle } from "../../db/client.js";
import { seedTenant } from "../../db/seed.js";

const APP_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://privatefleet_app:privatefleet_app_pw@127.0.0.1:5432/privatefleet_dev";

const config = loadConfig({
  ...process.env,
  REPOSITORY_MODE: "postgres",
  DATABASE_URL: APP_DATABASE_URL,
  AUTH_JWT_SECRET: "test-secret-at-least-16-characters-long",
  LOG_LEVEL: "error",
});

const { app } = buildApp(config);
const migrator: DbHandle = createDb(migrationDatabaseUrl(), { max: 2 });
const createdTenants: string[] = [];

interface DriverSession {
  tenantSlug: string;
  ownerToken: string;
  token: string;
  driverId: string;
  vehicleId: string;
}

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  if (createdTenants.length > 0) {
    await migrator.sql`DELETE FROM tenants WHERE id = ANY(${createdTenants}::uuid[])`;
  }
  await app.close();
  await closeDb(migrator);
});

async function seededDriver(slug: string): Promise<DriverSession> {
  const seeded = await seedTenant(migrator, {
    tenantName: "Telemetry Co",
    email: `owner-${randomUUID().slice(0, 6)}@telemetry.test`,
    password: "demo-password-123",
    slug,
  });
  createdTenants.push(seeded.tenantId);

  const owner = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { tenantSlug: seeded.tenantSlug, email: seeded.email, password: seeded.password },
  });
  expect(owner.statusCode).toBe(200);
  const ownerToken = (owner.json() as { tokens: { accessToken: string } }).tokens.accessToken;
  const state = await app.inject({
    method: "GET",
    url: "/v1/fleet/state",
    headers: { authorization: `Bearer ${ownerToken}` },
  });
  const fleet = state.json() as {
    drivers: Array<{ id: string; vehicleId?: string }>;
    vehicles: Array<{ id: string; driverId?: string }>;
  };
  const driver = fleet.drivers[0];
  expect(driver?.vehicleId).toBeTruthy();

  const login = await app.inject({
    method: "POST",
    url: "/v1/auth/driver-login",
    payload: { tenantSlug: seeded.tenantSlug, driverId: driver!.id, pin: "1234" },
  });
  expect(login.statusCode).toBe(200);
  return {
    tenantSlug: seeded.tenantSlug,
    ownerToken,
    token: (login.json() as { tokens: { accessToken: string } }).tokens.accessToken,
    driverId: driver!.id,
    vehicleId: driver!.vehicleId!,
  };
}

function sample(latitude: number, longitude: number, capturedAt: string) {
  return { latitude, longitude, capturedAt };
}

describe("GPS telemetry ingestion", () => {
  it("accepts newer samples, rejects stale ones and advances the snapshot", async () => {
    const session = await seededDriver(`tel-${randomUUID().slice(0, 6)}`);
    const older = new Date(Date.now() - 60_000).toISOString();
    const newer = new Date().toISOString();

    const ingest = await app.inject({
      method: "POST",
      url: "/v1/telemetry",
      headers: { authorization: `Bearer ${session.token}` },
      payload: {
        samples: [
          sample(51.51, -0.12, older),
          sample(51.52, -0.11, newer),
          sample(51.5, -0.13, older),
        ],
      },
    });
    expect(ingest.statusCode).toBe(200);
    const result = ingest.json() as {
      accepted: number;
      rejected: number;
      results: Array<{ status: string }>;
      lastPosition?: { sequenceNo: number; latitude: number };
    };
    expect(result.accepted).toBe(2);
    expect(result.rejected).toBe(1);
    expect(result.results.filter((r) => r.status === "stale")).toHaveLength(1);
    expect(result.lastPosition?.sequenceNo).toBe(2);
    expect(result.lastPosition?.latitude).toBe(51.52);

    // Snapshot recovery shows the newest position and fresh state.
    const recovered = await app.inject({
      method: "GET",
      url: "/v1/fleet/state",
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });
    expect(recovered.statusCode).toBe(200);
    const vehicle = (
      recovered.json() as {
        vehicles: Array<{
          id: string;
          location?: { latitude: number; longitude: number };
          stale: boolean;
        }>;
      }
    ).vehicles.find((candidate) => candidate.id === session.vehicleId);
    expect(vehicle?.location?.latitude).toBe(51.52);
    expect(vehicle?.location?.longitude).toBe(-0.11);
    expect(vehicle?.stale).toBe(false);
  });

  it("rejects an out-of-order batch and ignores spoofed vehicle ids", async () => {
    const session = await seededDriver(`tel2-${randomUUID().slice(0, 6)}`);
    const now = new Date().toISOString();
    const first = await app.inject({
      method: "POST",
      url: "/v1/telemetry",
      headers: { authorization: `Bearer ${session.token}` },
      payload: { samples: [sample(51.6, -0.2, now)] },
    });
    expect(first.statusCode).toBe(200);

    const replay = await app.inject({
      method: "POST",
      url: "/v1/telemetry",
      headers: { authorization: `Bearer ${session.token}` },
      payload: { samples: [sample(51.6, -0.2, now)] },
    });
    expect(replay.statusCode).toBe(200);
    expect((replay.json() as { accepted: number }).accepted).toBe(0);
    expect((replay.json() as { rejected: number }).rejected).toBe(1);

    // A spoofed vehicleId cannot retarget another tenant's vehicle.
    const other = await seededDriver(`tel-other-${randomUUID().slice(0, 6)}`);
    const otherState = async (): Promise<number | null> => {
      const state = await app.inject({
        method: "GET",
        url: "/v1/fleet/state",
        headers: { authorization: `Bearer ${other.ownerToken}` },
      });
      const vehicle = (
        state.json() as {
          vehicles: Array<{ id: string; location?: { latitude: number } }>;
        }
      ).vehicles.find((candidate) => candidate.id === other.vehicleId);
      return vehicle?.location?.latitude ?? null;
    };
    const otherBefore = await otherState();
    const spoof = await app.inject({
      method: "POST",
      url: "/v1/telemetry",
      headers: { authorization: `Bearer ${session.token}` },
      payload: {
        samples: [sample(0, 0, new Date(Date.now() + 1_000).toISOString())],
        vehicleId: other.vehicleId,
      },
    });
    expect(spoof.statusCode).toBe(200);
    expect(await otherState()).toBe(otherBefore);
  });

  it("rate limits a device that reports too quickly", async () => {
    const session = await seededDriver(`tel-rate-${randomUUID().slice(0, 6)}`);
    const base = Date.now() - 120_000;
    for (let index = 0; index < 10; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/telemetry",
        headers: { authorization: `Bearer ${session.token}` },
        payload: {
          samples: [sample(51.5, -0.12, new Date(base + index * 1_000).toISOString())],
        },
      });
      expect(response.statusCode).toBe(200);
    }
    const blocked = await app.inject({
      method: "POST",
      url: "/v1/telemetry",
      headers: { authorization: `Bearer ${session.token}` },
      payload: { samples: [sample(51.6, -0.13, new Date().toISOString())] },
    });
    expect(blocked.statusCode).toBe(429);
    expect((blocked.json() as { code: string }).code).toBe("TELEMETRY_RATE_LIMITED");
    expect(blocked.headers["retry-after"]).toBeTruthy();
  });

  it("persists fused-position quality fields for the dispatcher", async () => {
    const session = await seededDriver(`tel-fused-${randomUUID().slice(0, 6)}`);
    const capturedAt = new Date(Date.now() - 2_000).toISOString();
    const ingest = await app.inject({
      method: "POST",
      url: "/v1/telemetry",
      headers: { authorization: `Bearer ${session.token}` },
      payload: {
        samples: [
          {
            latitude: 51.5,
            longitude: -0.12,
            capturedAt,
            accuracyMetres: 7.5,
            headingDeg: 42,
            speedMps: 8.2,
            source: "fused",
            satellitesUsed: 18,
            dualFrequency: true,
            carrierPhase: true,
            ekfConfidence: "high",
            rtkState: "corrections_ready",
            correctionAgeMs: 1_200,
          },
        ],
      },
    });
    expect(ingest.statusCode).toBe(200);
    const state = await app.inject({
      method: "GET",
      url: "/v1/fleet/state",
      headers: { authorization: `Bearer ${session.ownerToken}` },
    });
    const vehicle = (state.json() as {
      vehicles: Array<{
        id: string;
        positionSource?: string;
        satellitesUsed?: number;
        dualFrequency?: boolean;
        carrierPhase?: boolean;
        ekfConfidence?: string;
        rtkState?: string;
        correctionAgeMs?: number;
      }>;
    }).vehicles.find((entry) => entry.id === session.vehicleId);
    expect(vehicle?.positionSource).toBe("fused");
    expect(vehicle?.satellitesUsed).toBe(18);
    expect(vehicle?.dualFrequency).toBe(true);
    expect(vehicle?.carrierPhase).toBe(true);
    expect(vehicle?.ekfConfidence).toBe("high");
    expect(vehicle?.rtkState).toBe("corrections_ready");
    expect(vehicle?.correctionAgeMs).toBe(1_200);
  });

  it("requires a driver device token", async () => {    const anonymous = await app.inject({
      method: "POST",
      url: "/v1/telemetry",
      payload: { samples: [sample(51.5, -0.1, new Date().toISOString())] },
    });
    expect(anonymous.statusCode).toBe(401);

    const seeded = await seedTenant(migrator, {
      tenantName: "Owner Co",
      email: `owner-${randomUUID().slice(0, 6)}@owner.test`,
      password: "demo-password-123",
      slug: `own-${randomUUID().slice(0, 6)}`,
    });
    createdTenants.push(seeded.tenantId);
    const owner = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { tenantSlug: seeded.tenantSlug, email: seeded.email, password: seeded.password },
    });
    const token = (owner.json() as { tokens: { accessToken: string } }).tokens.accessToken;
    const ownerPing = await app.inject({
      method: "POST",
      url: "/v1/telemetry",
      headers: { authorization: `Bearer ${token}` },
      payload: { samples: [sample(51.5, -0.1, new Date().toISOString())] },
    });
    expect(ownerPing.statusCode).toBe(403);
    expect((ownerPing.json() as { code: string }).code).toBe("DRIVER_DEVICE_ONLY");
  });
});

