/**
 * Response actions (docs/56 section 8, P1 slice 3): append-only operational
 * history events, typed, actor-attributed, correlated to an exception
 * episode. NO separate actions table - job_events is the single source of
 * operational history.
 *
 * Attempts and confirmed outcomes are SEPARATE events (stage field): an
 * attempted contact is never a confirmed contact; a requested notification
 * is never a delivered one. Reassignment references the canonical assignment
 * event (assignment_event_id) instead of duplicating assignment history.
 * Idempotency is enforced by the database (partial unique index on
 * payload->>'idempotencyKey' for response events).
 */
import { sql } from "drizzle-orm";
import { withTenant, type DbHandle } from "../../db/client.js";

export const RESPONSE_ACTION_TYPES = [
  "contact_driver",
  "notify_customer",
  "reassign",
  "reschedule",
  "other",
] as const;
export type ResponseActionType = (typeof RESPONSE_ACTION_TYPES)[number];

export interface ResponseActionInput {
  episodeId: string;
  actionType: ResponseActionType;
  stage: "attempt" | "confirmed";
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

export interface ResponseEventRow {
  id: string;
  episodeId: string | null;
  type: string;
  actorId: string | null;
  payload: unknown;
  occurredAt: string;
}

/** Canonical assignment event id for a job - the reference, never duplicated. */
async function canonicalAssignmentEventId(
  db: Parameters<Parameters<typeof withTenant>[2]>[0],
  tenantId: string,
  jobId: string,
): Promise<string | null> {
  const rows = (await db.execute(sql`
    SELECT id FROM job_events
    WHERE tenant_id = ${tenantId} AND job_id = ${jobId} AND type = 'job.assigned'
    ORDER BY created_at DESC LIMIT 1
  `)) as unknown as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

/**
 * Record one response action as an append-only job_events row. Returns the
 * event id; a duplicate idempotency key is refused by the DB constraint and
 * reported as null (callers treat it as "already recorded").
 */
export async function recordResponseAction(
  handle: DbHandle,
  tenantId: string,
  jobId: string,
  actorId: string,
  input: ResponseActionInput,
): Promise<{ eventId: string | null; duplicate: boolean }> {
  return withTenant(handle, tenantId, async (db) => {
    let payload = input.payload;
    if (input.actionType === "reassign") {
      // Reference the canonical assignment event - never duplicate its history.
      const canonical = await canonicalAssignmentEventId(db, tenantId, jobId);
      payload = { ...payload, assignment_event_id: canonical };
    }
    const rows = (await db.execute(sql`
      INSERT INTO job_events
        (tenant_id, job_id, type, actor_type, actor_id, payload, episode_id)
      VALUES
        (${tenantId}, ${jobId}, ${`response.${input.actionType}`}, 'user', ${actorId},
         ${JSON.stringify({ stage: input.stage, idempotencyKey: input.idempotencyKey, ...payload })}::jsonb,
         ${input.episodeId})
      ON CONFLICT (tenant_id, (payload->>'idempotencyKey'))
        WHERE type LIKE 'response.%' AND (payload->>'idempotencyKey') IS NOT NULL
      DO NOTHING
      RETURNING id
    `)) as unknown as Array<{ id: string }>;
    if (rows.length === 0) {
      return { eventId: null, duplicate: true };
    }
    return { eventId: rows[0]?.id ?? null, duplicate: false };
  });
}

/** Response events correlated to an episode, in order. */
export async function responseEvents(
  handle: DbHandle,
  tenantId: string,
  episodeId: string,
): Promise<ResponseEventRow[]> {
  return withTenant(handle, tenantId, async (db) => {
    const rows = (await db.execute(sql`
      SELECT id, episode_id, type, actor_id, payload, created_at
      FROM job_events
      WHERE tenant_id = ${tenantId} AND episode_id = ${episodeId} AND type LIKE 'response.%'
      ORDER BY created_at ASC
    `)) as unknown as Array<{
      id: string;
      episode_id: string | null;
      type: string;
      actor_id: string | null;
      payload: unknown;
      created_at: Date | string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      episodeId: row.episode_id,
      type: row.type,
      actorId: row.actor_id,
      payload: row.payload,
      occurredAt: new Date(row.created_at).toISOString(),
    }));
  });
}
