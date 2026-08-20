import { socketForFdi } from "@/components/chart/tooth-grid";
import type { PerioToothRecord, PerioSiteCode } from "@/lib/perio-api";

/**
 * Pure data-series math for the read-only graphical overlay (docs/specs/perio.md) — no
 * SVG/rendering here, same split as perio-compare.ts. Scoped-down from a full 6-site
 * periochart: one averaged line per surface (buccal, lingual) per tooth, not six individual
 * site lines — real enough to eyeball the arch's shape, far less rendering complexity.
 */

export interface OverlayPoint {
  tooth: string;
  pd: number | null; // averaged pocket depth across the surface's saved sites; null = gap
  cal: number | null; // averaged CAL, same rule
}

export interface ArchOverlayData {
  buccal: OverlayPoint[];
  lingual: OverlayPoint[];
}

const BUCCAL_SITES: readonly PerioSiteCode[] = ["MB", "B", "DB"];
const LINGUAL_SITES: readonly PerioSiteCode[] = ["ML", "L", "DL"];

function average(values: number[]): number | null {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function surfacePoint(record: PerioToothRecord, sites: readonly PerioSiteCode[]): OverlayPoint {
  if (record.is_skipped) return { tooth: record.tooth, pd: null, cal: null };

  const relevant = record.sites.filter((s) => (sites as readonly string[]).includes(s.site));
  const pd = average(relevant.flatMap((s) => (s.pocket_depth !== null ? [s.pocket_depth] : [])));
  const cal = average(relevant.flatMap((s) => (s.cal !== null ? [s.cal] : [])));
  return { tooth: record.tooth, pd, cal };
}

/** Expects records already in display order (orderTeethForTraversal, one arch's worth). */
export function buildArchOverlay(orderedArchTeeth: PerioToothRecord[]): ArchOverlayData {
  return {
    buccal: orderedArchTeeth.map((t) => surfacePoint(t, BUCCAL_SITES)),
    lingual: orderedArchTeeth.map((t) => surfacePoint(t, LINGUAL_SITES)),
  };
}

export function splitByArch(orderedTeeth: PerioToothRecord[]): { upper: PerioToothRecord[]; lower: PerioToothRecord[] } {
  const upper: PerioToothRecord[] = [];
  const lower: PerioToothRecord[] = [];
  for (const t of orderedTeeth) {
    const socket = socketForFdi(t.tooth);
    // An unresolvable tooth code is dropped, not defaulted to an arch — an unrecognized
    // record silently rendered as a lower tooth would be worse than one that's simply
    // absent from the chart. Shouldn't happen via orderTeethForTraversal (it already only
    // returns socket-resolved records), but this function is exported standalone.
    if (!socket) continue;
    if (socket.row === "upper") upper.push(t);
    else lower.push(t);
  }
  return { upper, lower };
}
