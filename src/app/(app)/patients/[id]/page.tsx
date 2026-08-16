"use client";

import { useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { AlertTriangle, Plus, Grid3x3 } from "lucide-react";
import clsx from "clsx";
import { getPatient, listPatientAlerts, createPatientAlert, updatePatientAlert } from "@/lib/patients-api";
import type { PatientAlert } from "@/lib/patients-api";
import { ComingSoon } from "@/components/patients/coming-soon";

const SEVERITY_COLOR: Record<string, string> = {
  critical: "text-bleed",
  warning: "text-caution",
  info: "text-ink-soft",
};

export default function PatientChartPage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [addingAlert, setAddingAlert] = useState(false);

  const { data: patient } = useQuery({ queryKey: ["patient", params.id], queryFn: () => getPatient(params.id) });
  const { data: alertsData } = useQuery({
    queryKey: ["patient-alerts", params.id],
    queryFn: () => listPatientAlerts(params.id),
  });

  const toggleAlert = useMutation({
    mutationFn: (alert: PatientAlert) => updatePatientAlert(alert.id, { is_active: !alert.is_active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient-alerts", params.id] });
      queryClient.invalidateQueries({ queryKey: ["patient-summary", params.id] });
    },
  });

  const alerts = alertsData?.data ?? [];

  if (!patient) return null;

  return (
    <div className="grid grid-cols-3 gap-0">
      <div className="col-span-2 border-r border-rule px-6 py-5">
        <h2 className="mb-3 font-condensed text-[13px] font-semibold text-ink">Demographics</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
          <Info label="Phone" value={patient.phone} mono />
          <Info label="Email" value={patient.email} />
          <Info label="Date of birth" value={patient.date_of_birth} mono />
          <Info label="Sex" value={patient.sex} capitalize />
          <Info
            label="Address"
            value={[patient.address_line1, patient.address_line2, patient.city, patient.state, patient.postal_code]
              .filter(Boolean)
              .join(", ") || null}
          />
          <Info label="Notes" value={patient.notes} />
        </dl>

        <div className="mt-8">
          <ComingSoon
            icon={Grid3x3}
            title="Odontogram not built yet."
            body="Whole-mouth charting — surface-level conditions and procedures — lands days 11-13."
          />
        </div>
      </div>

      <div className="px-5 py-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-condensed text-[13px] font-semibold text-ink">Alerts</h2>
          <button
            onClick={() => setAddingAlert((v) => !v)}
            className="flex items-center gap-1 rounded-[var(--radius)] px-1.5 py-0.5 text-[12px] text-steel hover:bg-steel-lo"
          >
            <Plus size={13} /> Add
          </button>
        </div>

        {addingAlert && (
          <AlertForm
            patientId={params.id}
            onDone={() => {
              setAddingAlert(false);
              queryClient.invalidateQueries({ queryKey: ["patient-alerts", params.id] });
              queryClient.invalidateQueries({ queryKey: ["patient-summary", params.id] });
            }}
          />
        )}

        {alerts.length === 0 && !addingAlert && (
          <p className="text-[12px] text-ink-soft">No medical alerts or allergies recorded.</p>
        )}

        <ul className="flex flex-col gap-2">
          {alerts.map((alert) => (
            <li
              key={alert.id}
              className={clsx(
                "flex items-start justify-between gap-2 rounded-[var(--radius)] border border-rule px-2.5 py-2",
                !alert.is_active && "opacity-50",
              )}
            >
              <div>
                <div className={clsx("flex items-center gap-1.5 text-[13px] font-medium", SEVERITY_COLOR[alert.severity])}>
                  <AlertTriangle size={13} strokeWidth={2} />
                  {alert.label}
                </div>
                {alert.detail && <p className="mt-0.5 text-[12px] text-ink-soft">{alert.detail}</p>}
                <span className="text-[11px] capitalize text-ink-soft">{alert.alert_type}</span>
              </div>
              <button
                onClick={() => toggleAlert.mutate(alert)}
                className="flex-none text-[11px] text-ink-soft hover:text-ink"
              >
                {alert.is_active ? "Deactivate" : "Reactivate"}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Info({ label, value, mono, capitalize }: { label: string; value: string | null; mono?: boolean; capitalize?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] text-ink-soft">{label}</dt>
      <dd className={clsx("text-ink", mono && "font-data", capitalize && "capitalize")}>{value || "—"}</dd>
    </div>
  );
}

function AlertForm({ patientId, onDone }: { patientId: string; onDone: () => void }) {
  const [alertType, setAlertType] = useState<PatientAlert["alert_type"]>("allergy");
  const [label, setLabel] = useState("");
  const [detail, setDetail] = useState("");
  const [severity, setSeverity] = useState<PatientAlert["severity"]>("warning");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await createPatientAlert(patientId, { alert_type: alertType, label, detail: detail || null, severity });
      onDone();
    } finally {
      setSubmitting(false);
    }
  }

  const fieldClass =
    "h-8 w-full rounded-[var(--radius)] border border-rule bg-surface px-2 text-[12px] text-ink outline-none focus-visible:border-steel";

  return (
    <form onSubmit={handleSubmit} className="mb-3 flex flex-col gap-2 rounded-[var(--radius)] border border-rule bg-paper p-2.5">
      <div className="flex gap-2">
        <select className={fieldClass} value={alertType} onChange={(e) => setAlertType(e.target.value as PatientAlert["alert_type"])}>
          <option value="allergy">Allergy</option>
          <option value="medical">Medical</option>
          <option value="precaution">Precaution</option>
        </select>
        <select className={fieldClass} value={severity} onChange={(e) => setSeverity(e.target.value as PatientAlert["severity"])}>
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="critical">Critical</option>
        </select>
      </div>
      <input className={fieldClass} placeholder="Label — e.g. Penicillin" value={label} onChange={(e) => setLabel(e.target.value)} required autoFocus />
      <input className={fieldClass} placeholder="Detail (optional)" value={detail} onChange={(e) => setDetail(e.target.value)} />
      <button
        type="submit"
        disabled={submitting || !label}
        className="h-8 rounded-[var(--radius)] bg-steel text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? "Saving…" : "Save alert"}
      </button>
    </form>
  );
}
