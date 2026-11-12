/**
 * Money arithmetic in integer paise. Values are numeric(10,2) in Postgres and decimal
 * strings over the wire (CLAUDE.md); every sum, tax and split goes through here so no
 * float ever touches a rupee amount. ₹99,999,999.99 is ~1e10 paise, well inside
 * Number.MAX_SAFE_INTEGER. See docs/specs/ledger.md.
 */

export class InvalidMoneyError extends Error {
  constructor(value: string) {
    super(`"${value}" is not a valid amount.`);
    this.name = "InvalidMoneyError";
  }
}

const MONEY_PATTERN = /^-?\d+(\.\d{1,2})?$/;

export function isMoneyString(value: string): boolean {
  return MONEY_PATTERN.test(value);
}

/** numeric(10,2) holds up to 99,999,999.99; anything larger would fail in Postgres. */
export const MAX_PAISE = 9_999_999_999;

export function toPaise(value: string): number {
  if (!MONEY_PATTERN.test(value)) throw new InvalidMoneyError(value);
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (paise > MAX_PAISE) throw new InvalidMoneyError(value);
  return negative ? -paise : paise;
}

export function fromPaise(paise: number): string {
  if (!Number.isSafeInteger(paise)) throw new InvalidMoneyError(String(paise));
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const text = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return negative ? `-${text}` : text;
}

export function sumMoney(values: string[]): string {
  return fromPaise(values.reduce((total, v) => total + toPaise(v), 0));
}

/** Rates as basis points (5% = 500), snapshotted onto each invoice line. pilot-foundations.md §1. */
export const TAX_RATE_BY_CLASS = {
  exempt_healthcare: 0,
  gst_5: 500,
  gst_18: 1800,
} as const;

export type TaxClass = keyof typeof TAX_RATE_BY_CLASS;

/** Basis points → the numeric(5,2) percentage stored on the line ("18.00"). */
export function rateToPercentString(basisPoints: number): string {
  return fromPaise(basisPoints);
}

/** Integer division rounded half up, for non-negative operands. */
function divideHalfUp(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/**
 * One invoice line's tax, rounded per line, half up, to the paisa.
 * - inclusive: the price already contains the tax; tax = price × r / (100 + r).
 * - exclusive: tax is added on top; tax = price × r / 100.
 * `unit` is always the pre-tax figure, and unit + tax = total exactly.
 */
export function lineTax(pricePaise: number, rateBasisPoints: number, pricesIncludeTax: boolean) {
  if (rateBasisPoints === 0) return { unit: pricePaise, tax: 0, total: pricePaise };
  if (pricesIncludeTax) {
    const tax = divideHalfUp(pricePaise * rateBasisPoints, 10_000 + rateBasisPoints);
    return { unit: pricePaise - tax, tax, total: pricePaise };
  }
  const tax = divideHalfUp(pricePaise * rateBasisPoints, 10_000);
  return { unit: pricePaise, tax, total: pricePaise + tax };
}

/** Intra-state GST shown as CGST + SGST, half each; the second half takes any odd paisa. */
export function splitCgstSgst(taxPaise: number) {
  const cgst = Math.floor(taxPaise / 2);
  return { cgst, sgst: taxPaise - cgst };
}
