/**
 * Client-side mirror of src/server/lib/tooth-notation.ts's fdiToUniversal/renderTooth —
 * duplicated rather than imported, since client code never imports from src/server (see
 * src/components/perio/tooth-furcation.ts for the same established pattern).
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

// Falls back to the raw FDI code rather than throwing (unlike the server twin) — this is a
// display-only function over already-validated server data, and a render helper shouldn't be
// able to crash the grid.
export function fdiToUniversal(fdi: string): string {
  return FDI_TO_UNIVERSAL_PERMANENT[fdi] ?? FDI_TO_UNIVERSAL_PRIMARY[fdi] ?? fdi;
}

export function renderTooth(fdi: string, display: "fdi" | "universal"): string {
  return display === "universal" ? fdiToUniversal(fdi) : fdi;
}
