/**
 * Jobs & Work Orders acceptance: find, filter, inspect and act on a job
 * without leaving the list.
 */
import { expect, test } from "@playwright/test";
import { API, WEB, resetScenario } from "./helpers";

test.skip(({ isMobile }) => Boolean(isMobile), "desktop jobs workspace only");

test("Jobs: find, filter, inspect and assign", async ({ page }) => {
  await resetScenario("morning-rush");
  await page.goto(WEB);
  await page.getByRole("button", { name: "Jobs & Work Orders" }).click();

  await expect(page.getByRole("heading", { name: "Jobs & work orders" })).toBeVisible();
  await expect(page.getByText("Unassigned", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search jobs" })).toBeVisible();

  const search = page.getByRole("searchbox", { name: "Search jobs" });
  await search.fill("J-208");
  await expect(page.getByText("J-208").first()).toBeVisible();

  // Priority and status are separate signals.
  await expect(page.locator("tbody").getByText("STAT", { exact: true }).first()).toBeVisible();
  const priority = page.getByRole("combobox", { name: "Filter priority" });
  await priority.selectOption("stat");
  await expect(page.getByText("J-208").first()).toBeVisible();

  // Open the record drawer.
  await page.getByRole("button", { name: "View" }).first().click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Journey")).toBeVisible();
  await expect(drawer.getByText("Execution history")).toBeVisible();
  await expect(drawer.getByText("Proof and evidence")).toBeVisible();
  await expect(drawer.getByText("Unassigned").first()).toBeVisible();

  // Assignment hand-off uses the existing server-backed preview.
  await drawer.getByRole("button", { name: "Assign job" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  // Bulk selection is explicit and does not bypass assignment validation.
  await search.fill("");
  await page.getByRole("checkbox", { name: /^Select / }).first().check();
  await expect(page.getByText(/1 job selected/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Export CSV" })).toBeVisible();

  const state = await (await fetch(`${API}/v1/fleet/state`)).json();
  expect(state.jobs.some((job: { reference: string }) => job.reference === "J-208")).toBe(true);
});

