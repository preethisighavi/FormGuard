// Screen 2 — the hero. Owns the live state, wires the CoachSource to the UI and
// forwards every tool call to the BackendClient. UI state is intentionally tiny:
// formState + a `flagged` boolean make the two-stage escalation emergent (no
// escalation state machine), per the plan.

import { useEffect, useRef, useState } from "react";
import { CaptionStream, type Cue } from "../components/CaptionStream";
import { MicMeter } from "../components/MicMeter";
import { RepDial } from "../components/RepDial";
import { StatusCluster } from "../components/StatusCluster";
import { StopTakeover } from "../components/StopTakeover";
import { VitalRing } from "../components/VitalRing";
import {
  GEMINI_SEND_AUDIO,
  MIC_AUTO_GAIN_CONTROL,
  MIC_ECHO_CANCELLATION,
  MIC_NOISE_SUPPRESSION,
  MOCK_GEMINI,
  REP_MIN_INTERVAL_MS,
  REP_MOTION_THRESHOLD,
  REP_MOTION_THRESHOLD_MAX,
  REP_MOTION_THRESHOLD_MIN,
  REP_MOTION_THRESHOLD_RAW,
} from "../config";
import { getBackend, type CreateSessionRes } from "../lib/backend";
import { createCoach, type CoachSource } from "../lib/coach";
import { C, FONT, IDLE, STATE, type FormState } from "../styles";

