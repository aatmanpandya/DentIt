import { describe, it, expect } from "vitest";
import { SOCKETS, socketForFdi, adjacentTooth, resolveSocketTooth } from "./tooth-grid";

describe("SOCKETS", () => {
  it("has 32 canonical positions", () => {
    expect(SOCKETS).toHaveLength(32);
  });

  it("gives molar positions no primary pair, and incisor/canine/premolar positions one", () => {
    expect(socketForFdi("18")?.primaryFdi).toBeNull();
    expect(socketForFdi("17")?.primaryFdi).toBeNull();
    expect(socketForFdi("16")?.primaryFdi).toBeNull();
    expect(socketForFdi("15")?.primaryFdi).toBe("55");
    expect(socketForFdi("11")?.primaryFdi).toBe("51");
  });

  it("resolves a socket by either its permanent or primary FDI code", () => {
    expect(socketForFdi("15")).toBe(socketForFdi("55"));
  });
});

describe("adjacentTooth", () => {
  it("crosses the midline seamlessly in both arches", () => {
    expect(adjacentTooth("11", "right")).toBe("21");
    expect(adjacentTooth("21", "left")).toBe("11");
    expect(adjacentTooth("41", "right")).toBe("31");
    expect(adjacentTooth("31", "left")).toBe("41");
  });

  it("does not wrap around at arch ends", () => {
    expect(adjacentTooth("18", "left")).toBeNull();
    expect(adjacentTooth("28", "right")).toBeNull();
    expect(adjacentTooth("48", "left")).toBeNull();
    expect(adjacentTooth("38", "right")).toBeNull();
  });

  it("flips arch at the same column, up and down", () => {
    expect(adjacentTooth("18", "down")).toBe("48");
    expect(adjacentTooth("48", "up")).toBe("18");
    expect(adjacentTooth("28", "down")).toBe("38");
    expect(adjacentTooth("11", "down")).toBe("41");
  });

  it("does not wrap around at row edges", () => {
    expect(adjacentTooth("11", "up")).toBeNull();
    expect(adjacentTooth("41", "down")).toBeNull();
  });

  it("returns null for a tooth that isn't a real socket", () => {
    expect(adjacentTooth("99", "left")).toBeNull();
  });
});

describe("resolveSocketTooth", () => {
  const socket = socketForFdi("15")!; // upper-right 2nd premolar / primary 2nd molar pair
  const molarSocket = socketForFdi("16")!; // no primary pair

  it("shows the primary tooth by default in mixed view", () => {
    expect(resolveSocketTooth(socket, {}, "mixed")).toBe("55");
  });

  it("falls through to the permanent tooth once the primary is exfoliated", () => {
    expect(resolveSocketTooth(socket, { 55: { isExfoliated: true, isMissing: false, isUnerupted: false } }, "mixed")).toBe("15");
  });

  it("falls through to the permanent tooth once the primary is pathologically missing", () => {
    expect(resolveSocketTooth(socket, { 55: { isExfoliated: false, isMissing: true, isUnerupted: false } }, "mixed")).toBe("15");
  });

  it("leaves the socket empty when the primary is gone and the permanent hasn't erupted", () => {
    expect(
      resolveSocketTooth(
        socket,
        { 55: { isExfoliated: true, isMissing: false, isUnerupted: false }, 15: { isExfoliated: false, isMissing: false, isUnerupted: true } },
        "mixed",
      ),
    ).toBeNull();
  });

  it("goes straight to the unerupted check for a molar position with no primary pair", () => {
    expect(resolveSocketTooth(molarSocket, { 16: { isExfoliated: false, isMissing: false, isUnerupted: true } }, "mixed")).toBeNull();
    expect(resolveSocketTooth(molarSocket, {}, "mixed")).toBe("16");
  });

  it("adult view forces the permanent tooth regardless of markers", () => {
    expect(resolveSocketTooth(socket, {}, "adult")).toBe("15");
  });

  it("primary view forces the primary tooth (or null where there is none) regardless of markers", () => {
    expect(resolveSocketTooth(socket, { 55: { isExfoliated: true, isMissing: false, isUnerupted: false } }, "primary")).toBe("55");
    expect(resolveSocketTooth(molarSocket, {}, "primary")).toBeNull();
  });
});
