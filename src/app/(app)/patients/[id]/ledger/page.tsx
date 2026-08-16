"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Receipt } from "lucide-react";
import { getPatientSummary } from "@/lib/patients-api";
import { ComingSoon } from "@/components/patients/coming-soon";

export default function PatientLedgerPage() {
  const params = useParams<{ id: string }>();
  const { data: summary } = useQuery({
    queryKey: ["patient-summary", params.id],
    queryFn: () => getPatientSummary(params.id),
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex-none border-b border-rule px-6 py-3">
        <span className="text-[12px] text-ink-soft">Balance</span>
        <div className="font-data text-[24px] text-ink">₹{summary?.balance ?? "0.00"}</div>
      </div>
      <div className="min-h-0 flex-1">
        <ComingSoon
          icon={Receipt}
          title="No invoices yet."
          body="Invoicing from completed procedures and payment recording land day 20."
        />
      </div>
    </div>
  );
}
