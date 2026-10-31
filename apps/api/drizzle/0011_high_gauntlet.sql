CREATE TABLE "dispatch_policies" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"preset" text DEFAULT 'balanced' NOT NULL,
	"max_distance_m" integer DEFAULT 200000 NOT NULL,
	"max_travel_time_s" integer DEFAULT 32400 NOT NULL,
	"max_working_duration_s" integer DEFAULT 36000 NOT NULL,
	"max_visits" integer DEFAULT 50 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispatch_policy_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"max_distance_m" integer,
	"max_travel_time_s" integer,
	"max_working_duration_s" integer,
	"max_visits" integer
);
--> statement-breakpoint
ALTER TABLE "dispatch_policies" ADD CONSTRAINT "dispatch_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_policy_overrides" ADD CONSTRAINT "dispatch_policy_overrides_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_policy_overrides" ADD CONSTRAINT "dispatch_policy_overrides_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dispatch_policy_overrides_vehicle_idx" ON "dispatch_policy_overrides" USING btree ("tenant_id","vehicle_id");--> statement-breakpoint
INSERT INTO "dispatch_policies" ("tenant_id") SELECT "id" FROM "tenants" ON CONFLICT ("tenant_id") DO NOTHING;
