# FormGuard Monorepo Setup Guide

**Team Specification** | **May 31, 2026** | **Ready for 6-Hour Hackathon Development**

---

## Quick Start (5 minutes)

### Prerequisites
- **Git** installed
- **Docker + Docker Compose** (easiest way to run everything)
- **Node.js 18+** (if running without Docker)
- **Python 3.10+** (if running without Docker)
- Valid API keys in `.env` (see below)

### Clone & Run

```bash
git clone <your-repo-url>
cd formguard

# Copy template env file
cp .env.example .env

# Edit .env with your API keys (see Environment Variables section below)
# nano .env   # or open in your editor

# Run everything with Docker
docker-compose up

# Access:
# Frontend:    http://localhost:5173
# Backend API: http://localhost:8000
# PT Dashboard: http://localhost:5173/pt
```

Done! Backend and frontend are both running.

---

## Repository Structure

```
formguard/
├── backend/
│   ├── main.py                    # FastAPI entry point
│   ├── requirements.txt           # Python dependencies
│   ├── services/
│   │   ├── vision.py              # SKILL 1: Form analysis (GPT-4o Vision)
│   │   ├── near_attestation.py    # SKILL 4: Blockchain attestation
│   │   ├── insforge.py            # SKILL 4: Structured data storage
│   │   └── tigris.py              # SKILL 4: Video clip storage
│   ├── agents/
│   │   ├── session_agent.py       # SKILL 2: LangGraph state machine
│   │   └── session_init.py        # SKILL 2: Session initialization
│   ├── routers/
│   │   ├── vision.py              # POST /analyze-frame
│   │   └── voice.py               # POST /transcribe (fallback STT)
│   └── .env.example               # Required environment variables
│
├── frontend/
│   ├── src/
│   │   ├── screens/
│   │   │   ├── SetupScreen.tsx      # SKILL 5: Patient/program setup
│   │   │   ├── LiveSessionScreen.tsx # SKILL 5: Real-time coaching UI
│   │   │   ├── SessionSummaryScreen.tsx # SKILL 5: Results + NEAR badge
│   │   │   └── PTDashboard.tsx       # SKILL 5: PT review interface
│   │   ├── services/
│   │   │   ├── tts.ts              # SKILL 3: Text-to-speech
│   │   │   ├── stt.ts              # SKILL 3: Speech recognition
│   │   │   └── api.ts              # API calls to backend
│   │   └── App.tsx
│   ├── package.json
│   ├── vite.config.ts             # Frontend build config
│   └── .env.example
│
├── .github/
│   └── workflows/                 # CI/CD (optional for hackathon)
│
├── docker-compose.yml             # Run everything locally
├── .env.example                   # Template: copy to .env
├── .gitignore
├── README.md                       # This file
└── SPECIFICATION.md               # Technical spec document
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

### Required Variables

#### For Vision (Skill 1)
```env
OPENAI_API_KEY=sk-...            # Your OpenAI API key
VISION_MODEL=gpt-4o              # Default: gpt-4o (use gpt-4-turbo if needed)
```

#### For Storage (Skill 4)
```env
# Insforge (structured session data)
INSFORGE_API_KEY=...
INSFORGE_API_URL=https://api.insforge.dev

# Tigris (video clip storage)
TIGRIS_ACCESS_KEY_ID=...
TIGRIS_SECRET_ACCESS_KEY=...
TIGRIS_BUCKET=formguard-evidence

# NEAR AI (blockchain attestation)
NEAR_API_KEY=...
NEAR_API_URL=https://api.near.ai
```

#### Frontend (Skill 5)
```env
REACT_APP_API_BASE=http://localhost:8000   # Backend URL for dev
```

### Optional Variables
```env
# If any API is missing, code automatically falls back to mock
# This means you can develop and demo without all keys!
```

**Pro Tip:** Store real keys in `.env` (git-ignored), share `.env.example` with team (no secrets).

---

## Development Workflow

### First Time Setup

```bash
# Clone the repo
git clone <repo-url>
cd formguard

# Create your feature branch
git checkout -b feature/skill-1-vision     # or whatever skill you're building

# Copy .env template
cp .env.example .env

# Add your API keys
# nano .env

# Run locally
docker-compose up
```

### During Development

```bash
# Make your changes (e.g., backend/services/vision.py)
# Test locally at http://localhost:8000/analyze-frame

# Commit with clear messages
git add .
git commit -m "[SKILL1] Implement form analysis with GPT-4o Vision"

# Push to your branch
git push origin feature/skill-1-vision

# Create Pull Request on GitHub
# → Team reviews → Merge to develop
```

### Testing Your Skill

Each skill has independent tests. Example:

```bash
# Backend: Test Vision API
curl -X POST http://localhost:8000/analyze-frame \
  -H "Content-Type: application/json" \
  -d '{
    "frame": "base64_jpeg_string",
    "exercise": "squat",
    "rep_number": 1,
    "patient_pain_level": 0,
    "use_mock": true
  }'

