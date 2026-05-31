// The centerpiece. A circular ring that:
//   - colors by form_state (GREEN/YELLOW/RED),
//   - fills an arc with rep progress (rep/prescribed, capped at 100%),
//   - pulses once per rep (remount-by-key replays the keyframe), and
//   - breathes slowly while idle (paused on RED).
// Three stacked layers keep the transforms from colliding (plan: animation contracts).

import type { ReactNode } from "react";
import { C, IDLE, STATE } from "../styles";
import type { FormState } from "../styles";

const SIZE = 380;
const STROKE = 14;
const R = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;

export function VitalRing({
  state,
  repNumber,
  prescribedReps,
  children,
}: {
  state: FormState | null;
  repNumber: number;
  prescribedReps: number;
  children: ReactNode;
}) {
  const c = state ? STATE[state] : IDLE;
  const progress =
    prescribedReps > 0 ? Math.min(repNumber / prescribedReps, 1) : 0;
  const offset = CIRC * (1 - progress);
  const isRed = state === "RED";

  return (
    <div style={{ position: "relative", width: SIZE, height: SIZE }}>
      {/* idle breathe glow (paused on RED) */}
      <div
        style={{
          position: "absolute",
          inset: 6,
          borderRadius: "50%",
          boxShadow: `0 0 60px 8px ${c.ring}`,
          opacity: 0.5,
          animation: isRed ? "none" : "breathe 3.6s ease-in-out infinite",
          transition: "box-shadow 300ms ease",
        }}
      />
      {/* per-rep pulse — keyed by repNumber so it remounts and replays */}
      <div
        key={repNumber}
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          border: `2px solid ${c.ring}`,
          animation: repNumber > 0 ? "repPulse 900ms ease-out" : "none",
          opacity: 0,
        }}
      />
      {/* the ring: faint track + colored progress arc */}
      <svg
        width={SIZE}
        height={SIZE}
        style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)" }}
      >
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke={C.border}
          strokeWidth={STROKE}
          opacity={0.5}
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke={c.ring}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={offset}
          style={{
            transition: "stroke-dashoffset 400ms ease, stroke 300ms ease",
          }}
        />
      </svg>
      {/* camera panel, centered inside the ring */}
      <div
        style={{
          position: "absolute",
          inset: STROKE + 26,
          borderRadius: 18,
          overflow: "hidden",
          background: "#000",
          border: `1px solid ${C.border}`,
          display: "grid",
          placeItems: "center",
        }}
      >
        {children}
      </div>
    </div>
  );
}
