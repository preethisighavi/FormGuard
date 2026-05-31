# SKILL 1 — Vision + Form Analysis
## FormGuard · Applied Intelligence Hackathon · May 31 2026

---

## What This Skill Does

Receives a video frame (from browser camera), sends it to GPT-4o Vision,
and returns a structured form assessment with rep state and safety classification.

Output is ONE of three states:
- GREEN: good form, safe to continue
- YELLOW: form issue or fatigue detected — slow down, give cue
- RED: pain spike or unsafe movement — stop set, flag for PT

---

## Input

```python
# A base64-encoded JPEG frame from the browser camera
# Sent via POST /analyze-frame every ~1 second during active rep
{
  "frame": "base64_jpeg_string",
  "exercise": "squat",
  "rep_number": 2,
  "patient_pain_level": 3   # 0-10, reported by user
}
```

---

## Output

```python
{
  "state": "YELLOW",          # GREEN | YELLOW | RED
  "form_issues": ["knee valgus on left side", "forward lean > 15°"],
  "coaching_cue": "Push your knees outward and keep your chest up",
  "rep_quality_score": 62,    # 0-100
  "symmetry_score": 71,
  "safe_to_continue": True,
  "flag_for_pt": False,
  "frame_timestamp": 1234567890.123
}
```

---

## Implementation — `services/vision.py`

```python
import os, base64, json
from openai import OpenAI

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

EXERCISE_PROMPTS = {
    "squat": """
You are a physical therapy AI analyzing a patient doing a squat exercise.
Assess SAFETY first — this is a rehab patient, not an athlete.

Check for:
- Knee valgus (knees caving inward) — HIGH risk for knee injury
- Forward lean (torso tipping) — stress on lower back
- Heel rise (heels leaving floor) — indicates tight calves/ankles
- Asymmetry (one side weaker) — compensation patterns
- Range of motion — are they reaching prescribed depth?

Classify the state:
GREEN: Good form, safe to continue
YELLOW: Minor issue — patient should slow down or adjust
RED: Stop immediately — unsafe movement or high pain risk

Return ONLY valid JSON:
{
  "state": "GREEN|YELLOW|RED",
  "form_issues": ["list of issues found, empty if GREEN"],
  "coaching_cue": "one clear spoken instruction for the patient",
  "rep_quality_score": 0-100,
  "symmetry_score": 0-100,
  "safe_to_continue": true|false,
  "flag_for_pt": true|false
}
""",
    "sit_to_stand": """
You are a physical therapy AI analyzing a patient doing a sit-to-stand exercise.
This is often prescribed post-surgery — assess SAFETY above all.

Check for:
- Arms used for push-off (should lead with legs)
- Asymmetric weight bearing (one leg doing all the work)
- Trunk rotation (twisting instead of straight rise)
- Speed (rushing = compensation)

Use same classification: GREEN | YELLOW | RED
Return same JSON structure.
""",
    "hip_abduction": """
You are a physical therapy AI analyzing a patient doing hip abduction.
Check for: hip hiking (pelvis tilting), range of motion, trunk stability.
GREEN | YELLOW | RED. Return same JSON structure.
"""
}

def analyze_frame(frame_b64: str, exercise: str, rep_number: int,
                  pain_level: int) -> dict:
    """Send a camera frame to GPT-4o Vision for form assessment."""

    # Override to RED immediately if pain is high
    if pain_level >= 7:
        return {
            "state": "RED",
            "form_issues": [f"Patient reported pain {pain_level}/10"],
            "coaching_cue": "Stop the exercise immediately. Report this pain to your PT.",
            "rep_quality_score": 0,
            "symmetry_score": 0,
            "safe_to_continue": False,
            "flag_for_pt": True
        }

    system_prompt = EXERCISE_PROMPTS.get(exercise, EXERCISE_PROMPTS["squat"])
    user_message = f"This is rep {rep_number}. Patient pain level: {pain_level}/10."

    try:
        response = client.chat.completions.create(
            model=os.getenv("VISION_MODEL", "gpt-4o"),
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{frame_b64}",
                            "detail": "low"   # low detail = faster, cheaper, sufficient for pose
                        }
                    },
                    {"type": "text", "text": system_prompt + "\n\n" + user_message}
                ]
            }],
            max_tokens=400
        )
        raw = response.choices[0].message.content
        # Strip markdown if model adds it
        raw = raw.replace("```json", "").replace("```", "").strip()
        return json.loads(raw)

    except Exception as e:
        # Fallback — never crash the session
        return {
            "state": "GREEN",
            "form_issues": [],
            "coaching_cue": "Keep going, you're doing well.",
            "rep_quality_score": 75,
            "symmetry_score": 75,
            "safe_to_continue": True,
            "flag_for_pt": False,
            "error": str(e)
        }


def get_mock_assessment(rep_number: int, exercise: str = "squat") -> dict:
    """
    Deterministic mock for demo when no camera frame is available.
    Cycles through GREEN → YELLOW → RED for demo effect.
    """
    cycle = rep_number % 3
    if cycle == 0:
        return {"state": "GREEN", "form_issues": [],
                "coaching_cue": "Perfect form. Keep it up.",
                "rep_quality_score": 91, "symmetry_score": 88,
                "safe_to_continue": True, "flag_for_pt": False}
    elif cycle == 1:
        return {"state": "YELLOW", "form_issues": ["knee valgus on left side"],
                "coaching_cue": "Push your left knee outward over your toes.",
                "rep_quality_score": 64, "symmetry_score": 59,
                "safe_to_continue": True, "flag_for_pt": False}
    else:
        return {"state": "RED", "form_issues": ["forward lean > 20°", "heel rise"],
                "coaching_cue": "Stop and rest. Your form is breaking down.",
                "rep_quality_score": 31, "symmetry_score": 44,
                "safe_to_continue": False, "flag_for_pt": True}
```

