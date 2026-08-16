"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PatientForm, patientToFormValues, formValuesToInput, type PatientFormValues } from "@/components/patients/patient-form";
import { getPatient, updatePatient } from "@/lib/patients-api";

export default function EditPatientPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: patient } = useQuery({ queryKey: ["patient", params.id], queryFn: () => getPatient(params.id) });

  async function handleSubmit(values: PatientFormValues) {
    await updatePatient(params.id, formValuesToInput(values));
    await queryClient.invalidateQueries({ queryKey: ["patient", params.id] });
    router.push(`/patients/${params.id}`);
  }

  if (!patient) return null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex-none border-b border-rule bg-surface px-6 py-3">
        <h1 className="font-condensed text-[15px] font-semibold text-ink">
          Edit {patient.first_name} {patient.last_name}
        </h1>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <PatientForm initialValues={patientToFormValues(patient)} submitLabel="Save changes" onSubmit={handleSubmit} />
      </div>
    </div>
  );
}