export function LiveSession({
  session,
  patientName,
  program,
  onComplete,
}: {
  session: CreateSessionRes;
  patientName: string;
  program: string;
  onComplete: (sessionId: string) => void;
}) {
  const [formState, setFormState] = useState<FormState | null>(null);
  const [repNumber, setRepNumber] = useState(0);
  const [quality, setQuality] = useState<number | null>(null);
  const [cue, setCue] = useState<Cue | null>(null);
  const [flagged, setFlagged] = useState(false);
  const [attestCount, setAttestCount] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [coachReady, setCoachReady] = useState(false);
  const [cameraOk, setCameraOk] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [camMsg, setCamMsg] = useState("starting camera…");
  const [framesSent, setFramesSent] = useState(0);
  const [motionScoreUi, setMotionScoreUi] = useState(0);
  const [liveStopped, setLiveStopped] = useState(false);
  const [backendRepCount, setBackendRepCount] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const coachRef = useRef<CoachSource | null>(null);
  const repsSeen = useRef<Set<number>>(new Set());
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const lastAcceptedRepAt = useRef(0);
  const lastRepSignalAt = useRef(0);
  const repSignalsSeen = useRef(0);
  const repSignalsForwarded = useRef(0);
  const repSignalsRejected = useRef(0);
  const backendSyncTicks = useRef(0);
  const geminiFlushNudges = useRef(0);
  const motionScore = useRef(0);
  const cueId = useRef(0);
  const backend = getBackend();

  const pushCue = (text: string, tone: Cue["tone"] = "normal") =>
    setCue({ id: ++cueId.current, text, tone });

  useEffect(() => {
    if (program !== "wrist_rsi") return;
    pushCue("Wrist RSI session: wrist extension only, 5 total reps.", "normal");
    // fire once when this session screen mounts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopLiveStreaming = () => {
    coachRef.current?.stop();
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    setCoachReady(false);
    setSpeaking(false);
    setMicStream(null);
    setLiveStopped(true);
    setCamMsg("Gemini Live stopped — no camera/mic frames are being sent.");
    pushCue("Gemini Live stopped. You can end the session safely.", "warn");
  };

  // --- bring up camera/mic, then start the coach ---
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    let removeVideoDebug: (() => void) | null = null;
    let clearHeartbeat: (() => void) | null = null;

    (async () => {
      try {
        console.info("[camera-debug] requesting getUserMedia", {
          video: true,
          audio: GEMINI_SEND_AUDIO,
        });
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: GEMINI_SEND_AUDIO
            ? {
                noiseSuppression: MIC_NOISE_SUPPRESSION,
                echoCancellation: MIC_ECHO_CANCELLATION,
                autoGainControl: MIC_AUTO_GAIN_CONTROL,
              }
            : false,
        });
        if (cancelled) return;
        mediaStreamRef.current = stream;
        logStreamDetails(stream, "getUserMedia success");
        removeVideoDebug = attachVideoDebugListeners(videoRef.current);
        clearHeartbeat = startVideoHeartbeat(videoRef.current, stream);
        await attachAndPlayStream(videoRef.current, stream);
        const hasVideo = stream.getVideoTracks().length > 0;
        const hasAudio = stream.getAudioTracks().length > 0;
        console.info("[camera-debug] hasVideoTracks:", hasVideo);
        console.info("[camera-debug] hasAudioTracks:", hasAudio);
        setCameraOk(hasVideo);
        setMicStream(hasAudio ? stream : null);
        if (!hasVideo) setCamMsg("no camera track — coach still running");
      } catch (err) {
        // M10: camera/mic unavailable — coach still runs. Surface WHY.
        const e = err as DOMException;
        console.error("[camera] getUserMedia failed:", e.name, e.message);
        setCamMsg(cameraErrorMessage(e));
        setCameraOk(false);
      }

      const coach = createCoach();
      coachRef.current = coach;
      console.info("[rep-gate] config", {
        motionThreshold: REP_MOTION_THRESHOLD,
        motionThresholdMin: REP_MOTION_THRESHOLD_MIN,
        motionThresholdMax: REP_MOTION_THRESHOLD_MAX,
        minIntervalMs: REP_MIN_INTERVAL_MS,
      });
      coach.start(
        {
          sessionId: session.session_id,
          prescribedReps: session.prescribed_reps,
          program,
          video: videoRef.current,
          micStream: stream && stream.getAudioTracks().length > 0 ? stream : null,
        },
        {
          onReady: setCoachReady,
          onSpeaking: setSpeaking,
          onRep: (rep) => {
            lastRepSignalAt.current = Date.now();
            repSignalsSeen.current += 1;
            console.info("[rep-debug] onRep signal received", {
              repNumber: rep.rep_number,
              totalSignalsSeen: repSignalsSeen.current,
              motionScore: Number(motionScore.current.toFixed(4)),
            });

            // Always persist model-emitted reps. UI gating below is for local
            // anti-noise display control, not backend recording.
            repSignalsForwarded.current += 1;
            backend
              .logRep({ session_id: session.session_id, ...rep })
              .then(() => {
                console.info("[rep-debug] forwarded log_rep to backend", {
                  repNumber: rep.rep_number,
                  totalForwarded: repSignalsForwarded.current,
                });
              })
              .catch((err) => {
                console.error("[backend] logRep failed", {
                  sessionId: session.session_id,
                  repNumber: rep.rep_number,
                  error: err instanceof Error ? err.message : String(err),
                });
              });

            const now = Date.now();
            const dt = now - lastAcceptedRepAt.current;
            const motionOk = motionScore.current >= REP_MOTION_THRESHOLD;
            const intervalOk = dt >= REP_MIN_INTERVAL_MS;
            if (!motionOk || !intervalOk) {
              repSignalsRejected.current += 1;
              console.warn("[rep-gate] rejected rep", {
                repNumber: rep.rep_number,
                motionScore: Number(motionScore.current.toFixed(4)),
                motionThreshold: REP_MOTION_THRESHOLD,
                msSinceLastAccepted: dt,
                minIntervalMs: REP_MIN_INTERVAL_MS,
                totalRejected: repSignalsRejected.current,
                reason: !motionOk ? "low_motion" : "too_soon",
              });
              return;
            }
            lastAcceptedRepAt.current = now;
            setFormState(rep.form_state);
            setQuality(rep.quality_score);
            if (!repsSeen.current.has(rep.rep_number)) {
              repsSeen.current.add(rep.rep_number);
              setRepNumber((n) => Math.max(n, rep.rep_number));
            }
            console.info("[rep-gate] accepted rep", {
              repNumber: rep.rep_number,
              motionScore: Number(motionScore.current.toFixed(4)),
              motionThreshold: REP_MOTION_THRESHOLD,
            });
            pushCue(
              rep.coaching_cue,
              rep.form_state === "YELLOW" ? "warn" : "normal",
            );
          },
          onCue: (text) => pushCue(text, "warn"),
          onFlag: (flag) => {
            setFormState("RED");
            setFlagged(true);
            backend
              .flagForPt({ session_id: session.session_id, ...flag })
              .catch((err) => {
                console.error("[backend] flagForPt failed", {
                  sessionId: session.session_id,
                  repNumber: flag.rep_number,
                  error: err instanceof Error ? err.message : String(err),
                });
              });
          },
          onComplete: () => onComplete(session.session_id),
          onError: (m) => pushCue(m, "warn"),
        },
      );
    })();

    return () => {
      cancelled = true;
      clearHeartbeat?.();
      removeVideoDebug?.();
      coachRef.current?.stop();
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.session_id]);

  // --- lightweight motion estimator from successive video frames ---
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    let prev: Uint8ClampedArray | null = null;
    let timer: number | null = null;
    const sample = () => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return;
      canvas.width = 64;
      canvas.height = 48;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      if (prev) {
        let sum = 0;
        for (let i = 0; i < data.length; i += 4) {
          const y0 = 0.299 * prev[i] + 0.587 * prev[i + 1] + 0.114 * prev[i + 2];
          const y1 = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          sum += Math.abs(y1 - y0);
        }
        const px = canvas.width * canvas.height;
        const normalized = sum / (px * 255); // 0..1
        motionScore.current = normalized;
        setMotionScoreUi(normalized);
      }
      prev = new Uint8ClampedArray(data);
    };
    timer = window.setInterval(sample, 150);
    return () => {
      if (timer !== null) window.clearInterval(timer);
    };
  }, []);

  // --- session timer ---
  useEffect(() => {
    const t = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  // --- rep-debug heartbeat when reps are not coming through ---
  useEffect(() => {
    const t = window.setInterval(() => {
      if (!coachReady) return;
      const now = Date.now();
      const sinceLastSignal =
        lastRepSignalAt.current === 0 ? null : now - lastRepSignalAt.current;
      if (sinceLastSignal !== null && sinceLastSignal < 4000) return;
      console.info("[rep-debug] waiting for rep signals", {
        coachReady,
        cameraOk,
        framesSent,
        motionScore: Number(motionScore.current.toFixed(4)),
        motionThreshold: REP_MOTION_THRESHOLD,
        repMinIntervalMs: REP_MIN_INTERVAL_MS,
        totalSignalsSeen: repSignalsSeen.current,
        totalForwarded: repSignalsForwarded.current,
        totalRejected: repSignalsRejected.current,
        msSinceLastSignal: sinceLastSignal,
      });
    }, 2000);
    return () => window.clearInterval(t);
  }, [cameraOk, coachReady, framesSent]);

  // --- Gemini transport/model debug HUD feed ---
  useEffect(() => {
    const onGeminiDebug = (ev: Event) => {
      const d = (ev as CustomEvent<{
        framesSent?: number;
      }>).detail;
      if (!d) return;
      if (typeof d.framesSent === "number") setFramesSent(d.framesSent);
    };
    window.addEventListener("gemini-debug", onGeminiDebug as EventListener);
    return () =>
      window.removeEventListener("gemini-debug", onGeminiDebug as EventListener);
  }, []);

  // --- on-chain proof ticker: poll this session's attestations (§ Screen 3 approach) ---
  useEffect(() => {
    const poll = () =>
      backend
        .getSession(session.session_id)
        .then((r) => setAttestCount(r.attestations.length))
        .catch(() => {});
    const t = window.setInterval(poll, 3000);
    poll();
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.session_id]);

  // --- authoritative rep reconciliation + periodic Gemini flush nudge ---
  useEffect(() => {
    const t = window.setInterval(() => {
      backend
        .getSession(session.session_id)
        .then((r) => {
          const reps = r.reps ?? [];
          const count = reps.length;
          setBackendRepCount(count);
          backendSyncTicks.current += 1;
          setRepNumber((n) => Math.max(n, count));
          for (const rep of reps) {
            if (typeof rep.rep_number === "number") repsSeen.current.add(rep.rep_number);
          }

          // Nudge Gemini only when backend moved ahead of UI signals.
          if (count > repSignalsSeen.current) {
            coachRef.current?.requestRepFlush?.();
            geminiFlushNudges.current += 1;
            console.info("[rep-debug] backend ahead, nudged Gemini flush", {
              backendRepCount: count,
              totalSignalsSeen: repSignalsSeen.current,
              flushNudges: geminiFlushNudges.current,
            });
          }
        })
        .catch(() => {});
    }, 1000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.session_id]);

  // --- voice-first pain in mock demos: SpeechRecognition + keyboard fallback ---
  useEffect(() => {
    if (!MOCK_GEMINI) return; // real Gemini hears the mic itself
    const say = (p: string) => coachRef.current?.simulatePatientSays?.(p);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "p" || e.key === "P") say("my knee hurts");
      if (e.key === "y" || e.key === "Y") say("yes it still hurts");
    };
    window.addEventListener("keydown", onKey);

    const SR =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    let rec: any = null;
    if (SR) {
      rec = new SR();
      rec.continuous = true;
      rec.interimResults = false;
      rec.lang = "en-US";
      rec.onresult = (ev: any) => {
        const t = ev.results[ev.results.length - 1][0].transcript as string;
        say(t);
      };
      rec.onend = () => {
        try {
          rec.start();
        } catch {
          /* already running */
        }
      };
      try {
        rec.start();
      } catch {
        /* ignore */
      }
    }
    return () => {
      window.removeEventListener("keydown", onKey);
      rec?.stop?.();
    };
  }, []);

  const sc = formState ? STATE[formState] : IDLE;

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: C.bg,
      }}
    >
      {/* top bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 22px",
          borderBottom: `1px solid ${C.border}`,
          fontFamily: FONT,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{ color: sc.ring, fontSize: 18, transition: "color 300ms" }}
          >
            ●
          </span>
          <strong style={{ color: C.text, letterSpacing: "-0.01em" }}>
            FormGuard
          </strong>
          <span style={{ color: C.muted, fontSize: 13 }}>
            {patientName} · {program.replace("_", " ")}{" "}
            {session.exercise.replace(/_/g, " ")}
          </span>
        </div>
        <StatusCluster
          coachReady={coachReady}
          cameraOk={cameraOk}
          attestCount={attestCount}
          elapsedSec={elapsed}
        />
      </div>

      {/* stage */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 18,
          padding: 16,
        }}
      >
        <VitalRing
          state={formState}
          repNumber={repNumber}
          prescribedReps={session.prescribed_reps}
        >
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: "scaleX(-1)",
            }}
          />
          {!cameraOk && (
            <div
              style={{
                position: "absolute",
                color: C.muted,
                fontSize: 13,
                textAlign: "center",
                padding: 12,
              }}
            >
              {camMsg}
            </div>
          )}
        </VitalRing>

        {/* state label + quiet score */}
        <div style={{ fontFamily: FONT, textAlign: "center" }}>
          <span
            style={{
              fontSize: 19,
              fontWeight: 800,
              letterSpacing: "0.14em",
              color: sc.ring,
              transition: "color 300ms",
            }}
          >
            {sc.label}
          </span>
          {quality !== null && formState && (
            <span style={{ fontSize: 14, color: C.muted, marginLeft: 12 }}>
              · score {quality}
            </span>
          )}
        </div>

        <RepDial
          repNumber={repNumber}
          prescribedReps={session.prescribed_reps}
        />

        <CaptionStream cue={cue} />
      </div>

      {/* footer: voice-only affordance + live mic meter */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 18,
          padding: "14px 22px",
          borderTop: `1px solid ${C.border}`,
          fontFamily: FONT,
        }}
      >
        <MicMeter stream={micStream} active={coachReady} />
        <span style={{ fontSize: 14, color: C.muted, fontWeight: 400 }}>
          {speaking ? "coach speaking…" : "tell me if anything hurts"}
        </span>
        {MOCK_GEMINI && (
          <span style={{ fontSize: 11, color: C.border, marginLeft: 10 }}>
            demo: P = report pain · Y = still hurts
          </span>
        )}
      </div>

      {!flagged && (
        <button
          onClick={stopLiveStreaming}
          disabled={liveStopped}
          style={{
            position: "fixed",
            left: "50%",
            bottom: 24,
            transform: "translateX(-50%)",
            zIndex: 45,
            border: "none",
            borderRadius: 999,
            padding: "10px 20px",
            fontFamily: FONT,
            fontSize: 14,
            fontWeight: 700,
            cursor: liveStopped ? "default" : "pointer",
            background: liveStopped ? C.border : C.red,
            color: liveStopped ? C.muted : "#1a0606",
            boxShadow: "0 10px 28px rgba(0,0,0,0.28)",
            transition: "transform 120ms ease, opacity 120ms ease",
            opacity: liveStopped ? 0.92 : 1,
          }}
          aria-label="Stop Gemini Live streaming"
          title="Stop Gemini Live streaming"
        >
          {liveStopped ? "Gemini Live stopped" : "Stop Gemini Live"}
        </button>
      )}

      {flagged && (
        <StopTakeover
          elapsedSec={elapsed}
          onEnd={() => onComplete(session.session_id)}
        />
      )}

      <div
        style={{
          position: "fixed",
          right: 12,
          bottom: 12,
          background: "rgba(0,0,0,0.72)",
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          padding: "8px 10px",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 11,
          color: C.text,
          minWidth: 220,
          zIndex: 40,
        }}
      >
        <div>frames_sent: {framesSent}</div>
        <div>motion_score: {motionScoreUi.toFixed(4)}</div>
        <div>motion_threshold: {REP_MOTION_THRESHOLD.toFixed(4)}</div>
        <div>motion_threshold_raw: {REP_MOTION_THRESHOLD_RAW.toFixed(4)}</div>
        <div>rep_min_interval_ms: {REP_MIN_INTERVAL_MS}</div>
        <div>backend_reps: {backendRepCount}</div>
        <div>rep_signals_seen: {repSignalsSeen.current}</div>
        <div>rep_signals_forwarded: {repSignalsForwarded.current}</div>
        <div>rep_signals_rejected: {repSignalsRejected.current}</div>
        <div>backend_sync_ticks: {backendSyncTicks.current}</div>
        <div>gemini_flush_nudges: {geminiFlushNudges.current}</div>
      </div>
    </div>
  );
}

