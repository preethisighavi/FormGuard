// Screen 4 — PT Dashboard (#pt). Patient list + per-patient history. The hero:
// an open /pt/stream subscription flashes the flagged patient's row and fires a
// toast in real time when flag_for_pt lands on a patient's live session.

import { useEffect, useRef, useState } from "react";
import {
  getBackend,
  type FlagEvent,
  type HistoryRes,
  type PatientSummary,
} from "../lib/backend";
import { C, FONT, TABULAR } from "../styles";

export function PtDashboard() {
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryRes | null>(null);
  const [flashing, setFlashing] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<FlagEvent | null>(null);
  const backend = getBackend();
  const flashTimers = useRef<Record<string, number>>({});

  useEffect(() => {
    backend
      .getPatients()
      .then((r) => setPatients(r.patients))
      .catch(() => {});
    const unsub = backend.subscribePtStream((e) => {
      if (e.event !== "flag") return;
      const f = e.data;
      setToast(f);
      window.setTimeout(() => setToast((t) => (t === f ? null : t)), 6000);
      setFlashing((s) => new Set(s).add(f.patient_id));
      window.clearTimeout(flashTimers.current[f.patient_id]);
      flashTimers.current[f.patient_id] = window.setTimeout(() => {
        setFlashing((s) => {
          const n = new Set(s);
          n.delete(f.patient_id);
          return n;
        });
      }, 8000);
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selected) return setHistory(null);
    backend
      .getPatientHistory(selected)
      .then(setHistory)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const trendColor = (t?: string) =>
    t === "improving" ? C.green : t === "declining" ? C.red : C.muted;

  return (
    <div
      style={{
        height: "100%",
        display: "grid",
        gridTemplateColumns: "260px 1fr",
        background: C.bg,
        fontFamily: FONT,
      }}
    >
      {/* sidebar */}
      <div
        style={{
          background: C.panel,
          borderRight: `1px solid ${C.border}`,
          padding: 16,
          overflowY: "auto",
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: C.muted,
            letterSpacing: "0.12em",
            marginBottom: 14,
          }}
        >
          PATIENTS
        </div>
        {patients.map((p) => {
          const flash = flashing.has(p.patient_id);
          return (
            <div
              key={p.patient_id}
              onClick={() => setSelected(p.patient_id)}
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                cursor: "pointer",
                marginBottom: 6,
                background: flash
                  ? C.redBg
                  : selected === p.patient_id
                    ? "#162032"
                    : "transparent",
                border: `1px solid ${flash ? C.red : "transparent"}`,
                transition: "background 200ms, border-color 200ms",
                animation: flash ? "blink 1s ease-in-out infinite" : "none",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span style={{ color: C.text, fontSize: 14, fontWeight: 600 }}>
                  {p.name}
                </span>
                {flash && (
                  <span style={{ color: C.red, fontSize: 12 }}>⚠ FLAG</span>
                )}
              </div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                compliance <span style={TABULAR}>{p.compliance_score}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* detail */}
      <div style={{ padding: 24, overflowY: "auto" }}>
        <h2 style={{ color: C.text, fontWeight: 900, marginTop: 0 }}>
          PT Dashboard
        </h2>
        {!selected && (
          <p style={{ color: C.muted }}>
            Select a patient to see session history.
          </p>
        )}
        {history && (
          <>
            <div
              style={{
                display: "flex",
                gap: 18,
                alignItems: "baseline",
                marginBottom: 18,
              }}
            >
              <span
                style={{
                  fontSize: 30,
                  fontWeight: 900,
                  color: C.text,
                  ...TABULAR,
                }}
              >
                {history.compliance_score}
              </span>
              <span style={{ fontSize: 13, color: C.muted }}>compliance</span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: trendColor(history.trend),
                }}
              >
                {history.trend}
              </span>
            </div>
            {history.sessions.map((s) => (
              <div
                key={s.session_id}
                style={{
                  background: C.panel,
                  border: `1px solid ${C.border}`,
                  borderRadius: 10,
                  padding: 14,
                  marginBottom: 10,
                }}
              >
                <div
                  style={{ display: "flex", justifyContent: "space-between" }}
                >
                  <span style={{ color: C.text, fontWeight: 700 }}>
                    {s.exercise.replace(/_/g, " ")}
                  </span>
                  <span
                    style={{
                      color: s.status === "COMPLETE" ? C.green : C.amber,
                      fontSize: 12,
                    }}
                  >
                    {s.status}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>
                  compliance <span style={TABULAR}>{s.compliance_score}</span>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* live escalation toast */}
      {toast && (
        <div
          style={{
            position: "fixed",
            top: 20,
            right: 20,
            zIndex: 60,
            background: C.redBg,
            border: `1px solid ${C.red}`,
            borderRadius: 12,
            padding: "14px 18px",
            color: C.red,
            fontFamily: FONT,
            maxWidth: 320,
            animation: "captionDrop 300ms ease-out",
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 4 }}>
            ⚠ Pain escalation
          </div>
          <div style={{ fontSize: 13, color: C.text }}>
            {patients.find((p) => p.patient_id === toast.patient_id)?.name ??
              "Patient"}{" "}
            reported pain <span style={TABULAR}>{toast.pain_level}/10</span> at
            rep <span style={TABULAR}>{toast.rep_number}</span>.
          </div>
        </div>
      )}
    </div>
  );
}
