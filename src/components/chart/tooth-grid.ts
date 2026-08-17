/**
 * Pure whole-mouth arch/socket geometry for the Odontogram — no DOM, no fetch,
 * deliberately independent of React so it's cheap to unit test. Mirrors the
 * "pure, DOM-free, unit-tested geometry helper" pattern in
 * src/components/schedule/time-grid.ts / date-grid.ts.
 *
 * A "socket" is a fixed anatomical position (32 of them: two rows of 16, upper then
 * lower, split at the midline) — not a tooth. Which tooth (permanent, primary, or
 * none) occupies a socket for a given patient is what resolveSocketTooth answers.
 * See docs/specs/odontogram.md's "Mixed / adult / primary dentition" section.
 */

export type Row = "upper" | "lower";
export type Direction = "left" | "right" | "up" | "down";
export type DentitionView = "mixed" | "adult" | "primary";

export interface Socket {
  index: number; // 0-31, row-major: 0-15 upper, 16-31 lower
  row: Row;
  col: number; // 0-15 within the row, left-to-right on screen
  permanentFdi: string;
  primaryFdi: string | null; // null for the 1st/2nd/3rd molar positions — no primary equivalent
}

type Quadrant = 1 | 2 | 3 | 4;
const PRIMARY_QUADRANT_FOR: Record<Quadrant, number> = { 1: 5, 2: 6, 3: 7, 4: 8 };

function permanentFdi(quadrant: Quadrant, position: number): string {
  return `${quadrant}${position}`;
}

function primaryFdi(quadrant: Quadrant, position: number): string | null {
  return position <= 5 ? `${PRIMARY_QUADRANT_FOR[quadrant]}${position}` : null;
}

/**
 * Builds one row left-to-right on screen: `outerQuadrant` positions 8→1 (the molars
 * furthest from the midline first), then `innerQuadrant` positions 1→8. This ordering
 * is what makes left/right and up/down adjacency plain column/row arithmetic below —
 * col 7/8 always straddle the midline (11|21, 41|31) and same-col cross-row always
 * lines up the arch-flip boundary (18|48, 28|38), with no special-casing needed.
 */
function buildRow(row: Row, outerQuadrant: Quadrant, innerQuadrant: Quadrant, startIndex: number): Socket[] {
  const sockets: Socket[] = [];
  let col = 0;
  for (let position = 8; position >= 1; position--) {
    sockets.push({ index: startIndex + col, row, col, permanentFdi: permanentFdi(outerQuadrant, position), primaryFdi: primaryFdi(outerQuadrant, position) });
    col++;
  }
  for (let position = 1; position <= 8; position++) {
    sockets.push({ index: startIndex + col, row, col, permanentFdi: permanentFdi(innerQuadrant, position), primaryFdi: primaryFdi(innerQuadrant, position) });
    col++;
  }
  return sockets;
}

export const SOCKETS: Socket[] = [...buildRow("upper", 1, 2, 0), ...buildRow("lower", 4, 3, 16)];

const SOCKET_BY_PERMANENT_FDI = new Map(SOCKETS.map((s) => [s.permanentFdi, s]));
const SOCKET_BY_PRIMARY_FDI = new Map(SOCKETS.filter((s) => s.primaryFdi).map((s) => [s.primaryFdi as string, s]));

export function socketForFdi(fdi: string): Socket | undefined {
  return SOCKET_BY_PERMANENT_FDI.get(fdi) ?? SOCKET_BY_PRIMARY_FDI.get(fdi);
}

/**
 * Adjacent socket in the keyboard table's direction, expressed as the destination
 * socket's permanent FDI code (the socket's stable identity) — not wraparound at
 * arch ends or row edges, per docs/specs/odontogram.md's keymap. Which tooth is
 * actually rendered/selected there (permanent, primary, or empty) is a separate
 * question — see resolveSocketTooth.
 */
export function adjacentTooth(currentFdi: string, direction: Direction): string | null {
  const socket = socketForFdi(currentFdi);
  if (!socket) return null;

  let targetIndex: number | null = null;
  if (direction === "left") targetIndex = socket.col > 0 ? socket.index - 1 : null;
  else if (direction === "right") targetIndex = socket.col < 15 ? socket.index + 1 : null;
  else if (direction === "up") targetIndex = socket.row === "lower" ? socket.index - 16 : null;
  else if (direction === "down") targetIndex = socket.row === "upper" ? socket.index + 16 : null;

  if (targetIndex === null) return null;
  return SOCKETS[targetIndex].permanentFdi;
}

export interface ToothPresenceFlags {
  isMissing: boolean;
  isExfoliated: boolean;
  isUnerupted: boolean;
}

/**
 * Per-socket mixed-dentition render rule — docs/specs/odontogram.md verbatim: show
 * the primary tooth unless it's exfoliated/missing, else show the permanent tooth
 * unless it's unerupted, else the socket is empty. `Adult`/`Primary` views force one
 * dentition regardless of markers. Returns the FDI to render, or null for an empty
 * socket (a molar position has no `primaryFdi` at all, or a not-yet-erupted position
 * under `Mixed`/`Primary`).
 */
export function resolveSocketTooth(
  socket: Socket,
  toothStateByFdi: Record<string, ToothPresenceFlags | undefined>,
  view: DentitionView,
): string | null {
  if (view === "adult") return socket.permanentFdi;
  if (view === "primary") return socket.primaryFdi;

  if (socket.primaryFdi) {
    const primaryState = toothStateByFdi[socket.primaryFdi];
    if (!primaryState?.isExfoliated && !primaryState?.isMissing) return socket.primaryFdi;
  }
  const permanentState = toothStateByFdi[socket.permanentFdi];
  return permanentState?.isUnerupted ? null : socket.permanentFdi;
}
