import { boolean, date, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenantColumns } from "./_helpers";
import { patients } from "./_patients-base";

// See docs/specs/pilot-foundations.md §2. A full-mouth exam is 32 tooth records + 192 site rows.
export const perioExams = pgTable("perio_exams", {
  ...tenantColumns(),
  patientId: uuid("patient_id")
    .notNull()
    .references(() => patients.id),
  providerId: uuid("provider_id").notNull(), // who examined — see who typed in audit_log
  examDate: date("exam_date").notNull(),
  notes: text("notes"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const perioToothRecords = pgTable(
  "perio_tooth_records",
  {
    ...tenantColumns(),
    examId: uuid("exam_id")
      .notNull()
      .references(() => perioExams.id),
    tooth: text("tooth").notNull(), // FDI
    mobility: integer("mobility"), // 0-3, Miller
    furcation: integer("furcation"), // 0-3, Glickman — molars and 14/24 only
    isSkipped: boolean("is_skipped").notNull().default(false),
  },
  (t) => [uniqueIndex("perio_tooth_records_exam_tooth_idx").on(t.examId, t.tooth)],
);

export const perioSite = pgEnum("perio_site", ["MB", "B", "DB", "ML", "L", "DL"]);

export const perioSiteMeasurements = pgTable(
  "perio_site_measurements",
  {
    ...tenantColumns(),
    examId: uuid("exam_id")
      .notNull()
      .references(() => perioExams.id),
    tooth: text("tooth").notNull(),
    site: perioSite("site").notNull(),
    pocketDepth: integer("pocket_depth"), // 0-15mm, the only required field
    gingivalMargin: integer("gingival_margin"), // -5..10, positive = recession. Never flip this sign.
    bleedingOnProbing: boolean("bleeding_on_probing").notNull().default(false),
    suppuration: boolean("suppuration").notNull().default(false),
    plaque: boolean("plaque").notNull().default(false),
  },
  (t) => [
    uniqueIndex("perio_site_measurements_unique_idx").on(t.examId, t.tooth, t.site),
    index("perio_site_measurements_exam_tooth_idx").on(t.examId, t.tooth),
  ],
);

// CAL (Clinical Attachment Level) = pocket_depth + gingival_margin. Computed, never stored —
// see docs/specs/pilot-foundations.md §2.
