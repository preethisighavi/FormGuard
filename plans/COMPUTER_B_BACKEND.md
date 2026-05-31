# Computer B — Backend (FastAPI + Insforge + NEAR Client)

**Role:** Tool execution layer. Receives tool calls from Computer A's frontend, writes to Insforge, calls Computer C's NEAR endpoint for attestation. Also serves PT Dashboard data.

**Depends on:** Computer C's NEAR HTTP endpoint at `http://C_LOCAL:5001/near`

**Tech:** FastAPI, Python 3.11+, httpx (for HTTP calls to C and Insforge).

> **All request/response shapes are normative in [`API_CONTRACT.md`](./API_CONTRACT.md)** — §1
> (what you return to A), §2 (what you send C), §3 (the Attestation object), §4 (hash formula),
> §0 (enums, ranges, the 400-vs-fallback error rule). This plan describes *implementation*; the
> contract defines the *shapes*. When they differ, the contract wins.

---

## Quick Start

```bash
mkdir formguard-backend && cd formguard-backend
python -m venv venv && source venv/bin/activate
pip install fastapi uvicorn httpx pydantic
uvicorn main:app --reload --port 8000   # → http://localhost:8000
```

Set these env vars (all optional — everything falls back to mock):
```
INSFORGE_API_URL=https://api.insforge.dev
INSFORGE_API_KEY=...
NEAR_ENDPOINT=http://C_LOCAL:5001/near    # default falls back to mock
```

---

## What to Build

File layout:

```
main.py              # FastAPI app, router registration
tools/log_rep.py     # write rep (dedup by rep_number) + trigger async attest
tools/attest_rep.py  # internal: compute hash, call C, store tx_hash, emit SSE
tools/flag_for_pt.py # create PT flag + emit SSE flag event
tools/session.py     # create/get session + patients list + history
pt_stream.py         # SSE endpoint + subscriber registry (push flag/attest events)
insforge_client.py   # Insforge HTTP wrapper (with in-memory fallback)
near_client.py       # NEAR HTTP client (calls C, with in-memory fallback)
models.py            # Pydantic models for all endpoints
```

### Endpoints

You own these. **Exact shapes: [`API_CONTRACT.md`](./API_CONTRACT.md) §1.** Summary:

| Endpoint | Notes |
|----------|-------|
| `POST /session/create` | body `{patient_name, program, exercise}`; map name → stable `patient_id` |
| `POST /tool/log_rep` | returns instantly; fires async attest + emits `attest` SSE |
| `POST /tool/flag_for_pt` | emits `flag` SSE event (hero path) |
| `GET /tool/session/{id}` | aggregates reps + flags + attestations |
| `GET /tool/patients` | PT dashboard sidebar list |
| `GET /tool/patient/{id}/history` | sessions + compliance_score + trend |
| `GET /pt/stream` | SSE `flag` + `attest` events |

`attest_rep` is **internal** — fired by `log_rep`, never called by A/Gemini. Keep it a function
(optionally a debug `POST /tool/attest_rep`); the live path auto-attests.

### Tool Implementations

**`log_rep`:** **Dedup by `(session_id, rep_number)` — last write wins** (Gemini miscounts/repeats). Write to Insforge collection `reps`. Fields: session_id, rep_number, form_state, quality_score, coaching_cue, pain_level, timestamp. Return `{ok: true, recorded: true}` **immediately**, then fire `attest_rep` on a background task (do not block the response). When the tx_hash returns, emit an `attest` SSE event.

**`attest_rep` (internal, async):** Look up `patient_id` from the session. Compute the hash (`sha256(session_id + ":" + patient_id + ":" + rep_number + ":" + quality_score + ":" + form_state)` — **5 fields, must match C**), POST to C's `POST /near/attest_rep`. Store returned `tx_hash` in `attestations_db` keyed by session_id. Never called by A or Gemini; triggered by `log_rep`. Fire-and-forget so NEAR latency never stalls the live loop.

