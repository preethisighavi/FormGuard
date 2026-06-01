// Dummy data for the fully-offline demo. Swapped out wholesale when the real
// backend (Computer B) comes online — no screen depends on these literals.

import type { HistoryRes, PatientSummary, Program, SessionInfo } from "./types";

// prescribed_reps map from (program, exercise). Default 10 if unknown (contract §0).
const REPS: Record<string, number> = {
  "knee_rehab:squat": 10,
  "knee_rehab:sit_to_stand": 8,
  "knee_rehab:leg_raise": 12,
  "hip_rehab:bridge": 12,
  "hip_rehab:clamshell": 15,
  "back_rehab:bird_dog": 10,
  "back_rehab:cat_cow": 10,
  "wrist_rsi:wrist_extension": 5,
};
export function prescribedReps(program: string, exercise: string): number {
  return REPS[`${program}:${exercise}`] ?? 10;
}

// Exercises offered per program (Screen 1 select population).
export const EXERCISES: Record<Program, string[]> = {
  knee_rehab: ["squat", "sit_to_stand", "leg_raise"],
  hip_rehab: ["bridge", "clamshell"],
  back_rehab: ["bird_dog", "cat_cow"],
  wrist_rsi: ["wrist_extension"],
};

// Pre-loaded PT dashboard patients (the plan asks for a seeded "John D.").
export const SEED_PATIENTS: PatientSummary[] = [
  {
    patient_id: "pat_john",
    name: "John D.",
    compliance_score: 88,
    last_session: "sess_john_3",
  },
  {
    patient_id: "pat_maria",
    name: "Maria S.",
    compliance_score: 94,
    last_session: "sess_maria_2",
  },
  {
    patient_id: "pat_ahmed",
    name: "Ahmed K.",
    compliance_score: 71,
    last_session: "sess_ahmed_1",
  },
];

export const SEED_HISTORY: Record<string, HistoryRes> = {
  pat_john: {
    compliance_score: 88,
    trend: "improving",
    sessions: [
      {
        session_id: "sess_john_1",
        exercise: "squat",
        status: "COMPLETE",
        compliance_score: 80,
        timestamp: 1730000000,
      },
      {
        session_id: "sess_john_2",
        exercise: "squat",
        status: "COMPLETE",
        compliance_score: 86,
        timestamp: 1730086400,
      },
      {
        session_id: "sess_john_3",
        exercise: "sit_to_stand",
        status: "COMPLETE",
        compliance_score: 90,
        timestamp: 1730172800,
      },
    ],
  },
  pat_maria: {
    compliance_score: 94,
    trend: "stable",
    sessions: [
      {
        session_id: "sess_maria_1",
        exercise: "bridge",
        status: "COMPLETE",
        compliance_score: 92,
        timestamp: 1730000000,
      },
      {
        session_id: "sess_maria_2",
        exercise: "clamshell",
        status: "COMPLETE",
        compliance_score: 96,
        timestamp: 1730086400,
      },
    ],
  },
  pat_ahmed: {
    compliance_score: 71,
    trend: "declining",
    sessions: [
      {
        session_id: "sess_ahmed_1",
        exercise: "bird_dog",
        status: "COMPLETE",
        compliance_score: 71,
        timestamp: 1730000000,
      },
    ],
  },
};

// A stable demo SessionInfo used when a session id isn't one we created live.
export function seedSessionInfo(sessionId: string): SessionInfo {
  return {
    session_id: sessionId,
    patient_id: "pat_john",
    exercise: "squat",
    prescribed_reps: 10,
    status: "COMPLETE",
  };
}
