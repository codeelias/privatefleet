-- P1 slice 3 (docs/56 section 8): response actions are append-only job_events,
-- correlated to their episode and idempotent BY DATABASE CONSTRAINT.
-- No separate actions table - the operational history stays in job_events.

ALTER TABLE "job_events" ADD COLUMN "episode_id" uuid;
CREATE INDEX IF NOT EXISTS "job_events_episode_idx"
  ON "job_events" ("job_id", "episode_id");

-- One response event per idempotency key per tenant: repeated submissions can
-- never duplicate an operational action.
CREATE UNIQUE INDEX IF NOT EXISTS "job_events_response_idem_uq"
  ON "job_events" ("tenant_id", ("payload" ->> 'idempotencyKey'))
  WHERE "type" LIKE 'response.%' AND ("payload" ->> 'idempotencyKey') IS NOT NULL;
