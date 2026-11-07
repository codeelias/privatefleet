/**
 * Report routes: tenant-authenticated, separate from the fleet snapshot and
 * the route-geometry read path (Stage 4 constraint).
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { AuthService } from "../auth/service.js";
import { makeAuthGuard } from "../auth/guard.js";
import type { DbHandle } from "../../db/client.js";
import { deliveryPerformance, deliveryPerformanceCsv } from "./delivery-performance.js";
import { analyticsReport } from "./analytics.js";
import { stopsReport, tripsReport } from "./segmentation.js";

const QuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  jobId: z.string().uuid().optional(),
  format: z.enum(["json", "csv"]).optional().default("json"),
});

const SegmentQuerySchema = z.object({
  vehicleId: z.string().uuid(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 31;

/**
 * Bound every report to at most 31 days and always resolve explicit
 * from/to, so query-time segmentation can never scan all history.
 */
function resolveRange(
  from: string | undefined,
  to: string | undefined,
  defaultDays: number,
): { from: string; to: string } | { error: true } {
  const now = Date.now();
  const toMs = to ? Date.parse(to) : now;
  const fromMs = from ? Date.parse(from) : toMs - defaultDays * DAY_MS;
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) {
    return { error: true };
  }
  if (toMs - fromMs > MAX_RANGE_DAYS * DAY_MS) {
    return { error: true };
  }
  return {
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
  };
}

function sendRangeError(reply: FastifyReply) {
  return reply.status(422).send({
    type: "https://privatefleet.example/errors/invalid-date-range",
    title: "Request could not be completed",
    status: 422,
    code: "INVALID_DATE_RANGE",
    detail: `Reports are limited to ${MAX_RANGE_DAYS} days per request`,
    uiMessage: "Choose a date range of at most 31 days.",
  });
}

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
    const range = resolveRange(query.from, query.to, 31);
    if ("error" in range) {
      return sendRangeError(reply);
    }
    const report = await deliveryPerformance(handle, request.auth?.tenantId ?? "", {
      jobId: query.jobId,
      from: range.from,
      to: range.to,
    });
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

  app.get("/v1/reports/analytics", { preHandler: guard }, async (request, reply) => {
    if (request.auth?.role === "driver") {
      return reply.status(403).send({
        type: "https://privatefleet.example/errors/report_staff_only",
        title: "Request could not be completed",
        status: 403,
        code: "REPORT_STAFF_ONLY",
        detail: "Reports require a staff account",
        uiMessage: "Ask dispatch for the analytics report.",
      });
    }
    const query = QuerySchema.parse(request.query ?? {});
    const range = resolveRange(query.from, query.to, 7);
    if ("error" in range) {
      return sendRangeError(reply);
    }
    return analyticsReport(handle, request.auth?.tenantId ?? "", {
      from: range.from,
      to: range.to,
    });
  });

  app.get("/v1/reports/trips", { preHandler: guard }, async (request, reply) => {
    if (request.auth?.role === "driver") {
      return reply.status(403).send({
        type: "https://privatefleet.example/errors/report_staff_only",
        title: "Request could not be completed",
        status: 403,
        code: "REPORT_STAFF_ONLY",
        detail: "Reports require a staff account",
        uiMessage: "Ask dispatch for the trip report.",
      });
    }
    const query = SegmentQuerySchema.parse(request.query ?? {});
    const range = resolveRange(query.from, query.to, 1);
    if ("error" in range) {
      return sendRangeError(reply);
    }
    return tripsReport(handle, request.auth?.tenantId ?? "", {
      vehicleId: query.vehicleId,
      from: range.from,
      to: range.to,
    });
  });

  app.get("/v1/reports/stops", { preHandler: guard }, async (request, reply) => {
    if (request.auth?.role === "driver") {
      return reply.status(403).send({
        type: "https://privatefleet.example/errors/report_staff_only",
        title: "Request could not be completed",
        status: 403,
        code: "REPORT_STAFF_ONLY",
        detail: "Reports require a staff account",
        uiMessage: "Ask dispatch for the stop report.",
      });
    }
    const query = SegmentQuerySchema.parse(request.query ?? {});
    const range = resolveRange(query.from, query.to, 1);
    if ("error" in range) {
      return sendRangeError(reply);
    }
    return stopsReport(handle, request.auth?.tenantId ?? "", {
      vehicleId: query.vehicleId,
      from: range.from,
      to: range.to,
    });
  });
}
