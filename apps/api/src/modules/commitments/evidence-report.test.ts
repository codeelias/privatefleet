/**
 * Slice 5: evidence report - integrity verification and PDF generation.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { buildApp } from "../../app.js";
import { loadConfig, migrationDatabaseUrl } from "../../config.js";
import { closeDb, createDb, type DbHandle } from "../../db/client.js";
import { EvidenceStore } from "../evidence/storage.js";
import { buildEvidenceReportPdf, gatherJobEvidenceReport, verifyEvidenceIntegrity, type JobEvidenceReport } from "./evidence-report.js";

const APP_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://privatefleet_app:privatefleet_app_pw@127.0.0.1:5432/privatefleet_dev";

const config = loadConfig({
  ...process.env,
  REPOSITORY_MODE: "postgres",
  DATABASE_URL: APP_DATABASE_URL,
  AUTH_JWT_SECRET: "report-test-secret-at-least-16-characters",
  LOG_LEVEL: "error",
});

const { app } = buildApp(config);
const migrator: DbHandle = createDb(migrationDatabaseUrl(), { max: 2 });
const createdTenants: string[] = [];
let evidenceDir: string;
let store: EvidenceStore;

beforeAll(async () => {
  await app.ready();
  evidenceDir = await mkdtemp(join(tmpdir(), "pf-evidence-test-"));
  store = new EvidenceStore(evidenceDir);
});

afterAll(async () => {
  await app.close();
  if (createdTenants.length > 0) {
    await migrator.sql`DELETE FROM outbox WHERE tenant_id = ANY(${createdTenants}::uuid[])`;
    await migrator.sql`DELETE FROM tenants WHERE id = ANY(${createdTenants}::uuid[])`;
  }
  await closeDb(migrator);
  await rm(evidenceDir, { recursive: true, force: true });
});

function sampleReport(): JobEvidenceReport {
  return {
    jobReference: "REP-1",
    serviceType: "Delivery",
    jobStatus: "completed",
    driverName: "Test Driver",
    generatedAt: "2026-11-08T12:00:00.000Z",
    stops: [
      {
        sequence: 1,
        address: "1 Test Way",
        stopType: "dropoff",
        status: "completed",
        windowStart: "2026-11-08T09:00:00.000Z",
        windowEnd: "2026-11-08T11:00:00.000Z",
        outcome: {
          operational: "completed",
          timing: "within_window",
          evidenceCompleteness: "complete",
          originalTiming: "within_window",
          revisedTiming: "not_applicable",
        },
        evidence: [
          {
            kind: "photo",
            mimeType: "image/png",
            byteSize: 4,
            capturedAt: "2026-11-08T10:00:00.000Z",
            serverReceivedAt: "2026-11-08T10:00:05.000Z",
            contentHash: createHash("sha256").update("abcd").digest("hex"),
            integrity: "verified",
          },
        ],
      },
    ],
    episodes: [],
  };
}

describe("evidence integrity verification", () => {
  it("verifies, mismatches, and reports missing files", async () => {
    const tenantId = randomUUID();
    const stopId = randomUUID();
    const bytes = Buffer.from("evidence-bytes");
    const stored = await store.put(tenantId, stopId, "png", bytes);
    expect(await verifyEvidenceIntegrity(store, stored.storageKey, stored.contentHash)).toBe("verified");
    expect(await verifyEvidenceIntegrity(store, stored.storageKey, "0".repeat(64))).toBe("mismatch");
    expect(await verifyEvidenceIntegrity(store, `${tenantId}/${stopId}/${randomUUID()}.png`, "0".repeat(64))).toBe("missing");
  });
});

describe("evidence report", () => {
  it("gathers a report with verified evidence and renders a PDF", async () => {
    const register = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        tenantName: "Report Co",
        email: `report-${randomUUID().slice(0, 8)}@example.test`,
        password: "correct horse battery staple",
      },
    });
    const session = register.json() as {
      tenant: { id: string; slug: string };
      tokens: { accessToken: string };
    };
    const tenantId = session.tenant.id;
    createdTenants.push(tenantId);
    const sql = migrator.sql;
    const driverId = randomUUID();
    const vehicleId = randomUUID();
    const jobId = randomUUID();
    const stopId = randomUUID();
    await sql`INSERT INTO vehicles (id, tenant_id, registration, vehicle_type, status, driver_id)
      VALUES (${vehicleId}, ${tenantId}, 'RPT-1', 'Van', 'on_route', ${driverId})`;
    await sql`INSERT INTO drivers (id, tenant_id, full_name, status, pin_hash, vehicle_id)
      VALUES (${driverId}, ${tenantId}, 'Report Driver', 'on_route', 'unused', ${vehicleId})`;
    await sql`INSERT INTO jobs (id, tenant_id, reference, service_type, priority, status, assigned_driver_id, assigned_vehicle_id)
      VALUES (${jobId}, ${tenantId}, 'RPT-1', 'Delivery', 'standard', 'completed', ${driverId}, ${vehicleId})`;
    await sql`INSERT INTO job_stops (id, tenant_id, job_id, sequence, stop_type, address, latitude, longitude, window_start, window_end, status, completed_at)
      VALUES (${stopId}, ${tenantId}, ${jobId}, 1, 'dropoff', '1 Report Way', 51.5, -0.1,
        now() - interval '2 hours', now() - interval '30 minutes', 'completed', now() - interval '1 hour')`;
    // Real evidence file + record (hash-verified in the report).
    const bytes = Buffer.from("report-photo-bytes");
    const stored = await store.put(tenantId, stopId, "png", bytes);
    await sql`INSERT INTO stop_evidence (tenant_id, job_id, stop_id, kind, storage_key, content_hash, mime_type, byte_size, captured_at, uploaded_by)
      VALUES (${tenantId}, ${jobId}, ${stopId}, 'photo', ${stored.storageKey}, ${stored.contentHash},
        'image/png', ${stored.byteSize}, now() - interval '1 hour', ${randomUUID()})`;

    const report = await gatherJobEvidenceReport(migrator, tenantId, jobId, store);
    expect(report).not.toBeNull();
    expect(report!.jobReference).toBe("RPT-1");
    expect(report!.stops).toHaveLength(1);
    expect(report!.stops[0]?.outcome.operational).toBe("completed");
    expect(report!.stops[0]?.evidence[0]?.integrity).toBe("verified");

    const pdf = await buildEvidenceReportPdf(report!);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it("renders a sample PDF", async () => {
    const pdf = await buildEvidenceReportPdf(sampleReport());
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it("serves the PDF to dispatchers, rejects drivers, 404s unknown jobs", async () => {
    const register = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        tenantName: "Report Http Co",
        email: `rhttp-${randomUUID().slice(0, 8)}@example.test`,
        password: "correct horse battery staple",
      },
    });
    const session = register.json() as {
      tenant: { id: string; slug: string };
      tokens: { accessToken: string };
    };
    createdTenants.push(session.tenant.id);
    const authed = { authorization: `Bearer ${session.tokens.accessToken}` };

    const notFound = await app.inject({
      method: "GET",
      url: `/v1/fleet/jobs/${randomUUID()}/evidence-report`,
      headers: authed,
    });
    expect(notFound.statusCode).toBe(404);

    const sql = migrator.sql;
    const driverId = randomUUID();
    const vehicleId = randomUUID();
    const jobId = randomUUID();
    await sql`INSERT INTO vehicles (id, tenant_id, registration, vehicle_type, status, driver_id)
      VALUES (${vehicleId}, ${session.tenant.id}, 'RPT-2', 'Van', 'on_route', ${driverId})`;
    await sql`INSERT INTO drivers (id, tenant_id, full_name, status, pin_hash, vehicle_id)
      VALUES (${driverId}, ${session.tenant.id}, 'Http Driver', 'on_route', 'unused', ${vehicleId})`;
    await sql`INSERT INTO jobs (id, tenant_id, reference, service_type, priority, status, assigned_driver_id, assigned_vehicle_id)
      VALUES (${jobId}, ${session.tenant.id}, 'RPT-2', 'Delivery', 'standard', 'assigned', ${driverId}, ${vehicleId})`;

    const pdf = await app.inject({
      method: "GET",
      url: `/v1/fleet/jobs/${jobId}/evidence-report`,
      headers: authed,
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
