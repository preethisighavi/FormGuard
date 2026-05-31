"""
Unit tests for FormGuard backend.

Run from formguard-backend/ directory:
    pytest ../tests/test_backend.py -v

Or from repo root:
    cd formguard-backend && pytest ../tests/test_backend.py -v
"""

import sys
import os
import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, patch

# Ensure formguard-backend is on the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "formguard-backend"))

from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _clear_state():
    """Reset all in-memory stores before every test to prevent leakage."""
    from tools import session as session_mod

    # Save originals
    orig_sessions = session_mod.sessions_db.copy()
    orig_patients = session_mod.patients_db.copy()
    orig_name_to_id = session_mod.name_to_id.copy()
    orig_reps = {k: v.copy() for k, v in session_mod.reps_db.items()}
    orig_flags = {k: list(v) for k, v in session_mod.flags_db.items()}
    orig_att = {k: list(v) for k, v in session_mod.attestations_db.items()}

    yield

    # Restore
    session_mod.sessions_db.clear()
    session_mod.sessions_db.update(orig_sessions)
    session_mod.patients_db.clear()
    session_mod.patients_db.update(orig_patients)
    session_mod.name_to_id.clear()
    session_mod.name_to_id.update(orig_name_to_id)
    session_mod.reps_db.clear()
    session_mod.reps_db.update(orig_reps)
    session_mod.flags_db.clear()
    session_mod.flags_db.update(orig_flags)
    session_mod.attestations_db.clear()
    session_mod.attestations_db.update(orig_att)


@pytest.fixture
def client():
    """TestClient with insforge and near calls mocked out."""
    with (
        patch("insforge_client.write_record", new_callable=AsyncMock, return_value={"ok": True, "mock": True}),
        patch("near_client.attest_rep", new_callable=AsyncMock, return_value={"tx_hash": "mock_tx", "block_height": 1, "status": "confirmed"}),
    ):
        import main
        with TestClient(main.app) as c:
            yield c


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

class TestHealth:
    def test_health_returns_ok(self, client):
        r = client.get("/health")
        assert r.status_code == 200
        assert r.json() == {"status": "ok"}


# ---------------------------------------------------------------------------
# Session creation
# ---------------------------------------------------------------------------

class TestCreateSession:
    def test_creates_session_with_known_exercise(self, client):
        r = client.post("/session/create", json={
            "patient_name": "Alice",
            "program": "knee_rehab",
            "exercise": "squat",
        })
        assert r.status_code == 200
        data = r.json()
        assert "session_id" in data
        assert data["exercise"] == "squat"
        assert data["prescribed_reps"] == 10

    def test_creates_session_with_unknown_exercise_uses_default(self, client):
        r = client.post("/session/create", json={
            "patient_name": "Bob",
            "program": "general",
            "exercise": "mystery_move",
        })
        assert r.status_code == 200
        assert r.json()["prescribed_reps"] == 10

    def test_reuses_patient_id_for_same_name(self, client):
        r1 = client.post("/session/create", json={"patient_name": "Carol", "program": "p", "exercise": "bridge"})
        r2 = client.post("/session/create", json={"patient_name": "Carol", "program": "p", "exercise": "lunge"})
        assert r1.json()["patient_id"] == r2.json()["patient_id"]

    def test_different_names_get_different_patient_ids(self, client):
        r1 = client.post("/session/create", json={"patient_name": "Dave", "program": "p", "exercise": "squat"})
        r2 = client.post("/session/create", json={"patient_name": "Eve", "program": "p", "exercise": "squat"})
        assert r1.json()["patient_id"] != r2.json()["patient_id"]

    def test_session_id_is_unique_per_call(self, client):
        r1 = client.post("/session/create", json={"patient_name": "Frank", "program": "p", "exercise": "squat"})
        r2 = client.post("/session/create", json={"patient_name": "Frank", "program": "p", "exercise": "squat"})
        assert r1.json()["session_id"] != r2.json()["session_id"]

    @pytest.mark.parametrize("exercise,expected_reps", [
        ("squat", 10),
        ("lunge", 10),
        ("bridge", 12),
        ("clamshell", 15),
        ("step_up", 10),
        ("leg_press", 12),
    ])
    def test_exercise_rep_map(self, client, exercise, expected_reps):
        r = client.post("/session/create", json={"patient_name": "Test", "program": "p", "exercise": exercise})
        assert r.json()["prescribed_reps"] == expected_reps

    def test_exercise_name_case_insensitive(self, client):
        r = client.post("/session/create", json={"patient_name": "Test", "program": "p", "exercise": "SQUAT"})
        assert r.json()["prescribed_reps"] == 10


