# Computer D — Opsera DevOps Orchestration

**Role:** Platform engineering layer. Opsera orchestrates the CI/CD pipelines, deployment toolchains, environment governance, and unified insights for the FormGuard stack. Connects to Insforge through Computer B's API to monitor data-layer health in the delivery pipeline.

**Depends on:** Computer B's `/tool/*` + `/session/*` endpoints at `http://B_LOCAL:8000`. Optionally reaches Computer C's `/near/*` at `http://C_LOCAL:5001` for attestation health checks.

**Tech:** Opsera Unified DevOps Platform (declarative pipelines, toolchain automation, Hummingbird AI, AppSec agents). No code changes to A, B, or C — Opsera wraps existing HTTP endpoints and repos.

> **Opsera is the DevOps brain, not a new computer in the data path.** Repos and API shapes are normative in [`API_CONTRACT.md`](./API_CONTRACT.md). Opsera reads these shapes to validate deployments, but never proxies live traffic. A, B, and C are completely unaware Opsera exists — no SDK, no import, no config change.

---

## What Opsera Does Here

| Capability | What It Means for FormGuard |
|---|---|
| **Declarative Pipelines** | Drag-and-drop or YAML pipelines that build, test, and deploy A, B, and C in sequence or parallel |
| **Toolchain Automation** | Auto-provision the tool stack — Node, Python, Rust, NEAR CLI — per environment |
| **Unified Insights** | DORA metrics, pipeline health, deployment frequency, mean-time-to-recover across all 3 computers |
| **Hummingbird AI** | AI-driven pipeline failure analysis — when B's Insforge write fails, Hummingbird suggests the fix |
| **AppSec Agents** | Security scan agents run against each PR — find secrets, CVEs, misconfigurations before they merge |
| **Compliance Audit Agents** | Verify Insforge API key is set in prod, NEAR endpoint is reachable, mock flags are off |
| **Environment Governance** | Gate promotion from dev → staging → prod with approval workflows and policy checks |

---

## Quick Start

```bash
# 1. Register your repos in Opsera Tool Registry
#    - gh:your-org/formguard-frontend   (Computer A)
#    - gh:your-org/formguard-backend    (Computer B)
#    - gh:your-org/formguard-near       (Computer C)
#    → Opsera auto-discovers branches, PRs, and commit status

# 2. Set environment variables in Opsera (per environment):
#    dev:
#      INSFORGE_API_URL=https://api.insforge.dev
#      INSFORGE_API_KEY=<dev-key>
#      NEAR_ENDPOINT=http://localhost:5001/near
#      VITE_BACKEND_URL=http://localhost:8000
#    prod:
#      INSFORGE_API_URL=https://api.insforge.dev
#      INSFORGE_API_KEY=<prod-key>
#      NEAR_ENDPOINT=https://near-relay.formguard.io/near
#      VITE_BACKEND_URL=https://api.formguard.io

# 3. Define pipelines (see below) → Opsera generates CI/CD
```

---

## Pipeline Architecture (Declarative Pipelines)

### Pipeline 1: Build & Test All Three

Trigger: `push` to any branch, `pull_request` to `main`.

```
┌─────────────────────────────────────────────────────┐
│ Build & Test Pipeline                                │
├──────────────┬──────────────┬───────────────────────┤
│ Computer A   │ Computer B   │ Computer C            │
│ (Frontend)   │ (Backend)    │ (NEAR)                │
├──────────────┼──────────────┼───────────────────────┤
│ npm ci       │ pip install  │ cargo build           │
│ npm run lint │ ruff check   │ cargo test            │
│ npm run test │ pytest       │ near contract test    │
│ npm run build│ uvicorn check│ wasm build            │
└──────────────┴──────────────┴───────────────────────┘
         │              │               │
         └──────────────┴───────────────┘
                    │
            ┌───────▼────────┐
            │  Integration   │
            │  Smoke Test    │
            │  (A→B→C wired) │
            └───────┬────────┘
                    │
         ┌──────────▼──────────┐
         │  Insforge API       │
         │  Validation Step    │
         │  (M1 round-trip)    │
         └──────────┬──────────┘
                    │
         ┌──────────▼──────────┐
         │  AppSec Scan        │
         │  (secrets, CVEs)    │
         └─────────────────────┘
```

