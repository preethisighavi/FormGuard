// Factory: pick the backend impl from the resolved env flag. One shared singleton
// so the mock's in-memory store is consistent across every screen.

import { BACKEND_URL, MOCK_BACKEND } from "../../config";
import type { BackendClient } from "./BackendClient";
import { HttpBackend } from "./HttpBackend";
import { MockBackend } from "./MockBackend";

let singleton: BackendClient | null = null;

export function getBackend(): BackendClient {
  if (!singleton) {
    singleton = MOCK_BACKEND ? new MockBackend() : new HttpBackend(BACKEND_URL);
  }
  return singleton;
}

export type { BackendClient } from "./BackendClient";
export * from "./types";
