/**
 * "150000.50" → "₹1,50,000.50" — Indian digit grouping, done on the decimal string so no
 * float ever touches a displayed amount. Negative values get a leading minus.
 */
export function formatRupees(value: string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const negative = value.startsWith("-");
  const [whole, fraction = "00"] = (negative ? value.slice(1) : value).split(".");
  const lastThree = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${lastThree}` : lastThree;
  return `${negative ? "−" : ""}₹${grouped}.${fraction.padEnd(2, "0").slice(0, 2)}`;
}

/** "1500.50" → 150050. Exact: splits the string, never multiplies a float. */
export function toPaise(value: string): number {
  const negative = value.startsWith("-");
  const [w, f = ""] = (negative ? value.slice(1) : value).split(".");
  const p = Number(w) * 100 + Number(f.padEnd(2, "0").slice(0, 2));
  return negative ? -p : p;
}

export function fromPaise(paise: number): string {
  const abs = Math.abs(paise);
  return `${paise < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Sums decimal strings in paise. Display-side totals (e.g. the Create invoice running total). */
export function addMoney(values: string[]): string {
  return fromPaise(values.reduce((sum, v) => sum + toPaise(v), 0));
}
