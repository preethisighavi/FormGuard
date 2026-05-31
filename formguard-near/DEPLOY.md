# FormGuard NEAR — Deploy Guide

## Phase 1 — Mock server (start here, works in 5 min)

```bash
cd mock-near
python3 -m venv venv && source venv/bin/activate
pip install flask
python server.py          # → http://localhost:5001
```

Tell Computer B: `NEAR_ENDPOINT=http://localhost:5001/near`

Smoke test:
```bash
curl -X POST http://localhost:5001/near/attest_rep \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"test","rep_number":1,"session_hash":"0xabc","quality_score":90,"form_state":"GREEN"}'

curl -X POST http://localhost:5001/near/verify_session \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"test"}'
```

---

## Phase 2 — Smart contract (build in parallel with mock)

```bash
# Install Rust + NEAR toolchain (skip if already installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown
cargo install near-cli-rs

cd contracts/formguard
cargo build --target wasm32-unknown-unknown --release
cargo test     # all 4 tests should pass
```

---

## Phase 3 — Deploy to testnet & switch relay

```bash
# Create account (one time)
near create-account formguard-testnet.testnet --useFaucet

# Deploy contract
near deploy formguard-testnet.testnet \
  target/wasm32-unknown-unknown/release/formguard.wasm

# Init contract
near call formguard-testnet.testnet new '{}' \
  --accountId formguard-testnet.testnet

# Start signing relay (replaces mock server, same port)
cd relay
pip install flask near-api-py
# Edit .env with your NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY
source .env && python server.py
```

Tell Computer B: `NEAR_ENDPOINT=http://localhost:5001/near` (no change needed!)

---

## Hash format (share with Computer B)

```
SHA256("{session_id}:{patient_id}:{rep_number}:{quality_score}:{form_state}")
```
Result: lowercase hex string, 64 chars.

tx_hash returned by real relay: base58 string (e.g. `9kR3...` or `BH7x...`)
Explorer: `https://explorer.testnet.near.org/transactions/{tx_hash}`
