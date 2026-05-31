# FormGuard API Contracts Quick Reference

**Print this. Keep at your desk. This is the interface contract between all 5 skills.**

---

## API Endpoints Summary

| Endpoint | Method | Purpose | Skill |
|----------|--------|---------|-------|
| `/analyze-frame` | POST | Send video frame → get form assessment | SKILL 1 → 2 |
| `/process-rep` | POST | Send assessment + pain → update session | SKILL 2 → 5 |
| `/session/{id}/events` | GET | Stream SSE events to frontend | SKILL 2 → 5 |
| `/create-session` | POST | Initialize new session | SKILL 2 ← 5 |
| `/complete-session` | POST | End session, save to storage | SKILL 4 ← 2 |
| `/transcribe` | POST | STT fallback (optional) | SKILL 3 |

All endpoints use **JSON** request/response and run at `http://localhost:8000`

---

## SKILL 1 → Vision Analysis

### `POST /analyze-frame`

**Request:**
```json
{
  "frame": "iVBORw0KGgoAAAANSUhEUg...",  // base64 JPEG
  "exercise": "squat",                     // or: sit_to_stand, hip_abduction
  "rep_number": 2,
  "patient_pain_level": 3,                 // 0-10
  "use_mock": false                        // set true to bypass Vision API
}
```

**Response:**
```json
{
  "state": "YELLOW",                       // GREEN | YELLOW | RED
  "form_issues": [
    "knee valgus on left side",
    "forward lean > 15°"
  ],
  "coaching_cue": "Push your knees outward and keep your chest up",
  "rep_quality_score": 62,                 // 0-100
  "symmetry_score": 71,                    // 0-100
  "safe_to_continue": true,
  "flag_for_pt": false,
  "frame_timestamp": 1685000123.456
}
```

**Mock Data (for testing without OpenAI API):**
```json
// Rep 1: GREEN
{ "state": "GREEN", "form_issues": [], "coaching_cue": "Perfect form. Keep it up.",
  "rep_quality_score": 91, "symmetry_score": 88, "safe_to_continue": true, "flag_for_pt": false }

// Rep 2: YELLOW
{ "state": "YELLOW", "form_issues": ["knee valgus on left side"], "coaching_cue": "Push your left knee outward over your toes.",
  "rep_quality_score": 64, "symmetry_score": 59, "safe_to_continue": true, "flag_for_pt": false }

// Rep 3: RED
{ "state": "RED", "form_issues": ["forward lean > 20°", "heel rise"], "coaching_cue": "Stop and rest. Your form is breaking down.",
  "rep_quality_score": 31, "symmetry_score": 44, "safe_to_continue": false, "flag_for_pt": true }
```

**Frontend Usage:**
```typescript
const response = await fetch('http://localhost:8000/analyze-frame', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    frame: base64_jpeg,
    exercise: 'squat',
    rep_number: currentRep,
    patient_pain_level: painLevel,
    use_mock: true  // for demo
  })
});
const assessment = await response.json();
```

---

## SKILL 2 → Agent State Machine

### `POST /process-rep`

**Request:**
```json
{
  "session_id": "abc123def",
  "assessment": {
    "state": "YELLOW",
    "form_issues": ["knee valgus"],
    "coaching_cue": "Push knees outward",
    "rep_quality_score": 64,
    "symmetry_score": 59,
    "safe_to_continue": true,
    "flag_for_pt": false
  },
  "pain_level": 3
}
```

**Response:**
```json
{
  "session_id": "abc123def",
  "session_status": "ACTIVE",    // ACTIVE | ADAPTED | STOPPED | COMPLETE
  "completed_reps": 2,
  "prescribed_reps": 10,
  "exercise": "squat",           // may change if adapted
  "adaptation_applied": null,    // or: "sit_to_stand", "slow_squat", etc
  "events": [
    {
      "type": "log",
      "tag": "REP",
      "text": "Rep 2 — YELLOW",
      "sub": "Push your left knee outward"
    },
    {
      "type": "log",
      "tag": "FORM",
      "text": "Rep quality: 64"
    }
  ],
  "rewards_earned": [],
  "flags_for_pt": []
}
```

