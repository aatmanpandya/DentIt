/**
 * odontogram-teeth.ts — tooth silhouette geometry, FDI numbering, permanent + deciduous.
 *
 * Pure geometry: no React, no DOM, no assets. Every outline is generated from a ring of
 * control points (crown profile, cervical waist, root rails, apices) threaded with a
 * closed Catmull-Rom spline and emitted as cubic Bezier, so proportions are tunable data
 * rather than fixed artwork.
 *
 *   const t = toothGeometry(16);
 *   <svg viewBox={t.viewBox}><g transform={t.transform}><path d={t.d} /></g></svg>
 */

export type Arch = 'upper' | 'lower';
export type Side = 'left' | 'right';           // the patient's side, not the viewer's
export type Dentition = 'permanent' | 'primary';
export type SurfaceCode = 'B' | 'L' | 'M' | 'D' | 'O' | 'I';

export interface ToothGeometry {
  fdi: number;
  quadrant: number;
  index: number;                 // 1..8 permanent, 1..5 deciduous
  type: string;                  // key into SPEC
  name: string;
  arch: Arch;
  side: Side;
  dentition: Dentition;
  rootCount: number;
  crownWidth: number;
  neckWidth: number;
  crownHeight: number;
  rootLength: number;
  d: string;                     // closed outline, cubic Bezier
  cej: string;                   // cervical (enamel-cementum) line
  cervicalY: number;
  controlPoints: Array<{ x: number; y: number }>;
  cage: string;                  // the control ring as an SVG points list
  viewBox: string;
  transform: string;             // mirror + arch flip, already composed
}

export interface ToothSpec {
  cw: number;   // crown width
  nw: number;   // cervical (neck) width
  ch: number;   // crown height
  rl: number;   // root length
  occ: keyof typeof OCC;
  n?: number;       // root count
  furc?: number;    // furcation depth
  spread?: number;  // apex spread across the neck
  bow?: number;     // single-root curvature
  boxy?: 0 | 1;     // posterior flanks (near-vertical) vs anterior (fuller, tapering)
  name: string;
}

export const FDI_UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
export const FDI_LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
export const FDI_UPPER_PRIMARY = [55, 54, 53, 52, 51, 61, 62, 63, 64, 65];
export const FDI_LOWER_PRIMARY = [85, 84, 83, 82, 81, 71, 72, 73, 74, 75];

/** Shared drawing box: cervical line at y = cervical, x centred on 0, crowns +y, roots -y. */
export const BOX = { width: 132, height: 268, cervical: 154, viewBox: '0 0 132 268' } as const;

/* occlusal / incisal profiles, mesial (toward the midline) on the LEFT.
   [ x as a fraction of crown width, height above the occlusal plane, roundTip ] */
const OCC = {
  INC: [[-0.46, 3, 1], [-0.20, 0, 0], [0.16, 1, 0], [0.44, 10, 1]],
  CAN: [[-0.45, 26, 1], [-0.14, 4, 0], [0.00, 0, 1], [0.30, 13, 0], [0.46, 29, 1]],
  PM: [[-0.46, 22, 1], [-0.22, 2, 0], [0.06, 0, 1], [0.30, 8, 0], [0.46, 24, 1]],
  M2: [[-0.48, 14, 1], [-0.28, 0, 1], [-0.02, 17, 1], [0.26, 2, 1], [0.48, 16, 1]],
  M3: [[-0.50, 13, 1], [-0.34, 0, 1], [-0.17, 15, 1], [0.00, 1, 1], [0.18, 15, 1], [0.34, 2, 1], [0.50, 14, 1]]
} as const;

