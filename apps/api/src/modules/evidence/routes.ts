import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  EVIDENCE_KINDS,
  EvidenceKindSchema,
  FAILURE_REASON_CODES,
  ProofPolicySchema,
} from "@privatefleet/contracts";
import type { AuthService } from "../auth/service.js";
import { makeAuthGuard } from "../auth/guard.js";
import type { EvidenceService } from "./service.js";

const ParamsSchema = z.object({
  jobId: z.string().uuid(),
  stopId: z.string().uuid(),
});

const EvidenceBodySchema = z
  .object({
    kind: EvidenceKindSchema,
    dataBase64: z.string().max(12_000_000).optional(),
    pathData: z.string().max(20_000).optional(),
    capturedAt: z.string().datetime().optional(),
  })
  .refine((value) => Boolean(value.dataBase64 || (value.kind === "signature" && value.pathData)), {
    message: "Evidence bytes are required",
  });

const PolicyBodySchema = ProofPolicySchema.omit({ serviceType: true }).extend({
  serviceType: z.string().min(1).max(80).default("*"),
});

export function registerEvidenceRoutes(
  app: FastifyInstance,
  auth: AuthService,
  _fleet: unknown,
  evidence: EvidenceService,
): void {
  const guard = makeAuthGuard(auth);

  app.post(
    "/v1/jobs/:jobId/stops/:stopId/evidence",
    { preHandler: guard, bodyLimit: 12 * 1024 * 1024 },
    async (request, reply) => {
      const authClaims = request.auth;
      if (!authClaims || authClaims.role !== "driver") {
        return reply.status(403).send({
          type: "https://privatefleet.example/errors/evidence_driver_only",
          title: "Request could not be completed",
          status: 403,
          code: "EVIDENCE_DRIVER_ONLY",
          detail: "Only the assigned driver can upload delivery evidence",
          uiMessage: "Sign in as the driver to capture proof for this stop.",
        });
      }
      const params = ParamsSchema.parse(request.params);
      const body = EvidenceBodySchema.parse(request.body);
      return evidence.record(
        authClaims.tenantId,
        authClaims.userId,
        authClaims.userId,
        params.jobId,
        params.stopId,
        body,
      );
    },
  );

  app.get("/v1/jobs/:jobId/stops/:stopId/evidence", { preHandler: guard }, async (request) => {
    const authClaims = request.auth;
    if (!authClaims) {
      throw new Error("unauthorised");
    }
    const params = ParamsSchema.parse(request.params);
    return {
      evidence: await evidence.list(
        authClaims.tenantId,
        params.jobId,
        params.stopId,
        true,
        { role: authClaims.role, userId: authClaims.userId },
      ),
    };
  });

  app.get("/v1/proof-policy", { preHandler: guard }, async (request) => {
    const authClaims = request.auth;
    if (!authClaims) {
      throw new Error("unauthorised");
    }
    const query = (request.query ?? {}) as { serviceType?: string };
    return evidence.policy(authClaims.tenantId, query.serviceType ?? "*");
  });

  app.put("/v1/proof-policy", { preHandler: guard }, async (request, reply) => {
    const authClaims = request.auth;
    if (!authClaims) {
      throw new Error("unauthorised");
    }
    if (authClaims.role !== "owner" && authClaims.role !== "admin") {
      return reply.status(403).send({
        type: "https://privatefleet.example/errors/policy_owner_only",
        title: "Request could not be completed",
        status: 403,
        code: "POLICY_OWNER_ONLY",
        detail: "Owner or admin role required",
        uiMessage: "Only an owner can change proof requirements.",
      });
    }
    const body = PolicyBodySchema.parse(request.body);
    return evidence.setPolicy(authClaims.tenantId, body.serviceType, {
      requireRecipient: body.requireRecipient,
      requireSignature: body.requireSignature,
      requirePhoto: body.requirePhoto,
      requireFailurePhoto: body.requireFailurePhoto,
    });
  });

  void EVIDENCE_KINDS;
  void FAILURE_REASON_CODES;
}
