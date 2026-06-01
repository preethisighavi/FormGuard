// Real Gemini Live coach. Opens a WSS to the BidiGenerateContent endpoint,
// streams camera frames (~3-4 FPS JPEG) + 16kHz PCM mic audio, plays 24kHz audio
// back, and registers EXACTLY the two contract tools (log_rep, flag_for_pt).
// When Gemini calls a tool, we emit the matching CoachSource signal (LiveSession
// updates the UI + forwards to the BackendClient) and immediately ack Gemini.
//
// NOT testable until VITE_GEMINI_API_KEY is set (build-sequence step 3). The two
// knobs to verify against the live endpoint then:  [V1] MODEL name,
// [V2] realtimeInput field names (audio/video vs mediaChunks).
// Protocol ref: https://ai.google.dev/api/live  +  /docs/live-guide

import {
  GEMINI_API_KEY,
  GEMINI_BARGE_IN_COOLDOWN_MS,
  GEMINI_BARGE_IN_MIN_HITS,
  GEMINI_BARGE_IN_RMS_THRESHOLD,
  GEMINI_FRAME_INTERVAL_MS,
  GEMINI_FRAME_WIDTH,
  GEMINI_LIVE_MODEL,
  GEMINI_REALTIME_TURN_COVERAGE,
  GEMINI_SEND_AUDIO,
} from "../../config";
import type {
  CoachHandlers,
  CoachSource,
  CoachStartOpts,
  FlagSignal,
  RepSignal,
} from "./CoachSource";

// Native-audio Live model — handles video input as well as audio, with the best
// voice quality. Confirmed available on this key via ListModels (bidiGenerateContent)
// and the setup handshake was verified live. Dated previews also work
// ('-preview-12-2025'); alt video+audio model: 'models/gemini-3.1-flash-live-preview'.
const MODEL = GEMINI_LIVE_MODEL;

const WS_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

// Explicit cadence: tuned via env (default 100ms).
const FRAME_INTERVAL_MS = GEMINI_FRAME_INTERVAL_MS;
const OUTPUT_SAMPLE_RATE = 24000; // Live API audio output
const INPUT_SAMPLE_RATE = 16000; // Live API audio input
const BARGE_IN_RMS_THRESHOLD = GEMINI_BARGE_IN_RMS_THRESHOLD;
const BARGE_IN_COOLDOWN_MS = GEMINI_BARGE_IN_COOLDOWN_MS;

// const base = `You are FormGuard, a calm, encouraging physical-therapy coach counting reps over live video and audio.

// Session opening:
// - Immediately begin coaching rep 1 with no preamble.
// - First spoken line should instruct the first movement for rep 1 in one short sentence.

// TOOL-CALLING PRIORITY:
// - For this app, logging reps is mandatory behavior.
// - Call log_rep whenever you observe movement that seems like one rep.
// - Bias toward calling log_rep rather than skipping it when uncertain.
// - If you're unsure, call log_rep.
// - Target cadence: Always call log_rep every 3 seconnds at least.

// Call log_rep ONCE per observed rep with an honest form_state (GREEN good, YELLOW needs a
// small correction, RED unsafe), a 0-100 quality_score, a short spoken coaching_cue, and pain_level 0-10.

// CRITICAL GROUNDING RULES:
// - Only assess form when the patient is partially visible in the camera feed.
// - If visibility is partial but a likely rep movement is still seen, call log_rep with conservative
//   values (prefer YELLOW, lower quality_score) and a cue asking for clearer framing.

// QUESTION-ANSWERING RULE:
// - Always answer direct user questions first, in plain language, before returning to coaching.
// - For visual questions (e.g., finger counts), attempt a best-effort answer from the current frame.
// - If visual confidence is low, explicitly say what is uncertain and ask for a clearer angle.

// If the patient says anything about pain: FIRST adapt conversationally — suggest an easier variant and
// ask "does that still hurt?" Do NOT flag yet. ONLY if they confirm it still hurts, call flag_for_pt with
// type "pain_spike" so their therapist is alerted, and tell them to stop and rest.

// Keep spoken cues to one short sentence. Be warm and concise.`;

