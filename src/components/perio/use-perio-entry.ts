"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction, type MutableRefObject } from "react";
import { orderTeethForTraversal } from "./perio-sequence";
import { initEntryState, firstIncompleteIndex, perioEntryReducer } from "./perio-entry";
import type { EntryAction, PerioEntryState, SiteDraft } from "./perio-entry";
import { upsertPerioToothRecord } from "@/lib/perio-api";
import type { PerioToothRecord } from "@/lib/perio-api";

export type ToothSaveStatus = "saved" | "saving" | "retrying";

const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30000;

type RetryTimers = MutableRefObject<Map<string, ReturnType<typeof setTimeout>>>;

/**
 * Fire-and-retry: attempts `save()`, and on failure retries with capped exponential
 * backoff until it succeeds — the grid's never-lose-a-tooth guarantee
 * (docs/specs/validation-and-errors.md). A plain recursive function, not a hook, so it
 * can call itself directly without the stale-closure problems a self-referencing
 * useCallback would have.
 */
function retryingSave(
  key: string,
  attempt: number,
  save: () => Promise<unknown>,
  setSaveStatus: Dispatch<SetStateAction<Record<string, ToothSaveStatus>>>,
  retryTimers: RetryTimers,
  onSaved: () => void,
) {
  setSaveStatus((s) => ({ ...s, [key]: attempt === 0 ? "saving" : "retrying" }));
  save()
    .then(() => {
      retryTimers.current.delete(key);
      setSaveStatus((s) => ({ ...s, [key]: "saved" }));
      onSaved();
    })
    .catch(() => {
      const delay = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
      const timer = setTimeout(() => retryingSave(key, attempt + 1, save, setSaveStatus, retryTimers, onSaved), delay);
      retryTimers.current.set(key, timer);
    });
}

/**
 * Wires the pure perio-entry reducer (src/components/perio/perio-entry.ts) to real API
 * calls. A failed per-tooth save never blocks entry — docs/specs/validation-and-errors.md's
 * explicit exception for this grid, "an operator mid-exam with gloves on cannot deal with
 * a modal" — it retries with backoff in the background while the operator keeps typing.
 */
