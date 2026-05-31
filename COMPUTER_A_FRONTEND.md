# Computer A — Frontend (Gemini Live + React UI)

**Role:** Browser app. Captures camera + mic, streams to Gemini Live WebSocket, routes tool calls to Computer B, renders all 4 screens.

**Depends on:** Computer B's `/tool/*` API running at `http://B_LOCAL:8000`

**Tech:** React + TypeScript + Vite. No backend framework needed.

---

## Quick Start

```bash
npm create vite@latest formguard-frontend -- --template react-ts
cd formguard-frontend
# install only what needed: no UI lib, no state lib, no routing lib
npm run dev   # → http://localhost:5173
```

Set `VITE_BACKEND_URL=http://localhost:8000` in `.env`.

---

## What to Build

### Screen 1 — Setup
Form with: Patient name (text), Program (select: knee_rehab / hip_rehab / back_rehab), Exercise (select, populated from program), Start button. On submit, `POST /session/create` with `{patient_name, program, exercise}`. **Store both `session_id` AND the returned `patient_id`** (B maps name → stable id). Navigate to Screen 2.

### Screen 2 — Live Session (the demo moment)
- **Camera feed:** `<video>` element from `navigator.mediaDevices.getUserMedia`. Capture JPEG frames to a canvas at **~3–4 FPS during reps** (1 FPS is too sparse to catch a rep — a squat is 2–3s). Drop to 1 FPS only as a bandwidth fallback.
- **Mic feed:** `getUserMedia` audio track → 16 kHz 16-bit mono PCM chunks for Gemini Live (input format the Live API expects; output is 24 kHz). Budget time for audio encoding — it's a known time-sink.
- **Gemini Live WebSocket:** Open WSS to `wss://generativelanguage.googleapis.com/...`. Stream video frames + mic audio. Receive audio responses (play through speakers) + tool invocations. **API key:** embedded in the frontend for the demo (no ephemeral-token mint exists — B holds no Gemini SDK). Fine for a hackathon; don't ship it.
- **State ring:** Big colored border around video. GREEN border + "Good Form" / YELLOW border + "Adjust Form" / RED border + "Stop — Rest Now". Transitions on tool response.
- **Pain reporting — voice first:** the patient says "my knee hurts" → Gemini Live hears it and calls `flag_for_pt`. This is the hero beat (see M8) and showcases the Live audio model. Keep a **pain slider (0-10) as a manual fallback** that also triggers a flag at ≥7.
- **Agent log:** Scrollable list of events from Gemini Live tool calls. Show rep number, form state, coaching cue.
- **Rep counter:** `X / prescribed_reps` display. (B dedups by rep_number, so a repeated count won't double-increment.)

### Screen 3 — Summary
Show: rewards earned, session stats (reps, peak pain, avg form score), NEAR attestation badge per rep (tx_hash with explorer link + compliance score), "Share with PT" button linking to `/pt`. **Attestations arrive asynchronously** — poll `GET /tool/session/{id}` (or read `/pt/stream`) and fill in each tx_hash as it lands. **If NEAR is down or a hash is still `mock_...`, show a "Pending verification" badge, not a dead explorer link.**

### Screen 4 — PT Dashboard (`/pt`)
- **Patient list sidebar:** from `GET /tool/patients` (the list endpoint — *not* the per-patient history route).
- **Live escalation (the hero):** open an `EventSource` to `GET /pt/stream`. When a `flag` event arrives, **the relevant patient row flashes / a toast fires in real time** — this is what judges remember. Demo this on a second screen next to the patient's Screen 2.
- Session history table. Per-session drill-down: rep list, flags, NEAR attestations. Compliance score badge per patient (from `GET /tool/patient/{id}/history`).

### Tool Router (the glue)
When Gemini Live invokes a tool function, POST the tool payload to Computer B's `/tool/{action}` endpoint. Await the response and send it back to Gemini Live as the tool response.

**Gemini Live is given exactly TWO tools: `log_rep` and `flag_for_pt`.** It does NOT call `attest_rep` — B handles attestation server-side and asynchronously. Fewer tools = more reliable tool-calling. Don't register attest as a Gemini function.

```typescript
// tool_router.ts — this is the critical integration point
async function handleToolCall(toolName: string, args: any): Promise<any> {
  const res = await fetch(`${BACKEND_URL}/tool/${toolName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args)
  });
  return res.json();
}
```

---

## Mock Mode (use this first)

Set `VITE_USE_MOCK=true` to bypass Gemini Live entirely. Mock cycles GREEN→YELLOW→RED every 2 reps with spoken coaching cues via Web Speech API TTS. This lets you build all 4 screens without waiting for Computer A's Gemini Live WebSocket integration.

---

## Integration Tests

Run these manually by hitting Computer B's endpoints directly with fetch/curl.

| # | Test | What to Check |
|---|------|---------------|
| M1.1 | `POST http://B:8000/tool/log_rep` with `{session_id:"test", rep_number:1, form_state:"GREEN", quality_score:90, coaching_cue:"Good", pain_level:0}` | Returns `{ok:true, recorded:true}` |
| M1.2 | `POST http://B:8000/session/create` with `{patient_name:"Demo Patient", program:"knee_rehab", exercise:"squat"}` | Returns `{session_id, patient_id, prescribed_reps}` |
| M2.1 | After logging 3 reps via M1.1, call `GET http://B:8000/tool/session/test` | Response contains all 3 reps |
| M3.1 | Log a rep via M1.1, then `GET http://B:8000/tool/session/test` | `attestations` array contains a `tx_hash` (string) — B attested it server-side, A never called attest |
| M4.1 | Open `/pt` with mock data | Shows patient list + session history |
| M6.1 | Open browser with `VITE_USE_MOCK=false` (real Gemini Live) | Camera feed visible, Gemini Live responds with audio + tool calls |
| M8.1 | Complete a full session (10 reps) | Summary screen shows rewards + NEAR tx_hashes |

