/**
 * Report routes: tenant-authenticated, separate from the fleet snapshot and
 * the route-geometry read path (Stage 4 constraint).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthService } from "../auth/service.js";
import { makeAuthGuard } from "../auth/guard.js";
import type { DbHandle } from "../../db/client.js";
import { deliveryPerformance, deliveryPerformanceCsv } from "./delivery-performance.js";

const QuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  jobId: z.string().uuid().optional(),
  format: z.enum(["json", "csv"]).optional().default("json"),
});

export function registerReportRoutes(app: FastifyInstance, auth: AuthService, handle: DbHandle): void {
  const guard = makeAuthGuard(auth);

  app.get("/v1/reports/delivery-performance", { preHandler: guard }, async (request, reply) => {
    if (request.auth?.role === "driver") {
      return reply.status(403).send({
        type: "https://privatefleet.example/errors/report_staff_only",
        title: "Request could not be completed",
        status: 403,
        code: "REPORT_STAFF_ONLY",
        detail: "Reports require a staff account",
        uiMessage: "Ask dispatch for the delivery performance report.",
      });
    }
    const query = QuerySchema.parse(request.query ?? {});
    const report = await deliveryPerformance(handle, request.auth?.tenantId ?? "", query);
    if (query.format === "csv") {
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header(
          "content-disposition",
          `attachment; filename="delivery-performance-${report.generatedAt.slice(0, 10)}.csv"`,
        )
        .send(deliveryPerformanceCsv(report));
    }
    return report;
  });
}
