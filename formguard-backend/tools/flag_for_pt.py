import uuid
import time
from fastapi import APIRouter, HTTPException
from models import FlagForPTRequest
import insforge_client as insforge

router = APIRouter()

# Injected by main.py
sessions_db: dict = {}
flags_db: dict = {}
push_event = None  # async callable


@router.post("/tool/flag_for_pt")
async def flag_for_pt(body: FlagForPTRequest):
    if body.session_id not in sessions_db:
        raise HTTPException(status_code=404, detail=f"Session {body.session_id} not found")

    flag_id = f"flag_{uuid.uuid4().hex[:8]}"
    ts = int(body.timestamp) if body.timestamp else int(time.time())
    flag = {
        "flag_id": flag_id,
        "session_id": body.session_id,
        "type": body.type,
        "rep_number": body.rep_number,
        "pain_level": body.pain_level,
        "notes": body.notes,
        "timestamp": ts,
    }

    if body.session_id not in flags_db:
        flags_db[body.session_id] = []
    flags_db[body.session_id].append(flag)

    await insforge.write_record("flags", flag_id, flag)

    # Hero moment: push live SSE flag event to PT dashboard
    if push_event:
        # §1 /pt/stream flag event shape: flag_id, patient_id, session_id, type, rep_number, pain_level
        await push_event("flag", {
            "flag_id": flag_id,
            "patient_id": sessions_db[body.session_id].get("patient_id", ""),
            "session_id": body.session_id,
            "type": body.type,
            "rep_number": body.rep_number,
            "pain_level": body.pain_level,
        })

    return {"ok": True, "flag_id": flag_id}