---

## Milestones

| Time | Milestone | Check |
|------|-----------|-------|
| **M1 (0:00-0:30)** | Screen 1 renders. Can call Computer B's `/tool/log_rep` and see `{ok:true}`. Can create a session and get a session_id back. | Run M1.1, M1.2. Have B confirm receipt. |
| **M2 (0:30-1:00)** | Mock Gemini cycles through 3 reps. Each rep calls B via tool router. Screen 2 shows state ring cycling + agent log updating. Session summary shows after rep 3. | Run M2.1 after 3 reps. Show B the session they see. |
| **M3 (1:00-1:30)** | B auto-attests server-side (A does NOT call attest). A polls `GET /tool/session/{id}` and renders tx_hash per rep as it lands, with NEAR explorer link (or "Pending" badge). | Verify tx_hash appears in session response and format matches what C returns. |
| **M4 (1:30-2:00)** | All 4 screens complete. Setup → Live → Summary → PT Dashboard flow works end-to-end with mock data. Pain slider updates context. | Run M4.1. Walk through all 4 screens with B and C watching. |
| **M5 (2:00-2:30)** | No A-specific milestone (C deploys real NEAR contract). Tool router continues working unchanged. | Verify B's attest calls now return real tx_hashes (format may differ from mock). |
| **M6 (2:30-3:00)** | Real Gemini Live WebSocket connected. Camera frames + mic streaming. Tool calls firing automatically. | Run M6.1. First full loop: camera → Gemini → tool → B → response. Gather all three computers to watch. |
| **M7 (3:00-3:30)** | No A-specific milestone (B switches to real Insforge). App continues working. | Verify session data persists across page reload. |
| **M8 (3:30-4:00)** | **Hero moment.** Voice "my knee hurts" (or slider ≥7) → `flag_for_pt` → patient screen shows STOP + alert AND `/pt/stream` EventSource lights up the PT dashboard on a second screen in real time. Session complete → summary with NEAR badge. (`/tool/adapt` is cut.) | Run M8.1 + the two-screen escalation. Demo without stopping. |
| **M9 (4:00-4:30)** | PT Dashboard complete: compliance score from NEAR, per-rep attestations, flags visible. | Show PT Dashboard to B and C. Verify compliance score matches C's contract output. |
| **M10 (4:30-5:00)** | Error states handled: camera failure, Gemini API error, NEAR down, Insforge down. Graceful degradation visible. | Kill camera → mock takes over. Kill B → inline fallback. Show each failure mode. |
| **M11 (5:00-5:30)** | Demo mode ready. `use_mock=true` flag works. Pre-loaded demo data in PT Dashboard. All screens screenshot as backup. | Dry run the 3-minute demo. Time it. |
| **M12 (5:30-6:00)** | Buffer. Polish transitions. Fix anything janky. | Final walkthrough with B and C. Breathe. |

---

## Hard Rules

- **Do not import any UI library.** Use inline styles only. The design system is 9 CSS variables (see below).
- **Do not add routing.** Use state-based screen switching (`screen === 'setup' | 'live' | 'summary' | 'pt'`).
- **Do not add state management.** React useState + useEffect only.
- **Do not install npm packages beyond react, react-dom, typescript, vite, and @types/*.** No axios, no react-router, no styled-components.
- **Mock first, real later.** Build everything with `VITE_USE_MOCK=true`. Switch to real Gemini Live WebSocket in M6.
- **`EventSource` (SSE) and `SpeechRecognition` are browser-native — not deps.** Use them freely for `/pt/stream` and voice; the "no packages" rule is about npm installs, not Web APIs.
- **Tune the mock to a winning narrative.** Default mock should run mostly-GREEN with one coached YELLOW dip → compliant session. Have a second mock path that triggers the pain→PT escalation. Don't ship the GREEN→YELLOW→RED-every-2-reps cycle as the demo (it reads as a failing session).

### CSS Variables (only styles you need)

```css
:root {
  --bg: #0d1117; --panel: #161b22; --border: #30363d;
  --text: #c9d1d9; --muted: #8b949e;
  --green: #3fb950; --green-bg: #132a1a;
  --amber: #e3b341; --amber-bg: #2a1f0a;
  --red: #ff6b6b; --red-bg: #2a0a0a;
  --blue: #58a6ff; --purple: #bc8cff;
}
```
