"use client";

import { useCallback, useState, type KeyboardEvent } from "react";
import { adjacentTooth } from "@/components/chart/tooth-grid";
import { rovingIntentForKey } from "./roving-tabindex";

// Upper-right 1st molar — the keyboard table's default focus target.
const DEFAULT_FDI = "18";

/**
 * Roving-tabindex keyboard navigation for the Odontogram grid — genuinely new, not
 * adapted from the schedule day view's arrow-key handling (that mutates the selected
 * appointment's time/operatory directly; every block is independently tabIndex={0}).
 * Here, arrows move a single selection cursor across fixed tooth positions.
 *
 * Thin on purpose: the actual logic lives in the pure modules this wires together
 * (rovingIntentForKey, tooth-grid's adjacentTooth) so it's covered by unit tests
 * without needing a React/DOM test harness this codebase doesn't have yet.
 */
export function useRovingTabindex(onActivate: (fdi: string) => void, onClose: () => void) {
  const [selectedFdi, setSelectedFdi] = useState<string>(DEFAULT_FDI);

  const getTabIndex = useCallback((fdi: string) => (fdi === selectedFdi ? 0 : -1), [selectedFdi]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const intent = rovingIntentForKey(e.key);
      if (!intent) return;
      e.preventDefault();

      if (intent.kind === "move") {
        const next = adjacentTooth(selectedFdi, intent.direction);
        if (next) setSelectedFdi(next);
      } else if (intent.kind === "activate") {
        onActivate(selectedFdi);
      } else {
        onClose();
      }
    },
    [selectedFdi, onActivate, onClose],
  );

  return { selectedFdi, setSelectedFdi, getTabIndex, onKeyDown };
}
