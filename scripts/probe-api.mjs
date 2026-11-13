// Sends malformed input to every API route and reports any 5xx or non-JSON response.
// Routes are read from src/app/api/v1, so new ones are covered automatically.
//
//   npm run dev        (in another terminal, against seeded demo data)
//   npm run probe:api  [email]     defaults to the demo owner
//
// It never sends a valid body or a real id, so it can't change data. Exits 1 on any finding.
// Added 13 Nov after this found 50-odd routes answering a bad id or bad JSON with a 500
// (docs/bug-log.md entry 35).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.PROBE_BASE ?? "http://localhost:3000";
const ROOT = "src/app/api/v1";
// Accepts an empty body as a valid request — probing it would import the starter catalogue.
const SKIP = new Set(["/procedure-codes/import-starter"]);

function routes(dir, prefix = "") {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...routes(p, `${prefix}/${name}`));
    else if (name === "route.ts") {
      const methods = [...readFileSync(p, "utf8").matchAll(/export (?:async function|const) (GET|POST|PATCH|PUT|DELETE)\b/g)].map((m) => m[1]);
      out.push({ path: prefix, methods });
    }
  }
  return out;
}

const login = await fetch(`${BASE}/api/v1/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: process.argv[2] ?? "nimisha@sumandental.test", password: "DemoPassword123" }),
});
if (!login.ok) throw new Error(`login failed: ${login.status} — is the dev server running and the demo seeded?`);
const H = { authorization: `Bearer ${(await login.json()).access_token}` };

const ids = ["not-a-uuid", "00000000-0000-0000-0000-000000000000", "1", "%27", "ffffffff-ffff-ffff-ffff-ffffffffffffff"];
const teeth = ["99", "abc", "18", "0", "18"];
const queries = ["", "?limit=-1", "?limit=abc&offset=-5", "?q=%25%5F%27", "?date=garbage&from=x&to=y&start=x&end=y", "?patient_id=bad&location_id=bad&provider_id=bad&charted_procedure_ids=bad", "?date=2026-02-30&from=2026-13-01&to=2026-01-01", "?limit=99999999999999999999", "?active=maybe&status=nope"];
const big = 1e30;
const z = ids[1];
const bodies = [
  null,
  "{bad json",
  "[]",
  "{}",
  JSON.stringify({ amount: big, price: big, quantity: big, name: "x".repeat(20000), reason: "x".repeat(20000), patient_id: "bad", invoice_id: "bad", location_id: "bad", starts_at: "garbage", tooth: 999, status: "nope", allocations: "x", prices: [1], charted_procedure_ids: "x" }),
  JSON.stringify({ amount: "-0", reason: "", method: "cash", patient_id: z, location_id: z, allocations: [{ invoice_id: z, amount: "1e5" }] }),
  JSON.stringify({ amount: "99999999.999", adjustment_type: "discount", invoice_id: z, reason: "x" }),
  JSON.stringify({ starts_at: "2026-11-13T10:00:00", ends_at: "2026-11-13T09:00:00Z", operatory_id: z, patient_id: z, provider_id: z, appointment_type_id: z, location_id: z }),
  JSON.stringify({ to: "nope", status: "completed", reason: null }),
  JSON.stringify({ pocket_depths: [99, -1, "a"], recession: Array(50).fill(1), bleeding: "y", mobility: 9, furcation: {} }),
];

const findings = [];
let sent = 0;
for (const { path, methods } of routes(ROOT)) {
  if (SKIP.has(path)) continue;
  const paths = path.includes("[") ? ids.map((id, i) => path.replace("[id]", encodeURIComponent(id)).replace(/\[[a-zA-Z]+\]/g, teeth[i])) : [path];
  for (const p of paths)
    for (const m of methods) {
      const cases = m === "GET" || m === "DELETE" ? queries.map((q) => [p + q, null]) : bodies.map((b) => [p, b]);
      for (const [url, body] of cases) {
        if (p.includes("[") || (m === "DELETE" && !path.includes("["))) continue; // never DELETE a collection
        sent++;
        const res = await fetch(`${BASE}/api/v1${url}`, { method: m, headers: { ...H, ...(body != null ? { "content-type": "application/json" } : {}) }, body: body ?? undefined });
        const text = await res.text();
        const json = text.trim().startsWith("{") || text.trim().startsWith("[");
        if (res.status >= 500 || (!json && res.status !== 204)) findings.push(`${res.status} ${m} ${url} ${String(body).slice(0, 60)} => ${text.slice(0, 120)}`);
      }
    }
}
console.log(`${sent} requests, ${findings.length} findings`);
if (findings.length) {
  console.log(findings.join("\n"));
  process.exit(1);
}
