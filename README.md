# FormGuard

> *"Your physical therapist is always watching."*

**FormGuard** is a real-time AI physical therapy compliance platform. A patient performs home PT exercises on any device with a camera. FormGuard watches their form live, delivers instant voice coaching through Google Gemini Live, and writes tamper-proof attestations to the NEAR blockchain after every rep — giving physical therapists verifiable evidence of what their patients actually did at home.

Built at the **Applied Intelligence Hackathon · May 31, 2026**.

---

## The Problem

Home PT compliance sits at **30–50%**. Patients perform exercises incorrectly without immediate feedback, bad form gets ingrained, recovery stalls, and re-injury risk climbs. Physical therapists cannot monitor 50+ patients doing home exercises. Insurers cannot verify documented adherence.

## The Solution

FormGuard closes the loop in three ways:

| Problem | FormGuard Answer |
|---|---|
| No real-time feedback | Gemini Live watches the camera and speaks coaching cues — *"push your knee outward"* — while the patient is moving |
| No accountability | Every rep is logged with form state, quality score, and pain level |
| No verifiable proof | A SHA-256 hash of each rep is submitted to the NEAR blockchain, producing an immutable tx_hash — no PHI on-chain |

---

## Architecture — Three Computers

```
┌─ Computer A ─── Browser ──────────────────────────────────────┐
│  Camera + Mic → Gemini Live WebSocket (audio + video frames)   │
│  Tool Router → HTTP POST to Computer B on every rep            │
│  Patient UI: state ring, pain slider, rep counter, agent log   │
│  PT Dashboard: patient list, session history, compliance score  │
└──────────────────────┬────────────────────────────────────────┘
                       │ POST /session/create
                       │ POST /tool/log_rep
                       │ POST /tool/flag_for_pt
                       │ GET  /tool/session/{id}
                       │ GET  /pt/stream  (SSE)
                       ▼
┌─ Computer B ─── FastAPI Backend ──────────────────────────────┐
│  Tool execution layer — receives Gemini's tool calls           │
│  Insforge Client → structured session + patient data           │
│  NEAR Client → fires async attestation to Computer C          │
│  /pt/stream SSE → pushes flag + attest events to PT dashboard  │
└──────────────────────┬────────────────────────────────────────┘
                       │ POST /near/attest_rep  (async)
                       │ POST /near/verify_session
                       ▼
┌─ Computer C ─── NEAR Smart Contract + Relay ──────────────────┐
│  Rust contract: attest_rep(), verify_session(), stats()        │
│  Mock server (Flask) — identical shapes, no real NEAR needed   │
│  Signing relay — serializes submissions, prevents nonce races  │
└───────────────────────────────────────────────────────────────┘
```

**Key design rule:** Gemini Live gets exactly **two tools** — `log_rep` and `flag_for_pt`. Attestation is internal to Computer B. The live coaching loop returns instantly; all slow work (NEAR, Insforge, SSE push) runs async off the response path.

---

## Sponsors & Platform Partners

FormGuard is built on top of — and made possible by — three platform sponsors whose infrastructure forms the backbone of the system.

---

### 🟣 NEAR AI — Blockchain Attestation Layer

**What NEAR provides:** Every rep logged in a FormGuard session is hashed and submitted to the NEAR blockchain via Computer C. This produces a `tx_hash` and `block_height` that prove the session happened, when it happened, and exactly what the data said — without storing any PHI on-chain.

**How it powers FormGuard:**

- **`attest_rep`** — called after every `log_rep`. Computer B computes a SHA-256 hash of `session_id:patient_id:rep_number:quality_score:form_state` and submits it to Computer C's signing relay, which serializes all submissions through a single queue to prevent nonce collisions.
- **`verify_session`** — returns `green_pct`, `compliant` flag, and all `tx_hashes` for a session. Compliance rule: `compliant ⇔ green_pct >= 80`.
- **`get_patient_stats`** — aggregates compliance trend across all sessions for a patient.

**Mock ↔ real swap:** Computer C's mock server (`formguard-near/mock-near/server.py`) returns identical JSON shapes to the real signing relay (`formguard-near/relay/server.py`). Switching between them requires zero code changes in Computer B or A — only the `NEAR_ENDPOINT` env var changes.

