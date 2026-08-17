/**
 * docs/specs/odontogram.md's "Tooth geometry" section. All actual silhouette and
 * surface-wedge geometry now lives in ./odontogram-teeth (parametric, generated
 * from control points — see that file's header) — tooth-image.tsx and
 * tooth-outline.tsx consume it directly. This file only keeps the one bit of
 * geometry-derived logic that isn't itself geometry: which surfaces are valid for
 * a given tooth, which the charting panel needs to build its surface toggles.
 */

import type { Surface } from "@/lib/chart-api";
import { isAnterior } from "./odontogram-teeth";

/**
 * The client-side mirror of src/server/lib/tooth-notation.ts's validSurfacesForTooth
 * — duplicated rather than imported, since client code never imports from
 * src/server (see the rest of this codebase's src/lib/*-api.ts modules).
 */
export function validSurfacesForFdi(fdi: string): Surface[] {
  const base: Surface[] = ["M", "D", "B", "L"];
  return isAnterior(fdi) ? [...base, "I"] : [...base, "O"];
}
