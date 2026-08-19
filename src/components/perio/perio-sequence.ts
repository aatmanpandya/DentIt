/**
 * Pure, DOM-free traversal-order logic — no React dependency, same pattern as
 * src/components/chart/tooth-grid.ts. See docs/specs/perio.md.
 */
import { socketForFdi } from "@/components/chart/tooth-grid";
import type { PerioToothRecord } from "@/lib/perio-api";

// docs/specs/pilot-foundations.md §2's default: upper arch 18->28, lower arch 48->38.
// Expressed in permanent-FDI socket terms — at each position, whichever tooth (primary or
// permanent) is actually seeded into the exam for that socket is what gets visited.
export const DEFAULT_PROBING_SEQUENCE: readonly string[] = [
  "18", "17", "16", "15", "14", "13", "12", "11", "21", "22", "23", "24", "25", "26", "27", "28",
  "48", "47", "46", "45", "44", "43", "42", "41", "31", "32", "33", "34", "35", "36", "37", "38",
];

/**
 * Orders an exam's seeded tooth records for traversal. A socket with nothing seeded (an
 * empty gap — no tooth present at all) is simply absent from the result. Skipped teeth are
 * NOT filtered out here — that's the caller's job (the active keystroke cursor skips them;
 * the grid still renders them greyed out in sequence order).
 */
export function orderTeethForTraversal(teeth: PerioToothRecord[], probingSequence: readonly string[] | null): PerioToothRecord[] {
  const sequence = probingSequence ?? DEFAULT_PROBING_SEQUENCE;

  const bySocketPermanentFdi = new Map<string, PerioToothRecord>();
  for (const t of teeth) {
    const socket = socketForFdi(t.tooth);
    if (socket) bySocketPermanentFdi.set(socket.permanentFdi, t);
  }

  const ordered: PerioToothRecord[] = [];
  for (const permanentFdi of sequence) {
    const record = bySocketPermanentFdi.get(permanentFdi);
    if (record) ordered.push(record);
  }
  return ordered;
}
