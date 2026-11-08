-- P1 slice 2 reconciliation: preserve the ORIGINAL observation that opened an
-- episode. Context refresh (reasons, plan_version) must never erase the
-- opening evidence.
ALTER TABLE "exception_episodes" ADD COLUMN "opened_reasons" jsonb;
ALTER TABLE "exception_episodes" ADD COLUMN "opened_plan_version" integer;