**Insforge API Validation Step** is the key integration. It runs a one-round-trip check against Insforge's real API (same as M1 in the build plan). If it fails, the pipeline gates — don't deploy if the data layer is unreachable.

Opsera pipeline JSON snippet (register in the Pipeline Builder):

```json
{
  "name": "formguard-build-test",
  "triggers": ["push", "pull_request"],
  "steps": [
    {
      "name": "Computer A - Build & Lint",
      "tool": "Node.js",
      "commands": ["npm ci", "npm run lint", "npm run test", "npm run build"],
      "working_dir": "formguard-frontend"
    },
    {
      "name": "Computer B - Build & Lint",
      "tool": "Python",
      "commands": ["pip install -r requirements.txt", "ruff check .", "pytest"],
      "working_dir": "formguard-backend"
    },
    {
      "name": "Computer C - Build & Test",
      "tool": "Rust",
      "commands": ["cargo build", "cargo test"],
      "working_dir": "formguard-near"
    },
    {
      "name": "Integration Smoke Test",
      "tool": "Custom Script",
      "commands": [
        "B_LOCAL=localhost:8000",
        "C_LOCAL=localhost:5001",
        "SESSION=$(curl -s -X POST $B_LOCAL/session/create -H 'Content-Type: application/json' -d '{\"patient_name\":\"CI Test\",\"program\":\"knee_rehab\",\"exercise\":\"squat\"}')",
        "REP=$(curl -s -X POST $B_LOCAL/tool/log_rep -H 'Content-Type: application/json' -d '{\"session_id\":\"test-ci\",\"rep_number\":1,\"form_state\":\"GREEN\",\"quality_score\":90,\"coaching_cue\":\"test\",\"pain_level\":0}')",
        "echo $REP | grep -q 'ok.*true' || exit 1"
      ]
    },
    {
      "name": "Insforge API Shape Validation",
      "tool": "Custom Script",
      "description": "Derisk Insforge prize dependency — validate API shape every build",
      "commands": [
        "INSPECT=$(curl -s -X POST $INSFORGE_API_URL/collections -H \"x-api-key: $INSFORGE_API_KEY\" -H 'Content-Type: application/json')",
        "echo 'Insforge reachable. Shape: $INSPECT'"
      ]
    },
    {
      "name": "AppSec Security Scan",
      "tool": "Opsera Security Scan Agent",
      "config": {
        "scan_type": "secrets_cves_iac",
        "fail_on": "critical"
      }
    }
  ]
}
```

### Pipeline 2: Deploy to Environment

Trigger: `merge` to `main` → staging. Tagged release → production.

```
┌─────────────────────────────┐
│  Deploy Pipeline            │
├─────────────────────────────┤
│  Approval Gate (staging→prod)│
├─────────────────────────────┤
│  Deploy Computer C (NEAR)   │
│  └─ near deploy --accountId │
├─────────────────────────────┤
│  Deploy Computer B (Backend)│
│  └─ docker compose up -d    │
│  └─ Health check /session/  │
├─────────────────────────────┤
│  Deploy Computer A (Front)  │
│  └─ npm run build           │
│  └─ Deploy to Render/S3     │
├─────────────────────────────┤
│  Post-Deploy Verification   │
│  └─ Insforge round-trip     │
│  └─ NEAR health check       │
│  └─ Compliance gate: mock   │
│     flags MUST be OFF in    │
│     production              │
└─────────────────────────────┘
```

### Pipeline 3: Opsera Scheduled Health Probe

Trigger: cron (`*/15 * * * *` — every 15 minutes).

```
1. POST /session/create with CI test patient
   └─ If B returns != 200 → alert #ops channel
2. POST /tool/log_rep with known rep
   └─ If Insforge write fails → Hummingbird AI analysis
3. POST /near/verify_session via C
   └─ If C returns != 200 or tx_hash has mock_ prefix → alert
4. GET /tool/patients
   └─ Validate response shape matches API_CONTRACT.md §1
   └─ If shape changed → flag breaking API drift
```

---

## How to Hook Up Opsera to Insforge (Agent Instructions)

### Step 1: Register the Insforge Tool in Opsera Tool Registry

