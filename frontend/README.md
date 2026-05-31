# FormGuard — Frontend (Computer A)

React + TypeScript + Vite. Captures camera + mic, streams to **Gemini Live**, routes tool calls to
**Computer B**, renders all screens. Screen 2 (Live Session) is the hero. Inline styles only, no UI/
router/state libraries, 9-var palette + Satoshi (Fontshare CDN).

## Run

```bash
npm install
npm run dev        # http://localhost:5173      (PT dashboard: /#pt)
npm run build      # -> dist/
```

The app **defaults to full mock** — demoable with no backend and no `.env`.

## Env (all VITE_ prefixed; read via import.meta.env)

Create `.env` (mock-by-default, so optional):

```
VITE_USE_MOCK=true        # master switch. unset/empty => true (full mock)
# VITE_MOCK_GEMINI=false  # override: real Gemini Live + mock backend (demo-now target)
# VITE_MOCK_BACKEND=false # override: real backend
VITE_BACKEND_URL=         # Computer B URL — unknown until integration; only HttpBackend reads it
VITE_GEMINI_API_KEY=      # the one thing wireable now; baked into the bundle (hackathon only)
```

| env | resolves to |
|---|---|
| `VITE_USE_MOCK=true` | mock Gemini + mock backend (safest stage demo) |
| `VITE_USE_MOCK=true` + `VITE_MOCK_GEMINI=false` | real Gemini Live + mock backend |
| `VITE_USE_MOCK=false` (+ `VITE_BACKEND_URL`) | full real |

## Architecture (demoable-first)

Two independent source seams behind interfaces — screens never call `fetch`/WebSocket directly:

- `src/lib/backend/` — `BackendClient` (contract §1/§3). `MockBackend` (in-memory, async attest,
  cross-tab `BroadcastChannel` SSE) ↔ `HttpBackend` (real). Swap = one env flag, zero screen changes.
- `src/lib/coach/` — `CoachSource`. `MockCoach` (scripted narrative + 2-stage escalation, Web Speech
  TTS) ↔ `GeminiLiveCoach` (real WSS, registers the 2 contract tools). `LiveSession` derives all UI
  from coach signals and forwards each as a tool call to the backend.

## Demo (mock mode)

- Setup → Start → Live Session runs a mostly-GREEN narrative with one coached YELLOW dip → compliant.
- **Voice-only pain is hands-off.** With real Gemini it just hears you. In mock mode, the operator
  drives the patient's lines:
  - **`P`** = "my knee hurts" → Stage 1: ring AMBER, coach adapts + asks "does that still hurt?"
  - **`Y`** = "yes it still hurts" → Stage 2: full-red **STOP** takeover + `flag_for_pt` fires.
  (A SpeechRecognition listener also feeds these phrases when available.)
- **Two-screen hero:** open `/#pt` in a second tab; the flag toast fires there live via
  `BroadcastChannel`. (The patient *row* flash matches by `patient_id` — works with a shared real
  backend; pure-mock tabs don't share a store, so the toast is the cross-tab signal.)

## Deploy (Insforge Sites)

```bash
npm run build
npx @insforge/cli deployments deploy ./frontend   # point at ./frontend/dist if the CLI wants static output
```

HTTPS satisfies the camera/mic secure-context requirement. `/#pt` is hash-based so it needs no SPA
rewrite. When wiring the real backend, Computer B must allow this origin via CORS (fetch + SSE).

## Gemini Live — verify-when-keyed (build-sequence step 3)

`GeminiLiveCoach` is written to the current Live protocol but untested without a key. Two knobs to
confirm against the live endpoint: the model name (`MODEL`) and the `realtimeInput` field names.
