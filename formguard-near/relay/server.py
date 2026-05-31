"""
FormGuard NEAR Signing Relay — Computer C (real mode)
Sits at the same /near/* paths as the mock server.
B never changes its call — just point NEAR_ENDPOINT here.

Serializes all submissions through a single queue to avoid nonce collisions.

Requires:
  pip install flask near-api-py
  NEAR_ACCOUNT_ID=formguard-testnet.testnet
  NEAR_PRIVATE_KEY=ed25519:...
  NEAR_CONTRACT_ID=formguard-testnet.testnet
  NEAR_NETWORK=testnet   (default)
"""
import hashlib
import json
import os
import queue
import threading
import time

import near_api
from flask import Flask, request, jsonify

app = Flask(__name__)

# ── Config ───────────────────────────────────────────────────────────────────

ACCOUNT_ID = os.environ["NEAR_ACCOUNT_ID"]
PRIVATE_KEY = os.environ["NEAR_PRIVATE_KEY"]
CONTRACT_ID = os.environ.get("NEAR_CONTRACT_ID", ACCOUNT_ID)
NETWORK = os.environ.get("NEAR_NETWORK", "testnet")
RPC_URL = f"https://rpc.{NETWORK}.near.org"
EXPLORER_URL = f"https://explorer.{NETWORK}.near.org/transactions/{{tx_hash}}"

# ── NEAR client setup ─────────────────────────────────────────────────────────

rpc = near_api.providers.JsonProvider(RPC_URL)
key = near_api.signer.KeyPair(PRIVATE_KEY)
signer = near_api.signer.Signer(ACCOUNT_ID, key)
account = near_api.account.Account(rpc, signer, ACCOUNT_ID)

# ── Serialized submission queue (prevents nonce collisions) ───────────────────

_queue: queue.Queue = queue.Queue()
_results: dict = {}  # job_id → result dict


def _worker():
    while True:
        job_id, method, args = _queue.get()
        try:
            result = account.function_call(
                CONTRACT_ID,
                method,
                args,
                gas=100_000_000_000_000,  # 100 TGas
                amount=0,
            )
            _results[job_id] = {"ok": True, "result": result}
        except Exception as e:
            _results[job_id] = {"ok": False, "error": str(e)}
        finally:
            _queue.task_done()


threading.Thread(target=_worker, daemon=True).start()


def _submit(method: str, args: dict, timeout: float = 15.0) -> dict:
    job_id = hashlib.sha256(f"{method}{args}{time.time()}".encode()).hexdigest()[:16]
    _queue.put((job_id, method, args))
    deadline = time.time() + timeout
    while time.time() < deadline:
        if job_id in _results:
            return _results.pop(job_id)
        time.sleep(0.1)
    return {"ok": False, "error": "timeout"}


# ── In-memory cache (mirrors contract state for fast reads) ───────────────────

cache: dict[str, dict] = {}  # session_id → { rep_number: attestation }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.post("/near/attest_rep")
def attest_rep():
    data = request.get_json(force=True)
    session_id = data["session_id"]
    rep_number = int(data["rep_number"])

    args = {
        "session_id": session_id,
        "rep_number": rep_number,
        "session_hash": data.get("session_hash", ""),
        "quality_score": int(data.get("quality_score", 0)),
        "form_state": data.get("form_state", "GREEN"),
    }

    res = _submit("attest_rep", args)
    if not res["ok"]:
        # Graceful fallback: return mock tx_hash on NEAR failure
        mock_hash = f"mock_{hashlib.sha256(str(args).encode()).hexdigest()[:16]}"
        return jsonify({"tx_hash": mock_hash, "block_height": 0, "status": "pending", "error": res["error"]})

    tx_result = res["result"]
    tx_hash = tx_result.get("transaction", {}).get("hash", "")
    block_height = tx_result.get("transaction_outcome", {}).get("block_hash", 0)

    # Cache for fast verify_session reads
    cache.setdefault(session_id, {})[rep_number] = {
        **args,
        "tx_hash": tx_hash,
        "block_height": block_height,
        "explorer_url": EXPLORER_URL.format(tx_hash=tx_hash),
        "timestamp": int(time.time()),
        "status": "confirmed",
    }

    return jsonify({
        "tx_hash": tx_hash,
        "block_height": block_height,
        "status": "confirmed",
        "explorer_url": EXPLORER_URL.format(tx_hash=tx_hash),
    })


@app.post("/near/verify_session")
def verify_session():
    data = request.get_json(force=True)
    session_id = data["session_id"]

    # Try contract first, fall back to cache
    try:
        result = account.view_function(CONTRACT_ID, "verify_session", {"session_id": session_id})
        return jsonify(result)
    except Exception:
        reps = list(cache.get(session_id, {}).values())
        total = len(reps)
        green = sum(1 for r in reps if r.get("form_state") == "GREEN")
        yellow = sum(1 for r in reps if r.get("form_state") == "YELLOW")
        red = sum(1 for r in reps if r.get("form_state") == "RED")
        green_pct = int(green / total * 100) if total > 0 else 0
        return jsonify({
            "session_id": session_id,
            "total_reps": total,
            "green_count": green,
            "yellow_count": yellow,
            "red_count": red,
            "green_pct": green_pct,
            "compliant": green_pct >= 80,
            "attestations": reps,
            "tx_hashes": [r["tx_hash"] for r in reps],
        })


@app.post("/near/get_patient_stats")
def get_patient_stats():
    data = request.get_json(force=True)
    patient_id = data["patient_id"]
    try:
        result = account.view_function(CONTRACT_ID, "get_patient_stats", {"patient_id": patient_id})
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e), "patient_id": patient_id, "total_sessions": 0, "total_reps": 0, "overall_compliance": 0, "recent_trend": "stable"})


@app.get("/health")
def health():
    return jsonify({"status": "ok", "mode": "real", "contract": CONTRACT_ID, "network": NETWORK})


if __name__ == "__main__":
    app.run(port=5001)
