ALTER TABLE "jobs" ADD COLUMN "required_capabilities" text[];--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "service_seconds" integer;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "capacity_units" integer;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "required_capabilities" text[];