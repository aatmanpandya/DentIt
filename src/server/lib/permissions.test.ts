import { describe, it, expect } from "vitest";
import { can } from "./permissions";

describe("RBAC matrix", () => {
  it("front desk cannot write clinical data — the non-negotiable rule", () => {
    expect(can("front_desk", "odontogram", "write")).toBe(false);
    expect(can("front_desk", "perio", "write")).toBe(false);
    expect(can("front_desk", "clinical_notes", "write")).toBe(false);
  });

  it("front desk can manage appointments and invoices", () => {
    expect(can("front_desk", "appointments", "write")).toBe(true);
    expect(can("front_desk", "invoices_payments", "write")).toBe(true);
  });

  it("assistants can write perio but not the odontogram or notes", () => {
    expect(can("assistant", "perio", "write")).toBe(true);
    expect(can("assistant", "odontogram", "write")).toBe(false);
    expect(can("assistant", "clinical_notes", "write")).toBe(false);
  });

  it("only clinicians can sign notes, never admin or owner via a back door", () => {
    expect(can("provider", "clinical_notes.sign", "write")).toBe(true);
    expect(can("hygienist", "clinical_notes.sign", "write")).toBe(true);
    expect(can("owner", "clinical_notes.sign", "write")).toBe(true);
    expect(can("admin", "clinical_notes.sign", "write")).toBe(false);
    expect(can("front_desk", "clinical_notes.sign", "write")).toBe(false);
  });

  it("only owner can change org settings", () => {
    expect(can("owner", "org_settings", "write")).toBe(true);
    expect(can("admin", "org_settings", "write")).toBe(false);
  });

  it("accountant reads patients but never writes them", () => {
    expect(can("accountant", "patients", "read")).toBe(true);
    expect(can("accountant", "patients", "write")).toBe(false);
  });
});
