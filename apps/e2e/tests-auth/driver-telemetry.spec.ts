import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * Phase 4 acceptance: real device geolocation -> authenticated telemetry
 * endpoint -> durable position -> verified tenant socket/snapshot. The
 * dispatcher reads the authorised snapshot, not a client-side guess.
 */
const API = "http://127.0.0.1:4002";
const DRIVER_APP = "http://127.0.0.1:5177";
const SLUG = "northstar-auth-e2e";
const PIN = "1234";

test.use({
  geolocation: { latitude: 51.5001, longitude: -0.1201 },
  permissions: ["geolocation"],
});

interface FleetView {
  drivers: Array<{ id: string; fullName: string; vehicleId?: string }>;
  vehicles: Array<{
    id: string;
    location?: { latitude: number; longitude: number };
    stale: boolean;
  }>;
}

async function ownerToken(request: APIRequestContext): Promise<string> {
  const login = await request.post(`${API}/v1/auth/login`, {
    data: { tenantSlug: SLUG, email: "owner@northstar.demo", password: "demo-password-123" },
  });
  expect(login.ok()).toBe(true);
  return ((await login.json()) as { tokens: { accessToken: string } }).tokens.accessToken;
}

async function fleet(request: APIRequestContext): Promise<FleetView> {
  const res = await request.get(`${API}/v1/fleet/state`, {
    headers: { authorization: `Bearer ${await ownerToken(request)}` },
  });
  expect(res.ok()).toBe(true);
  return (await res.json()) as FleetView;
}

function metres(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const dLat = (b.latitude - a.latitude) * 110_540;
  const dLon = (b.longitude - a.longitude) * 111_320 * Math.cos((a.latitude * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

test("driver shares device location and dispatch sees the authorised position", async ({
  page,
  request,
  context,
}) => {
  const initial = await fleet(request);
  const driver = initial.drivers.find((candidate) => candidate.vehicleId);
  expect(driver).toBeTruthy();

  await page.goto(DRIVER_APP);
  await expect(page.getByText("Driver sign in")).toBeVisible();
  await page.getByLabel("Workspace").fill(SLUG);
  await page.getByLabel("Driver ID").fill(driver!.id);
  await page.getByLabel("PIN").fill(PIN);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(`Good morning, ${driver!.fullName.split(" ")[0]}`)).toBeVisible();

  await page.getByRole("button", { name: "Share location" }).click();
  await expect(page.getByRole("button", { name: "Stop sharing location" })).toBeVisible();

  const target = { latitude: 51.5022, longitude: -0.1188 };
  await context.setGeolocation(target);

  await expect
    .poll(
      async () => {
        const state = await fleet(request);
        const vehicle = state.vehicles.find((candidate) => candidate.id === driver!.vehicleId);
        if (!vehicle?.location) {
          return Number.POSITIVE_INFINITY;
        }
        return metres(vehicle.location, target);
      },
      { timeout: 40_000, intervals: [2_000] },
    )
    .toBeLessThan(120);

  const state = await fleet(request);
  const vehicle = state.vehicles.find((candidate) => candidate.id === driver!.vehicleId);
  expect(vehicle?.stale).toBe(false);

  await page.getByRole("button", { name: "Stop sharing location" }).click();
  await expect(page.getByRole("button", { name: "Share location" })).toBeVisible();
});

