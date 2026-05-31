from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import pt_stream
import tools.log_rep as log_rep_mod
import tools.flag_for_pt as flag_mod
import tools.session as session_mod
from tools.session import sessions_db, reps_db, flags_db, attestations_db, patients_db, name_to_id

app = FastAPI(title="FormGuard Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Wire shared state into each tool module
log_rep_mod.sessions_db = sessions_db
log_rep_mod.reps_db = reps_db
log_rep_mod.attestations_db = attestations_db
log_rep_mod.patients_db = patients_db
log_rep_mod.push_event = pt_stream.push_event

flag_mod.sessions_db = sessions_db
flag_mod.flags_db = flags_db
flag_mod.push_event = pt_stream.push_event

# Register routers
app.include_router(session_mod.router)
app.include_router(log_rep_mod.router)
app.include_router(flag_mod.router)
app.include_router(pt_stream.router)


@app.get("/health")
def health():
    return {"status": "ok"}
