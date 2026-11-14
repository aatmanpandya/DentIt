"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Mic, MicOff, Undo2 } from "lucide-react";
import { createWebSpeech, speechSupported, type SpeechToText } from "@/lib/voice/stt";
import { readPhrase } from "@/lib/voice/grammar";
import { planPhrase, draftChanges, INITIAL_VOICE_STATE, type DraftChange, type ToothChange, type VoiceState } from "./voice-apply";
import { recordPerioPhrase } from "@/lib/perio-api";
import { buildRoute, type ProbingRoute } from "./voice-route";
import { hasFurcation } from "./tooth-furcation";
import type { PerioSiteCode, ToothDraft } from "./perio-entry";

export interface VoiceCell {
  tooth: string;
  site: PerioSiteCode | null;
}

interface Props {
  examId: string;
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
  waiting?: boolean;
}

// How long a cut-off phrase ("434 recession") waits to be joined to the next one. 6 s was too
// short live: Chrome caught "two two two" a word at a time with 7-8 s gaps. A long window is safe
// because a join that doesn't read falls back to the new phrase on its own (readPhrase).
const JOIN_WINDOW_MS = 15000;

const ROUTE_KEY = "dentit.voiceRoute";
const SOUND_KEY = "dentit.voiceSound";

/**
 * A sound per outcome, so the dentist knows without looking: live (14 Nov) a refused phrase went
 * unnoticed while eyes were on the mouth, and every later number landed a tooth behind the script.
 * Commercial voice charting chimes for the same reason. Web Audio, no files.
 */
type Cue = "written" | "waiting" | "refused";
function playCue(ctx: AudioContext | null, cue: Cue) {
  if (!ctx) return;
  const tones: [number, number, number][] =
    cue === "written" ? [[880, 0, 0.08]] : cue === "waiting" ? [[600, 0, 0.06]] : [[220, 0, 0.14], [220, 0.2, 0.14]];
  for (const [freq, at, dur] of tones) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = cue === "refused" ? "square" : "sine";
    const t = ctx.currentTime + at;
    gain.gain.setValueAtTime(cue === "refused" ? 0.08 : 0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur);
  }
}

