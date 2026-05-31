# SKILL 4 — Storage + NEAR Attestation
## FormGuard · Applied Intelligence Hackathon · May 31 2026

---

## What This Skill Does

Three storage concerns handled separately:

1. **Insforge** — structured session data (reps, pain scores, assessments, patient progress)
2. **Tigris** — video evidence clips (best rep, worst rep, moment of pain report)
3. **NEAR AI** — privacy-preserving session attestation (hash only, no PHI on-chain)

---

## IMPORTANT: HIPAA-Aware Design

Do NOT store actual health data on NEAR blockchain.
Store ONLY: timestamp, anonymized session ID, exercise type, completion status, and hash.

The actual session data lives in Insforge (structured) and Tigris (video).
NEAR provides a tamper-proof timestamp and completion proof — nothing sensitive.

---

## Insforge — Structured Session Storage — `services/insforge.py`

```python
import os, httpx, json

INSFORGE_URL = os.getenv("INSFORGE_API_URL", "https://api.insforge.dev")
INSFORGE_KEY = os.getenv("INSFORGE_API_KEY", "")

def save_session(session_data: dict) -> dict:
    """Save completed session to Insforge DB."""
    if not INSFORGE_KEY:
        return _mock_save(session_data)
    try:
        resp = httpx.post(
            f"{INSFORGE_URL}/v1/records",
            headers={"Authorization": f"Bearer {INSFORGE_KEY}",
                     "Content-Type": "application/json"},
            json={
                "collection": "sessions",
                "data": {
                    "session_id": session_data["session_id"],
                    "patient_id": session_data["patient_id"],
                    "exercise": session_data["exercise"],
                    "completed_reps": session_data["completed_reps"],
                    "prescribed_reps": session_data["prescribed_reps"],
                    "session_status": session_data["session_status"],
                    "adaptation_applied": session_data.get("adaptation_applied"),
                    "flags_for_pt": session_data["flags_for_pt"],
                    "rewards_earned": session_data["rewards_earned"],
                    "rep_assessments": session_data["rep_assessments"],
                    "pain_history": session_data["pain_history"],
                    "duration_seconds": session_data.get("duration_seconds", 0),
                }
            },
            timeout=10
        )
        return resp.json()
    except Exception as e:
        return _mock_save(session_data)


def get_patient_sessions(patient_id: str, limit: int = 10) -> list:
    """Fetch recent sessions for PT dashboard."""
    if not INSFORGE_KEY:
        return _mock_patient_sessions(patient_id)
    try:
        resp = httpx.get(
            f"{INSFORGE_URL}/v1/records",
            headers={"Authorization": f"Bearer {INSFORGE_KEY}"},
            params={"collection": "sessions", "filter": f"patient_id={patient_id}",
                    "limit": limit, "sort": "-created_at"},
            timeout=10
        )
        return resp.json().get("records", [])
    except:
        return _mock_patient_sessions(patient_id)


def _mock_save(session_data: dict) -> dict:
    return {"id": f"mock_{session_data['session_id']}", "saved": True}

def _mock_patient_sessions(patient_id: str) -> list:
    return [
        {"session_id": "abc123", "exercise": "squat", "completed_reps": 10,
         "prescribed_reps": 10, "session_status": "COMPLETE",
         "pain_history": [0,0,2,3,2,0,0,0,1,0], "flags_for_pt": [],
         "rewards_earned": [{"type":"session_complete"}], "duration_seconds": 420},
        {"session_id": "abc124", "exercise": "sit_to_stand", "completed_reps": 8,
         "prescribed_reps": 10, "session_status": "ADAPTED",
         "pain_history": [0,1,3,5,6,6,5,4], "flags_for_pt": [{"type":"early_stop"}],
         "rewards_earned": [{"type":"listened_to_body"}], "duration_seconds": 380},
    ]
```

---

## Tigris — Evidence Clip Storage — `services/tigris.py`

```python
import os, boto3, uuid
from botocore.config import Config

def get_tigris_client():
    return boto3.client(
        "s3",
        endpoint_url="https://fly.storage.tigris.dev",
        aws_access_key_id=os.getenv("TIGRIS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.getenv("TIGRIS_SECRET_ACCESS_KEY"),
        config=Config(signature_version="s3v4"),
        region_name="auto"
    )

BUCKET = os.getenv("TIGRIS_BUCKET", "formguard-evidence")

def save_evidence_clip(session_id: str, clip_type: str,
                       video_bytes: bytes, metadata: dict) -> str:
    """
    Save a short evidence clip to Tigris.
    clip_type: best_rep | worst_rep | pain_moment | before | after
    Returns: the clip URL
    """
    if not os.getenv("TIGRIS_ACCESS_KEY_ID"):
        return f"mock://clips/{session_id}/{clip_type}.mp4"

    key = f"sessions/{session_id}/{clip_type}_{uuid.uuid4().hex[:6]}.mp4"
    try:
        client = get_tigris_client()
        client.put_object(
            Bucket=BUCKET,
            Key=key,
            Body=video_bytes,
            ContentType="video/mp4",
            Metadata={k: str(v) for k, v in metadata.items()}
        )
        return f"https://fly.storage.tigris.dev/{BUCKET}/{key}"
    except Exception as e:
        return f"error://{str(e)[:50]}"


def save_session_thumbnail(session_id: str, frame_bytes: bytes) -> str:
    """Save a single frame as the session thumbnail for PT dashboard."""
    if not os.getenv("TIGRIS_ACCESS_KEY_ID"):
        return f"mock://thumbnails/{session_id}.jpg"
    key = f"thumbnails/{session_id}.jpg"
    try:
        client = get_tigris_client()
        client.put_object(Bucket=BUCKET, Key=key, Body=frame_bytes,
                          ContentType="image/jpeg")
        return f"https://fly.storage.tigris.dev/{BUCKET}/{key}"
    except:
        return ""


def get_session_clips(session_id: str) -> list:
    """List all evidence clips for a session."""
    if not os.getenv("TIGRIS_ACCESS_KEY_ID"):
        return [
            {"type": "best_rep", "url": f"mock://clips/{session_id}/best_rep.mp4"},
            {"type": "worst_rep", "url": f"mock://clips/{session_id}/worst_rep.mp4"},
        ]
    try:
        client = get_tigris_client()
        resp = client.list_objects_v2(Bucket=BUCKET, Prefix=f"sessions/{session_id}/")
        return [{"type": obj["Key"].split("/")[-1].split("_")[0],
                 "url": f"https://fly.storage.tigris.dev/{BUCKET}/{obj['Key']}",
                 "size": obj["Size"]}
                for obj in resp.get("Contents", [])]
    except:
        return []
```

