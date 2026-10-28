import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Phase 3 browser acceptance (docs/06, docs/14): a driver signs in on the
 * device app against the real postgres-mode API, completes a real
 * assigned job (arrive + proof of delivery), and the dispatcher's own
 * authenticated view shows the authorised update.
 *
 * Uses the deterministic single-stop seed job J-000 so the acceptance is
 * about the workflow, not queue interleaving.
 */
const API = "http://127.0.0.1:4002";
const DRIVER_APP = "http://127.0.0.1:5177";
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
  const session = (await login.json()) as { tokens: { accessToken: string } };
  return session.tokens;
}

async function dispatcherFleet(
  request: APIRequestContext,
  token: { accessToken: string },
): Promise<FleetView> {
  const res = await request.get(`${API}/v1/fleet/state`, {
    headers: { authorization: `Bearer ${token.accessToken}` },
  });
  if (!res.ok()) {
    throw new Error(`fleet state failed: ${res.status()} ${await res.text()}`);
  }
  const view = (await res.json()) as FleetView;
  if (!Array.isArray(view.jobs)) {
    throw new Error("fleet state payload missing jobs");
  }
  return view;
}

async function holdToConfirm(page: Page): Promise<void> {
  const hold = page.getByRole("button", { name: /hold to confirm/i });
  await hold.hover();
  await page.mouse.down();
  await page.waitForTimeout(1_100);
  await page.mouse.up();
}

test("driver completes a real assigned job and dispatch sees it", async ({ page, request }) => {
  const initial = await dispatcherFleet(request, await ownerSession(request));
  const job = initial.jobs.find((candidate) => candidate.reference === "J-000");
  expect(job).toBeTruthy();
  expect(job!.stops.length).toBe(1);
  const driver = initial.drivers.find((candidate) => candidate.id === job!.assignedDriverId);
  expect(driver).toBeTruthy();

  await page.goto(DRIVER_APP);
  await expect(page.getByText("Driver sign in")).toBeVisible();
  await page.getByLabel("Workspace").fill(SLUG);
  await page.getByLabel("Driver ID").fill(driver!.id);
  await page.getByLabel("PIN").fill(PIN);
  await page.getByRole("button", { name: "Sign in" }).click();

  const firstName = driver!.fullName.split(" ")[0];
  await expect(page.getByText(`Good morning, ${firstName}`)).toBeVisible();
  await expect(page.getByText("J-000").first()).toBeVisible();

  // Arrive (hold-to-confirm) then complete the proof of delivery.
  await page.getByRole("button", { name: "Open active job" }).click();
  await expect(page.getByText("ACTIVE JOB / J-000")).toBeVisible();
  await holdToConfirm(page);
  await page.getByRole("button", { name: "Go to completion" }).click();
  await page.getByPlaceholder(/Recipient name/).fill("Browser Recipient");
  await page.getByRole("button", { name: "Complete stop" }).click();
  await expect(page.getByText(`Good morning, ${firstName}`)).toBeVisible();

  // The dispatcher's fresh authenticated view shows the authorised update.
  const after = await dispatcherFleet(request, await ownerSession(request));
  const completed = after.jobs.find((candidate) => candidate.id === job!.id);
  expect(completed?.status).toBe("completed");
  expect(completed?.stops.every((stop) => stop.status === "completed")).toBe(true);
});