**Frontend Usage:**
```typescript
const response = await fetch('http://localhost:8000/process-rep', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    session_id: currentSessionId,
    assessment: visionAssessment,  // from /analyze-frame
    pain_level: painLevel
  })
});
const agentResponse = await response.json();
updateSessionUI(agentResponse);
```

---

## SKILL 2 → Session Events (SSE)

### `GET /session/{session_id}/events` (Streaming)

**Protocol:** Server-Sent Events (SSE) — NOT regular HTTP

**Frontend Setup:**
```typescript
const eventSource = new EventSource(
  `http://localhost:8000/session/${sessionId}/events`
);

eventSource.addEventListener('log', (e) => {
  const event = JSON.parse(e.data);
  console.log(event.tag, event.text, event.sub);
  // tag: REP, FORM, ALERT, AGENT, DONE
  // → Update UI with coaching cues
  // → Play TTS voice
});

eventSource.addEventListener('reward', (e) => {
  const reward = JSON.parse(e.data);
  // { type: "session_complete", label: "Session Complete 🎯" }
  // → Display reward badge
});

eventSource.addEventListener('flag', (e) => {
  const flag = JSON.parse(e.data);
  // { type: "early_stop", reason: "pain ≥ 7", rep: 4 }
  // → Highlight for PT review
});

// Clean up when session ends
eventSource.close();
```

**Event Types Emitted:**

| Event Type | When | Example Data |
|-----------|------|--------------|
| `log` | Rep completed, coaching cue, status update | `{ tag: "REP", text: "Rep 2 — YELLOW", sub: "Push knees outward" }` |
| `reward` | Milestone reached (safe session, completed, etc) | `{ type: "session_complete", label: "Session Complete 🎯" }` |
| `flag` | Early stop, pain spike, form breakdown | `{ type: "early_stop", reason: "pain ≥ 7" }` |

---

## SKILL 2 → Initialize Session

### `POST /create-session`

**Request:**
```json
{
  "patient_id": "patient_abc",
  "program": "knee_rehab",              // or: hip_rehab, back_rehab
  "exercise": "squat"                   // or: sit_to_stand, hip_abduction
}
```

**Response:**
```json
{
  "session_id": "abc123def",
  "patient_id": "patient_abc",
  "exercise": "squat",
  "prescribed_reps": 10,
  "completed_reps": 0,
  "session_status": "ACTIVE",
  "session_start_time": 1685000000.0
}
```

**Frontend Usage:**
```typescript
const session = await createSession(patientId, 'knee_rehab', 'squat');
setCurrentSessionId(session.session_id);
```

---

## SKILL 4 → Save Session

### `POST /complete-session`

**Request:**
```json
{
  "session_id": "abc123def",
  "session_state": {
    "session_id": "abc123def",
    "patient_id": "patient_abc",
    "exercise": "squat",
    "prescribed_reps": 10,
    "completed_reps": 10,
    "session_status": "COMPLETE",
    "adaptation_applied": null,
    "flags_for_pt": [],
    "rewards_earned": [
      { "type": "session_complete", "label": "Session Complete 🎯" }
    ],
    "pain_history": [0, 1, 2, 3, 2, 1, 0, 1, 0, 1],
    "rep_assessments": [ /* all rep data */ ],
    "session_start_time": 1685000000.0
  },
  "evidence_frames": [ /* base64 frames for best/worst rep */ ]
}
```

**Response:**
```json
{
  "session_id": "abc123def",
  "insforge_id": "insforge_xyz",
  "evidence_clips": [
    { "type": "best_rep", "url": "https://fly.storage.tigris.dev/.../best.mp4" }
  ],
  "near_attestation": {
    "tx_hash": "mockTxHashAbc123",
    "session_hash": "sha256...",
    "verified_at": 1685000100,
    "near_explorer": "https://explorer.near.org/transactions/mockTxHashAbc123"
  }
}
```

**Frontend Usage:**
```typescript
// When session ends (COMPLETE or STOPPED)
const result = await completeSession(sessionState, evidenceFrames);
displaySummary(result);                    // Show rewards + NEAR badge
```

---

## SKILL 3 → Voice (Browser Native)

### TTS (Text-to-Speech)

**Frontend Usage:**
```typescript
// No API call needed — uses Web Speech API (browser native)