// Map a getUserMedia DOMException to a human, actionable reason.
function cameraErrorMessage(e: DOMException): string {
  switch (e.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "camera/mic blocked — click the camera icon in the address bar, choose Allow, then reload";
    case "NotFoundError":
    case "OverconstrainedError":
      return "no camera/mic found on this device";
    case "NotReadableError":
      return "camera is busy in another app (Zoom, Photo Booth…) — close it and reload";
    default:
      return `camera unavailable (${e.name || "unknown"}) — coach still running`;
  }
}

// Some browsers grant camera permission but keep the element paused until
// metadata is loaded and play() is explicitly requested.
async function attachAndPlayStream(
  video: HTMLVideoElement | null,
  stream: MediaStream,
) {
  if (!video) {
    console.warn("[camera-debug] no video element ref");
    return;
  }
  video.srcObject = stream;
  console.info("[camera-debug] srcObject assigned");

  const tryPlay = async () => {
    try {
      await video.play();
      console.info("[camera-debug] video.play() resolved", {
        paused: video.paused,
        readyState: video.readyState,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
      });
    } catch {
      console.warn("[camera-debug] video.play() rejected", {
        paused: video.paused,
        readyState: video.readyState,
      });
      // We'll retry once metadata lands; if it still fails the user keeps
      // seeing the fallback camera status and the coach remains functional.
    }
  };

  await tryPlay();
  if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
    await new Promise<void>((resolve) => {
      const onReady = () => {
        video.removeEventListener("loadedmetadata", onReady);
        resolve();
      };
      video.addEventListener("loadedmetadata", onReady, { once: true });
    });
  }
  await tryPlay();
}

