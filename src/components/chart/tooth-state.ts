/**
 * Pure translation from raw chart data (docs/specs/api-surface.md's
 * `GET /patients/:id/chart` payload, fetched once) to per-tooth render props — no
 * DOM, no fetch. Mirrors the shape of src/server/services/chart.ts's getToothState,
 * but computed client-side from the already-fetched conditions/procedures list
 * rather than a server round-trip per tooth (32 of them on screen at once). This is
 * presentational derivation, not the business logic CLAUDE.md's service-layer rule
 * is about — the actual current-state read contract (what Perio also relies on)
 * lives once, server-side, in getToothState.
 */

import type { Condition, Procedure, ProcedureStatus, Surface } from "@/lib/chart-api";
import type { ToothPresenceFlags } from "./tooth-grid";

const WHOLE_TOOTH_CONDITION_TYPES = new Set([
  "missing",
  "unerupted",
  "exfoliated",
  "existing_crown",
  "existing_rct",
  "existing_restoration",
]);

export interface ToothState extends ToothPresenceFlags {
  tooth: string;
  condition: Condition | null;
  procedures: Procedure[];
  existingRestoration: string | null;
}

/** Current state only, per docs/specs/odontogram.md — resolved/cancelled/superseded excluded. */
export function computeToothState(tooth: string, conditions: Condition[], procedures: Procedure[]): ToothState {
  const active = conditions.filter((c) => c.tooth === tooth && !c.resolved_at);
  const current = procedures.filter((p) => p.tooth === tooth && p.status !== "cancelled" && !p.superseded_by_id);

  const wholeTooth = active.filter((c) => WHOLE_TOOTH_CONDITION_TYPES.has(c.condition_type));
  const clinicalFinding = active.find((c) => !WHOLE_TOOTH_CONDITION_TYPES.has(c.condition_type)) ?? null;
  const existingRestoration =
    wholeTooth.find((c) => ["existing_crown", "existing_rct", "existing_restoration"].includes(c.condition_type))
      ?.condition_type ?? null;

  return {
    tooth,
    condition: clinicalFinding,
    procedures: current,
    isMissing: wholeTooth.some((c) => c.condition_type === "missing"),
    isUnerupted: wholeTooth.some((c) => c.condition_type === "unerupted"),
    isExfoliated: wholeTooth.some((c) => c.condition_type === "exfoliated"),
    existingRestoration,
  };
}

/** Every tooth referenced anywhere in the chart, keyed by FDI — what tooth-grid.ts's resolveSocketTooth and the glyph renderer both read from. */
export function computeAllToothStates(conditions: Condition[], procedures: Procedure[]): Record<string, ToothState> {
  const teeth = new Set<string>();
  for (const c of conditions) if (c.tooth) teeth.add(c.tooth);
  for (const p of procedures) if (p.tooth) teeth.add(p.tooth);

  const result: Record<string, ToothState> = {};
  for (const tooth of teeth) result[tooth] = computeToothState(tooth, conditions, procedures);
  return result;
}

// --- Layer 1: condition (finding) — icon/fill on the surface region, reserved
// clinical colors only where they genuinely fit. Unlisted condition types still
// need to read as "something is flagged here", so they default to caution rather
// than rendering invisibly.
export type ConditionFill = "bleed" | "caution" | "hatch";

export interface ConditionMarker {
  surfaces: Surface[]; // empty = whole-tooth finding, not surface-specific
  fill: ConditionFill;
}

const CONDITION_FILL: Record<string, ConditionFill> = {
  caries: "bleed",
  fracture: "caution",
  impacted: "hatch",
  furcation_involvement: "hatch",
};

export function conditionMarker(condition: Condition | null): ConditionMarker | null {
  if (!condition) return null;
  return {
    surfaces: condition.surfaces ?? [],
    fill: CONDITION_FILL[condition.condition_type] ?? "caution",
  };
}

// --- Layer 2: procedure status — steel-family only, never the clinical palette
// (green="healthy" colliding with "invoiced" would be confusing). `cancelled`
// renders nothing — computeToothState already excludes cancelled rows, but this
// stays exhaustive so a status added later doesn't silently fall through.
export type ProcedureTreatment = "dashed" | "solid" | "filled" | "filled-invoiced";

export function procedureStatusTreatment(status: ProcedureStatus): ProcedureTreatment | null {
  switch (status) {
    case "planned":
      return "dashed";
    case "accepted":
    case "scheduled":
      return "solid";
    case "completed":
      return "filled";
    case "invoiced":
      return "filled-invoiced";
    case "cancelled":
      return null;
  }
}

// --- Layer 3: whole-tooth state — missing/existing-restoration/tooth-scoped-procedure
// overlays, drawn as a ring/strike around the whole tooth rather than one surface.
export type RingKind = "existing" | "procedure" | "both" | null;

export interface WholeToothOverlay {
  ghosted: boolean; // missing, or a transitional not-yet-erupted socket — never opacity alone, see `struck`
  struck: boolean; // diagonal strike — missing only, not unerupted (a normal absence isn't a finding)
  ring: RingKind;
  rootLineIcon: boolean; // existing_rct
}

export function wholeToothOverlay(state: ToothState): WholeToothOverlay {
  const hasToothScopedProcedure = state.procedures.some((p) => p.tooth && !(p.surfaces && p.surfaces.length > 0));
  const hasExistingCrownOrRestoration = state.existingRestoration === "existing_crown" || state.existingRestoration === "existing_restoration";

  let ring: RingKind = null;
  if (hasExistingCrownOrRestoration && hasToothScopedProcedure) ring = "both";
  else if (hasExistingCrownOrRestoration) ring = "existing";
  else if (hasToothScopedProcedure) ring = "procedure";

  return {
    ghosted: state.isMissing,
    struck: state.isMissing,
    ring,
    rootLineIcon: state.existingRestoration === "existing_rct",
  };
}
