"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";

/**
 * Shared spreadsheet-shaped grid for the treatment catalog and fee schedule editors —
 * "Same grid, price column, effective dates" per docs/specs/ui-design.md. Editable
 * columns render as always-live inputs (not click-to-edit) so native Tab order and the
 * arrow-key handling below both work without a separate edit-mode state machine.
 *
 * No confirm dialogs for the reversible edits themselves (per ui-design.md's interaction
 * rules) — edits commit to local state immediately and only leave the grid on "Save
 * changes", which the caller controls.
 */
export interface GridColumn<Row> {
  key: string;
  header: string;
  align?: "left" | "right";
  data?: boolean;
  widthClass?: string;
  editable?: {
    type: "text" | "select" | "checkbox";
    options?: { value: string; label: string }[];
  };
  getValue: (row: Row) => string;
}

export function EditableGrid<Row>({
  rows,
  getRowId,
  columns,
  onSave,
  savingLabel = "Saving…",
}: {
  rows: Row[];
  getRowId: (row: Row) => string;
  columns: GridColumn<Row>[];
  onSave: (edits: Record<string, Record<string, string>>) => Promise<void>;
  savingLabel?: string;
}) {
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; message: string } | null>(null);
  const cellRefs = useRef<Map<string, HTMLInputElement | HTMLSelectElement>>(new Map());

  const editableColumnKeys = useMemo(() => columns.filter((c) => c.editable).map((c) => c.key), [columns]);
  const dirtyCount = Object.keys(edits).length;

  function cellValue(row: Row, col: GridColumn<Row>): string {
    const rowId = getRowId(row);
    return edits[rowId]?.[col.key] ?? col.getValue(row);
  }

  function setCellValue(row: Row, col: GridColumn<Row>, value: string) {
    const rowId = getRowId(row);
    const original = col.getValue(row);
    setEdits((prev) => {
      const rowEdits = { ...(prev[rowId] ?? {}) };
      if (value === original) {
        delete rowEdits[col.key];
      } else {
        rowEdits[col.key] = value;
      }
      const next = { ...prev };
      if (Object.keys(rowEdits).length === 0) {
        delete next[rowId];
      } else {
        next[rowId] = rowEdits;
      }
      return next;
    });
  }

  function focusCell(rowIdx: number, colKey: string) {
    const row = rows[rowIdx];
    if (!row) return;
    const el = cellRefs.current.get(`${getRowId(row)}:${colKey}`);
    el?.focus();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement | HTMLSelectElement>, rowIdx: number, colKey: string) {
    const colIdx = editableColumnKeys.indexOf(colKey);
    const input = e.currentTarget as HTMLInputElement;
    const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
    const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusCell(rowIdx + 1, colKey);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusCell(rowIdx - 1, colKey);
    } else if (e.key === "Enter") {
      e.preventDefault();
      focusCell(rowIdx + 1, colKey);
    } else if (e.key === "Escape") {
      const row = rows[rowIdx];
      const col = columns.find((c) => c.key === colKey);
      if (row && col) setCellValue(row, col, col.getValue(row));
      input.blur();
    } else if (e.key === "ArrowLeft" && atStart && colIdx > 0) {
      e.preventDefault();
      focusCell(rowIdx, editableColumnKeys[colIdx - 1]);
    } else if (e.key === "ArrowRight" && atEnd && colIdx < editableColumnKeys.length - 1) {
      e.preventDefault();
      focusCell(rowIdx, editableColumnKeys[colIdx + 1]);
    }
  }

  async function handleSave() {
    setSaving(true);
    setStatus(null);
    try {
      await onSave(edits);
      setEdits({});
      setStatus({ kind: "ok", message: "Saved." });
    } catch {
      setStatus({ kind: "error", message: "Couldn't save — try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 border-b border-rule bg-paper text-left font-condensed text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-4 py-2 font-medium ${col.align === "right" ? "text-right" : "text-left"} ${col.widthClass ?? ""}`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => {
              const rowId = getRowId(row);
              const rowDirty = Boolean(edits[rowId]);
              return (
                <tr key={rowId} className={`border-b border-rule last:border-b-0 ${rowDirty ? "bg-steel-lo/40" : ""}`}>
                  {columns.map((col) => (
                    <td key={col.key} className={`h-[28px] px-4 ${col.data ? "font-data" : ""} ${col.align === "right" ? "text-right" : ""}`}>
                      {col.editable ? (
                        col.editable.type === "checkbox" ? (
                          <input
                            ref={(el) => {
                              if (el) cellRefs.current.set(`${rowId}:${col.key}`, el);
                            }}
                            type="checkbox"
                            checked={cellValue(row, col) === "true"}
                            onChange={(e) => setCellValue(row, col, String(e.target.checked))}
                            onKeyDown={(e) => handleKeyDown(e, rowIdx, col.key)}
                            className="h-4 w-4 accent-[var(--steel)]"
                          />
                        ) : col.editable.type === "select" ? (
                          <select
                            ref={(el) => {
                              if (el) cellRefs.current.set(`${rowId}:${col.key}`, el);
                            }}
                            value={cellValue(row, col)}
                            onChange={(e) => setCellValue(row, col, e.target.value)}
                            onKeyDown={(e) => handleKeyDown(e, rowIdx, col.key)}
                            className="h-[26px] w-full rounded-[var(--radius)] border border-transparent bg-transparent text-[13px] text-ink outline-none hover:border-rule focus-visible:border-steel"
                          >
                            {col.editable.options?.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            ref={(el) => {
                              if (el) cellRefs.current.set(`${rowId}:${col.key}`, el);
                            }}
                            value={cellValue(row, col)}
                            onChange={(e) => setCellValue(row, col, e.target.value)}
                            onKeyDown={(e) => handleKeyDown(e, rowIdx, col.key)}
                            className={`h-[26px] w-full rounded-[var(--radius)] border border-transparent bg-transparent text-[13px] text-ink outline-none hover:border-rule focus-visible:border-steel ${col.data ? "font-data" : ""} ${col.align === "right" ? "text-right" : ""}`}
                          />
                        )
                      ) : (
                        <span className="text-ink-soft">{col.getValue(row)}</span>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-none items-center justify-end gap-3 border-t border-rule bg-surface px-4 py-2.5">
        {status && (
          <span className={`text-[12px] ${status.kind === "error" ? "text-bleed" : "text-ink-soft"}`}>{status.message}</span>
        )}
        {dirtyCount > 0 && !status && <span className="text-[12px] text-ink-soft">{dirtyCount} unsaved</span>}
        <button
          type="button"
          onClick={handleSave}
          disabled={dirtyCount === 0 || saving}
          className="h-9 rounded-[var(--radius)] bg-steel px-4 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {saving ? savingLabel : "Save changes"}
        </button>
      </div>
    </div>
  );
}