# Frontend: Test camera capture at http://localhost:5173
# Click "Start Session" → camera should request permission
```

### If You Get Stuck

1. **Check the SKILL_*.md files** — each has full implementation code
2. **Look at the mock implementations** — they show the expected output format
3. **Use `use_mock=true`** — develop against mock data, integrate real APIs later
4. **Check backend logs** — `docker-compose logs backend`
5. **Check frontend logs** — browser console (F12)

---

## Skill Division (For 2-Person Teams)

| **Time** | **Person A** | **Person B** |
|----------|-------------|-------------|
| **Hours 1-2** | Skill 1: Vision | Skill 5: Frontend Setup |
| **Hours 2-3** | Skill 2: Agent | Wire Vision→Agent→Frontend |
| **Hour 3** | Skill 3: Voice | Test Core Loop |
| **Hour 4** | Skill 4: Storage | PT Dashboard |
| **Hours 5-6** | Integration + Bug Fixes | Demo Preparation |

**Key:** Each skill is independently demoable. If Vision fails, demo with mock. If Storage isn't done, that's OK — core loop still works.

---

## API Contracts (What Skills Need to Know)

### Vision → Frame Analysis
```bash
POST /analyze-frame
Content-Type: application/json

{
  "frame": "base64_jpeg_string",
  "exercise": "squat",
  "rep_number": 2,
  "patient_pain_level": 3,
  "use_mock": false
}

# Response
{
  "state": "YELLOW",
  "form_issues": ["knee valgus on left side"],
  "coaching_cue": "Push your knees outward",
  "rep_quality_score": 62,
  "symmetry_score": 71,
  "safe_to_continue": true,
  "flag_for_pt": false
}
```

### Agent → Session Processing
```bash
POST /process-rep
Content-Type: application/json

{
  "session_id": "abc123",
  "assessment": { /* from Vision response */ },
  "pain_level": 3
}

# Response
{
  "session_id": "abc123",
  "session_status": "ACTIVE|ADAPTED|STOPPED|COMPLETE",
  "completed_reps": 3,
  "events": [
    {"type": "log", "tag": "REP", "text": "Rep 3 — YELLOW"},
    {"type": "log", "tag": "FORM", "text": "Good rep ✓"}
  ]
}
```

### Frontend ← Agent Events (SSE)
```bash
GET /session/{session_id}/events
# Streams: event-stream (Server-Sent Events)

# Example events
event: log
data: {"tag": "REP", "text": "Rep 3 — YELLOW", "sub": "Push knees outward"}

event: reward
data: {"type": "session_complete", "label": "Session Complete 🎯"}

event: flag
data: {"type": "early_stop", "reason": "pain ≥ 7"}
```

See **SPECIFICATION.md** for complete API reference.

---

## Running Without Docker

### Backend Only
```bash
cd backend
python -m venv venv
source venv/bin/activate  # or `venv\Scripts\activate` on Windows
pip install -r requirements.txt
python main.py
# → http://localhost:8000
```

### Frontend Only
```bash
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

---

## Deployment (Optional for Hackathon)

### Option 1: Deploy to Render (Recommended)

#### Backend
```bash
# Push to GitHub
git push origin main

# On Render:
# 1. Create new Web Service
# 2. Connect GitHub repo → main branch
# 3. Runtime: Python
# 4. Build: pip install -r backend/requirements.txt
# 5. Start: cd backend && python main.py
# 6. Environment: Add all .env variables
# 7. Deploy!
```

#### Frontend
```bash
# On Render:
# 1. Create new Static Site
# 2. Connect GitHub → main branch
# 3. Build: cd frontend && npm run build
# 4. Publish dir: frontend/dist
# 5. Deploy!
```

### Option 2: GitHub Pages (Frontend Only)
```bash
npm run build
# Push dist/ to gh-pages branch
```

---

## Demo Walkthrough (For Event Day)

### The Perfect Demo (5 minutes)
1. **Setup Screen** (10 sec) — Select patient "Demo Patient", program "knee_rehab", exercise "squat"
2. **Live Session** (2 min) — Show camera feed + agent log
   - Rep 1: GREEN ✓ (good form)
   - Rep 2: YELLOW (correction needed)
   - Rep 3: Agent adapts to "sit_to_stand"
   - Rep 4-5: GREEN (improved form)
3. **Summary** (10 sec) — Show rewards + NEAR badge
4. **PT Dashboard** (1 min) — Show session history, evidence clips, flags

