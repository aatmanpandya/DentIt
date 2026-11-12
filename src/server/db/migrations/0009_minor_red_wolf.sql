CREATE TABLE "invoice_number_counters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"year" integer NOT NULL,
	"last_value" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "prices_include_tax" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "voided_by" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "request_hash" text;--> statement-breakpoint
ALTER TABLE "invoice_number_counters" ADD CONSTRAINT "invoice_number_counters_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_number_counters" ADD CONSTRAINT "invoice_number_counters_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_number_counters" ADD CONSTRAINT "invoice_number_counters_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_number_counters_org_year_idx" ON "invoice_number_counters" USING btree ("organization_id","year");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_org_idempotency_key_idx" ON "payments" USING btree ("organization_id","idempotency_key");