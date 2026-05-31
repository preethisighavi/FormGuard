// Screen 1 — Setup. Creates a session (B maps name -> stable patient_id) and hands
// both ids to the Live screen. Inline-styles only; the 9-var palette.

import { useState } from "react";
import {
  getBackend,
  type CreateSessionRes,
  type Program,
} from "../lib/backend";
import { EXERCISES } from "../lib/backend/mock_seed";
import { C, FONT } from "../styles";

const PROGRAMS: Program[] = ["knee_rehab", "hip_rehab", "back_rehab"];

export function Setup({
  onStart,
}: {
  onStart: (
    session: CreateSessionRes,
    patientName: string,
    program: Program,
  ) => void;
}) {
  const [name, setName] = useState("Jane Doe");
  const [program, setProgram] = useState<Program>("knee_rehab");
  const [exercise, setExercise] = useState(EXERCISES["knee_rehab"][0]);
  const [busy, setBusy] = useState(false);
  const backend = getBackend();

  const submit = async () => {
    setBusy(true);
    try {
      const session = await backend.createSession({
        patient_name: name.trim(),
        program,
        exercise,
      });
      onStart(session, name.trim(), program);
    } catch (e) {
      setBusy(false);
      alert((e as Error).message);
    }
  };

  const field: React.CSSProperties = {
    width: "100%",
    background: C.bg,
    color: C.text,
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    padding: "11px 13px",
    fontSize: 15,
    fontFamily: FONT,
    marginTop: 6,
  };
  const label: React.CSSProperties = {
    fontSize: 12,
    color: C.muted,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  };

  return (
    <div
      style={{
        height: "100%",
        display: "grid",
        placeItems: "center",
        background: C.bg,
        fontFamily: FONT,
      }}
    >
      <div
        style={{
          width: 380,
          padding: 28,
          background: C.panel,
          border: `1px solid ${C.border}`,
          borderRadius: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 6,
          }}
        >
          <span style={{ color: C.green, fontSize: 18 }}>●</span>
          <h1
            style={{ fontSize: 22, margin: 0, color: C.text, fontWeight: 900 }}
          >
            FormGuard
          </h1>
        </div>
        <p
          style={{
            color: C.muted,
            fontSize: 13,
            marginTop: 0,
            marginBottom: 22,
          }}
        >
          Live AI form coaching with on-chain proof.
        </p>

        <div style={{ marginBottom: 16 }}>
          <div style={label}>Patient name</div>
          <input
            style={field}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={label}>Program</div>
          <select
            style={field}
            value={program}
            onChange={(e) => {
              const p = e.target.value as Program;
              setProgram(p);
              setExercise(EXERCISES[p][0]);
            }}
          >
            {PROGRAMS.map((p) => (
              <option key={p} value={p}>
                {p.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: 24 }}>
          <div style={label}>Exercise</div>
          <select
            style={field}
            value={exercise}
            onChange={(e) => setExercise(e.target.value)}
          >
            {EXERCISES[program].map((ex) => (
              <option key={ex} value={ex}>
                {ex.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={submit}
          disabled={busy || !name.trim()}
          style={{
            width: "100%",
            background: C.green,
            color: "#06210f",
            border: "none",
            borderRadius: 10,
            padding: 13,
            fontSize: 15,
            fontWeight: 800,
            fontFamily: FONT,
            cursor: busy ? "default" : "pointer",
            opacity: busy || !name.trim() ? 0.6 : 1,
          }}
        >
          {busy ? "Starting…" : "Start session →"}
        </button>
      </div>
    </div>
  );
}
