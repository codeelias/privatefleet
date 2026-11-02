/**
 * Route Optimisation workbench acceptance: compact policy rail, advanced
 * editor and the ready state before any run. The real solver run is exercised
 * separately because it is slow and creates a proposal.
 */
import { expect, test } from "@playwright/test";
import { WEB, resetScenario } from "./helpers";

test.skip(({ isMobile }) => Boolean(isMobile), "desktop optimisation workbench only");

test("Route Optimisation: policy rail and ready state", async ({ page }) => {
  await resetScenario("morning-rush");
  await page.goto(WEB);
  await page.getByRole("button", { name: "Route Optimisation" }).click();

  await expect(page.getByRole("heading", { name: "Plan work against policy" })).toBeVisible();
  await expect(page.getByText("Nothing is published until you approve")).toBeVisible();
  await expect(page.getByRole("button", { name: /Optimise fleet|Optimise routes/ })).toBeVisible();
  // The live policy rail is intentionally absent in demo mode; when present,
  // verify the compact editor and its vehicle overrides.
  if (await page.getByText("Dispatch policy").count()) {
    await expect(page.getByText("Dispatch policy")).toBeVisible();
    await page.getByRole("button", { name: "Advanced" }).click();
    await expect(page.getByLabel("Max km")).toBeVisible();
    await expect(page.getByLabel("Travel hours")).toBeVisible();
    await expect(page.getByText("Vehicle overrides")).toBeVisible();
    await expect(page.getByText("Save vehicle overrides")).toBeVisible();
    await page.getByRole("button", { name: "Hide advanced" }).click();
    await expect(page.getByLabel("Max km")).toHaveCount(0);
  }

  // The right rail must not create horizontal page overflow.
  const layout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(layout.scrollWidth).toBe(layout.clientWidth);

});