**Testnet setup:**
```
NEAR_ACCOUNT_ID=yourname.testnet
NEAR_PRIVATE_KEY=ed25519:...
NEAR_CONTRACT_ID=yourname.testnet
NEAR_NETWORK=testnet
```

Get a free testnet account at [testnet.mynearwallet.com](https://testnet.mynearwallet.com) and free test tokens at [near-faucet.io](https://near-faucet.io).

---

### 🔵 Insforge — Structured Data Persistence Layer

**What Insforge provides:** Every session record, rep, flag, and patient history object written by Computer B is persisted to Insforge's document store. This gives physical therapists a durable, queryable history that survives pod restarts and scales across patients.

**How it powers FormGuard:**

| Write | What Gets Stored |
|---|---|
| `POST /session/create` | Full session object (patient, exercise, prescribed reps, status) |
| `POST /tool/log_rep` | Rep object (form state, quality score, coaching cue, pain level, timestamp) |
| `POST /tool/flag_for_pt` | Flag object (type, rep, pain level, notes, timestamp) |

**Graceful degradation:** `formguard-backend/insforge_client.py` falls back to `{"ok": true, "mock": true}` when `INSFORGE_API_KEY` is not set. All data stays in memory and the demo runs identically — judges see no difference.

**Setup:**
```
INSFORGE_API_URL=https://api.insforge.dev
INSFORGE_API_KEY=<your key from insforge.dev>
```

---

### 🟠 Opsera — DevOps Orchestration & CI/CD

**What Opsera provides:** Opsera is the **DevOps brain** of FormGuard — it orchestrates all pipelines, environments, secrets, compliance gates, and operational health without touching a single line of application code. Computer A, B, and C have zero awareness Opsera exists.

**How it powers FormGuard:**

| Capability | FormGuard Use |
|---|---|
| **Declarative Pipelines** | Build, lint, and test all three computers in parallel on every push and PR |
| **Integration Smoke Tests** | Full A→B→C chain validated in CI — session create → log_rep → NEAR attest → verify |
| **Insforge API Validation** | Every build round-trips Insforge to confirm the data layer is reachable before deploy |
| **AppSec Agents** | Security scans on every PR — secrets, CVEs, IaC misconfigs — `fail_on: critical` |
| **Compliance Policies** | `mock-gate` blocks production deploys if `VITE_USE_MOCK=true` or `INSFORGE_API_KEY` is blank |
| **Shape Drift Detection** | Health probe compares live API responses against `API_CONTRACT.md` every 15 minutes |
| **Hummingbird AI** | When a pipeline step fails, Hummingbird AI suggests the fix directly in the PR comment |
| **Secrets Management** | `INSFORGE_API_KEY`, `NEAR_PRIVATE_KEY`, `VITE_GEMINI_API_KEY` encrypted at rest, injected at deploy time |
| **Environment Governance** | dev → staging → prod promotion gated by approval workflows and passing policies |
| **DORA Metrics** | Deployment frequency, lead time, MTTR, change failure rate across all three computers |

**Pipelines configured:**

```
opsera/pipelines/
├── build-test.yaml          # Triggered on every push — parallel build + integration smoke test
├── deploy-staging.yaml      # Triggered on merge to main
├── deploy-production.yaml   # Triggered on release tag — requires approval gate
└── health-probe.yaml        # Cron every 15 min — verifies B, C, Insforge, NEAR all healthy
```

**Opsera CI Agent (`opsera/agents/formguard-ci-agent.yaml`):** An autonomous Hummingbird AI agent that monitors pipelines, diagnoses failures, posts remediation steps as PR comments or Slack messages in `#formguard-ops`, and can initiate rollbacks — without modifying application source code.

**Setup:**
```
OPSERA_ORG_NAME=<your org slug from app.opsera.io>
OPSERA_PIPELINE_TOKEN=<API token from Settings → Security>
```

---

## Repository Structure

```
FormGuard/
├── formguard-backend/          # Computer B — FastAPI
│   ├── main.py                 # App entry point, middleware, router wiring
│   ├── models.py               # Pydantic request/response models
│   ├── insforge_client.py      # Insforge HTTP client (graceful mock fallback)
│   ├── near_client.py          # NEAR relay HTTP client (graceful mock fallback)
│   ├── pt_stream.py            # Server-Sent Events for PT dashboard
│   └── tools/
│       ├── session.py          # /session/create, /tool/session/*, /tool/patients, /tool/patient/*/history
│       ├── log_rep.py          # POST /tool/log_rep — fires async NEAR attestation
│       ├── flag_for_pt.py      # POST /tool/flag_for_pt — fires SSE flag event
│       └── attest_rep.py       # SHA-256 hash + NEAR attestation logic
├── formguard-near/             # Computer C — NEAR
│   ├── mock-near/server.py     # Flask mock — identical shapes, no real NEAR needed
│   └── relay/server.py         # Real signing relay — serialized queue, testnet
├── opsera/                     # Computer D — DevOps orchestration
│   ├── pipelines/              # CI/CD pipeline YAML definitions
│   ├── environments/           # Per-env variable configs (dev/staging/prod)
│   ├── policies/               # Compliance gates (mock-gate, shape-drift, data-persistence)
│   ├── tools/                  # Opsera tool registry entries (Insforge, NEAR relay)
│   ├── agents/                 # Hummingbird AI coding agent config
│   └── .env.placeholder        # All required secrets documented (never commit real values)
├── plans/                      # Architecture documents
│   ├── API_CONTRACT.md         # Single source of truth for all API shapes
│   ├── SPEC_FORMGUARD_v2.md    # Three-computer build spec
│   └── COMPUTER_D_OPSERA.md    # Opsera integration plan
├── tests/
│   ├── test_backend.py         # 39 unit tests — all modules, mocked externals
│   └── test_e2e.py             # 30 E2E tests — full A→B→C chain, live services
└── V1/                         # Original v1 project summary and skill specs
```

---

## Quick Start

### 1. Clone and install

```bash
git clone <repo-url>
cd FormGuard/formguard-backend
pip install fastapi uvicorn httpx python-dotenv pydantic
```

### 2. Configure environment

```bash
# formguard-backend/.env
INSFORGE_API_KEY=          # optional — mock fallback if blank
NEAR_ENDPOINT=http://127.0.0.1:5001/near   # local mock NEAR
NEAR_ACCOUNT_ID=yourname.testnet           # for real NEAR only
NEAR_PRIVATE_KEY=xy12345:...               # for real NEAR only
NEAR_CONTRACT_ID=yourname.testnet
NEAR_NETWORK=testnet
```

All keys are optional for local development — every external dependency has a mock fallback built in.

### 3. Start Computer C — Mock NEAR

```bash
cd formguard-near/mock-near
pip install flask
python server.py        # listens on port 5001
```

### 4. Start Computer B — Backend

```bash
cd formguard-backend
NEAR_ENDPOINT=http://127.0.0.1:5001/near uvicorn main:app --port 8000 --reload
```

Backend is live at `http://localhost:8000`. API docs at `http://localhost:8000/docs`.

---

## Running Tests

### Unit Tests (no services needed)

```bash
cd formguard-backend
pytest ../tests/test_backend.py -v
# 39 tests — models, session CRUD, log_rep, flag_for_pt, attestation hash, insforge/near mock fallbacks
```

### End-to-End Tests (requires both services running)

```bash
# Start Computer C and Computer B first (see Quick Start above), then:
cd formguard-backend
pytest ../tests/test_e2e.py -v -s
# 30 tests — full A→B→C chain, SSE delivery, NEAR verification, compliance scoring
```

| E2E Suite | What it tests |
|---|---|
| E2E-01 Health | Both services reachable |
| E2E-02 Sessions | Create, get, 404, auto-COMPLETE |
| E2E-03 Log Rep + Attest | Full A→B→C — rep logged, attestation lands on NEAR, shape verified |
| E2E-04 Flag + SSE | Flag creation, storage, live SSE event delivery to PT dashboard |
| E2E-05 Patient History | Patient list, history, compliance trend calculation |
| E2E-06 NEAR Direct | Verify session on C, compliant rule, idempotency |
| E2E-07 Full Happy Path | Complete 10-rep session → 10 attestations → NEAR verify → patient history |

---

## API Reference

Full contract in [`plans/API_CONTRACT.md`](plans/API_CONTRACT.md). Summary:

| Endpoint | Method | Description |
|---|---|---|
| `/session/create` | POST | Create a new therapy session |
| `/tool/log_rep` | POST | Log a rep (Gemini's primary tool) |
| `/tool/flag_for_pt` | POST | Flag a safety issue (fires live SSE to PT) |
| `/tool/session/{id}` | GET | Get session with reps, flags, attestations |
| `/tool/patients` | GET | List all patients with compliance scores |
| `/tool/patient/{id}/history` | GET | Patient session history and trend |
| `/pt/stream` | GET | SSE stream — `flag` and `attest` events |
| `/health` | GET | Health check |

**NEAR endpoints (Computer C, port 5001):**

| Endpoint | Method | Description |
|---|---|---|
| `/near/attest_rep` | POST | Submit rep hash to blockchain |
| `/near/verify_session` | POST | Get compliance report for a session |
| `/near/get_patient_stats` | POST | Aggregate stats across sessions |

---

## Compliance & Hash Formula

The attestation hash is frozen across all three computers:

```
session_hash = SHA256("{session_id}:{patient_id}:{rep_number}:{quality_score}:{form_state}")
```

Five fields, this order, colon-separated. Hex string. Computer A never computes or sees the hash.

**Compliance rule (one definition, everywhere):** `compliant ⇔ green_pct >= 80`

---

## Environment Variables Reference

| Variable | Used By | Required | Description |
|---|---|---|---|
| `INSFORGE_API_KEY` | Computer B | No (mock fallback) | Insforge data persistence key |
| `INSFORGE_API_URL` | Computer B | No | Default: `https://api.insforge.dev` |
| `NEAR_ENDPOINT` | Computer B | No (mock fallback) | URL of Computer C |
| `NEAR_ACCOUNT_ID` | Computer C (relay) | Yes (real mode) | NEAR testnet account |
| `NEAR_PRIVATE_KEY` | Computer C (relay) | Yes (real mode) | `xy12345:...` funded key |
| `NEAR_CONTRACT_ID` | Computer C (relay) | Yes (real mode) | Usually same as account ID |
| `NEAR_NETWORK` | Computer C (relay) | No | Default: `testnet` |
| `VITE_GEMINI_API_KEY` | Computer A | Yes (real mode) | Google Gemini Live API key |
| `VITE_BACKEND_URL` | Computer A | No | Default: `http://localhost:8000` |
| `OPSERA_ORG_NAME` | Opsera pipelines | CI/CD only | Org slug from app.opsera.io |
| `OPSERA_PIPELINE_TOKEN` | Opsera pipelines | CI/CD only | API token from Opsera Settings |

Full placeholder with all variables: [`opsera/.env.placeholder`](opsera/.env.placeholder)

---

## Demo Flow (3 Minutes)

1. **Setup** — Select patient "Demo Patient", program "Knee Rehab", exercise "Squat"
2. **Live session** — Camera watches form. Gemini speaks coaching cues per rep. State ring cycles GREEN → YELLOW → RED. Pain slider triggers `flag_for_pt`.
3. **Hero moment** — Patient says "my knee hurts" → Gemini calls `flag_for_pt` → PT dashboard on a second screen lights up in real time via SSE.
4. **Summary** — 10 reps logged, NEAR badge shows `tx_hash` per rep, compliance score computed.
5. **PT review** — Dashboard shows session history, per-rep attestations, trend improving/stable/declining.

---

## Fallbacks (Demo-Safe)

| If this fails | FormGuard does |
|---|---|
| Gemini API quota | Mock cycle GREEN→YELLOW→RED, pre-recorded audio cues |
| Insforge down | All data stays in-memory, demo looks identical |
| NEAR testnet down | `mock_<sha16>` tx_hash, "Pending verification" badge in UI |
| Camera unavailable | `VITE_USE_MOCK=true` — auto-cycles form states |
| Entire backend crashes | Pre-loaded demo patient data visible in PT dashboard |

---

## Tech Stack

| Layer | Technology |
|---|---|
| AI Coaching | Google Gemini Live (WebSocket, audio + video) |
| Frontend | React + TypeScript |
| Backend | FastAPI (Python) |
| Data Persistence | **Insforge** |
| Blockchain Attestation | **NEAR** (testnet smart contract + signing relay) |
| CI/CD & DevOps | **Opsera** (pipelines, secrets, compliance gates, Hummingbird AI) |
| Voice | Web Speech API (browser-native) |
| Deployment | Docker + Render |

---

## License

MIT

---

*FormGuard · Applied Intelligence Hackathon · May 31, 2026*
