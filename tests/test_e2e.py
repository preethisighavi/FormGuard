"""
FormGuard End-to-End Tests to run locally
==========================
Tests the full A→B→C chain with both services running locally.

Prerequisites (run these first in separate terminals):
  Terminal 1 — Mock NEAR (Computer C):
      cd formguard-near/mock-near
      pip install flask
      python server.py                    # starts on port 5001

  Terminal 2 — Backend (Computer B):
      cd formguard-backend
      pip install -r requirements.txt
      NEAR_ENDPOINT=http://127.0.0.1:5001/near uvicorn main:app --port 8000

Run tests:
      cd formguard-backend
      pytest ../tests/test_e2e.py -v -s

Environment variables (optional overrides):
  BACKEND_URL   default: http://127.0.0.1:8000
  NEAR_URL      default: http://127.0.0.1:5001
"""

import os
import time
import threading
import pytest
import requests

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

BACKEND  = os.getenv("BACKEND_URL", "http://127.0.0.1:8000")
NEAR_URL = os.getenv("NEAR_URL",    "http://127.0.0.1:5001")
TIMEOUT  = 10   # seconds per request
ATTEST_WAIT = 3  # seconds to wait for async attestation to land


def backend(path):
    return f"{BACKEND}{path}"

def near(path):
    return f"{NEAR_URL}{path}"


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def post(path, body, base=BACKEND):
    url = f"{base}{path}"
    r = requests.post(url, json=body, timeout=TIMEOUT)
    return r

def get(path, base=BACKEND):
    url = f"{base}{path}"
    r = requests.get(url, timeout=TIMEOUT)
    return r


# ---------------------------------------------------------------------------
# E2E-01  Health checks — both services must be reachable
# ---------------------------------------------------------------------------

class TestE2E_01_HealthChecks:

    def test_backend_health(self):
        """Computer B must respond 200 with status ok."""
        r = get("/health")
        assert r.status_code == 200, f"Backend unreachable: {r.text}"
        assert r.json()["status"] == "ok"

    def test_near_mock_health(self):
        """Computer C (mock) must respond 200 with status ok."""
        r = get("/health", base=NEAR_URL)
        assert r.status_code == 200, f"Mock NEAR unreachable: {r.text}"
        assert r.json()["status"] == "ok"


# ---------------------------------------------------------------------------
# E2E-02  Session lifecycle
# ---------------------------------------------------------------------------

