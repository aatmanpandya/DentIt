"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { formatRupees } from "@/lib/format-money";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { getPatient } from "@/lib/patients-api";
import { getTreatmentPlan } from "@/lib/treatment-plans-api";

function money(value: string | null): string {
  return value === null ? "Not yet priced" : formatRupees(value);
}

/**
 * The only screen a patient sees — clean, printable, patient-facing content only. No
 * procedure codes, fee-schedule names, or provider info leak in here; see
 * docs/specs/treatment-planning.md's "Presentation view" section. Stays behind staff
 * auth like every other page (no public link — patient portal is cut from the pilot),
 * so this is meant to be pulled up on a device and handed to the patient, or printed.
 */
export default function TreatmentPlanPresentPage() {
  const params = useParams<{ id: string; planId: string }>();

  const { data: patient } = useQuery({ queryKey: ["patient", params.id], queryFn: () => getPatient(params.id) });
  const { data: plan } = useQuery({ queryKey: ["treatment-plan", params.planId], queryFn: () => getTreatmentPlan(params.planId) });

  if (!plan)
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-8 py-10">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-6 h-32 w-full" />
      </div>
    );

  return (
    <div className="mx-auto max-w-2xl px-8 py-10 print:px-0 print:py-0">
      <div className="mb-6 flex items-start justify-between print:hidden">
        <div />
        <button
          type="button"
          onClick={() => window.print()}
          className="flex h-8 items-center gap-1.5 rounded-[var(--radius)] border border-rule px-3 text-[12px] font-medium text-ink hover:bg-steel-lo"
        >
          <Printer size={14} /> Print
        </button>
      </div>

      <h1 className="font-condensed text-2xl font-medium text-ink">{plan.name}</h1>
      {patient && (
        <p className="mt-1 text-[13px] text-ink-soft">
          {patient.first_name} {patient.last_name}
        </p>
      )}

      <div className="mt-8 flex flex-col gap-6">
        {plan.phases.map((phase) => (
          <div key={phase.id}>
            <h2 className="border-b border-rule pb-1.5 text-[14px] font-medium text-ink">{phase.name}</h2>
            <ul className="mt-2 flex flex-col gap-1.5">
              {phase.items.map((item) => (
                <li key={item.id} className="flex items-baseline justify-between text-[13px]">
                  <span className="text-ink">
                    {item.procedure_short_name}
                    {item.tooth && <span className="text-ink-soft"> — tooth {item.tooth}</span>}
                  </span>
                  <span className="font-data text-ink">{money(item.price)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-1.5 flex justify-end border-t border-rule pt-1.5 text-[12px] text-ink-soft">
              Subtotal {money(phase.subtotal)}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 flex justify-end border-t-2 border-ink pt-2">
        <span className="text-[16px] font-medium text-ink">Total {money(plan.total)}</span>
      </div>
    </div>
  );
}
