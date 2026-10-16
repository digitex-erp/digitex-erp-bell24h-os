# InsForge Verification Report — Bell24h-OS

**Repository:** `digitex-erp-bell24h-os` (branch `main`, working tree unrelated to this audit)
**InsForge project:** `Bell24h-os-VyaparSethu` (`6273a408-374a-46fd-9693-108db11eaf64`), region `us-east`, backend `r8fgym8r.us-east.insforge.app`
**CLI version:** `0.2.8`
**Date:** 2026-09-28
**Method:** Live CLI execution against the linked InsForge project. No pre-existing test suite was found (see Phase 1). All "verified" claims below come from CLI output or logs I captured directly; everything else is marked UNVERIFIED. All resources created during this audit (`cert-smoke-hello` function, `cert-smoke-schedule` schedule, `CERT_SMOKE_TEST` secret) were deleted afterward and confirmed gone.

---

## Phase 1 — Inspect: the claimed test suite does not exist

Searched this repo, the sibling git worktree, and the entire home directory (`C:\Users\Sanika`) for:

- `test-1-hello-world.js`, `test-2-secret-access.js`, `test-3-call-github.js`, `test-4-query-neon.js`, `test-5-stability-test.js`
- `DEPLOYMENT_GUIDE.md`, `TEST_VERIFICATION_CHECKLIST.md`, `TEST_SUITE_SUMMARY.txt`

**Result: none of the 8 files exist anywhere on this machine.** `README.md` exists but is this repo's own unrelated README. `DEPLOYMENT_GUIDE.md` hits found elsewhere all belong to a completely different, unrelated codebase (`Projects/bell24h*`, Next.js + MSG91). `insforge functions list` also returned "No functions found" before this audit began, confirming nothing was deployed either.

**Conclusion:** the "planning phase" described in the mission brief was not actually saved to disk or to the InsForge project. I did not fabricate an inspection of missing files, and I did not build the fictional 5-test suite. Instead I ran the smallest live smoke test needed to get real evidence for Phases 3–4 (below), and deleted it when done.

---

## Phase 2 — InsForge CLI audit

| Command | Result |
|---|---|
| `insforge --version` | `0.2.8` |
| `insforge --help` | 30 top-level commands: `login, logout, whoami, create, current, list, docs, feedback, link, orgs, projects, branch, db, functions, storage, deployments, secrets, logs, metadata, diagnose, advisor, payments, billing, usage, backups, compute, posthog, webscraper, ai, domains, memory, schedules, local, config` |
| `insforge functions --help` | `list, code, deploy, invoke, delete` |
| `insforge schedules --help` | `list, get, create, update, delete, logs` |
| `insforge secrets --help` | `list, get, add, update, delete, rotate` |

No missing or unsupported commands were found relative to the mission's Phase 2/3 checklist (functions, schedules, secrets, logs, invocation are all present as first-class command groups).

---

## Phase 3 — Deployment validation (live-executed, not guessed)

| Capability | Status | Evidence |
|---|---|---|
| Function deployment | **VERIFIED** | `insforge functions deploy cert-smoke-hello --file hello.js` → `✓ Function "cert-smoke-hello" creation success` → `https://r8fgym8r.function2.insforge.app` |
| Function invocation (CLI) | **VERIFIED** | `insforge functions invoke cert-smoke-hello --method GET` → `{"ok":true,"msg":"cert-smoke hello","ts":...}` |
| Function invocation (raw HTTP, unauthenticated) | **VERIFIED** | `curl https://r8fgym8r.function2.insforge.app/cert-smoke-hello` → `HTTP 200` |
| Secret management | **VERIFIED** | `secrets add CERT_SMOKE_TEST ...` → created; `secrets list` showed it plus 7 pre-existing reserved secrets (`VERCEL_WEBHOOK_SECRET`, `JWT_KEY_ID`, `JWT_PUBLIC_KEY`, `JWT_PRIVATE_KEY`, `JWT_SECRET`, `INSFORGE_BASE_URL`, `ANON_KEY`, `API_KEY`); `secrets get` returned the plaintext value; `secrets delete` removed it |
| Logs | **VERIFIED** | `logs function.logs` and `logs insforge.logs` both returned real, timestamped structured JSON log lines |
| Schedule creation/listing/deletion | **VERIFIED** | `schedules create --cron "*/5 * * * *" --url <fn-url> --method GET` returned an id and `cronJobId`; appeared in `schedules list`/`get`; deleted cleanly |
| **Schedule → function invocation actually firing correctly** | **FAILED (reproduced twice)** | `schedules logs` showed **two consecutive real cron firings** (19:35:00Z and 19:40:00Z) each returning `statusCode: 403, success: false`, against the same URL that succeeded via CLI invoke and raw curl seconds apart. This is a genuine defect, not a guess — reported to InsForge as feedback (id `14537cb1-af8e-48ed-b27c-f55718ae5205`, severity `major`). |

