# SKILL 2 — Agent + Adaptation Engine
## FormGuard · Applied Intelligence Hackathon · May 31 2026

---

## What This Skill Does

The brain of FormGuard. A LangGraph state machine that:
1. Receives form assessments from Skill 1
2. Tracks session state (reps, pain trend, fatigue signals)
3. Decides whether to continue, adapt, or stop the exercise
4. Emits coaching events to the frontend via SSE
5. Creates the session summary for PT review

The key differentiation from fitness apps:
**Rewards safe adherence, not performance intensity.**

---

## Session State Machine

```
ACTIVE ──────────────────────────────────────────────────────────────
  │ GREEN assessment                                                  │
  │ → continue, reward good rep, emit coaching cue                   │
  │                                                                   │
  │ YELLOW assessment                                                 │
  │ → give correction cue, reduce intensity if 2+ consecutive        │
  │                                                                   │
  │ RED assessment OR pain ≥ 7                                        │
  ▼                                                                   │
ADAPTED ──────────────────────────────────────────────────────────── │
  │ Switch to easier exercise variation                               │
  │ Reduce rep target or range of motion                             │
  │ Continue monitoring                                               │
  │                                                                   │
  │ 2nd RED in adapted state                                          │
  ▼
STOPPED
  Session ends early
  Flag created for PT
  Evidence clip saved
```

---

## Exercise Adaptation Map

```python
EXERCISE_ADAPTATIONS = {
    "squat": {
        "yellow_adaptation": "slow_squat",      # slower tempo, smaller range
        "red_adaptation": "sit_to_stand",        # seated, much less knee stress
        "stop_if_red_twice": True
    },
    "sit_to_stand": {
        "yellow_adaptation": "partial_sit_to_stand",
        "red_adaptation": None,                  # already the easiest — stop
        "stop_if_red_twice": True
    },
    "hip_abduction": {
        "yellow_adaptation": "lying_hip_abduction",
        "red_adaptation": None,
        "stop_if_red_twice": True
    }
}

ADAPTATION_MESSAGES = {
    "slow_squat": "Slowing down the tempo. Take 3 seconds to lower and 3 to rise.",
    "sit_to_stand": "Switching to sit-to-stands — less stress on your knee. Same goal, safer movement.",
    "lying_hip_abduction": "Moving to the floor version. Lie on your side for this one.",
    "partial_sit_to_stand": "Reducing range of motion. Only go halfway up for now."
}
```

---

## LangGraph Agent — `agents/session_agent.py`

