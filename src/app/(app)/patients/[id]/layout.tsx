"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { formatRupees } from "@/lib/format-money";
import { type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Pencil } from "lucide-react";
import clsx from "clsx";
import { getPatient, getPatientSummary } from "@/lib/patients-api";
import { ApiError } from "@/lib/api-client";

const TABS = [
  { href: "", label: "Chart" },
  { href: "/perio", label: "Perio" },
  { href: "/notes", label: "Notes" },
  { href: "/plans", label: "Plans" },
  { href: "/ledger", label: "Ledger" },
  { href: "/documents", label: "Documents" },
];

function age(dateOfBirth: string | null): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  const now = new Date();
  let years = now.getFullYear() - dob.getFullYear();
  const beforeBirthday =
    now.getMonth() < dob.getMonth() || (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate());
  if (beforeBirthday) years -= 1;
  return years;
}

const SEX_LETTER: Record<string, string> = { male: "M", female: "F", other: "O" };
const SEVERITY_COLOR: Record<string, string> = {
  critical: "text-bleed",
  warning: "text-caution",
  info: "text-ink-soft",
};

export default function PatientLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const basePath = `/patients/${params.id}`;

  const { data: patient, error: patientError } = useQuery({ queryKey: ["patient", params.id], queryFn: () => getPatient(params.id) });
  const { data: summary } = useQuery({
    queryKey: ["patient-summary", params.id],
    queryFn: () => getPatientSummary(params.id),
  });

  const activeAlerts = summary?.alerts.filter((a) => a.is_active) ?? [];

  // A wrong or stale link (deleted patient, typo, another clinic's id) used to render the tabs
  // over empty pages — the Ledger tab even offered "Create invoice" (docs/bug-log.md entry 35).
  if (patientError instanceof ApiError && patientError.status === 404) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-[14px] font-medium text-ink">Patient not found</p>
        <p className="text-[13px] text-ink-soft">The link may be wrong, or the patient was deleted.</p>
        <Link href="/patients" className="mt-2 text-[13px] font-medium text-steel hover:underline">
          Back to Patients
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col print:block print:h-auto">
      <div className="flex flex-none items-center gap-3 border-b border-rule bg-surface px-4 py-2 print:hidden">
        {patient ? (
          <>
            <span className="text-[13px] font-medium text-ink">
              {patient.first_name} {patient.last_name}
            </span>
            <span className="font-data text-[12px] text-ink-soft">
              {[age(patient.date_of_birth) !== null ? `${age(patient.date_of_birth)}` : null, SEX_LETTER[patient.sex ?? ""]]
                .filter(Boolean)
                .join(" ")}
              {" · #"}
              {patient.patient_number}
            </span>
            <Link
              href={`${basePath}/edit`}
              className="flex items-center gap-1 rounded-[var(--radius)] px-1.5 py-0.5 text-[12px] text-ink-soft hover:bg-steel-lo hover:text-steel"
            >
              <Pencil size={12} /> Edit
            </Link>
            {/* Money owed (or held as credit), visible from every tab — front desk shouldn't
                have to open the Ledger to know. Same calculation as the Ledger tab. */}
            {summary && summary.balance !== "0.00" && (
              <Link
                href={`${basePath}/ledger`}
                className={clsx(
                  "rounded-[var(--radius)] border px-2 py-0.5 font-data text-[12px] font-medium",
                  summary.balance.startsWith("-") ? "border-healthy/40 text-healthy" : "border-caution/50 text-caution",
                )}
              >
                {summary.balance.startsWith("-") ? `${formatRupees(summary.balance.slice(1))} credit` : `${formatRupees(summary.balance)} due`}
              </Link>
            )}
            <div className="ml-auto flex items-center gap-3">
              {activeAlerts.map((alert) => (
                <span
                  key={alert.id}
                  className={clsx("flex items-center gap-1 text-[12px] font-medium", SEVERITY_COLOR[alert.severity])}
                  title={alert.detail ?? undefined}
                >
                  <AlertTriangle size={13} strokeWidth={2} />
                  {alert.label}
                </span>
              ))}
            </div>
          </>
        ) : (
          <span className="flex items-center gap-3">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-20" />
          </span>
        )}
      </div>

      <nav className="flex flex-none gap-1 border-b border-rule bg-surface px-4 print:hidden">
        {TABS.map((tab) => {
          const href = `${basePath}${tab.href}`;
          const active = pathname === href;
          return (
            <Link
              key={tab.href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={clsx(
                "border-b-2 px-3 py-2 text-[13px] font-medium",
                active ? "border-steel text-steel" : "border-transparent text-ink-soft hover:text-ink",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <div className="min-h-0 flex-1 overflow-auto print:overflow-visible">{children}</div>
    </div>
  );
}
