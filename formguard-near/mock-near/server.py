"""
Mock NEAR server for FormGuard — Computer C
Runs on port 5001. Returns the same JSON shapes as the real signing relay.
Start: python server.py
"""
import hashlib
import time
from flask import Flask, request, jsonify

app = Flask(__name__)

# session_id → { rep_number: attestation_dict }  (keyed dict for idempotent upsert)
store: dict[str, dict] = {}

# patient_id → [session_id, ...]  (populated when verify_session is called with patient_id hint)
patient_sessions: dict[str, list] = {}


@app.post("/near/attest_rep")
def attest_rep():
    data = request.get_json(force=True)
    session_id = data.get("session_id", "")
    rep_number = data.get("rep_number", 0)
    session_hash = data.get("session_hash", "")
    quality_score = data.get("quality_score", 0)
    form_state = data.get("form_state", "GREEN")

    # Deterministic mock tx_hash from content so re-sends return the same hash
    raw = f"{session_id}:{rep_number}:{session_hash}"
    tx_hash = f"mock_{hashlib.sha256(raw.encode()).hexdigest()[:16]}"

    reps = store.setdefault(session_id, {})
    block_height = 12345 + len(reps)

    # Idempotent upsert by rep_number
    reps[rep_number] = {
        "session_id": session_id,
        "rep_number": rep_number,
        "session_hash": session_hash,
        "quality_score": quality_score,
        "form_state": form_state,
        "tx_hash": tx_hash,
        "block_height": block_height,
        "timestamp": int(time.time()),
        "status": "confirmed",
    }

    return jsonify({"tx_hash": tx_hash, "block_height": block_height, "status": "confirmed"})


@app.post("/near/verify_session")
def verify_session():
    data = request.get_json(force=True)
    session_id = data.get("session_id", "")
    reps = list(store.get(session_id, {}).values())
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
    patient_id = data.get("patient_id", "")
    session_ids = data.get("session_ids", [])

    all_reps = []
    session_scores = []
    for sid in session_ids:
        reps = list(store.get(sid, {}).values())
        all_reps.extend(reps)
        if reps:
            g = sum(1 for r in reps if r.get("form_state") == "GREEN")
            session_scores.append(int(g / len(reps) * 100))

    total_reps = len(all_reps)
    overall = int(sum(session_scores) / len(session_scores)) if session_scores else 0

    if len(session_scores) >= 2:
        if session_scores[-1] > session_scores[0]:
            trend = "improving"
        elif session_scores[-1] < session_scores[0]:
            trend = "declining"
        else:
            trend = "stable"
    else:
        trend = "stable"

    return jsonify({
        "patient_id": patient_id,
        "total_sessions": len(session_ids),
        "total_reps": total_reps,
        "overall_compliance": overall,
        "recent_trend": trend,
    })


@app.get("/health")
def health():
    return jsonify({"status": "ok", "mode": "mock"})


if __name__ == "__main__":
    app.run(port=5001, debug=True)