export function usePerioEntry(
  examId: string,
  teeth: PerioToothRecord[],
  probingSequence: readonly string[] | null,
  onSaved: () => void,
) {
  const activeOrder = useMemo(
    () =>
      orderTeethForTraversal(teeth, probingSequence)
        .filter((t) => !t.is_skipped)
        .map((t) => t.tooth),
    [teeth, probingSequence],
  );
  const orderKey = activeOrder.join(",");

  const sitesSavedByTooth = useMemo(() => {
    const m = new Map(teeth.map((t) => [t.tooth, t.sites.length]));
    return (tooth: string) => m.get(tooth) ?? 0;
  }, [teeth]);

  const [state, setState] = useState<PerioEntryState>(() =>
    initEntryState(activeOrder, firstIncompleteIndex(activeOrder, sitesSavedByTooth)),
  );

  // The active tooth order reshapes whenever a skip toggle changes which teeth are
  // focusable (from anywhere — not just the current one). Skip-toggling some *other*
  // tooth must not disturb an in-progress, not-yet-saved draft on the current one — a
  // hygienist who's set mobility/furcation via the popover but hasn't finished all 6
  // sites yet would silently lose it otherwise (caught live: toggling skip on tooth 16
  // wiped an unsaved mobility/furcation entry on tooth 17). So: if the tooth being
  // edited is still active, just reposition the cursor within the reshaped order and
  // leave the draft alone; only fall back to resuming at the first incomplete tooth
  // when the current tooth itself dropped out of the active set (it just got skipped).
  // React's documented "adjusting state during render" pattern (react.dev), tracked
  // with state rather than a ref so it stays lint-clean.
  const [prevOrderKey, setPrevOrderKey] = useState(orderKey);
  if (orderKey !== prevOrderKey) {
    setPrevOrderKey(orderKey);
    const currentTooth = state.draft?.tooth;
    const repositioned = currentTooth ? activeOrder.indexOf(currentTooth) : -1;
    setState(
      repositioned !== -1
        ? { ...state, order: activeOrder, toothIndex: repositioned }
        : initEntryState(activeOrder, firstIncompleteIndex(activeOrder, sitesSavedByTooth)),
    );
  }

  const [saveStatus, setSaveStatus] = useState<Record<string, ToothSaveStatus>>({});
  const retryTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // A tooth's draft disappears from `state` the instant it advances to the next one,
  // but the server refetch that repopulates `teeth` with the saved data takes a real
  // network round-trip (confirmed live: 50-150ms where the just-typed values vanished
  // from the grid before reappearing). This caches what was just sent, synchronously,
  // the moment the save fires — so the grid always has something to show for a tooth
  // that's mid-flight, never a blank gap. Keyed indefinitely, not cleared on refetch:
  // once set it's always consistent with what the server ends up holding (retries
  // resend this exact snapshot), so there's no correctness cost to leaving it.
  const [recentSaves, setRecentSaves] = useState<
    Record<string, { mobility: number | null; furcation: number | null; sites: SiteDraft[] }>
  >({});

  useEffect(() => {
    const timers = retryTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, []);

  const persistTooth = useCallback(
    (tooth: string, mobility: number | null, furcation: number | null, sites: SiteDraft[]) => {
      const pending = retryTimers.current.get(tooth);
      if (pending) {
        clearTimeout(pending);
        retryTimers.current.delete(tooth);
      }
      // `save_tooth` only ever fires once every site has a committed pocket depth (the
      // reducer's own invariant) — this filter is defensive, not expected to drop anything.
      const payload = sites.filter((s): s is SiteDraft & { pocket_depth: number } => s.pocket_depth !== null);
      retryingSave(
        tooth,
        0,
        () => upsertPerioToothRecord(examId, tooth, { mobility, furcation, sites: payload }),
        setSaveStatus,
        retryTimers,
        onSaved,
      );
    },
    [examId, onSaved],
  );

  // Deliberately not the setState(prev => ...) functional-updater form: the network
  // call in persistTooth is a side effect, and React (StrictMode in dev, concurrent
  // features in general) can invoke a functional updater more than once per action —
  // which double-fired the PUT here before this was caught live. dispatch is only ever
  // called from a synchronous keyboard event handler, one action at a time, so reading
  // `state` from the closure is safe: there's no concurrent writer to race against.
  const dispatch = useCallback(
    (action: EntryAction) => {
      const { state: next, effects } = perioEntryReducer(state, action);
      setState(next);
      for (const effect of effects) {
        if (effect.type === "save_tooth") {
          setRecentSaves((prev) => ({
            ...prev,
            [effect.tooth]: { mobility: effect.mobility, furcation: effect.furcation, sites: effect.sites },
          }));
          persistTooth(effect.tooth, effect.mobility, effect.furcation, effect.sites);
        }
      }
    },
    [state, persistTooth],
  );

  // Skip-toggling is deliberately outside the reducer (docs/specs/perio.md — symmetric,
  // works on any tooth via a click/keypress on its header, not just the current one).
  // Same never-lose-it retry-and-drain guarantee as a measurement save.
  const toggleSkip = useCallback(
    (tooth: string, isSkipped: boolean) => {
      const pending = retryTimers.current.get(tooth);
      if (pending) {
        clearTimeout(pending);
        retryTimers.current.delete(tooth);
      }
      retryingSave(
        tooth,
        0,
        () => upsertPerioToothRecord(examId, tooth, { is_skipped: isSkipped, sites: [] }),
        setSaveStatus,
        retryTimers,
        onSaved,
      );
    },
    [examId, onSaved],
  );

  return { state, dispatch, saveStatus, toggleSkip, activeOrder, recentSaves };
}
