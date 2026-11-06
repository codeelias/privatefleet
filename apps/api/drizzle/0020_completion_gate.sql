-- R3 (docs/54): per-tenant completion gate.
-- completion_radius_m NULL = gate disabled (the default - no behaviour change).
ALTER TABLE "proof_policies" ADD COLUMN "completion_radius_m" integer;
ALTER TABLE "proof_policies" ADD COLUMN "completion_mode" text NOT NULL DEFAULT 'warn';
