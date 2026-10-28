import { ensureDatabase } from "./src/db/ensure-db.js";

export default async function globalSetup(): Promise<void> {
  const url =
    process.env.TEST_DATABASE_URL ??
    "postgres://privatefleet_app:privatefleet_app_pw@127.0.0.1:5432/privatefleet_dev";
  await ensureDatabase(url);
}
