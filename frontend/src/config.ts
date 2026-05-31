// Central env/config resolution. All client-side env vars MUST be VITE_ prefixed
// and are read via import.meta.env (Vite requirement).
//
// Mock-by-default: with no .env present the app runs fully mocked and demoable.
// Set VITE_USE_MOCK=false (plus VITE_BACKEND_URL) only to opt into real services.

function asBool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === "") return fallback;
  return v === "true";
}

// Master switch — defaults ON (full mock) when unset.
const USE_MOCK = asBool(import.meta.env.VITE_USE_MOCK, true);

// Per-axis overrides inherit the master when unset.
export const MOCK_BACKEND = asBool(import.meta.env.VITE_MOCK_BACKEND, USE_MOCK);
export const MOCK_GEMINI = asBool(import.meta.env.VITE_MOCK_GEMINI, USE_MOCK);

// Real backend URL is unknown until integration time. Only HttpBackend reads it.
export const BACKEND_URL: string =
  (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(
    /\/$/,
    "",
  ) ?? "";

// Gemini Live key — baked into the bundle (hackathon only).
export const GEMINI_API_KEY: string =
  (import.meta.env.VITE_GEMINI_API_KEY as string | undefined) ?? "";

// Live model override for rapid experiments/fixes without code edits.
const rawLiveModel =
  (import.meta.env.VITE_GEMINI_LIVE_MODEL as string | undefined) ??
  "gemini-3.1-flash-live-preview";

export const GEMINI_LIVE_MODEL: string = rawLiveModel.startsWith("models/")
  ? rawLiveModel
  : `models/${rawLiveModel}`;

function asNum(v: string | undefined, fallback: number): number {
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// Live media tuning knobs (override in .env as needed).
export const GEMINI_FRAME_INTERVAL_MS = asNum(
  import.meta.env.VITE_GEMINI_FRAME_INTERVAL_MS as string | undefined,
  100,
);
export const GEMINI_FRAME_WIDTH = asNum(
  import.meta.env.VITE_GEMINI_FRAME_WIDTH as string | undefined,
  640,
);
export const GEMINI_BARGE_IN_RMS_THRESHOLD = asNum(
  import.meta.env.VITE_GEMINI_BARGE_IN_RMS_THRESHOLD as string | undefined,
  0.03,
);
export const GEMINI_BARGE_IN_COOLDOWN_MS = asNum(
  import.meta.env.VITE_GEMINI_BARGE_IN_COOLDOWN_MS as string | undefined,
  700,
);

// NEAR testnet explorer template (contract §2).
export const NEAR_EXPLORER = (txHash: string) =>
  `https://explorer.testnet.near.org/transactions/${txHash}`;
