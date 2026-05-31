# FormGuard — API Contract (Single Source of Truth)

> **This file is normative.** If a shape here disagrees with anything in `SPEC_FORMGUARD_v2.md`,
> `COMPUTER_A_FRONTEND.md`, `COMPUTER_B_BACKEND.md`, or `COMPUTER_C_NEAR.md`, **this file wins.**
> The computer plans describe *behavior*; this file defines *shapes*. Edit shapes here only,
> and announce the change to all three builders.
>
> **Owners:** A consumes B's `/tool/*` + `/session/*` + `/pt/stream`. B owns those and consumes
> C's `/near/*`. C owns `/near/*`. Nobody else may change a shape they don't own.

---

## 0. Conventions

- **Transport:** JSON over HTTP. `Content-Type: application/json` on every request with a body.
- **Base URLs:** B at `http://B_LOCAL:8000`. C at `http://C_LOCAL:5001`.
- **Enums:**
  - `form_state` ∈ `"GREEN" | "YELLOW" | "RED"` (uppercase, exact).
  - `program` ∈ `"knee_rehab" | "hip_rehab" | "back_rehab"`.
  - `flag.type` ∈ `"pain_spike" | "form_breakdown" | "patient_request"`.
  - `trend` ∈ `"improving" | "stable" | "declining"`.
- **Numeric ranges:** `quality_score` int `0–100`. `pain_level` int `0–10`. `rep_number` int `≥ 1`.
  `green_pct` / `compliance_score` / `overall_compliance` int `0–100`.
- **IDs:** `session_id`, `patient_id`, `flag_id` are opaque strings. `patient_id` is stable per
  patient name (B maps `patient_name → patient_id`, reusing if the name exists).
- **Compliance rule (one definition, everywhere):** `compliant == (green_pct >= 80)`.
- **`prescribed_reps`:** B maps from `(program, exercise)`. Default `10` if unknown.
- **Error rule (resolves the 400-vs-fallback tension):**
  - **Schema-invalid request** (missing/wrong-typed required field) → **`400`** with
    `{ "error": "<human message>" }`. This is the *only* non-2xx the live path returns.
  - **Downstream down** (NEAR/Insforge unreachable) → **`200` with a mock/degraded response**,
    never a 5xx. See per-endpoint "fallback" notes.
- **Timestamps:** unix seconds (int) unless noted.

---

## 1. A → B  (frontend → backend)

Gemini Live is given exactly **two** tools: `log_rep` and `flag_for_pt`. It never calls attest.

### `POST /session/create`
```jsonc
// request
{ "patient_name": "Jane Doe", "program": "knee_rehab", "exercise": "squat" }
// response 200
{ "session_id": "abc123", "patient_id": "pat_7f3", "exercise": "squat", "prescribed_reps": 10 }
```
A stores **both** `session_id` and `patient_id`.

### `POST /tool/log_rep`   (called by Gemini Live every rep)
```jsonc
// request
{
  "session_id": "abc123",
  "rep_number": 4,
  "form_state": "YELLOW",
  "quality_score": 62,
  "coaching_cue": "Push knees outward",
  "pain_level": 2
}
// response 200 — returns IMMEDIATELY
{ "ok": true, "recorded": true }
```
Side effects (off the response path): B dedups by `(session_id, rep_number)`, then fires
`attest_rep` to C asynchronously and emits an `attest` SSE event when the tx_hash lands.

### `POST /tool/flag_for_pt`   (called by Gemini Live on pain/safety)
```jsonc
// request
{ "session_id": "abc123", "type": "pain_spike", "rep_number": 4,
  "pain_level": 7, "notes": "patient said knee hurts" }
// response 200
{ "ok": true, "flag_id": "flag_xxx" }
```
Side effect: emits a `flag` SSE event on `/pt/stream` (the hero moment).

