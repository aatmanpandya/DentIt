"use client";

import { useState } from "react";
import clsx from "clsx";
import { useQuery } from "@tanstack/react-query";
import { SidePanel } from "@/components/ui/side-panel";
import { listPerioExamEvents, type PerioChange, type PerioExamEvent } from "@/lib/perio-api";

/**
 * Review and approve (docs/specs/perio-approval.md): the exam's transcript in the order it was
 * made — every dictated phrase with what Chrome heard and the cells it changed, refused and
 * undone phrases included, every typed edit, and every approval and reopening. A dentist or
 * hygienist approves from here; until then the exam is a draft, not the permanent record.
 */

const FIELD_LABEL: Record<PerioChange["field"], string> = {
  pocket_depth: "depth",
  recession: "recession",
  bleeding: "bleeding",
  suppuration: "suppuration",
  plaque: "plaque",
  mobility: "mobility",
  furcation: "furcation",
  skipped: "skipped",
};

function value(v: number | boolean | null): string {
  if (v === null) return "—";
  if (v === true) return "yes";
  if (v === false) return "no";
  return String(v);
}

/** "18 DB depth — → 3" — tooth, site, field, old to new. */
function changeLine(c: PerioChange, renderTooth: (t: string) => string): string {
  return `${renderTooth(c.tooth)}${c.site ? ` ${c.site}` : ""} ${FIELD_LABEL[c.field]} ${value(c.from)} → ${value(c.to)}`;
}

// In the clinic's timezone, like every other date in the app — not the browser's.
function time(iso: string, timeZone: string | undefined): string {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone });
}

function EventRow({ e, renderTooth, timeZone }: { e: PerioExamEvent; renderTooth: (t: string) => string; timeZone: string | undefined }) {
  const tone =
    e.kind === "approved" ? "text-healthy" : e.kind === "reopened" ? "text-caution" : e.outcome === "refused" ? "text-bleed" : e.outcome === "undo" || e.outcome === "waiting" ? "text-caution" : "text-ink";
  const label =
    e.kind === "typed"
      ? "Typed"
      : e.kind === "approved"
        ? "Approved"
        : e.kind === "reopened"
          ? "Reopened"
          : e.outcome === "written"
            ? "Dictated"
            : e.outcome === "refused"
              ? "Refused — nothing written"
              : e.outcome === "waiting"
                ? "Waiting for the rest"
                : "Undo";
  return (
    <li className="flex flex-col gap-0.5 border-b border-rule py-2 last:border-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className={clsx("text-[12px] font-medium", tone)}>{label}</span>
        <span className="font-data text-[11px] text-ink-soft">
          {time(e.at, timeZone)}
          {e.by ? ` · ${e.by}` : ""}
        </span>
      </div>
      {e.kind === "phrase" && e.heard && e.heard.length > 0 && (
        <p className="font-data text-[12px] text-ink">
          heard “{e.used ?? e.heard[0]}”
          {e.used && e.used !== e.heard[0] ? <span className="text-ink-soft"> (Chrome’s first guess “{e.heard[0]}”)</span> : null}
        </p>
      )}
      {e.note && <p className="text-[12px] text-ink-soft">{e.note}</p>}
      {e.changes.length > 0 && <p className="font-data text-[11.5px] leading-relaxed text-ink-soft">{e.changes.map((c) => changeLine(c, renderTooth)).join(" · ")}</p>}
    </li>
  );
}

export function PerioReviewPanel({
  open,
  onClose,
  examId,
  approved,
  approvedLine,
  canApprove,
  onApprove,
  approving,
  onReopen,
  reopening,
  error,
  renderTooth,
  timeZone,
}: {
  open: boolean;
  onClose: () => void;
  examId: string;
  approved: boolean;
  approvedLine: string | null;
  canApprove: boolean;
  onApprove: () => void;
  approving: boolean;
  onReopen: (reason: string) => void;
  reopening: boolean;
  error: string | null;
  renderTooth: (t: string) => string;
  timeZone: string | undefined;
}) {
  const [reason, setReason] = useState("");
  const { data, isLoading } = useQuery({ queryKey: ["perio-events", examId], queryFn: () => listPerioExamEvents(examId), enabled: open });
  const events = data?.data ?? [];
  const phrases = events.filter((e) => e.kind === "phrase");
  const count = (o: PerioExamEvent["outcome"]) => phrases.filter((e) => e.outcome === o).length;
  const typed = events.filter((e) => e.kind === "typed").length;

  return (
    <SidePanel open={open} onClose={onClose} title={approved ? "Exam transcript" : "Review and approve"}>
      <div className="flex flex-col gap-3">
        {approvedLine && <p className="rounded-[var(--radius)] bg-healthy/10 px-3 py-2 text-[12px] text-healthy">{approvedLine}</p>}
        {!approved && (
          <p className="text-[12px] text-ink-soft">
            Check how every value got onto the chart. Approving locks the exam and makes it the permanent record.
          </p>
        )}
        <p className="font-data text-[12px] text-ink">
          {count("written")} dictated · {typed} typed · {count("refused")} refused · {count("undo")} undone
        </p>

        {isLoading ? (
          <p className="text-[12px] text-ink-soft">Loading the transcript…</p>
        ) : events.length === 0 ? (
          <p className="text-[12px] text-ink-soft">Nothing recorded yet.</p>
        ) : (
          <ol className="flex max-h-[55vh] flex-col overflow-auto rounded-[var(--radius)] border border-rule bg-surface px-3">
            {events.map((e) => (
              <EventRow key={e.id} e={e} renderTooth={renderTooth} timeZone={timeZone} />
            ))}
          </ol>
        )}

        {error && <p className="text-[12px] text-bleed">{error}</p>}

        {!approved &&
          (canApprove ? (
            <button
              type="button"
              onClick={onApprove}
              disabled={approving}
              className="h-9 rounded-[var(--radius)] bg-steel px-4 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {approving ? "Approving…" : "Approve exam"}
            </button>
          ) : (
            <p className="text-[12px] text-ink-soft">Only a dentist or hygienist can approve a perio exam.</p>
          ))}

        {approved && canApprove && (
          <form
            className="flex flex-col gap-1.5 border-t border-rule pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (reason.trim().length >= 3) onReopen(reason.trim());
            }}
          >
            <label htmlFor="perio-reopen-reason" className="text-[12px] text-ink-soft">
              Reopen for a correction — the reason goes in the transcript, and the exam needs approving again.
            </label>
            <input
              id="perio-reopen-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason, e.g. wrong depth on 16 MB"
              className="h-8 rounded-[var(--radius)] border border-rule bg-surface px-2 text-[13px]"
            />
            <button
              type="submit"
              disabled={reason.trim().length < 3 || reopening}
              className="h-8 self-start rounded-[var(--radius)] border border-rule px-3 text-[12px] font-medium text-ink hover:bg-steel-lo disabled:opacity-50"
            >
              Reopen exam
            </button>
          </form>
        )}
      </div>
    </SidePanel>
  );
}