**Exact commands used** (for reproducibility):
```bash
insforge functions deploy cert-smoke-hello --file hello.js
insforge functions invoke cert-smoke-hello --method GET
insforge secrets add CERT_SMOKE_TEST "smoke-value-123"
insforge schedules create --name cert-smoke-schedule --cron "*/5 * * * *" \
  --url https://r8fgym8r.function2.insforge.app/cert-smoke-hello --method GET --json
insforge schedules logs <schedule-id> --json
```

---

## Phase 4 — Bell24h-OS architecture assessment

| Capability | Classification | Evidence |
|---|---|---|
| A. Automation Hub | **PARTIAL** | Function deploy/invoke works. Scheduling exists as a command surface but its actual trigger→function path failed 2/2 live tests (see Phase 3). Cannot be trusted as an automation hub until that's fixed. |
| B. Notification Scheduler | **NOT SUPPORTED (as verified)** | Same underlying mechanism (`schedules` → HTTP call to a function) is the one that failed live. No notification-specific primitive (email/SMS/push) exists in the CLI surface at all — `docs`/`--help` show no messaging command group. |
| C. Workflow Orchestrator | **UNVERIFIED** | No workflow/DAG primitive exists in the CLI (no `workflows`, no step-chaining command). Would have to be hand-built in application code calling functions/schedules — and the scheduler leg of that chain is currently broken. |
| D. AI Job Scheduler | **UNVERIFIED** | `ai setup`/`ai overview` commands exist (OpenRouter-backed Model Gateway) but were not exercised — running them would touch real spend/keys, which is outside this audit's scope. Combining AI Gateway with `schedules` inherits the same unverified/failing trigger path. |
| E. Background Task Engine | **PARTIAL** | `compute` command group (Docker containers on Fly.io, source or image mode) exists per `--help` and is a real, separate execution surface from edge functions — but deployment was not attempted in this audit, so its actual behavior is UNVERIFIED, only its command surface is confirmed. |

---

## Phase 5 — Supabase / Neon / InsForge / Bell24h-OS responsibility split

This is a recommendation, built only on facts verified in this audit plus facts from prior certification passes on this same repo (which were themselves evidence-based, not assumed):

- **Confirmed fact:** `main` has **zero references** to `@insforge/sdk` or the InsForge backend anywhere in `src/`, `server/`, or `server.ts`. InsForge was linked to this repo for the first time in this session; it is not currently wired into any app code.
- **Confirmed fact (prior audit, still valid):** the app's real auth, RLS, organizations/profiles/roles, AI provider tables, Prompt Studio, and Image Studio all live in **Supabase**, accessed via `supabase-js` from the browser and via `requireAuth`/`postgrestFetch` on the server.
- **Confirmed fact (prior audit):** the queue/worker system (`job_queue`, `QueueManager`, `WorkerRegistry`) uses a pooled `pg.Pool` against `DATABASE_URL` — a separate Postgres connection from Supabase's RLS-respecting REST path. This repo's own skill docs identify that pooled connection's target as Neon in some contexts; I did not independently re-verify the Neon identity in this session.
- **Confirmed fact (this audit):** this InsForge project has its own live Postgres, its own auth/JWT secrets, its own storage, and — per `diagnose` — real resource usage (63% disk, 52% memory), meaning it is not an empty sandbox; it already carries state.

**Recommendation, given only the above:**

| Concern | Recommended owner | Why |
|---|---|---|
| Authentication, RLS, Organizations, Profiles | **Supabase** (unchanged) | Already implemented and load-bearing; migrating is a large, unjustified rewrite with no verified InsForge advantage shown here. |
| Marketplace, RFQs | **Supabase** (unchanged) | Same schema/RLS model already governs these tables. |
| AI Providers | **Bell24h-OS server (`server/ai/ProviderRouter`)**, unchanged | Already a real, working router with circuit breakers, verified in a prior pass. |
| Video Studio | **Undetermined — not covered by this audit or the prior repo audits.** No evidence either way. |
| SHAP / LIME, Knowledge Graph | See Phase 6 | Neither exists in this app today per prior source audits. |
| Communication Hub | **Not currently implementable on InsForge's scheduler as verified today** | The scheduler is the natural transport for scheduled/recurring messages, and it just failed live testing. Do not build Communication Hub delivery on `insforge schedules` until the 403 finding is resolved. |
| Scheduling (generic cron/background jobs) | **Do not adopt yet** | Same reason — the only scheduling primitive I could test failed 2/2 live executions. |
| Neon (pooled Postgres, if distinct from Supabase) | **Unchanged, unverified role** | Not exercised in this audit; no new evidence for or against its current use. |