function buildSystemInstruction(program?: string): string {
  const base = `
  You are FormGuard, a PT coach counting reps over live video and audio.
  - Immediately describe the first exercise and start logging reps for the user.
  - As SOON AS YOU SEE A REP - stop what you're doing/saying and state the rep immediately by number ("rep 1", "rep 2", etc).
  - If anything even looks remotely like a movement, call log_rep with a best guess form_state (GREEN good, YELLOW needs a small correction, RED unsafe), a 0-100 quality_score, a short spoken coaching_cue, and pain_level 0-10.
  - If you're not sure, call log_rep with conservative values (prefer YELLOW, lower quality_score).
  `;

  if (program === "wrist_rsi") {
    return `${base}

HAND VISIBILITY: For this wrist RSI exercise, only the patient's hand and wrist need to be
visible in the camera frame. The patient may remain seated with only their hand in frame.
Assess form based on wrist angle, finger movement, and hand positioning only. Do not ask
the patient to show their full body.`;
  }

  return base;
}

const TOOLS = [
  {
    functionDeclarations: [
      {
        name: "log_rep",
        description:
          "Record one completed repetition with its form assessment.",
        parameters: {
          type: "OBJECT",
          properties: {
            rep_number: {
              type: "INTEGER",
              description: "Rep count starting at 1.",
            },
            form_state: { type: "STRING", enum: ["GREEN", "YELLOW", "RED"] },
            quality_score: { type: "INTEGER", description: "0-100." },
            coaching_cue: { type: "STRING", description: "Short spoken cue." },
            pain_level: { type: "INTEGER", description: "0-10." },
          },
          required: [
            "rep_number",
            "form_state",
            "quality_score",
            "coaching_cue",
            "pain_level",
          ],
        },
      },
      {
        name: "flag_for_pt",
        description:
          "Escalate to the physical therapist when pain persists after adaptation.",
        parameters: {
          type: "OBJECT",
          properties: {
            type: {
              type: "STRING",
              enum: ["pain_spike", "form_breakdown", "patient_request"],
            },
            rep_number: { type: "INTEGER" },
            pain_level: { type: "INTEGER", description: "0-10." },
            notes: { type: "STRING" },
          },
          required: ["type", "rep_number", "pain_level", "notes"],
        },
      },
    ],
  },
];

