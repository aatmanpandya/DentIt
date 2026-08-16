/**
 * FDI is canonical storage everywhere. Universal is a render-only concern for US users.
 * See docs/adr/0003-fdi-canonical-tooth-notation.md — never invert this.
 */

const FDI_TO_UNIVERSAL_PERMANENT: Record<string, string> = {
  18: "1", 17: "2", 16: "3", 15: "4", 14: "5", 13: "6", 12: "7", 11: "8",
  21: "9", 22: "10", 23: "11", 24: "12", 25: "13", 26: "14", 27: "15", 28: "16",
  38: "17", 37: "18", 36: "19", 35: "20", 34: "21", 33: "22", 32: "23", 31: "24",
  41: "25", 42: "26", 43: "27", 44: "28", 45: "29", 46: "30", 47: "31", 48: "32",
};

const FDI_TO_UNIVERSAL_PRIMARY: Record<string, string> = {
  55: "A", 54: "B", 53: "C", 52: "D", 51: "E",
  61: "F", 62: "G", 63: "H", 64: "I", 65: "J",
  75: "K", 74: "L", 73: "M", 72: "N", 71: "O",
  81: "P", 82: "Q", 83: "R", 84: "S", 85: "T",
};

const UNIVERSAL_TO_FDI: Record<string, string> = Object.fromEntries([
  ...Object.entries(FDI_TO_UNIVERSAL_PERMANENT).map(([fdi, uni]) => [uni, fdi]),
  ...Object.entries(FDI_TO_UNIVERSAL_PRIMARY).map(([fdi, uni]) => [uni, fdi]),
]);

export function isValidFdiTooth(fdi: string): boolean {
  return fdi in FDI_TO_UNIVERSAL_PERMANENT || fdi in FDI_TO_UNIVERSAL_PRIMARY;
}

export function fdiToUniversal(fdi: string): string {
  const result = FDI_TO_UNIVERSAL_PERMANENT[fdi] ?? FDI_TO_UNIVERSAL_PRIMARY[fdi];
  if (!result) throw new Error(`Not a valid FDI tooth code: ${fdi}`);
  return result;
}

export function universalToFdi(universal: string): string {
  const result = UNIVERSAL_TO_FDI[universal];
  if (!result) throw new Error(`Not a valid Universal tooth code: ${universal}`);
  return result;
}

export function renderTooth(fdi: string, display: "fdi" | "universal"): string {
  return display === "universal" ? fdiToUniversal(fdi) : fdi;
}

export function isPrimaryTooth(fdi: string): boolean {
  return fdi in FDI_TO_UNIVERSAL_PRIMARY;
}

/** Molars and upper first premolars (14, 24) are multi-rooted — furcation applies. */
export function hasFurcation(fdi: string): boolean {
  const multiRooted = ["14", "24", "16", "17", "18", "26", "27", "28", "36", "37", "38", "46", "47", "48"];
  return multiRooted.includes(fdi);
}

/** Occlusal applies to posteriors, incisal to anteriors — validated, not left to the user. */
export function validSurfacesForTooth(fdi: string): string[] {
  const anteriors = ["11", "12", "13", "21", "22", "23", "31", "32", "33", "41", "42", "43", "51", "52", "53", "61", "62", "63", "71", "72", "73", "81", "82", "83"];
  const base = ["M", "D", "B", "L"];
  return anteriors.includes(fdi) ? [...base, "I"] : [...base, "O"];
}