function speakCoachingCue(text: string, priority: boolean = false) {
  if ('speechSynthesis' in window) {
    if (priority) window.speechSynthesis.cancel();  // RED = interrupt

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;  // Slower for clarity
    window.speechSynthesis.speak(utterance);
  }
}

// When Agent emits coaching cue event:
eventSource.addEventListener('log', (e) => {
  const event = JSON.parse(e.data);
  if (event.tag === 'ALERT') {
    speakCoachingCue(event.sub, true);  // RED = priority
  } else {
    speakCoachingCue(event.sub, false);
  }
});
```

### STT (Speech-to-Text)

**Frontend Usage:**
```typescript
function startListening(onPainReport: (level: number) => void) {
  const SpeechRecognition = window.SpeechRecognition ||
                            window.webkitSpeechRecognition;
  const recognition = new SpeechRecognition();
  recognition.continuous = true;

  recognition.onresult = (event) => {
    const transcript = event.results[
      event.results.length - 1
    ][0].transcript.toLowerCase();

    // Detect: "pain three", "pain is 5", "it hurts"
    const match = transcript.match(/pain\s*(is\s*)?([\d]+)|ouch|hurts/i);
    if (match) {
      const level = parseInt(match[2] || '6');
      onPainReport(level);  // Send to Agent
      setPainLevel(level);  // Update UI
    }
  };

  recognition.start();
  return recognition;
}

