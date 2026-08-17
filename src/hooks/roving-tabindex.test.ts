import { describe, it, expect } from "vitest";
import { rovingIntentForKey } from "./roving-tabindex";

describe("rovingIntentForKey", () => {
  it("maps arrow keys to move intents", () => {
    expect(rovingIntentForKey("ArrowLeft")).toEqual({ kind: "move", direction: "left" });
    expect(rovingIntentForKey("ArrowRight")).toEqual({ kind: "move", direction: "right" });
    expect(rovingIntentForKey("ArrowUp")).toEqual({ kind: "move", direction: "up" });
    expect(rovingIntentForKey("ArrowDown")).toEqual({ kind: "move", direction: "down" });
  });

  it("maps Enter and Space to activate", () => {
    expect(rovingIntentForKey("Enter")).toEqual({ kind: "activate" });
    expect(rovingIntentForKey(" ")).toEqual({ kind: "activate" });
  });

  it("maps Escape to close", () => {
    expect(rovingIntentForKey("Escape")).toEqual({ kind: "close" });
  });

  it("returns null for keys the grid doesn't handle", () => {
    expect(rovingIntentForKey("Tab")).toBeNull();
    expect(rovingIntentForKey("a")).toBeNull();
  });
});
