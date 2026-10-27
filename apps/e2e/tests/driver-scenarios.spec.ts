/**
 * Driver-side Proof of Service scenario (docs/12.2): the driver
 * completes both stops of J-198 through the mobile app; the shared
 * server state reflects every transition.
 */
import { expect, test } from "@playwright/test";
import { DRIVER, fleetState, resetScenario } from "./helpers";

test.skip(({ isMobile }) => !isMobile, "mobile driver project only");

test("Proof of Service: driver completes the job; dispatcher state reflects it", async ({
  page,
}) => {
  await resetScenario("proof");

  await page.goto(DRIVER);
  await page.getByRole("button", { name: /Sarah Reed/ }).click();
  await expect(page.getByText("Good morning, Sarah")).toBeVisible();

  // Stop 1 is already arrived: open it and complete the POD.
  await page.getByRole("button", { name: "Open active job" }).click();
  await expect(page.getByText("ACTIVE JOB / J-198")).toBeVisible();
  await expect(page.getByText("Go to completion")).toBeVisible();
  await page.getByRole("button", { name: "Go to completion" }).click();
  await page.getByPlaceholder(/Recipient name/).fill("Jane Doe");
  await page.getByRole("button", { name: "Complete stop" }).click();
  await expect(page.getByText("Good morning, Sarah")).toBeVisible();

  // Stop 2: hold-to-confirm arrival, then complete.
  await page.getByRole("button", { name: "Open active job" }).click();
  const hold = page.getByRole("button", { name: /hold to confirm/i });
  await hold.hover();
  await page.mouse.down();
  await page.waitForTimeout(1_000);
  await page.mouse.up();
  await expect(page.getByText("Go to completion")).toBeVisible();
  await page.getByRole("button", { name: "Go to completion" }).click();
  await page.getByPlaceholder(/Recipient name/).fill("Jane Doe");
  await page.getByRole("button", { name: "Complete stop" }).click();
  await expect(page.getByText("Good morning, Sarah")).toBeVisible();

  const state = await fleetState();
  const job = state.jobs.find((j) => j.reference === "J-198");
  expect(job?.status).toBe("completed");
  expect(job?.stops.every((s) => s.status === "completed")).toBeTruthy();
});
