import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { adminDb } from "../src/server/db/client";
import { wipeOrganizationData } from "../src/server/db/wipe-organization";
import { hashPassword } from "../src/server/lib/password";
import {
  organizations,
  locations,
  operatories,
  users,
  providerProfiles,
  providerSchedules,
  patients,
  responsibleParties,
  patientAlerts,
  appointmentTypes,
  appointments,
  procedureCodes,
  feeSchedules,
  feeScheduleItems,
  chartedConditions,
  chartedProcedures,
  treatmentPlans,
  treatmentPlanPhases,
  treatmentPlanItems,
  perioExams,
  perioToothRecords,
  perioSiteMeasurements,
  clinicalNotes,
  invoices,
  invoiceLines,
  payments,
  paymentAllocations,
  invoiceNumberCounters,
} from "../src/server/db/schema";
import { fromPaise, lineTax, rateToPercentString, toPaise, TAX_RATE_BY_CLASS, type TaxClass } from "../src/server/lib/money";
import { zonedDateString, zonedDateTimeToInstant } from "../src/server/lib/timezone";

/**
 * Loads seed/mock-data.json through the same tables the app writes to — see
 * docs/specs/seed-data.md. Idempotent: truncates the demo org and rebuilds it.
 * Refuses to run against production unless SEED_ALLOW_PRODUCTION=1 is set.
 */

if (process.env.NODE_ENV === "production" && process.env.SEED_ALLOW_PRODUCTION !== "1") {
  console.error("Refusing to seed a production database. Set SEED_ALLOW_PRODUCTION=1 to override.");
  process.exit(1);
}

type Data = typeof import("./mock-data.json");
const data = JSON.parse(readFileSync(join(__dirname, "mock-data.json"), "utf-8")) as Data;

// Dates and clock times are the clinic's (seed-data.md: "resolved in Asia/Kolkata"), not the
// machine's: setHours() used the machine's timezone, so on a UTC server "09:30" landed at
// 15:00 IST, and dateOnly() took the UTC date (docs/bug-log.md entry 29).
const SEED_TZ = data.organization.timezone;
const today = new Date();
const todayInClinic = zonedDateString(today, SEED_TZ);

/** "YYYY-MM-DD" in the clinic's calendar, `dayOffset` days from today. */
function dateOnly(dayOffset: number): string {
  const [y, m, d] = todayInClinic.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + dayOffset)).toISOString().slice(0, 10);
}

/** An instant `dayOffset` days from now; with `time`, that wall-clock time in the clinic. */
function atOffset(dayOffset: number, time?: string): Date {
  if (time) return zonedDateTimeToInstant(dateOnly(dayOffset), time, SEED_TZ);
  return new Date(today.getTime() + dayOffset * 24 * 60 * 60 * 1000);
}

type SiteTuple = [number, number, boolean, boolean, boolean];

