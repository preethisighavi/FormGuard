// Slim top-right trust/status cluster: coach connection, camera, on-chain proof
// ticker, session timer. The mic-reactive meter lives separately (MicMeter).

import { C, FONT, TABULAR } from "../styles";

function Dot({ on, color }: { on: boolean; color: string }) {
  return (
    <span
      style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: on ? color : C.border,
        boxShadow: on ? `0 0 8px ${color}` : "none",
        animation: on ? "blink 2s ease-in-out infinite" : "none",
        display: "inline-block",
      }}
    />
  );
}

const fmt = (s: number) =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function StatusCluster({
  coachReady,
  cameraOk,
  attestCount,
  elapsedSec,
}: {
  coachReady: boolean;
  cameraOk: boolean;
  attestCount: number;
  elapsedSec: number;
}) {
  const item: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 7,
    fontSize: 12.5,
    color: C.muted,
    fontFamily: FONT,
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
      <span style={item}>
        <Dot on={coachReady} color={C.green} /> coach{" "}
        {coachReady ? "live" : "…"}
      </span>
      <span style={item}>
        <Dot on={cameraOk} color={C.blue} /> camera
      </span>
      <span style={{ ...item, color: attestCount > 0 ? C.purple : C.muted }}>
        ✓ <span style={TABULAR}>{attestCount}</span> on-chain
      </span>
      <span style={{ ...item, ...TABULAR, color: C.text }}>
        {fmt(elapsedSec)}
      </span>
    </div>
  );
}
