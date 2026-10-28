/**
 * Auth routes (Phase 2): register, login, refresh, logout, me.
 * Bodies are validated against the shared contracts (ADR-0003).
 */
import type { FastifyInstance } from "fastify";
import {
  LoginRequestSchema,
  RefreshRequestSchema,
  RegisterRequestSchema,
} from "@privatefleet/contracts";
import type { AuthService } from "./service.js";
import { makeAuthGuard } from "./guard.js";

export function registerAuthRoutes(app: FastifyInstance, auth: AuthService): void {
  app.post("/v1/auth/register", async (request) => {
    const input = RegisterRequestSchema.parse(request.body);
    return auth.register(input);
  });

  app.post("/v1/auth/login", async (request) => {
    const input = LoginRequestSchema.parse(request.body);
    return auth.login(input);
  });

  app.post("/v1/auth/refresh", async (request) => {
    const input = RefreshRequestSchema.parse(request.body);
    return auth.refresh(input.refreshToken);
  });

  app.post("/v1/auth/logout", async (request) => {
    const input = RefreshRequestSchema.parse(request.body);
    await auth.logout(input.refreshToken);
    return { loggedOut: true };
  });

  app.get("/v1/auth/me", { preHandler: makeAuthGuard(auth) }, async (request) => {
    return { auth: request.auth };
  });
}
