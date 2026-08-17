"use client";

import { forwardRef, useMemo, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { isAnterior, surfaceWedges, toothGeometry } from "./odontogram-teeth";
import type { Surface } from "@/lib/chart-api";

// Layer 1 (condition/finding) — fill on the surface region. `hatch` uses a per-tooth
// pattern def since SVG patterns are id-scoped; bleed/caution are plain fills.
const CONDITION_FILL_COLOR: Record<"bleed" | "caution", string> = {
  bleed: "var(--bleed)",
  caution: "var(--caution)",
};

// Layer 2 (procedure status) — stroke only, never fill, so it never covers a
// condition fill on the same surface. Status distinctions collapse to three
// visual weights rather than five (completed/invoiced share "solid-thick") —
// the panel's History section carries the exact status text; the glyph only
// needs to answer "is something in flight here", not the full lifecycle.
const PROCEDURE_STROKE: Record<"dashed" | "solid" | "solid-thick", { width: number; dash?: string }> = {
  dashed: { width: 1, dash: "2,1.5" },
  solid: { width: 1 },
  "solid-thick": { width: 2 },
};

export interface ToothOutlineProps {
  fdi: string;
  selectedSurfaces?: Surface[];
  surfaceConditionFill?: Partial<Record<Surface, "bleed" | "caution" | "hatch">>;
  surfaceProcedureOutline?: Partial<Record<Surface, "dashed" | "solid" | "solid-thick">>;
  onSurfaceClick?: (surface: Surface) => void;
  tabIndex?: number;
  onKeyDown?: (e: KeyboardEvent<SVGSVGElement>) => void;
  onFocus?: () => void;
  className?: string;
  style?: CSSProperties;
}

/**
 * The surface-selector wheel — purely functional, five radial sectors (buccal/
 * lingual/mesial/distal + occlusal-or-incisal centre) from ./odontogram-teeth's
 * surfaceWedges. Mesial is resolved per tooth against the midline via
 * toothGeometry(fdi).side, so the wedge geometry itself already carries the
 * correct left/right orientation — no separate mirror transform needed here.
 * Whole-tooth state (missing/ghosted/ring/root-icon) lives on the decorative
 * silhouette instead (tooth-image.tsx), not here — this component is only ever
 * about surfaces. Rendering only, no data-fetching; the marker computation lives
 * in tooth-state.ts.
 */
export const ToothOutline = forwardRef<SVGSVGElement, ToothOutlineProps>(function ToothOutline(
  { fdi, selectedSurfaces = [], surfaceConditionFill = {}, surfaceProcedureOutline = {}, onSurfaceClick, tabIndex, onKeyDown, onFocus, className, style },
  ref,
) {
  const side = useMemo(() => toothGeometry(fdi).side, [fdi]);
  const wedges = useMemo(() => surfaceWedges({ side, anterior: isAnterior(fdi) }), [side, fdi]);
  const hatchId = `tooth-outline-hatch-${fdi}`;

  return (
    <svg
      ref={ref}
      viewBox="-18 -18 36 36"
      className={className}
      style={{ ...style, height: "auto" }}
      tabIndex={tabIndex}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      role="group"
      aria-label={`Tooth ${fdi}`}
    >
      <defs>
        <pattern id={hatchId} width={3} height={3} patternUnits="userSpaceOnUse">
          <path d="M0,3 L3,0" stroke="var(--caution)" strokeWidth={0.6} />
        </pattern>
      </defs>
      {wedges.map((wedge) => {
        const surface = wedge.code as Surface;
        const conditionFill = surfaceConditionFill[surface];
        const procedureOutline = surfaceProcedureOutline[surface];
        const stroke = procedureOutline ? PROCEDURE_STROKE[procedureOutline] : null;
        const fill =
          conditionFill === "hatch"
            ? `url(#${hatchId})`
            : conditionFill
              ? CONDITION_FILL_COLOR[conditionFill]
              : selectedSurfaces.includes(surface)
                ? "var(--steel-lo)"
                : "var(--surface)";
        const shared = {
          fill,
          stroke: stroke ? "var(--steel)" : "var(--rule)",
          strokeWidth: stroke?.width ?? 0.5,
          strokeDasharray: stroke?.dash,
          "data-surface": surface,
          onClick: (e: MouseEvent) => {
            e.stopPropagation();
            onSurfaceClick?.(surface);
          },
        } as const;
        return wedge.d ? <path key={wedge.code} d={wedge.d} {...shared} /> : <circle key={wedge.code} r={wedge.r} {...shared} />;
      })}
    </svg>
  );
});
