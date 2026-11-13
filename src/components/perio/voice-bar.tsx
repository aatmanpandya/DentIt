"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Mic, MicOff, Undo2 } from "lucide-react";
import { createWebSpeech, speechSupported, type SpeechToText } from "@/lib/voice/stt";
import { parseAlternatives } from "@/lib/voice/grammar";
import { planPhrase, INITIAL_VOICE_STATE, type ToothChange, type VoiceState } from "./voice-apply";
import { buildRoute, type ProbingRoute } from "./voice-route";
import { hasFurcation } from "./tooth-furcation";
import type { PerioSiteCode, ToothDraft } from "./perio-entry";

export interface VoiceCell {
  tooth: string;
  site: PerioSiteCode | null;
}

interface Props {
  activeOrder: string[];
  disabled: boolean;
  knownDraft: (tooth: string) => ToothDraft;
  applyVoice: (changes: ToothChange[], skips: string[]) => void;
  restoreVoice: (changes: ToothChange[], skips: string[]) => void;
  onHighlight: (cells: VoiceCell[]) => void;
  renderTooth: (tooth: string) => string;
}

interface Heard {
  text: string;
  ok: boolean;
  note: string;
}

const ROUTE_KEY = "dentit.voiceRoute";
const ROUTE_LABEL: Record<ProbingRoute, string> = { outside_first: "Outside first", each_jaw: "Each jaw first" };

function readRoute(): ProbingRoute {
  try {
    return window.localStorage.getItem(ROUTE_KEY) === "each_jaw" ? "each_jaw" : "outside_first";
  } catch {
    return "outside_first";
  }
}

/**
 * Voice entry for the perio grid (docs/specs/voice-perio.md): Chrome hears, the grammar reads,
 * the planner works the phrase out through the entry reducer, and the grid's hook saves it — or
 * nothing is written and the heard text shows red with the reason. "Undo" takes back the whole
 * last phrase. The route is remembered per device for the pilot.
 */
