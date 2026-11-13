"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { orderTeethForTraversal } from "./perio-sequence";
import { initEntryState, firstIncompleteIndex, perioEntryReducer, SITE_ORDER, toothSavePayload } from "./perio-entry";
import { createSaveQueue, type SaveStatus } from "./save-queue";
import type { EntryAction, PerioEntryState, PerioSiteCode, SiteDraft, ToothDraft } from "./perio-entry";
import { upsertPerioToothRecord } from "@/lib/perio-api";
import type { PerioToothRecord } from "@/lib/perio-api";

export type ToothSaveStatus = SaveStatus;

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
  // onSaved changes identity with the parent's render; the queue lives for the whole exam.
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);
  // One queue per mounted exam (docs/bug-log.md entry 36). Skip toggles use their own key
  // ("16:skip") so they never displace a tooth's pending measurement save; both report their
  // status under the tooth. Created in the effect, not useState: StrictMode's dev
  // unmount/remount would otherwise cancel the only queue and silently drop every later save.
  const queueRef = useRef<ReturnType<typeof createSaveQueue> | null>(null);
  useEffect(() => {
    const queue = createSaveQueue({
      onStatus: (key, status) => setSaveStatus((s) => ({ ...s, [key.split(":")[0]]: status })),
      onSaved: () => onSavedRef.current(),
    });
    queueRef.current = queue;
    return () => queue.cancelAll();
  }, [examId]);

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

  const persistTooth = useCallback(
    (tooth: string, mobility: number | null, furcation: number | null, sites: SiteDraft[]) => {
      const payload = toothSavePayload({ mobility, furcation, sites });
      queueRef.current?.save(tooth, () => upsertPerioToothRecord(examId, tooth, payload));
    },
    [examId],
  );

  // What the grid shows for a tooth just saved. Mobility/furcation left unset in the draft
  // weren't sent (toothSavePayload), so the server keeps its value — show that, not null.
  const rememberSave = useCallback(
    (tooth: string, mobility: number | null, furcation: number | null, sites: SiteDraft[]) => {
      setRecentSaves((prev) => {
        const saved = teeth.find((t) => t.tooth === tooth);
        const before = prev[tooth];
        return {
          ...prev,
          [tooth]: {
            mobility: mobility ?? before?.mobility ?? saved?.mobility ?? null,
            furcation: furcation ?? before?.furcation ?? saved?.furcation ?? null,
            sites,
          },
        };
      });
    },
    [teeth],
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
          rememberSave(effect.tooth, effect.mobility, effect.furcation, effect.sites);
          persistTooth(effect.tooth, effect.mobility, effect.furcation, effect.sites);
        }
      }
    },
    [state, persistTooth, rememberSave],
  );

  // Click-to-position — mouse parity for entry (pilot-foundations.md §2: "any cell is
  // directly clickable"). If the clicked tooth is the one already being edited, just
  // reposition within its live draft (must not overwrite in-progress edits with
  // possibly-stale server data). Otherwise, build a fresh draft loaded from whatever's
  // already known for that tooth — recentSaves first (a save may not have round-tripped
  // through `teeth` yet), then the saved `teeth` prop, then blank for an untouched site —
  // so clicking an already-measured cell can never wipe it.
  const jumpTo = useCallback(
    (tooth: string, site: PerioSiteCode) => {
      const toothIndex = activeOrder.indexOf(tooth);
      if (toothIndex === -1) return; // skipped tooth — nothing to enter

      if (state.draft?.tooth === tooth) {
        dispatch({ type: "jump", target: { toothIndex, site, draft: state.draft } });
        return;
      }

      // Jumping away from the tooth currently being edited: if it has any committed
      // site data that hasn't been fully saved yet (save_tooth only fires once all 6
      // sites are done), persist whatever's there as a partial save first — the API
      // already upserts whichever sites it's given, no need for all 6. Caught live:
      // clicking a different tooth mid-entry silently discarded real, already-typed
      // measurements with no warning.
      const departingTooth = state.draft;
      if (departingTooth && departingTooth.sites.some((s) => s.pocket_depth !== null)) {
        rememberSave(departingTooth.tooth, departingTooth.mobility, departingTooth.furcation, departingTooth.sites);
        persistTooth(departingTooth.tooth, departingTooth.mobility, departingTooth.furcation, departingTooth.sites);
      }

      const known = recentSaves[tooth];
      const savedRecord = teeth.find((t) => t.tooth === tooth);
      const draft: ToothDraft = {
        tooth,
        mobility: known ? known.mobility : (savedRecord?.mobility ?? null),
        furcation: known ? known.furcation : (savedRecord?.furcation ?? null),
        sites: SITE_ORDER.map((s) => {
          const knownSite = known?.sites.find((x) => x.site === s);
          if (knownSite) return knownSite;
          const savedSite = savedRecord?.sites.find((x) => x.site === s);
          return savedSite
            ? {
                site: s,
                pocket_depth: savedSite.pocket_depth,
                gingival_margin: savedSite.gingival_margin,
                bleeding_on_probing: savedSite.bleeding_on_probing,
                suppuration: savedSite.suppuration,
                plaque: savedSite.plaque,
              }
            : { site: s, pocket_depth: null, gingival_margin: null, bleeding_on_probing: false, suppuration: false, plaque: false };
        }),
      };
      dispatch({ type: "jump", target: { toothIndex, site, draft } });
    },
    [activeOrder, state.draft, recentSaves, teeth, dispatch, persistTooth, rememberSave],
  );

  // Skip-toggling is deliberately outside the reducer (docs/specs/perio.md — symmetric,
  // works on any tooth via a click/keypress on its header, not just the current one).
  // Same never-lose-it retry guarantee as a measurement save, on its own queue key.
  const toggleSkip = useCallback(
    (tooth: string, isSkipped: boolean) => {
      queueRef.current?.save(`${tooth}:skip`, () => upsertPerioToothRecord(examId, tooth, { is_skipped: isSkipped, sites: [] }));
    },
    [examId],
  );

  return { state, dispatch, saveStatus, toggleSkip, activeOrder, recentSaves, jumpTo };
}
