import { z } from "zod";

export const perioSiteEnum = z.enum(["MB", "B", "DB", "ML", "L", "DL"]);

export const createPerioExamSchema = z.object({
  exam_date: z.string().min(1),
  provider_id: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const updatePerioExamSchema = z.object({
  notes: z.string().nullable().optional(),
});

// One site's measurements — `pocket_depth` is the only mandatory field per
// docs/specs/pilot-foundations.md §2.
export const perioSiteMeasurementSchema = z.object({
  site: perioSiteEnum,
  pocket_depth: z.number().int().min(0).max(15),
  gingival_margin: z.number().int().min(-5).max(10).nullable().optional(),
  bleeding_on_probing: z.boolean().optional(),
  suppuration: z.boolean().optional(),
  plaque: z.boolean().optional(),
});

// PUT /perio-exams/:id/teeth/:tooth — the load-bearing endpoint. Takes the tooth
// record and its sites in one body; see docs/specs/api-surface.md.
export const upsertPerioToothRecordSchema = z.object({
  mobility: z.number().int().min(0).max(3).nullable().optional(),
  furcation: z.number().int().min(0).max(3).nullable().optional(),
  is_skipped: z.boolean().optional(),
  sites: z.array(perioSiteMeasurementSchema).max(6),
  // Removes these sites' measurements. Voice undo needs it: taking back a phrase must return a
  // site that was empty to empty, and an upsert can only add or change (docs/specs/voice-perio.md).
  clear_sites: z.array(z.enum(["MB", "B", "DB", "ML", "L", "DL"])).max(6).optional(),
}).refine((v) => !(v.clear_sites ?? []).some((c) => v.sites.some((s) => s.site === c)), {
  message: "A site can't be both saved and cleared.",
  path: ["clear_sites"],
});
