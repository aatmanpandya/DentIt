import { describe, it, expect } from "vitest";
import type { Condition, Procedure } from "@/lib/chart-api";
import { computeToothState, conditionMarker, procedureStatusTreatment, wholeToothOverlay } from "./tooth-state";

function condition(overrides: Partial<Condition>): Condition {
  return {
    id: "c1",
    patient_id: "p1",
    tooth: "26",
    surfaces: null,
    condition_type: "caries",
    note: null,
    charted_by: "u1",
    charted_at: "2026-01-01T00:00:00Z",
    resolved_at: null,
    ...overrides,
  };
}

function procedure(overrides: Partial<Procedure>): Procedure {
  return {
    id: "p1",
    patient_id: "pat1",
    procedure_code_id: "code1",
    tooth: "26",
    surfaces: null,
    quadrant: null,
    arch: null,
    status: "planned",
    provider_id: null,
    appointment_id: null,
    price: null,
    fee_schedule_id: null,
    note: null,
    completed_at: null,
    invoiced_at: null,
    superseded_by_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("computeToothState", () => {
  it("surfaces an active clinical finding and a current procedure", () => {
    const conditions = [condition({ id: "c1", tooth: "26", condition_type: "caries" })];
    const procedures = [procedure({ id: "p1", tooth: "26" })];

    const state = computeToothState("26", conditions, procedures);

    expect(state.condition?.id).toBe("c1");
    expect(state.procedures).toHaveLength(1);
    expect(state.isMissing).toBe(false);
  });

  it("excludes resolved conditions and cancelled/superseded procedures", () => {
    const conditions = [condition({ id: "c1", tooth: "26", resolved_at: "2026-02-01T00:00:00Z" })];
    const procedures = [
      procedure({ id: "p1", tooth: "26", status: "cancelled" }),
      procedure({ id: "p2", tooth: "26", superseded_by_id: "p3" }),
    ];

    const state = computeToothState("26", conditions, procedures);

    expect(state.condition).toBeNull();
    expect(state.procedures).toHaveLength(0);
  });

  it("treats existing-restoration conditions as whole-tooth state, not the clinical finding", () => {
    const state = computeToothState("46", [condition({ tooth: "46", condition_type: "existing_crown" })], []);

    expect(state.condition).toBeNull();
    expect(state.existingRestoration).toBe("existing_crown");
  });

  it("sets isMissing/isUnerupted/isExfoliated from whole-tooth condition types", () => {
    expect(computeToothState("46", [condition({ tooth: "46", condition_type: "missing" })], []).isMissing).toBe(true);
    expect(computeToothState("15", [condition({ tooth: "15", condition_type: "unerupted" })], []).isUnerupted).toBe(true);
    expect(computeToothState("55", [condition({ tooth: "55", condition_type: "exfoliated" })], []).isExfoliated).toBe(true);
  });
});

describe("conditionMarker", () => {
  it("maps caries to bleed and fracture to caution", () => {
    expect(conditionMarker(condition({ condition_type: "caries" }))?.fill).toBe("bleed");
    expect(conditionMarker(condition({ condition_type: "fracture" }))?.fill).toBe("caution");
  });

  it("defaults an unlisted condition type to caution rather than rendering invisibly", () => {
    expect(conditionMarker(condition({ condition_type: "some_new_finding" }))?.fill).toBe("caution");
  });

  it("returns null for no condition", () => {
    expect(conditionMarker(null)).toBeNull();
  });
});

describe("procedureStatusTreatment", () => {
  it("maps every non-cancelled status to a steel-family treatment", () => {
    expect(procedureStatusTreatment("planned")).toBe("dashed");
    expect(procedureStatusTreatment("accepted")).toBe("solid");
    expect(procedureStatusTreatment("scheduled")).toBe("solid");
    expect(procedureStatusTreatment("completed")).toBe("filled");
    expect(procedureStatusTreatment("invoiced")).toBe("filled-invoiced");
  });

  it("renders nothing for cancelled", () => {
    expect(procedureStatusTreatment("cancelled")).toBeNull();
  });
});

describe("wholeToothOverlay", () => {
  it("ghosts and strikes a missing tooth", () => {
    const state = computeToothState("46", [condition({ tooth: "46", condition_type: "missing" })], []);
    const overlay = wholeToothOverlay(state);
    expect(overlay.ghosted).toBe(true);
    expect(overlay.struck).toBe(true);
    expect(overlay.ring).toBeNull();
  });

  it("rings a tooth with a tooth-scoped procedure", () => {
    const state = computeToothState("21", [], [procedure({ tooth: "21", surfaces: null, status: "accepted" })]);
    expect(wholeToothOverlay(state).ring).toBe("procedure");
  });

  it("does not ring a tooth whose only procedure is surface-scoped", () => {
    const state = computeToothState("26", [], [procedure({ tooth: "26", surfaces: ["O"] })]);
    expect(wholeToothOverlay(state).ring).toBeNull();
  });

  it("stacks both rings for an existing crown plus a newly planned replacement — the p2/tooth-26 seed case", () => {
    const conditions = [condition({ tooth: "26", condition_type: "existing_crown" })];
    const procedures = [procedure({ tooth: "26", surfaces: null, status: "planned" })];
    const state = computeToothState("26", conditions, procedures);

    expect(wholeToothOverlay(state).ring).toBe("both");
  });

  it("shows the root-line icon for an existing RCT", () => {
    const state = computeToothState("36", [condition({ tooth: "36", condition_type: "existing_rct" })], []);
    expect(wholeToothOverlay(state).rootLineIcon).toBe(true);
  });
});

// A completed crown used to draw exactly like a planned one (always dashed), so the chart
// couldn't show what had been done. The ring now follows the procedure's status.
describe("wholeToothOverlay ring status", () => {
  it("styles the ring by the most advanced tooth-level procedure", () => {
    const planned = computeToothState("16", [], [procedure({ id: "a", tooth: "16", surfaces: null, status: "planned" })]);
    expect(wholeToothOverlay(planned).ringTreatment).toBe("dashed");

    const done = computeToothState("16", [], [
      procedure({ id: "a", tooth: "16", surfaces: null, status: "planned" }),
      procedure({ id: "b", tooth: "16", surfaces: null, status: "completed" }),
    ]);
    expect(wholeToothOverlay(done).ringTreatment).toBe("filled");

    const billed = computeToothState("16", [], [procedure({ id: "c", tooth: "16", surfaces: null, status: "invoiced" })]);
    expect(wholeToothOverlay(billed).ringTreatment).toBe("filled-invoiced");
  });

  it("has no ring treatment without a tooth-level procedure", () => {
    expect(wholeToothOverlay(computeToothState("16", [], [])).ringTreatment).toBeNull();
  });
});
