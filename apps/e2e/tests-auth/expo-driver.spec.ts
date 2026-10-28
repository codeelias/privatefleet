import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Expo driver runtime acceptance (Phase 3): the exported Expo web bundle
 * runs as a browser-hosted React Native app, signs in against the real
 * postgres-mode API (CORS-enabled), completes the deterministic J-000
 * job, and the dispatcher's authenticated view shows it completed.
 */
const API = "http://127.0.0.1:4002";
const EXPO_WEB = "http://127.0.0.1:8080";
const SLUG = "northstar-auth-e2e";
const PIN = "1234";

interface FleetView {
  drivers: Array<{ id: string; fullName: string }>;
  jobs: Array<{
    id: string;
    reference: string;
    status: string;
    assignedDriverId?: string;
    stops: Array<{ id: string; status: string }>;
  }>;
}

async function ownerSession(request: APIRequestContext): Promise<{ accessToken: string }> {
  const login = await request.post(`${API}/v1/auth/login`, {
    data: { tenantSlug: SLUG, email: "owner@northstar.demo", password: "demo-password-123" },
  });
  if (!login.ok()) {
    throw new Error(`owner login failed: ${login.status()} ${await login.text()}`);
  }
  return ((await login.json()) as { tokens: { accessToken: string } }).tokens;
}

async function fleet(request: APIRequestContext, token: { accessToken: string }): Promise<FleetView> {
  const res = await request.get(`${API}/v1/fleet/state`, {
    headers: { authorization: `Bearer ${token.accessToken}` },
  });
  if (!res.ok()) {
    throw new Error(`fleet state failed: ${res.status()}`);
  }
  return (await res.json()) as FleetView;
}

async function holdToConfirm(page: Page): Promise<void> {
  const hold = page.getByRole("button", { name: /hold to confirm/i });
  await hold.hover();
  await page.mouse.down();
  await page.waitForTimeout(1_100);
  await page.mouse.up();
}

test("Expo web driver completes a real job and dispatch sees it", async ({ page, request }) => {
  const initial = await fleet(request, await ownerSession(request));
  const job = initial.jobs.find((candidate) => candidate.reference === "J-001");
  expect(job).toBeTruthy();
  const driver = initial.drivers.find((candidate) => candidate.id === job!.assignedDriverId);
  expect(driver).toBeTruthy();

  await page.goto(EXPO_WEB);
  await expect(page.getByText("Driver sign in")).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Workspace").fill(SLUG);
  await page.getByLabel("Driver ID").fill(driver!.id);
  await page.getByLabel("PIN").fill(PIN);
  await page.getByRole("button", { name: "Sign in" }).click();

  const firstName = driver!.fullName.split(" ")[0];
  await expect(page.getByText(`Good morning, ${firstName}`)).toBeVisible();
  await expect(page.getByText("J-001").first()).toBeVisible();

  await page.getByRole("button", { name: /Expo Test Stop/ }).click();
  await expect(page.getByText("ACTIVE JOB / J-001")).toBeVisible();
  await holdToConfirm(page);
  await page.getByRole("button", { name: "Go to completion" }).click();
  await page.getByLabel("Recipient name").fill("Expo Recipient");
  await page.getByRole("button", { name: "Complete stop" }).click();
  await expect(page.getByText(`Good morning, ${firstName}`)).toBeVisible();

  const after = await fleet(request, await ownerSession(request));
  const completed = after.jobs.find((candidate) => candidate.id === job!.id);
  expect(completed?.status).toBe("completed");
  expect(completed?.stops.every((stop) => stop.status === "completed")).toBe(true);
});

