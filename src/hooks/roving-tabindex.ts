/**
 * Pure keyboard-intent mapping for the Odontogram's roving-tabindex grid — no DOM,
 * no React, cheap to unit test. See docs/specs/odontogram.md's keyboard table.
 * `use-roving-tabindex.ts` is the thin React wrapper that consumes this plus
 * src/components/chart/tooth-grid.ts's adjacentTooth to actually move focus.
 */

export type RovingIntent =
  | { kind: "move"; direction: "left" | "right" | "up" | "down" }
  | { kind: "activate" }
  | { kind: "close" };

const KEY_MAP: Record<string, RovingIntent> = {
  ArrowLeft: { kind: "move", direction: "left" },
  ArrowRight: { kind: "move", direction: "right" },
  ArrowUp: { kind: "move", direction: "up" },
  ArrowDown: { kind: "move", direction: "down" },
  Enter: { kind: "activate" },
  " ": { kind: "activate" },
  Escape: { kind: "close" },
};

/** Returns null for any key the grid doesn't handle — callers should let it bubble. */
export function rovingIntentForKey(key: string): RovingIntent | null {
  return KEY_MAP[key] ?? null;
}