export function VoiceBar({ activeOrder, disabled, knownDraft, applyVoice, restoreVoice, onHighlight, renderTooth }: Props) {
  const [supported] = useState(speechSupported);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [heard, setHeard] = useState<Heard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<ProbingRoute>(readRoute);
  const [voice, setVoice] = useState<VoiceState>(INITIAL_VOICE_STATE);
  const [history, setHistory] = useState<{ changes: ToothChange[]; skips: string[]; voiceBefore: VoiceState; text: string; cells: VoiceCell[] }[]>([]);
  const [showHelp, setShowHelp] = useState(false);
  const sttRef = useRef<SpeechToText | null>(null);

  const steps = useMemo(() => buildRoute(route, activeOrder), [route, activeOrder]);
  const next = voice.cursor ? steps.find((s) => s.tooth === voice.cursor?.tooth && s.side === voice.cursor?.side) : steps[0];

  function undo() {
    const last = history[history.length - 1];
    if (!last) {
      setHeard({ text: "undo", ok: false, note: "Nothing to undo." });
      return;
    }
    restoreVoice(last.changes, last.skips);
    setVoice(last.voiceBefore);
    setHistory((h) => h.slice(0, -1));
    setHeard({ text: "undo", ok: true, note: `Took back “${last.text}”.` });
    onHighlight(last.cells);
  }

  // Development only: every phrase goes to evals/voice/session-log.jsonl for review.
  function logPhrase(alternatives: string[], outcome: string, note: string) {
    if (process.env.NODE_ENV !== "development") return;
    void fetch("/api/dev/voice-log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alternatives, outcome, note, next: next ? `${next.tooth} ${next.side}` : null, route }),
    }).catch(() => {});
  }

  function handlePhrase(alternatives: string[]) {
    setInterim("");
    const parsed = parseAlternatives(alternatives);
    const text = parsed.ok && parsed.used ? parsed.used : (alternatives[0] ?? "");
    if (!parsed.ok) {
      setHeard({ text, ok: false, note: `${parsed.reason} Nothing written.` });
      logPhrase(alternatives, "rejected", parsed.reason);
      return;
    }
    if (parsed.commands[0].type === "undo") {
      logPhrase(alternatives, "undo", "");
      undo();
      return;
    }
    const plan = planPhrase(parsed.commands, voice, { steps, draftFor: knownDraft, hasFurcation });
    if (!plan.ok) {
      setHeard({ text, ok: false, note: `${plan.reason} Nothing written.` });
      logPhrase(alternatives, "rejected", plan.reason);
      return;
    }
    logPhrase(alternatives, "written", JSON.stringify(parsed.commands));
    applyVoice(plan.changes, plan.skips);
    setHistory((h) => [...h.slice(-49), { changes: plan.changes, skips: plan.skips, voiceBefore: voice, text, cells: plan.cells }]);
    setVoice(plan.voice);
    setHeard({ text, ok: true, note: plan.changes.length + plan.skips.length === 0 ? "Already recorded." : "" });
    onHighlight(plan.cells);
  }

  // The recogniser is created once per listening session; its callbacks must see the latest
  // state, so they go through a ref updated after every render.
  const handleRef = useRef(handlePhrase);
  useEffect(() => {
    handleRef.current = handlePhrase;
  });

  useEffect(() => () => sttRef.current?.stop(), []);

  // Development only: feed a phrase in as if Chrome had heard it, so the whole path (grammar →
  // planner → save → undo) can be exercised without a microphone, e.g. by browser automation.
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const w = window as unknown as { __dentitVoice?: (heard: string | string[]) => void };
    w.__dentitVoice = (heard) => handleRef.current(Array.isArray(heard) ? heard : [heard]);
    return () => {
      delete w.__dentitVoice;
    };
  }, []);

  function toggle() {
    if (listening) {
      sttRef.current?.stop();
      return;
    }
    setError(null);
    const stt = createWebSpeech({
      onInterim: setInterim,
      onFinal: (alts) => handleRef.current(alts),
      onError: setError,
      onListeningChange: setListening,
    });
    sttRef.current = stt;
    stt?.start();
  }

  if (!supported) {
    return <p className="text-[12px] text-ink-soft">Voice entry needs Google Chrome.</p>;
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-DEFAULT border border-rule bg-surface px-3 py-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          disabled={disabled}
          aria-pressed={listening}
          className={clsx(
            "flex h-8 items-center gap-1.5 rounded-DEFAULT px-3 text-[12px] font-medium disabled:opacity-50",
            listening ? "bg-bleed text-white" : "bg-steel text-white hover:opacity-90",
          )}
        >
          {listening ? <MicOff size={14} /> : <Mic size={14} />}
          {listening ? "Stop listening" : "Dictate"}
        </button>
        <span className="font-data text-[12px] text-ink">
          {next ? (
            <>
              Next: <span className="font-medium">{renderTooth(next.tooth)}</span> {next.side}
              {voice.cursor && voice.cursor.offset > 0 && voice.cursor.offset < 3 ? ` · site ${voice.cursor.offset + 1}` : ""}
            </>
          ) : (
            "Route finished"
          )}
        </span>
        <button
          type="button"
          onClick={undo}
          disabled={history.length === 0}
          className="flex items-center gap-1 text-[12px] text-steel hover:underline disabled:text-ink-soft disabled:no-underline"
        >
          <Undo2 size={13} /> Undo last phrase
        </button>
        <label className="ml-auto flex items-center gap-1 text-[12px] text-ink-soft">
          Route
          <select
            value={route}
            onChange={(e) => {
              const r = e.target.value as ProbingRoute;
              setRoute(r);
              setVoice(INITIAL_VOICE_STATE);
              try {
                window.localStorage.setItem(ROUTE_KEY, r);
              } catch {
                // per-device convenience only
              }
            }}
            className="rounded-DEFAULT border border-rule bg-surface px-1 py-0.5 text-[12px] text-ink"
          >
            {(Object.keys(ROUTE_LABEL) as ProbingRoute[]).map((r) => (
              <option key={r} value={r}>
                {ROUTE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => setShowHelp((v) => !v)} className="text-[12px] text-steel hover:underline">
          {showHelp ? "Hide phrases" : "What to say"}
        </button>
      </div>

      <div aria-live="polite" className="min-h-[18px] font-data text-[12px]">
        {listening && interim ? (
          <span className="text-ink-soft">{interim}…</span>
        ) : heard ? (
          <span className={heard.ok ? "text-healthy" : "text-bleed"}>
            {heard.ok ? "✓" : "✕"} “{heard.text}”{heard.note ? ` — ${heard.note}` : ""}
          </span>
        ) : listening ? (
          <span className="text-ink-soft">Listening…</span>
        ) : (
          <span className="text-ink-soft">Press Dictate, then call the numbers out.</span>
        )}
      </div>
      {error && <p className="text-[12px] text-bleed">{error}</p>}

      {showHelp && (
        <ul className="grid grid-cols-1 gap-x-6 gap-y-0.5 border-t border-rule pt-1.5 text-[12px] text-ink-soft sm:grid-cols-2">
          <li>“three two three” — pocket depths, this side</li>
          <li>“deep twelve” — a 10–15 mm pocket</li>
          <li>“recession one zero one” — the side just done</li>
          <li>“bleeding all / first / middle / last”</li>
          <li>“suppuration …”, “plaque …” — same</li>
          <li>“mobility two”, “furcation grade one”</li>
          <li>“jump to one six outside / inside”</li>
          <li>“one eight is missing”</li>
          <li>“no, make that four” — the last depth</li>
          <li>“back”, “undo”</li>
        </ul>
      )}
    </div>
  );
}
