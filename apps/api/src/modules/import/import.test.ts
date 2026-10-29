/**
 * CSV import gate: preview validates addresses via PostGIS, duplicates are
 * detected, commit is atomic, and replay is idempotent.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../app.js";
import { loadConfig, migrationDatabaseUrl } from "../../config.js";
import { closeDb, createDb, type DbHandle } from "../../db/client.js";

const APP_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://privatefleet_app:privatefleet_app_pw@127.0.0.1:5432/privatefleet_dev";

const config = loadConfig({
  ...process.env,
  REPOSITORY_MODE: "postgres",
  DATABASE_URL: APP_DATABASE_URL,
  AUTH_JWT_SECRET: "import-test-secret-at-least-16-characters",
  LOG_LEVEL: "error",
});
const { app } = buildApp(config);
const migrator: DbHandle = createDb(migrationDatabaseUrl(), { max: 2 });
const createdTenants: string[] = [];

const header =
  "job_ref,service_type,priority,stop_type,address,latitude,longitude,window_start,window_end";
const validRow = (ref: string, address: string, lat: number, lng: number): string =>
  `${ref},Delivery,standard,dropoff,"${address}",${lat},${lng},2026-10-30T09:00:00Z,2026-10-30T12:00:00Z`;

let tenantId: string;
let token: string;

function authed(): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  await app.ready();
  const registered = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: {
      tenantName: `CSV Import ${randomUUID().slice(0, 8)}`,
      email: `import-${randomUUID().slice(0, 8)}@example.test`,
      password: "correct horse battery staple",
    },
  });
  expect(registered.statusCode).toBe(200);
  const session = registered.json() as {
    tenant: { id: string };
    tokens: { accessToken: string };
  };
  tenantId = session.tenant.id;
  token = session.tokens.accessToken;
  createdTenants.push(tenantId);
});

afterAll(async () => {
  await app.close();
  for (const id of createdTenants) {
    await migrator.sql`DELETE FROM outbox WHERE tenant_id = ${id}`;
    await migrator.sql`DELETE FROM idempotency_keys WHERE tenant_id = ${id}`;
    await migrator.sql`DELETE FROM tenants WHERE id = ${id}`;
  }
  await closeDb(migrator);
});

describe("CSV bulk ingestion", () => {
  it("previews valid, invalid and duplicate jobs, rolls back bad commits, then imports atomically", async () => {
    const invalidCsv = [
      header,
      validRow("IMP-1001", "10 Downing Street, London", 51.5034, -0.1276),
      validRow("IMP-1002", "St Paul's Cathedral, London", 51.5138, -0.0984),
      validRow("IMP-1003", "Tower Bridge, London", 51.5055, -0.0754),
      validRow("IMP-1004", "Outside Service Area", 0, 0),
    ].join("\n");

    const preview = await app.inject({
      method: "POST",
      url: "/v1/jobs/import",
      headers: authed(),
      payload: { csv: invalidCsv },
    });
    expect(preview.statusCode).toBe(200);
    const body = preview.json() as {
      valid: number;
      invalid: number;
      duplicates: number;
      canCommit: boolean;
      preview: Array<{ jobRef: string; status: string; errors: string[] }>;
      jobs: Array<{
        jobRef: string;
        serviceType: string;
        priority: string;
        stops: Array<{
          sequenceNo: number;
          stopType: string;
          address: string;
          latitude: number;
          longitude: number;
        }>;
      }>;
    };
    expect(body.valid).toBe(3);
    expect(body.invalid).toBe(1);
    expect(body.duplicates).toBe(0);
    expect(body.canCommit).toBe(false);
    expect(body.preview.find((row) => row.jobRef === "IMP-1004")?.status).toBe("invalid");
    expect(body.preview.find((row) => row.jobRef === "IMP-1004")?.errors.join(" ")).toContain(
      "service area",
    );

    // A caller cannot bypass preview validation by injecting an invalid job.
    const badCommit = await app.inject({
      method: "POST",
      url: "/v1/jobs/import/commit",
      headers: { ...authed(), "idempotency-key": randomUUID() },
      payload: {
        jobs: [
          ...body.jobs,
          {
            jobRef: "IMP-1004",
            serviceType: "Delivery",
            priority: "standard",
            stops: [
              {
                sequenceNo: 1,
                stopType: "dropoff",
                address: "Outside Service Area",
                latitude: 0,
                longitude: 0,
              },
            ],
          },
        ],
      },
    });
    expect(badCommit.statusCode).toBe(422);
    const stateAfterBad = await app.inject({
      method: "GET",
      url: "/v1/fleet/state?includeRoutes=false",
      headers: authed(),
    });
    expect((stateAfterBad.json() as { jobs: unknown[] }).jobs).toHaveLength(0);

    const fixedCsv = [
      header,
      validRow("IMP-1001", "10 Downing Street, London", 51.5034, -0.1276),
      validRow("IMP-1002", "St Paul's Cathedral, London", 51.5138, -0.0984),
      validRow("IMP-1003", "Tower Bridge, London", 51.5055, -0.0754),
      validRow("IMP-1004", "Borough Market, London", 51.5055, -0.091),
    ].join("\n");
    const fixedPreview = await app.inject({
      method: "POST",
      url: "/v1/jobs/import",
      headers: authed(),
      payload: { csv: fixedCsv },
    });
    const fixedBody = fixedPreview.json() as typeof body;
    expect(fixedPreview.statusCode).toBe(200);
    expect(fixedBody.valid).toBe(4);
    expect(fixedBody.canCommit).toBe(true);

    const commitKey = randomUUID();
    const commit = await app.inject({
      method: "POST",
      url: "/v1/jobs/import/commit",
      headers: { ...authed(), "idempotency-key": commitKey },
      payload: { jobs: fixedBody.jobs },
    });
    expect(commit.statusCode).toBe(200);
    expect((commit.json() as { imported: number }).imported).toBe(4);

    const state = await app.inject({
      method: "GET",
      url: "/v1/fleet/state?includeRoutes=false",
      headers: authed(),
    });
    const jobs = (state.json() as { jobs: Array<{ reference: string; stops: unknown[] }> }).jobs;
    expect(jobs.map((job) => job.reference).sort()).toEqual([
      "IMP-1001",
      "IMP-1002",
      "IMP-1003",
      "IMP-1004",
    ]);
    expect(jobs.every((job) => job.stops.length === 1)).toBe(true);

    const duplicatePreview = await app.inject({
      method: "POST",
      url: "/v1/jobs/import",
      headers: authed(),
      payload: { csv: fixedCsv },
    });
    const duplicateBody = duplicatePreview.json() as typeof body;
    expect(duplicateBody.duplicates).toBe(4);
    expect(duplicateBody.canCommit).toBe(false);

    const replay = await app.inject({
      method: "POST",
      url: "/v1/jobs/import/commit",
      headers: { ...authed(), "idempotency-key": commitKey },
      payload: { jobs: fixedBody.jobs },
    });
    expect(replay.json()).toEqual(commit.json());
    const afterReplay = await app.inject({
      method: "GET",
      url: "/v1/fleet/state?includeRoutes=false",
      headers: authed(),
    });
    expect((afterReplay.json() as { jobs: unknown[] }).jobs).toHaveLength(4);

    const duplicateCommit = await app.inject({
      method: "POST",
      url: "/v1/jobs/import/commit",
      headers: { ...authed(), "idempotency-key": randomUUID() },
      payload: { jobs: fixedBody.jobs },
    });
    expect(duplicateCommit.statusCode).toBe(409);
  });
});
