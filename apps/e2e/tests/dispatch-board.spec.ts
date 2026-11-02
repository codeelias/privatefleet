/**
 * Dispatch Board acceptance: split workspace, compact queue, assignment
 * hand-off and collapse behaviour. Data comes from the real demo API.
 */
import { expect, test } from "@playwright/test";
import { API, WEB, resetScenario } from "./helpers";

test.skip(({ isMobile }) => Boolean(isMobile), "desktop dispatcher board only");

test("Dispatch Board: schedule and queue share the workspace", async ({ page }) => {
  await resetScenario("morning-rush");
  await page.goto(WEB);
  await page.getByRole("button", { name: "Dispatch Board" }).click();

  await expect(page.getByRole("heading", { name: "Dispatch Board" })).toBeVisible();
  await expect(page.getByText("Job queue")).toBeVisible();
  await expect(page.getByText("Window risks", { exact: true })).toBeVisible();
  await expect(page.getByText("TUE 27 OCT - DAY SHIFT")).toHaveCount(0);

  // Queue row opens the existing server-backed assignment preview.
  const row = page.getByRole("button", { name: /J-208/ }).first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  // The queue can get out of the schedule's way without losing its count.
  await page.getByRole("button", { name: "Collapse job queue" }).click();
  const expandQueue = page.getByRole("button", { name: "Expand job queue" }).last();
  await expect(expandQueue).toBeVisible();
  await expect(expandQueue).toContainText(/\d+/);
  await expandQueue.click();
  await expect(page.getByText("Job queue")).toBeVisible();

  // Search filters the compact rows without a backend round trip.
  const search = page.getByRole("searchbox", { name: "Search unassigned jobs" });
  await search.fill("J-208");
  await expect(page.getByRole("button", { name: /J-208/ }).first()).toBeVisible();
  await expect(page.getByText(/1 of \d+ unassigned/)).toBeVisible();

  // The board must still be backed by the same authoritative store.
  const state = await (await fetch(`${API}/v1/fleet/state`)).json();
  expect(state.jobs.some((job: { reference: string }) => job.reference === "J-208")).toBe(true);
});



