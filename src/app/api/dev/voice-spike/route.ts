import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { errorResponse } from "@/server/lib/api-error";

/**
 * Dev-only: saves a /dev/voice-spike reading session to evals/voice/spike-results/ so the
 * transcripts can be scored offline (docs/specs/voice-perio.md). Not part of the product API —
 * 404 outside `next dev`, and it only ever writes inside that one folder.
 */
export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV !== "development") return errorResponse(404, "NOT_FOUND", "Not found.");
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.results)) return errorResponse(422, "VALIDATION_FAILED", "Expected { results: [] }.");
  const dir = join(process.cwd(), "evals", "voice", "spike-results");
  await mkdir(dir, { recursive: true });
  const name = `${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  await writeFile(join(dir, name), JSON.stringify(body, null, 2));
  return NextResponse.json({ saved: `evals/voice/spike-results/${name}` });
}
