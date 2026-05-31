// Stage-2 escalation: full-viewport RED flood. Shown when flag_for_pt has fired.
// The single allowed deliberate action (otherwise the UI is hands-off): end & see summary.

import { C, FONT } from "../styles";

const fmt = (s: number) =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function StopTakeover({
  elapsedSec,
  onEnd,
}: {
  elapsedSec: number;
  onEnd: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-label="Stop and rest"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: C.red,
        color: "#1a0606",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        fontFamily: FONT,
        animation: "redFlood 320ms ease-out",
      }}
    >
      <div style={{ fontSize: 64 }} aria-hidden>
        ✋
      </div>
      <div style={{ fontSize: 46, fontWeight: 900, letterSpacing: "0.04em" }}>
        STOP — REST NOW
      </div>
      <div style={{ fontSize: 18, fontWeight: 600, opacity: 0.85 }}>
        We&rsquo;ve alerted your physical therapist.
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, opacity: 0.7 }}>
        ✓ PT notified · {fmt(elapsedSec)}
      </div>
      <button
        onClick={onEnd}
        style={{
          marginTop: 14,
          background: "#1a0606",
          color: C.red,
          border: "none",
          borderRadius: 10,
          padding: "12px 22px",
          fontSize: 15,
          fontWeight: 700,
          fontFamily: FONT,
          cursor: "pointer",
        }}
      >
        End &amp; see summary →
      </button>
    </div>
  );
}