Opsera's Tool Registry connects external services. Register Insforge as a **custom tool**:

```
Navigate to: Opsera Portal → Tool Registry → Add Tool

Name:               Insforge
Type:               REST API
Base URL:           https://api.insforge.dev
Authentication:     API Key (x-api-key header)
Health Check URL:   GET /collections (or any lightweight endpoint)
Categories:         Storage, Data Layer
```

This makes Insforge available in pipeline step pickers and health dashboards.

### Step 2: Enrich Pipeline Steps with Insforge Context

In the Pipeline Builder, each step can reference tool-registered services. For Computer B's deploy step, set environment variables via Opsera's env var injection:

```
Pipeline Step: "Deploy Computer B (Backend)"
Environment Variables (injected by Opsera):
  INSFORGE_API_URL   → {{tools.Insforge.base_url}}
  INSFORGE_API_KEY   → {{secrets.INSFORGE_API_KEY}}
  NEAR_ENDPOINT      → {{secrets.NEAR_ENDPOINT}}
```

Opsera secrets management encrypts `INSFORGE_API_KEY` at rest. Never hardcode it in repo files.

### Step 3: Configure Compliance Gates

Create a compliance policy in Opsera that enforces:

| Policy | Behavior |
|--------|----------|
| **Mock flag gating** | If `VITE_USE_MOCK=true` or B has no `INSFORGE_API_KEY` in production → **block deployment** |
| **Attestation health** | If C's `/near/verify_session` returns with `mock_` prefix for a staging/prod deployment → **open compliance ticket** |
| **Shape drift detection** | Compare B's response to `GET /tool/patients` against `API_CONTRACT.md` — if fields are missing or types change → **flag for review** |
| **Data persistence** | Deploy B, write a rep, restart B (simulate pod rotation), read back the rep — if data lost → **rollback** |

### Step 4: Gain Unified Insights

Opsera's Unified Insights dashboards surface:

- **DORA Metrics** per computer — deployment frequency, lead time, MTTR, change failure rate
- **Pipeline Health** — pass/fail rate per stage, flaky test detection
- **Insforge Health** — response time, error rate, availability from the health probe pipeline
- **NEAR Attestation Rate** — how many attestations per hour, tx_hash confirmation lag
- **Cross-Computer Dependency Graph** — A waits on B, B waits on C — spot which computer is the bottleneck

---

## Operational Runbooks (for the Coding Agent)

### Onboarding a New Developer

```bash
# The coding agent checks out repos
git clone https://github.com/your-org/formguard-frontend
git clone https://github.com/your-org/formguard-backend
git clone https://github.com/your-org/formguard-near

# The agent creates a dev environment in Opsera:
#   opsera-cli environment create --name dev-<developer> --pipeline formguard-deploy
# Opsera provisions ephemeral env, injects dev Insforge key, starts mock NEAR server

# The agent runs the full build-test pipeline against the developer's branch:
#   Pipeline runs → smoke test passes → Insforge validation passes → PR is ready for review
```

### Diagnosing a Failed Pipeline (Hummingbird AI integration)

When a build fails, the coding agent opens the Opsera pipeline run:

```
Pipeline Run #2841 — FAILED at "Integration Smoke Test"

Agent reads the step output:
  "curl: (7) Failed to connect to localhost:8000 — Connection refused"

Agent action:
  1. Check if B's process died → restart in supervisor
  2. Verify C is running → if mock NEAR is down, restart it
  3. Re-run the pipeline with the fix
  4. If the issue is Insforge API shape change → update API_CONTRACT.md
     (Opsera's Hummingbird AI surfaces the suggested diff)
```

### Promoting from Staging to Production

```
Coding agent pushes a release tag:
  git tag v1.2.0 && git push origin v1.2.0

Opsera picks up the tag → Deploy Pipeline triggered:
  STAGE: Approval Gate → notification sent to #ops
  → Agent (or human) approves in Opsera UI
  STAGE: Deploy C (NEAR contract upgrade)
  STAGE: Deploy B (FastAPI docker image tag)
  STAGE: Deploy A (Vite build → S3 bucket)
  STAGE: Post-deploy health probe (15 min watch window)

Agent monitors the watch window. If health probe fails:
  → Opsera auto-rollbacks to the previous stable pipeline
  → Agent debugs the failure
```

