# SKILL 5 — Frontend: Session UI + PT Dashboard
## FormGuard · Applied Intelligence Hackathon · May 31 2026

---

## Design System

```css
:root {
  --bg:       #0d1117;
  --panel:    #161b22;
  --border:   #30363d;
  --text:     #c9d1d9;
  --muted:    #8b949e;

  /* State colors */
  --green:    #3fb950;  --green-bg:  #132a1a;
  --amber:    #e3b341;  --amber-bg:  #2a1f0a;
  --red:      #ff6b6b;  --red-bg:    #2a0a0a;
  --blue:     #58a6ff;  --blue-bg:   #162032;
  --purple:   #bc8cff;  --purple-bg: #1e1531;
}
```

---

## Screen Flow

```
Screen 1 — Setup        Screen 2 — Live Session      Screen 3 — Summary
┌──────────────┐        ┌──────────────────────┐      ┌─────────────────┐
│ Patient name │        │ Camera feed (left)   │      │ Rewards earned  │
│ Program pick │   ──►  │ Agent log (right)    │ ──►  │ Session stats   │
│ Exercise pick│        │ Pain slider (bottom) │      │ NEAR badge      │
│ Start session│        │ Form state ring      │      │ PT View button  │
└──────────────┘        └──────────────────────┘      └─────────────────┘
                                                                │
                                                                ▼
                                                       Screen 4 — PT Dashboard
                                                       (separate route /pt)
```

---

## Screen 2 — Live Session (Most Important)

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  [●] FormGuard          knee_rehab: squat         0:02:14   │
├──────────────────────────┬──────────────────────────────────┤
│                          │  AGENT LOG                       │
│   CAMERA FEED            │  ──────────────────────────────  │
│                          │  REP   Rep 3 — YELLOW           │
│   [video element]        │        Push knees outward        │
│   320×240px              │  FORM  Rep quality: 64           │
│                          │  AGENT Adapting → Sit-to-Stand   │
│  ┌──────────────────┐    │        Less stress on knee       │
│  │  YELLOW          │    │  DONE  Session complete ✓        │
│  │  Adjust Form     │    │                                  │
│  └──────────────────┘    │  Rep:  7 / 10   Pain: ████░░░   │
│                          │  ████████░░  Form score: 72      │
├──────────────────────────┴──────────────────────────────────┤
│  PAIN LEVEL:  0───────────●──────────10                     │
│               None    Moderate    Stop                       │
│                       [3]                                    │
└─────────────────────────────────────────────────────────────┘
```

### Form State Ring

```tsx
// Large colored ring around the camera feed showing current state
// Updates every rep assessment

