"use client";

import { FileText } from "lucide-react";
import { ComingSoon } from "@/components/patients/coming-soon";

export default function PatientNotesPage() {
  return (
    <ComingSoon
      icon={FileText}
      title="No clinical notes yet."
      body="Signed, amendable clinical notes land alongside charting, days 11-13."
    />
  );
}
