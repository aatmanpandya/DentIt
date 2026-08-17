import { describe, it, expect, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { adminDb } from "@/server/db/client";
import {
  organizations,
  users,
  locations,
  operatories,
  patients,
  providerSchedules,
  scheduleBlocks,
} from "@/server/db/schema";
import { wipeOrganizationData } from "@/server/db/wipe-organization";
import type { RequestActor } from "@/server/lib/request-auth";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { PatientNotFoundError } from "./patients";
import {
  createAppointment,
  getAppointment,
  updateAppointment,
  listAppointments,
  transitionAppointment,
  rescheduleAppointment,
  getAvailability,
  AppointmentNotFoundError,
  ProviderNotFoundError,
  AppointmentConflictError,
  AppointmentOutsideHoursError,
  AppointmentBlockedPeriodError,
  AppointmentProviderConflictError,
  IllegalTransitionError,
} from "./appointments";

const TEST_ORG_NAME = "__appointments_service_test";

async function setup() {
  const [org] = await adminDb.insert(organizations).values({ name: TEST_ORG_NAME }).returning();
  const [user] = await adminDb
    .insert(users)
    .values({ organizationId: org.id, email: `front-desk-${Date.now()}@example.test`, fullName: "Front Desk", role: "front_desk" })
    .returning();
  const actor: RequestActor = { userId: user.id, organizationId: org.id, role: "front_desk" };

  const [location] = await adminDb.insert(locations).values({ organizationId: org.id, name: "Main" }).returning();
  const [opA] = await adminDb.insert(operatories).values({ organizationId: org.id, locationId: location.id, name: "Op A", displayOrder: 1 }).returning();
  const [opB] = await adminDb.insert(operatories).values({ organizationId: org.id, locationId: location.id, name: "Op B", displayOrder: 2 }).returning();

  const [provider] = await adminDb
    .insert(users)
    .values({ organizationId: org.id, email: `dr-rao-${Date.now()}@example.test`, fullName: "Dr Rao", role: "provider" })
    .returning();

  const [patient] = await adminDb
    .insert(patients)
    .values({ organizationId: org.id, patientNumber: "P-0001", firstName: "Priya", lastName: "Sharma", phone: "9000000000" })
    .returning();

  // Provider works 09:00-17:00 on every day of the week, effective from well in the past.
  for (let day = 0; day <= 6; day++) {
    await adminDb.insert(providerSchedules).values({
      organizationId: org.id,
      providerId: provider.id,
      locationId: location.id,
      dayOfWeek: day,
      startTime: "09:00",
      endTime: "17:00",
      effectiveFrom: "2020-01-01",
    });
  }

  return { org, actor, location, opA, opB, provider, patient };
}

async function cleanup() {
  const orgs = await adminDb.select().from(organizations).where(eq(organizations.name, TEST_ORG_NAME));
  for (const org of orgs) {
    await wipeOrganizationData(adminDb, org.id);
    await adminDb.delete(organizations).where(eq(organizations.id, org.id));
  }
}

// A Wednesday, well within the seeded provider_schedules window above.
const DAY = "2026-08-19";
function at(hhmm: string) {
  return `${DAY}T${hhmm}:00+05:30`;
}
// getAvailability returns UTC instants (Date#toISOString), not the +05:30-offset form
// `at()` produces — same instant, different string. Slot-list assertions compare
// against this instead.
function atUTC(hhmm: string) {
  return new Date(at(hhmm)).toISOString();
}

describe("createAppointment", () => {
  afterEach(cleanup);

  it("books an appointment inside provider hours with no conflicts", async () => {
    const { actor, location, opA, provider, patient } = await setup();

    const appt = await createAppointment(actor, {
      patient_id: patient.id,
      location_id: location.id,
      operatory_id: opA.id,
      provider_id: provider.id,
      starts_at: at("10:00"),
      ends_at: at("10:30"),
    });

    expect(appt.status).toBe("scheduled");
    expect(appt.operatoryId).toBe(opA.id);
  });

  it("rejects double-booking the same operatory — hard block, no override", async () => {
    const { actor, location, opA, provider, patient } = await setup();
    await createAppointment(actor, {
      patient_id: patient.id, location_id: location.id, operatory_id: opA.id, provider_id: provider.id,
      starts_at: at("10:00"), ends_at: at("10:30"),
    });

    await expect(
      createAppointment(actor, {
        patient_id: patient.id, location_id: location.id, operatory_id: opA.id, provider_id: provider.id,
        starts_at: at("10:15"), ends_at: at("10:45"), override: true,
      }),
    ).rejects.toThrow(AppointmentConflictError);
  });

  it("allows booking the same operatory once the earlier appointment is cancelled", async () => {
    const { actor, location, opA, provider, patient } = await setup();
    const first = await createAppointment(actor, {
      patient_id: patient.id, location_id: location.id, operatory_id: opA.id, provider_id: provider.id,
      starts_at: at("10:00"), ends_at: at("10:30"),
    });
    await transitionAppointment(actor, first.id, { to_status: "cancelled", reason: "Patient asked", cancelled_by: "patient" });

    const second = await createAppointment(actor, {
      patient_id: patient.id, location_id: location.id, operatory_id: opA.id, provider_id: provider.id,
      starts_at: at("10:15"), ends_at: at("10:45"),
    });
    expect(second.status).toBe("scheduled");
  });

  it("warns outside provider hours and requires override", async () => {
    const { actor, location, opA, provider, patient } = await setup();

    await expect(
      createAppointment(actor, {
        patient_id: patient.id, location_id: location.id, operatory_id: opA.id, provider_id: provider.id,
        starts_at: at("20:00"), ends_at: at("20:30"),
      }),
    ).rejects.toThrow(AppointmentOutsideHoursError);

    const appt = await createAppointment(actor, {
      patient_id: patient.id, location_id: location.id, operatory_id: opA.id, provider_id: provider.id,
      starts_at: at("20:00"), ends_at: at("20:30"), override: true,
    });
    expect(appt.status).toBe("scheduled");
  });

  it("warns when the provider already has an appointment in another operatory at an overlapping time", async () => {
    const { actor, location, opA, opB, provider, patient } = await setup();
    await createAppointment(actor, {
      patient_id: patient.id, location_id: location.id, operatory_id: opA.id, provider_id: provider.id,
      starts_at: at("10:00"), ends_at: at("10:30"),
    });

    await expect(
      createAppointment(actor, {
        patient_id: patient.id, location_id: location.id, operatory_id: opB.id, provider_id: provider.id,
        starts_at: at("10:15"), ends_at: at("10:45"),
      }),
    ).rejects.toThrow(AppointmentProviderConflictError);

    const appt = await createAppointment(actor, {
      patient_id: patient.id, location_id: location.id, operatory_id: opB.id, provider_id: provider.id,
      starts_at: at("10:15"), ends_at: at("10:45"), override: true,
    });
    expect(appt.status).toBe("scheduled");
  });

  it("warns when the slot overlaps a schedule block (lunch, leave)", async () => {
    const { org, actor, location, opA, provider, patient } = await setup();
    await adminDb.insert(scheduleBlocks).values({
      organizationId: org.id, locationId: location.id,
      startsAt: new Date(at("13:00")), endsAt: new Date(at("14:00")), reason: "Lunch",
    });

    await expect(
      createAppointment(actor, {
        patient_id: patient.id, location_id: location.id, operatory_id: opA.id, provider_id: provider.id,
        starts_at: at("13:15"), ends_at: at("13:45"),
      }),
    ).rejects.toThrow(AppointmentBlockedPeriodError);

    const appt = await createAppointment(actor, {
      patient_id: patient.id, location_id: location.id, operatory_id: opA.id, provider_id: provider.id,
      starts_at: at("13:15"), ends_at: at("13:45"), override: true,
    });
    expect(appt.status).toBe("scheduled");
  });

  it("404s for a patient that doesn't belong to this org", async () => {
    const { actor, location, opA, provider } = await setup();
    await expect(
      createAppointment(actor, {
        patient_id: "00000000-0000-0000-0000-000000000000", location_id: location.id, operatory_id: opA.id,
        provider_id: provider.id, starts_at: at("10:00"), ends_at: at("10:30"),
      }),
    ).rejects.toThrow(PatientNotFoundError);
  });

  it("rejects an accountant — appointments write is not in their matrix entry", async () => {
    const { org, location, opA, provider, patient } = await setup();
    const [accountantUser] = await adminDb
      .insert(users)
      .values({ organizationId: org.id, email: "accountant@example.test", fullName: "Accountant", role: "accountant" })
      .returning();
    const accountant: RequestActor = { userId: accountantUser.id, organizationId: org.id, role: "accountant" };

    await expect(
      createAppointment(accountant, {
        patient_id: patient.id, location_id: location.id, operatory_id: opA.id, provider_id: provider.id,
        starts_at: at("10:00"), ends_at: at("10:30"),
      }),
    ).rejects.toThrow(PermissionDeniedError);
  });
});

describe("getAppointment / cross-tenant", () => {
  afterEach(cleanup);

  it("404s for an appointment belonging to another org", async () => {
    const { actor, location, opA, provider, patient } = await setup();
    const appt = await createAppointment(actor, {
      patient_id: patient.id, location_id: location.id, operatory_id: opA.id, provider_id: provider.id,
      starts_at: at("10:00"), ends_at: at("10:30"),
    });

    const [otherOrg] = await adminDb.insert(organizations).values({ name: "__appointments_other_org" }).returning();
    const [otherUser] = await adminDb
      .insert(users)
      .values({ organizationId: otherOrg.id, email: "other@example.test", fullName: "Other", role: "front_desk" })
      .returning();
    const otherActor: RequestActor = { userId: otherUser.id, organizationId: otherOrg.id, role: "front_desk" };

    await expect(getAppointment(otherActor, appt.id)).rejects.toThrow(AppointmentNotFoundError);

    await wipeOrganizationData(adminDb, otherOrg.id);
    await adminDb.delete(organizations).where(eq(organizations.id, otherOrg.id));
  });
});

describe("updateAppointment (drag-to-move)", () => {
  afterEach(cleanup);

  it("moves an appointment to a new operatory/time in place — same row, no cancel/recreate", async () => {
    const { actor, location, opA, opB, provider, patient } = await setup();
    const appt = await createAppointment(actor, {
      patient_id: patient.id, location_id: location.id, operatory_id: opA.id, provider_id: provider.id,
      starts_at: at("10:00"), ends_at: at("10:30"),
    });

    const moved = await updateAppointment(actor, appt.id, {
      operatory_id: opB.id, starts_at: at("11:00"), ends_at: at("11:30"),
    });

    expect(moved.id).toBe(appt.id);
    expect(moved.operatoryId).toBe(opB.id);
    expect(moved.status).toBe("scheduled");
  });

  it("re-checks conflicts on the new slot", async () => {
    const { actor, location, opA, opB, provider, patient } = await setup();
    await createAppointment(actor, {
      patient_id: patient.id, location_id: location.id, operatory_id: opB.id, provider_id: provider.id,
      starts_at: at("11:00"), ends_at: at("11:30"),
    });
    const appt = await createAppointment(actor, {
      patient_id: patient.id, location_id: location.id, operatory_id: opA.id, provider_id: provider.id,
      starts_at: at("10:00"), ends_at: at("10:30"),
    });

    await expect(updateAppointment(actor, appt.id, { operatory_id: opB.id, starts_at: at("11:15"), ends_at: at("11:45") })).rejects.toThrow(
      AppointmentConflictError,
    );
  });

  it("skips conflict checks entirely when only the note changes", async () => {
    const { actor, location, opA, opB, provider, patient } = await setup();
    const appt = await createAppointment(actor, {
      patient_id: patient.id, location_id: location.id, operatory_id: opA.id, provider_id: provider.id,
      starts_at: at("10:00"), ends_at: at("10:30"),
    });
    // Deliberately overridden into a provider conflict with `appt` itself — if
    // updateAppointment incorrectly re-ran checkWarnings for a note-only patch, it
    // would trip over this and this test would catch that regression.
    await createAppointment(actor, {
      patient_id: patient.id, location_id: location.id, operatory_id: opB.id, provider_id: provider.id,
      starts_at: at("10:00"), ends_at: at("10:30"), override: true,
    });

    const updated = await updateAppointment(actor, appt.id, { note: "Running late" });
    expect(updated.note).toBe("Running late");
  });
});

describe("transitionAppointment", () => {
  afterEach(cleanup);

  it("walks the full legal lifecycle, stamping each timestamp", async () => {
    const { actor, location, opA, provider, patient } = await setup();
    const appt = await createAppointment(actor, {
      patient_id: patient.id, location_id: location.id, operatory_id: opA.id, provider_id: provider.id,
      starts_at: at("10:00"), ends_at: at("10:30"),
    });

    const confirmed = await transitionAppointment(actor, appt.id, { to_status: "confirmed" });
    expect(confirmed.confirmedAt).not.toBeNull();

    const arrived = await transitionAppointment(actor, appt.id, { to_status: "arrived" });
    expect(arrived.arrivedAt).not.toBeNull();

    const seated = await transitionAppointment(actor, appt.id, { to_status: "seated" });
    expect(seated.seatedAt).not.toBeNull();

    const completed = await transitionAppointment(actor, appt.id, { to_status: "completed" });
    expect(completed.completedAt).not.toBeNull();
  });

  it("rejects an illegal transition — a completed appointment can't be marked arrived", async () => {
    const { actor, location, opA, provider, patient } = await setup();
    const appt = await createAppointment(actor, {
      patient_id: patient.id, location_id: location.id, operatory_id: opA.id, provider_id: provider.id,
      starts_at: at("10:00"), ends_at: at("10:30"),
    });
    await transitionAppointment(actor, appt.id, { to_status: "confirmed" });
    await transitionAppointment(actor, appt.id, { to_status: "arrived" });
    await transitionAppointment(actor, appt.id, { to_status: "seated" });
    await transitionAppointment(actor, appt.id, { to_status: "completed" });

    await expect(transitionAppointment(actor, appt.id, { to_status: "arrived" })).rejects.toThrow(IllegalTransitionError);
  });

  it("cancelling records reason and cancelled_by", async () => {
    const { actor, location, opA, provider, patient } = await setup();
    const appt = await createAppointment(actor, {
      patient_id: patient.id, location_id: location.id, operatory_id: opA.id, provider_id: provider.id,
      starts_at: at("10:00"), ends_at: at("10:30"),
    });

    const cancelled = await transitionAppointment(actor, appt.id, {
      to_status: "cancelled", reason: "Patient called in sick", cancelled_by: "patient",
    });
    expect(cancelled.cancelledBy).toBe("patient");
    expect(cancelled.cancellationReason).toBe("Patient called in sick");
  });
});

describe("rescheduleAppointment", () => {
  afterEach(cleanup);

  it("creates a new appointment and cancels the original, linked by rescheduled_to_id", async () => {
    const { actor, location, opA, opB, provider, patient } = await setup();
    const original = await createAppointment(actor, {
      patient_id: patient.id, location_id: location.id, operatory_id: opA.id, provider_id: provider.id,
      starts_at: at("10:00"), ends_at: at("10:30"),
    });

    const rescheduled = await rescheduleAppointment(actor, original.id, {
      operatory_id: opB.id, starts_at: at("14:00"), ends_at: at("14:30"),
    });

    expect(rescheduled.id).not.toBe(original.id);
    expect(rescheduled.status).toBe("scheduled");
    expect(rescheduled.patientId).toBe(patient.id);

    const original2 = await getAppointment(actor, original.id);
    expect(original2.status).toBe("cancelled");
    expect(original2.rescheduledToId).toBe(rescheduled.id);
  });
});

describe("listAppointments", () => {
  afterEach(cleanup);

  it("lists appointments for a location on a given date, ordered by start time", async () => {
    const { actor, location, opA, opB, provider, patient } = await setup();
    await createAppointment(actor, {
      patient_id: patient.id, location_id: location.id, operatory_id: opB.id, provider_id: provider.id,
      starts_at: at("14:00"), ends_at: at("14:30"),
    });
    await createAppointment(actor, {
      patient_id: patient.id, location_id: location.id, operatory_id: opA.id, provider_id: provider.id,
      starts_at: at("09:30"), ends_at: at("10:00"),
    });

    const result = await listAppointments(actor, { location_id: location.id, date: DAY });

    expect(result.map((a) => a.operatoryId)).toEqual([opA.id, opB.id]);
  });

  it("does not return appointments from the day before or after", async () => {
    const { actor, location, opA, provider, patient } = await setup();
    await createAppointment(actor, {
      patient_id: patient.id, location_id: location.id, operatory_id: opA.id, provider_id: provider.id,
      starts_at: at("23:45"), ends_at: `2026-08-20T00:15:00+05:30`, override: true,
    });

    const result = await listAppointments(actor, { location_id: location.id, date: "2026-08-20" });
    expect(result).toEqual([]);
  });
});

describe("getAvailability", () => {
  afterEach(cleanup);

  it("fills the provider's full working window with slots when nothing is booked", async () => {
    const { actor, location, provider } = await setup();

    const slots = await getAvailability(actor, {
      location_id: location.id, provider_id: provider.id, date: DAY, duration_minutes: 30,
    });

    // 09:00-17:00 window, 30-min slots stepped every 15 min: (480-30)/15 + 1 = 31.
    expect(slots).toHaveLength(31);
    expect(slots[0]).toEqual({ starts_at: atUTC("09:00"), ends_at: atUTC("09:30") });
    expect(slots[slots.length - 1]).toEqual({ starts_at: atUTC("16:30"), ends_at: atUTC("17:00") });
  });

  it("excludes slots that overlap an existing appointment", async () => {
    const { actor, location, opA, provider, patient } = await setup();
    await createAppointment(actor, {
      patient_id: patient.id, location_id: location.id, operatory_id: opA.id, provider_id: provider.id,
      starts_at: at("10:00"), ends_at: at("10:30"),
    });

    const slots = await getAvailability(actor, {
      location_id: location.id, provider_id: provider.id, date: DAY, duration_minutes: 30,
    });
    const starts = slots.map((s) => s.starts_at);

    expect(starts).not.toContain(atUTC("09:45")); // would end 10:15, overlaps
    expect(starts).not.toContain(atUTC("10:00"));
    expect(starts).not.toContain(atUTC("10:15")); // would start 10:15, overlaps
    expect(starts).toContain(atUTC("09:30")); // ends exactly at 10:00, no overlap
    expect(starts).toContain(atUTC("10:30")); // starts exactly at 10:00's end, no overlap
  });

  it("excludes slots that overlap a schedule block (lunch)", async () => {
    const { org, actor, location, provider } = await setup();
    await adminDb.insert(scheduleBlocks).values({
      organizationId: org.id, locationId: location.id,
      startsAt: new Date(at("13:00")), endsAt: new Date(at("14:00")), reason: "Lunch",
    });

    const slots = await getAvailability(actor, {
      location_id: location.id, provider_id: provider.id, date: DAY, duration_minutes: 30,
    });
    const starts = slots.map((s) => s.starts_at);

    expect(starts).not.toContain(atUTC("13:00"));
    expect(starts).not.toContain(atUTC("13:30"));
    expect(starts).toContain(atUTC("12:30")); // ends exactly at 13:00
    expect(starts).toContain(atUTC("14:00")); // starts exactly at the block's end
  });

  it("returns nothing on a day the provider has no schedule at all", async () => {
    const { actor, location, provider } = await setup();
    // setup() seeds every day of the week — delete Sunday's row to leave a real gap.
    await adminDb.delete(providerSchedules).where(and(eq(providerSchedules.providerId, provider.id), eq(providerSchedules.dayOfWeek, 0)));

    // 2026-08-16 is a Sunday.
    const slots = await getAvailability(actor, {
      location_id: location.id, provider_id: provider.id, date: "2026-08-16", duration_minutes: 30,
    });

    expect(slots).toEqual([]);
  });

  it("404s for a provider that doesn't belong to this org", async () => {
    const { actor, location } = await setup();
    await expect(
      getAvailability(actor, {
        location_id: location.id, provider_id: "00000000-0000-0000-0000-000000000000", date: DAY, duration_minutes: 30,
      }),
    ).rejects.toThrow(ProviderNotFoundError);
  });
});