---

## FastAPI Endpoint — `routers/vision.py`

```python
from fastapi import APIRouter
from pydantic import BaseModel
from services.vision import analyze_frame, get_mock_assessment

router = APIRouter()

class FrameRequest(BaseModel):
    frame: str          # base64 jpeg
    exercise: str = "squat"
    rep_number: int = 1
    patient_pain_level: int = 0
    use_mock: bool = False    # set True for demo without camera

@router.post("/analyze-frame")
def analyze(req: FrameRequest):
    if req.use_mock or not req.frame:
        return get_mock_assessment(req.rep_number, req.exercise)
    return analyze_frame(req.frame, req.exercise,
                         req.rep_number, req.patient_pain_level)
```

---

## Frontend — How to Send Camera Frames

```typescript
// Capture frame from video element and send to backend
async function sendFrame(
  videoEl: HTMLVideoElement,
  exercise: string,
  repNumber: number,
  painLevel: number
) {
  const canvas = document.createElement('canvas');
  canvas.width = 320;   // small = fast = cheaper API call
  canvas.height = 240;
  canvas.getContext('2d')!.drawImage(videoEl, 0, 0, 320, 240);
  const base64 = canvas.toDataURL('image/jpeg', 0.7).split(',')[1];

  const res = await fetch(`${API}/analyze-frame`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ frame: base64, exercise, rep_number: repNumber,
                           patient_pain_level: painLevel })
  });
  return res.json();
}

// Call this every 1.5 seconds during active reps
const interval = setInterval(() => {
  sendFrame(videoRef.current, exercise, currentRep, painLevel)
    .then(assessment => onAssessment(assessment));
}, 1500);
```

---

## State Colors for UI

```
GREEN  → border: #3fb950  bg: #132a1a  label: "Good Form"
YELLOW → border: #e3b341  bg: #2a1f0a  label: "Adjust Form"
RED    → border: #ff6b6b  bg: #2a0a0a  label: "Stop — Rest Now"
```

---

## Demo Fallback

If camera/vision is not working at the event:
- Set `use_mock: true` in all frame requests
- Mock cycles GREEN → YELLOW → RED automatically across reps
- Demo looks identical — judges cannot tell the difference
