import time
import uuid
from fastapi import APIRouter, HTTPException
from models import SessionCreate
import insforge_client as insforge

router = APIRouter()

# In-memory stores (shared via main.py injection)
sessions_db: dict[str, dict] = {}
patients_db: dict[str, dict] = {}
name_to_id: dict[str, str] = {}
reps_db: dict[str, dict] = {}
flags_db: dict[str, list] = {}
attestations_db: dict[str, list] = {}

EXERCISE_REP_MAP = {
    "squat": 10,
    "lunge": 10,
    "bridge": 12,
    "clamshell": 15,
    "step_up": 10,
    "leg_press": 12,
    "default": 10,
}

DEMO_SESSIONS = []


def _seed_demo():
    """Pre-load demo data for 'Demo Patient'."""
    patient_id = "patient_demo"
    patients_db[patient_id] = {
        "patient_id": patient_id,
        "name": "Demo Patient",
        "compliance_score": 85,
        "sessions": [],
    }
    name_to_id["Demo Patient"] = patient_id

    for i in range(3):
        sid = f"demo_session_{i+1}"
        sessions_db[sid] = {
            "session_id": sid,
            "patient_id": patient_id,
            "patient_name": "Demo Patient",
            "exercise": "squat",
            "program": "knee_rehab",
            "prescribed_reps": 10,
            "status": "COMPLETE",
            "timestamp": int(time.time()) - (3 - i) * 86400,
        }
        patients_db[patient_id]["sessions"].append(sid)
        reps_db[sid] = {}
        flags_db[sid] = []
        attestations_db[sid] = []
        form_states = ["GREEN", "GREEN", "YELLOW", "GREEN", "RED", "GREEN", "GREEN", "YELLOW", "GREEN", "GREEN"]
        base_ts = sessions_db[sid]["timestamp"]
        for r in range(1, 11):
            fs = form_states[r - 1]
            qs = 90 if fs == "GREEN" else (70 if fs == "YELLOW" else 40)
            reps_db[sid][r] = {
                "rep_number": r,
                "form_state": fs,
                "quality_score": qs,
                "coaching_cue": "Good form" if fs == "GREEN" else "Watch your knee",
                "pain_level": 0 if fs != "RED" else 3,
                "session_id": sid,
                "timestamp": base_ts + r * 8,
            }
            import hashlib as _hl
            sh = _hl.sha256(f"{sid}:{patient_id}:{r}:{qs}:{fs}".encode()).hexdigest()
            attestations_db[sid].append({
                "session_id": sid,
                "rep_number": r,
                "session_hash": sh,
                "quality_score": qs,
                "form_state": fs,
                "tx_hash": f"mock_{sh[:16]}",
                "block_height": 12345 + r,
                "status": "confirmed",
                "timestamp": base_ts + r * 8 + 2,
            })
        if i == 1:
            flags_db[sid].append({
                "flag_id": f"flag_demo_{i+1}",
                "session_id": sid,
                "type": "pain_spike",
                "rep_number": 5,
                "pain_level": 3,
                "notes": "Patient reported sharp knee pain",
            })


_seed_demo()


@router.post("/session/create")
async def create_session(body: SessionCreate):
    patient_name = body.patient_name.strip()

    # Stable patient_id resolution
    if patient_name in name_to_id:
        patient_id = name_to_id[patient_name]
    else:
        patient_id = f"patient_{uuid.uuid4().hex[:8]}"
        name_to_id[patient_name] = patient_id
        patients_db[patient_id] = {
            "patient_id": patient_id,
            "name": patient_name,
            "compliance_score": 0,
            "sessions": [],
        }

    session_id = f"sess_{uuid.uuid4().hex[:10]}"
    prescribed_reps = EXERCISE_REP_MAP.get(body.exercise.lower(), EXERCISE_REP_MAP["default"])

    session = {
        "session_id": session_id,
        "patient_id": patient_id,
        "patient_name": patient_name,
        "exercise": body.exercise,
        "program": body.program,
        "prescribed_reps": prescribed_reps,
        "status": "IN_PROGRESS",
        "timestamp": int(time.time()),
    }

    sessions_db[session_id] = session
    reps_db[session_id] = {}
    flags_db[session_id] = []
    attestations_db[session_id] = []
    patients_db[patient_id]["sessions"].append(session_id)

    await insforge.write_record("sessions", session_id, session)

    return {"session_id": session_id, "patient_id": patient_id, "exercise": body.exercise, "prescribed_reps": prescribed_reps}


@router.get("/tool/session/{session_id}")
async def get_session(session_id: str):
    if session_id not in sessions_db:
        raise HTTPException(status_code=404, detail="Session not found")
    session = sessions_db[session_id]
    reps = list(reps_db.get(session_id, {}).values())
    flags = flags_db.get(session_id, [])
    attestations = attestations_db.get(session_id, [])

    prescribed = session.get("prescribed_reps", 10)
    completed = len(reps)
    if completed >= prescribed:
        sessions_db[session_id]["status"] = "COMPLETE"
    session_status = sessions_db[session_id]["status"]

    return {
        "session": {**session, "status": session_status},
        "reps": reps,
        "flags": flags,
        "attestations": attestations,
    }


@router.get("/tool/patients")
async def list_patients():
    out = []
    for p in patients_db.values():
        sessions = p.get("sessions", [])
        out.append({
            "patient_id": p["patient_id"],
            "name": p["name"],
            "compliance_score": p.get("compliance_score", 0),
            "last_session": sessions[-1] if sessions else None,
        })
    return {"patients": out}


@router.get("/tool/patient/{patient_id}/history")
async def patient_history(patient_id: str):
    if patient_id not in patients_db:
        raise HTTPException(status_code=404, detail="Patient not found")

    patient = patients_db[patient_id]
    session_ids = patient.get("sessions", [])
    sessions = []

    for sid in session_ids:
        if sid not in sessions_db:
            continue
        s = sessions_db[sid]
        reps = list(reps_db.get(sid, {}).values())
        prescribed = s.get("prescribed_reps", 10)
        completed = len(reps)
        green_reps = sum(1 for r in reps if r.get("form_state") == "GREEN")
        score = round((green_reps / max(prescribed, 1)) * 100)
        sessions.append({
            "session_id": s["session_id"],
            "exercise": s.get("exercise", ""),
            "status": s.get("status", "IN_PROGRESS"),
            "compliance_score": score,
            "timestamp": s.get("timestamp", 0),
        })

    scores = [s["compliance_score"] for s in sessions[-3:]] if sessions else []
    if len(scores) >= 2:
        if scores[-1] > scores[0]:
            trend = "improving"
        elif scores[-1] < scores[0]:
            trend = "declining"
        else:
            trend = "stable"
    else:
        trend = "stable"

    overall = round(sum(scores) / len(scores)) if scores else 0

    return {"sessions": sessions, "compliance_score": overall, "trend": trend}
