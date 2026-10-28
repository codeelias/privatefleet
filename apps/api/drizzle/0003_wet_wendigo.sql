CREATE TABLE "location_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"driver_id" uuid,
	"captured_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"accuracy_metres" double precision,
	"heading_deg" double precision,
	"speed_mps" double precision,
	"sequence_no" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "location_points" ADD CONSTRAINT "location_points_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_points" ADD CONSTRAINT "location_points_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_points" ADD CONSTRAINT "location_points_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "location_points_vehicle_sequence_uq" ON "location_points" USING btree ("vehicle_id","sequence_no");--> statement-breakpoint
CREATE INDEX "location_points_vehicle_captured_idx" ON "location_points" USING btree ("vehicle_id","captured_at");