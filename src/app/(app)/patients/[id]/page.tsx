"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { AlertTriangle, Plus } from "lucide-react";
import clsx from "clsx";
import { getPatient, listPatientAlerts, createPatientAlert, updatePatientAlert } from "@/lib/patients-api";
import type { PatientAlert } from "@/lib/patients-api";
import { getPatientChart } from "@/lib/chart-api";
import type { Surface } from "@/lib/chart-api";
import { Odontogram } from "@/components/chart/odontogram";
import { ChartingPanel } from "@/components/chart/charting-panel";
import { ScopedProceduresList } from "@/components/chart/scoped-procedures-list";
import type { DentitionView } from "@/components/chart/tooth-grid";

const SEVERITY_COLOR: Record<string, string> = {
  critical: "text-bleed",
  warning: "text-caution",
  info: "text-ink-soft",
};

// Mixed dentition is the accurate default below this age; adult above it — the
// dentist corrects per-tooth as eruption actually happens (see the odontogram
// spec's "Intake defaults"). Not re-derived once the user picks a view explicitly.
const MIXED_DENTITION_AGE_THRESHOLD = 13;

function age(dateOfBirth: string | null): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  const now = new Date();
  let years = now.getFullYear() - dob.getFullYear();
  const beforeBirthday = now.getMonth() < dob.getMonth() || (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate());
  if (beforeBirthday) years -= 1;
  return years;
}

