// Screen 3 — Summary. Stats + per-rep NEAR attestation badges that fill in async
// (poll getSession). Mock tx -> "Pending verification" (no dead explorer link).

import { useEffect, useState } from "react";
import { NEAR_EXPLORER } from "../config";
import {
  getBackend,
  isCompliant,
  isMockTx,
  type SessionRes,
} from "../lib/backend";
import { C, FONT, TABULAR } from "../styles";

export function Summary({
  sessionId,
  onPt,
}: {
  sessionId: string;
  onPt: () => void;
}) {
  const [data, setData] = useState<SessionRes | null>(null);
  const backend = getBackend();

  useEffect(() => {
    const poll = () =>
      backend
        .getSession(sessionId)
        .then(setData)
        .catch(() => {});
    const t = window.setInterval(poll, 2500);
    poll();
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const reps = data?.reps ?? [];
  const done = reps.length;
  const prescribed = data?.session.prescribed_reps ?? 0;
  const peakPain = reps.reduce((m, r) => Math.max(m, r.pain_level), 0);
  const avgForm = done
    ? Math.round(reps.reduce((s, r) => s + r.quality_score, 0) / done)
    : 0;
  const greenPct = done
    ? Math.round(
        (reps.filter((r) => r.form_state === "GREEN").length / done) * 100,
      )
    : 0;
  const attByRep = new Map(
    (data?.attestations ?? []).map((a) => [a.rep_number, a]),
  );
  const compliant = isCompliant(greenPct);

  const stat = (label: string, value: string) => (
    <div
      style={{
        background: C.panel,
        borderRadius: 10,
        padding: 14,
        textAlign: "center",
        border: `1px solid ${C.border}`,
      }}
    >
      <div style={{ fontSize: 24, fontWeight: 900, color: C.text, ...TABULAR }}>
        {value}
      </div>
      <div
        style={{
          fontSize: 11,
          color: C.muted,
          marginTop: 3,
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </div>
    </div>
  );

  return (
    <div
      style={{
        height: "100%",
        overflowY: "auto",
        background: C.bg,
        fontFamily: FONT,
      }}
    >
      <div style={{ maxWidth: 560, margin: "0 auto", padding: 28 }}>
        <h2 style={{ color: C.text, fontWeight: 900, marginBottom: 4 }}>
          Session complete
        </h2>
        <div
          style={{
            display: "inline-block",
            fontSize: 13,
            fontWeight: 700,
            color: compliant ? C.green : C.amber,
            background: compliant ? C.greenBg : C.amberBg,
            border: `1px solid ${compliant ? C.green : C.amber}`,
            borderRadius: 999,
            padding: "4px 12px",
            marginBottom: 20,
          }}
        >
          {compliant ? "✓ Compliant session" : "Below target"} · {greenPct}%
          green
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 10,
            marginBottom: 24,
          }}
        >
          {stat("Reps", `${done}/${prescribed}`)}
          {stat("Peak pain", `${peakPain}/10`)}
          {stat("Avg form", `${avgForm}`)}
        </div>

        <div
          style={{
            fontSize: 12,
            color: C.muted,
            letterSpacing: "0.08em",
            marginBottom: 10,
          }}
        >
          NEAR ATTESTATIONS — one per rep
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            marginBottom: 24,
          }}
        >
          {reps.map((r) => {
            const att = attByRep.get(r.rep_number);
            const pending = !att || isMockTx(att.tx_hash);
            return (
              <div
                key={r.rep_number}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: C.panel,
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  padding: "9px 13px",
                  fontSize: 13,
                }}
              >
                <span style={{ color: C.text }}>
                  Rep <span style={TABULAR}>{r.rep_number}</span> ·{" "}
                  {r.form_state} · {r.quality_score}
                </span>
                {pending ? (
                  <span style={{ color: C.amber, fontSize: 12 }}>
                    ⏳ Pending verification
                  </span>
                ) : (
                  <a
                    href={NEAR_EXPLORER(att!.tx_hash)}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      color: C.purple,
                      fontSize: 12,
                      fontFamily: "monospace",
                      textDecoration: "none",
                    }}
                  >
                    ✓ {att!.tx_hash.slice(0, 12)}… →
                  </a>
                )}
              </div>
            );
          })}
          {reps.length === 0 && (
            <div style={{ color: C.muted, fontSize: 13 }}>
              No reps recorded.
            </div>
          )}
        </div>

        <button
          onClick={onPt}
          style={{
            width: "100%",
            background: C.blue,
            color: "#04121f",
            border: "none",
            borderRadius: 10,
            padding: 13,
            fontSize: 15,
            fontWeight: 800,
            fontFamily: FONT,
            cursor: "pointer",
          }}
        >
          Share with PT →
        </button>
      </div>
    </div>
  );
}
