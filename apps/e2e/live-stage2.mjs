import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.goto("https://app.privatefleet.home.arpa/", { waitUntil: "networkidle" });
if (await page.getByRole("heading", { name: "Sign in to dispatch" }).isVisible().catch(() => false)) {
  await page.getByLabel("Workspace").fill("northstar-couriers-b67e10");
  await page.getByLabel("Email").fill("owner@northstar.demo");
  await page.getByLabel("Password").fill("demo-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
}
await page.getByText("Fleet Operations").waitFor({ timeout: 30000 });
await page.waitForTimeout(5000);
const light = page.getByRole("button", { name: "Switch to light map" });
if (await light.isVisible().catch(() => false)) { await light.click(); await page.waitForTimeout(4000); }
await page.screenshot({ path: "C:/Temp/live-stage2.png", fullPage: false });
console.log("status text:", await page.getByText(/vector map/).first().textContent().catch(() => "none"));
console.log("map text:", (await page.locator('[data-testid="map-canvas"]').innerText().catch(() => "")).slice(0, 300));
await browser.close();

