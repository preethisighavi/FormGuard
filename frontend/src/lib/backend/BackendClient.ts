// The single seam every screen talks to. Screens never call fetch/EventSource
// directly. MockBackend and HttpBackend implement this with identical shapes
// (contract §5), so swapping is one env flag with zero screen changes.

import type {
  CreateSessionReq,
  CreateSessionRes,
  FlagReq,
  FlagRes,
  HistoryRes,
  LogRepReq,
  LogRepRes,
  PatientsRes,
  PtStreamEvent,
  SessionRes,
} from "./types";

export interface BackendClient {
  // A -> B
  createSession(req: CreateSessionReq): Promise<CreateSessionRes>;
  logRep(req: LogRepReq): Promise<LogRepRes>;
  flagForPt(req: FlagReq): Promise<FlagRes>;

  // reads
  getSession(sessionId: string): Promise<SessionRes>;
  getPatients(): Promise<PatientsRes>;
  getPatientHistory(patientId: string): Promise<HistoryRes>;

  // /pt/stream — returns an unsubscribe fn. Used by the PT dashboard (Screen 4).
  subscribePtStream(onEvent: (e: PtStreamEvent) => void): () => void;
}