---

## File Layout (Opsera Configs)

```
opsera/
├── pipelines/
│   ├── build-test.yaml              # Pipeline 1: build & test all 3
│   ├── deploy-staging.yaml          # Pipeline 2a: deploy to staging
│   ├── deploy-production.yaml       # Pipeline 2b: deploy to prod (gate)
│   └── health-probe.yaml            # Pipeline 3: scheduled health
├── environments/
│   ├── dev.yaml                     # dev vars (mock NEAR, dev Insforge key)
│   ├── staging.yaml                 # staging vars (testnet NEAR, staging Insforge key)
│   └── production.yaml              # prod vars (real NEAR, prod Insforge key, mock must be OFF)
├── tools/
│   └── insforge.yaml                # Tool registry definition for Insforge
├── policies/
│   ├── mock-gate.yaml               # Block prod deploy if mock flags are on
│   ├── shape-drift.yaml             # Flag API shape mismatches
│   └── data-persistence.yaml        # Verify data survives pod rotation
└── agents/
    └── formguard-coding-agent.yaml  # Coding agent persona (see below)
```

---

## Coding Agent Configuration (Opsera Agents)

Opsera Agents are AI agents that operate inside your pipelines. Register a FormGuard coding agent that monitors the pipeline and takes autonomous action:

```yaml
# agents/formguard-coding-agent.yaml
name: formguard-ci-agent
persona: |
  You are a DevOps coding agent for the FormGuard project.
  You monitor Opsera pipelines, diagnose failures, and take corrective action.
  You know the API shapes in API_CONTRACT.md and can detect drift.
capabilities:
  - pipeline_monitoring
  - failure_diagnosis
  - api_shape_validation
  - rollback_initiation
channels:
  - slack: "#formguard-ops"
triggers:
  - pipeline_failure:
      step: "Insforge API Shape Validation"
      action: "check_insforge_api_key_and_url → suggest fix in PR comment"
  - pipeline_failure:
      step: "Integration Smoke Test"
      action: "restart_downstream_services → re-run pipeline"
  - compliance_violation:
      policy: "mock-gate"
      action: "block deployment → notify #ops with remediation steps"
```

---

## How This Integrates with the Hackathon Timeline

Opsera is not part of the 6-hour build — it's the **operational layer that runs after the hackathon**. No milestone in M1–M12 depends on Opsera. Instead:

| Phase | Opsera Role |
|-------|-------------|
| **Hackathon (M1–M12)** | Not touched. A, B, C build in isolation with mocks. |
| **Day after hackathon** | Register repos in Opsera. Create dev pipeline. Set up Insforge key injection. |
| **Week 1 post-hackathon** | Build-test pipeline green. Health probe running every 15 min. Insforge validation gates active. |
| **Week 2 post-hackathon** | Staging environment with real Insforge. Compliance policies enforced. Coding agent monitoring. |
| **Week 3+** | Production pipeline with approval gates. DORA metrics trending. Hummingbird AI analyzing failures. |

---

## Hard Rules

- **Opsera never proxies live traffic.** A, B, and C talk to each other directly. Opsera orchestrates *deployments* and *pipelines*, not runtime requests.
- **No SDKs or imports.** A, B, and C have zero awareness of Opsera. All integration is through repo hooks, env var injection, and HTTP health probes.
- **Secrets never in source.** `INSFORGE_API_KEY`, `NEAR_ENDPOINT`, `VITE_GEMINI_API_KEY` are injected by Opsera's secrets manager at deploy time.
- **Mock gates are non-negotiable.** If a production deploy pipeline runs with `VITE_USE_MOCK=true` or no `INSFORGE_API_KEY`, the pipeline must fail. Opsera's compliance policy enforces this.
- **API shape drift is a hard failure.** If a health probe response doesn't match `API_CONTRACT.md` §1–§3, the pipeline alerts. Opsera's shape-drift policy compares live responses against a stored OpenAPI spec derived from the contract.
- **One tool registry entry per external service.** Insforge, NEAR relay, and the GitHub repos all get tool entries. This lets pipeline steps reference them by name rather than hardcoded URLs.
