-- P1 slice 2 (docs/56 section 8): the exception episode - the ONE new
-- lifecycle entity. Idempotency is enforced by the partial unique index:
-- at most one ACTIVE episode per fingerprint (scope + threat class).
CREATE TABLE IF NOT EXISTS "exception_episodes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "job_id" uuid NOT NULL,
  "stop_id" uuid NOT NULL,
  "threat_class" text NOT NULL,
  "level" text NOT NULL,
  "fingerprint" text NOT NULL,
  "reasons" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "plan_version" integer,
  "status" text NOT NULL DEFAULT 'open',
  "clear_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "resolved_at" timestamptz,
  "closed_at" timestamptz,
  "close_reason" text,
  "resolution_note" text
);

-- One active episode per fingerprint: repeated observations can never create
-- duplicates, and a closed episode leaves the identity free to recur.
CREATE UNIQUE INDEX IF NOT EXISTS "exception_episodes_active_uq"
  ON "exception_episodes" ("tenant_id", "fingerprint")
  WHERE "status" IN ('open', 'investigating', 'response_in_progress');

CREATE INDEX IF NOT EXISTS "exception_episodes_tenant_created_idx"
  ON "exception_episodes" ("tenant_id", "created_at" DESC);
