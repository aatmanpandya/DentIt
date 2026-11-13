// npm run eval:voice — exact-match accuracy of the voice grammar, overall and by category, and
// the count of wrong values written (target 0). docs/specs/voice-perio.md, Evals.
import { readFileSync } from "node:fs";
import { scoreCase, summarise, type EvalCase } from "../src/lib/voice/eval";

const { cases } = JSON.parse(readFileSync("evals/voice/cases.json", "utf8")) as { cases: EvalCase[] };
const results = cases.map(scoreCase);
const s = summarise(results);
const pct = (a: number, b: number) => `${((100 * a) / b).toFixed(0)}%`;

console.log(`Voice grammar: ${s.exact}/${s.n} exact (${pct(s.exact, s.n)})`);
for (const [cat, b] of s.byCategory) console.log(`  ${cat.padEnd(13)} ${String(b.exact).padStart(2)}/${String(b.n).padEnd(2)} ${pct(b.exact, b.n)}`);
console.log(`Wrong values written: ${s.wrong.length}`);
for (const r of s.wrong) console.log(`  WRONG ${r.c.id} "${r.c.said}" heard ${JSON.stringify(r.c.alternatives)} → ${JSON.stringify(r.got)}`);
console.log(`Missed (wrote nothing, safe): ${s.missed.length}`);
for (const r of s.missed) console.log(`  missed ${r.c.id} "${r.c.said}" heard ${JSON.stringify(r.c.alternatives)} — ${r.reason}`);
if (s.wrong.length > 0) process.exit(1);