/** Change a number here and every affected outline regenerates. */
export const SPEC: Record<string, ToothSpec> = {
  U1: { cw: 74, nw: 52, ch: 100, rl: 128, occ: 'INC', n: 1, bow: 3, name: 'central incisor' },
  U2: { cw: 58, nw: 42, ch: 88, rl: 122, occ: 'INC', n: 1, bow: 4, name: 'lateral incisor' },
  U3: { cw: 64, nw: 46, ch: 100, rl: 146, occ: 'CAN', n: 1, bow: 4, name: 'canine' },
  U4: { boxy: 1, cw: 68, nw: 50, ch: 82, rl: 128, occ: 'PM', n: 2, furc: 44, spread: 0.50, name: 'first premolar' },
  U5: { boxy: 1, cw: 68, nw: 52, ch: 80, rl: 130, occ: 'PM', n: 1, bow: 3, name: 'second premolar' },
  U6: { boxy: 1, cw: 100, nw: 74, ch: 76, rl: 122, occ: 'M2', n: 3, furc: 36, spread: 0.66, name: 'first molar' },
  U7: { boxy: 1, cw: 94, nw: 72, ch: 74, rl: 116, occ: 'M2', n: 3, furc: 32, spread: 0.62, name: 'second molar' },
  U8: { boxy: 1, cw: 84, nw: 64, ch: 70, rl: 94, occ: 'M2', n: 2, furc: 26, spread: 0.50, name: 'third molar' },
  L1: { cw: 46, nw: 36, ch: 80, rl: 122, occ: 'INC', n: 1, bow: 2, name: 'central incisor' },
  L2: { cw: 52, nw: 38, ch: 86, rl: 128, occ: 'INC', n: 1, bow: 3, name: 'lateral incisor' },
  L3: { cw: 58, nw: 44, ch: 96, rl: 144, occ: 'CAN', n: 1, bow: 4, name: 'canine' },
  L4: { boxy: 1, cw: 60, nw: 46, ch: 78, rl: 126, occ: 'PM', n: 1, bow: 3, name: 'first premolar' },
  L5: { boxy: 1, cw: 66, nw: 50, ch: 78, rl: 128, occ: 'PM', n: 1, bow: 3, name: 'second premolar' },
  L6: { boxy: 1, cw: 104, nw: 76, ch: 74, rl: 120, occ: 'M3', n: 2, furc: 40, spread: 0.62, name: 'first molar' },
  L7: { boxy: 1, cw: 98, nw: 74, ch: 72, rl: 114, occ: 'M2', n: 2, furc: 36, spread: 0.60, name: 'second molar' },
  L8: { boxy: 1, cw: 88, nw: 68, ch: 68, rl: 92, occ: 'M2', n: 2, furc: 28, spread: 0.52, name: 'third molar' },

  /* deciduous — smaller, fuller crowns on flared roots */
  DU1: { cw: 44, nw: 32, ch: 60, rl: 78, occ: 'INC', n: 1, bow: 2, name: 'primary central incisor' },
  DU2: { cw: 36, nw: 26, ch: 54, rl: 74, occ: 'INC', n: 1, bow: 3, name: 'primary lateral incisor' },
  DU3: { cw: 40, nw: 28, ch: 60, rl: 90, occ: 'CAN', n: 1, bow: 3, name: 'primary canine' },
  DU4: { boxy: 1, cw: 58, nw: 42, ch: 50, rl: 84, occ: 'M2', n: 3, furc: 30, spread: 0.86, name: 'primary first molar' },
  DU5: { boxy: 1, cw: 72, nw: 52, ch: 54, rl: 88, occ: 'M2', n: 3, furc: 34, spread: 0.90, name: 'primary second molar' },
  DL1: { cw: 34, nw: 25, ch: 50, rl: 72, occ: 'INC', n: 1, bow: 2, name: 'primary central incisor' },
  DL2: { cw: 38, nw: 27, ch: 54, rl: 76, occ: 'INC', n: 1, bow: 2, name: 'primary lateral incisor' },
  DL3: { cw: 40, nw: 29, ch: 58, rl: 88, occ: 'CAN', n: 1, bow: 3, name: 'primary canine' },
  DL4: { boxy: 1, cw: 58, nw: 42, ch: 48, rl: 82, occ: 'M2', n: 2, furc: 32, spread: 0.94, name: 'primary first molar' },
  DL5: { boxy: 1, cw: 74, nw: 54, ch: 52, rl: 86, occ: 'M3', n: 2, furc: 36, spread: 0.96, name: 'primary second molar' }
};

