"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { UserPlus, Search } from "lucide-react";
import { listPatients } from "@/lib/patients-api";

// Dense, keyboard-navigable table with search focused on load — see
// docs/specs/ui-design.md's screen inventory for days 4-5.
export default function PatientsPage() {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQ(q), 200);
    return () => clearTimeout(handle);
  }, [q]);

  const { data, isLoading } = useQuery({
    queryKey: ["patients", debouncedQ],
    queryFn: () => listPatients({ q: debouncedQ || undefined }),
  });

  const patients = data?.data ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-none items-center justify-between gap-3 border-b border-rule bg-surface px-4 py-3">
        <div className="flex w-full max-w-sm items-center gap-2 rounded-[var(--radius)] border border-rule bg-paper px-2.5 py-1.5 text-ink-soft">
          <Search size={14} />
          <input
            ref={searchRef}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, phone, patient number…"
            className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-soft"
          />
        </div>
        <Link
          href="/patients/new"
          className="flex h-9 items-center gap-1.5 rounded-[var(--radius)] bg-steel px-3 text-[13px] font-medium text-white hover:opacity-90"
        >
          <UserPlus size={15} />
          Add patient
        </Link>
      </div>

      {isLoading ? (
        <div className="flex-1" aria-hidden />
      ) : patients.length === 0 ? (
        <EmptyState hasQuery={Boolean(debouncedQ)} />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead className="sticky top-0 border-b border-rule bg-paper text-left font-condensed text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="px-4 py-2 font-medium">Patient</th>
                <th className="px-4 py-2 font-medium">Number</th>
                <th className="px-4 py-2 font-medium">Phone</th>
                <th className="px-4 py-2 font-medium">DOB</th>
                <th className="px-4 py-2 font-medium">City</th>
              </tr>
            </thead>
            <tbody>
              {patients.map((p) => (
                <tr key={p.id} className="border-b border-rule last:border-b-0 hover:bg-steel-lo">
                  <td className="h-[28px] px-0 py-0">
                    <Link
                      href={`/patients/${p.id}`}
                      className="flex h-[28px] items-center px-4 text-ink outline-none focus-visible:bg-steel-lo"
                    >
                      {p.first_name} {p.last_name}
                    </Link>
                  </td>
                  <td className="px-4 font-data text-ink-soft">{p.patient_number}</td>
                  <td className="px-4 font-data text-ink-soft">{p.phone}</td>
                  <td className="px-4 font-data text-ink-soft">{p.date_of_birth ?? "—"}</td>
                  <td className="px-4 text-ink-soft">{p.city ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EmptyState({ hasQuery }: { hasQuery: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius)] border border-rule bg-surface text-ink-soft">
        <Search size={22} strokeWidth={1.5} />
      </div>
      <p className="text-[13px] text-ink">{hasQuery ? "No patients match that search." : "No patients yet."}</p>
      {!hasQuery && (
        <p className="max-w-xs text-[12px] text-ink-soft">Add your first patient to get started.</p>
      )}
    </div>
  );
}
