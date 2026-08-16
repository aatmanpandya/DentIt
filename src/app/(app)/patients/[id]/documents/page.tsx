"use client";

import { FolderOpen } from "lucide-react";
import { ComingSoon } from "@/components/patients/coming-soon";

export default function PatientDocumentsPage() {
  return (
    <ComingSoon
      icon={FolderOpen}
      title="No documents yet."
      body="Document upload isn't built yet — it needs a storage decision this pilot hasn't made."
    />
  );
}