```python
import os, time, json
from langgraph.graph import StateGraph, END
from typing import TypedDict, Optional

class SessionState(TypedDict):
    session_id: str
    patient_id: str
    exercise: str
    prescribed_reps: int
    completed_reps: int
    current_rep_assessment: dict       # latest from Skill 1
    pain_history: list[int]            # pain reported each rep
    consecutive_yellow: int
    consecutive_red: int
    session_status: str                # ACTIVE | ADAPTED | STOPPED | COMPLETE
    adaptation_applied: Optional[str]
    flags_for_pt: list[dict]
    events: list[dict]                 # SSE events to stream
    rewards_earned: list[dict]
    session_start_time: float
    rep_assessments: list[dict]        # all rep data for PT review


def emit(state: SessionState, tag: str, text: str, sub: str = "") -> dict:
    return {"type": "log", "tag": tag, "text": text, "sub": sub,
            "session_id": state["session_id"]}


def assess_rep_node(state: SessionState) -> SessionState:
    """Process latest form assessment and decide next action."""
    events = []
    assessment = state["current_rep_assessment"]
    form_state = assessment.get("state", "GREEN")
    pain = state["pain_history"][-1] if state["pain_history"] else 0
    rep = state["completed_reps"] + 1

    events.append(emit(state, "REP", f"Rep {rep} — {form_state}",
                        assessment.get("coaching_cue", "")))

    # Track consecutive issues
    yellow_count = state["consecutive_yellow"]
    red_count = state["consecutive_red"]

    if form_state == "GREEN":
        yellow_count = 0
        red_count = 0
        events.append(emit(state, "FORM", "Good rep ✓", f"Score: {assessment.get('rep_quality_score',75)}"))
    elif form_state == "YELLOW":
        yellow_count += 1
        red_count = 0
        events.append(emit(state, "FORM", assessment.get("coaching_cue", "Adjust your form"),
                           f"Rep quality: {assessment.get('rep_quality_score',60)}"))
    elif form_state == "RED":
        red_count += 1
        yellow_count = 0
        events.append(emit(state, "ALERT", "⚠️ Stopping set",
                           assessment.get("coaching_cue", "Rest now")))

    # Store rep for PT review
    rep_record = {
        "rep": rep,
        "assessment": assessment,
        "pain": pain,
        "timestamp": time.time()
    }

    return {
        **state,
        "completed_reps": rep,
        "consecutive_yellow": yellow_count,
        "consecutive_red": red_count,
        "rep_assessments": state["rep_assessments"] + [rep_record],
        "events": events
    }


def decide_adaptation_node(state: SessionState) -> SessionState:
    """Decide whether to adapt or continue."""
    events = []
    exercise = state["exercise"]
    adaptations = EXERCISE_ADAPTATIONS.get(exercise, {})

    # Trigger adaptation conditions
    should_adapt = (
        state["consecutive_yellow"] >= 2 or
        state["consecutive_red"] >= 1 or
        (state["pain_history"] and max(state["pain_history"][-3:]) >= 5)
    )

    should_stop = (
        state["consecutive_red"] >= 2 or
        (state["pain_history"] and state["pain_history"][-1] >= 7)
    )

    if should_stop and state["session_status"] != "STOPPED":
        events.append(emit(state, "AGENT", "Ending session early",
                           "Pain or form breakdown detected — flagging for PT"))
        flag = {
            "type": "early_stop",
            "reason": "RED state or pain ≥ 7",
            "rep": state["completed_reps"],
            "pain": state["pain_history"][-1] if state["pain_history"] else 0,
            "timestamp": time.time()
        }
        return {**state, "session_status": "STOPPED",
                "flags_for_pt": state["flags_for_pt"] + [flag],
                "events": events}

    if should_adapt and state["session_status"] == "ACTIVE":
        adaptation = adaptations.get("red_adaptation") if state["consecutive_red"] >= 1 \
                     else adaptations.get("yellow_adaptation")
        if adaptation:
            msg = ADAPTATION_MESSAGES.get(adaptation, "Adapting exercise for safety.")
            events.append(emit(state, "AGENT",
                               f"Adapting → {adaptation.replace('_', ' ').title()}",
                               msg))
            return {**state, "session_status": "ADAPTED",
                    "exercise": adaptation,
                    "adaptation_applied": adaptation,
                    "consecutive_yellow": 0,
                    "events": events}

    return {**state, "events": events}


def check_completion_node(state: SessionState) -> SessionState:
    """Check if session is complete and award rewards."""
    events = []
    rewards = list(state["rewards_earned"])

    if state["completed_reps"] >= state["prescribed_reps"]:
        events.append(emit(state, "DONE",
                           f"Session complete — {state['completed_reps']} reps",
                           "Great work today"))

        # Award PT-aligned rewards (not intensity-based)
        rewards.append({"type": "session_complete",
                         "label": "Session Complete 🎯",
                         "description": "Completed your prescribed session"})

        if not state["flags_for_pt"]:
            rewards.append({"type": "safe_session",
                             "label": "Safe Recovery ✅",
                             "description": "Maintained safe form throughout"})

        if state["adaptation_applied"]:
            rewards.append({"type": "listened_to_body",
                             "label": "Listened to Your Body 💚",
                             "description": "Adapted safely when needed"})

        pain_reports = [p for p in state["pain_history"] if p > 0]
        if pain_reports:
            rewards.append({"type": "honest_reporting",
                             "label": "Honest Reporter 📊",
                             "description": "Reported pain accurately — helps your PT"})

        return {**state, "session_status": "COMPLETE",
                "rewards_earned": rewards, "events": events}

    return {**state, "events": events}


def route_after_assessment(state: SessionState) -> str:
    if state["session_status"] == "STOPPED":
        return "complete"
    if state["completed_reps"] >= state["prescribed_reps"]:
        return "complete"
    return "adapt"


# Build the graph
def build_session_graph():
    graph = StateGraph(SessionState)
    graph.add_node("assess_rep", assess_rep_node)
    graph.add_node("decide_adaptation", decide_adaptation_node)
    graph.add_node("check_completion", check_completion_node)

    graph.set_entry_point("assess_rep")
    graph.add_conditional_edges("assess_rep", route_after_assessment,
                                 {"adapt": "decide_adaptation", "complete": "check_completion"})
    graph.add_edge("decide_adaptation", "check_completion")
    graph.add_edge("check_completion", END)
    return graph.compile()

SESSION_GRAPH = build_session_graph()


def process_rep(session_state: dict, assessment: dict, pain: int) -> dict:
    """
    Call this once per rep with the vision assessment.
    Returns updated state + events to stream.
    """
    session_state["current_rep_assessment"] = assessment
    session_state["pain_history"] = session_state.get("pain_history", []) + [pain]

    result = SESSION_GRAPH.invoke(session_state)
    return result
```