function readSound(): boolean {
  try {
    return window.localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}
// "Around each tooth" first: it's how Suman Dental Care probes (Dr Nimisha, 14 Nov).
const ROUTE_LABEL: Record<ProbingRoute, string> = { around_tooth: "Around each tooth", outside_first: "Outside first", each_jaw: "Each jaw first" };

function readRoute(): ProbingRoute {
  try {
    const stored = window.localStorage.getItem(ROUTE_KEY);
    return stored && Object.prototype.hasOwnProperty.call(ROUTE_LABEL, stored) ? (stored as ProbingRoute) : "around_tooth";
  } catch {
    return "around_tooth";
  }
}

/**
 * Voice entry for the perio grid (docs/specs/voice-perio.md): Chrome hears, the grammar reads,
 * the planner works the phrase out through the entry reducer, and the grid's hook saves it — or
 * nothing is written and the heard text shows red with the reason. "Undo" takes back the whole
 * last phrase. The route is remembered per device for the pilot.
 */
export function VoiceBar({ examId, activeOrder, disabled, knownDraft, applyVoice, restoreVoice, onHighlight, renderTooth }: Props) {
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
  const [sound, setSound] = useState(readSound);
  const audioRef = useRef<AudioContext | null>(null);
  const cue = (c: Cue) => {
    if (sound) playCue(audioRef.current, c);
  };

  const steps = useMemo(() => buildRoute(route, activeOrder), [route, activeOrder]);
  // The planner leaves the cursor on the last side with offset 3 once the route is done; that
  // used to read "Next: 48 inside" with nothing to say the chart was finished (live, 14 Nov).
  const routeDone = voice.cursor !== null && voice.cursor.offset >= 3;
  const next = routeDone ? undefined : voice.cursor ? steps.find((s) => s.tooth === voice.cursor?.tooth && s.side === voice.cursor?.side) : steps[0];

  function undo(heardAs: string[] = ["undo (button)"]) {
    const last = history[history.length - 1];
    if (!last) {
      setHeard({ text: "undo", ok: false, note: "Nothing to undo." });
      cue("refused");
      return;
    }
    restoreVoice(last.changes, last.skips);
    logPhrase(
      heardAs,
      "undo",
      `Took back “${last.text}”.`,
      "undo",
      draftChanges(last.changes.map((c) => ({ tooth: c.tooth, before: c.after, after: c.before })), last.skips, true),
    );
    setVoice(last.voiceBefore);
    setHistory((h) => h.slice(0, -1));
    setHeard({ text: "undo", ok: true, note: `Took back “${last.text}”.` });
    cue("written");
    onHighlight(last.cells);
  }

  // Every phrase goes into the exam's transcript, which the dentist reviews before approving
  // (docs/specs/perio-approval.md). In development it also goes to
  // evals/voice/session-log.jsonl, for building eval cases.
  function logPhrase(alternatives: string[], outcome: "written" | "refused" | "waiting" | "undo", note: string, used: string | null = null, changes: DraftChange[] = []) {
    void recordPerioPhrase(examId, { heard: alternatives.slice(0, 5), used, outcome, note: note || null, changes }).catch(() => {});
    if (process.env.NODE_ENV !== "development") return;
    void fetch("/api/dev/voice-log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alternatives, outcome, note, next: next ? `${next.tooth} ${next.side}` : null, route }),
    }).catch(() => {});
  }

  // A phrase that stopped where numbers were still due. Chrome splits a phrase at a pause: live,
  // "434 recession" | "211" wrote 2 1 1 as pocket depths on the next tooth. Now the first half
  // waits, and the next phrase is read joined to it. A ref, not state: two phrases can land
  // before a re-render.
  const pendingRef = useRef<{ text: string; at: number } | null>(null);

  function handlePhrase(heardAlternatives: string[]) {
    setInterim("");
    const pending = pendingRef.current && Date.now() - pendingRef.current.at < JOIN_WINDOW_MS ? pendingRef.current.text : null;
    pendingRef.current = null;
    const { parsed, alternatives } = readPhrase(heardAlternatives, pending);
    const text = parsed.ok && parsed.used ? parsed.used : (alternatives[0] ?? "");
    if (!parsed.ok && parsed.incomplete) {
      pendingRef.current = { text: alternatives[0] ?? "", at: Date.now() };
      setHeard({ text, ok: false, waiting: true, note: parsed.reason });
      cue("waiting");
      logPhrase(alternatives, "waiting", parsed.reason);
      return;
    }
    if (!parsed.ok) {
      setHeard({ text, ok: false, note: `${parsed.reason} Nothing written.` });
      cue("refused");
      logPhrase(alternatives, "refused", parsed.reason);
      return;
    }
    if (parsed.commands[0].type === "undo") {
      undo(alternatives);
      return;
    }
    const plan = planPhrase(parsed.commands, voice, { steps, draftFor: knownDraft, hasFurcation });
    if (!plan.ok) {
      setHeard({ text, ok: false, note: `${plan.reason} Nothing written.` });
      cue("refused");
      logPhrase(alternatives, "refused", plan.reason);
      return;
    }
    logPhrase(alternatives, "written", "", text, draftChanges(plan.changes, plan.skips));
    applyVoice(plan.changes, plan.skips);
    setHistory((h) => [...h.slice(-49), { changes: plan.changes, skips: plan.skips, voiceBefore: voice, text, cells: plan.cells }]);
    setVoice(plan.voice);
    const onlyMoved = parsed.commands.every((c) => c.type === "jump" || c.type === "back");
    setHeard({ text, ok: true, note: plan.changes.length + plan.skips.length === 0 && !onlyMoved ? "Already recorded." : "" });
    onHighlight(plan.cells);
    cue("written");
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
    // Browsers only allow sound after a click: make the audio context here.
    if (!audioRef.current) {
      try {
        audioRef.current = new AudioContext();
      } catch {
        audioRef.current = null;
      }
    }
    void audioRef.current?.resume();
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
            <span className="font-medium text-healthy">✓ Every tooth on the route is done</span>
          )}
        </span>
        <button
          type="button"
          onClick={() => undo()}
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
        <label className="flex items-center gap-1 text-[12px] text-ink-soft">
          <input
            id="voice-sound"
            type="checkbox"
            checked={sound}
            onChange={(e) => {
              setSound(e.target.checked);
              try {
                window.localStorage.setItem(SOUND_KEY, e.target.checked ? "on" : "off");
              } catch {
                // per-device convenience only
              }
            }}
          />
          Sound
        </label>
        <button type="button" onClick={() => setShowHelp((v) => !v)} className="text-[12px] text-steel hover:underline">
          {showHelp ? "Hide phrases" : "What to say"}
        </button>
      </div>

      <div aria-live="polite" className="min-h-[18px] font-data text-[12px]">
        {listening && interim ? (
          <span className="text-ink-soft">{interim}…</span>
        ) : heard ? (
          <span className={heard.ok ? "text-healthy" : heard.waiting ? "text-caution" : "text-bleed"}>
            {heard.ok ? "✓" : heard.waiting ? "…" : "✕"} “{heard.text}”{heard.note ? ` — ${heard.note}` : ""}
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
          <li>“jump one six outside / inside” (no “to”)</li>
          <li>“one eight is missing”</li>
          <li>“no, make that four” — the last depth</li>
          <li>“back”, “undo”</li>
          <li className="sm:col-span-2">Say one side at a time and wait for the ding before the next. Two low buzzes: nothing written, say it again.</li>
        </ul>
      )}
    </div>
  );
}
