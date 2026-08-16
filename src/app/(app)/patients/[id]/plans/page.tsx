"use client";

import { ClipboardList } from "lucide-react";
import { ComingSoon } from "@/components/patients/coming-soon";

export default function PatientPlansPage() {
  return (
    <ComingSoon
      icon={ClipboardList}
      title="No treatment plans yet."
      body="Treatment planning — phases, pricing from the fee schedule, patient presentation — lands days 18-19."
    />
  );
}
