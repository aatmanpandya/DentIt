"use client";

import { useRouter } from "next/navigation";
import { PatientForm, formValuesToInput, type PatientFormValues } from "@/components/patients/patient-form";
import { createPatient } from "@/lib/patients-api";

export default function NewPatientPage() {
  const router = useRouter();

  async function handleSubmit(values: PatientFormValues) {
    const patient = await createPatient(formValuesToInput(values));
    router.push(`/patients/${patient.id}`);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-none border-b border-rule bg-surface px-6 py-3">
        <h1 className="font-condensed text-[15px] font-semibold text-ink">Add patient</h1>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <PatientForm submitLabel="Add patient" onSubmit={handleSubmit} />
      </div>
    </div>
  );
}
