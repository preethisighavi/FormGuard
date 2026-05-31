# FormGuard v2 — Three-Computer Build Spec
## Gemini Live + Insforge + NEAR AI
### Applied Intelligence Hackathon · May 31 2026

---

## Architecture Overview

```
┌─ Computer A ───────────────────────────────────────────────────┐
│  FRONTEND (Browser)                                             │
│  ┌─────────────┐  ┌──────────────┐                              │
│  │ Camera      │  │ Gemini Live  │  ← WSS → Gemini API          │
│  │ + Mic       │  │ WebSocket    │  → audio + tool_calls        │
│  └──────┬──────┘  └──────┬───────┘                              │
│         │                │ tool_invocation: "log_rep"            │
│         │                ▼                                       │
│         │         ┌──────────────┐                               │
│         │         │ Tool Router  │── HTTP POST → Computer B      │
│         │         │ (tiny proxy) │← JSON response               │
│         │         └──────────────┘                               │
│         │                                                       │
│         │  ┌──────────────────┐                                  │
│         └──│ Video Element    │  displays camera + state ring    │
│            │ Pain Slider      │                                  │
│            │ Agent Log        │                                  │
│            │ PT Dashboard     │                                  │
│            └──────────────────┘                                  │
└──────────────────────────────────────────────────────────────────┘
         │ POST /tool/log_rep, /tool/attest_rep, etc.
         ▼
┌─ Computer B ───────────────────────────────────────────────────┐
│  BACKEND (FastAPI)                                              │
│  ┌────────────────────┐  ┌──────────────┐  ┌─────────────────┐ │
│  │ /tool/log_rep      │  │ Insforge     │  │ NEAR Client     │ │
│  │ /tool/flag_for_pt  │─▶│ Client       │  │ (Web3/RPC)      │ │
│  │ /tool/get_history  │  │              │  │                 │ │
│  │ /tool/attest_rep   │  │ session data │  │ call_contract   │ │
│  │                    │  │ patient hist │  │ attest_rep()    │ │
│  │ PT Dashboard API   │  │ flags        │  │ verify_session()│ │
│  └────────────────────┘  └──────────────┘  └────────┬────────┘ │
│                                                      │          │
└──────────────────────────────────────────────────────┼──────────┘
                                                       │ JSON-RPC
                                                       ▼
┌─ Computer C ───────────────────────────────────────────────────┐
│  NEAR SMART CONTRACT + MOCK SERVER                              │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ contracts/formguard/src/lib.rs                              │ │
│  │ pub fn attest_rep(session_id, rep, hash, quality_score)     │ │
│  │ pub fn verify_session(session_id) → compliance_report       │ │
│  │ pub fn get_patient_stats(patient_id) → aggregated           │ │
│  └────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ mock_server.py  (standalone, returns valid-looking         │ │
│  │  responses so B integrates without real NEAR testnet)      │ │
│  └────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

---

## Interface Contracts

### A → B: Backend Tool API (POST /tool/{action})

**Gemini Live only ever calls `log_rep` and `flag_for_pt`.** Attestation is NOT a Gemini
tool — B computes the hash and fires the NEAR call itself (see below). This keeps the
live audio loop synchronous and cheap; chain latency never blocks coaching.

```
POST /session/create
{ "patient_name": "Jane Doe", "program": "knee_rehab", "exercise": "squat" }
→ { "session_id": "abc123", "patient_id": "pat_7f3", "exercise": "squat",
    "prescribed_reps": 10 }
# B maps patient_name → stable patient_id (creates one if new). A stores both.

POST /tool/log_rep                       # called by Gemini Live every rep
{
  "session_id": "abc123",
  "rep_number": 4,
  "form_state": "YELLOW",
  "quality_score": 62,
  "coaching_cue": "Push knees outward",
  "pain_level": 2
}
→ { "ok": true, "recorded": true }
# B dedups by (session_id, rep_number) — last write wins (Gemini miscounts).
# B then fires attest_rep to C ASYNCHRONOUSLY (does not block this response).

POST /tool/flag_for_pt                    # called by Gemini Live on pain/safety
{ "session_id": "abc123", "type": "pain_spike",
  "rep_number": 4, "pain_level": 7, "notes": "patient said knee hurts" }
→ { "ok": true, "flag_id": "flag_xxx" }
# Writing a flag ALSO emits an SSE event on /pt/stream → PT dashboard lights up live.

# attest_rep is INTERNAL to B (not exposed to Gemini). B computes:
#   session_hash = sha256("{session_id}:{patient_id}:{rep_number}:{quality_score}:{form_state}")
# then POSTs to C. A never sends a hash and never calls this.

GET /tool/session/{session_id}
→ { "session": {...}, "reps": [...], "flags": [...], "attestations": [...] }
# A polls this (or reads /pt/stream) to surface each tx_hash as it lands on-chain.

GET /tool/patients
→ { "patients": [{ "patient_id": "pat_7f3", "name": "Jane Doe",
    "compliance_score": 88, "last_session": "..." }, ...] }
