"use client";

import { useState, type FormEvent } from "react";
import { ApiError } from "@/lib/api-client";
import type { Patient, PatientInput } from "@/lib/patients-api";

export interface PatientFormValues {
  first_name: string;
  last_name: string;
  phone: string;
  date_of_birth: string;
  sex: "" | "male" | "female" | "other";
  email: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
  notes: string;
  responsible_party_name: string;
  responsible_party_phone: string;
  responsible_party_relationship: string;
}

const EMPTY: PatientFormValues = {
  first_name: "",
  last_name: "",
  phone: "",
  date_of_birth: "",
  sex: "",
  email: "",
  address_line1: "",
  address_line2: "",
  city: "",
  state: "",
  postal_code: "",
  notes: "",
  responsible_party_name: "",
  responsible_party_phone: "",
  responsible_party_relationship: "",
};

export function patientToFormValues(patient: Patient): PatientFormValues {
  return {
    first_name: patient.first_name,
    last_name: patient.last_name,
    phone: patient.phone,
    date_of_birth: patient.date_of_birth ?? "",
    sex: patient.sex ?? "",
    email: patient.email ?? "",
    address_line1: patient.address_line1 ?? "",
    address_line2: patient.address_line2 ?? "",
    city: patient.city ?? "",
    state: patient.state ?? "",
    postal_code: patient.postal_code ?? "",
    notes: patient.notes ?? "",
    responsible_party_name: "",
    responsible_party_phone: "",
    responsible_party_relationship: "",
  };
}

export function formValuesToInput(values: PatientFormValues): PatientInput {
  return {
    first_name: values.first_name,
    last_name: values.last_name,
    phone: values.phone,
    date_of_birth: values.date_of_birth || null,
    sex: values.sex || null,
    email: values.email || null,
    address_line1: values.address_line1 || null,
    address_line2: values.address_line2 || null,
    city: values.city || null,
    state: values.state || null,
    postal_code: values.postal_code || null,
    notes: values.notes || null,
    responsible_party: values.responsible_party_name
      ? {
          full_name: values.responsible_party_name,
          phone: values.responsible_party_phone,
          relationship: values.responsible_party_relationship,
        }
      : null,
  };
}

const inputClass =
  "h-9 w-full rounded-[var(--radius)] border border-rule bg-surface px-2.5 text-[13px] text-ink outline-none placeholder:text-ink-soft focus-visible:border-steel";
const labelClass = "text-[12px] font-medium text-ink-soft";

export function PatientForm({
  initialValues = EMPTY,
  submitLabel,
  onSubmit,
}: {
  initialValues?: PatientFormValues;
  submitLabel: string;
  onSubmit: (values: PatientFormValues) => Promise<void>;
}) {
  const [values, setValues] = useState(initialValues);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function set<K extends keyof PatientFormValues>(key: K, value: PatientFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);
    try {
      await onSubmit(values);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        const next: Record<string, string> = {};
        for (const d of (err.details as { path?: (string | number)[]; message: string }[] | undefined) ?? []) {
          const field = d.path?.[0];
          if (typeof field === "string") next[field] = d.message;
        }
        setFieldErrors(next);
      } else {
        setError("Something went wrong. Try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-3xl px-6 py-6">
      {error && (
        <div className="mb-4 rounded-[var(--radius)] border border-bleed/30 bg-bleed/5 px-3 py-2 text-[13px] text-bleed">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        <Field label="First name" required error={fieldErrors.first_name}>
          <input
            className={inputClass}
            value={values.first_name}
            onChange={(e) => set("first_name", e.target.value)}
            required
            autoFocus
          />
        </Field>
        <Field label="Last name" required error={fieldErrors.last_name}>
          <input
            className={inputClass}
            value={values.last_name}
            onChange={(e) => set("last_name", e.target.value)}
            required
          />
        </Field>

        <Field label="Phone" required error={fieldErrors.phone}>
          <input
            className={`${inputClass} font-data`}
            value={values.phone}
            onChange={(e) => set("phone", e.target.value)}
            placeholder="+91…"
            required
          />
        </Field>
        <Field label="Email">
          <input
            type="email"
            className={inputClass}
            value={values.email}
            onChange={(e) => set("email", e.target.value)}
          />
        </Field>

        <Field label="Date of birth">
          <input
            type="date"
            className={`${inputClass} font-data`}
            value={values.date_of_birth}
            onChange={(e) => set("date_of_birth", e.target.value)}
          />
        </Field>
        <Field label="Sex">
          <select
            className={inputClass}
            value={values.sex}
            onChange={(e) => set("sex", e.target.value as PatientFormValues["sex"])}
          >
            <option value="">Not specified</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </select>
        </Field>

        <Field label="Address" className="col-span-2">
          <input
            className={inputClass}
            value={values.address_line1}
            onChange={(e) => set("address_line1", e.target.value)}
            placeholder="Line 1"
          />
        </Field>
        <Field label="City">
          <input className={inputClass} value={values.city} onChange={(e) => set("city", e.target.value)} />
        </Field>
        <Field label="State">
          <input className={inputClass} value={values.state} onChange={(e) => set("state", e.target.value)} />
        </Field>
        <Field label="Postal code">
          <input
            className={`${inputClass} font-data`}
            value={values.postal_code}
            onChange={(e) => set("postal_code", e.target.value)}
          />
        </Field>

        <Field label="Notes" className="col-span-2">
          <textarea
            className={`${inputClass} h-20 resize-none py-2`}
            value={values.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </Field>
      </div>

      <div className="mt-6 border-t border-rule pt-4">
        <h2 className="font-condensed text-[13px] font-semibold text-ink">Responsible party</h2>
        <p className="mb-3 text-[12px] text-ink-soft">
          Only needed when someone else pays — a parent, a spouse. Leave blank if the patient pays for themself.
        </p>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Full name">
            <input
              className={inputClass}
              value={values.responsible_party_name}
              onChange={(e) => set("responsible_party_name", e.target.value)}
            />
          </Field>
          <Field label="Phone">
            <input
              className={`${inputClass} font-data`}
              value={values.responsible_party_phone}
              onChange={(e) => set("responsible_party_phone", e.target.value)}
            />
          </Field>
          <Field label="Relationship">
            <input
              className={inputClass}
              value={values.responsible_party_relationship}
              onChange={(e) => set("responsible_party_relationship", e.target.value)}
              placeholder="Father, spouse…"
            />
          </Field>
        </div>
      </div>

      <div className="mt-6 flex justify-end">
        <button
          type="submit"
          disabled={submitting}
          className="h-9 rounded-[var(--radius)] bg-steel px-4 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  required,
  error,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className ?? ""}`}>
      <span className={labelClass}>
        {label}
        {required && <span className="text-bleed"> *</span>}
      </span>
      {children}
      {error && <span className="text-[11px] text-bleed">{error}</span>}
    </label>
  );
}
