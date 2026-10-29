CREATE TABLE "proof_policies" (
	"tenant_id" uuid NOT NULL,
	"service_type" text DEFAULT '*' NOT NULL,
	"require_recipient" boolean DEFAULT true NOT NULL,
	"require_signature" boolean DEFAULT false NOT NULL,
	"require_photo" boolean DEFAULT false NOT NULL,
	"require_failure_photo" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proof_policies_tenant_id_service_type_pk" PRIMARY KEY("tenant_id","service_type")
);
--> statement-breakpoint
CREATE TABLE "stop_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"stop_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_hash" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"captured_at" timestamp with time zone,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "job_id" uuid;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "stop_id" uuid;--> statement-breakpoint
ALTER TABLE "job_stops" ADD COLUMN "failure_code" text;--> statement-breakpoint
ALTER TABLE "job_stops" ADD COLUMN "failure_note" text;--> statement-breakpoint
ALTER TABLE "proof_policies" ADD CONSTRAINT "proof_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stop_evidence" ADD CONSTRAINT "stop_evidence_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stop_evidence" ADD CONSTRAINT "stop_evidence_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stop_evidence" ADD CONSTRAINT "stop_evidence_stop_id_job_stops_id_fk" FOREIGN KEY ("stop_id") REFERENCES "public"."job_stops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stop_evidence_stop_kind_uq" ON "stop_evidence" USING btree ("stop_id","kind");--> statement-breakpoint
CREATE INDEX "stop_evidence_job_idx" ON "stop_evidence" USING btree ("job_id");