function FormStateRing({ state }: { state: 'GREEN' | 'YELLOW' | 'RED' | null }) {
  const colors = {
    GREEN:  { border: '#3fb950', bg: '#132a1a', label: 'Good Form' },
    YELLOW: { border: '#e3b341', bg: '#2a1f0a', label: 'Adjust Form' },
    RED:    { border: '#ff6b6b', bg: '#2a0a0a', label: 'Stop — Rest Now' },
  };
  const c = state ? colors[state] : { border: '#30363d', bg: '#161b22', label: 'Ready' };

  return (
    <div style={{
      border: `3px solid ${c.border}`,
      borderRadius: 12,
      background: c.bg,
      padding: 4,
      transition: 'all 0.3s ease'
    }}>
      <video ref={videoRef} style={{ width: 320, height: 240, borderRadius: 8 }} />
      <div style={{ textAlign: 'center', color: c.border, fontWeight: 600,
                    padding: '6px 0', fontSize: 14 }}>{c.label}</div>
    </div>
  );
}
```

### Pain Slider

```tsx
function PainSlider({ value, onChange }: { value: number, onChange: (n: number) => void }) {
  return (
    <div style={{ padding: '12px 16px', background: '#161b22',
                  borderTop: '1px solid #30363d' }}>
      <div style={{ fontSize: 11, color: '#484f58', marginBottom: 6,
                    letterSpacing: '0.1em' }}>
        PAIN LEVEL — speak "pain is 5" or use slider
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 11, color: '#8b949e' }}>None</span>
        <input type="range" min={0} max={10} value={value}
               onChange={e => onChange(parseInt(e.target.value))}
               style={{ flex: 1, accentColor: value >= 7 ? '#ff6b6b' :
                                               value >= 4 ? '#e3b341' : '#3fb950' }} />
        <span style={{ fontSize: 11, color: '#8b949e' }}>Stop</span>
        <span style={{ fontSize: 18, fontWeight: 700,
                       color: value >= 7 ? '#ff6b6b' : value >= 4 ? '#e3b341' : '#3fb950' }}>
          {value}
        </span>
      </div>
    </div>
  );
}
```

---

## Screen 3 — Session Summary

```tsx
function SessionSummary({ session, attestation }: { session: any, attestation: any }) {
  return (
    <div style={{ padding: 20 }}>
      <h2 style={{ color: '#c9d1d9' }}>Session Complete</h2>

      {/* Rewards */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '16px 0' }}>
        {session.rewards_earned.map((r: any) => (
          <div key={r.type} style={{ background: '#132a1a', border: '1px solid #3fb950',
               borderRadius: 8, padding: '8px 14px', fontSize: 13, color: '#3fb950' }}>
            {r.label}
          </div>
        ))}
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {[
          ['Reps', `${session.completed_reps}/${session.prescribed_reps}`],
          ['Peak Pain', `${Math.max(...session.pain_history, 0)}/10`],
          ['Avg Form', `${Math.round(session.rep_assessments.reduce((s: number, r: any) => s + (r.assessment?.rep_quality_score || 75), 0) / Math.max(session.rep_assessments.length, 1))}%`],
        ].map(([lbl, val]) => (
          <div key={lbl} style={{ background: '#161b22', borderRadius: 8,
               padding: 12, textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 600, color: '#c9d1d9' }}>{val}</div>
            <div style={{ fontSize: 11, color: '#8b949e', marginTop: 2 }}>{lbl}</div>
          </div>
        ))}
      </div>

      {/* NEAR badge */}
      {attestation?.tx_hash && (
        <div style={{ margin: '16px 0', padding: 12, background: '#1a1530',
             border: '1px solid #bc8cff', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: '#bc8cff', fontWeight: 600 }}>
            ✓ Session Verified on NEAR AI
          </div>
          <div style={{ fontSize: 11, color: '#8b949e', marginTop: 4,
               fontFamily: 'monospace' }}>
            {attestation.tx_hash.slice(0, 20)}...
          </div>
          <a href={attestation.near_explorer} target="_blank" style={{ fontSize: 11, color: '#58a6ff' }}>
            View proof →
          </a>
        </div>
      )}

      <button style={{ width: '100%', background: '#185FA5', border: 'none',
           borderRadius: 8, padding: 12, color: 'white', fontSize: 14,
           cursor: 'pointer', marginTop: 12 }}>
        Share with PT →
      </button>
    </div>
  );
}
```

---

## Screen 4 — PT Dashboard (`/pt` route)

```tsx
function PTDashboard() {
  // Shows: patient list, session history, flagged clips, adherence trend

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', height: '100vh' }}>

      {/* Patient list sidebar */}
      <div style={{ background: '#161b22', borderRight: '1px solid #30363d',
                    padding: 16, overflowY: 'auto' }}>
        <div style={{ fontSize: 10, color: '#484f58', letterSpacing: '0.1em',
                      marginBottom: 12 }}>PATIENTS</div>
        {patients.map(p => (
          <div key={p.id} onClick={() => setSelected(p.id)}
               style={{ padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                        background: selected === p.id ? '#162032' : 'transparent',
                        color: '#c9d1d9', fontSize: 13, marginBottom: 4 }}>
            {p.name}
            <div style={{ fontSize: 11, color: '#8b949e' }}>
              {p.sessions_this_week} sessions this week
            </div>
          </div>
        ))}
      </div>

      {/* Session detail */}
      <div style={{ padding: 20, overflowY: 'auto' }}>
        <h3 style={{ color: '#c9d1d9', marginBottom: 16 }}>Recent Sessions</h3>

        {sessions.map(s => (
          <div key={s.session_id} style={{ background: '#161b22', borderRadius: 10,
               padding: 16, marginBottom: 12, border: '1px solid #30363d' }}>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#c9d1d9', fontWeight: 600 }}>{s.exercise}</span>
              <span style={{ color: s.session_status === 'COMPLETE' ? '#3fb950' : '#e3b341',
                             fontSize: 12 }}>{s.session_status}</span>
            </div>

            <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12,
                          color: '#8b949e' }}>
              <span>{s.completed_reps}/{s.prescribed_reps} reps</span>
              <span>Peak pain: {Math.max(...s.pain_history, 0)}/10</span>
              {s.flags_for_pt.length > 0 &&
                <span style={{ color: '#ff6b6b' }}>⚠️ {s.flags_for_pt.length} flags</span>}
            </div>

            {/* Evidence clips */}
            {s.evidence_clips?.length > 0 && (
              <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                {s.evidence_clips.map((clip: any) => (
                  <a key={clip.type} href={clip.url} target="_blank"
                     style={{ background: '#0d1117', border: '1px solid #30363d',
                              borderRadius: 6, padding: '4px 10px', fontSize: 11,
                              color: '#58a6ff', textDecoration: 'none' }}>
                    ▶ {clip.type.replace('_', ' ')}
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## Running Locally

```bash
npm install
npm run dev   # → http://localhost:5173
# PT dashboard → http://localhost:5173/pt
```

---

## Demo Consistency Rules

1. Camera access requires `https` or `localhost` — localhost works fine for demo
2. Turn volume UP before demo — TTS voice cue is the money moment
3. Use mock assessments (`use_mock=true`) if camera fails
4. Have demo screenshots as fallback inputs on Desktop
5. PT dashboard pre-load with mock patient "John D." with 3 sessions