### `GET /tool/session/{session_id}`
```jsonc
// response 200
{
  "session": { "session_id": "abc123", "patient_id": "pat_7f3", "exercise": "squat",
               "prescribed_reps": 10, "status": "IN_PROGRESS" },   // status: IN_PROGRESS | COMPLETE
  "reps":  [ { "rep_number": 4, "form_state": "YELLOW", "quality_score": 62,
               "coaching_cue": "Push knees outward", "pain_level": 2, "timestamp": 1730000000 } ],
  "flags": [ { "flag_id": "flag_xxx", "type": "pain_spike", "rep_number": 4,
               "pain_level": 7, "notes": "", "timestamp": 1730000000 } ],
  "attestations": [ /* Attestation objects — see §3 */ ]
}
```
`attestations` fills in asynchronously; a rep may exist before its attestation lands.

### `GET /tool/patients`
```jsonc
// response 200
{ "patients": [ { "patient_id": "pat_7f3", "name": "Jane Doe",
                  "compliance_score": 88, "last_session": "abc123" } ] }
```

### `GET /tool/patient/{patient_id}/history`
```jsonc
// response 200
{ "sessions": [ { "session_id": "abc123", "exercise": "squat", "status": "COMPLETE",
                  "compliance_score": 88, "timestamp": 1730000000 } ],
  "compliance_score": 88, "trend": "improving" }
```

### `GET /pt/stream`   (Server-Sent Events, `text/event-stream`)
```
event: flag
data: { "flag_id": "flag_xxx", "patient_id": "pat_7f3", "session_id": "abc123",
        "type": "pain_spike", "rep_number": 4, "pain_level": 7 }

event: attest
data: { "session_id": "abc123", "rep_number": 4, "tx_hash": "9k3..." }
```
A subscribes with `EventSource`. `flag` lights up the PT dashboard live; `attest` updates badges.

---

## 2. B → C  (backend → NEAR mock/relay)

Same shape in mock mode and real signing-relay mode. B calls these **asynchronously**.

### `POST /near/attest_rep`
```jsonc
// request — B computes session_hash (see §4)
{ "session_id": "abc123", "rep_number": 4, "session_hash": "0x...",
  "quality_score": 62, "form_state": "YELLOW" }
// response 200
{ "tx_hash": "9k3...", "block_height": 12345, "status": "confirmed" }
```
Idempotent on `(session_id, rep_number)` — B may re-send a rep.

### `POST /near/verify_session`
```jsonc
// request
{ "session_id": "abc123" }
// response 200
{ "total_reps": 10, "green_pct": 90, "compliant": true,   // compliant ⇔ green_pct >= 80
  "attestations": [ /* Attestation objects — see §3 */ ],
  "tx_hashes": [ "9k3...", "4ab..." ] }
```

**Real mode is a signing relay, not raw RPC.** It signs+submits with a funded testnet key and
**serializes submissions through one queue** (nonce safety). `tx_hash` is a **base58** string.
Explorer template: `https://explorer.testnet.near.org/transactions/{tx_hash}`.

---

## 3. Shared object: `Attestation`

Returned inside `GET /tool/session` (`attestations`) and C's `verify_session` (`attestations`).
```jsonc
{ "session_id": "abc123", "rep_number": 4, "session_hash": "0x...",
  "quality_score": 62, "form_state": "YELLOW",
  "tx_hash": "9k3...", "block_height": 12345, "status": "confirmed", "timestamp": 1730000000 }
```
In mock/degraded mode `tx_hash` is `"mock_<sha16>"` → A shows a **"Pending verification"** badge
(no dead explorer link).

---

## 4. Hash formula (frozen — B computes, C stores, A never sees)

```
session_hash = SHA256("{session_id}:{patient_id}:{rep_number}:{quality_score}:{form_state}")
```
**5 fields, this order, colon-separated.** Hex string. A does not compute or send a hash.

---

## 5. Mock ↔ real swap rule

Every endpoint above has the **same shape** in mock and real mode. Switching C's mock → signing
relay, or B's in-memory → Insforge, changes **no shapes** and requires **no code change in any
other computer**. Only `tx_hash` *content* changes (mock_ prefix → real base58).
