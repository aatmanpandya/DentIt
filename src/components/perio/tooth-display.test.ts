import { describe, it, expect } from "vitest";
import { fdiToUniversal, renderTooth } from "./tooth-display";

describe("tooth-display", () => {
  it("converts permanent teeth FDI -> Universal", () => {
    expect(fdiToUniversal("18")).toBe("1");
    expect(fdiToUniversal("11")).toBe("8");
    expect(fdiToUniversal("48")).toBe("32");
  });

  it("converts primary teeth FDI -> Universal", () => {
    expect(fdiToUniversal("55")).toBe("A");
    expect(fdiToUniversal("85")).toBe("T");
  });

  it("renderTooth passes FDI through unchanged when display is fdi", () => {
    expect(renderTooth("46", "fdi")).toBe("46");
  });

  it("renderTooth converts when display is universal", () => {
    expect(renderTooth("46", "universal")).toBe("30");
    expect(renderTooth("55", "universal")).toBe("A");
  });

  it("falls back to the raw code for an unmapped input instead of throwing", () => {
    expect(fdiToUniversal("99")).toBe("99");
  });
});