class TestE2E_02_SessionLifecycle:

    def test_create_session_returns_required_fields(self):
        r = post("/session/create", {
            "patient_name": "E2E Patient A",
            "program": "knee_rehab",
            "exercise": "squat",
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert "session_id"      in d
        assert "patient_id"      in d
        assert d["exercise"]     == "squat"
        assert d["prescribed_reps"] == 10

    def test_get_session_initial_state(self):
        r = post("/session/create", {"patient_name": "E2E Patient B", "program": "knee_rehab", "exercise": "bridge"})
        sid = r.json()["session_id"]

        r2 = get(f"/tool/session/{sid}")
        assert r2.status_code == 200
        d = r2.json()
        assert d["session"]["session_id"] == sid
        assert d["session"]["status"] == "IN_PROGRESS"
        assert d["reps"] == []
        assert d["flags"] == []

    def test_get_session_404_for_unknown(self):
        r = get("/tool/session/nonexistent_abc")
        assert r.status_code == 404

    def test_session_status_becomes_complete_after_all_reps(self):
        r = post("/session/create", {"patient_name": "E2E Completer", "program": "knee_rehab", "exercise": "squat"})
        d = r.json()
        sid = d["session_id"]
        prescribed = d["prescribed_reps"]  # 10

        for i in range(1, prescribed + 1):
            post("/tool/log_rep", {
                "session_id": sid, "rep_number": i,
                "form_state": "GREEN", "quality_score": 90,
                "coaching_cue": "Good", "pain_level": 0,
            })

        r2 = get(f"/tool/session/{sid}")
        assert r2.json()["session"]["status"] == "COMPLETE"


# ---------------------------------------------------------------------------
# E2E-03  Full rep logging + NEAR attestation (the core A→B→C chain)
# ---------------------------------------------------------------------------

class TestE2E_03_LogRepAndAttestation:

    @pytest.fixture(scope="class")
    def session(self):
        r = post("/session/create", {
            "patient_name": "E2E Chain Patient",
            "program":       "knee_rehab",
            "exercise":      "squat",
        })
        assert r.status_code == 200
        return r.json()

    def test_log_rep_returns_ok(self, session):
        r = post("/tool/log_rep", {
            "session_id":   session["session_id"],
            "rep_number":   1,
            "form_state":   "GREEN",
            "quality_score": 92,
            "coaching_cue": "Perfect squat",
            "pain_level":   0,
        })
        assert r.status_code == 200
        d = r.json()
        assert d["ok"] is True
        assert d["recorded"] is True

    def test_log_rep_appears_in_session(self, session):
        sid = session["session_id"]
        post("/tool/log_rep", {
            "session_id": sid, "rep_number": 2,
            "form_state": "YELLOW", "quality_score": 68,
            "coaching_cue": "Watch your knees", "pain_level": 1,
        })
        r = get(f"/tool/session/{sid}")
        reps = r.json()["reps"]
        rep_numbers = [rep["rep_number"] for rep in reps]
        assert 2 in rep_numbers

    def test_attestation_lands_after_log_rep(self, session):
        """Async B→C attest must land within ATTEST_WAIT seconds."""
        sid = session["session_id"]
        post("/tool/log_rep", {
            "session_id": sid, "rep_number": 3,
            "form_state": "GREEN", "quality_score": 95,
            "coaching_cue": "Excellent", "pain_level": 0,
        })

        # Poll until attestation appears
        deadline = time.time() + ATTEST_WAIT
        attestations = []
        while time.time() < deadline:
            r = get(f"/tool/session/{sid}")
            attestations = r.json().get("attestations", [])
            if any(a["rep_number"] == 3 for a in attestations):
                break
            time.sleep(0.5)

        assert any(a["rep_number"] == 3 for a in attestations), \
            f"Attestation for rep 3 did not land within {ATTEST_WAIT}s. Got: {attestations}"

    def test_attestation_has_correct_shape(self, session):
        """Attestation object must match §3 of API_CONTRACT.md."""
        sid = session["session_id"]
        time.sleep(ATTEST_WAIT)
        r = get(f"/tool/session/{sid}")
        attestations = r.json().get("attestations", [])
        assert len(attestations) > 0, "No attestations found"

        att = attestations[0]
        for field in ["session_id", "rep_number", "session_hash", "quality_score",
                      "form_state", "tx_hash", "block_height", "status", "timestamp"]:
            assert field in att, f"Attestation missing field: {field}"

        assert att["status"] == "confirmed"
        assert att["tx_hash"].startswith("mock_")   # mock NEAR mode
        assert len(att["session_hash"]) == 64       # SHA-256 hex

    def test_log_rep_dedup_last_write_wins(self, session):
        """Sending same rep_number twice should keep the last value."""
        sid = session["session_id"]
        post("/tool/log_rep", {
            "session_id": sid, "rep_number": 9,
            "form_state": "GREEN", "quality_score": 90,
            "coaching_cue": "Good", "pain_level": 0,
        })
        post("/tool/log_rep", {
            "session_id": sid, "rep_number": 9,
            "form_state": "RED", "quality_score": 20,
            "coaching_cue": "Stop", "pain_level": 8,
        })
        r = get(f"/tool/session/{sid}")
        reps = {rep["rep_number"]: rep for rep in r.json()["reps"]}
        assert reps[9]["form_state"] == "RED"
        assert reps[9]["quality_score"] == 20

    def test_log_rep_invalid_session_returns_404(self):
        r = post("/tool/log_rep", {
            "session_id": "fake_session_xyz",
            "rep_number": 1, "form_state": "GREEN",
            "quality_score": 90, "coaching_cue": "Good", "pain_level": 0,
        })
        assert r.status_code == 404


# ---------------------------------------------------------------------------
# E2E-04  Flag for PT + SSE event
# ---------------------------------------------------------------------------

class TestE2E_04_FlagForPT:

    @pytest.fixture(scope="class")
    def session(self):
        r = post("/session/create", {
            "patient_name": "E2E Flag Patient",
            "program": "knee_rehab",
            "exercise": "lunge",
        })
        return r.json()

    def test_flag_returns_ok_and_flag_id(self, session):
        r = post("/tool/flag_for_pt", {
            "session_id": session["session_id"],
            "type":       "pain_spike",
            "rep_number": 4,
            "pain_level": 7,
            "notes":      "E2E test — sharp knee pain",
        })
        assert r.status_code == 200
        d = r.json()
        assert d["ok"] is True
        assert d["flag_id"].startswith("flag_")

    def test_flag_appears_in_session(self, session):
        sid = session["session_id"]
        r = get(f"/tool/session/{sid}")
        flags = r.json()["flags"]
        assert len(flags) >= 1
        flag = flags[0]
        assert flag["type"] == "pain_spike"
        assert flag["pain_level"] == 7

    def test_flag_has_correct_shape(self, session):
        sid = session["session_id"]
        r = get(f"/tool/session/{sid}")
        flag = r.json()["flags"][0]
        for field in ["flag_id", "session_id", "type"]:
            assert field in flag, f"Flag missing field: {field}"

    def test_multiple_flags_accumulate(self, session):
        sid = session["session_id"]
        post("/tool/flag_for_pt", {"session_id": sid, "type": "form_breakdown", "rep_number": 5})
        post("/tool/flag_for_pt", {"session_id": sid, "type": "patient_request", "rep_number": 6})
        r = get(f"/tool/session/{sid}")
        assert len(r.json()["flags"]) >= 3

    def test_flag_invalid_session_returns_404(self):
        r = post("/tool/flag_for_pt", {
            "session_id": "no_such_session",
            "type": "pain_spike",
        })
        assert r.status_code == 404

    def test_sse_stream_endpoint_is_reachable(self):
        """GET /pt/stream must respond with text/event-stream content type."""
        r = requests.get(backend("/pt/stream"), stream=True, timeout=5)
        assert r.status_code == 200
        assert "text/event-stream" in r.headers.get("content-type", "")
        r.close()

    def test_sse_delivers_flag_event(self, session):
        """Flag SSE event must arrive on /pt/stream within 3 seconds."""
        sid = session["session_id"]
        received = []

        def listen():
            try:
                with requests.get(backend("/pt/stream"), stream=True, timeout=6) as resp:
                    for line in resp.iter_lines(decode_unicode=True):
                        if line.startswith("event: flag"):
                            received.append("flag")
                            break
                        if line.startswith("event: "):
                            received.append(line)
            except Exception:
                pass

        t = threading.Thread(target=listen, daemon=True)
        t.start()
        time.sleep(0.3)  # let listener connect

        post("/tool/flag_for_pt", {
            "session_id": sid,
            "type": "pain_spike",
            "rep_number": 10,
            "pain_level": 9,
            "notes": "SSE E2E test",
        })

        t.join(timeout=5)
        assert "flag" in received, "flag SSE event was not received within 5s"


# ---------------------------------------------------------------------------
# E2E-05  Patient list and history
# ---------------------------------------------------------------------------

class TestE2E_05_PatientHistory:

    @pytest.fixture(scope="class")
    def patient(self):
        """Create a patient with 2 sessions and some reps."""
        r1 = post("/session/create", {"patient_name": "E2E History Patient", "program": "knee_rehab", "exercise": "squat"})
        sid1 = r1.json()["session_id"]
        pid  = r1.json()["patient_id"]

        # Session 1 — 8 GREEN, 2 RED  → 80% green
        for i in range(1, 9):
            post("/tool/log_rep", {"session_id": sid1, "rep_number": i, "form_state": "GREEN", "quality_score": 90, "coaching_cue": "Good", "pain_level": 0})
        for i in range(9, 11):
            post("/tool/log_rep", {"session_id": sid1, "rep_number": i, "form_state": "RED", "quality_score": 20, "coaching_cue": "Stop", "pain_level": 7})

        r2 = post("/session/create", {"patient_name": "E2E History Patient", "program": "knee_rehab", "exercise": "squat"})
        sid2 = r2.json()["session_id"]

        # Session 2 — all GREEN → 100%
        for i in range(1, 11):
            post("/tool/log_rep", {"session_id": sid2, "rep_number": i, "form_state": "GREEN", "quality_score": 95, "coaching_cue": "Excellent", "pain_level": 0})

        return {"patient_id": pid, "sid1": sid1, "sid2": sid2}

    def test_patient_appears_in_list(self, patient):
        r = get("/tool/patients")
        assert r.status_code == 200
        names = [p["name"] for p in r.json()["patients"]]
        assert "E2E History Patient" in names

    def test_patient_list_has_required_fields(self):
        r = get("/tool/patients")
        for p in r.json()["patients"]:
            for field in ["patient_id", "name", "compliance_score", "last_session"]:
                assert field in p, f"patients list item missing field: {field}"

    def test_patient_history_has_both_sessions(self, patient):
        r = get(f"/tool/patient/{patient['patient_id']}/history")
        assert r.status_code == 200
        sids = [s["session_id"] for s in r.json()["sessions"]]
        assert patient["sid1"] in sids
        assert patient["sid2"] in sids

    def test_patient_history_trend_is_improving(self, patient):
        """Session 2 (100%) > Session 1 (80%) → trend = improving."""
        r = get(f"/tool/patient/{patient['patient_id']}/history")
        assert r.json()["trend"] == "improving"

    def test_patient_history_compliance_score_in_range(self, patient):
        r = get(f"/tool/patient/{patient['patient_id']}/history")
        score = r.json()["compliance_score"]
        assert 0 <= score <= 100

    def test_patient_history_404_for_unknown(self):
        r = get("/tool/patient/no_such_patient_xyz/history")
        assert r.status_code == 404


# ---------------------------------------------------------------------------
# E2E-06  NEAR mock server — direct verification
# ---------------------------------------------------------------------------

class TestE2E_06_NEARMockDirect:

    @pytest.fixture(scope="class")
    def attested_session(self):
        """Create a session on B, log 3 reps, wait for attestations."""
        r = post("/session/create", {"patient_name": "E2E NEAR Patient", "program": "knee_rehab", "exercise": "clamshell"})
        sid = r.json()["session_id"]
        form_states = ["GREEN", "YELLOW", "GREEN"]
        for i, fs in enumerate(form_states, 1):
            post("/tool/log_rep", {"session_id": sid, "rep_number": i, "form_state": fs,
                                   "quality_score": 90 if fs == "GREEN" else 60,
                                   "coaching_cue": "test", "pain_level": 0})
        time.sleep(ATTEST_WAIT)
        return sid

    def test_near_verify_session_confirms_reps(self, attested_session):
        r = post("/near/verify_session", {"session_id": attested_session}, base=NEAR_URL)
        assert r.status_code == 200
        d = r.json()
        assert d["total_reps"] == 3
        assert d["green_count"] == 2
        assert d["yellow_count"] == 1
        assert isinstance(d["compliant"], bool)

    def test_near_verify_session_compliant_rule(self, attested_session):
        """compliant == (green_pct >= 80) per API_CONTRACT.md §0."""
        r = post("/near/verify_session", {"session_id": attested_session}, base=NEAR_URL)
        d = r.json()
        expected_compliant = d["green_pct"] >= 80
        assert d["compliant"] == expected_compliant

    def test_near_verify_session_has_tx_hashes(self, attested_session):
        r = post("/near/verify_session", {"session_id": attested_session}, base=NEAR_URL)
        d = r.json()
        assert len(d["tx_hashes"]) == 3
        for tx in d["tx_hashes"]:
            assert tx.startswith("mock_")

    def test_near_attest_is_idempotent(self, attested_session):
        """Re-sending same rep must return the same tx_hash."""
        payload = {
            "session_id": attested_session,
            "rep_number": 1,
            "session_hash": "a" * 64,
            "quality_score": 90,
            "form_state": "GREEN",
        }
        r1 = post("/near/attest_rep", payload, base=NEAR_URL)
        r2 = post("/near/attest_rep", payload, base=NEAR_URL)
        assert r1.json()["tx_hash"] == r2.json()["tx_hash"]


# ---------------------------------------------------------------------------
# E2E-07  Full happy-path session (10-rep complete session end-to-end)
# ---------------------------------------------------------------------------

class TestE2E_07_FullHappyPath:

    def test_complete_10_rep_session(self):
        """
        Full flow:
          1. Create session
          2. Log 10 reps (mixed GREEN/YELLOW/RED)
          3. Verify session COMPLETE
          4. Verify attestations landed on both B and C
          5. Verify compliance score computed correctly
        """
        # 1. Create
        r = post("/session/create", {
            "patient_name": "E2E Full Patient",
            "program": "knee_rehab",
            "exercise": "squat",
        })
        assert r.status_code == 200
        d = r.json()
        sid = d["session_id"]
        pid = d["patient_id"]
        assert d["prescribed_reps"] == 10

        # 2. Log 10 reps: 8 GREEN, 1 YELLOW, 1 RED
        form_states = ["GREEN"] * 8 + ["YELLOW", "RED"]
        for i, fs in enumerate(form_states, 1):
            r = post("/tool/log_rep", {
                "session_id": sid,
                "rep_number": i,
                "form_state": fs,
                "quality_score": 90 if fs == "GREEN" else (60 if fs == "YELLOW" else 20),
                "coaching_cue": "E2E test cue",
                "pain_level": 0 if fs != "RED" else 5,
            })
            assert r.status_code == 200
            assert r.json()["ok"] is True

        # 3. Session should be COMPLETE
        r = get(f"/tool/session/{sid}")
        assert r.status_code == 200
        session_data = r.json()
        assert session_data["session"]["status"] == "COMPLETE"
        assert len(session_data["reps"]) == 10

        # 4. Wait for all attestations
        time.sleep(ATTEST_WAIT)
        r = get(f"/tool/session/{sid}")
        attestations = r.json()["attestations"]
        assert len(attestations) == 10, f"Expected 10 attestations, got {len(attestations)}"

        # Verify each attestation shape
        for att in attestations:
            assert att["status"] == "confirmed"
            assert att["tx_hash"].startswith("mock_")
            assert att["form_state"] in ("GREEN", "YELLOW", "RED")
            assert 0 <= att["quality_score"] <= 100

        # 5. Verify compliance on C
        r = post("/near/verify_session", {"session_id": sid}, base=NEAR_URL)
        d = r.json()
        assert d["total_reps"] == 10
        assert d["green_count"] == 8
        assert d["yellow_count"] == 1
        assert d["red_count"] == 1
        assert d["green_pct"] == 80
        assert d["compliant"] is True   # 80 >= 80

        # 6. Patient history reflects session
        r = get(f"/tool/patient/{pid}/history")
        assert r.status_code == 200
        sessions = r.json()["sessions"]
        assert any(s["session_id"] == sid for s in sessions)
