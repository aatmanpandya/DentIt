import type { PerioSiteDelta } from "@/lib/perio-api";

/**
 * Pure helpers for the comparison-view toggle (docs/specs/perio.md) — the grid stays the
 * dumb renderer; this decides what badge, if any, a site cell shows once compare mode is on.
 * The delta math itself (CAL delta, the >=2mm significance flag) is server-side
 * (comparePerioExam) — this only formats what's already computed.
 */

export interface DeltaBadge {
  label: string;
  significant: boolean;
}

export function buildDeltaIndex(deltas: PerioSiteDelta[]): Map<string, PerioSiteDelta> {
  return new Map(deltas.map((d) => [`${d.tooth}:${d.site}`, d]));
}

export function badgeForDelta(delta: PerioSiteDelta | undefined): DeltaBadge | null {
  if (!delta || delta.cal_now === null) return null;
  if (delta.cal_before === null) return { label: "new", significant: false };

  const value = delta.delta ?? 0;
  return { label: value > 0 ? `+${value}` : `${value}`, significant: delta.significant };
}