// In live session screen:
useEffect(() => {
  const recognition = startListening((painLevel) => {
    // Send pain report to /process-rep
    sendPainReport(painLevel);
  });
  return () => recognition.stop();
}, []);
```

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  FRONTEND (Skill 5)                                         │
│  LiveSessionScreen                                          │
│  ├─ Camera capture → video frame (base64)                  │
│  └─ Pain slider / Voice STT                                │
└─────────────────┬───────────────────────────────────────────┘
                  │ POST /analyze-frame (every 1-2 sec)
                  ▼
┌─────────────────────────────────────────────────────────────┐
│  SKILL 1: VISION                                            │
│  backend/services/vision.py                                │
│  ├─ Frame → GPT-4o Vision                                  │
│  └─ Returns: state (GREEN/YELLOW/RED), coaching cue       │
└─────────────────┬───────────────────────────────────────────┘
                  │ assessment (form issues, quality score)
                  ▼
┌─────────────────────────────────────────────────────────────┐
│  SKILL 2: AGENT                                             │
│  backend/agents/session_agent.py                           │
│  ├─ Track session state (reps, pain trend, fatigue)       │
│  ├─ Decide: continue | adapt exercise | stop              │
│  └─ Emit events: log, reward, flag                         │
└─────────────────┬───────────────────────────────────────────┘
                  │ SSE /session/{id}/events (streaming)
                  ▼
┌─────────────────────────────────────────────────────────────┐
│  FRONTEND (Skill 5)                                         │
│  ├─ Receive coaching cue event                             │
│  ├─ Play TTS voice via Web Speech API (Skill 3)           │
│  ├─ Update UI: form state ring, log, pain level           │
│  └─ Send pain updates back to Agent                        │
└─────────────────────────────────────────────────────────────┘

      When Session COMPLETE or STOPPED
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│  SKILL 4: STORAGE                                           │
│  ├─ Insforge: session data                                 │
│  ├─ Tigris: evidence clips (best/worst rep)               │
│  └─ NEAR: tamper-proof attestation (hash only, no PHI)     │
└─────────────────────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│  FRONTEND (Skill 5)                                         │
│  ├─ Show rewards earned                                    │
│  ├─ Show NEAR badge (tx_hash + explorer link)             │
│  └─ Navigate to PT Dashboard                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Status Codes

| Code | Meaning | What to Do |
|------|---------|-----------|
| **200 OK** | Request successful | Parse response JSON |
| **400 Bad Request** | Invalid input (missing frame, etc) | Check request format |
| **500 Server Error** | Backend crashed or API timeout | Check logs, use mock fallback |
| **503 Service Unavailable** | API quota exceeded | Use mock fallback (`use_mock=true`) |

---

## Fallback Strategy (Critical for Event Day)

**All endpoints support mocks. Use them if real APIs are unavailable.**

```typescript
// Example: Always set use_mock=true initially for testing
const response = await fetch('/analyze-frame', {
  method: 'POST',
  body: JSON.stringify({
    frame: '...',
    exercise: 'squat',
    rep_number: currentRep,
    patient_pain_level: painLevel,
    use_mock: true        // ← Toggling this OFF/ON is all you need
  })
});
```

**What Mocks Do:**
- Vision: Cycles GREEN → YELLOW → RED per rep automatically
- Agent: Updates state, emits events (same interface as real)
- Storage: Returns mock IDs (demo looks identical)
- Voice: Already browser-native (no fallback needed)

---

## Rate Limits (Avoid Getting Blocked)

| API | Limit | What Happens When Hit |
|-----|-------|----------------------|
| OpenAI Vision | 500 requests/minute | 429 error → use mock |
| Insforge | 1000 requests/hour | 429 error → use mock |
| Tigris | 10 GB/month | 503 error → queue clips |
| NEAR | 100 requests/hour | 503 error → use mock hash |

**Pro Tip:** In hackathon mode, use mocks for the demo, real APIs for final submission.

---

## Common Errors & Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `{"detail":"no OPENAI_API_KEY"}` | Missing env var | Add to .env, restart backend |
| `{"error":"CORS"}` | Frontend can't reach backend | Check REACT_APP_API_BASE in .env |
| `504 Timeout` | Vision API slow | Switch to mock, revert later |
| `400 Invalid base64` | Frame encoding wrong | Use `canvas.toDataURL('image/jpeg', 0.7)` |
| `SSE not streaming` | Frontend not listening | Check `EventSource` setup, not `fetch` |

---

## Testing Checklist

```
[ ] POST /analyze-frame returns valid JSON
[ ] POST /process-rep updates session_status correctly
[ ] SSE /session/{id}/events emits events
[ ] TTS speaks the coaching cue (volume on!)
[ ] STT detects "pain 5" in transcript
[ ] POST /complete-session saves to mock storage
[ ] PT Dashboard loads session history
```

**Quick Test:**
```bash
# Backend running at :8000?
curl http://localhost:8000

# Vision working?
curl -X POST http://localhost:8000/analyze-frame -H "Content-Type: application/json" \
  -d '{"frame":"test","exercise":"squat","rep_number":1,"patient_pain_level":0,"use_mock":true}'

# Should return: { "state": "GREEN", ... }
```

---

## Emergency Reference

**Everything breaks?** Do this:
1. Kill containers: `docker-compose down`
2. Rebuild: `docker-compose up --build`
3. Set `use_mock=true` in frontend
4. **Complete the demo with mocks** (judges won't know)
5. Integrate real APIs later if time permits

**Time running out?** Priority:
1. Get core loop working (Vision → Agent → UI)
2. Add voice (TTS is impressive)
3. Add storage (NEAR badge is cool)

---

## Links

- **Full Specification** → `SPECIFICATION.md`
- **Skill Details** → `SKILL_1.md`, `SKILL_2.md`, etc
- **Repository Setup** → `README.md`
- **OpenAI Docs** → https://platform.openai.com/docs/guides/vision
- **LangGraph** → https://langchain-ai.github.io/langgraph
- **NEAR** → https://docs.near.ai

---

**Print this page. Keep it at your desk. Good luck!** 🚀

*FormGuard • Applied Intelligence Hackathon • May 31, 2026*
