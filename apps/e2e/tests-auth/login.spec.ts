/**
 * Browser authentication acceptance (Phase 2 gate follow-up).
 * Runs against the real API in POSTGRES mode on port 4002.
 */
import { expect, test, type Page } from "@playwright/test";

const API = "http://127.0.0.1:4002";
const SLUG = "northstar-auth-e2e";
const EMAIL = "owner@northstar.demo";
const PASSWORD = "demo-password-123";

interface StoredSession {
  accessToken: string;
  refreshToken: string;
  tenant: { id: string; slug: string; name: string };
}

async function session(page: Page): Promise<StoredSession> {
  const raw = await page.evaluate(() => localStorage.getItem("privatefleet.session.v1"));
  if (!raw) {
    throw new Error("no stored session");
  }
  return JSON.parse(raw) as StoredSession;
}

async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in to dispatch" })).toBeVisible();
  await page.getByLabel("Workspace").fill(SLUG);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("tenant-name")).toHaveText("Northstar Couriers");
}

test("valid credentials open the tenant's fleet", async ({ page }) => {
  await signIn(page);
  await expect(page.getByText("Fleet Operations")).toBeVisible();
  await expect(page.getByText("Unassigned jobs - drag onto a driver or select")).toBeVisible();
  const stored = await session(page);
  expect(stored.tenant.slug).toBe(SLUG);
});

test("invalid credentials show a clear message and no raw details", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Workspace").fill(SLUG);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  const error = page.getByRole("status").getByText(/email or password is incorrect/i);
  await expect(error).toBeVisible();
  const text = (await error.textContent()) ?? "";
  expect(text).not.toMatch(/403|500|stack|Bearer|postgres/i);
  await expect(page.getByRole("heading", { name: "Sign in to dispatch" })).toBeVisible();
});

test("an expired access token is refreshed transparently", async ({ page }) => {
  await signIn(page);
  const before = await session(page);

  // access TTL is 3s in this environment
  await page.waitForTimeout(4_500);
  await page.reload();

  await expect(page.getByTestId("tenant-name")).toHaveText("Northstar Couriers");
  await expect(page.getByText("Unassigned jobs - drag onto a driver or select")).toBeVisible();
  const after = await session(page);
  expect(after.refreshToken).not.toBe(before.refreshToken);
  expect(after.accessToken).not.toBe(before.accessToken);
});

test("a revoked refresh token fails safely back to login", async ({ page, request }) => {
  await signIn(page);
  const stored = await session(page);

  // Invalidate the server-side session, then force a token use.
  const logout = await request.post(`${API}/v1/auth/logout`, {
    data: { refreshToken: stored.refreshToken },
  });
  expect(logout.status()).toBe(200);

  await page.waitForTimeout(4_500);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in to dispatch" })).toBeVisible();
  const cleared = await page.evaluate(() => localStorage.getItem("privatefleet.session.v1"));
  expect(cleared).toBeNull();
});

test("logout clears local state and invalidates the server session", async ({ page, request }) => {
  await signIn(page);
  const stored = await session(page);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to dispatch" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("privatefleet.session.v1"))).toBeNull();

  const replay = await request.post(`${API}/v1/auth/refresh`, {
    data: { refreshToken: stored.refreshToken },
  });
  expect(replay.status()).toBe(401);
});

test("tenant isolation: a session cannot read another tenant's fleet", async ({ page, request }) => {
  await signIn(page);
  const stored = await session(page);
  const own = await request.get(`${API}/v1/fleet/state`, {
    headers: { authorization: `Bearer ${stored.accessToken}` },
  });
  expect(own.status()).toBe(200);
  const ownState = (await own.json()) as {
    tenantId: string;
    jobs: Array<{ id: string }>;
  };
  expect(ownState.tenantId).toBe(stored.tenant.id);
  expect(ownState.jobs.length).toBeGreaterThan(0);

  const email = `isolation-${Date.now()}@example.test`;
  const register = await request.post(`${API}/v1/auth/register`, {
    data: { tenantName: `Isolation ${Date.now()}`, email, password: "correct horse battery staple" },
  });
  expect(register.status()).toBe(200);
  const other = (await register.json()) as {
    tokens: { accessToken: string };
    tenant: { id: string };
  };

  const foreign = await request.get(`${API}/v1/fleet/state`, {
    headers: { authorization: `Bearer ${other.tokens.accessToken}` },
  });
  const foreignState = (await foreign.json()) as { tenantId: string; jobs: unknown[] };
  expect(foreignState.tenantId).toBe(other.tenant.id);
  expect(foreignState.jobs.length).toBe(0);
  expect(foreignState.tenantId).not.toBe(ownState.tenantId);
});
