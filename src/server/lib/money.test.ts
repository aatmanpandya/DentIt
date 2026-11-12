import { describe, it, expect } from "vitest";
import { toPaise, fromPaise, sumMoney, lineTax, splitCgstSgst, TAX_RATE_BY_CLASS, InvalidMoneyError } from "./money";

describe("toPaise / fromPaise", () => {
  it("round-trips decimal strings exactly, with no float drift", () => {
    expect(toPaise("1500.00")).toBe(150000);
    expect(toPaise("0.1")).toBe(10);
    expect(toPaise("0.29")).toBe(29); // 0.29 * 100 = 28.999999999999996 in floats
    expect(fromPaise(29)).toBe("0.29");
    expect(fromPaise(150000)).toBe("1500.00");
    expect(fromPaise(-5)).toBe("-0.05");
  });

  it("rejects anything that isn't a plain decimal with at most two places", () => {
    for (const bad of ["", "abc", "1.234", "1e3", "1,500.00", " 12"]) {
      expect(() => toPaise(bad), bad).toThrow(InvalidMoneyError);
    }
  });
});

describe("sumMoney", () => {
  it("adds in paise", () => {
    expect(sumMoney(["0.10", "0.20", "0.29"])).toBe("0.59");
    expect(sumMoney([])).toBe("0.00");
  });
});

describe("lineTax", () => {
  it("is zero for exempt healthcare either way", () => {
    expect(lineTax(150000, TAX_RATE_BY_CLASS.exempt_healthcare, true)).toEqual({ unit: 150000, tax: 0, total: 150000 });
    expect(lineTax(150000, TAX_RATE_BY_CLASS.exempt_healthcare, false)).toEqual({ unit: 150000, tax: 0, total: 150000 });
  });

  it("tax-inclusive: the patient pays the quoted price, tax is carved out of it", () => {
    // ₹10,000 whitening at 18%: 10000 × 18/118 = 1525.4237… → 1525.42
    expect(lineTax(1_000_000, TAX_RATE_BY_CLASS.gst_18, true)).toEqual({ unit: 847_458, tax: 152_542, total: 1_000_000 });
  });

  it("tax-exclusive: tax is added on top", () => {
    expect(lineTax(1_000_000, TAX_RATE_BY_CLASS.gst_18, false)).toEqual({ unit: 1_000_000, tax: 180_000, total: 1_180_000 });
    // ₹12,000 crown at 5%
    expect(lineTax(1_200_000, TAX_RATE_BY_CLASS.gst_5, false)).toEqual({ unit: 1_200_000, tax: 60_000, total: 1_260_000 });
  });

  it("rounds half up to the paisa", () => {
    // ₹0.10 at 5% exclusive = 0.5 paise → 1 paisa
    expect(lineTax(10, TAX_RATE_BY_CLASS.gst_5, false).tax).toBe(1);
    // ₹0.09 at 5% exclusive = 0.45 paise → 0
    expect(lineTax(9, TAX_RATE_BY_CLASS.gst_5, false).tax).toBe(0);
  });

  it("always satisfies unit + tax = total", () => {
    for (const price of [1, 99, 12345, 999_999, 4_567_891]) {
      for (const rate of Object.values(TAX_RATE_BY_CLASS)) {
        for (const inclusive of [true, false]) {
          const { unit, tax, total } = lineTax(price, rate, inclusive);
          expect(unit + tax).toBe(total);
        }
      }
    }
  });
});

describe("splitCgstSgst", () => {
  it("halves the tax, the second half taking the odd paisa, so the parts always add up", () => {
    expect(splitCgstSgst(152_542)).toEqual({ cgst: 76_271, sgst: 76_271 });
    expect(splitCgstSgst(101)).toEqual({ cgst: 50, sgst: 51 });
    expect(splitCgstSgst(0)).toEqual({ cgst: 0, sgst: 0 });
  });
});
