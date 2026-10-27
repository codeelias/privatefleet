/**
 * Composition root (docs/04.2): buildApp() is the testable Fastify
 * instance; modules register here. Slice 1 registers meta/health only -
 * demo modules (jobs, dispatch, tracking) arrive per the handoff sequence.
 */
import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppConfig } from "./config.js";

export function buildApp(config: AppConfig) {
  const app = Fastify({ logger: true }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.get(
    "/healthz",
    { schema: { response: { 200: z.object({ status: z.literal("ok") }) } } },
    async () => ({ status: "ok" as const }),
  );

  app.get(
    "/readyz",
    {
      schema: {
        response: {
          200: z.object({
            status: z.literal("ok"),
            demoMode: z.boolean(),
            version: z.string(),
          }),
        },
      },
    },
    async () => ({
      status: "ok" as const,
      demoMode: config.demoMode,
      version: config.version,
    }),
  );

  app.get(
    "/v1/meta",
    {
      schema: {
        response: {
          200: z.object({
            name: z.string(),
            version: z.string(),
            demoMode: z.boolean(),
          }),
        },
      },
    },
    async () => ({
      name: config.name,
      version: config.version,
      demoMode: config.demoMode,
    }),
  );

  return app;
}
