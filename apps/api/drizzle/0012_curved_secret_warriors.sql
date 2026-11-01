CREATE TABLE "driver_work_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"vehicle_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"route_version" integer,
	"policy_revision" integer,
	"note" text,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"decision_note" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "driver_work_requests" ADD CONSTRAINT "driver_work_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_work_requests" ADD CONSTRAINT "driver_work_requests_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_work_requests" ADD CONSTRAINT "driver_work_requests_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_work_requests" ADD CONSTRAINT "driver_work_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "driver_work_requests_tenant_status_idx" ON "driver_work_requests" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "driver_work_requests_pending_uq" ON "driver_work_requests" USING btree ("tenant_id","driver_id") WHERE status = 'pending';