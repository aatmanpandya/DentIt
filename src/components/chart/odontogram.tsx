"use client";

import { Fragment, useEffect, useMemo, useRef } from "react";
import clsx from "clsx";
import type { Condition, Procedure, Surface } from "@/lib/chart-api";
import { SOCKETS, resolveSocketTooth, type DentitionView, type Socket } from "./tooth-grid";
import { useRovingTabindex } from "@/hooks/use-roving-tabindex";
import { ToothOutline } from "./tooth-outline";
import { ToothImage } from "./tooth-image";
import { computeAllToothStates, conditionMarker, procedureStatusTreatment, wholeToothOverlay, type ToothState } from "./tooth-state";

const VIEW_OPTIONS: { value: DentitionView; label: string }[] = [
  { value: "mixed", label: "Mixed" },
  { value: "adult", label: "Adult" },
  { value: "primary", label: "Primary" },
];

// Grid rows, per the reference layout: tooth image, then its surface selector,
// for each arch — selectors sandwiched in the middle so both arches' crowns face
// inward toward them.
const ROW = { upperImage: 1, upperSelector: 2, lowerSelector: 3, lowerImage: 4 } as const;

function toOutlineTreatment(t: "dashed" | "solid" | "filled" | "filled-invoiced"): "dashed" | "solid" | "solid-thick" {
  if (t === "dashed") return "dashed";
  if (t === "solid") return "solid";
  return "solid-thick";
}

/**
 * Which FDI to actually render at a socket, plus whether it's a transitional
 * not-yet-erupted gap (still shown, still activatable — docs/specs/odontogram.md's
 * "lets a dentist plan/chart on a not-yet-erupted tooth ahead of time") versus a
 * true absence (Primary view at a molar position, where no primary tooth ever
 * exists) — the only case with nothing to render at all.
 */
function socketDisplay(socket: Socket, toothStateByFdi: Record<string, ToothState | undefined>, view: DentitionView) {
  const resolved = resolveSocketTooth(socket, toothStateByFdi, view);
  if (resolved) return { fdi: resolved, transitional: false };
  if (view === "mixed" && socket.primaryFdi) return { fdi: socket.permanentFdi, transitional: true };
  return null;
}

export interface OdontogramProps {
  conditions: Condition[];
  procedures: Procedure[];
  view: DentitionView;
  onViewChange: (view: DentitionView) => void;
  onActivate: (fdi: string, surface?: Surface) => void;
  onClose: () => void;
}

export function Odontogram({ conditions, procedures, view, onViewChange, onActivate, onClose }: OdontogramProps) {
  const toothStateByFdi = useMemo(() => computeAllToothStates(conditions, procedures), [conditions, procedures]);
  const { selectedFdi, setSelectedFdi, getTabIndex, onKeyDown } = useRovingTabindex(onActivate, onClose);

  // Roving tabindex moves which element is *tabbable* (tabIndex), but the browser
  // never auto-moves DOM focus itself — without this, arrow keys would silently
  // stop reaching the grid after the first move, since focus stays on an element
  // that's no longer in the tab order.
  const nodeRefs = useRef(new Map<string, SVGSVGElement>());
  useEffect(() => {
    nodeRefs.current.get(selectedFdi)?.focus();
  }, [selectedFdi]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1">
        {VIEW_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onViewChange(opt.value)}
            aria-pressed={view === opt.value}
            className={clsx(
              "rounded-[var(--radius)] px-2 py-1 text-[12px] font-medium",
              view === opt.value ? "bg-steel text-white" : "text-ink-soft hover:bg-steel-lo hover:text-steel",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div
        className="grid gap-x-0.5 gap-y-1"
        style={{ gridTemplateColumns: "repeat(8, minmax(0, 1fr)) 8px repeat(8, minmax(0, 1fr))", gridTemplateRows: "repeat(4, auto)" }}
      >
        {SOCKETS.map((socket) => {
          const display = socketDisplay(socket, toothStateByFdi, view);
          const col = socket.col < 8 ? socket.col + 1 : socket.col + 2; // +1 column for the midline gap
          const imageRow = socket.row === "upper" ? ROW.upperImage : ROW.lowerImage;
          const selectorRow = socket.row === "upper" ? ROW.upperSelector : ROW.lowerSelector;

          if (!display) {
            return (
              <Fragment key={socket.index}>
                <div style={{ gridColumn: col, gridRow: imageRow }} />
                <div style={{ gridColumn: col, gridRow: selectorRow }} />
              </Fragment>
            );
          }

          const { fdi } = display;
          const state = toothStateByFdi[fdi];
          const condMarker = state ? conditionMarker(state.condition) : null;
          const surfaceConditionFill = condMarker
            ? condMarker.surfaces.length > 0
              ? Object.fromEntries(condMarker.surfaces.map((s) => [s, condMarker.fill]))
              : { M: condMarker.fill, D: condMarker.fill, B: condMarker.fill, L: condMarker.fill, O: condMarker.fill, I: condMarker.fill }
            : {};

          const surfaceProcedureOutline: Partial<Record<Surface, "dashed" | "solid" | "solid-thick">> = {};
          for (const procedure of state?.procedures ?? []) {
            if (!procedure.surfaces || procedure.surfaces.length === 0) continue;
            const treatment = procedureStatusTreatment(procedure.status);
            if (!treatment) continue;
            for (const surface of procedure.surfaces) surfaceProcedureOutline[surface] = toOutlineTreatment(treatment);
          }

          const overlay = state
            ? { ...wholeToothOverlay(state), ghosted: wholeToothOverlay(state).ghosted || display.transitional }
            : { ghosted: display.transitional };

          return (
            <Fragment key={socket.index}>
              <ToothImage fdi={fdi} overlay={overlay} className="w-full" style={{ gridColumn: col, gridRow: imageRow }} />
              <ToothOutline
                ref={(node) => {
                  if (node) nodeRefs.current.set(fdi, node);
                  else nodeRefs.current.delete(fdi);
                }}
                fdi={fdi}
                tabIndex={getTabIndex(fdi)}
                onKeyDown={onKeyDown}
                onFocus={() => setSelectedFdi(fdi)}
                surfaceConditionFill={surfaceConditionFill}
                surfaceProcedureOutline={surfaceProcedureOutline}
                onSurfaceClick={(surface) => {
                  setSelectedFdi(fdi);
                  onActivate(fdi, surface);
                }}
                className={clsx("w-full", fdi === selectedFdi && "outline outline-2 outline-steel outline-offset-1")}
                style={{ gridColumn: col, gridRow: selectorRow }}
              />
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
