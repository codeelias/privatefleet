-- R6 (docs/54): proactive customer notifications.
-- Consent lives on the tracking token; every notification attempt is recorded
-- with an honest status (pending/sent/failed) - delivery is never claimed
-- unless the transport confirmed it.
ALTER TABLE "tracking_tokens" ADD COLUMN "notify_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "tracking_tokens" ADD COLUMN "recipient_email" text;

CREATE TABLE IF NOT EXISTS "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "job_id" uuid NOT NULL,
  "tracking_token_id" uuid,
  "event_type" text NOT NULL,
  "channel" text NOT NULL,
  "recipient" text NOT NULL,
  "subject" text NOT NULL,
  "body" text NOT NULL,
  "status" text NOT NULL,
  "detail" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "sent_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "notifications_tenant_created_idx"
  ON "notifications" ("tenant_id", "created_at" DESC);
