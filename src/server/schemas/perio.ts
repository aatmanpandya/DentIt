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
  source: z.enum(["keyboard", "voice"]).optional(),
}).refine((v) => !(v.clear_sites ?? []).some((c) => v.sites.some((s) => s.site === c)), {
  message: "A site can't be both saved and cleared.",
  path: ["clear_sites"],
});

// POST /perio-exams/:id/events — one dictated phrase for the exam's transcript
// (docs/specs/perio-approval.md).
const perioChangeSchema = z.object({
  tooth: z.string().max(3),
  site: z.enum(["MB", "B", "DB", "ML", "L", "DL"]).nullable(),
  field: z.enum(["pocket_depth", "recession", "bleeding", "suppuration", "plaque", "mobility", "furcation", "skipped"]),
  from: z.union([z.number().int(), z.boolean(), z.null()]),
  to: z.union([z.number().int(), z.boolean(), z.null()]),
});
export const recordPerioPhraseSchema = z.object({
  heard: z.array(z.string().max(300)).max(5),
  used: z.string().max(600).nullable(),
  outcome: z.enum(["written", "refused", "waiting", "undo"]),
  note: z.string().max(300).nullable(),
  changes: z.array(perioChangeSchema).max(300),
});