function b64encode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class GeminiLiveCoach implements CoachSource {
  private ws: WebSocket | null = null;
  private h: CoachHandlers = {};
  private canvas = document.createElement("canvas");
  private program: string | undefined;
  private frameTimer: number | null = null;
  private frameCount = 0;
  private zeroDimCount = 0;
  private frameLoopStartedAt = 0;

  // audio in
  private inCtx: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;

  // audio out (sequential scheduling)
  private outCtx: AudioContext | null = null;
  private playHead = 0;
  private outSources = new Set<AudioBufferSourceNode>();
  private unlockHandler: (() => void) | null = null;
  private lastBargeInAt = 0;
  private consecutiveLoudChunks = 0;

  async start(opts: CoachStartOpts, handlers: CoachHandlers) {
    this.h = handlers;
    this.program = opts.program;
    if (!GEMINI_API_KEY) {
      handlers.onError?.(
        "VITE_GEMINI_API_KEY is not set — cannot start Gemini Live.",
      );
      return;
    }
    const ws = new WebSocket(`${WS_URL}?key=${GEMINI_API_KEY}`);
    this.ws = ws;
    this.installAudioUnlock();

    ws.onopen = () => {
      console.info("[gemini] socket open → sending setup; model =", MODEL);
      console.info("[gemini] tuning", {
        frameIntervalMs: FRAME_INTERVAL_MS,
        frameWidth: GEMINI_FRAME_WIDTH,
        bargeInRmsThreshold: BARGE_IN_RMS_THRESHOLD,
        bargeInCooldownMs: BARGE_IN_COOLDOWN_MS,
        bargeInMinHits: GEMINI_BARGE_IN_MIN_HITS,
      });
      const setupPayload = {
        setup: {
          model: MODEL,
          generationConfig: {
            responseModalities: ["AUDIO"],
            temperature: 0.1,
          },
          realtimeInputConfig: undefined as
            | { turnCoverage: string }
            | undefined,
          systemInstruction: {
            parts: [{ text: buildSystemInstruction(this.program) }],
          },
          tools: TOOLS,
        },
      };
      if (GEMINI_REALTIME_TURN_COVERAGE) {
        setupPayload.setup.realtimeInputConfig = {
          turnCoverage: GEMINI_REALTIME_TURN_COVERAGE,
        };
      } else {
        delete setupPayload.setup.realtimeInputConfig;
      }
      console.info("[gemini] setup payload shape", {
        setupKeys: Object.keys(setupPayload.setup),
        toolCount: TOOLS.length,
        functionDeclCount:
          TOOLS[0]?.functionDeclarations?.length ?? 0,
        sendAudio: GEMINI_SEND_AUDIO,
        turnCoverage: GEMINI_REALTIME_TURN_COVERAGE || "(omitted)",
      });
      ws.send(JSON.stringify(setupPayload));
    };

    ws.onmessage = async (ev) => {
      const text =
        typeof ev.data === "string" ? ev.data : await (ev.data as Blob).text();
      let msg: any;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (msg.setupComplete) {
        console.info("[gemini] setupComplete → streaming media");
        handlers.onReady?.(true);
        this.startFrameLoop(opts.video ?? null);
        this.startAudioCapture(opts.micStream ?? null);
        this.promptInitialGreeting();
        return;
      }
      if (msg.toolCall?.functionCalls) {
        console.info("[gemini] toolCall", msg.toolCall.functionCalls);
        this.handleToolCalls(msg.toolCall.functionCalls);
        return;
      }
      if (msg.outputTranscription?.text) {
        const transcript = String(msg.outputTranscription.text);
        console.info("[gemini-audio] output transcription", {
          text: transcript,
        });
      }
      if (msg.serverContent) this.handleServerContent(msg.serverContent);
    };

    ws.onerror = (e) => {
      console.warn("[gemini] socket error", e);
      handlers.onError?.("Gemini Live socket error.");
    };
    ws.onclose = (e) => {
      // Code 1007/1008/1011 + reason usually names a bad model or malformed setup.
      console.warn("[gemini] socket closed", e.code, e.reason);
      handlers.onReady?.(false);
    };
  }

  stop() {
    if (this.frameTimer !== null) window.clearInterval(this.frameTimer);
    this.frameTimer = null;
    this.frameCount = 0;
    this.zeroDimCount = 0;
    this.frameLoopStartedAt = 0;
    this.processor?.disconnect();
    this.micSource?.disconnect();
    this.inCtx?.close().catch(() => {});
    this.outCtx?.close().catch(() => {});
    this.processor = this.micSource = this.inCtx = this.outCtx = null;
    this.outSources.clear();
    this.consecutiveLoudChunks = 0;
    if (this.unlockHandler) {
      window.removeEventListener("pointerdown", this.unlockHandler);
      window.removeEventListener("keydown", this.unlockHandler);
      this.unlockHandler = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  requestRepFlush() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        clientContent: {
          turns: [
            {
              role: "user",
              parts: [
                {
                  text: "Flush check: if you observed any reps that were not yet logged, emit all missing log_rep calls now, then continue normal coaching.",
                },
              ],
            },
          ],
          turnComplete: true,
        },
      }),
    );
    console.info("[rep-debug] sent Gemini flush nudge");
  }

  // Real Gemini hears the mic itself — nothing to simulate.
  simulatePatientSays() {}

  // --- outgoing: camera frames ---
  private startFrameLoop(video: HTMLVideoElement | null) {
    if (!video) {
      console.warn("[gemini] no <video> — not streaming frames");
      return;
    }
    let logged = false;
    this.frameCount = 0;
    this.zeroDimCount = 0;
    this.frameLoopStartedAt = Date.now();
    console.info("[gemini-video] frame loop started", {
      frameIntervalMs: FRAME_INTERVAL_MS,
      readyState: video.readyState,
      paused: video.paused,
    });
    const send = () => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const w = video.videoWidth,
        h = video.videoHeight;
      if (!w || !h) {
        this.zeroDimCount += 1;
        if (this.zeroDimCount === 1 || this.zeroDimCount % 10 === 0) {
          console.warn("[gemini-video] skipping frame: zero dimensions", {
            zeroDimCount: this.zeroDimCount,
            readyState: video.readyState,
            paused: video.paused,
            currentTime: Number(video.currentTime.toFixed(3)),
          });
        }
        return;
      }
      if (!logged) {
        console.info("[gemini-video] streaming frames", `${w}x${h}`);
        logged = true;
      }
      this.canvas.width = GEMINI_FRAME_WIDTH;
      this.canvas.height = Math.round((GEMINI_FRAME_WIDTH * h) / w);
      const ctx = this.canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
      const dataUrl = this.canvas.toDataURL("image/jpeg", 0.6);
      const data = dataUrl.split(",")[1];
      this.frameCount += 1;
      if (this.frameCount === 1 || this.frameCount % 15 === 0) {
        const elapsedSec = (Date.now() - this.frameLoopStartedAt) / 1000;
        const effectiveFps =
          elapsedSec > 0 ? Number((this.frameCount / elapsedSec).toFixed(2)) : 0;
        console.info("[gemini-video] sent frame", {
          frameCount: this.frameCount,
          jpegBytesApprox: Math.floor((data.length * 3) / 4),
          canvasWidth: this.canvas.width,
          canvasHeight: this.canvas.height,
          effectiveFps,
        });
      }
      this.emitDebug({
        framesSent: this.frameCount,
      });
      // [V2] frame field name to verify against the live endpoint.
      this.ws.send(
        JSON.stringify({
          realtimeInput: { video: { mimeType: "image/jpeg", data } },
        }),
      );
    };
    this.frameTimer = window.setInterval(send, FRAME_INTERVAL_MS);
  }

  // --- outgoing: 16kHz PCM mic ---
  private startAudioCapture(stream: MediaStream | null) {
    if (!GEMINI_SEND_AUDIO) {
      console.info("[gemini] audio uplink disabled by VITE_GEMINI_SEND_AUDIO");
      return;
    }
    if (!stream) {
      console.warn("[gemini] no mic stream — not streaming audio");
      return;
    }
    if (stream.getAudioTracks().length === 0) {
      console.warn("[gemini] mic stream has no audio track — not streaming audio");
      return;
    }
    console.info("[gemini] streaming mic audio @16kHz");
    const ctx = new AudioContext();
    this.inCtx = ctx;
    this.micSource = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    this.processor = processor;
    processor.onaudioprocess = (e) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const input = e.inputBuffer.getChannelData(0);
      const rms = computeRms(input);
      if (rms >= BARGE_IN_RMS_THRESHOLD) {
        this.consecutiveLoudChunks += 1;
        if (this.consecutiveLoudChunks >= GEMINI_BARGE_IN_MIN_HITS) {
          this.handleBargeIn();
          this.consecutiveLoudChunks = 0;
        }
      } else {
        this.consecutiveLoudChunks = 0;
      }
      const pcm16 = downsampleToPCM16(input, ctx.sampleRate, INPUT_SAMPLE_RATE);
      const data = b64encode(new Uint8Array(pcm16.buffer));
      this.ws.send(
        JSON.stringify({
          realtimeInput: {
            audio: { mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}`, data },
          },
        }),
      );
    };
    this.micSource.connect(processor);
    processor.connect(ctx.destination); // keeps the node alive (gain 0 not required)
  }

  private emitDebug(detail: {
    framesSent?: number;
  }) {
    window.dispatchEvent(new CustomEvent("gemini-debug", { detail }));
  }

  // --- incoming: tool calls ---
  private handleToolCalls(
    calls: Array<{ id: string; name: string; args: any }>,
  ) {
    const responses: Array<{ id: string; response: unknown }> = [];
    for (const call of calls) {
      if (call.name === "log_rep") {
        const a = call.args ?? {};
        console.info("[rep-debug] Gemini emitted log_rep", {
          rawArgs: a,
        });
        const rep: RepSignal = {
          rep_number: Number(a.rep_number) || 0,
          form_state: (a.form_state ?? "GREEN") as RepSignal["form_state"],
          quality_score: Number(a.quality_score) || 0,
          coaching_cue: String(a.coaching_cue ?? ""),
          pain_level: Number(a.pain_level) || 0,
        };
        this.h.onRep?.(rep);
        responses.push({ id: call.id, response: { ok: true, recorded: true } });
      } else if (call.name === "flag_for_pt") {
        const a = call.args ?? {};
        console.info("[rep-debug] Gemini emitted flag_for_pt", {
          rawArgs: a,
        });
        const flag: FlagSignal = {
          type: (a.type ?? "pain_spike") as FlagSignal["type"],
          rep_number: Number(a.rep_number) || 0,
          pain_level: Number(a.pain_level) || 0,
          notes: String(a.notes ?? ""),
        };
        this.h.onFlag?.(flag);
        responses.push({
          id: call.id,
          response: { ok: true, flag_id: "fe_ack" },
        });
      } else {
        console.info("[rep-debug] Gemini emitted unknown tool call", {
          name: call.name,
          rawArgs: call.args ?? null,
        });
        responses.push({ id: call.id, response: { ok: false } });
      }
    }
    this.ws?.send(
      JSON.stringify({ toolResponse: { functionResponses: responses } }),
    );
  }

  // --- incoming: audio output ---
  private handleServerContent(sc: any) {
    const parts: any[] = sc.modelTurn?.parts ?? [];
    if (parts.length > 0) {
      const mimeTypes = parts
        .map((p) => p.inlineData?.mimeType)
        .filter((x) => typeof x === "string");
      const textParts = parts
        .map((p) => (typeof p.text === "string" ? p.text : ""))
        .filter((t) => t.length > 0);
      console.info("[gemini] serverContent", {
        partCount: parts.length,
        mimeTypes,
        textParts,
      });
    }
    for (const p of parts) {
      const inline = p.inlineData;
      if (inline?.data && /audio\/pcm/.test(inline.mimeType ?? "")) {
        this.playPcm(b64decode(inline.data));
        this.h.onSpeaking?.(true);
      }
    }
    if (sc.turnComplete) this.h.onSpeaking?.(false);
  }

  private playPcm(bytes: Uint8Array) {
    if (!this.outCtx) {
      this.outCtx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
      this.playHead = this.outCtx.currentTime;
      console.info("[gemini-audio] created output AudioContext", {
        state: this.outCtx.state,
        sampleRate: this.outCtx.sampleRate,
      });
    }
    const ctx = this.outCtx;
    if (ctx.state !== "running") {
      ctx.resume()
        .then(() =>
          console.info("[gemini-audio] resumed output AudioContext", {
            state: ctx.state,
          }),
        )
        .catch((e) =>
          console.warn("[gemini-audio] failed to resume AudioContext", e),
        );
    }
    const int16 = new Int16Array(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength / 2,
    );
    const f32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 32768;
    const buf = ctx.createBuffer(1, f32.length, OUTPUT_SAMPLE_RATE);
    buf.copyToChannel(f32, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    this.outSources.add(src);
    src.onended = () => this.outSources.delete(src);
    const start = Math.max(this.playHead, ctx.currentTime);
    src.start(start);
    this.playHead = start + buf.duration;
    console.info("[gemini-audio] queued", {
      samples: int16.length,
      durationSec: Number(buf.duration.toFixed(3)),
      ctxState: ctx.state,
    });
  }

  // Encourages deterministic, immediate opening speech at session start.
  private promptInitialGreeting() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        clientContent: {
          turns: [
            {
              role: "user",
              parts: [
                {
                  text: "Start immediately with rep 1. Give the first movement cue now in one short sentence, then continue live rep coaching.",
                },
                {
                  text: "Whenever you observe likely rep completion movement, call log_rep immediately before moving on.",
                },
              ],
            },
          ],
          turnComplete: true,
        },
      }),
    );
  }

  // Local barge-in: stop currently queued/playing TTS chunks quickly when user starts speaking.
  private handleBargeIn() {
    const now = Date.now();
    if (now - this.lastBargeInAt < BARGE_IN_COOLDOWN_MS) return;
    this.lastBargeInAt = now;
    if (!this.outCtx) return;

    for (const src of this.outSources) {
      try {
        src.stop(0);
      } catch {
        // best-effort
      }
    }
    this.outSources.clear();
    this.playHead = this.outCtx.currentTime;
    this.h.onSpeaking?.(false);
    console.info("[gemini-audio] barge-in: playback interrupted");
  }

  // Browsers can block audio playback until a user gesture occurs.
  // We register a one-shot unlock listener so model audio can play reliably.
  private installAudioUnlock() {
    const handler = () => {
      if (this.inCtx && this.inCtx.state !== "running") {
        this.inCtx.resume().catch(() => {});
      }
      if (this.outCtx && this.outCtx.state !== "running") {
        this.outCtx.resume().catch(() => {});
      }
    };
    this.unlockHandler = handler;
    window.addEventListener("pointerdown", handler, { passive: true });
    window.addEventListener("keydown", handler);
  }
}

// Linear downsample Float32 [-1,1] @ inRate -> Int16 PCM @ outRate.
function downsampleToPCM16(
  input: Float32Array,
  inRate: number,
  outRate: number,
): Int16Array {
  const ratio = inRate / outRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const s = Math.max(-1, Math.min(1, input[Math.floor(i * ratio)]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function computeRms(input: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
  return Math.sqrt(sum / input.length);
}
