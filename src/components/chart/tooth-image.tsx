"use client";

import { useMemo, type CSSProperties } from "react";
import { toothGeometry, BOX } from "./odontogram-teeth";

// Reference odontogram's own ghost-strike coordinates (132x268 box, same box this
// geometry uses) — reused verbatim rather than re-derived per tooth.
const GHOST_STRIKE = "M 34 92 L 98 200 M 98 92 L 34 200";

export interface ToothImageOverlay {
  ghosted?: boolean;
  struck?: boolean;
  ring?: "existing" | "procedure" | "both" | null;
  rootLineIcon?: boolean;
  ringTreatment?: "dashed" | "solid" | "filled" | "filled-invoiced" | null;
}

/** Planned → dashed; accepted → solid; completed/invoiced → heavier, with the crown shaded. */
function procedureRingStyle(treatment: ToothImageOverlay["ringTreatment"]) {
  switch (treatment) {
    case "solid":
      return { strokeWidth: 2.5, dash: undefined, fill: "none", fillOpacity: 0 };
    case "filled":
    case "filled-invoiced":
      return { strokeWidth: 3.5, dash: undefined, fill: "var(--steel)", fillOpacity: 0.22 };
    default:
      return { strokeWidth: 2, dash: "4,3", fill: "none", fillOpacity: 0 };
  }
}

/**
 * Decorative crown+root silhouette — tells one tooth apart from another (root
 * count, crown taper) so the surface-selector wheel (tooth-outline.tsx) can stay a
 * purely functional, identical-everywhere control. Not interactive: no click/
 * keyboard handling, not part of the roving-tabindex grid. Whole-tooth state
 * (missing/existing-restoration/tooth-scoped-procedure) renders here rather than
 * on the selector, since it's a fact about the tooth as a whole, not about any one
 * surface.
 *
 * The outline itself is one continuous anatomical silhouette from
 * ./odontogram-teeth's toothGeometry — crown and root are the same closed path,
 * split into two fill tones by clipping at the cervical line (g.cervicalY), not by
 * two separate paths. transform is toothGeometry's own composed mirror+arch-flip;
 * no per-tooth orientation logic needed here.
 */
export function ToothImage({ fdi, overlay, className, style }: { fdi: string; overlay?: ToothImageOverlay; className?: string; style?: CSSProperties }) {
  const g = useMemo(() => toothGeometry(fdi), [fdi]);
  const crownClipId = `tooth-image-crown-${fdi}`;
  const rootClipId = `tooth-image-root-${fdi}`;

  return (
    <svg
      viewBox={g.viewBox}
      className={className}
      style={{ ...style, height: "auto", opacity: overlay?.ghosted ? 0.35 : 1, overflow: "visible" }}
      aria-hidden="true"
    >
      <defs>
        <clipPath id={rootClipId}>
          <rect x={-100} y={0} width={200} height={g.cervicalY} />
        </clipPath>
        <clipPath id={crownClipId}>
          <rect x={-100} y={g.cervicalY} width={200} height={BOX.height - g.cervicalY} />
        </clipPath>
      </defs>
      <g transform={g.transform}>
        <g clipPath={`url(#${rootClipId})`}>
          <path d={g.d} fill="var(--tooth-root)" stroke="var(--ink)" strokeWidth={1.8} strokeLinejoin="round" />
        </g>
        <g clipPath={`url(#${crownClipId})`}>
          <path d={g.d} fill="var(--surface)" stroke="var(--ink)" strokeWidth={1.8} strokeLinejoin="round" />
        </g>
        <path d={g.cej} fill="none" stroke="var(--ink-soft)" strokeWidth={1} />
        {(overlay?.ring === "existing" || overlay?.ring === "both") && (
          <g clipPath={`url(#${crownClipId})`}>
            <path d={g.d} fill="none" stroke="var(--ink-soft)" strokeWidth={1.5} transform="scale(0.85)" style={{ transformOrigin: `0px ${(g.cervicalY + BOX.height) / 2}px` }} />
          </g>
        )}
        {(overlay?.ring === "procedure" || overlay?.ring === "both") && (
          <g clipPath={`url(#${crownClipId})`}>
            <path
              d={g.d}
              fill={procedureRingStyle(overlay?.ringTreatment).fill}
              fillOpacity={procedureRingStyle(overlay?.ringTreatment).fillOpacity}
              stroke="var(--steel)"
              strokeWidth={procedureRingStyle(overlay?.ringTreatment).strokeWidth}
              strokeDasharray={procedureRingStyle(overlay?.ringTreatment).dash}
              transform="scale(0.85)"
              style={{ transformOrigin: `0px ${(g.cervicalY + BOX.height) / 2}px` }}
            />
          </g>
        )}
        {overlay?.rootLineIcon && <line x1={0} y1={0} x2={0} y2={g.cervicalY} stroke="var(--ink-soft)" strokeWidth={1.5} />}
      </g>
      {overlay?.struck && <path d={GHOST_STRIKE} stroke="var(--ink)" strokeWidth={4} fill="none" />}
    </svg>
  );
}
