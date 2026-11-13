-- Invoices issued before 0010 have gst_registered = false by default, so a GST-registered
-- clinic's old tax invoices would reprint as plain receipts. Any invoice that charged tax was
-- issued while registered: mark it so, with the clinic's GSTIN. (docs/bug-log.md entry 32.)
UPDATE "invoices" AS i
SET "gst_registered" = true,
    "gstin" = o."gstin"
FROM "organizations" AS o
WHERE i."organization_id" = o."id"
  AND i."gst_registered" = false
  AND i."tax_total" > 0;
