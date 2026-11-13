/**
 * Voice perio, stage 1: speech → text (docs/specs/voice-perio.md, ADR-0004).
 *
 * The one place that knows about the browser's speech API, so another recogniser (Whisper
 * running locally, a hosted service) can replace it behind the same interface. Chrome's
 * recogniser streams audio to Google — demo patients only.
 */
export interface SpeechToText {
  start(): void;
  stop(): void;
}

export interface SttHandlers {
  onInterim: (text: string) => void;
  /** Up to five guesses for one phrase, best first. */
  onFinal: (alternatives: string[]) => void;
  onError: (message: string) => void;
  onListeningChange: (listening: boolean) => void;
}

type Alt = { transcript: string };
type Recognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<Alt> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

export function speechSupported(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

const ERRORS: Record<string, string> = {
  "not-allowed": "Microphone access was refused. Allow it in Chrome's address bar.",
  "service-not-allowed": "Chrome's speech service isn't available here.",
  "audio-capture": "No microphone found.",
  network: "Chrome's speech service couldn't be reached.",
};

/** Chrome's built-in recogniser, en-IN, listening continuously until stop(). */
export function createWebSpeech(handlers: SttHandlers): SpeechToText | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;

  let wanted = false;
  let rec: Recognition | null = null;

  function open() {
    const r = new Ctor!();
    r.lang = "en-IN";
    r.interimResults = true;
    r.maxAlternatives = 5;
    r.continuous = true;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) handlers.onFinal(Array.from(result).map((a) => a.transcript.trim()).filter(Boolean));
        else handlers.onInterim(result[0].transcript);
      }
    };
    r.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return; // silence: just keep listening
      wanted = e.error !== "not-allowed" && e.error !== "service-not-allowed" && e.error !== "audio-capture" ? wanted : false;
      handlers.onError(ERRORS[e.error] ?? `Speech recognition error: ${e.error}`);
    };
    // Chrome ends a session after a while even in continuous mode; reopen while still wanted.
    r.onend = () => {
      if (wanted) open();
      else handlers.onListeningChange(false);
    };
    rec = r;
    r.start();
  }

  return {
    start() {
      if (wanted) return;
      wanted = true;
      handlers.onListeningChange(true);
      open();
    },
    stop() {
      wanted = false;
      rec?.stop();
    },
  };
}