type Pt = [number, number] | [number, number, number];

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Catmull-Rom through `points`, emitted as cubic Bezier. */
export function catmullRomPath(points: Array<[number, number]>, closed: boolean): string {
  const n = points.length;
  if (n < 2) return '';
  const at = (i: number) => (closed ? points[(i + n) % n] : points[Math.max(0, Math.min(n - 1, i))]);
  let d = `M ${r2(points[0][0])} ${r2(points[0][1])}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${r2(c1[0])} ${r2(c1[1])}, ${r2(c2[0])} ${r2(c2[1])}, ${r2(p2[0])} ${r2(p2[1])}`;
  }
  return closed ? d + ' Z' : d;
}

interface Rail { b0: number; b1: number; ax: number; ay: number; w: number; bow: number }

function rootRails(p: ToothSpec, cervY: number): Rail[] {
  const half = p.nw / 2, n = p.n ?? 1, spread = p.spread ?? 0.55, bow = p.bow ?? 0;
  const out: Rail[] = [];
  for (let j = 0; j < n; j++) {
    const t = n === 1 ? 0.5 : j / (n - 1);
    const b0 = -half + p.nw * (j / n), b1 = -half + p.nw * ((j + 1) / n);
    const ax = n === 1 ? bow * 1.2 : (t - 0.5) * p.nw * spread;
    const lenK = n === 3 && j === 1 ? 0.86 : n > 1 ? 0.94 : 1;   // palatal root sits back
    const w = n === 1 ? Math.max(12, p.nw * 0.3) : Math.max(9, (b1 - b0) * 0.42);
    out.push({ b0, b1, ax, ay: cervY - p.rl * lenK, w, bow });
  }
  return out;
}

/** The control-point ring for one tooth type, in the shared drawing box. */
export function controlRing(key: string): Array<[number, number]> {
  const p = SPEC[key];
  if (!p) throw new Error('unknown tooth type ' + key);
  const cervY = BOX.cervical, ch = p.ch, occY = cervY + ch;
  const raw: Pt[] = [];
  const R = 3.2;
  // `round` brackets a tip with shoulder points so the spline curves round it instead of cornering
  const add = (x: number, y: number, round?: number) => {
    if (!round) { raw.push([x, y]); return; }
    const prev = raw[raw.length - 1];
    if (prev) {
      const dx = x - prev[0], dy = y - prev[1], L = Math.hypot(dx, dy) || 1;
      const k = Math.min(R, L * 0.34);
      raw.push([x - (dx / L) * k, y - (dy / L) * k]);
    }
    raw.push([x, y]);
    raw.push([x, y, R]);      // resolved once the following point is known
  };
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  // 1 — roots, mesial to distal, along the cervical rail
  const rs = rootRails(p, cervY);
  rs.forEach((r, j) => {
    if (j === 0) add(r.b0, cervY);
    add(lerp(r.b0, r.ax - r.w / 2, 0.55) + r.bow * 0.4, lerp(cervY, r.ay, 0.52));
    add(r.ax - r.w / 2, r.ay + r.w * 1.5);
    add(r.ax, r.ay, 1);                                            // apex
    add(r.ax + r.w / 2, r.ay + r.w * 1.5);
    add(lerp(r.b1, r.ax + r.w / 2, 0.55) + r.bow * 0.4, lerp(cervY, r.ay, 0.52));
    if (j < rs.length - 1) add(r.b1, cervY - (p.furc ?? 30) * 0.9);  // furcation notch
    else add(r.b1, cervY);
  });

  // 2 — distal crown flank. Stops one point short of cw/2 (doesn't reach all the
  // way to the flank's own outer edge) and hands off directly into the occlusal
  // profile's first point instead — that profile point is always a bit narrower
  // than cw/2 (0.44-0.50 of it), so a flank point landing exactly on cw/2 would
  // sit just outside it, forcing a short, sharply-angled segment sandwiched
  // between two much longer ones. On profiles with a big height jump at that seam
  // (CAN's tall, asymmetric shoulders especially), the closed Catmull-Rom spline
  // overshoots that mismatch into a visible self-intersecting spike.
  if (p.boxy) { add(p.cw / 2 * 0.97, cervY + ch * 0.19, 1); }
  else {
    add(p.nw / 2 + (p.cw - p.nw) / 2 * 0.72, cervY + ch * 0.22);
    add(p.cw / 2 * 0.99, occY - ch * 0.42);
  }

  // 3 — occlusal / incisal edge, distal to mesial
  const prof = OCC[p.occ] as ReadonlyArray<readonly number[]>;
  for (let i = prof.length - 1; i >= 0; i--) add(prof[i][0] * p.cw, occY - prof[i][1], prof[i][2]);

  // 4 — mesial crown flank (mirror of the distal flank above — same seam fix)
  if (p.boxy) { add(-p.cw / 2 * 0.97, cervY + ch * 0.19, 1); }
  else {
    add(-p.cw / 2 * 0.99, occY - ch * 0.42);
    add(-(p.nw / 2 + (p.cw - p.nw) / 2 * 0.72), cervY + ch * 0.22);
  }

  // resolve the flagged tip shoulders, then drop coincident points
  const ring: Array<[number, number]> = [];
  for (let i = 0; i < raw.length; i++) {
    const q = raw[i];
    if (q.length === 3) {
      const nx = raw[(i + 1) % raw.length];
      const dx = nx[0] - q[0], dy = nx[1] - q[1], L = Math.hypot(dx, dy) || 1;
      const k = Math.min(q[2] as number, L * 0.34);
      ring.push([q[0] + (dx / L) * k, q[1] + (dy / L) * k]);
    } else ring.push([q[0], q[1]]);
  }
  return ring.filter((q, i) => {
    const prev = ring[(i - 1 + ring.length) % ring.length];
    return Math.hypot(q[0] - prev[0], q[1] - prev[1]) > 0.35;
  });
}

