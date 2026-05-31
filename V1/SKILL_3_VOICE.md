# SKILL 3 — Voice I/O (Real-Time Coaching)
## FormGuard · Applied Intelligence Hackathon · May 31 2026

---

## What This Skill Does

Two-way voice layer:
- **TTS (Text → Speech):** Agent coaching cues spoken aloud in real time
- **STT (Speech → Text):** Patient reports pain or says "stop" via voice

This is critical for the demo — a voice saying "Push your knee outward" while the
patient is exercising is far more powerful than text on a screen.

---

## TTS — Browser-Native (No API Key Needed)

Use the Web Speech API for TTS — it's built into Chrome, zero setup, zero cost.

```typescript
// services/tts.ts
let speaking = false;

export function speak(text: string, priority: boolean = false) {
  if ('speechSynthesis' in window) {
    // Cancel current speech if priority (RED state)
    if (priority) window.speechSynthesis.cancel();
    if (speaking && !priority) return;  // don't interrupt non-critical

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;      // slightly slower for clarity
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    // Pick a natural voice if available
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => v.name.includes('Samantha') ||
                                        v.name.includes('Google UK English Female') ||
                                        v.name.includes('Karen'));
    if (preferred) utterance.voice = preferred;

    utterance.onstart = () => { speaking = true; };
    utterance.onend = () => { speaking = false; };

    window.speechSynthesis.speak(utterance);
  }
}

export function stopSpeaking() {
  window.speechSynthesis.cancel();
  speaking = false;
}

// Coaching cue mapped to priority
export function speakCoachingCue(cue: string, state: 'GREEN' | 'YELLOW' | 'RED') {
  speak(cue, state === 'RED');  // RED is always priority
}
```

---

## STT — Browser-Native (No API Key Needed)

```typescript
// services/stt.ts
export function startListening(
  onPainReport: (level: number) => void,
  onStopCommand: () => void,
  onTranscript: (text: string) => void
) {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    console.warn('Speech recognition not supported');
    return null;
  }

  const SpeechRecognition = (window as any).SpeechRecognition ||
                             (window as any).webkitSpeechRecognition;
  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = 'en-US';

  recognition.onresult = (event: any) => {
    const transcript = event.results[event.results.length - 1][0].transcript
                           .trim().toLowerCase();
    onTranscript(transcript);

    // Detect pain reports: "pain three", "pain is 5", "it hurts", "ouch"
    const painMatch = transcript.match(/pain\s*(is\s*)?(\d+)|(\d+)\s*out\s*of|ouch|it\s*hurts/i);
    if (painMatch) {
      const level = parseInt(painMatch[2] || painMatch[3] || '6');
      onPainReport(isNaN(level) ? 6 : level);
    }

    // Detect stop commands
    if (transcript.includes('stop') || transcript.includes('rest') ||
        transcript.includes('pause') || transcript.includes('done')) {
      onStopCommand();
    }
  };

  recognition.start();
  return recognition;
}
```

---

## Fallback: OpenAI Whisper (for audio file uploads)

Only needed if browser STT doesn't work well. Backend endpoint:

```python
# routers/voice.py
import os, tempfile
from fastapi import APIRouter, UploadFile, File
from openai import OpenAI

router = APIRouter()
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

@router.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    audio_bytes = await file.read()
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
        f.write(audio_bytes); f.flush()
        transcript = client.audio.transcriptions.create(
            model="whisper-1", file=open(f.name, "rb")
        ).text
    return {"transcript": transcript}
```

---

## Coaching Cue Script — Pre-Written for Demo

Pre-write these so they sound natural (not LLM-generated):

```python
# agents/coaching_cues.py
CUES = {
    "squat_knee_valgus": "Push your knees out over your toes — they're caving inward.",
    "squat_forward_lean": "Keep your chest up and your back straight.",
    "squat_heel_rise": "Press your heels into the floor.",
    "good_rep": "Nice. That rep was solid.",
    "great_form": "Perfect form. Keep that up.",
    "slow_down": "Slow it down — quality over speed.",
    "adapt_sit_to_stand": "Let's switch to sit-to-stands. Easier on your knee, same benefit.",
    "pain_acknowledged": "Got it — I'm reducing the intensity.",
    "session_complete": "You finished your session. That took discipline. Well done.",
    "stop_early": "We're stopping here. Rest, and mention this to your PT at your next visit.",
    "red_immediate": "Stop the exercise now and rest.",
}
```

---

## Integration with Screen 2

```typescript
// In the live session component, wire TTS to SSE events
function onAgentEvent(event: AgentEvent) {
  if (event.tag === 'FORM' || event.tag === 'ALERT' || event.tag === 'AGENT') {
    speakCoachingCue(event.sub || event.text,
                     event.tag === 'ALERT' ? 'RED' : 'YELLOW');
  }
  if (event.tag === 'DONE') {
    speak("You finished your session. Well done.", false);
  }
}
```

---

## Demo Tip

For the hackathon demo — have the coaching cues speak automatically.
The moment judges hear a voice say "Push your knees outward" in response
to a live camera feed, they understand the product instantly.
Turn your laptop volume UP before the demo.
