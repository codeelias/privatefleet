ALTER TABLE "location_points" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "location_points" ADD COLUMN "satellites_used" integer;--> statement-breakpoint
ALTER TABLE "location_points" ADD COLUMN "dual_frequency" boolean;--> statement-breakpoint
ALTER TABLE "location_points" ADD COLUMN "carrier_phase" boolean;--> statement-breakpoint
ALTER TABLE "location_points" ADD COLUMN "ekf_confidence" text;