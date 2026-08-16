"use client";

import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import {
  listProcedureCodes,
  createProcedureCode,
  updateProcedureCode,
  importStarterTemplate,
  PROCEDURE_CATEGORIES,
  PROCEDURE_SCOPES,
  type ProcedureCode,
} from "@/lib/catalog-api";
import { ApiError } from "@/lib/api-client";
import { EditableGrid, type GridColumn } from "@/components/catalog/editable-grid";

const CATEGORY_OPTIONS = PROCEDURE_CATEGORIES.map((c) => ({ value: c, label: c.replace(/_/g, " ") }));
const SCOPE_OPTIONS = PROCEDURE_SCOPES.map((s) => ({ value: s, label: s }));

// Treatment catalog editor — spreadsheet-shaped, inline edit, bulk save. First screen
// where the quality bar shows, per docs/specs/ui-design.md.
export default function CatalogPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["procedure-codes"],
    queryFn: () => listProcedureCodes({ limit: 200 }),
  });
  const codes = data?.data ?? [];

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  async function handleImportStarter() {
    setImporting(true);
    setImportError(null);
    try {
      await importStarterTemplate();
      await queryClient.invalidateQueries({ queryKey: ["procedure-codes"] });
    } catch (err) {
      setImportError(err instanceof ApiError ? err.message : "Couldn't import — try again.");
    } finally {
      setImporting(false);
    }
  }

  const columns: GridColumn<ProcedureCode>[] = [
    { key: "code", header: "Code", data: true, widthClass: "w-40", getValue: (r) => r.code },
    { key: "short_name", header: "Name", editable: { type: "text" }, getValue: (r) => r.short_name },
    {
      key: "category",
      header: "Category",
      widthClass: "w-40",
      editable: { type: "select", options: CATEGORY_OPTIONS },
      getValue: (r) => r.category,
    },
    {
      key: "applies_to",
      header: "Applies to",
      widthClass: "w-28",
      editable: { type: "select", options: SCOPE_OPTIONS },
      getValue: (r) => r.applies_to,
    },
    {
      key: "is_active",
      header: "Active",
      widthClass: "w-16",
      editable: { type: "checkbox" },
      getValue: (r) => String(r.is_active),
    },
  ];

  async function handleSave(edits: Record<string, Record<string, string>>) {
    await Promise.all(
      Object.entries(edits).map(([id, patch]) =>
        updateProcedureCode(id, {
          ...(patch.short_name !== undefined ? { short_name: patch.short_name } : {}),
          ...(patch.category !== undefined ? { category: patch.category as ProcedureCode["category"] } : {}),
          ...(patch.applies_to !== undefined ? { applies_to: patch.applies_to as ProcedureCode["applies_to"] } : {}),
          ...(patch.is_active !== undefined ? { is_active: patch.is_active === "true" } : {}),
        }),
      ),
    );
    await queryClient.invalidateQueries({ queryKey: ["procedure-codes"] });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-none items-center justify-between gap-3 border-b border-rule bg-surface px-4 py-3">
        <h1 className="font-condensed text-[13px] font-semibold text-ink">Treatment catalog</h1>
        <div className="flex items-center gap-2">
          {importError && <span className="text-[12px] text-bleed">{importError}</span>}
          <button
            type="button"
            onClick={handleImportStarter}
            disabled={importing}
            className="flex h-9 items-center gap-1.5 rounded-[var(--radius)] border border-rule px-3 text-[13px] text-ink hover:bg-steel-lo disabled:opacity-50"
          >
            <Download size={14} />
            {importing ? "Importing…" : "Import starter template"}
          </button>
        </div>
      </div>

      <AddProcedureForm onAdded={() => queryClient.invalidateQueries({ queryKey: ["procedure-codes"] })} />

      {isLoading ? (
        <div className="flex-1" aria-hidden />
      ) : codes.length === 0 ? (
        <EmptyState />
      ) : (
        <EditableGrid rows={codes} getRowId={(r) => r.id} columns={columns} onSave={handleSave} />
      )}
    </div>
  );
}

function AddProcedureForm({ onAdded }: { onAdded: () => void }) {
  const [code, setCode] = useState("");
  const [shortName, setShortName] = useState("");
  const [category, setCategory] = useState<ProcedureCode["category"]>("restorative");
  const [appliesTo, setAppliesTo] = useState<ProcedureCode["applies_to"]>("tooth");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await createProcedureCode({ code, short_name: shortName, category, applies_to: appliesTo });
      setCode("");
      setShortName("");
      onAdded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't add — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "h-8 rounded-[var(--radius)] border border-rule bg-paper px-2 text-[13px] text-ink outline-none placeholder:text-ink-soft focus-visible:border-steel";

  return (
    <form onSubmit={handleSubmit} className="flex flex-none flex-wrap items-center gap-2 border-b border-rule bg-paper px-4 py-2.5">
      <input
        className={`${inputClass} w-32 font-data`}
        placeholder="Code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        required
      />
      <input
        className={`${inputClass} flex-1`}
        placeholder="Procedure name"
        value={shortName}
        onChange={(e) => setShortName(e.target.value)}
        required
      />
      <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value as ProcedureCode["category"])}>
        {CATEGORY_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <select className={inputClass} value={appliesTo} onChange={(e) => setAppliesTo(e.target.value as ProcedureCode["applies_to"])}>
        {SCOPE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={submitting}
        className="h-8 rounded-[var(--radius)] bg-steel px-3 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? "Adding…" : "Add procedure"}
      </button>
      {error && <span className="text-[12px] text-bleed">{error}</span>}
    </form>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-[13px] text-ink">No procedures yet.</p>
      <p className="max-w-xs text-[12px] text-ink-soft">
        Import the starter template to avoid a blank screen, then edit it to match this clinic — or add procedures one at a time above.
      </p>
    </div>
  );
}
