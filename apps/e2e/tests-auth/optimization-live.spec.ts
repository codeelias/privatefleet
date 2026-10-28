import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * Phase 5 acceptance (docs/10): dispatcher runs the live OSRM/VROOM
 * proposal through the real UI against the postgres API and publishes an
 * immutable route version. Routing services are protocol-faithful fakes
 * (no Docker is available in this environment).
 */
const API = "http://127.0.0.1:4002";
const WEB = "http://127.0.0.1:5176";
const SLUG = "northstar-auth-e2e";
const EMAIL = "owner@northstar.demo";
const PASSWORD = "demo-password-123";

interface Fleet {
  routeVersion: number;
  routes: Array<{ vehicleId: string; version: number }>;
  jobs: Array<{
    id: string;
    assignedDriverId?: string;
    status: string;
    stops: Array<{ status: string }>;
  }>;
}

async function fleet(request: APIRequestContext): Promise<Fleet> {
  const login = await request.post(`${API}/v1/auth/login`, {
    data: { tenantSlug: SLUG, email: EMAIL, password: PASSWORD },
  });
  expect(login.ok()).toBe(true);
  const token = ((await login.json()) as { tokens: { accessToken: string } }).tokens.accessToken;
  const state = await request.get(`${API}/v1/fleet/state`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(state.ok()).toBe(true);
  return (await state.json()) as Fleet;
}

test("dispatcher runs live optimisation and publishes a route version", async ({
  page,
  request,
  isMobile,
}) => {
  test.skip(isMobile, "dispatcher optimisation is desktop-only");
  const before = await fleet(request);
  const job = before.jobs.find(
    (candidate) =>
      candidate.assignedDriverId &&
      candidate.stops.length === 2 &&
      candidate.stops.every((stop) => stop.status === "pending"),
  );
  expect(job).toBeTruthy();

  await page.goto(WEB);
  await expect(page.getByRole("heading", { name: "Sign in to dispatch" })).toBeVisible();
  await page.getByLabel("Workspace").fill(SLUG);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByText("Route Optimisation").first().click();
  await page.selectOption("#optimize-driver", job!.assignedDriverId!);
  await page.getByRole("button", { name: "Optimise routes" }).click();

  await expect(page.getByText("OSRM + VROOM")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Planned stop order/)).toBeVisible();

  await page.getByRole("button", { name: "Publish approved plan" }).click();
  await expect(page.getByText("Published")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Route version/)).toBeVisible();

  const after = await fleet(request);
  expect(after.routeVersion).toBe(2);
  expect(after.routes).toHaveLength(1);
  expect(after.routes[0]?.version).toBe(2);
});