export default function PatientChartPage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [addingAlert, setAddingAlert] = useState(false);
  const [alertsExpanded, setAlertsExpanded] = useState(false);
  const [view, setView] = useState<DentitionView | null>(null);
  const [selected, setSelected] = useState<{ fdi: string; surface?: Surface } | null>(null);

  const { data: patient } = useQuery({ queryKey: ["patient", params.id], queryFn: () => getPatient(params.id) });
  const { data: alertsData } = useQuery({ queryKey: ["patient-alerts", params.id], queryFn: () => listPatientAlerts(params.id) });
  const { data: chart } = useQuery({ queryKey: ["patient-chart", params.id], queryFn: () => getPatientChart(params.id) });

  const toggleAlert = useMutation({
    mutationFn: (alert: PatientAlert) => updatePatientAlert(alert.id, { is_active: !alert.is_active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient-alerts", params.id] });
      queryClient.invalidateQueries({ queryKey: ["patient-summary", params.id] });
    },
  });

  const defaultView = useMemo<DentitionView>(() => {
    const years = age(patient?.date_of_birth ?? null);
    return years !== null && years < MIXED_DENTITION_AGE_THRESHOLD ? "mixed" : "adult";
  }, [patient?.date_of_birth]);

  const effectiveView = view ?? defaultView;
  const alerts = alertsData?.data ?? [];
  const activeAlerts = alerts.filter((a) => a.is_active);

  function refetchChart() {
    queryClient.invalidateQueries({ queryKey: ["patient-chart", params.id] });
  }

  if (!patient || !chart) return null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-none flex-wrap items-center gap-x-6 gap-y-1 border-b border-rule px-4 py-2 text-[12px]">
        <Info label="Phone" value={patient.phone} mono />
        <Info label="Date of birth" value={patient.date_of_birth} mono />
        <Info label="Sex" value={patient.sex} capitalize />
        <Info label="Notes" value={patient.notes} />

        <div className="ml-auto flex items-center gap-2">
          {activeAlerts.slice(0, 3).map((alert) => (
            <span key={alert.id} className={clsx("flex items-center gap-1 text-[12px] font-medium", SEVERITY_COLOR[alert.severity])} title={alert.detail ?? undefined}>
              <AlertTriangle size={12} strokeWidth={2} />
              {alert.label}
            </span>
          ))}
          <button
            onClick={() => setAlertsExpanded((v) => !v)}
            aria-expanded={alertsExpanded}
            className="rounded-[var(--radius)] px-1.5 py-0.5 text-[12px] text-ink-soft hover:bg-steel-lo hover:text-steel"
          >
            Alerts ({alerts.length}) {alertsExpanded ? "▴" : "▾"}
          </button>
          <button
            onClick={() => setAddingAlert((v) => !v)}
            className="flex items-center gap-1 rounded-[var(--radius)] px-1.5 py-0.5 text-[12px] text-steel hover:bg-steel-lo"
          >
            <Plus size={13} /> Alert
          </button>
        </div>
      </div>

      {(addingAlert || alertsExpanded) && (
        <div className="flex-none border-b border-rule bg-paper px-4 py-2.5">
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

          {alertsExpanded && (
            <ul className="mt-2 flex flex-col gap-1.5">
              {alerts.length === 0 && <p className="text-[12px] text-ink-soft">No medical alerts or allergies recorded.</p>}
              {alerts.map((alert) => (
                <li
                  key={alert.id}
                  className={clsx("flex items-start justify-between gap-2 rounded-[var(--radius)] border border-rule bg-surface px-2.5 py-2", !alert.is_active && "opacity-50")}
                >
                  <div>
                    <div className={clsx("flex items-center gap-1.5 text-[13px] font-medium", SEVERITY_COLOR[alert.severity])}>
                      <AlertTriangle size={13} strokeWidth={2} />
                      {alert.label}
                    </div>
                    {alert.detail && <p className="mt-0.5 text-[12px] text-ink-soft">{alert.detail}</p>}
                    <span className="text-[11px] capitalize text-ink-soft">{alert.alert_type}</span>
                  </div>
                  <button onClick={() => toggleAlert.mutate(alert)} className="flex-none text-[11px] text-ink-soft hover:text-ink">
                    {alert.is_active ? "Deactivate" : "Reactivate"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Laptop: odontogram + whole-mouth list on the left, charting panel on the right.
          Below 1024px (a tablet chairside) the fixed-width panel squeezed the teeth to ~22px,
          too small to tap; there it stacks: odontogram, then the panel for the tapped tooth,
          then the whole-mouth list. */}
      {/* One scroll area at every size (a short laptop must never clip the teeth or squeeze
          the list into a sliver); on laptops the panel sticks in view beside it. */}
      <div className="grid min-h-0 flex-1 auto-rows-max overflow-auto lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 p-4 lg:col-start-1 lg:row-start-1">
          <Odontogram
            conditions={chart.conditions}
            procedures={chart.procedures}
            view={effectiveView}
            onViewChange={setView}
            onActivate={(fdi, surface) => setSelected({ fdi, surface })}
            onClose={() => setSelected(null)}
          />
        </div>

        <div className="border-t border-rule lg:sticky lg:top-0 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:max-h-full lg:self-start lg:overflow-auto lg:border-t-0">
          <ChartingPanel
            patientId={params.id}
            selectedFdi={selected?.fdi ?? null}
            initialSurface={selected?.surface ?? null}
            conditions={chart.conditions}
            procedures={chart.procedures}
            onChanged={refetchChart}
          />
        </div>

        <div className="min-w-0 px-4 pb-4 lg:col-start-1 lg:row-start-2">
          <div className="border-t border-rule pt-4">
            <ScopedProceduresList patientId={params.id} procedures={chart.procedures} onChanged={refetchChart} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Info({ label, value, mono, capitalize }: { label: string; value: string | null; mono?: boolean; capitalize?: boolean }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-ink-soft">{label}:</span>
      <span className={clsx("text-ink", mono && "font-data", capitalize && "capitalize")}>{value || "—"}</span>
    </span>
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
    "h-8 rounded-[var(--radius)] border border-rule bg-surface px-2 text-[12px] text-ink outline-none focus-visible:border-steel";

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-rule bg-paper p-2.5">
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
      <input className={fieldClass} placeholder="Label — e.g. Penicillin" value={label} onChange={(e) => setLabel(e.target.value)} required autoFocus />
      <input className={fieldClass} placeholder="Detail (optional)" value={detail} onChange={(e) => setDetail(e.target.value)} />
      <button
        type="submit"
        disabled={submitting || !label}
        className="h-8 rounded-[var(--radius)] bg-steel px-3 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? "Saving…" : "Save alert"}
      </button>
    </form>
  );
}
