import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Dispatcher fleet optimisation acceptance (postgres mode, protocol-faithful
 * fake OSRM/VROOM): multiple routes, mixed single-stop/paired work, explicit
 * unassigned reasons, one atomic approval, stale rejection.
 */
const API = "http://127.0.0.1:4002";
const WEB = "http://127.0.0.1:5176";
const SLUG = "northstar-fleet-e2e";
const EMAIL = "fleet@northstar.demo";
const PASSWORD = "demo-password-123";

interface FleetStateResponse {
  routeVersion: number;
  routes: Array<{ vehicleId: string; version: number }>;
  jobs: Array<{
    id: string;
    assignedDriverId?: string;
    status: string;
    stops: Array<{ status: string }>;
  }>;
}

async function login(page: Page): Promise<void> {
  await page.goto(WEB);
  await page.getByLabel("Workspace").fill(SLUG);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByText("Route Optimisation").first().click();
}

async function ownerToken(request: APIRequestContext): Promise<string> {
  const loginResponse = await request.post(`${API}/v1/auth/login`, {
    data: { tenantSlug: SLUG, email: EMAIL, password: PASSWORD },
  });
  expect(loginResponse.ok()).toBe(true);
  return ((await loginResponse.json()) as { tokens: { accessToken: string } }).tokens
    .accessToken;
}

async function fleet(request: APIRequestContext): Promise<FleetStateResponse> {
  const token = await ownerToken(request);
  const state = await request.get(`${API}/v1/fleet/state`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(state.ok()).toBe(true);
  return (await state.json()) as FleetStateResponse;
}

test("dispatcher reviews mixed fleet routes, unassigned work and publishes once", async ({
  page,
  request,
  isMobile,
}) => {
  test.skip(isMobile, "dispatcher fleet optimisation is desktop-only");
  await login(page);
  await page.getByRole("button", { name: "Optimise fleet" }).click();

  await expect(page.getByText("OSRM + VROOM - FLEET PROPOSAL")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(/km - \d+ min across \d+ routes/)).toBeVisible();

  // Multiple vehicle route panels, each with an ordered stop list.
  const routeHeaders = page.getByText(/\d+ stops/);
  expect(await routeHeaders.count()).toBeGreaterThanOrEqual(2);

  // Mixed unit types are distinguishable.
  await expect(page.getByText("SINGLE JOB").first()).toBeVisible();
  await expect(page.getByText("PICKUP").first()).toBeVisible();
  await expect(page.getByText("DELIVERY").first()).toBeVisible();

  // Explicit unassigned work with its structured reason.
  await expect(page.getByText(/Unassigned work/)).toBeVisible();
  await expect(
    page.getByText("No vehicle has the required capability"),
  ).toBeVisible();

  const before = await fleet(request);
  await page.getByRole("button", { name: "Approve fleet plan" }).click();
  await expect(page.getByText(/Fleet version \d+ is live/)).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("button", { name: "Approve fleet plan" })).toHaveCount(0);

  const after = await fleet(request);
  expect(after.routeVersion).toBe(before.routeVersion + 1);
  expect(after.routes.length).toBeGreaterThanOrEqual(2);
  for (const route of after.routes) {
    expect(route.version).toBe(after.routeVersion);
  }
});

test("stale fleet approval is explained and never shown as published", async ({
  page,
  request,
  isMobile,
}) => {
  test.skip(isMobile, "dispatcher fleet optimisation is desktop-only");
  await login(page);
  await page.getByRole("button", { name: "Optimise fleet" }).click();
  await expect(page.getByText("OSRM + VROOM - FLEET PROPOSAL")).toBeVisible({
    timeout: 20_000,
  });

  // Another dispatcher publishes while this proposal is under review.
  const token = await ownerToken(request);
  const before = await fleet(request);
  // A subset run has a different cache identity from the UI's fleet run, so
  // this really is a competing publication rather than the same cached run.
  const driverId = before.jobs.find((job) => job.assignedDriverId)?.assignedDriverId;
  expect(driverId).toBeTruthy();
  const proposalResponse = await request.post(`${API}/v1/optimization/fleet-run`, {
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    data: { driverIds: [driverId] },
  });
  expect(proposalResponse.ok()).toBe(true);
  const proposal = (await proposalResponse.json()) as {
    runId: string;
    expectedRouteVersion: number;
  };
  const approval = await request.post(
    `${API}/v1/optimization/fleet/${proposal.runId}/approve`,
    {
      headers: { authorization: `Bearer ${token}` },
      data: { expectedRouteVersion: proposal.expectedRouteVersion },
    },
  );
  expect(approval.ok()).toBe(true);
  const bumped = await fleet(request);
  expect(bumped.routeVersion).toBe(before.routeVersion + 1);

  // The screen's proposal is now stale; approval must fail loudly.
  await page.getByRole("button", { name: "Approve fleet plan" }).click();
  await expect(page.getByText(/proposal is stale/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Fleet version \d+ is live/)).toHaveCount(0);

  const after = await fleet(request);
  expect(after.routeVersion).toBe(bumped.routeVersion);
});

