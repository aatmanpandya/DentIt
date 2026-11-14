CREATE TYPE "public"."perio_exam_event_kind" AS ENUM('phrase', 'typed', 'approved', 'reopened');--> statement-breakpoint
CREATE TABLE "perio_exam_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"exam_id" uuid NOT NULL,
	"kind" "perio_exam_event_kind" NOT NULL,
	"heard" jsonb,
	"used" text,
	"outcome" text,
	"note" text,
	"changes" jsonb
);
--> statement-breakpoint
ALTER TABLE "perio_exams" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "perio_exams" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "perio_exam_events" ADD CONSTRAINT "perio_exam_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perio_exam_events" ADD CONSTRAINT "perio_exam_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perio_exam_events" ADD CONSTRAINT "perio_exam_events_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perio_exam_events" ADD CONSTRAINT "perio_exam_events_exam_id_perio_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."perio_exams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "perio_exam_events_exam_idx" ON "perio_exam_events" USING btree ("exam_id","created_at");--> statement-breakpoint
-- Exams completed before approvals existed (14 Nov) count as approved on their completion date.
UPDATE "perio_exams" SET "approved_at" = "completed_at" WHERE "completed_at" IS NOT NULL AND "approved_at" IS NULL;