/** Everything needed to render one tooth by FDI number (11-48 permanent, 51-85 deciduous). */
export function toothGeometry(fdi: number | string): ToothGeometry {
  const n = Number(fdi), q = Math.floor(n / 10), i = n % 10;
  const primary = q >= 5 && q <= 8;
  if (q < 1 || q > 8 || i < 1 || i > (primary ? 5 : 8)) throw new Error('not an FDI tooth: ' + fdi);
  const arch: Arch = q === 1 || q === 2 || q === 5 || q === 6 ? 'upper' : 'lower';
  const side: Side = q === 1 || q === 4 || q === 5 || q === 8 ? 'right' : 'left';
  const key = (primary ? 'D' : '') + (arch === 'upper' ? 'U' : 'L') + i;
  const p = SPEC[key];
  const ring = controlRing(key);
  const sx = side === 'right' ? -1 : 1, sy = arch === 'upper' ? 1 : -1;
  const cervY = BOX.cervical;
  return {
    fdi: n, quadrant: q, index: i, type: key, name: p.name, arch, side,
    dentition: primary ? 'primary' : 'permanent',
    rootCount: p.n ?? 1,
    crownWidth: p.cw, neckWidth: p.nw, crownHeight: p.ch, rootLength: p.rl,
    d: catmullRomPath(ring, true),
    cej: `M ${-p.nw / 2} ${cervY} Q 0 ${cervY + 7} ${p.nw / 2} ${cervY}`,
    cervicalY: cervY,
    controlPoints: ring.map(pt => ({ x: r2(pt[0]), y: r2(pt[1]) })),
    cage: ring.concat([ring[0]]).map(pt => `${r2(pt[0])},${r2(pt[1])}`).join(' '),
    viewBox: BOX.viewBox,
    transform: `translate(${BOX.width / 2},0) scale(${sx},${sy})` + (sy < 0 ? ` translate(0,${-2 * cervY})` : '')
  };
}

export const ALL_TEETH = FDI_UPPER.concat(FDI_LOWER).map(toothGeometry);
export const ALL_PRIMARY_TEETH = FDI_UPPER_PRIMARY.concat(FDI_LOWER_PRIMARY).map(toothGeometry);

/** fdi -> path string, if you only want static SVG. */
export const TOOTH_PATHS: Record<number, string> =
  ALL_TEETH.concat(ALL_PRIMARY_TEETH).reduce((a, t) => { a[t.fdi] = t.d; return a; }, {} as Record<number, string>);

/** Incisors and canines have an incisal edge, not an occlusal table. */
export const isAnterior = (fdi: number | string) => Number(fdi) % 10 <= 3;