I am not recommending any migration of existing, working Supabase-backed functionality onto InsForge based on this audit — the one InsForge capability most relevant to new automation work (scheduling) is the one capability that failed live verification.

---

## Phase 6 — SHAP / LIME feasibility

- **InsForge edge functions run on Deno** (confirmed via `function.logs`: `"isDenoConfigured":true`, `"Fetching function logs from Deno Deploy"`). Deno cannot natively run Python, and SHAP and LIME are Python libraries with native (numpy/scipy-linked) dependencies. **Edge functions cannot directly execute SHAP or LIME.**
- **`insforge compute`** deploys arbitrary Docker containers (source-with-Dockerfile or pre-built image, on Fly.io). This is architecturally capable of hosting a Python service that runs SHAP/LIME — but this was **not tested** in this audit (no container was deployed), so this is a capability-exists claim from `--help` output only, not an execution-verified one.

**Recommendation:** InsForge should only **trigger** SHAP/LIME/RFQ-explainability/trust-scoring jobs, never execute them in an edge function. If InsForge is used at all for this, the correct shape is: edge function or schedule enqueues a job → a `compute` (Docker/Fly.io) service or the existing Bell24h-OS worker fleet runs the actual Python SHAP/LIME computation → result written back to Supabase. Given the scheduler defect in Phase 3, the "trigger" leg of that chain is not currently trustworthy either, and would need to be re-verified after that bug is fixed.

---

## Summary

### 1. Verified facts
- InsForge CLI 0.2.8 is installed and authenticated as `bell24h.info@gmail.com`, linked to project `Bell24h-os-VyaparSethu`.
- Function deploy, invoke (CLI and raw HTTP), list, delete: all work.
- Secret add, list, get, delete: all work.
- Schedule create, list, get, delete: all work as CRUD operations.
- Logs (`function.logs`, `insforge.logs`): both return real data.
- **Schedule-triggered function invocation fails with HTTP 403, reproduced on 2 of 2 real cron firings**, while direct invocation of the identical URL succeeds. Reported to InsForge (feedback id `14537cb1-af8e-48ed-b27c-f55718ae5205`).
- `main` has no existing InsForge integration in app code.
- The InsForge project already carries real disk/memory usage — it is not a blank sandbox.
- The claimed pre-existing test suite and documentation (Phase 1) do not exist anywhere on this machine.

### 2. Unverified assumptions
- Whether `insforge compute` (Docker/Fly.io) actually deploys and runs a working container — command surface only, not executed.
- Whether `insforge ai` (Model Gateway) is configured with a real key, or its spend/limits — not exercised.
- Whether the 403 schedule defect is specific to this project, this function, or systemic to InsForge schedules generally.
- The current identity/role of "Neon" in this repo's architecture — not re-verified in this session.
- Video Studio's backend, and any Knowledge Graph implementation — no evidence either way in this or prior audits.

### 3. Risks
- **High:** building any recurring/notification/automation feature on `insforge schedules` today would inherit a reproduced, unresolved 403 failure.
- **Medium:** this InsForge project already has live state (disk/memory usage); treat it as a real environment, not a disposable test project, for any future work.
- **Low:** the InsForge `link` step (run just before this audit) rewrote `C:\Users\Sanika\AGENTS.md` and modified this repo's `.gitignore`; both are already accounted for and `.insforge/project.json` (which holds the project's API key) is correctly gitignored.

### 4. Architecture recommendation
Keep Supabase as the system of record for auth/RLS/tenant data and the existing `server/ai` router for AI providers, unchanged. Do not move Communication Hub, notification, or workflow-orchestration work onto `insforge schedules` until the 403 defect above is fixed and re-verified. `insforge compute` is the only InsForge surface architecturally suited to SHAP/LIME, but it is unexercised.

### 5. Bell24h-OS automation strategy
No changes recommended to the existing Bell24h-OS Postgres-native queue (`QueueManager`/`WorkerRegistry`, verified working in a prior pass) in favor of InsForge scheduling. If InsForge is adopted later, use it only as a trigger/enqueue layer feeding that existing worker fleet or a `compute` service — never as the execution engine for scheduled jobs until Phase 3's finding is resolved.

### 6. Production readiness score
**2 / 10** for "InsForge as a Bell24h-OS automation backend," as of this audit. Core primitives (functions, secrets, logs) are solid; the one automation-relevant primitive tested end-to-end (scheduling) failed reproducibly.

### 7. Go / No-Go recommendation
**No-Go** for adopting InsForge scheduling in Bell24h-OS today. **Conditional Go** for InsForge edge functions and secrets management in isolation, where no scheduler is involved. Revisit after the 403 finding is resolved and a second live re-test passes.