function logStreamDetails(stream: MediaStream, label: string) {
  const videoTracks = stream.getVideoTracks().map((t) => ({
    id: t.id,
    label: t.label,
    enabled: t.enabled,
    muted: t.muted,
    readyState: t.readyState,
    settings: t.getSettings(),
  }));
  const audioTracks = stream.getAudioTracks().map((t) => ({
    id: t.id,
    label: t.label,
    enabled: t.enabled,
    muted: t.muted,
    readyState: t.readyState,
    settings: t.getSettings(),
  }));
  console.info("[camera-debug] stream", label, {
    streamId: stream.id,
    active: stream.active,
    videoTracks,
    audioTracks,
  });
}

function attachVideoDebugListeners(video: HTMLVideoElement | null) {
  if (!video) return () => {};
  const events: Array<keyof HTMLMediaElementEventMap> = [
    "loadedmetadata",
    "loadeddata",
    "canplay",
    "playing",
    "pause",
    "stalled",
    "suspend",
    "waiting",
    "error",
  ];
  const listeners = events.map((eventName) => {
    const handler = () => {
      console.info("[camera-debug] video event", eventName, {
        paused: video.paused,
        readyState: video.readyState,
        networkState: video.networkState,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        currentTime: Number(video.currentTime.toFixed(3)),
        error: video.error?.message ?? null,
      });
    };
    video.addEventListener(eventName, handler);
    return { eventName, handler };
  });

  return () => {
    for (const l of listeners) video.removeEventListener(l.eventName, l.handler);
  };
}

function startVideoHeartbeat(
  video: HTMLVideoElement | null,
  stream: MediaStream,
): () => void {
  void video;
  void stream;
  return () => {};
}
