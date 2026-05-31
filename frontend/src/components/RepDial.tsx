// Big rep readout. Satoshi 900 + tabular numerals so width never jitters as it climbs.

import { C, FONT, TABULAR } from "../styles";

const pad = (n: number) => String(n).padStart(2, "0");

export function RepDial({
  repNumber,
  prescribedReps,
}: {
  repNumber: number;
  prescribedReps: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 12,
        justifyContent: "center",
        fontFamily: FONT,
      }}
    >
      <span
        style={{
          fontSize: 12,
          letterSpacing: "0.32em",
          color: C.muted,
          fontWeight: 500,
        }}
      >
        REP
      </span>
      <span
        style={{
          fontSize: 52,
          fontWeight: 900,
          color: C.text,
          lineHeight: 1,
          ...TABULAR,
        }}
      >
        {pad(repNumber)}
        <span style={{ color: C.muted, fontWeight: 700 }}>
          {" "}
          / {pad(prescribedReps)}
        </span>
      </span>
    </div>
  );
}
