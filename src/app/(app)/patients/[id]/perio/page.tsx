"use client";

import { Activity } from "lucide-react";
import { ComingSoon } from "@/components/patients/coming-soon";

export default function PatientPerioPage() {
  return (
    <ComingSoon
      icon={Activity}
      title="No gum measurements recorded."
      body="Perio charting — full-mouth probing, mouse and keyboard both first-class — lands days 14-17."
    />
  );
}
