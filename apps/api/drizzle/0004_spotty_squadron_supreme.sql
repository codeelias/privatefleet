CREATE TYPE "public"."optimization_status" AS ENUM('pending', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."route_status" AS ENUM('draft', 'published', 'in_progress', 'completed', 'superseded', 'cancelled');--> statement-breakpoint
CREATE TABLE "optimization_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"route_id" uuid,
	"input_hash" text NOT NULL,
	"engine" text NOT NULL,
	"engine_version" text NOT NULL,
	"request" jsonb NOT NULL,
	"result" jsonb,
	"metrics" jsonb,
	"status" "optimization_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "route_stops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"job_stop_id" uuid NOT NULL,
	"sequence_no" integer NOT NULL,
	"planned_arrival_at" timestamp with time zone,
	"planned_departure_at" timestamp with time zone,
	"leg_distance_m" integer,
	"leg_duration_s" integer,
	"status" text DEFAULT 'planned' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"route_date" date NOT NULL,
	"driver_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"status" "route_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"planned_distance_m" bigint,
	"planned_duration_s" integer,
	"geometry" jsonb,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "optimization_runs" ADD CONSTRAINT "optimization_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_job_stop_id_job_stops_id_fk" FOREIGN KEY ("job_stop_id") REFERENCES "public"."job_stops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "optimization_runs_input_hash_idx" ON "optimization_runs" USING btree ("tenant_id","input_hash","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "route_stops_route_sequence_uq" ON "route_stops" USING btree ("route_id","sequence_no");--> statement-breakpoint
CREATE UNIQUE INDEX "route_stops_route_stop_uq" ON "route_stops" USING btree ("route_id","job_stop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "routes_tenant_id_id_uq" ON "routes" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "routes_tenant_status_idx" ON "routes" USING btree ("tenant_id","status");