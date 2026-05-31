// In-memory backend. Never throws. Mimics Computer B's behavior:
//  - log_rep returns immediately, then attestation lands asynchronously (~600ms)
//    and an `attest` SSE event fires (contract §1 side effects).
//  - flag_for_pt emits a `flag` SSE event (the hero beat) via a local EventTarget,
//    so the PT dashboard lights up with zero server.
// Shapes are identical to HttpBackend (contract §5).

import type { BackendClient } from "./BackendClient";
import {
  EXERCISES,
  prescribedReps,
  SEED_HISTORY,
  SEED_PATIENTS,
  seedSessionInfo,
} from "./mock_seed";
import type {
  Attestation,
  CreateSessionReq,
  CreateSessionRes,
  FlagReq,
  FlagRes,
  HistoryRes,
  LogRepReq,
  LogRepRes,
  PatientsRes,
  PatientSummary,
  PtStreamEvent,
  Rep,
  Flag,
  SessionInfo,
  SessionRes,
} from "./types";

// Tiny non-crypto hex digest for mock tx hashes / session_hash (16 hex chars).
function hex16(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0xc2b2ae35;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x85ebca6b);
  }
  const u = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return u(h1) + u(h2);
}

const now = () => Math.floor(Date.now() / 1000);
const rid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 8)}`;

interface Store {
  info: SessionInfo;
  reps: Map<number, Rep>; // dedup key = rep_number
  flags: Flag[];
  attestations: Map<number, Attestation>;
}

export class MockBackend implements BackendClient {
  private sessions = new Map<string, Store>();
  private patientsByName = new Map<string, string>(); // name -> stable patient_id
  private livePatients: PatientSummary[] = [];
  private bus = new EventTarget();

  // Cross-tab channel so the two-screen escalation demo works in pure mock mode:
  // a PT dashboard opened in a second tab receives flag/attest events here.
  private bc: BroadcastChannel | null =
    typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel("formguard_pt")
      : null;

  // ~600ms async attestation, configurable for tests/demo pacing.
  private attestDelayMs: number;
  constructor(attestDelayMs = 600) {
    this.attestDelayMs = attestDelayMs;
  }

  private emit(e: PtStreamEvent) {
    // Same-tab listeners via EventTarget; other tabs via BroadcastChannel
    // (BC does not echo to the posting context, so there's no double-delivery).
    this.bus.dispatchEvent(new CustomEvent("pt", { detail: e }));
    this.bc?.postMessage(e);
  }

  async createSession(req: CreateSessionReq): Promise<CreateSessionRes> {
    // Stable patient_id per name (contract: reuse if the name exists).
    let patientId = this.patientsByName.get(req.patient_name);
    if (!patientId) {
      patientId = rid("pat");
      this.patientsByName.set(req.patient_name, patientId);
      this.livePatients.push({
        patient_id: patientId,
        name: req.patient_name,
        compliance_score: 0,
        last_session: "",
      });
    }
    const sessionId = rid("sess");
    const reps = prescribedReps(req.program, req.exercise);
    const info: SessionInfo = {
      session_id: sessionId,
      patient_id: patientId,
      exercise: req.exercise,
      prescribed_reps: reps,
      status: "IN_PROGRESS",
    };
    this.sessions.set(sessionId, {
      info,
      reps: new Map(),
      flags: [],
      attestations: new Map(),
    });
    const live = this.livePatients.find((p) => p.patient_id === patientId);
    if (live) live.last_session = sessionId;
    return {
      session_id: sessionId,
      patient_id: patientId,
      exercise: req.exercise,
      prescribed_reps: reps,
    };
  }

  async logRep(req: LogRepReq): Promise<LogRepRes> {
    const s = this.sessions.get(req.session_id) ?? this.ensure(req.session_id);
    // Dedup by rep_number (contract: B dedups; we match it).
    const already = s.reps.has(req.rep_number);
    s.reps.set(req.rep_number, {
      rep_number: req.rep_number,
      form_state: req.form_state,
      quality_score: req.quality_score,
      coaching_cue: req.coaching_cue,
      pain_level: req.pain_level,
      timestamp: now(),
    });
    if (!already) this.scheduleAttest(req.session_id, req.rep_number);
    return { ok: true, recorded: true };
  }

  private scheduleAttest(sessionId: string, repNumber: number) {
    window.setTimeout(() => {
      const s = this.sessions.get(sessionId);
      const rep = s?.reps.get(repNumber);
      if (!s || !rep) return;
      const sessionHash =
        "0x" +
        hex16(
          `${sessionId}:${s.info.patient_id}:${repNumber}:${rep.quality_score}:${rep.form_state}`,
        );
      const att: Attestation = {
        session_id: sessionId,
        rep_number: repNumber,
        session_hash: sessionHash,
        quality_score: rep.quality_score,
        form_state: rep.form_state,
        tx_hash: "mock_" + hex16(`${sessionId}:${repNumber}`),
        block_height: 12000 + repNumber,
        status: "confirmed",
        timestamp: now(),
      };
      s.attestations.set(repNumber, att);
      this.emit({
        event: "attest",
        data: {
          session_id: sessionId,
          rep_number: repNumber,
          tx_hash: att.tx_hash,
        },
      });
    }, this.attestDelayMs);
  }

  async flagForPt(req: FlagReq): Promise<FlagRes> {
    const s = this.sessions.get(req.session_id) ?? this.ensure(req.session_id);
    const flagId = rid("flag");
    s.flags.push({
      flag_id: flagId,
      type: req.type,
      rep_number: req.rep_number,
      pain_level: req.pain_level,
      notes: req.notes,
      timestamp: now(),
    });
    this.emit({
      event: "flag",
      data: {
        flag_id: flagId,
        patient_id: s.info.patient_id,
        session_id: req.session_id,
        type: req.type,
        rep_number: req.rep_number,
        pain_level: req.pain_level,
      },
    });
    return { ok: true, flag_id: flagId };
  }

  async getSession(sessionId: string): Promise<SessionRes> {
    const s = this.sessions.get(sessionId);
    if (!s) {
      return {
        session: seedSessionInfo(sessionId),
        reps: [],
        flags: [],
        attestations: [],
      };
    }
    return {
      session: s.info,
      reps: [...s.reps.values()].sort((a, b) => a.rep_number - b.rep_number),
      flags: s.flags,
      attestations: [...s.attestations.values()].sort(
        (a, b) => a.rep_number - b.rep_number,
      ),
    };
  }

  async getPatients(): Promise<PatientsRes> {
    return { patients: [...this.livePatients, ...SEED_PATIENTS] };
  }

  async getPatientHistory(patientId: string): Promise<HistoryRes> {
    return (
      SEED_HISTORY[patientId] ?? {
        sessions: [],
        compliance_score: 0,
        trend: "stable",
      }
    );
  }

  subscribePtStream(onEvent: (e: PtStreamEvent) => void): () => void {
    const handler = (ev: Event) =>
      onEvent((ev as CustomEvent<PtStreamEvent>).detail);
    this.bus.addEventListener("pt", handler);
    const bcHandler = (ev: MessageEvent) => onEvent(ev.data as PtStreamEvent);
    this.bc?.addEventListener("message", bcHandler);
    return () => {
      this.bus.removeEventListener("pt", handler);
      this.bc?.removeEventListener("message", bcHandler);
    };
  }

  private ensure(sessionId: string): Store {
    const info: SessionInfo = {
      ...seedSessionInfo(sessionId),
      status: "IN_PROGRESS",
    };
    const store: Store = {
      info,
      reps: new Map(),
      flags: [],
      attestations: new Map(),
    };
    this.sessions.set(sessionId, store);
    return store;
  }
}

// Exposed so Screen 1 can populate the exercise dropdown from the same seed.
export { EXERCISES };