# ---------------------------------------------------------------------------
# Get session
# ---------------------------------------------------------------------------

class TestGetSession:
    def _make_session(self, client, name="Pat", exercise="squat"):
        r = client.post("/session/create", json={"patient_name": name, "program": "p", "exercise": exercise})
        return r.json()["session_id"]

    def test_get_existing_session(self, client):
        sid = self._make_session(client)
        r = client.get(f"/tool/session/{sid}")
        assert r.status_code == 200
        data = r.json()
        assert data["session"]["session_id"] == sid
        assert data["session"]["status"] == "IN_PROGRESS"
        assert data["reps"] == []
        assert data["flags"] == []

    def test_get_nonexistent_session_returns_404(self, client):
        r = client.get("/tool/session/does_not_exist")
        assert r.status_code == 404

    def test_session_status_becomes_complete_when_reps_filled(self, client):
        sid = self._make_session(client, exercise="bridge")  # 12 prescribed reps
        from tools import session as sm
        # Directly populate reps_db to simulate completed reps
        for i in range(1, 13):
            sm.reps_db[sid][i] = {"rep_number": i, "form_state": "GREEN", "quality_score": 90, "coaching_cue": "Good", "pain_level": 0, "session_id": sid, "timestamp": 0}
        r = client.get(f"/tool/session/{sid}")
        assert r.json()["session"]["status"] == "COMPLETE"


# ---------------------------------------------------------------------------
# Log rep
# ---------------------------------------------------------------------------

class TestLogRep:
    def _make_session(self, client):
        r = client.post("/session/create", json={"patient_name": "LogPat", "program": "p", "exercise": "squat"})
        return r.json()["session_id"]

    def test_log_rep_success(self, client):
        sid = self._make_session(client)
        r = client.post("/tool/log_rep", json={
            "session_id": sid,
            "rep_number": 1,
            "form_state": "GREEN",
            "quality_score": 95.0,
            "coaching_cue": "Perfect",
            "pain_level": 0,
        })
        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_log_rep_stores_in_reps_db(self, client):
        sid = self._make_session(client)
        client.post("/tool/log_rep", json={
            "session_id": sid,
            "rep_number": 2,
            "form_state": "YELLOW",
            "quality_score": 70.0,
            "coaching_cue": "Watch knee",
            "pain_level": 1,
        })
        from tools import session as sm
        assert 2 in sm.reps_db[sid]
        assert sm.reps_db[sid][2]["form_state"] == "YELLOW"

    def test_log_rep_dedup_last_write_wins(self, client):
        sid = self._make_session(client)
        payload = {"session_id": sid, "rep_number": 1, "form_state": "GREEN", "quality_score": 90.0, "coaching_cue": "Good", "pain_level": 0}
        client.post("/tool/log_rep", json=payload)
        # Overwrite same rep with different data
        payload2 = {**payload, "form_state": "RED", "quality_score": 30.0}
        client.post("/tool/log_rep", json=payload2)
        from tools import session as sm
        assert sm.reps_db[sid][1]["form_state"] == "RED"
        assert sm.reps_db[sid][1]["quality_score"] == 30.0

    def test_log_rep_invalid_session_returns_404(self, client):
        r = client.post("/tool/log_rep", json={
            "session_id": "fake_session",
            "rep_number": 1,
            "form_state": "GREEN",
            "quality_score": 90.0,
            "coaching_cue": "Good",
            "pain_level": 0,
        })
        assert r.status_code == 404

    def test_log_rep_uses_provided_timestamp(self, client):
        sid = self._make_session(client)
        ts = 1700000000
        client.post("/tool/log_rep", json={
            "session_id": sid,
            "rep_number": 1,
            "form_state": "GREEN",
            "quality_score": 90.0,
            "coaching_cue": "Good",
            "pain_level": 0,
            "timestamp": ts,
        })
        from tools import session as sm
        assert sm.reps_db[sid][1]["timestamp"] == ts


