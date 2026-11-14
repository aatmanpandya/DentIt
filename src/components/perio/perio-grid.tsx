"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import clsx from "clsx";
import { Lock } from "lucide-react";
import { usePerioEntry } from "./use-perio-entry";
import { orderTeethForTraversal } from "./perio-sequence";
import { SITE_ORDER } from "./perio-entry";
import { hasFurcation } from "./tooth-furcation";
import { renderTooth } from "./tooth-display";
import { buildDeltaIndex, badgeForDelta } from "./perio-compare";
import type { PerioToothRecord, PerioSiteDelta } from "@/lib/perio-api";
import { VoiceBar, type VoiceCell } from "./voice-bar";

export interface PerioGridProps {
  examId: string;
  teeth: PerioToothRecord[];
  probingSequence: readonly string[] | null;
  completed: boolean;
  // Org's tooth-notation display preference (ADR-0003) — FDI is always the storage/logic
  // notation; this only controls what's rendered.
  toothDisplay: "fdi" | "universal";
  // Comparison-view toggle (docs/specs/perio.md) — null when compare mode is off. When
  // present, each site's CAL gets a delta badge next to it, ≥2mm flagged as significant.
  compareDeltas: PerioSiteDelta[] | null;
  // Called after every successful per-tooth save (measurement or skip toggle) — the
  // caller should refetch the exam so is_skipped/mobility/furcation/sites reflect what
  // actually persisted (the graphical overlay in particular needs this — it renders from
  // saved state, not the in-progress draft, per docs/specs/perio.md).
  onSaved: () => void;
}

function calFor(pd: number | null | undefined, gm: number | null | undefined): number | null {
  return pd != null && gm != null ? pd + gm : null;
}

const MENU_LABEL: Record<"mobility" | "furcation", string> = { mobility: "Mobility", furcation: "Furcation" };

/**
 * The load-bearing UI of the whole feature — docs/specs/perio.md. A dense, keyboard-
 * drivable teeth x sites table; entry mechanics live in use-perio-entry.ts/perio-entry.ts,
 * this component only renders state and forwards keystrokes.
 */
