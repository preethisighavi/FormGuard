# Railway Deployment Guide — FormGuard

Deploy Computer B (Backend) and Computer C (NEAR mock) to Railway.
Each gets a public HTTPS URL. Frontend team points at B's URL. B points at C's URL.

---

## Step 1 — Create Railway account

Go to https://railway.com → Sign up with GitHub (free $5 trial credit, no card needed).

---

## Step 2 — Push your monorepo to GitHub

Both services live in the same repo — no need to split them.

```bash
cd /path/to/FormGuard   # your repo root
git add .
git commit -m "add Railway deploy config"
git push
```

---

## Step 3 — Deploy Computer C (NEAR mock) first

B depends on C, so deploy C first to get its URL.

1. Go to https://railway.com/new
2. Click **"Deploy from GitHub repo"**
3. Select your **FormGuard monorepo**
4. Railway asks for the **Root Directory** → set it to: `formguard-near/mock-near`
5. Railway detects the Dockerfile → click **Deploy**
6. Once deployed: Settings → Networking → **Generate Domain**
7. Copy the URL → looks like `https://formguard-near-mock.up.railway.app`

**No environment variables needed** for the mock server.

---

## Step 4 — Deploy Computer B (Backend)

1. Go to https://railway.com/new
2. Click **"Deploy from GitHub repo"**
3. Select the **same FormGuard monorepo**
4. Railway asks for the **Root Directory** → set it to: `formguard-backend`
5. Railway detects the Dockerfile → click **Deploy**
6. Once deployed: Settings → Networking → **Generate Domain**
7. Copy the URL → looks like `https://formguard-backend.up.railway.app`

### Set environment variables in Railway dashboard:

Go to your **formguard-backend** service → **Variables** tab → add:

| Variable | Value |
|---|---|
| `INSFORGE_API_URL` | `https://api.insforge.dev` |
| `INSFORGE_API_KEY` | your Insforge API key |
| `NEAR_ENDPOINT` | `https://formguard-near-mock.up.railway.app/near` |

Railway injects these at runtime — never stored in source code.

---

## Step 5 — Give frontend team the backend URL

```
https://formguard-backend.up.railway.app
```

They set in their `.env`:
```
VITE_BACKEND_URL=https://formguard-backend.up.railway.app
```

---

## Step 6 — Update Opsera secrets

In Opsera secrets vault, update:
```
NEAR_ENDPOINT_STAGING=https://formguard-near-mock.up.railway.app/near
VITE_BACKEND_URL_STAGING=https://formguard-backend.up.railway.app
```

---

## Smoke test after deploy

```bash
# Health check
curl https://formguard-backend.up.railway.app/health

# Create session
curl -X POST https://formguard-backend.up.railway.app/session/create \
  -H 'Content-Type: application/json' \
  -d '{"patient_name":"Deploy Test","program":"knee_rehab","exercise":"squat"}'

# NEAR mock health
curl https://formguard-near-mock.up.railway.app/health
```

All three should return JSON with `"status": "ok"` or valid session data.

---

## Local dev — no change needed

Your local setup stays exactly the same:
- Backend: `http://localhost:8000`
- NEAR mock: `http://127.0.0.1:5001/near`

Railway is only for sharing with the frontend team and running the demo.
