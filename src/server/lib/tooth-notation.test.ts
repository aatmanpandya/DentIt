import { describe, it, expect } from "vitest";
import {
  fdiToUniversal,
  universalToFdi,
  isValidFdiTooth,
  isPrimaryTooth,
  hasFurcation,
  validSurfacesForTooth,
} from "./tooth-notation";

describe("tooth notation", () => {
  it("converts permanent teeth FDI <-> Universal", () => {
    expect(fdiToUniversal("18")).toBe("1");
    expect(fdiToUniversal("11")).toBe("8");
    expect(fdiToUniversal("48")).toBe("32");
    expect(universalToFdi("1")).toBe("18");
    expect(universalToFdi("32")).toBe("48");
  });

  it("converts primary teeth FDI <-> Universal", () => {
    expect(fdiToUniversal("55")).toBe("A");
    expect(fdiToUniversal("85")).toBe("T");
    expect(universalToFdi("A")).toBe("55");
  });

  it("round-trips every valid FDI code", () => {
    const permanent = ["18","17","16","15","14","13","12","11","21","22","23","24","25","26","27","28","38","37","36","35","34","33","32","31","41","42","43","44","45","46","47","48"];
    for (const fdi of permanent) {
      expect(universalToFdi(fdiToUniversal(fdi))).toBe(fdi);
    }
  });

  it("rejects invalid codes", () => {
    expect(isValidFdiTooth("99")).toBe(false);
    expect(isValidFdiTooth("11")).toBe(true);
    expect(() => fdiToUniversal("99")).toThrow();
  });

  it("identifies primary teeth", () => {
    expect(isPrimaryTooth("55")).toBe(true);
    expect(isPrimaryTooth("11")).toBe(false);
  });

  it("flags furcation only on multi-rooted teeth", () => {
    expect(hasFurcation("16")).toBe(true); // upper molar
    expect(hasFurcation("14")).toBe(true); // upper first premolar
    expect(hasFurcation("13")).toBe(false); // canine
    expect(hasFurcation("11")).toBe(false); // incisor
  });

  it("gives incisal surface to anteriors, occlusal to posteriors", () => {
    expect(validSurfacesForTooth("11")).toContain("I");
    expect(validSurfacesForTooth("11")).not.toContain("O");
    expect(validSurfacesForTooth("16")).toContain("O");
    expect(validSurfacesForTooth("16")).not.toContain("I");
  });
});
