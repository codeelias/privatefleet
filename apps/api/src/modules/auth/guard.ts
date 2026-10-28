/**
 * Bearer-token guard: verifies the access JWT and attaches the tenant
 * identity to the request. Every operational route must use this guard
 * so tenant context comes from a verified token, never a client header.
 */
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import type { AuthService } from "./service.js";

export interface AuthClaims {
  tenantId: string;
  userId: string;
  role: string;
}

export function makeAuthGuard(auth: AuthService): preHandlerAsyncHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const header = request.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (!token) {
      await reply.status(401).send({
        type: "https://privatefleet.example/errors/auth_required",
        title: "Not signed in",
        status: 401,
        code: "AUTH_REQUIRED",
        detail: "Missing bearer token",
        uiMessage: "Please sign in again - your session has expired.",
      });
      return;
    }
    try {
      request.auth = await auth.verifyAccess(token);
    } catch {
      await reply.status(401).send({
        type: "https://privatefleet.example/errors/auth_invalid",
        title: "Session expired",
        status: 401,
        code: "AUTH_INVALID",
        detail: "Invalid or expired access token",
        uiMessage: "Please sign in again - your session has expired.",
      });
    }
  };
}