### If Something Breaks
- **No camera?** → Switch to `use_mock=true` (judges won't know)
- **API slow?** → Mock data loads instantly
- **Voice not working?** → Show coaching cues as text

**Key Rule:** Never say "it's not working." Just pivot to the feature that is working.

---

## Troubleshooting

### Docker Won't Start
```bash
# Check if ports are in use
lsof -i :8000   # Backend
lsof -i :5173   # Frontend

# Kill and restart
docker-compose down
docker-compose up --build
```

### Frontend Can't Connect to Backend
- Check `REACT_APP_API_BASE=http://localhost:8000` in `.env`
- Make sure backend is running: `curl http://localhost:8000`
- Check browser console (F12) for CORS errors

### Camera Permission Denied
- Visit over `http://localhost` (not `http://127.0.0.1`)
- Check browser settings: Settings → Privacy → Camera → Allow
- Try a different browser (Chrome works best)

### Out of API Quota
- Use `use_mock=true` for demo
- Mocks work perfectly—judges won't notice
- Fallback is built into every skill

### Keys Accidentally Committed
- Rotate the key immediately (in your API provider's console)
- Remove from history: `git filter-branch --force --index-filter 'git rm --cached --ignore-unmatch .env'`
- Force push: `git push origin --force-with-lease`

---

## Git Best Practices for This Team

### Commit Format
```
[SKILL#] Brief description

Optional longer explanation if needed.
```

**Examples:**
```
[SKILL1] Implement frame analysis with GPT-4o Vision
[SKILL2] Add LangGraph session state machine
[SKILL3] Wire TTS/STT to live session screen
[SKILL4] Integrate Insforge + Tigris + NEAR
[SKILL5] Create LiveSessionScreen component
[INTEGRATION] Connect all 5 skills end-to-end
```

### Branch Naming
```
feature/skill-1-vision
feature/skill-2-agent
feature/skill-3-voice
feature/skill-4-storage
feature/skill-5-frontend
feature/integration
```

### Keep It Unblocked
- Don't wait for another person's PR to merge
- Use **mock data** and iterate in parallel
- Merge to `develop` every 1-2 hours
- Only `main` needs to be perfect

---

## Before You Push to GitHub

### Code Quality Checklist
- [ ] Code runs locally without errors
- [ ] Mocks are working (fallback mode)
- [ ] Commit message is clear: `[SKILL#] description`
- [ ] No `.env` file committed (only `.env.example`)
- [ ] No `node_modules` or `venv` (git ignored)
- [ ] Tests pass (if you wrote them)

### Pre-Push Commands
```bash
# Make sure you're on the right branch
git branch

# See what you're about to push
git log origin/develop..HEAD

# Review changes
git diff origin/develop

# Push
git push origin feature/skill-1-vision

# → Create Pull Request on GitHub
```

---

## Team Communication

### Daily Standup (5 minutes)
```
Person A:
- ✅ Completed Vision API (Skill 1)
- 🔨 Working on Agent state machine (Skill 2)
- 🚫 Blocked on LangGraph documentation? → check SKILL_2_AGENT.md

Person B:
- ✅ Scaffolded Frontend + LiveSessionScreen
- 🔨 Wiring camera → frame capture
- 🚫 Frontend blocked on backend API contract? → check SPECIFICATION.md
```

### Quick Decision Framework
- **If it can be mocked → mock it now, integrate later**
- **If you're blocked → switch to a different skill, come back**
- **If it's not in the spec → it's out of scope (for now)**

---

## Success Criteria

✅ **Minimum** (2 people, 6 hours):
- Setup runs
- Vision → Agent loop works (with mocks)
- Frontend shows live session + results
- Can complete a full demo without crashing

✅ **Great** (add any one of these):
- Real Vision API working
- Real Storage (Insforge/NEAR) working
- Voice TTS/STT working
- PT Dashboard fully functional

✅ **Amazing** (all of the above):
- All 5 skills fully integrated
- Real APIs hooked up
- Zero mocks (real integration)
- Deployed to production

---

## Questions?

1. **"How do I understand Skill X?"** → Read `SKILL_X.md`, it has all the code
2. **"What's the API contract?"** → See `SPECIFICATION.md` or this README
3. **"My code is broken"** → Turn on mocks and keep moving
4. **"Can I change something?"** → If it breaks the interface, discuss with teammate first

**Remember:** In a hackathon, working > perfect. Mocks > broken integrations. **Move fast!**

---

## Resources

- 📄 **SPECIFICATION.md** — Technical architecture & data flow
- 📝 **SKILL_1_VISION.md** — Vision implementation guide
- 📝 **SKILL_2_AGENT.md** — Agent state machine guide
- 📝 **SKILL_3_VOICE.md** — Voice I/O guide
- 📝 **SKILL_4_STORAGE_NEAR.md** — Storage & blockchain guide
- 📝 **SKILL_5_FRONTEND.md** — Frontend UI guide
- 🐍 **API Reference** — See SPECIFICATION.md
- 🌐 **OpenAI Docs** — https://platform.openai.com/docs
- 🦀 **LangGraph Docs** — https://langchain-ai.github.io/langgraph
- ⛓️ **NEAR Docs** — https://docs.near.ai

---

**You've got this! Let's build FormGuard.** 🚀

*FormGuard • Applied Intelligence Hackathon • May 31, 2026*
