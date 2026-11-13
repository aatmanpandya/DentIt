/**
 * Scores the voice grammar against evals/voice/cases.json (docs/specs/voice-perio.md, Evals).
 * Shared by `npm run eval:voice` (prints the report) and grammar.test.ts (CI).
 *
 * Three outcomes per case:
 *  - exact:  wrote exactly the expected commands, or wrote nothing when nothing was expected;
 *  - missed: wrote nothing when something was expected — safe, the dentist says it again;
 *  - wrong:  wrote something other than expected — the number that must stay at zero.
 */
import { parseAlternatives, type VoiceCommand } from "./grammar";

export interface EvalCase {
  id: string;
  category: string;
  said: string;
  alternatives: string[];
  expect: VoiceCommand[] | null;
}

export interface CaseResult {
  c: EvalCase;
  outcome: "exact" | "missed" | "wrong";
  got: VoiceCommand[] | null;
  reason?: string;
}

export function scoreCase(c: EvalCase): CaseResult {
  const r = parseAlternatives(c.alternatives);
  const got = r.ok ? r.commands : null;
  if (!got) return { c, outcome: c.expect === null ? "exact" : "missed", got, reason: r.ok ? undefined : r.reason };
  return { c, outcome: JSON.stringify(got) === JSON.stringify(c.expect) ? "exact" : "wrong", got };
}

export function summarise(results: CaseResult[]) {
  const by = new Map<string, { n: number; exact: number }>();
  for (const r of results) {
    const b = by.get(r.c.category) ?? { n: 0, exact: 0 };
    b.n++;
    if (r.outcome === "exact") b.exact++;
    by.set(r.c.category, b);
  }
  return {
    n: results.length,
    exact: results.filter((r) => r.outcome === "exact").length,
    missed: results.filter((r) => r.outcome === "missed"),
    wrong: results.filter((r) => r.outcome === "wrong"),
    byCategory: [...by.entries()].sort(),
  };
}
