/**
 * Dispatcher CSV ingestion acceptance: preview catches an invalid address,
 * commit is blocked until the CSV is corrected, then all four jobs commit.
 */
import { expect, test, type Page } from "@playwright/test";

const WEB = "http://127.0.0.1:5176";
const SLUG = "northstar-fleet-e2e";
const EMAIL = "fleet@northstar.demo";
const PASSWORD = "demo-password-123";
const HEADER =
  "job_ref,service_type,priority,stop_type,address,latitude,longitude,window_start,window_end";

function csv(rows: string[]): string {
  return [HEADER, ...rows].join("\n");
}

const validRows = [
  'BULK-1001,Delivery,standard,dropoff,"10 Downing Street, London",51.5034,-0.1276,2026-10-30T09:00:00Z,2026-10-30T12:00:00Z',
  'BULK-1002,Delivery,standard,dropoff,"St Paul\'s Cathedral, London",51.5138,-0.0984,2026-10-30T09:00:00Z,2026-10-30T12:00:00Z',
  'BULK-1003,Delivery,urgent,dropoff,"Tower Bridge, London",51.5055,-0.0754,2026-10-30T09:00:00Z,2026-10-30T12:00:00Z',
];

async function login(page: Page): Promise<void> {
  await page.goto(WEB);
  await page.getByLabel("Workspace").fill(SLUG);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Fleet Operations")).toBeVisible();
}

async function upload(page: Page, text: string): Promise<void> {
  await page.getByLabel("CSV file").setInputFiles({
    name: "jobs.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(text),
  });
}

test("CSV import blocks an invalid address, then commits the corrected batch", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("button", { name: "Jobs & Work Orders" }).click();
  await page.getByRole("button", { name: "Bulk Import" }).click();

  await upload(
    page,
    csv([
      ...validRows,
      'BULK-1004,Delivery,standard,dropoff,"Outside Service Area",0,0,2026-10-30T09:00:00Z,2026-10-30T12:00:00Z',
    ]),
  );

  await expect(page.getByText("3 valid")).toBeVisible();
  await expect(page.getByText("1 invalid")).toBeVisible();
  await expect(page.getByText(/outside the import service area/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Commit \d+ Jobs/ })).toBeDisabled();

  await upload(
    page,
    csv([
      ...validRows,
      'BULK-1004,Delivery,standard,dropoff,"Borough Market, London",51.5055,-0.091,2026-10-30T09:00:00Z,2026-10-30T12:00:00Z',
    ]),
  );

  await expect(page.getByText("4 valid")).toBeVisible();
  await expect(page.getByText("0 invalid")).toBeVisible();
  const commit = page.getByRole("button", { name: "Commit 4 Jobs" });
  await expect(commit).toBeEnabled();
  await commit.click();
  await expect(page.getByText(/4 jobs imported/i)).toBeVisible();
});
