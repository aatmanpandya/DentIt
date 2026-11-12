import { describe, it, expect } from "vitest";
import { formatRupees, addMoney } from "./format-money";

describe("formatRupees", () => {
  it("groups the Indian way: thousands, then pairs", () => {
    expect(formatRupees("300.00")).toBe("₹300.00");
    expect(formatRupees("1500.00")).toBe("₹1,500.00");
    expect(formatRupees("150000.5")).toBe("₹1,50,000.50");
    expect(formatRupees("12345678.90")).toBe("₹1,23,45,678.90");
    expect(formatRupees("-500.00")).toBe("−₹500.00");
    expect(formatRupees(null)).toBe("—");
  });
});

describe("addMoney", () => {
  it("adds decimal strings exactly", () => {
    expect(addMoney(["0.10", "0.20", "0.29"])).toBe("0.59");
    expect(addMoney(["1500", "-200.50"])).toBe("1299.50");
    expect(addMoney([])).toBe("0.00");
  });
});