# Powers the PT dashboard patient-list sidebar.

GET /tool/patient/{patient_id}/history
→ { "sessions": [...], "compliance_score": 88, "trend": "improving" }

GET /pt/stream   (Server-Sent Events)
→ event: flag    data: { flag_id, patient_id, session_id, type, pain_level, rep_number }
→ event: attest  data: { session_id, rep_number, tx_hash }
# B pushes flags + attestations here. PT dashboard subscribes → real-time escalation.
```

### B → C: NEAR Interface (changeable — Computer C controls this)

```
Computer C provides either:
  a) Mock HTTP server at http://c.local:5001/near
  b) Real signing relay at the same path (NOT the raw RPC — see below)

Both respond with the same shape:

POST /near/attest_rep
{ "session_id": "abc123", "rep_number": 4,
  "session_hash": "0x...", "quality_score": 62, "form_state": "YELLOW" }
→ { "tx_hash": "9k3...", "block_height": 12345, "status": "confirmed" }

POST /near/verify_session
{ "session_id": "abc123" }
→ { "total_reps": 10, "green_pct": 90, "compliant": true,    # compliant ⇔ green_pct >= 80
    "attestations": [...], "tx_hashes": [...] }
```

**Real mode is a signing relay, not raw RPC.** B is forbidden the NEAR SDK, so C runs an
HTTP endpoint that signs + submits transactions with a funded testnet key and returns the
real `tx_hash`. Because per-rep attestation fires rapid sequential txns, **C MUST serialize
submissions through a single in-process queue (one access key)** or hit nonce collisions.
NEAR testnet blocks are ~1–1.5s; 10 serialized reps over a 60–90s exercise is fine.

Computer C defines the NEAR schema. Computer B treats it as an HTTP API. Computer C can swap
mock ↔ real relay without B changing a line. B calls C **asynchronously** (fire-and-forget
from the live loop), so relay latency never stalls Gemini.

---

## Work Breakdown

### Computer A — Frontend (React + Gemini Live WebSocket)
**Owner:** Builds the browser app that patients and PTs see.

| What | Details |
|------|---------|
| Camera capture | video element → canvas → JPEG at 1 FPS |
| Mic capture | getUserMedia → PCM audio chunks |
| Gemini Live WSS | Open WebSocket to Gemini API, stream frames + audio simultaneously |
| Tool call router | When Gemini calls a tool, POST to Computer B's /tool/* endpoints |
| Audio playback | Receive Gemini audio responses → play through speakers |
| Session UI | State ring (GREEN/YELLOW/RED), rep counter, pain slider, agent log |
| PT Dashboard | Patient list, session history, compliance score, flags |
| NEAR badge display | Show tx_hash per rep, compliance status |

**Starts with:** mock Gemini connection (hardcoded cycle GREEN→YELLOW→RED every 2 reps, plays pre-recorded audio cue)

### Computer B — Backend (FastAPI + Insforge + NEAR Client)
**Owner:** Builds tool execution layer + storage + PT API.

| What | Details |
|------|---------|
| FastAPI server | /tool/* endpoints |
| Insforge client | Write/read session data, patient history, flags |
| NEAR client | HTTP calls to Computer C's NEAR endpoint (mock or real) |
| PT Dashboard API | Aggregate session data for frontend |
| Mock response generator | Returns realistic data when Insforge is unavailable |

**Starts with:** All /tool/* endpoints return hardcoded mock responses. No Insforge or NEAR dependency needed to test.

### Computer C — NEAR Smart Contract + Mock Server
**Owner:** Builds the blockchain layer.

| What | Details |
|------|---------|
| NEAR contract (Rust) | `attest_rep()`, `verify_session()`, `get_compliance_score()` |
| Contract tests | cargo test on the contract logic |
| Contract deployment | Deploy to NEAR testnet |
| Mock NEAR server | Simple Flask/Express server returning the same shapes as real NEAR |
| Session hashing schema | Define what goes into the hash (session_id + rep + quality + patient_id prefix) |

**Starts with:** Mock server returning canned responses. Contract written and tested locally.

---

## Integration Milestones (every ~30 min)

### M1 (0:00 - 0:30) — Handshake
- **A** sends `POST /tool/log_rep` with a hardcoded rep → **B** returns `{ok: true}`
- **C** sends `POST /near/attest_rep` to own mock server → gets mock tx_hash back
- **B** sends `POST /near/attest_rep` to **C**'s mock server → gets same response shape
- **B** validates Insforge's real API shape NOW (auth + one write/read round-trip) so the
  M7 switch holds no surprises. Insforge is prize-gated — derisk it in hour 1, not at M7.

### M2 (0:30 - 1:00) — Session lifecycle wired
- **A**'s mock Gemini cycles through 3 reps → calls **B** for each rep → **B** records them
- **A** calls **B**'s `GET /tool/session/{id}` → sees all 3 reps
- **C** mock server responds to batch `verify_session` call from **B**

### M3 (1:00 - 1:30) — NEAR integration live
- **B** auto-fires `attest_rep` to **C** ASYNCHRONOUSLY after every `log_rep` (Gemini never
  calls attest) → stores tx_hash alongside rep when it returns
- **A** fetches session from **B** (poll or `/pt/stream`) → tx_hash appears per rep as it lands
- **C**'s mock shows 3 attestations for the session
- **Hash alignment checkpoint:** confirm B's 5-field hash
  (`session_id:patient_id:rep_number:quality_score:form_state`) matches C's expectation

### M4 (1:30 - 2:00) — Frontend UI complete
- **A** shows: camera feed, state ring cycling GREEN→YELLOW→RED, rep counter, agent log
- **A** shows: pain slider, NEAR badge with tx_hashes
- **B** serves PT dashboard data → **A** renders patient list + session history

### M5 (2:00 - 2:30) — NEAR contract deployed
- **C** deploys `attest_rep` contract to NEAR testnet
- **C** updates mock server OR switches to proxy real testnet
- **B**'s attest calls go to real NEAR → real tx_hashes returned
- **A** shows real NEAR explorer links (clickable)

### M6 (2:30 - 3:00) — Real Gemini Live connected
- **A** opens real WebSocket to Gemini Live API
- Camera frames + mic audio stream to Gemini
- Gemini's first tool call (`log_rep`) hits **B** → stored in Insforge
- Full loop works end-to-end with real AI

### M7 (3:00 - 3:30) — Real Insforge connected
- **B** switches from in-memory to real Insforge writes
- Session data persists across page reloads
- PT Dashboard shows historical data
- **C**'s NEAR attestations continue working alongside

### M8 (3:30 - 4:00) — Hero moment: live escalation to PT
- **The demo's signature beat.** Patient says "my knee hurts" (or pain slider ≥ 7) → Gemini
  calls `flag_for_pt` → frontend shows STOP + alert AND the **PT dashboard on a second screen
  lights up in real time** via `/pt/stream` (SSE).
- Two-screen choreography rehearsed: patient screen + PT screen side by side.
- Session completes → summary screen shows rewards + per-rep NEAR attestations.
- (`/tool/adapt` is CUT — escalation is the hero; don't split focus building a second
  agentic feature.)

### M9 (4:00 - 4:30) — PT Dashboard complete
- All 4 screens: Setup → Live Session → Summary → PT Dashboard
- PT Dashboard shows compliance score calculated from NEAR data
- Click session → see per-rep attestations + flags

### M10 (4:30 - 5:00) — Edge cases + error handling
- What happens when camera fails → mock fallback
- What happens when Gemini API errors → graceful degradation
- What happens when NEAR is down → B shows "Pending verification" badge
- What happens when Insforge is down → B caches in memory

### M11 (5:00 - 5:30) — Demo preparation
- Set use_mock flags for fallback demo path
- Pre-load PT dashboard with demo patient data
- Rehearse the 3-minute demo flow
- Screenshot every screen as backup

### M12 (5:30 - 6:00) — Buffer + polish
- Fix any remaining integration issues
- Tune Gemini Live prompts for better form assessment
- Make sure all fallback paths work
- Breathe

---

## Key Design Decisions

1. **Tool calls route through B, not directly to NEAR.** The frontend (A) never talks to NEAR directly. A calls B, B calls C. This keeps the architecture clean and lets B add validation + caching.

   **Corollary — keep the real-time loop synchronous and cheap; push slow work async.** Gemini Live only calls `log_rep` / `flag_for_pt` and gets an instant `{ok:true}`. Everything slow — NEAR attestation, the PT-dashboard push, Insforge persistence — runs on async side-channels (B fires-and-forgets to C; B emits SSE on `/pt/stream`). Chain latency and notifications never stall coaching. This is the single principle that de-risks per-rep on-chain + live escalation at once.

2. **C owns the NEAR schema but exposes it as an HTTP API.** B never imports NEAR SDKs or knows about contract internals. C provides an HTTP endpoint (mock or real) and B just does JSON POST.

3. **Every endpoint starts as a mock.** Each computer works independently for the first 90 minutes. Nothing blocks on anyone else.

4. **Gemini Live runs from the browser.** The WebSocket connects directly from A's browser to Google's API. This avoids proxying real-time video through B (latency killer). A only calls B for tool execution.

5. **Each computer has a fallback.** A can demo without camera (mock cycle). B can demo without Insforge (in-memory). C can demo without NEAR testnet (mock server).

---

## One Computer = One Clear Vertical Slice

| Computer | Owns | Doesn't Need to Know |
|----------|------|---------------------|
| A | Cameras, mics, WebSockets, UI | NEAR contract internals, Insforge schema |
| B | Tool logic, storage, aggregation | Gemini Live protocol, NEAR SDK |
| C | Smart contracts, blockchain, hashing | Frontend rendering, Gemini prompts |

**Everyone writes mocks first. Everyone integrates at M1 (30 min). Nobody blocks.**
