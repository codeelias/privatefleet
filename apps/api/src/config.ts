/**
 * Environment configuration (docs/04.7): zod-parsed, fail fast at boot.
 * DEMO_MODE=true selects in-memory repositories and enables modules/demo
 * (ADR-0007: the demo seam is server-side).
 */
import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default("0.0.0.0"),
  DEMO_MODE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

export interface AppConfig {
  port: number;
  host: string;
  demoMode: boolean;
  name: string;
  version: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return {
    port: parsed.data.PORT,
    host: parsed.data.HOST,
    demoMode: parsed.data.DEMO_MODE,
    name: "privatefleet-api",
    version: "0.1.0",
  };
}
