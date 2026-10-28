/**
 * Environment loading for local development: reads apps/api/.env when
 * present (Node 22 loadEnvFile), then parses configuration fail-fast.
 * Demo mode needs no file; Postgres mode needs DATABASE_URL and
 * AUTH_JWT_SECRET (see .env.example).
 */
import { existsSync } from "node:fs";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}