---

## NEAR AI — Session Attestation — `services/near_attestation.py`

```python
"""
NEAR AI attestation — privacy-preserving proof of session completion.
Stores ONLY: hash, timestamp, exercise type, completion status.
NO health data, NO video, NO pain scores stored on-chain.

This gives the PT a verifiable "this session happened and was not altered"
proof without exposing Protected Health Information (PHI).

Docs: https://docs.near.ai/
"""
import os, hashlib, json, time
import httpx

NEAR_API = os.getenv("NEAR_API_URL", "https://api.near.ai")
NEAR_KEY = os.getenv("NEAR_API_KEY", "")

def create_session_hash(session_id: str, patient_id: str,
                         exercise: str, status: str,
                         completed_reps: int) -> str:
    """Create a deterministic hash of non-sensitive session facts."""
    payload = f"{session_id}:{patient_id}:{exercise}:{status}:{completed_reps}"
    return hashlib.sha256(payload.encode()).hexdigest()


def attest_session(session_id: str, patient_id: str,
                    exercise: str, status: str, completed_reps: int) -> dict:
    """
    Submit session attestation to NEAR AI.
    Returns the transaction hash as proof.
    """
    session_hash = create_session_hash(
        session_id, patient_id, exercise, status, completed_reps
    )

    attestation = {
        "session_id": session_id,           # not PHI — just an ID
        "session_hash": session_hash,
        "exercise_type": exercise,           # type only, not patient details
        "completion_status": status,
        "timestamp": int(time.time()),
        # NO pain scores, NO video, NO personal details
    }

    if not NEAR_KEY:
        return _mock_attestation(attestation)

    try:
        resp = httpx.post(
            f"{NEAR_API}/v1/attest",
            headers={"Authorization": f"Bearer {NEAR_KEY}",
                     "Content-Type": "application/json"},
            json=attestation,
            timeout=15
        )
        result = resp.json()
        return {
            "tx_hash": result.get("transaction_hash", ""),
            "session_hash": session_hash,
            "verified_at": int(time.time()),
            "near_explorer": f"https://explorer.near.org/transactions/{result.get('transaction_hash','')}"
        }
    except Exception as e:
        return _mock_attestation(attestation)


def _mock_attestation(attestation: dict) -> dict:
    mock_hash = hashlib.sha256(json.dumps(attestation).encode()).hexdigest()[:16]
    return {
        "tx_hash": f"mock_tx_{mock_hash}",
        "session_hash": attestation["session_hash"],
        "verified_at": int(time.time()),
        "near_explorer": f"https://explorer.near.org/transactions/mock_tx_{mock_hash}"
    }
```

---

## Session Completion Flow

```python
# Called when session_status == COMPLETE or STOPPED
async def save_completed_session(session_state: dict, evidence_frames: list) -> dict:
    from services.insforge import save_session
    from services.tigris import save_evidence_clip
    from services.near_attestation import attest_session

    # 1. Save structured data to Insforge
    insforge_result = save_session(session_state)

    # 2. Save evidence clips to Tigris (best rep, worst rep)
    clips = []
    best_rep = max(session_state["rep_assessments"],
                   key=lambda r: r["assessment"].get("rep_quality_score", 0),
                   default=None)
    worst_rep = min(session_state["rep_assessments"],
                    key=lambda r: r["assessment"].get("rep_quality_score", 100),
                    default=None)

    if best_rep and evidence_frames:
        frame_idx = min(best_rep["rep"] - 1, len(evidence_frames) - 1)
        url = save_evidence_clip(
            session_state["session_id"], "best_rep",
            evidence_frames[frame_idx],
            {"rep": best_rep["rep"], "score": best_rep["assessment"].get("rep_quality_score")}
        )
        clips.append({"type": "best_rep", "url": url})

    # 3. Attest session on NEAR (hash only, no PHI)
    near_result = attest_session(
        session_state["session_id"],
        session_state["patient_id"],
        session_state["exercise"],
        session_state["session_status"],
        session_state["completed_reps"]
    )

    return {
        "session_id": session_state["session_id"],
        "insforge_id": insforge_result.get("id"),
        "evidence_clips": clips,
        "near_attestation": near_result
    }
```

---

## What to Show Judges

**Insforge:** "Structured session data — PT can query all sessions for any patient"
**Tigris:** "Short evidence clips — PT sees only the 2-3 moments that matter, not 20 minutes"
**NEAR AI:** "Tamper-proof proof that this session happened — no health data on chain, just a hash"

That last point directly addresses HIPAA concerns before a judge asks.
