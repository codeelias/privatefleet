/**
 * Customer notifications (docs/54 R6): transport-agnostic delivery engine.
 *
 * Honesty contract: a notification is recorded for every attempt with an
 * explicit status (pending/sent/failed). Sent is written ONLY when the
 * transport confirmed delivery. With no SMTP configured the attempt is
 * recorded as failed with a truthful detail - delivery is never claimed.
 */
import { sql } from "drizzle-orm";
import type { EventEnvelope } from "@privatefleet/contracts";
import { withTenant, type DbHandle } from "../../db/client.js";

export interface NotificationInput {
  to: string;
  subject: string;
  bodyText: string;
}

export interface NotificationTransport {
  send(input: NotificationInput): Promise<{ ok: boolean; detail?: string }>;
}

/** Honest no-op transport: records failure, never fabricates delivery. */
export class UnconfiguredTransport implements NotificationTransport {
  async send(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: false, detail: "SMTP not configured" };
  }
}

/** Event types that notify the customer. */
export const NOTIFY_EVENTS = new Set([
  "job.assigned",
  "job.arrived",
  "job.completed",
  "job.skipped",
]);

const EVENT_LABELS: Record<string, string> = {
  "job.assigned": "Your driver is on the way",
  "job.arrived": "Your driver has arrived",
  "job.completed": "Your delivery is complete",
  "job.skipped": "Your delivery needs attention",
};

export interface NotificationRow {
  id: string;
  jobId: string;
  eventType: string;
  channel: string;
  recipient: string;
  subject: string;
  status: string;
  detail: string | null;
  createdAt: string;
  sentAt: string | null;
}export class NotificationService {
  constructor(
    private readonly handle: DbHandle,
    private readonly transport: NotificationTransport,
  ) {}

  /** Attach to the business-event bus; returns the unsubscribe function. */
  start(bus: { subscribeBusiness: (fn: (event: EventEnvelope) => void) => () => void }): () => void {
    return bus.subscribeBusiness((event) => {
      if (event.aggregateType !== "job" || !NOTIFY_EVENTS.has(event.type)) return;
      void this.onJobEvent(event);
    });
  }

  private async onJobEvent(event: EventEnvelope): Promise<void> {
    try {
      await withTenant(this.handle, event.tenantId, async (db) => {
        const tokens = (await db.execute(sql`
          SELECT id, job_id, recipient_email
          FROM tracking_tokens
          WHERE job_id = ${event.aggregateId}
            AND notify_enabled = true
            AND recipient_email IS NOT NULL
            AND revoked_at IS NULL
        `)) as unknown as Array<{
          id: string;
          job_id: string;
          recipient_email: string;
        }>;
        for (const token of tokens) {
          const subject = EVENT_LABELS[event.type] ?? "Delivery update";
          // The plaintext tracking token exists only at creation time and is
          // shared with the customer by dispatch; the notification alerts,
          // it never carries the secret link.
          const bodyText =
            `PrivateFleet delivery update: ${subject}.\n` +
            `Open the tracking link you received from dispatch for live details.`;
          await db.execute(sql`
            INSERT INTO notifications
              (tenant_id, job_id, tracking_token_id, event_type, channel, recipient, subject, body, status)
            VALUES (${event.tenantId}, ${token.job_id}, ${token.id}, ${event.type},
              'email', ${token.recipient_email}, ${subject}, ${bodyText}, 'pending')
          `);
        }
      });
      // Deliver pending rows for this tenant/event, one per attempt, with an
      // explicit per-row status.
      await this.flushForEvent(event.tenantId, event.aggregateId, event.type);
    } catch (error) {
      // Notification failure must never disturb job processing.
      if (process.env.LOG_LEVEL === "debug") {
        // eslint-disable-next-line no-console
        console.error("notification pipeline error", error);
      }
    }
  }

  private async flushForEvent(tenantId: string, aggregateId: string, type: string): Promise<void> {
    const rows = (await withTenant(this.handle, tenantId, async (db) => {
      return db.execute(sql`
        SELECT id, recipient, subject, body
        FROM notifications
        WHERE tenant_id = ${tenantId} AND job_id = ${aggregateId}
          AND event_type = ${type} AND status = 'pending'
        ORDER BY created_at
        LIMIT 20
      `);
    })) as unknown as Array<{ id: string; recipient: string; subject: string; body: string }>;
    for (const row of rows) {
      const result = await this.transport.send({
        to: row.recipient,
        subject: row.subject,
        bodyText: row.body,
      });
      await withTenant(this.handle, tenantId, async (db) => {
        await db.execute(sql`
          UPDATE notifications
          SET status = ${result.ok ? "sent" : "failed"},
              detail = ${result.detail ?? null},
              sent_at = ${result.ok ? sql`now()` : sql`NULL`}
          WHERE id = ${row.id} AND status = 'pending'
        `);
      });
    }
  }

  async list(tenantId: string, limit: number): Promise<NotificationRow[]> {
    const rows = (await withTenant(this.handle, tenantId, async (db) => {
      return db.execute(sql`
        SELECT id, job_id, event_type, channel, recipient, subject, status, detail, created_at, sent_at
        FROM notifications
        WHERE tenant_id = ${tenantId}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `);
    })) as unknown as Array<{
      id: string;
      job_id: string;
      event_type: string;
      channel: string;
      recipient: string;
      subject: string;
      status: string;
      detail: string | null;
      created_at: Date | string;
      sent_at: Date | string | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      jobId: row.job_id,
      eventType: row.event_type,
      channel: row.channel,
      recipient: row.recipient,
      subject: row.subject,
      status: row.status,
      detail: row.detail,
      createdAt: new Date(row.created_at).toISOString(),
      sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null,
    }));
  }
}
