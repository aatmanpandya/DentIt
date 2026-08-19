/**
 * Client-side mirror of src/server/lib/tooth-notation.ts's hasFurcation — duplicated
 * rather than imported, since client code never imports from src/server (see
 * src/components/chart/tooth-shapes.ts for the same established pattern).
 */
export function hasFurcation(fdi: string): boolean {
  const multiRooted = ["14", "24", "16", "17", "18", "26", "27", "28", "36", "37", "38", "46", "47", "48"];
  return multiRooted.includes(fdi);
}
