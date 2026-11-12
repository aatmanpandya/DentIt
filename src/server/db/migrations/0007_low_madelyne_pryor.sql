ALTER TABLE "treatment_plan_items" ALTER COLUMN "charted_procedure_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD COLUMN "procedure_code_id" uuid;--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD COLUMN "tooth" text;--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD COLUMN "surfaces" text[];--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD COLUMN "quadrant" text;--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD COLUMN "arch" text;--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD CONSTRAINT "treatment_plan_items_procedure_code_id_procedure_codes_id_fk" FOREIGN KEY ("procedure_code_id") REFERENCES "public"."procedure_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD CONSTRAINT "treatment_plan_items_source_xor_check" CHECK (("treatment_plan_items"."charted_procedure_id" IS NOT NULL) <> ("treatment_plan_items"."procedure_code_id" IS NOT NULL));