from pydantic import BaseModel
from typing import Optional


class SessionCreate(BaseModel):
    patient_name: str
    program: str
    exercise: str


class LogRepRequest(BaseModel):
    session_id: str
    rep_number: int
    form_state: str          # GREEN | YELLOW | RED
    quality_score: float
    coaching_cue: str
    pain_level: int
    timestamp: Optional[int] = None   # unix seconds


class FlagForPTRequest(BaseModel):
    session_id: str
    type: str
    rep_number: Optional[int] = None
    pain_level: Optional[int] = None
    notes: Optional[str] = None
    timestamp: Optional[int] = None   # unix seconds
