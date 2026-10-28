import type { AuthClaims } from "../modules/auth/guard.js";

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthClaims;
  }
}