# ---------------------------------------------------------------------------
# Flag for PT
# ---------------------------------------------------------------------------

class TestFlagForPT:
    def _make_session(self, client):
        r = client.post("/session/create", json={"patient_name": "FlagPat", "program": "p", "exercise": "squat"})
        return r.json()["session_id"]

    def test_flag_success(self, client):
        sid = self._make_session(client)
        r = client.post("/tool/flag_for_pt", json={
            "session_id": sid,
            "type": "pain_spike",
            "rep_number": 3,
            "pain_level": 5,
            "notes": "Sharp knee pain",
        })
        assert r.status_code == 200
        data = r.json()
        assert data["ok"] is True
        assert data["flag_id"].startswith("flag_")

    def test_flag_stored_in_flags_db(self, client):
        sid = self._make_session(client)
        client.post("/tool/flag_for_pt", json={
            "session_id": sid,
            "type": "form_break",
            "rep_number": 2,
            "pain_level": 2,
        })
        from tools import session as sm
        assert len(sm.flags_db[sid]) == 1
        assert sm.flags_db[sid][0]["type"] == "form_break"

    def test_multiple_flags_accumulate(self, client):
        sid = self._make_session(client)
        for i in range(3):
            client.post("/tool/flag_for_pt", json={"session_id": sid, "type": "pain_spike", "rep_number": i})
        from tools import session as sm
        assert len(sm.flags_db[sid]) == 3

    def test_flag_invalid_session_returns_404(self, client):
        r = client.post("/tool/flag_for_pt", json={"session_id": "no_such", "type": "pain_spike"})
        assert r.status_code == 404

    def test_flag_uses_provided_timestamp(self, client):
        sid = self._make_session(client)
        ts = 1700000000
        client.post("/tool/flag_for_pt", json={"session_id": sid, "type": "pain_spike", "timestamp": ts})
        from tools import session as sm
        assert sm.flags_db[sid][0]["timestamp"] == ts


# ---------------------------------------------------------------------------
# Patient list
# ---------------------------------------------------------------------------

class TestListPatients:
    def test_list_patients_includes_demo(self, client):
        r = client.get("/tool/patients")
        assert r.status_code == 200
        names = [p["name"] for p in r.json()["patients"]]
        assert "Demo Patient" in names

    def test_new_patient_appears_after_session_create(self, client):
        client.post("/session/create", json={"patient_name": "New Patient", "program": "p", "exercise": "squat"})
        r = client.get("/tool/patients")
        names = [p["name"] for p in r.json()["patients"]]
        assert "New Patient" in names

    def test_patient_has_required_fields(self, client):
        r = client.get("/tool/patients")
        for p in r.json()["patients"]:
            assert "patient_id" in p
            assert "name" in p
            assert "compliance_score" in p


# ---------------------------------------------------------------------------
# Patient history
# ---------------------------------------------------------------------------