---

## Session Init Helper — `agents/session_init.py`

```python
import time, uuid

EXERCISE_PROGRAMS = {
    "knee_rehab": {
        "exercises": ["squat", "sit_to_stand", "hip_abduction"],
        "reps_per_exercise": 10,
        "description": "Post-knee surgery recovery program"
    },
    "hip_rehab": {
        "exercises": ["hip_abduction", "sit_to_stand"],
        "reps_per_exercise": 12,
        "description": "Hip replacement recovery"
    },
    "back_rehab": {
        "exercises": ["sit_to_stand"],
        "reps_per_exercise": 15,
        "description": "Lower back strengthening"
    }
}

def create_session(patient_id: str, program: str, exercise: str) -> dict:
    program_data = EXERCISE_PROGRAMS.get(program, EXERCISE_PROGRAMS["knee_rehab"])
    return {
        "session_id": uuid.uuid4().hex[:10],
        "patient_id": patient_id,
        "exercise": exercise,
        "prescribed_reps": program_data["reps_per_exercise"],
        "completed_reps": 0,
        "current_rep_assessment": {},
        "pain_history": [],
        "consecutive_yellow": 0,
        "consecutive_red": 0,
        "session_status": "ACTIVE",
        "adaptation_applied": None,
        "flags_for_pt": [],
        "events": [],
        "rewards_earned": [],
        "session_start_time": time.time(),
        "rep_assessments": []
    }
```

---

## SSE Event Types from This Skill

```json
{"type":"log","tag":"REP",   "text":"Rep 3 — YELLOW","sub":"Push knees outward"}
{"type":"log","tag":"FORM",  "text":"Good rep ✓",    "sub":"Score: 88"}
{"type":"log","tag":"ALERT", "text":"⚠️ Stopping set","sub":"Rest now"}
{"type":"log","tag":"AGENT", "text":"Adapting → Sit To Stand","sub":"Less stress on your knee"}
{"type":"log","tag":"DONE",  "text":"Session complete — 10 reps","sub":"Great work today"}
{"type":"reward","reward":{"type":"session_complete","label":"Session Complete 🎯"}}
{"type":"flag",  "flag":{"type":"early_stop","reason":"pain ≥ 7","rep":4}}
```
