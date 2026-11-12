ALTER TABLE "invoices" ADD COLUMN "gst_registered" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "gstin" text;