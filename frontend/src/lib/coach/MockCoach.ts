// Scripted coach for the rehearsed demo + offline build. Drives the SAME handlers
// as the real Gemini Live coach. Owns the winning narrative:
//   - mostly-GREEN with one coached YELLOW dip -> compliant session, and
//   - the two-stage pain escalation (Stage 1 conversational adapt -> Stage 2 STOP+flag).
// Speaks cues via Web Speech TTS.

import { speak } from "./CoachSource";
import type {
  CoachHandlers,
  CoachSource,
  CoachStartOpts,
  RepSignal,
} from "./CoachSource";

const GREEN_CUES = [
  "Nice depth — strong and controlled.",
  "Knees tracking nicely over your toes.",
  "Good. Keep your core braced.",
  "Smooth tempo, hold that posture.",
  "That is a clean rep — well done.",
];
const YELLOW_DIP_CUE = "Push your knees outward and sit back a little.";
const RECOVER_CUE = "There it is — back on track.";
const ADAPT_CUE =
  "Okay, let us switch to a seated version — easier on the knee. Does that still hurt?";
const STOP_CUE =
  "Let us stop here and rest. I am letting your therapist know now.";

const REP_INTERVAL_MS = 3500; // a squat is ~2-3s; pace a touch slower for legibility
const DIP_REP = 4; // the single coached YELLOW dip in the default narrative

type Mode = "normal" | "adapting" | "stopped";

export class MockCoach implements CoachSource {
  private timer: number | null = null;
  private rep = 0;
  private mode: Mode = "normal";
  private opts!: CoachStartOpts;
  private h: CoachHandlers = {};

  start(opts: CoachStartOpts, handlers: CoachHandlers) {
    this.opts = opts;
    this.h = handlers;
    this.rep = 0;
    this.mode = "normal";
    handlers.onReady?.(true);
    // Prime the speech voice list (some browsers populate async).
    window.speechSynthesis?.getVoices?.();
    this.timer = window.setInterval(() => this.tick(), REP_INTERVAL_MS);
    // First rep promptly so the screen isn't empty.
    window.setTimeout(() => this.tick(), 400);
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    window.speechSynthesis?.cancel();
  }

  // Demo operator triggers the patient's spoken lines.
  // Stage 1 (adapt) fires on a first pain mention while coaching normally.
  // Stage 2 (STOP+flag) fires ONLY on a "still hurts / yes / worse" confirmation
  // while adapting — so a repeated pain mention never skips the conversational step.
  simulatePatientSays(phrase: string) {
    const p = phrase.toLowerCase();
    const painy = /(hurt|pain|ow|sore|ache)/.test(p);
    const stillBad = /(still|yes|yeah|worse|more|again)/.test(p);

    if (this.mode === "adapting") {
      if (stillBad) this.escalateStop();
    } else if (this.mode === "normal" && painy) {
      this.beginAdapt();
    }
  }

  // --- Stage 1: conversational adaptation ---
  private beginAdapt() {
    if (this.mode === "stopped") return;
    this.mode = "adapting";
    this.h.onCue?.(ADAPT_CUE);
    this.say(ADAPT_CUE);
  }

  // --- Stage 2: STOP + flag_for_pt (the hero beat) ---
  private escalateStop() {
    if (this.mode === "stopped") return;
    this.mode = "stopped";
    this.h.onFlag?.({
      type: "pain_spike",
      rep_number: this.rep,
      pain_level: 8,
      notes:
        "Patient reports knee pain persisting after exercise modification.",
    });
    this.h.onCue?.(STOP_CUE);
    this.say(STOP_CUE);
    this.stop();
  }

  private tick() {
    if (this.mode === "stopped") return;
    if (this.rep >= this.opts.prescribedReps) {
      this.stop();
      this.h.onComplete?.();
      return;
    }
    this.rep += 1;
    const signal = this.buildRep(this.rep);
    this.h.onRep?.(signal);
    this.say(signal.coaching_cue);
  }

  private buildRep(n: number): RepSignal {
    if (this.mode === "adapting") {
      return {
        rep_number: n,
        form_state: "YELLOW",
        quality_score: 68 + (n % 3),
        coaching_cue: "Easy through the seated range — control the descent.",
        pain_level: 4,
      };
    }
    // normal narrative: one YELLOW dip at DIP_REP, otherwise GREEN
    if (n === DIP_REP) {
      return {
        rep_number: n,
        form_state: "YELLOW",
        quality_score: 64,
        coaching_cue: YELLOW_DIP_CUE,
        pain_level: 1,
      };
    }
    const cue =
      n === DIP_REP + 1 ? RECOVER_CUE : GREEN_CUES[(n - 1) % GREEN_CUES.length];
    return {
      rep_number: n,
      form_state: "GREEN",
      quality_score: 86 + ((n * 7) % 12), // 86-97, lively but compliant
      coaching_cue: cue,
      pain_level: 0,
    };
  }

  private say(text: string) {
    speak(
      text,
      () => this.h.onSpeaking?.(true),
      () => this.h.onSpeaking?.(false),
    );
  }
}
