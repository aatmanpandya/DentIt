"use client";

import { useEffect, useRef, useState } from "react";
import callouts from "../../../../evals/voice/spike-callouts.json";

/**
 * Speech-to-text reading test (docs/specs/voice-perio.md, "Feasibility"). One person reads 30
 * clinic-style callouts into Chrome's built-in recognition (en-IN); every alternative Chrome
 * returns is kept, and the session is saved to evals/voice/spike-results/ for offline scoring.
 * Dev only — the save route 404s outside `next dev`. Not linked from the app.
 */

type Alt = { transcript: string; confidence: number };
type Result = { id: string; say: string; expect: string[]; alternatives: Alt[]; error: string | null; ms: number };

// Chrome exposes the API prefixed; it isn't in TypeScript's DOM lib.
type Recognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<Alt> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function makeRecognition(): Recognition | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export default function VoiceSpikePage() {
  const lines = callouts.lines;
  const [index, setIndex] = useState(0);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [results, setResults] = useState<Record<string, Result>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const recRef = useRef<Recognition | null>(null);
  const startedAt = useRef(0);

  const line = lines[index];
  const done = Object.keys(results).length;

  function record() {
    if (listening) return;
    const rec = makeRecognition();
    if (!rec) {
      setSupported(false);
      return;
    }
    rec.lang = "en-IN";
    rec.interimResults = true;
    rec.maxAlternatives = 5;
    rec.continuous = false;
    const current = line;
    let finalAlts: Alt[] = [];
    let error: string | null = null;
    rec.onresult = (e) => {
      const r = e.results[e.results.length - 1];
      if (r.isFinal) finalAlts = Array.from(r).map((a) => ({ transcript: a.transcript, confidence: a.confidence }));
      else setInterim(r[0].transcript);
    };
    rec.onerror = (e) => {
      error = e.error;
    };
    rec.onend = () => {
      setListening(false);
      setInterim("");
      setResults((prev) => ({
        ...prev,
        [current.id]: { id: current.id, say: current.say, expect: current.expect, alternatives: finalAlts, error, ms: Date.now() - startedAt.current },
      }));
    };
    recRef.current = rec;
    startedAt.current = Date.now();
    setListening(true);
    rec.start();
  }

  async function save() {
    const res = await fetch("/api/dev/voice-spike", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recorded_at: new Date().toISOString(), lang: "en-IN", user_agent: navigator.userAgent, results: Object.values(results) }),
    });
    const body = await res.json();
    setSaved(res.ok ? body.saved : `Save failed: ${body?.error?.message ?? res.status}`);
  }

  // Space records, Enter / → next, ← previous.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === " ") {
        e.preventDefault();
        record();
      } else if (e.key === "Enter" || e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, lines.length - 1));
      else if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const heard = results[line.id];

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 bg-paper px-6 py-10 text-ink">
      <header className="flex items-baseline justify-between">
        <h1 className="text-[18px] font-medium">Voice reading test</h1>
        <span className="font-data text-[12px] text-ink-soft">
          {done} / {lines.length} recorded
        </span>
      </header>

      {!supported && (
        <p className="text-[13px] text-bleed">This browser has no built-in speech recognition. Open this page in Google Chrome.</p>
      )}

      <p className="text-[13px] text-ink-soft">
        Read each line once, the way you&apos;d call it out in clinic. Press <kbd className="font-data">Space</kbd> (or the button), speak,
        then pause; it stops by itself. <kbd className="font-data">Enter</kbd> goes to the next line. Re-record any line by pressing Space again.
      </p>

      <section className="flex flex-col items-center gap-4 rounded-[var(--radius)] border border-rule bg-surface px-6 py-10">
        <span className="font-data text-[12px] text-ink-soft">
          Line {index + 1} of {lines.length} · {line.category.replace("_", " ")}
        </span>
        <p className="text-center text-[28px] font-medium">&ldquo;{line.say}&rdquo;</p>
        <button
          type="button"
          onClick={record}
          disabled={listening || !supported}
          className="h-10 rounded-[var(--radius)] bg-steel px-5 text-[13px] font-medium text-white disabled:opacity-60"
        >
          {listening ? "Listening…" : heard ? "Record again" : "Record"}
        </button>
        <p className="min-h-[20px] font-data text-[13px] text-ink-soft">
          {listening ? interim || "…" : heard ? (heard.error ? `Error: ${heard.error}` : `Heard: ${heard.alternatives[0]?.transcript ?? "(nothing)"}`) : ""}
        </p>
        <div className="flex gap-3 text-[13px]">
          <button type="button" onClick={() => setIndex((i) => Math.max(i - 1, 0))} className="text-steel hover:underline">
            ← Previous
          </button>
          <button type="button" onClick={() => setIndex((i) => Math.min(i + 1, lines.length - 1))} className="text-steel hover:underline">
            Next →
          </button>
        </div>
      </section>

      <footer className="flex items-center justify-between">
        <span className="text-[12px] text-ink-soft">{saved}</span>
        <button
          type="button"
          onClick={save}
          disabled={done === 0}
          className="h-9 rounded-[var(--radius)] border border-rule px-4 text-[13px] font-medium hover:bg-steel-lo disabled:opacity-50"
        >
          Save results
        </button>
      </footer>
    </main>
  );
}
