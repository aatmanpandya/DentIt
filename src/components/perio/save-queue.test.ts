import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSaveQueue } from "./save-queue";

// Bugs 1 and 3 of the perio save flow (docs/bug-log.md entry 36).
function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createSaveQueue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a failed older save is not retried once a newer save for the same key exists", async () => {
    const written: string[] = [];
    const first = deferred();
    const q = createSaveQueue({ onStatus: () => {}, onSaved: () => {} });

    q.save("16", () => first.promise.then(() => void written.push("old")));
    q.save("16", async () => void written.push("new"));
    first.reject(new Error("network"));
    await vi.runAllTimersAsync();

    expect(written).toEqual(["new"]);
  });

  it("never lets an older in-flight save land after a newer one", async () => {
    const written: string[] = [];
    const first = deferred();
    const q = createSaveQueue({ onStatus: () => {}, onSaved: () => {} });

    q.save("16", () => first.promise.then(() => void written.push("old")));
    q.save("16", async () => void written.push("new"));
    first.resolve();
    await vi.runAllTimersAsync();

    expect(written.at(-1)).toBe("new");
  });

  it("retries a failing save with backoff until it succeeds", async () => {
    let calls = 0;
    const saved = vi.fn();
    const q = createSaveQueue({ onStatus: () => {}, onSaved: saved });

    q.save("16", async () => {
      calls++;
      if (calls < 3) throw new Error("network");
    });
    await vi.runAllTimersAsync();

    expect(calls).toBe(3);
    expect(saved).toHaveBeenCalledTimes(1);
  });

  it("keeps keys independent: a skip toggle doesn't cancel a tooth's measurement retry", async () => {
    const written: string[] = [];
    let measurementCalls = 0;
    const q = createSaveQueue({ onStatus: () => {}, onSaved: () => {} });

    q.save("16", async () => {
      measurementCalls++;
      if (measurementCalls === 1) throw new Error("network");
      written.push("measurement");
    });
    q.save("16:skip", async () => void written.push("skip"));
    await vi.runAllTimersAsync();

    expect(written).toContain("measurement");
    expect(written).toContain("skip");
  });

  it("reports saving, retrying and saved for the key", async () => {
    const statuses: string[] = [];
    let calls = 0;
    const q = createSaveQueue({ onStatus: (_k, s) => statuses.push(s), onSaved: () => {} });

    q.save("16", async () => {
      if (++calls === 1) throw new Error("network");
    });
    await vi.runAllTimersAsync();

    expect(statuses).toEqual(["saving", "retrying", "saved"]);
  });

  it("cancel stops pending retries", async () => {
    let calls = 0;
    const q = createSaveQueue({ onStatus: () => {}, onSaved: () => {} });
    q.save("16", async () => {
      calls++;
      throw new Error("network");
    });
    await vi.advanceTimersByTimeAsync(0);
    q.cancelAll();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(1);
  });
});
