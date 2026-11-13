/**
 * The voice probing route (docs/specs/voice-perio.md, "Route"): one side of a tooth at a time,
 * three sites per side in the direction the probe travels. Pure, no React.
 *
 * Moving along a sweep, a tooth in the sweep's starting quadrant is approached from behind, so
 * its distal site comes first (18→11 on the outside: DB, B, MB); past the midline it's mesial
 * first (21→28: MB, B, DB). Both routes start every sweep at one end of an arch, so that one rule
 * covers them.
 */
import { socketForFdi } from "@/components/chart/tooth-grid";
import type { PerioSiteCode } from "./perio-entry";

export type Side = "outside" | "inside";
export type ProbingRoute = "outside_first" | "each_jaw";

export interface RouteStep {
  tooth: string;
  side: Side;
  sites: [PerioSiteCode, PerioSiteCode, PerioSiteCode]; // travel order
}

const range = (q: number, from: number, to: number) => {
  const out: string[] = [];
  for (let p = from; from <= to ? p <= to : p >= to; p += from <= to ? 1 : -1) out.push(`${q}${p}`);
  return out;
};
const UPPER_R_TO_L = [...range(1, 8, 1), ...range(2, 1, 8)]; // 18→28
const UPPER_L_TO_R = [...UPPER_R_TO_L].reverse(); // 28→18
const LOWER_L_TO_R = [...range(3, 8, 1), ...range(4, 1, 8)]; // 38→48
const LOWER_R_TO_L = [...LOWER_L_TO_R].reverse(); // 48→38

const SWEEPS: Record<ProbingRoute, { side: Side; positions: string[] }[]> = {
  outside_first: [
    { side: "outside", positions: UPPER_R_TO_L },
    { side: "outside", positions: LOWER_L_TO_R },
    { side: "inside", positions: LOWER_R_TO_L },
    { side: "inside", positions: UPPER_L_TO_R },
  ],
  each_jaw: [
    { side: "outside", positions: UPPER_R_TO_L },
    { side: "inside", positions: UPPER_L_TO_R },
    { side: "inside", positions: LOWER_R_TO_L },
    { side: "outside", positions: LOWER_L_TO_R },
  ],
};

const SITE_CODES: Record<Side, { mesial: PerioSiteCode; mid: PerioSiteCode; distal: PerioSiteCode }> = {
  outside: { mesial: "MB", mid: "B", distal: "DB" },
  inside: { mesial: "ML", mid: "L", distal: "DL" },
};

/**
 * The steps for an exam: `activeTeeth` are the exam's non-skipped teeth (permanent or primary;
 * a primary tooth takes its socket's place on the route).
 */
export function buildRoute(route: ProbingRoute, activeTeeth: string[]): RouteStep[] {
  const bySocket = new Map<string, string>();
  for (const t of activeTeeth) {
    const socket = socketForFdi(t);
    if (socket) bySocket.set(socket.permanentFdi, t);
  }
  const steps: RouteStep[] = [];
  for (const sweep of SWEEPS[route]) {
    const startQuadrant = sweep.positions[0][0];
    for (const pos of sweep.positions) {
      const tooth = bySocket.get(pos);
      if (!tooth) continue;
      const c = SITE_CODES[sweep.side];
      const distalFirst = pos[0] === startQuadrant;
      steps.push({ tooth, side: sweep.side, sites: distalFirst ? [c.distal, c.mid, c.mesial] : [c.mesial, c.mid, c.distal] });
    }
  }
  return steps;
}
