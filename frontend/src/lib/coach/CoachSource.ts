// The vision+voice seam. LiveSession derives ALL of its UI state from these
// signals and forwards rep/flag signals to the BackendClient — so the UI is
// identical whether the coach is the scripted MockCoach or the real Gemini Live.

import type { FlagType, FormState } from "../backend/types";

// A `log_rep` tool call, minus session_id (LiveSession adds it before forwarding).
export interface RepSignal {
  rep_number: number;
  form_state: FormState;
  quality_score: number;
  coaching_cue: string;
  pain_level: number;
}

// A `flag_for_pt` tool call, minus session_id.
export interface FlagSignal {
  type: FlagType;
  rep_number: number;
  pain_level: number;
  notes: string;
}

export interface CoachHandlers {
  onReady?: (ready: boolean) => void;
  onRep?: (rep: RepSignal) => void;
  onCue?: (text: string) => void; // a spoken cue that isn't tied to a rep (e.g. Stage-1 question)
  onFlag?: (flag: FlagSignal) => void;
  onSpeaking?: (speaking: boolean) => void;
  onComplete?: () => void;
  onError?: (msg: string) => void;
}

export interface CoachStartOpts {
  sessionId: string;
  prescribedReps: number;
  program?: string;
  video?: HTMLVideoElement | null;
  micStream?: MediaStream | null;
}

export interface CoachSource {
  start(opts: CoachStartOpts, handlers: CoachHandlers): Promise<void> | void;
  stop(): void;
  // Ask the live coach to flush any pending rep observations into tool calls.
  // Optional because MockCoach emits reps on a fixed timer and has nothing to flush.
  requestRepFlush?(): void;
  // Voice-only pain trigger. MockCoach uses it to drive the escalation in a demo;
  // GeminiLiveCoach ignores it (Gemini actually hears the mic).
  simulatePatientSays?(phrase: string): void;
}

// --- Shared TTS (Web Speech API — browser-native, not an npm dep) ---
let _voice: SpeechSynthesisVoice | null = null;
function pickVoice(): SpeechSynthesisVoice | null {
  if (_voice) return _voice;
  const voices = window.speechSynthesis?.getVoices?.() ?? [];
  _voice =
    voices.find(
      (v) => /en[-_]US/i.test(v.lang) && /female|samantha|google/i.test(v.name),
    ) ??
    voices.find((v) => /^en/i.test(v.lang)) ??
    voices[0] ??
    null;
  return _voice;
}

export function speak(text: string, onStart?: () => void, onEnd?: () => void) {
  const synth = window.speechSynthesis;
  if (!synth) {
    onEnd?.();
    return;
  }
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice();
  if (v) u.voice = v;
  u.rate = 1.02;
  u.pitch = 1.0;
  u.onstart = () => onStart?.();
  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();
  synth.cancel(); // newest cue wins
  synth.speak(u);
}
