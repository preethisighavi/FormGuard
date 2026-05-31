import asyncio
import time
from fastapi import APIRouter, BackgroundTasks, HTTPException
from models import LogRepRequest
import insforge_client as insforge
from tools.attest_rep import run_attest

router = APIRouter()

# Injected by main.py
sessions_db: dict = {}
reps_db: dict = {}
attestations_db: dict = {}
patients_db: dict = {}
push_event = None  # callable: async (event_type, data) -> None


@router.post("/tool/log_rep")
async def log_rep(body: LogRepRequest, background_tasks: BackgroundTasks):
    if body.session_id not in sessions_db:
        raise HTTPException(status_code=404, detail=f"Session {body.session_id} not found")

    ts = int(body.timestamp) if body.timestamp else int(time.time())
    rep = {
        "session_id": body.session_id,
        "rep_number": body.rep_number,
        "form_state": body.form_state,
        "quality_score": body.quality_score,
        "coaching_cue": body.coaching_cue,
        "pain_level": body.pain_level,
        "timestamp": ts,
    }

    # Dedup by rep_number — last write wins
    if body.session_id not in reps_db:
        reps_db[body.session_id] = {}
    reps_db[body.session_id][body.rep_number] = rep

    doc_id = f"{body.session_id}_rep_{body.rep_number}"
    await insforge.write_record("reps", doc_id, rep)

    patient_id = sessions_db[body.session_id].get("patient_id", "unknown")

    background_tasks.add_task(
        _attest_background,
        body.session_id,
        patient_id,
        body.rep_number,
        body.quality_score,
        body.form_state,
    )

    return {"ok": True, "recorded": True}


async def _attest_background(session_id, patient_id, rep_number, quality_score, form_state):
    await run_attest(
        session_id=session_id,
        patient_id=patient_id,
        rep_number=rep_number,
        quality_score=quality_score,
        form_state=form_state,
        attestations_db=attestations_db,
        push_event=push_event,
    )
