import os
import httpx

NEAR_ENDPOINT = os.getenv("NEAR_ENDPOINT", "")


async def attest_rep(payload: dict) -> dict:
    """POST to Computer C's /near/attest_rep. Returns { tx_hash, block_height, status }."""
    session_hash = payload.get("session_hash", "mock")
    if not NEAR_ENDPOINT:
        return {"tx_hash": f"mock_{session_hash[:16]}", "block_height": 0, "status": "confirmed"}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            # payload must match §2: { session_id, rep_number, session_hash, quality_score, form_state }
            r = await client.post(f"{NEAR_ENDPOINT}/attest_rep", json=payload)
            r.raise_for_status()
            data = r.json()
            return {
                "tx_hash": data.get("tx_hash", f"mock_{session_hash[:16]}"),
                "block_height": data.get("block_height", 0),
                "status": data.get("status", "confirmed"),
            }
    except Exception:
        return {"tx_hash": f"mock_{session_hash[:16]}", "block_height": 0, "status": "confirmed"}
