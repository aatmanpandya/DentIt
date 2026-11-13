import { NextRequest, NextResponse } from "next/server";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { errorResponse } from "@/server/lib/api-error";

/**
 * Dev-only: appends one dictated phrase (Chrome's guesses, the reading used, the outcome) to
 * evals/voice/session-log.jsonl, so live dictation can be reviewed and turned into eval cases
 * (docs/specs/voice-perio.md). 404 outside `next dev`; demo patients only.
 */
export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV !== "development") return errorResponse(404, "NOT_FOUND", "Not found.");
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.alternatives)) return errorResponse(422, "VALIDATION_FAILED", "Expected { alternatives: [] }.");
  const dir = join(process.cwd(), "evals", "voice");
  await mkdir(dir, { recursive: true });
  await appendFile(join(dir, "session-log.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...body }) + "\n");
  return NextResponse.json({ ok: true });
}