class TestPatientHistory:
    def test_history_for_demo_patient(self, client):
        r = client.get("/tool/patients")
        demo = next(p for p in r.json()["patients"] if p["name"] == "Demo Patient")
        pid = demo["patient_id"]

        r2 = client.get(f"/tool/patient/{pid}/history")
        assert r2.status_code == 200
        data = r2.json()
        assert "sessions" in data
        assert "compliance_score" in data
        assert data["trend"] in ("improving", "declining", "stable")

    def test_history_404_for_unknown_patient(self, client):
        r = client.get("/tool/patient/nobody/history")
        assert r.status_code == 404

    def test_compliance_score_is_percentage(self, client):
        r = client.get("/tool/patients")
        demo = next(p for p in r.json()["patients"] if p["name"] == "Demo Patient")
        r2 = client.get(f"/tool/patient/{demo['patient_id']}/history")
        score = r2.json()["compliance_score"]
        assert 0 <= score <= 100


# ---------------------------------------------------------------------------
# attest_rep — compute_hash
# ---------------------------------------------------------------------------

class TestComputeHash:
    def test_hash_is_deterministic(self):
        from tools.attest_rep import compute_hash
        h1 = compute_hash("s1", "p1", 1, 90.0, "GREEN")
        h2 = compute_hash("s1", "p1", 1, 90.0, "GREEN")
        assert h1 == h2

    def test_hash_changes_with_different_inputs(self):
        from tools.attest_rep import compute_hash
        h1 = compute_hash("s1", "p1", 1, 90.0, "GREEN")
        h2 = compute_hash("s1", "p1", 1, 90.0, "RED")
        assert h1 != h2

    def test_hash_is_64_char_hex(self):
        from tools.attest_rep import compute_hash
        h = compute_hash("s", "p", 1, 50.0, "YELLOW")
        assert len(h) == 64
        int(h, 16)  # raises if not valid hex

    def test_hash_encodes_all_fields(self):
        from tools.attest_rep import compute_hash
        base = ("s1", "p1", 1, 90.0, "GREEN")
        h_base = compute_hash(*base)
        for i, alt in enumerate([("s2", "p1", 1, 90.0, "GREEN"), ("s1", "p2", 1, 90.0, "GREEN"),
                                   ("s1", "p1", 2, 90.0, "GREEN"), ("s1", "p1", 1, 80.0, "GREEN"),
                                   ("s1", "p1", 1, 90.0, "YELLOW")]):
            assert compute_hash(*alt) != h_base, f"Field {i} did not affect hash"


# ---------------------------------------------------------------------------
# insforge_client — mock/fallback behaviour
# ---------------------------------------------------------------------------

class TestInsforgeClient:
    @pytest.mark.asyncio
    async def test_write_record_returns_mock_when_no_api_key(self):
        import insforge_client
        original = insforge_client.INSFORGE_API_KEY
        insforge_client.INSFORGE_API_KEY = ""
        try:
            result = await insforge_client.write_record("test_col", "doc1", {"x": 1})
            assert result["mock"] is True
            assert result["id"] == "doc1"
        finally:
            insforge_client.INSFORGE_API_KEY = original

    @pytest.mark.asyncio
    async def test_get_collection_returns_empty_list_when_no_api_key(self):
        import insforge_client
        original = insforge_client.INSFORGE_API_KEY
        insforge_client.INSFORGE_API_KEY = ""
        try:
            result = await insforge_client.get_collection("test_col")
            assert result == []
        finally:
            insforge_client.INSFORGE_API_KEY = original


# ---------------------------------------------------------------------------
# near_client — mock/fallback behaviour
# ---------------------------------------------------------------------------

class TestNearClient:
    @pytest.mark.asyncio
    async def test_attest_rep_returns_mock_when_no_endpoint(self):
        import near_client
        original = near_client.NEAR_ENDPOINT
        near_client.NEAR_ENDPOINT = ""
        try:
            result = await near_client.attest_rep({
                "session_id": "s1",
                "rep_number": 1,
                "session_hash": "abc123",
                "quality_score": 90.0,
                "form_state": "GREEN",
            })
            assert result["status"] == "confirmed"
            assert "tx_hash" in result
            assert "block_height" in result
        finally:
            near_client.NEAR_ENDPOINT = original
