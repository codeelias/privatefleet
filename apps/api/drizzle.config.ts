import { defineConfig } from "drizzle-kit";

const url =
  process.env.MIGRATION_DATABASE_URL ??
  "postgres://privatefleet:privatefleet_dev_pw@127.0.0.1:5432/privatefleet_dev";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
