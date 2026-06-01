// Request/response shapes — NORMATIVE per plans/API_CONTRACT.md (§1 + §3).
// If a shape here ever disagrees with the contract, the contract wins.

export type FormState = "GREEN" | "YELLOW" | "RED";
export type Program = "knee_rehab" | "hip_rehab" | "back_rehab" | "wrist_rsi";
export type FlagType = "pain_spike" | "form_breakdown" | "patient_request";
export type Trend = "improving" | "stable" | "declining";
export type SessionStatus = "IN_PROGRESS" | "COMPLETE";
export type AttestStatus = "confirmed" | "pending";

// --- POST /session/create ---
export interface CreateSessionReq {
  patient_name: string;
  program: Program;
  exercise: string;
}
export interface CreateSessionRes {
  session_id: string;
  patient_id: string;
  exercise: string;
  prescribed_reps: number;
}

// --- POST /tool/log_rep ---
export interface LogRepReq {
  session_id: string;
  rep_number: number;
  form_state: FormState;
  quality_score: number; // 0-100
  coaching_cue: string;
  pain_level: number; // 0-10
}
export interface LogRepRes {
  ok: true;
  recorded: boolean;
}

// --- POST /tool/flag_for_pt ---
export interface FlagReq {
  session_id: string;
  type: FlagType;
  rep_number: number;
  pain_level: number;
  notes: string;
}
export interface FlagRes {
  ok: true;
  flag_id: string;
}

// --- Stored rows ---
export interface Rep {
  rep_number: number;
  form_state: FormState;
  quality_score: number;
  coaching_cue: string;
  pain_level: number;
  timestamp: number;
}
export interface Flag {
  flag_id: string;
  type: FlagType;
  rep_number: number;
  pain_level: number;
  notes: string;
  timestamp: number;
}

// --- Shared object: Attestation (§3) ---
export interface Attestation {
  session_id: string;
  rep_number: number;
  session_hash: string;
  quality_score: number;
  form_state: FormState;
  tx_hash: string; // "mock_<sha16>" in mock/degraded mode
  block_height: number;
  status: AttestStatus;
  timestamp: number;
}

// --- GET /tool/session/{id} ---
export interface SessionInfo {
  session_id: string;
  patient_id: string;
  exercise: string;
  prescribed_reps: number;
  status: SessionStatus;
}
export interface SessionRes {
  session: SessionInfo;
  reps: Rep[];
  flags: Flag[];
  attestations: Attestation[];
}

// --- GET /tool/patients ---
export interface PatientSummary {
  patient_id: string;
  name: string;
  compliance_score: number;
  last_session: string;
}
export interface PatientsRes {
  patients: PatientSummary[];
}

// --- GET /tool/patient/{id}/history ---
export interface HistorySession {
  session_id: string;
  exercise: string;
  status: SessionStatus;
  compliance_score: number;
  timestamp: number;
}
export interface HistoryRes {
  sessions: HistorySession[];
  compliance_score: number;
  trend: Trend;
}

// --- SSE events on /pt/stream ---
export interface FlagEvent {
  flag_id: string;
  patient_id: string;
  session_id: string;
  type: FlagType;
  rep_number: number;
  pain_level: number;
}
export interface AttestEvent {
  session_id: string;
  rep_number: number;
  tx_hash: string;
}
export type PtStreamEvent =
  | { event: "flag"; data: FlagEvent }
  | { event: "attest"; data: AttestEvent };

// `tx_hash` is mock when it carries the mock_ prefix -> render "Pending verification".
export const isMockTx = (txHash: string) => txHash.startsWith("mock_");

// Compliance rule (one definition, everywhere): compliant <=> green_pct >= 80.
export const isCompliant = (greenPct: number) => greenPct >= 80;
