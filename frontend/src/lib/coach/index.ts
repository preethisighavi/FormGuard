// Factory: pick the coach impl from the resolved env flag. A fresh instance per
// session is fine (unlike the backend, the coach holds no shared store).

import { MOCK_GEMINI } from "../../config";
import type { CoachSource } from "./CoachSource";
import { GeminiLiveCoach } from "./GeminiLiveCoach";
import { MockCoach } from "./MockCoach";

export function createCoach(): CoachSource {
  return MOCK_GEMINI ? new MockCoach() : new GeminiLiveCoach();
}

export type {
  CoachSource,
  CoachHandlers,
  CoachStartOpts,
  RepSignal,
  FlagSignal,
} from "./CoachSource";
