import type { perioExams, perioToothRecords, perioSiteMeasurements } from "@/server/db/schema";

// snake_case in JSON, matching the database — see docs/specs/api-surface.md.
export function serializePerioExam(exam: typeof perioExams.$inferSelect) {
  return {
    id: exam.id,
    patient_id: exam.patientId,
    provider_id: exam.providerId,
    exam_date: exam.examDate,
    notes: exam.notes,
    completed_at: exam.completedAt ? exam.completedAt.toISOString() : null,
    created_at: exam.createdAt.toISOString(),
    updated_at: exam.updatedAt.toISOString(),
  };
}

export function serializePerioSiteMeasurement(site: typeof perioSiteMeasurements.$inferSelect) {
  return {
    site: site.site,
    pocket_depth: site.pocketDepth,
    gingival_margin: site.gingivalMargin,
    // CAL is computed, never stored — docs/specs/pilot-foundations.md §2.
    cal: site.pocketDepth !== null && site.gingivalMargin !== null ? site.pocketDepth + site.gingivalMargin : null,
    bleeding_on_probing: site.bleedingOnProbing,
    suppuration: site.suppuration,
    plaque: site.plaque,
  };
}

export function serializePerioToothRecord(
  record: typeof perioToothRecords.$inferSelect,
  sites: (typeof perioSiteMeasurements.$inferSelect)[],
) {
  return {
    tooth: record.tooth,
    mobility: record.mobility,
    furcation: record.furcation,
    is_skipped: record.isSkipped,
    sites: sites.map(serializePerioSiteMeasurement),
  };
}