export function PerioGrid({ examId, teeth, probingSequence, completed, toothDisplay, compareDeltas, onSaved }: PerioGridProps) {
  const { state, dispatch, saveStatus, toggleSkip, recentSaves, jumpTo, activeOrder, knownDraft, applyVoice, restoreVoice } = usePerioEntry(
    examId,
    teeth,
    probingSequence,
    onSaved,
  );
  // Cells the last voice phrase (or its undo) changed, lit for a few seconds so the dentist can
  // see where the numbers landed without looking for them.
  const [voiceCells, setVoiceCells] = useState<Set<string>>(new Set());
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function highlight(cells: VoiceCell[]) {
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    setVoiceCells(new Set(cells.map((c) => `${c.tooth}:${c.site ?? ""}`)));
    highlightTimer.current = setTimeout(() => setVoiceCells(new Set()), 4000);
  }
  useEffect(() => () => {
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
  }, []);
  const containerRef = useRef<HTMLDivElement>(null);
  const deltaIndex = useMemo(() => (compareDeltas ? buildDeltaIndex(compareDeltas) : null), [compareDeltas]);

  // Full column order, skipped teeth included (greyed, not part of the keystroke cursor —
  // that's `state`'s own `order`, built from the active, non-skipped subset).
  const displayOrder = useMemo(() => orderTeethForTraversal(teeth, probingSequence), [teeth, probingSequence]);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (completed) return;
    const key = e.key;

    if (state.menu) {
      if (key >= "0" && key <= "3") {
        e.preventDefault();
        dispatch({ type: "select_menu_value", value: Number(key) as 0 | 1 | 2 | 3 });
      } else if (key === "Escape") {
        e.preventDefault();
        dispatch({ type: "close_menu" });
      }
      return;
    }

    if (key >= "0" && key <= "9") {
      e.preventDefault();
      dispatch({ type: "digit", digit: Number(key) });
    } else if (key === "-") {
      e.preventDefault();
      dispatch({ type: "dash" });
    } else if (key === "Enter") {
      e.preventDefault();
      dispatch({ type: "advance" });
    } else if (!e.ctrlKey && key.toLowerCase() === "b") {
      e.preventDefault();
      dispatch({ type: "flag", flag: "bleeding_on_probing" });
    } else if (!e.ctrlKey && key.toLowerCase() === "s") {
      e.preventDefault();
      dispatch({ type: "flag", flag: "suppuration" });
    } else if (!e.ctrlKey && key.toLowerCase() === "p") {
      e.preventDefault();
      dispatch({ type: "flag", flag: "plaque" });
    } else if (!e.ctrlKey && key.toLowerCase() === "m") {
      e.preventDefault();
      dispatch({ type: "open_menu", menu: "mobility" });
    } else if (!e.ctrlKey && key.toLowerCase() === "f" && state.draft && hasFurcation(state.draft.tooth)) {
      e.preventDefault();
      dispatch({ type: "open_menu", menu: "furcation" });
    }
  }

  if (displayOrder.length === 0) {
    return <p className="text-ink-soft text-sm">No teeth to chart for this exam.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {!completed && (
        <VoiceBar
          examId={examId}
          activeOrder={activeOrder}
          disabled={completed}
          knownDraft={knownDraft}
          applyVoice={applyVoice}
          restoreVoice={restoreVoice}
          onHighlight={highlight}
          renderTooth={(t) => renderTooth(t, toothDisplay)}
        />
      )}
      <div
        ref={containerRef}
        tabIndex={completed ? -1 : 0}
        role="application"
        aria-label="Perio measurement entry grid"
        onKeyDown={onKeyDown}
        className={clsx(
          "overflow-x-auto rounded-DEFAULT border border-rule focus:outline-none",
          completed && "opacity-75",
        )}
      >
        <div className="inline-grid" style={{ gridTemplateColumns: `72px repeat(${displayOrder.length}, 52px)` }}>
          <div
            className="sticky left-0 z-10 flex items-center justify-center border-b border-rule bg-surface"
            title={completed ? "Locked — exam completed" : undefined}
          >
            {completed && <Lock size={13} strokeWidth={2} className="text-ink-soft" />}
          </div>
          {displayOrder.map((t) => {
            const isCurrentTooth = state.draft?.tooth === t.tooth && !t.is_skipped;
            const status = saveStatus[t.tooth];
            return (
              <button
                key={t.tooth}
                type="button"
                disabled={completed}
                onClick={() => toggleSkip(t.tooth, !t.is_skipped)}
                className={clsx(
                  "flex flex-col items-center gap-0.5 border-b border-rule py-1 font-data text-xs",
                  t.is_skipped ? "bg-steel-lo text-ink-soft" : "bg-surface text-ink",
                  isCurrentTooth && "bg-steel-lo ring-1 ring-inset ring-steel",
                )}
                title={
                  t.is_skipped
                    ? `${renderTooth(t.tooth, toothDisplay)} — skipped, click to un-skip`
                    : `${renderTooth(t.tooth, toothDisplay)} — click to skip`
                }
              >
                <span>{renderTooth(t.tooth, toothDisplay)}</span>
                <span
                  className={clsx(
                    "h-1.5 w-1.5 rounded-full",
                    status === "saved" && "bg-healthy",
                    (status === "saving" || status === "retrying") && "bg-steel animate-pulse",
                    !status && "bg-transparent",
                  )}
                />
              </button>
            );
          })}

          <div className="sticky left-0 z-10 border-b border-rule bg-surface px-1 py-0.5 text-[10px] text-ink-soft">Mob/Furc</div>
          {displayOrder.map((t) => {
            const isDraftTooth = state.draft?.tooth === t.tooth;
            // recentSaves covers the gap between a tooth finishing (its draft moves on)
            // and the refetch that repopulates `teeth` actually landing — without it the
            // just-entered values flash blank for a beat. See use-perio-entry.ts.
            const recent = !isDraftTooth ? recentSaves[t.tooth] : undefined;
            const mobility = isDraftTooth ? state.draft?.mobility : (recent ? recent.mobility : t.mobility);
            const furcation = isDraftTooth ? state.draft?.furcation : (recent ? recent.furcation : t.furcation);
            return (
              <div
                key={t.tooth}
                className={clsx("border-b border-rule py-0.5 text-center font-data text-[10px] text-ink-soft", voiceCells.has(`${t.tooth}:`) && "bg-healthy/20 text-ink")}
              >
                {t.is_skipped ? "—" : `${mobility ?? "·"}/${hasFurcation(t.tooth) ? (furcation ?? "·") : "·"}`}
              </div>
            );
          })}

          {SITE_ORDER.map((site, siteIdx) => (
            <Fragment key={site}>
              <div className="sticky left-0 z-10 border-b border-rule bg-surface px-1 py-1.5 text-[10px] text-ink-soft">{site}</div>
              {displayOrder.map((t) => {
                const isDraftTooth = state.draft?.tooth === t.tooth;
                const draftSite = isDraftTooth ? state.draft?.sites[siteIdx] : undefined;
                // Same recentSaves fallback as the Mob/Furc row above — covers the gap
                // between a tooth finishing and its refetch landing.
                const recentSite = !isDraftTooth ? recentSaves[t.tooth]?.sites[siteIdx] : undefined;
                const localSite = draftSite ?? recentSite;
                const savedSite = t.sites.find((s) => s.site === site);

                const pd = localSite ? localSite.pocket_depth : (savedSite?.pocket_depth ?? null);
                const gm = localSite ? localSite.gingival_margin : (savedSite?.gingival_margin ?? null);
                const cal = localSite ? calFor(pd, gm) : (savedSite?.cal ?? null);
                const bop = localSite ? localSite.bleeding_on_probing : (savedSite?.bleeding_on_probing ?? false);
                const supp = localSite ? localSite.suppuration : (savedSite?.suppuration ?? false);
                const plaque = localSite ? localSite.plaque : (savedSite?.plaque ?? false);

                const isActiveCell = isDraftTooth && state.siteIndex === siteIdx && !t.is_skipped;
                const badge = deltaIndex && !t.is_skipped ? badgeForDelta(deltaIndex.get(`${t.tooth}:${site}`)) : null;

                return (
                  <button
                    key={`${t.tooth}-${site}`}
                    type="button"
                    disabled={completed || t.is_skipped}
                    aria-label={
                      t.is_skipped
                        ? `Tooth ${renderTooth(t.tooth, toothDisplay)}, ${site}, skipped`
                        : `Tooth ${renderTooth(t.tooth, toothDisplay)}, ${site}${pd !== null ? `, pocket depth ${pd}` : ""}${gm !== null ? `, gingival margin ${gm}` : ""}`
                    }
                    onClick={() => {
                      jumpTo(t.tooth, site);
                      // The click moves DOM focus to this button; move it straight back
                      // to the grid container so the next keystroke still lands on the
                      // shared onKeyDown handler, not this button.
                      containerRef.current?.focus();
                    }}
                    className={clsx(
                      "flex flex-col items-center justify-center gap-0 border-b border-rule py-1 font-data text-xs tabular-nums",
                      t.is_skipped ? "cursor-default bg-steel-lo text-ink-soft" : "cursor-pointer hover:bg-steel-lo/60",
                      isDraftTooth && !t.is_skipped && "bg-steel-lo/40",
                      isActiveCell && "ring-2 ring-inset ring-steel",
                      voiceCells.has(`${t.tooth}:${site}`) && "bg-healthy/20",
                    )}
                  >
                    {t.is_skipped ? (
                      <span>—</span>
                    ) : (
                      <>
                        <span>
                          {pd ?? "·"}
                          {gm !== null ? `/${gm > 0 ? "+" : ""}${gm}` : ""}
                        </span>
                        <span className="text-[9px] text-ink-soft">
                          {cal !== null ? `CAL ${cal}` : " "}
                          {badge && (
                            <span className={clsx("ml-0.5", badge.significant ? "font-medium text-bleed" : "text-ink-soft")} title="Change since compared exam">
                              {badge.label}
                            </span>
                          )}
                        </span>
                        <span className="flex h-3 gap-0.5 text-[9px] leading-none">
                          {bop && (
                            <span className="text-bleed" title="Bleeding on probing">
                              B
                            </span>
                          )}
                          {supp && (
                            <span className="text-bleed" title="Suppuration">
                              S
                            </span>
                          )}
                          {plaque && (
                            <span className="text-caution" title="Plaque">
                              P
                            </span>
                          )}
                        </span>
                      </>
                    )}
                  </button>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>

      {state.menu && state.draft && (
        <div className="flex items-center gap-1 rounded-DEFAULT border border-rule bg-surface p-2 text-xs">
          <span className="mr-1 text-ink-soft">
            {MENU_LABEL[state.menu]} for {renderTooth(state.draft.tooth, toothDisplay)}:
          </span>
          {([0, 1, 2, 3] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => dispatch({ type: "select_menu_value", value: v })}
              className="rounded-DEFAULT border border-rule px-2 py-0.5 font-data hover:bg-steel-lo"
            >
              {v}
            </button>
          ))}
          <button type="button" onClick={() => dispatch({ type: "close_menu" })} className="ml-1 text-ink-soft hover:text-ink">
            Cancel
          </button>
        </div>
      )}

      {state.draft === null && (
        <p className="text-sm text-healthy">Every tooth in this exam has been measured.</p>
      )}
    </div>
  );
}
