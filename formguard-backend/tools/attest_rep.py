import hashlib
import time
import near_client


def compute_hash(session_id: str, patient_id: str, rep_number: int, quality_score: float, form_state: str) -> str:
    raw = f"{session_id}:{patient_id}:{rep_number}:{quality_score}:{form_state}"
    return hashlib.sha256(raw.encode()).hexdigest()


async def run_attest(
    session_id: str,
    patient_id: str,
    rep_number: int,
    quality_score: float,
    form_state: str,
    attestations_db: dict,
    push_event,
):
    """Internal async function: compute hash, call C, store full §3 Attestation, emit SSE."""
    session_hash = compute_hash(session_id, patient_id, rep_number, quality_score, form_state)

    # §2 payload shape — B → C
    near_payload = {
        "session_id": session_id,
        "rep_number": rep_number,
        "session_hash": session_hash,
        "quality_score": quality_score,
        "form_state": form_state,
    }
    result = await near_client.attest_rep(near_payload)

    # §3 Attestation object — stored and returned to A
    entry = {
        "session_id": session_id,
        "rep_number": rep_number,
        "session_hash": session_hash,
        "quality_score": quality_score,
        "form_state": form_state,
        "tx_hash": result["tx_hash"],
        "block_height": result["block_height"],
        "status": result["status"],
        "timestamp": int(time.time()),
    }

    if session_id not in attestations_db:
        attestations_db[session_id] = []
    # Idempotent upsert by rep_number
    attestations_db[session_id] = [a for a in attestations_db[session_id] if a["rep_number"] != rep_number]
    attestations_db[session_id].append(entry)

    # SSE attest event — §1 /pt/stream shape
    await push_event("attest", {"session_id": session_id, "rep_number": rep_number, "tx_hash": result["tx_hash"]})