**`flag_for_pt`:** Write to Insforge collection `flags`. Fields: session_id, type, rep_number, pain_level, notes, timestamp. **Emit a `flag` SSE event on `/pt/stream`** so the PT dashboard lights up live (this is the demo's hero moment). Return `{ok: true, flag_id}`.

**`session/create`:** Body `{patient_name, program, exercise}`. **Resolve `patient_name` → stable `patient_id`** (reuse if the name exists in `patients_db`, else create). Create session in Insforge collection `sessions`. Map `exercise/program → prescribed_reps`. Return `{session_id, patient_id, exercise, prescribed_reps}`.

**`patients`:** Return all patients from `patients_db` with name, patient_id, and latest compliance_score. Powers the PT dashboard sidebar.

**`pt/stream`:** SSE endpoint. Hold open connections; push `flag` and `attest` events as they occur. Simplest impl: an in-memory list of subscriber queues; `flag_for_pt` and the attest callback push to each.

**`session/{id}`:** Fetch session + all its reps + flags + attestations from Insforge. Aggregate into one response.

**`patient/{id}/history`:** Fetch all sessions for patient. Calculate compliance_score from NEAR contract's `verify_session` per session. Determine trend (improving/declining/stable) from last 3 sessions.

---

## Mock Fallback (use this first)

Every endpoint has an in-memory fallback. When `INSFORGE_API_KEY` is not set, data stays in Python dicts. When `NEAR_ENDPOINT` is not set, return mock tx_hashes (`mock_tx_{hash[:16]}`).

This means Computer A can integrate against you from minute 0 without any real services.

---

## Integration Tests

| # | Test | What to Check |
|---|------|---------------|
| M1.1 | `curl -X POST http://localhost:8000/tool/log_rep -H 'Content-Type: application/json' -d '{"session_id":"test","rep_number":1,"form_state":"GREEN","quality_score":90,"coaching_cue":"Good","pain_level":0}'` | Returns `{"ok":true,"recorded":true}` |
| M1.2 | `curl -X POST http://localhost:8000/session/create -H 'Content-Type: application/json' -d '{"patient_name":"Demo Patient","program":"knee_rehab","exercise":"squat"}'` | Returns `{"session_id":"...","patient_id":"...","prescribed_reps":10}` |
| M1.3 | Real Insforge round-trip: write one record, read it back | Confirms Insforge API shape + auth work (derisk the prize dependency in hour 1) |
| M2.1 | After logging 3 reps (M1.1 x3), `curl http://localhost:8000/tool/session/test` | Returns object with `reps` array of length 3, each containing `{rep_number, form_state, quality_score}` |
| M2.2 | `curl http://localhost:8000/tool/patient/demo/history` | Returns `sessions` array with session containing 3 reps |
| M3.1 | `POST /tool/log_rep` (M1.1), wait ~2s, then `curl http://localhost:8000/tool/session/test` | `attestations` array populated — B computed the 5-field hash and called C automatically. A never calls attest. |
| M3.2 | Open `curl -N http://localhost:8000/pt/stream` in one terminal, then `POST /tool/flag_for_pt` in another | The stream emits a `flag` event in real time |
| M5.1 | After C deploys real NEAR, `POST /tool/attest_rep` | Returns real tx_hash from NEAR testnet (try format `9k3...` or `BH...` or `4...`). Ask C what format to expect. |
| M7.1 | Kill the server, restart it. `GET /tool/session/test` with a session_id created in previous run | If INSFORGE_API_KEY is set, data persists (returns data). If not set, in-memory data is lost (expected). |
| M8.1 | Log 10 reps with mix of GREEN/YELLOW, then `GET /tool/session/{id}` | Returns `session_status: COMPLETE`, flags if any RED reps, attestations for all 10 reps |
| M8.2 | `GET /tool/patient/demo/history` | Returns `compliance_score` (0-100) based on NEAR verify_session data, `trend` string |
| M10.1 | Set `INSFORGE_API_KEY` to invalid value, call any /tool/* endpoint | Returns mock response gracefully (no crash, no 500) |
| M10.2 | Set `NEAR_ENDPOINT` to unreachable URL, call `/tool/attest_rep` | Returns mock attestation gracefully |

---

## Milestones

| Time | Milestone | Check |
|------|-----------|-------|
| **M1 (0:00-0:30)** | All `/tool/*` endpoints return mock responses. No Insforge, no NEAR. `/session/create` returns session_id. `/tool/log_rep` returns `{ok:true}`. | Run M1.1, M1.2 with A watching. Show A the responses. |
| **M2 (0:30-1:00)** | In-memory store tracks reps per session. `GET /tool/session/{id}` returns aggregated reps. `GET /tool/patient/{id}/history` returns patient history. | Run M2.1, M2.2. Show A the session they created from M1. |
| **M3 (1:00-1:30)** | `log_rep` auto-fires attest to C's mock on a background task (does NOT block). Stores tx_hash; emits `attest` + `flag` SSE on `/pt/stream`. Session response includes attestations. | Run M3.1, M3.2. Confirm 5-field hash matches C. Show A tx_hash appearing without A calling attest. |
| **M4 (1:30-2:00)** | All endpoints hardened. Error handling for missing session_id, invalid data. PT Dashboard endpoints return clean aggregated data. | Walk through all endpoints with A watching. No 500 errors on any input. |
| **M5 (2:00-2:30)** | Switch `/tool/attest_rep` from C's mock to C's real NEAR testnet endpoint. Update tx_hash format handling. Verify real hashes returned. | Run M5.1. Verify tx_hash is real (ask C to check explorer). No changes to A. |
| **M6 (2:30-3:00)** | No B-specific milestone (A connects real Gemini Live). Tool endpoints continue working unchanged. | Monitor logs during A's first live session. Verify tool calls arriving correctly. |
| **M7 (3:00-3:30)** | Flip writes to real Insforge (API shape already validated in M1). Set INSFORGE_API_KEY. Data persists across restarts. | Run M7.1. Kill server, restart, data still there. Show C the persisted sessions. |
| **M8 (3:30-4:00)** | Hero path solid: `flag_for_pt` instantly emits an SSE `flag` event → A's PT dashboard lights up live. Full 10-rep lifecycle: logged, deduped, attested, flagged. PT Dashboard shows compliance score. | Run M8.1, M8.2 + the SSE escalation with A on two screens. |
| **M9 (4:00-4:30)** | PT Dashboard API polished. Compliance score calculation tuned. Trend detection working. | Show C the patient history view with compliance_score matching C's contract output. |
| **M10 (4:30-5:00)** | Fallback paths hardened. If Insforge is down → in-memory. If NEAR is down → mock. If any input is malformed → 400 with clear message. No 500s. | Run M10.1, M10.2. Kill Insforge. Kill NEAR. Everything degrades gracefully. |
| **M11 (5:00-5:30)** | Pre-load demo data. Seed in-memory store with 3 demo sessions for "Demo Patient" including flags, attestations, mixed form states. | Verify A's PT Dashboard shows rich demo data on first load. |
| **M12 (5:30-6:00)** | Buffer. Fix any integration issues. | Final walkthrough with A and C. |

---

## Hard Rules

- **In-memory first, but validate Insforge early.** Use dicts for the live path, but do one real Insforge write/read round-trip in M1 to confirm its API shape (Insforge is prize-gated — don't discover surprises at M7).
- **Async only where it pays:** `log_rep` must return instantly and attest in the background (FastAPI `BackgroundTasks` or a thread). `/pt/stream` is a streaming response. Everything else stays simple synchronous httpx.
- **No NEAR SDK.** Never import near-api-py or similar. All NEAR interaction is HTTP POST to Computer C's endpoint (mock or signing relay).
- **No OpenAI / Gemini SDK.** You don't call any AI model. You receive tool calls from A.
- **The live loop returns immediately.** `log_rep`/`flag_for_pt` never wait on NEAR. Attestation and SSE pushes happen off the response path.
- **Every endpoint has a fallback.** If downstream (NEAR/Insforge) is down, return mock data and keep going. Never return 500. If NEAR is down, store a `mock_...` tx_hash so A shows "Pending verification".

### Data Structures (in-memory)

```python
sessions_db: dict[str, dict] = {}     # session_id → session
reps_db: dict[str, dict] = {}         # session_id → { rep_number: rep_dict }  (dedup!)
flags_db: dict[str, list] = {}        # session_id → list of flag dicts
attestations_db: dict[str, list] = {} # session_id → list of attestation dicts
patients_db: dict[str, dict] = {}     # patient_id → { name, patient_id, sessions: [...] }
name_to_id: dict[str, str] = {}       # patient_name → patient_id (stable mapping)
pt_subscribers: list = []             # open SSE queues for /pt/stream
```

> `reps_db` is keyed by `rep_number` (not a list) so a repeated rep from Gemini overwrites
> instead of duplicating. `GET /tool/session` returns `list(reps_db[sid].values())`.
