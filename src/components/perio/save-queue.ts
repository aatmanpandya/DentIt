/**
 * Per-key save queue for the perio grid: never lose a tooth, and never let an older save win.
 *
 * Replaces the per-call retry in use-perio-entry.ts, which had two holes (docs/bug-log.md
 * entry 36): an older save still in flight could fail and retry *after* a newer save for the
 * same tooth, or simply arrive later, overwriting the newer data on the server; and a skip
 * toggle shared the tooth's retry slot, so toggling skip cancelled a pending measurement retry.
 *
 * Here each key runs one save at a time. A new save for a key replaces any that hasn't run
 * yet; one already in flight finishes first, and if it fails while a newer one is waiting it
 * isn't retried. The newest save for a key is always the last one sent. Failures retry with
 * capped exponential backoff (the grid's no-modal rule, docs/specs/validation-and-errors.md).
 * Pure TypeScript, no React, so it's unit-testable with fake timers.
 */
export type SaveStatus = "saving" | "retrying" | "saved";

const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30000;

interface KeyState {
  generation: number;
  latest: () => Promise<unknown>;
  running: boolean;
  attempt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export function createSaveQueue(opts: { onStatus: (key: string, status: SaveStatus) => void; onSaved: (key: string) => void }) {
  const keys = new Map<string, KeyState>();
  let cancelled = false;

  function run(key: string) {
    const k = keys.get(key);
    if (!k || cancelled) return;
    k.running = true;
    k.timer = null;
    const generation = k.generation;
    opts.onStatus(key, k.attempt === 0 ? "saving" : "retrying");
    k.latest().then(
      () => {
        if (cancelled) return;
        if (k.generation !== generation) {
          k.attempt = 0;
          run(key); // a newer save arrived while this one was in flight: send it now
          return;
        }
        k.running = false;
        k.attempt = 0;
        opts.onStatus(key, "saved");
        opts.onSaved(key);
      },
      () => {
        if (cancelled) return;
        if (k.generation !== generation) {
          k.attempt = 0;
          run(key); // superseded: don't retry the stale payload, send the newer one
          return;
        }
        k.attempt += 1;
        const delay = Math.min(RETRY_BASE_MS * 2 ** (k.attempt - 1), RETRY_MAX_MS);
        k.timer = setTimeout(() => run(key), delay);
      },
    );
  }

  return {
    save(key: string, fn: () => Promise<unknown>) {
      const existing = keys.get(key);
      if (existing) {
        existing.generation += 1;
        existing.latest = fn;
        if (existing.timer) {
          // waiting to retry an older payload: send the new one now instead
          clearTimeout(existing.timer);
          existing.attempt = 0;
          run(key);
        } else if (!existing.running) {
          existing.attempt = 0;
          run(key);
        }
        return; // in flight: run() picks up the newer payload when it settles
      }
      keys.set(key, { generation: 0, latest: fn, running: false, attempt: 0, timer: null });
      run(key);
    },
    cancelAll() {
      cancelled = true;
      for (const k of keys.values()) if (k.timer) clearTimeout(k.timer);
    },
  };
}
