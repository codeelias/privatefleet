CREATE TABLE "dispatch_policies" (
  "tenant_id" uuid PRIMARY KEY REFERENCES "tenants"("id") ON DELETE CASCADE,
  "preset" text NOT NULL DEFAULT 'balanced',
  "max_distance_m" integer NOT NULL DEFAULT 200000,
  "max_travel_time_s" integer NOT NULL DEFAULT 32400,
  "max_working_duration_s" integer NOT NULL DEFAULT 36000,
  "max_visits" integer NOT NULL DEFAULT 50,
  "revision" integer NOT NULL DEFAULT 1,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "dispatch_policy_overrides" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "vehicle_id" uuid NOT NULL REFERENCES "vehicles"("id") ON DELETE CASCADE,
  "max_distance_m" integer,
  "max_travel_time_s" integer,
  "max_working_duration_s" integer,
  "max_visits" integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX "dispatch_policy_overrides_vehicle_idx"
  ON "dispatch_policy_overrides" ("tenant_id", "vehicle_id");
--> statement-breakpoint
INSERT INTO "dispatch_policies" ("tenant_id")
SELECT "id" FROM "tenants"
ON CONFLICT ("tenant_id") DO NOTHING;
