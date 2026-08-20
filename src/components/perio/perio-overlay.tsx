"use client";

import { useMemo } from "react";
import { orderTeethForTraversal } from "./perio-sequence";
import { buildArchOverlay, splitByArch, type OverlayPoint } from "./perio-overlay-geometry";
import { renderTooth } from "./tooth-display";
import type { PerioToothRecord } from "@/lib/perio-api";

export interface PerioOverlayProps {
  teeth: PerioToothRecord[];
  toothDisplay: "fdi" | "universal";
}

// Shared by PD and CAL so both plot on one visual scale (docs/specs/perio.md's "classic
// PD/CAL line-graph strip") — PD's valid range (0-15, see perio-entry validation) sits
// entirely inside it; CAL can go slightly negative (GM coronal to CEJ) or higher (real
// attachment loss), so the domain is a bit wider than PD's alone.
const DOMAIN_MIN = -5;
const DOMAIN_MAX = 20;
const COL_WIDTH = 26;
const STRIP_HEIGHT = 48;

function yFor(value: number): number {
  return STRIP_HEIGHT - ((value - DOMAIN_MIN) / (DOMAIN_MAX - DOMAIN_MIN)) * STRIP_HEIGHT;
}

// Breaks the polyline at every null (skipped/unmeasured) point instead of interpolating
// across a gap — a gap on the chart should look like missing data, not a smoothed guess.
function runsFor(points: OverlayPoint[], key: "pd" | "cal"): string[] {
  const runs: string[] = [];
  let current: string[] = [];
  points.forEach((p, i) => {
    const value = p[key];
    if (value === null) {
      if (current.length > 1) runs.push(current.join(" "));
      current = [];
      return;
    }
    const x = i * COL_WIDTH + COL_WIDTH / 2;
    const y = yFor(value);
    current.push(`${current.length === 0 ? "M" : "L"}${x},${y.toFixed(1)}`);
  });
  if (current.length > 1) runs.push(current.join(" "));
  return runs;
}

function Strip({ label, points }: { label: string; points: OverlayPoint[] }) {
  const width = Math.max(points.length * COL_WIDTH, COL_WIDTH);
  const pdRuns = runsFor(points, "pd");
  const calRuns = runsFor(points, "cal");

  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-[9px] uppercase tracking-wide text-ink-soft">{label}</span>
      <svg width={width} height={STRIP_HEIGHT} viewBox={`0 0 ${width} ${STRIP_HEIGHT}`} className="shrink-0">
        <line x1={0} y1={yFor(0)} x2={width} y2={yFor(0)} stroke="var(--rule)" strokeWidth={1} />
        {pdRuns.map((d, i) => (
          <path key={`pd-${i}`} d={d} fill="none" stroke="var(--steel)" strokeWidth={1.5} />
        ))}
        {calRuns.map((d, i) => (
          <path key={`cal-${i}`} d={d} fill="none" stroke="var(--ink)" strokeWidth={1.5} strokeDasharray="3 2" />
        ))}
        {points.map((p, i) =>
          p.pd !== null ? <circle key={`pd-dot-${p.tooth}`} cx={i * COL_WIDTH + COL_WIDTH / 2} cy={yFor(p.pd)} r={1.5} fill="var(--steel)" /> : null,
        )}
      </svg>
    </div>
  );
}

function ArchPanel({ label, teethOrder, toothDisplay }: { label: string; teethOrder: PerioToothRecord[]; toothDisplay: "fdi" | "universal" }) {
  const overlay = useMemo(() => buildArchOverlay(teethOrder), [teethOrder]);
  const width = Math.max(teethOrder.length * COL_WIDTH, COL_WIDTH);

  if (teethOrder.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <Strip label={`${label} B`} points={overlay.buccal} />
      <div className="flex items-center gap-2">
        <span className="w-12 shrink-0" />
        <div className="flex shrink-0 font-data text-[9px] text-ink-soft" style={{ width }}>
          {teethOrder.map((t) => (
            <span key={t.tooth} className="text-center" style={{ width: COL_WIDTH }}>
              {renderTooth(t.tooth, toothDisplay)}
            </span>
          ))}
        </div>
      </div>
      <Strip label={`${label} L`} points={overlay.lingual} />
    </div>
  );
}

/**
 * Read-only PD/CAL line-graph strip (docs/specs/perio.md's "Graphical overlay") —
 * refreshes from whatever the parent last fetched (saved state), never the in-progress
 * keystroke draft. Scoped down from a full 6-site periochart to one averaged line per
 * surface (buccal, lingual) per tooth — see perio-overlay-geometry.ts's header comment.
 */
export function PerioOverlay({ teeth, toothDisplay }: PerioOverlayProps) {
  const ordered = useMemo(() => orderTeethForTraversal(teeth, null), [teeth]);
  const { upper, lower } = useMemo(() => splitByArch(ordered), [ordered]);

  if (upper.length === 0 && lower.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 overflow-x-auto rounded-DEFAULT border border-rule p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-ink-soft">Periochart overlay</h3>
        <div className="flex items-center gap-3 text-[10px] text-ink-soft">
          <span className="flex items-center gap-1">
            <svg width="14" height="4" aria-hidden="true">
              <line x1="0" y1="2" x2="14" y2="2" stroke="var(--steel)" strokeWidth="2" />
            </svg>
            PD
          </span>
          <span className="flex items-center gap-1">
            <svg width="14" height="4" aria-hidden="true">
              <line x1="0" y1="2" x2="14" y2="2" stroke="var(--ink)" strokeWidth="2" strokeDasharray="3 2" />
            </svg>
            CAL
          </span>
        </div>
      </div>
      <ArchPanel label="Upper" teethOrder={upper} toothDisplay={toothDisplay} />
      <ArchPanel label="Lower" teethOrder={lower} toothDisplay={toothDisplay} />
    </div>
  );
}
