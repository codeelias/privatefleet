/**
 * Stage 4 release-closure browser tests: real postgres API + dispatcher web.
 * Covers geofence creation + telemetry ingest, public tracking page life
 * cycle and the delivery performance UI + CSV download.
 */
import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const API = "http://127.0.0.1:4003";
const SLUG = "northstar-auth-e2e";
const EMAIL = "owner@northstar.demo";
const PASSWORD = "demo-password-123";

interface Session {
  tokens: { accessToken: string };
  tenant: { id: string };
}

async function login(request: APIRequestContext): Promise<Session> {
  const res = await request.post(`${API}/v1/auth/login`, {
    data: { tenantSlug: SLUG, email: EMAIL, password: PASSWORD },
  });
  expect(res.status()).toBe(200);
  return (await res.json()) as Session;
}

async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Workspace").fill(SLUG);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Fleet Operations")).toBeVisible();
}

test("geofence creation and telemetry ingest accept points", async ({ request }) => {
  const session = await login(request);
  const owner = { authorization: `Bearer ${session.tokens.accessToken}` };

  const created = await request.post(`${API}/v1/geofences`, {
    headers: owner,
    data: {
      name: "E2E Depot",
      geojson: JSON.stringify({
        type: "Polygon",
        coordinates: [
          [
            [-0.14, 51.49],
            [-0.1, 51.49],
            [-0.1, 51.52],
            [-0.14, 51.52],
            [-0.14, 51.49],
          ],
        ],
      }),
    },
  });
  expect(created.status()).toBe(200);

  const fleet = await request.get(`${API}/v1/fleet/state`, { headers: owner });
  const state = (await fleet.json()) as {
    drivers: Array<{ id: string; vehicleId?: string }>;
  };
  const driverId = state.drivers.find((d) => d.vehicleId)?.id;
  expect(driverId).toBeTruthy();

  const driverLogin = await request.post(`${API}/v1/auth/driver-login`, {
    data: { tenantSlug: SLUG, driverId, pin: "1234" },
  });
  expect(driverLogin.status()).toBe(200);
  const driverSession = (await driverLogin.json()) as Session;
  const driver = { authorization: `Bearer ${driverSession.tokens.accessToken}` };

  const ingest = await request.post(`${API}/v1/telemetry`, {
    headers: driver,
    data: {
      samples: [
        { latitude: 51.6, longitude: -0.15, capturedAt: new Date(Date.now() - 10_000).toISOString() },
        { latitude: 51.5, longitude: -0.12, capturedAt: new Date().toISOString() },
      ],
    },
  });
  expect(ingest.status()).toBe(200);
  expect(await ingest.json()).toMatchObject({ accepted: 2, rejected: 0 });
});

test("public tracking page shows the job and revocation ends it", async ({ page, request }) => {
  const session = await login(request);
  const owner = { authorization: `Bearer ${session.tokens.accessToken}` };
  const fleet = await request.get(`${API}/v1/fleet/state`, { headers: owner });
  const state = (await fleet.json()) as { jobs: Array<{ id: string; reference: string }> };
  const job = state.jobs[0];
  expect(job).toBeTruthy();

  const created = await request.post(`${API}/v1/tracking-tokens`, {
    headers: owner,
    data: { jobId: job!.id },
  });
  expect(created.status()).toBe(200);
  const createdBody = (await created.json()) as { token: string; id: string };
  const token = createdBody.token;

  await page.goto(`/track/${token}`);
  await expect(page.getByText("Customer tracking page")).toBeVisible();
  await expect(page.getByText(`Tracking / Job ${job!.reference}`)).toBeVisible();
  await expect(page.getByText("Delivery progress", { exact: true })).toBeVisible();
  await expect(page.getByText("Estimated arrival", { exact: false })).toBeVisible();

  const revoked = await request.delete(`${API}/v1/tracking-tokens/${createdBody.id}`, {
    headers: owner,
  });
  expect(revoked.status()).toBe(200);

  await page.reload();
  await expect(page.getByText("This tracking link is no longer available.")).toBeVisible();
});

test("delivery performance report renders and downloads CSV", async ({ page, request }) => {
  const session = await login(request);
  const owner = { authorization: `Bearer ${session.tokens.accessToken}` };
  const report = await request.get(`${API}/v1/reports/delivery-performance`, { headers: owner });
  const reportBody = (await report.json()) as { rows: Array<{ jobReference: string }> };
  const reference = reportBody.rows[0]?.jobReference ?? "";
  expect(reference).toBeTruthy();

  await signIn(page);
  await page.getByRole("button", { name: "Jobs & Work Orders" }).click();
  await page.getByRole("button", { name: "Delivery Performance" }).click();
  await expect(page.getByRole("heading", { name: "Delivery performance report" })).toBeVisible();
  await expect(page.getByText(reference).first()).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain("delivery-performance");
  const csv = readFileSync((await download.path())!, "utf8");
  expect(csv).toContain("job_reference");
  expect(csv).toContain(reference);
});