/* ---------- the five-surface wheel ---------- */
export interface Wedge { code: SurfaceCode; label: string; d: string | null; r?: number }

const sector = (a0: number, a1: number, r1: number, rr: number) => {
  const P = (a: number, r: number): [number, number] =>
    [r2(r * Math.cos((a * Math.PI) / 180)), r2(r * Math.sin((a * Math.PI) / 180))];
  const [x1, y1] = P(a0, rr), [x2, y2] = P(a1, rr), [x3, y3] = P(a1, r1), [x4, y4] = P(a0, r1);
  return `M${x1} ${y1} A${rr} ${rr} 0 0 1 ${x2} ${y2} L${x3} ${y3} A${r1} ${r1} 0 0 0 ${x4} ${y4} Z`;
};

/** Buccal, lingual, mesial, distal + the centre (occlusal on posteriors, incisal on anteriors).
 *  Mesial follows the midline, so pass the tooth's `side`. Draw in a -18 -18 36 36 viewBox. */
export function surfaceWedges(opts: { side?: Side; anterior?: boolean; outer?: number; inner?: number } = {}): Wedge[] {
  const outer = opts.outer ?? 15, inner = opts.inner ?? 6.2;
  const mesialRight = (opts.side ?? 'left') === 'right';
  const anterior = !!opts.anterior;
  return [
    { code: 'B', label: 'buccal', d: sector(-135, -45, inner, outer) },
    { code: 'L', label: 'lingual', d: sector(45, 135, inner, outer) },
    { code: 'M', label: 'mesial', d: sector(mesialRight ? -45 : 135, mesialRight ? 45 : 225, inner, outer) },
    { code: 'D', label: 'distal', d: sector(mesialRight ? 135 : -45, mesialRight ? 225 : 45, inner, outer) },
    { code: anterior ? 'I' : 'O', label: anterior ? 'incisal' : 'occlusal', d: null, r: inner }
  ];
}

export const SURFACE_NAMES: Record<SurfaceCode, string> = {
  B: 'buccal', L: 'lingual', M: 'mesial', D: 'distal', O: 'occlusal', I: 'incisal'
};

/* ---------- arch layout (occlusal plan) ---------- */
export interface ArchNode {
  fdi: number; x: number; y: number;
  handle: { x1: number; y1: number; x2: number; y2: number };
  label: { x: number; y: number };
}

/** Node positions for one arch on a single spline, plus the tangent handles. */
export function archLayout(
  arch: Arch,
  opts: { rx?: number; ry?: number; span?: number; labelOffset?: number; primary?: boolean } = {}
): { spline: string; cage: string; nodes: ArchNode[] } {
  const rx = opts.rx ?? 430, ry = opts.ry ?? 208, span = opts.span ?? 1.3, off = opts.labelOffset ?? 26;
  const up = arch === 'upper';
  const order = up
    ? (opts.primary ? FDI_UPPER_PRIMARY : FDI_UPPER)
    : (opts.primary ? FDI_LOWER_PRIMARY : FDI_LOWER);
  const P: Array<[number, number]> = order.map((_, i) => {
    const half = (order.length - 1) / 2;
    const a = ((i - half) / half) * span;
    const y = ry * (1 - Math.cos(a));
    return [rx * Math.sin(a), up ? y : -y];
  });
  const nodes: ArchNode[] = P.map((q, i) => {
    const prev = P[Math.max(0, i - 1)], next = P[Math.min(P.length - 1, i + 1)];
    const dx = (next[0] - prev[0]) / 5.2, dy = (next[1] - prev[1]) / 5.2;
    const L = Math.hypot(q[0], q[1]) || 1;
    return {
      fdi: order[i], x: r2(q[0]), y: r2(q[1]),
      handle: { x1: r2(q[0] - dx), y1: r2(q[1] - dy), x2: r2(q[0] + dx), y2: r2(q[1] + dy) },
      label: { x: r2(q[0] + (q[0] / L) * off * 1.15), y: r2(q[1] + (up ? -1 : 1) * off * 0.62 + (q[1] / L) * off * 0.3) }
    };
  });
  return { spline: catmullRomPath(P, false), cage: P.map(q => `${r2(q[0])},${r2(q[1])}`).join(' '), nodes };
}
