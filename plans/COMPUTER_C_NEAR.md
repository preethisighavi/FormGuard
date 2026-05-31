# Computer C — NEAR Smart Contract + Mock Server

**Role:** Blockchain attestation layer. Provides an HTTP endpoint that Computer B calls for per-rep attestation. Can be real NEAR testnet or a mock server that returns the same JSON shapes.

**Depends on:** Nothing. You are the dependency for B.

**Tech:** Rust (NEAR SDK) for the smart contract. Python/Flask or Node/Express for the mock server (pick whatever you're fastest in).

> **The HTTP shapes B calls (`/near/attest_rep`, `/near/verify_session`) are normative in
> [`API_CONTRACT.md`](./API_CONTRACT.md) §2–§4.** Your mock AND your real signing relay must
> match them exactly — `tx_hash`/`block_height`/`status`, the `Attestation` object (§3), the
> 5-field hash (§4), and `compliant ⇔ green_pct >= 80`. The Rust structs below are *internal*;
> what matters to B is the JSON serialization matching the contract. When they differ, the
> contract wins.

---

## Quick Start

```bash
# Mock server (start here — working in 5 min)
mkdir mock-near && cd mock-near
python -m venv venv && source venv/bin/activate
pip install flask
python server.py   # → http://localhost:5001

# Smart contract (build in parallel)
cargo install near-cli-rs
near create-account formguard-testnet.testnet --useFaucet
```

---

## What to Build

### Mock HTTP Server (`mock-near/server.py`)

Two endpoints. Simple, fast, no DB.

```
POST /near/attest_rep
Body: { session_id, rep_number, session_hash, quality_score, form_state }
→ { tx_hash: "mock_<sha16>", block_height: 12345, status: "confirmed" }

POST /near/verify_session  
Body: { session_id }
→ { total_reps: N, green_pct: 0-100, compliant: bool,
    attestations: [...], tx_hashes: [...] }
```

The mock stores attestations in-memory keyed by session_id. `verify_session` reads them and calculates stats. That's it.

### NEAR Smart Contract (`contracts/formguard/`)

A NEAR contract with these public methods:

```rust
// Record a single rep attestation
pub fn attest_rep(
  &mut self,
  session_id: String,
  rep_number: u32,
  session_hash: String,     // sha256 of session+patient+rep+quality
  quality_score: u8,        // 0-100
  form_state: String        // GREEN | YELLOW | RED
) -> NearRepAttestation;

// Verify a full session — returns compliance report
pub fn verify_session(
  &self,
  session_id: String
) -> SessionComplianceReport;

// Get aggregated stats for a patient (called by PT dashboard)
pub fn get_patient_stats(
  &self,
  patient_id: String
) -> PatientStats;
```

Data structures:

```rust
#[near(serializers=[json])]
pub struct NearRepAttestation {
  pub tx_hash: String,
  pub session_id: String,
  pub rep_number: u32,
  pub session_hash: String,
  pub quality_score: u8,
  pub form_state: String,
  pub timestamp: u64,
}

#[near(serializers=[json])]
pub struct SessionComplianceReport {
  pub session_id: String,
  pub total_reps: u32,
  pub green_count: u32,
  pub yellow_count: u32,
  pub red_count: u32,
  pub green_pct: u8,             // green / total * 100
  pub compliant: bool,           // true if green_pct >= 80
  pub attestations: Vec<NearRepAttestation>,
}

#[near(serializers=[json])]
pub struct PatientStats {
  pub patient_id: String,
  pub total_sessions: u32,
  pub total_reps: u32,
  pub overall_compliance: u8,    // average compliance across sessions
  pub recent_trend: String,      // "improving" | "stable" | "declining"
}
```

### Hashing Schema (must match what B sends)

The session_hash is computed as:
```
SHA256("{session_id}:{patient_id}:{rep_number}:{quality_score}:{form_state}")
```

B computes this before calling attest_rep (**5 fields — matches B and the master spec**). C stores it. verify_session returns it. This lets anyone independently verify: "does the hash on NEAR match the data in Insforge?"

### Real-Mode Signing Relay (the part that's easy to miss)

In **real** mode, B still does a plain HTTP POST to `/near/attest_rep` — B has no NEAR SDK. So your "real" server is **not** the raw RPC; it's a thin signing relay that:

1. Receives B's JSON (same shape as the mock).
2. Signs an `attest_rep` transaction with a **funded testnet access key** and submits it.
3. Returns the **real** `tx_hash` + `block_height` in the mock's exact response shape.

**Critical: serialize submissions.** B fires per-rep attestations rapidly and asynchronously. Concurrent signs with one access key cause **nonce collisions**. Put all submissions through a single in-process queue (one worker, one key), or pre-provision N access keys. NEAR testnet blocks are ~1–1.5s; 10 serialized reps over a 60–90s exercise is comfortable.

**Idempotency:** B dedups reps by `(session_id, rep_number)`, so expect possible repeats. Make `attest_rep` idempotent on that pair (upsert) so a re-sent rep doesn't double-count in `verify_session`.

**Tell B the tx_hash format explicitly** (base58 string). And give B a stable explorer URL template, e.g. `https://explorer.testnet.near.org/transactions/{tx_hash}`, so A's badge links resolve.

---

## Integration Tests

| # | Test | What to Check |
|---|------|---------------|
| M1.1 | `curl -X POST http://localhost:5001/near/attest_rep -H 'Content-Type: application/json' -d '{"session_id":"test","rep_number":1,"session_hash":"0xabc","quality_score":90,"form_state":"GREEN"}'` | Returns `{"tx_hash":"...","status":"confirmed"}` |
| M1.2 | After calling M1.1 3 times with different rep_numbers, `curl -X POST http://localhost:5001/near/verify_session -H 'Content-Type: application/json' -d '{"session_id":"test"}'` | Returns `{"total_reps":3, "green_pct":33, "compliant":false, "attestations":[...]}` |
| M3.1 | B calls your mock. You log the request body they send. | session_hash format matches: sha256 hex string. Confirm with B the exact string format. |
| M5.1 | `near contract call-function as-transaction formguard-testnet.testnet attest_rep json-args '{"session_id":"test","rep_number":1,"session_hash":"0xabc","quality_score":90,"form_state":"GREEN"}' prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR'` | Returns real NEAR transaction result with real tx_hash |
| M5.2 | `near contract call-function as-read-only formguard-testnet.testnet verify_session json-args '{"session_id":"test"}'` | Returns compliance report matching what mock returned, but with real NEAR tx_hashes |
| M5.3 | After C switches from mock to real, B calls `POST /tool/attest_rep` → B calls C's real endpoint | Returns real tx_hash. Check B can parse it. Coordinate format: is it a base58 string? A hex string? A JSON object? Tell B exactly what to expect. |
| M8.1 | Attest 10 reps for one session via contract directly. Call verify_session. | Returns total_reps=10, correct green/yellow/red counts. |
| M8.2 | Deploy contract to NEAR testnet. Attest 10 reps. Call verify_session with a browser or curl. | Data persists across calls (contract state is durable). Show B and A the real explorer link. |
| M10.1 | Kill mock server. B's `/tool/attest_rep` | B falls back gracefully (no crash). This is expected — you're down. |

---

## Milestones

| Time | Milestone | Check |
|------|-----------|-------|
| **M1 (0:00-0:30)** | Mock server running on port 5001. `POST /near/attest_rep` returns `{tx_hash: "mock_..."}`. `POST /near/verify_session` aggregates in-memory data. | Run M1.1, M1.2. Tell B the endpoint URL and show them the response format. |
| **M2 (0:30-1:00)** | NEAR contract scaffolded. `cargo build` passes. `attest_rep` and `verify_session` functions compile. Unit tests pass locally with `cargo test`. | Show B the contract code. No need for testnet yet. |
| **M3 (1:00-1:30)** | B calls your mock. Verify the session_hash format matches what your contract expects. Fix any mismatch now before real NEAR deployment. | Run M3.1. Compare B's hash format with your contract's expectation. Adjust if needed. This is the critical alignment point. |
| **M4 (1:30-2:00)** | `get_patient_stats` function compiles and tested. Contract logic for compliance threshold (80% GREEN = compliant) finalized. | Review compliance logic with B and A. The 80% threshold affects what A's PT Dashboard shows. |
| **M5 (2:00-2:30)** | Deploy contract to NEAR testnet. **Stand up the signing relay** (HTTP server with funded key + serialized submission queue) at the same `/near/*` path B already calls. Real tx_hashes returned. | Run M5.1, M5.2. Tell B the relay URL, base58 tx_hash format, and explorer URL template. Watch B run M5.3. |
| **M6 (2:30-3:00)** | No C-specific milestone. Help A or B if they need NEAR tx_hash format details. | Be available for questions. Your mock is still running for integration testing. |
| **M7 (3:00-3:30)** | No C-specific milestone. Contract deployed and stable. | Monitor testnet for issues if B is making high-volume attestation calls. |
| **M8 (3:30-4:00)** | Full session lifecycle on real NEAR. 10-rep session attested. verify_session returns accurate compliance report. Explorer links working. | Run M8.1, M8.2. Show A and B the NEAR explorer page with all 10 attestations visible. |
| **M9 (4:00-4:30)** | Patient stats endpoint works with real data. Multiple sessions aggregated correctly. | Ensure B's PT Dashboard can call `get_patient_stats` and get accurate compliance data. |
| **M10 (4:30-5:00)** | Contract handles edge cases: duplicate attestation (idempotent?), missing session (returns empty), invalid data (graceful). | Test edge cases. Ask B what happens when NEAR is unreachable (their fallback works — confirm it doesn't spam your endpoint on retry). |
| **M11 (5:00-5:30)** | No C-specific milestone. Help demo prep. | Everyone practices the demo flow together. |
| **M12 (5:30-6:00)** | Buffer. Fix any issues. | Final check: real contract still returning data? Mock still available as fallback? |

---

## Hard Rules

- **Mock server first.** Do NOT touch the NEAR contract until the mock works. B needs your endpoint in the first 30 minutes.
- **Mock and real must return the same JSON shape.** B should not need code changes when you switch from mock to real.
- **No Insforge.** You never talk to Insforge. You receive hashes from B, store them, return them.
- **No PHI on-chain.** Your contract stores session_id (an opaque ID), rep_number, hash, quality_score, form_state, timestamp. Nothing that identifies a person.
- **The mock server is your integration test.** When B's tests pass against your mock, they'll pass against your real contract (same response format).

### Mock Server Template (start here)

```python
from flask import Flask, request, jsonify
import hashlib, time

app = Flask(__name__)
store: dict[str, list] = {}  # session_id → list of attestations

@app.post('/near/attest_rep')
def attest_rep():
    data = request.get_json()
    session_id = data['session_id']
    tx_hash = f"mock_{hashlib.sha256(str(data).encode()).hexdigest()[:16]}"
    attestation = {**data, 'tx_hash': tx_hash, 'block_height': 12345 + len(store.get(session_id, [])), 'timestamp': int(time.time()), 'status': 'confirmed'}
    # Idempotent upsert by rep_number — B may re-send a rep (it dedups too).
    reps = store.setdefault(session_id, [])
    reps[:] = [r for r in reps if r.get('rep_number') != data.get('rep_number')]
    reps.append(attestation)
    return jsonify({'tx_hash': tx_hash, 'block_height': attestation['block_height'], 'status': 'confirmed'})

@app.post('/near/verify_session')
def verify_session():
    data = request.get_json()
    reps = store.get(data['session_id'], [])
    total = len(reps)
    green = sum(1 for r in reps if r.get('form_state') == 'GREEN')
    green_pct = int((green / total * 100)) if total > 0 else 0
    return jsonify({'total_reps': total, 'green_pct': green_pct, 'compliant': green_pct >= 80, 'attestations': reps, 'tx_hashes': [r['tx_hash'] for r in reps]})

app.run(port=5001)
```