async function main() {
  console.log(`Seeding "${data.organization.name}"...`);

  // --- wipe any prior run of this demo org ---
  const [existing] = await adminDb.select().from(organizations).where(eq(organizations.name, data.organization.name));
  if (existing) {
    console.log("Removing previous seed run...");
    await wipeOrganizationData(adminDb, existing.id);
    await adminDb.delete(organizations).where(eq(organizations.id, existing.id));
  }

  // --- organization ---
  const [org] = await adminDb.insert(organizations).values({
    name: data.organization.name,
    gstRegistered: data.organization.gst_registered,
    gstin: data.organization.gstin,
    toothNotationDisplay: data.organization.tooth_notation_display as "fdi" | "universal",
    deploymentTarget: data.organization.deployment_target as "cloud" | "onsite",
    timezone: data.organization.timezone,
    currency: data.organization.currency,
  }).returning();

  // --- locations & operatories ---
  const locationIds: Record<string, string> = {};
  for (const [index, loc] of data.locations.entries()) {
    const [row] = await adminDb.insert(locations).values({
      organizationId: org.id,
      name: loc.name,
      displayOrder: index, // mock-data order: the first entry is the main site
      addressLine1: loc.address_line1,
      city: loc.city,
      state: loc.state,
      postalCode: loc.postal_code,
      phone: loc.phone,
    }).returning();
    locationIds[loc.key] = row.id;
  }

  const operatoryIds: Record<string, string> = {};
  for (const op of data.operatories) {
    const [row] = await adminDb.insert(operatories).values({
      organizationId: org.id,
      locationId: locationIds[op.location],
      name: op.name,
      displayOrder: op.display_order,
    }).returning();
    operatoryIds[op.key] = row.id;
  }

  // --- users & provider profiles ---
  const userIds: Record<string, string> = {};
  for (const u of data.users) {
    const passwordHash = await hashPassword(u.password);
    const [row] = await adminDb.insert(users).values({
      organizationId: org.id,
      email: u.email.toLowerCase(),
      passwordHash,
      fullName: u.full_name,
      role: u.role as typeof users.$inferInsert.role,
    }).returning();
    userIds[u.key] = row.id;

    if (u.provider_profile) {
      await adminDb.insert(providerProfiles).values({
        organizationId: org.id,
        userId: row.id,
        registrationNumber: u.provider_profile.registration_number,
        qualification: u.provider_profile.qualification,
        defaultOperatoryId: operatoryIds[u.provider_profile.default_operatory],
        color: u.provider_profile.color,
      });
    }
  }

  for (const s of data.provider_schedules) {
    for (const day of s.days) {
      await adminDb.insert(providerSchedules).values({
        organizationId: org.id,
        providerId: userIds[s.provider],
        locationId: locationIds[s.location],
        dayOfWeek: day,
        startTime: s.start_time,
        endTime: s.end_time,
        effectiveFrom: dateOnly(-365),
      });
    }
  }

  // --- appointment types ---
  const appointmentTypeIds: Record<string, string> = {};
  for (const t of data.appointment_types) {
    const [row] = await adminDb.insert(appointmentTypes).values({
      organizationId: org.id,
      name: t.name,
      defaultDurationMinutes: t.default_duration_minutes,
      color: t.color,
    }).returning();
    appointmentTypeIds[t.key] = row.id;
  }

  // --- procedure catalog + default fee schedule ---
  const procedureCodeIds: Record<string, string> = {};
  for (const p of data.procedure_codes) {
    const [row] = await adminDb.insert(procedureCodes).values({
      organizationId: org.id,
      code: p.code,
      shortName: p.short_name,
      description: null,
      category: p.category as typeof procedureCodes.$inferInsert.category,
      appliesTo: p.applies_to as typeof procedureCodes.$inferInsert.appliesTo,
      surfacesRequired: p.surfaces_required ?? false,
      taxClass: p.tax_class as typeof procedureCodes.$inferInsert.taxClass,
      cdtEquivalent: p.cdt_equivalent,
    }).returning();
    procedureCodeIds[p.code] = row.id;
  }

  const [feeSchedule] = await adminDb.insert(feeSchedules).values({
    organizationId: org.id,
    name: data.fee_schedule.name,
    effectiveFrom: dateOnly(data.fee_schedule.effective_from_offset_days),
    isDefault: data.fee_schedule.is_default,
  }).returning();

  for (const p of data.procedure_codes) {
    await adminDb.insert(feeScheduleItems).values({
      organizationId: org.id,
      feeScheduleId: feeSchedule.id,
      procedureCodeId: procedureCodeIds[p.code],
      price: p.price,
    });
  }

  // --- patients ---
  const patientIds: Record<string, string> = {};
  for (const p of data.patients) {
    let responsiblePartyId: string | null = null;
    if (p.responsible_party) {
      const [rp] = await adminDb.insert(responsibleParties).values({
        organizationId: org.id,
        fullName: p.responsible_party.full_name,
        phone: p.responsible_party.phone,
        relationship: p.responsible_party.relationship,
      }).returning();
      responsiblePartyId = rp.id;
    }

    const [row] = await adminDb.insert(patients).values({
      organizationId: org.id,
      patientNumber: p.patient_number,
      firstName: p.first_name,
      lastName: p.last_name,
      dateOfBirth: p.date_of_birth,
      sex: p.sex as typeof patients.$inferInsert.sex,
      phone: p.phone,
      city: p.city,
      preferredLocationId: locationIds[p.preferred_location],
      responsiblePartyId,
    }).returning();
    patientIds[p.key] = row.id;
  }

  for (const a of data.patient_alerts) {
    await adminDb.insert(patientAlerts).values({
      organizationId: org.id,
      patientId: patientIds[a.patient],
      alertType: a.alert_type as typeof patientAlerts.$inferInsert.alertType,
      label: a.label,
      detail: a.detail,
      severity: a.severity as typeof patientAlerts.$inferInsert.severity,
    });
  }

  // --- appointments ---
  const appointmentIds: Record<number, string> = {};
  for (let i = 0; i < data.appointments.length; i++) {
    const a = data.appointments[i];
    const start = atOffset(a.day_offset, a.start);
    const durationMin = data.appointment_types.find((t) => t.key === a.type)?.default_duration_minutes ?? 30;
    const end = new Date(start.getTime() + durationMin * 60_000);

    const [row] = await adminDb.insert(appointments).values({
      organizationId: org.id,
      locationId: locationIds[a.operatory.startsWith("bn") ? "baner" : "kp"],
      operatoryId: operatoryIds[a.operatory],
      patientId: patientIds[a.patient],
      providerId: userIds[a.provider],
      appointmentTypeId: appointmentTypeIds[a.type],
      startsAt: start,
      endsAt: end,
      status: a.status as typeof appointments.$inferInsert.status,
      completedAt: a.status === "completed" ? start : null,
    }).returning();
    appointmentIds[i] = row.id;
  }

  // --- charted conditions & procedures ---
  for (const c of data.charted_conditions) {
    await adminDb.insert(chartedConditions).values({
      organizationId: org.id,
      patientId: patientIds[c.patient],
      tooth: c.tooth ?? null,
      surfaces: c.surfaces ?? null,
      conditionType: c.condition_type,
      note: c.note ?? null,
      chartedBy: userIds.ananya,
    });
  }

  // Keyed procedures are the ones sample treatment plans point at (below).
  const chartedProcedureIds: Record<string, string> = {};
  for (const cp of data.charted_procedures) {
    const [cpRow] = await adminDb.insert(chartedProcedures).values({
      organizationId: org.id,
      patientId: patientIds[cp.patient],
      procedureCodeId: procedureCodeIds[cp.code],
      tooth: cp.tooth ?? null,
      surfaces: cp.surfaces ?? null,
      quadrant: cp.quadrant ?? null,
      arch: cp.arch ?? null,
      status: cp.status as typeof chartedProcedures.$inferInsert.status,
      providerId: userIds[cp.provider],
      price: cp.status !== "planned" ? data.procedure_codes.find((p) => p.code === cp.code)?.price : null,
      feeScheduleId: cp.status !== "planned" ? feeSchedule.id : null,
      note: cp.note ?? null,
      completedAt: cp.status === "completed" || cp.status === "invoiced" ? atOffset(cp.day_offset ?? 0) : null,
      invoicedAt: cp.status === "invoiced" ? atOffset(cp.day_offset ?? 0) : null,
    }).returning();
    if ("key" in cp && cp.key) chartedProcedureIds[cp.key] = cpRow.id;
  }

  // --- treatment plans ---
  // One per lifecycle status, all linked to procedures seeded above (whose status and
  // price snapshot already match the plan's status). Arjun Kulkarni's planned fillings
  // are left off every plan on purpose: the demo builds a plan from them live.
  for (const tp of data.treatment_plans) {
    const [planRow] = await adminDb.insert(treatmentPlans).values({
      organizationId: org.id,
      patientId: patientIds[tp.patient],
      name: tp.name,
      status: tp.status as typeof treatmentPlans.$inferInsert.status,
      presentedAt: "presented_offset" in tp && tp.presented_offset !== undefined ? atOffset(tp.presented_offset) : null,
      acceptedAt: "accepted_offset" in tp && tp.accepted_offset !== undefined ? atOffset(tp.accepted_offset) : null,
      createdBy: userIds.ananya,
    }).returning();
    for (const [phaseIndex, phase] of tp.phases.entries()) {
      const [phaseRow] = await adminDb.insert(treatmentPlanPhases).values({
        organizationId: org.id,
        treatmentPlanId: planRow.id,
        name: phase.name,
        sequence: phaseIndex,
      }).returning();
      for (const [itemIndex, key] of phase.items.entries()) {
        const chartedProcedureId = chartedProcedureIds[key];
        if (!chartedProcedureId) throw new Error(`treatment_plans: no charted procedure with key "${key}"`);
        await adminDb.insert(treatmentPlanItems).values({
          organizationId: org.id,
          treatmentPlanPhaseId: phaseRow.id,
          chartedProcedureId,
          sequence: itemIndex,
        });
      }
    }
  }

  // --- perio exams ---
  const HEALTHY_SITE: SiteTuple = [2, 0, false, false, false];
  const SITES = ["MB", "B", "DB", "ML", "L", "DL"] as const;
  const ALL_TEETH_FDI = [
    "18","17","16","15","14","13","12","11","21","22","23","24","25","26","27","28",
    "48","47","46","45","44","43","42","41","31","32","33","34","35","36","37","38",
  ];

  for (const exam of data.perio_exams) {
    const [row] = await adminDb.insert(perioExams).values({
      organizationId: org.id,
      patientId: patientIds[exam.patient],
      providerId: userIds[exam.provider],
      examDate: dateOnly(exam.day_offset),
      completedAt: exam.completed ? atOffset(exam.day_offset) : null,
    }).returning();

    const specifiedTeeth = new Set(exam.teeth.map((t) => t.tooth));

    for (const t of exam.teeth) {
      await adminDb.insert(perioToothRecords).values({
        organizationId: org.id,
        examId: row.id,
        tooth: t.tooth,
        mobility: t.mobility ?? null,
        furcation: t.furcation ?? null,
        isSkipped: t.is_skipped ?? false,
      });

      if (t.sites) {
        for (const site of SITES) {
          const tuple = t.sites[site] as SiteTuple | undefined;
          if (!tuple) continue;
          const [pocketDepth, gingivalMargin, bleeding, suppuration, plaque] = tuple;
          await adminDb.insert(perioSiteMeasurements).values({
            organizationId: org.id,
            examId: row.id,
            tooth: t.tooth,
            site,
            pocketDepth,
            gingivalMargin,
            bleedingOnProbing: bleeding,
            suppuration,
            plaque,
          });
        }
      }
    }

    // Fill remaining teeth with healthy defaults so every exam is a complete full-mouth
    // record — see docs/specs/seed-data.md.
    for (const tooth of ALL_TEETH_FDI) {
      if (specifiedTeeth.has(tooth)) continue;
      await adminDb.insert(perioToothRecords).values({
        organizationId: org.id, examId: row.id, tooth, mobility: 0, furcation: null,
      });
      for (const site of SITES) {
        await adminDb.insert(perioSiteMeasurements).values({
          organizationId: org.id, examId: row.id, tooth, site,
          pocketDepth: HEALTHY_SITE[0], gingivalMargin: HEALTHY_SITE[1],
          bleedingOnProbing: HEALTHY_SITE[2], suppuration: HEALTHY_SITE[3], plaque: HEALTHY_SITE[4],
        });
      }
    }
  }

  // --- clinical notes ---
  for (const n of data.clinical_notes) {
    await adminDb.insert(clinicalNotes).values({
      organizationId: org.id,
      patientId: patientIds[n.patient],
      providerId: userIds[n.provider],
      body: n.body,
      signedAt: n.signed ? atOffset(n.day_offset) : null,
      signedBy: n.signed ? userIds[n.provider] : null,
    });
  }

  // --- invoices & payments ---
  // Each line points at the charted procedure it bills (already `invoiced` above), so a
  // void returns it to `completed` like any real invoice. Money in paise via money.ts, tax
  // through the same lineTax the ledger service uses. Numbers are INV-<this year>-<sequence>,
  // and the counter starts after the highest seeded one. See docs/specs/ledger.md.
  const invoiceYear = Number(todayInClinic.slice(0, 4));
  let maxSequence = 0;
  for (const inv of data.invoices) {
    const lines = inv.lines.map((l) => {
      const cp = data.charted_procedures.find((c) => "key" in c && c.key === l.procedure);
      if (!cp) throw new Error(`invoices: no charted procedure with key "${l.procedure}"`);
      const code = data.procedure_codes.find((p) => p.code === cp.code)!;
      const rate = data.organization.gst_registered ? TAX_RATE_BY_CLASS[code.tax_class as TaxClass] : 0;
      const tax = lineTax(toPaise(code.price), rate, true);
      return { cp, code, rate, ...tax };
    });
    maxSequence = Math.max(maxSequence, inv.sequence);

    const [invoiceRow] = await adminDb.insert(invoices).values({
      organizationId: org.id,
      locationId: locationIds[inv.location],
      patientId: patientIds[inv.patient],
      invoiceNumber: `INV-${invoiceYear}-${String(inv.sequence).padStart(4, "0")}`,
      issuedAt: atOffset(inv.day_offset),
      status: "issued",
      subtotal: fromPaise(lines.reduce((sum, l) => sum + l.unit, 0)),
      taxTotal: fromPaise(lines.reduce((sum, l) => sum + l.tax, 0)),
      total: fromPaise(lines.reduce((sum, l) => sum + l.total, 0)),
    }).returning();

    for (const l of lines) {
      await adminDb.insert(invoiceLines).values({
        organizationId: org.id,
        invoiceId: invoiceRow.id,
        chartedProcedureId: chartedProcedureIds[l.cp.key as string],
        description: l.code.short_name,
        quantity: 1,
        unitPrice: fromPaise(l.unit),
        taxClass: l.code.tax_class as typeof invoiceLines.$inferInsert.taxClass,
        taxRate: rateToPercentString(l.rate),
        taxAmount: fromPaise(l.tax),
        lineTotal: fromPaise(l.total),
      });
    }

    if (inv.payment) {
      const [paymentRow] = await adminDb.insert(payments).values({
        organizationId: org.id,
        locationId: locationIds[inv.location],
        patientId: patientIds[inv.patient],
        amount: inv.payment.amount,
        method: inv.payment.method as typeof payments.$inferInsert.method,
        reference: inv.payment.reference ?? null,
        receivedAt: atOffset(inv.day_offset),
        receivedBy: userIds.sneha,
      }).returning();

      await adminDb.insert(paymentAllocations).values({
        organizationId: org.id,
        paymentId: paymentRow.id,
        invoiceId: invoiceRow.id,
        amount: inv.payment.amount,
      });
    }
  }
  await adminDb.insert(invoiceNumberCounters).values({ organizationId: org.id, year: invoiceYear, lastValue: maxSequence });

  console.log(`Seeded organization ${org.id} — "${org.name}"`);
  console.log(`  ${data.locations.length} locations, ${data.users.length} users, ${data.patients.length} patients`);
  console.log(`  ${data.appointments.length} appointments, ${data.perio_exams.length} perio exams, ${data.treatment_plans.length} treatment plans`);
  console.log(`\nLog in with any user's email above and password: DemoPassword123`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
