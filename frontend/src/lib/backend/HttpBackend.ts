// Real backend client. Talks to Computer B at VITE_BACKEND_URL. Identical shapes
// to MockBackend (contract §5). Honors the contract error rule:
//   - 400 schema-invalid -> throw with the server's message (caller shows inline).
//   - downstream down -> B returns 200/degraded; network failure -> we surface it
//     so the caller can fall back, but coaching never blocks on it.

import type { BackendClient } from "./BackendClient";
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

export class HttpBackend implements BackendClient {
  private baseUrl: string;
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    console.info("[backend] using HttpBackend", { baseUrl: this.baseUrl });
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    console.info("[backend] -> POST", { path, url, body });
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    console.info("[backend] <- POST status", { path, status: res.status });
    if (res.status === 400) {
      const err = await res.json().catch(() => ({ error: "Bad request" }));
      console.warn("[backend] <- POST 400", { path, error: err });
      throw new Error(err.error ?? "Bad request");
    }
    const data = (await res.json()) as T;
    console.info("[backend] <- POST ok", { path, data });
    return data;
  }

  private async get<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    console.info("[backend] -> GET", { path, url });
    const res = await fetch(url);
    console.info("[backend] <- GET status", { path, status: res.status });
    const data = (await res.json()) as T;
    console.info("[backend] <- GET ok", { path, data });
    return data;
  }

  createSession(req: CreateSessionReq) {
    return this.post<CreateSessionRes>("/session/create", req);
  }
  logRep(req: LogRepReq) {
    return this.post<LogRepRes>("/tool/log_rep", req);
  }
  flagForPt(req: FlagReq) {
    return this.post<FlagRes>("/tool/flag_for_pt", req);
  }
  getSession(sessionId: string) {
    return this.get<SessionRes>(
      `/tool/session/${encodeURIComponent(sessionId)}`,
    );
  }
  getPatients() {
    return this.get<PatientsRes>("/tool/patients");
  }
  getPatientHistory(patientId: string) {
    return this.get<HistoryRes>(
      `/tool/patient/${encodeURIComponent(patientId)}/history`,
    );
  }

  subscribePtStream(onEvent: (e: PtStreamEvent) => void): () => void {
    const es = new EventSource(`${this.baseUrl}/pt/stream`);
    const flag = (ev: MessageEvent) =>
      onEvent({ event: "flag", data: JSON.parse(ev.data) });
    const attest = (ev: MessageEvent) =>
      onEvent({ event: "attest", data: JSON.parse(ev.data) });
    es.addEventListener("flag", flag as EventListener);
    es.addEventListener("attest", attest as EventListener);
    return () => es.close();
  }
}
