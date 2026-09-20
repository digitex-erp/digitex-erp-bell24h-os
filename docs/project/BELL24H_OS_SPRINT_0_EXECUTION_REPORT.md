# BELL24H-OS Sprint 0 — Merge Readiness, Impact Analysis & Sprint 1 Plan

**Repository:** `digitex-erp/digitex-erp-bell24h-os`
**Branch under review:** `feature/p0-remediation` (`42747e8`) vs `main` (`a231122`)
**Date:** 2026-09-20
**Scope constraint honored:** no new architecture audit, no repository discovery beyond
the `git diff` needed for Phase 3's impact analysis. Uses only:
`BELL24H_OS_RUNTIME_REALITY_CERTIFICATION.md`, `BELL24H_OS_REMEDIATION_MASTER_PLAN.md`,
`BELL24H_OS_P0_REMEDIATION_IMPLEMENTATION_PLAN.md`,
`BELL24H_OS_MASTER_ARCHITECTURE_RECONCILIATION.md`, and this session's own runtime tests
performed today on `feature/p0-remediation`.

---

## Phase 2 — P0 Merge Readiness Review

| Item | Verdict | Evidence |
|---|---|---|
| Mock removal | **READY** | Commit `65fdb24`. Re-ran the exact fabrication-language grep (`simulate`/`placeholder`/`setTimeout`/`dummy`/`fake`) against `server/workers/handlers/` — zero active matches, only past-tense explanatory comments. `tsc --noEmit` and full `npm run build` both pass |
| Worker activation | **READY** | Commit `42747e8`. Live-tested today: `GET /api/v1/workers/tick` with no `Authorization` header → `401`, audit-logged `cron.verify/denied`. Same route with correct `Authorization: Bearer <CRON_SECRET>` → `200`, audit-logged `cron.verify/success` |
| Queue processing | **PARTIAL — not fully verified** | `QueueManager.claimJobs()`'s `FOR UPDATE SKIP LOCKED` logic is unchanged, previously verified correct by direct code read across multiple sessions. Today's test exercised it against a **real but empty** queue (`claimedCount: 0`) — a genuine, honest result, but a full claim → execute → honest-failure → retry/dead-letter cycle against an actual queued job has never been run. This was explicitly deferred pending confirmation of which Supabase project the local `DATABASE_URL` points at — that confirmation was never returned |
| Cron endpoint security | **READY** | `requireCronAuth` modeled directly on the already-verified `requireServiceAuth` pattern (SHA-256 + `timingSafeEqual` constant-time comparison, fails closed on missing header/missing server secret/mismatch). Runtime-verified today, both branches (deny and allow) |
| Runtime validation | **PARTIAL** | Auth-gate path and empty-queue path both have real HTTP-response evidence — the strongest evidence tier this repo's own constitution recognizes. The job-execution path (a job actually being claimed, executed, and marked honestly failed) has only code-level evidence, not runtime evidence |

**Aggregate: 3 of 5 items READY, 2 of 5 PARTIAL — not a clean pass.** Per this
repository's own stated evidence discipline ("PASS requires every criterion to be a
genuine, evidenced pass... one unverified item means BLOCKED, not conditional pass"),
the honest checklist verdict is **NOT READY as a fully-verified pass.**

That is a different question from whether the merge is *safe* — addressed directly in
the Final Question below, since conflating "fully verified" with "safe to merge" would
repeat exactly the kind of unearned confidence Phase 1 (Gate C.2C) exists to guard
against.

---

## Phase 3 — Merge Impact Analysis

**Files Modified:**
| File | Change |
|---|---|
| `server.ts` | +20 lines — new import (`requireCronAuth`), new route `GET /api/v1/workers/tick` |
| `server/workers/WorkerRegistry.ts` | +74/-1 — `executeJob()` now returns `{outcome, error}` instead of `void`; new `processBatch(maxJobs)` method |
| `server/workers/handlers/MediaJobHandler.ts` | 116 lines replaced — both `processImageJob`/`processVideoJob` rewritten: fabricated success → honest `PROVIDER_NOT_CONFIGURED` failure |
| `server/workers/handlers/PublishingJobHandler.ts` | 47 lines replaced — same pattern, publishing handler |
| `vercel.json` | +6 lines — new `crons` array, once-daily schedule |

**Files Added:**
| File | Purpose |
|---|---|
| `server/middleware/requireCronAuth.ts` | New auth middleware, 97 lines, no dependencies beyond Node's built-in `crypto` and existing `audit.ts`/`errors.ts`/`requestContext.ts` |

**Routes Added:**
| Route | Method | Auth | Notes |
|---|---|---|---|
| `/api/v1/workers/tick` | GET | `requireCronAuth` (new) | Calls `WorkerRegistry.processBatch()`, returns a JSON summary |

**Environment Variables Added:**
| Variable | Required for | Failure mode if unset |
|---|---|---|
| `CRON_SECRET` | `requireCronAuth` to accept any request | **Fails closed** — `503 PROVIDER_UNAVAILABLE`, not an open door. Vercel auto-injects this as a Bearer token on its own cron-triggered requests once the variable is set in the project's environment settings — no separate wiring needed on the Vercel side |

**Breaking Changes:** **None identified.** `executeJob()`'s return-type change
(`void` → `{outcome, error}`) is additive/backward-compatible — its one existing caller
(`pollAndExecute()`'s fire-and-forget `.finally()`) never used the return value and is
untouched. No existing route, schema, or public contract changed shape.

**Migration Requirements:** **None.** No new tables, no schema changes — `processBatch()`
reuses `job_queue`/`job_workers` exactly as they exist today (`add_queue_core.sql`,
already applied). The only operational step is setting `CRON_SECRET` in Vercel's
environment settings before the cron route does anything beyond fail closed — not a
database migration.

---

## Phase 4 — Post-P0 Architecture State

Recalculated against the classification used throughout
`BELL24H_OS_MASTER_ARCHITECTURE_RECONCILIATION.md` (READY / PARTIAL / STUBBED / MOCKED /
DEAD CODE), incorporating today's work:

| Component | Pre-P0 (main, `a231122`) | Post-P0 (`feature/p0-remediation`, unmerged) |
|---|---|---|
| Worker Runtime | **DEAD CODE** — `WorkerRegistry.start()` never called in production (`api/index.ts` only calls `createApp()`) | **PARTIAL→READY** — reachable via `processBatch()` + cron route; auth-gate and empty-queue path runtime-verified; real-job path code-verified only |
| Queue Runtime | **DEAD CODE** in production (same root cause — nothing ever called anything that would run a claim) | **PARTIAL** — code correct and now reachable; full lifecycle unexercised (Phase 2 above) |
| Image Studio | **MOCKED** — `setTimeout` + fabricated `assetUrl`, `status='completed'` | **PARTIAL** — honest `status='failed'`, `PROVIDER_NOT_CONFIGURED`. Correctly not READY — no real provider is wired |
| Video Studio | **MOCKED** — identical pattern to Image Studio | **PARTIAL** — same honest-failure fix. Correctly not READY |
| Publishing Engine | **MOCKED** (handler) + **DEAD CODE** (enqueue side, zero callers, unchanged since at least Aug) | **PARTIAL** (handler now honest) + **DEAD CODE** (enqueue side untouched — this sprint didn't touch it, and shouldn't have; that's Sprint 2's scope per the Master Reconciliation roadmap) |
| Provider Manager | **READY** (text, 6 providers) / **DEAD CODE** (legacy browser path, by design) | **Unchanged** — this sprint did not touch the Provider Manager |

**Net movement:** two components moved from DEAD CODE toward PARTIAL/READY (Worker
Runtime, Queue Runtime — the only two this sprint targeted); three components moved
from MOCKED to the more honest PARTIAL (Image/Video/Publishing handlers); nothing moved
backward; nothing was claimed as READY that isn't.

---

## Phase 5 — Sprint 1 Execution Plan: Enterprise Video Factory

**Sprint Goal:** Convert Video Factory from PARTIAL/honest-failure (the state Phase 4
just established) to genuinely production-executable for **exactly one** real video
provider — not five studios at 35% each, one modality at 100%, per the Master
Reconciliation's own stated principle and this session's Runtime Reality
Certification's recommendation.

### 1. Architecture

Reuse, do not reinvent:
- **Provider adapter pattern** already proven for text (`server/ai/ProviderManager.ts` /
  `ProviderRouter.ts`, 6 real providers) — a video adapter should be a sibling module,
  not a parallel architecture.
- **Job dispatch** already exists: `WorkerRegistry.executeJob()` routes `job_type ===
  "video"` to `MediaJobHandler.processVideoJob()`. That method's current honest-failure
  throw becomes a real provider call, falling back to the same honest failure when no
  provider is configured — the fallback path from this session's Phase 2 work is not
  discarded, it becomes the "provider unavailable" branch of real logic, not the whole
  of it.
- **Open design question, not yet resolved by this plan:** video generation from
  real providers (this repo's own `VideoStudioPage.tsx` already lists MiniMax,
  Open-Sora, CogVideoX, LTX Video, Hunyuan Video as UI options) is typically an
  asynchronous *create-task → poll-task → download-result* flow taking anywhere from
  30 seconds to several minutes — longer than a single Vercel serverless invocation
  should hold open, and longer than the once-daily cron tick's own interval would make
  practical to poll synchronously within one `processBatch()` call. Sprint 1 must
  decide, as its own first design step: does a video job stay `running` across
  multiple cron ticks (tick 1 creates the provider task and stores its task ID; tick N
  polls and completes it), or does this require a different trigger mechanism than the
  once-daily cron entirely? This is an architecture decision for Sprint 1's own design
  phase, not resolved here — flagging it now is the point of naming it in this plan.

### 2. Tables Required

**None new.** `video_projects`, `video_jobs`, `video_assets` already exist
(`add_video_studio_tables.sql`, `add_video_storage.sql`), are organization-scoped, and
their create/read paths are already real (`MASTER_MODULES.md`). If the async
create-task/poll-task pattern above is chosen, `video_jobs` likely needs one additive
column (e.g., `provider_task_id`) — a small, additive migration, not a redesign.

### 3. APIs Required

No new client-facing route is required for MVP — `VideoStudioPage.tsx`'s existing
"Generate Video" action already calls `enqueueJob()` against the real `job_queue`. The
only new surface is internal: a video-provider credential resolver, following
`ProviderManager.ts`'s existing pattern (env-var-backed, fails closed, never reaches the
browser).

### 4. Services Required

One new `VideoProviderAdapter` (or one per provider, behind a shared interface) invoked
from `MediaJobHandler.processVideoJob()`, replacing the current unconditional
`PROVIDER_NOT_CONFIGURED` throw with: if a provider is configured, call it for real; if
not, keep the existing honest-failure behavior unchanged. This is strictly additive to
Phase 2's fix, not a reversal of it.

### 5. Provider Adapters Required — evaluated from this repo's own existing UI options

| Candidate | Real evidence in this repo already | Recommendation |
|---|---|---|
| MiniMax | `BELL24H_OS_FULL_PRODUCT_AUDIT.md`: the *only* one of the five dropdown options with any adapter code at all today (routes through the dead legacy browser path) | **Start here** — closest to already having a path, hosted commercial API (no self-hosting/infra burden), matches the server-side-credential pattern already proven for the 6 text providers |
| Open-Sora, CogVideoX, LTX Video, Hunyuan Video | UI labels only, zero backend code of any kind (`FULL_PRODUCT_AUDIT.md` §4) | Defer — typically self-hosted/GPU-hosted, a materially larger infrastructure commitment than this sprint's "prove one real path" scope |

### 6. Risks

| Risk | Mitigation |
|---|---|
| Video generation latency exceeds a single request/tick window | Resolve the async task-ID/polling design question (Section 1) before writing the adapter, not after |
| Real provider API key acquisition | Owner action — this session does not request or hold credentials; the adapter should be written and testable in its honest-failure mode before any key exists, exactly as `ProviderManager.ts` already does for unconfigured text providers |
| Cost overrun on a real, billed provider | Reuse the existing per-org daily budget pattern (`ProviderRouter.ts`) for the new adapter — already flagged elsewhere in this repo's own docs as in-memory/non-durable; acceptable for Sprint 1's single-provider scope, but should not be forgotten when Video Factory scales beyond it |
| Re-fabricating success under schedule pressure | The Definition of Done below is the guard against this — a real, playable asset URL is the only acceptable evidence of "done," not a job reaching `completed` status alone |

### 7. Definition of Done

A user submits a video generation job through the existing Video Studio UI and receives
a **real, playable video asset** — a URL that resolves to actual video content
generated by the configured provider, not a fabricated string. No `setTimeout`. No
simulated success. No new fabricated URL pattern. If the provider is not configured,
the job fails honestly with `PROVIDER_NOT_CONFIGURED`, exactly as Phase 2 already
established — Sprint 1 adds a real success path alongside that failure path, it does
not remove the failure path's honesty.

---

## FINAL QUESTION

**Can `feature/p0-remediation` be safely merged into `main`? Answer only with evidence.**

**Yes, with one named, non-blocking gap disclosed at merge time — not silently.**

Evidence for "safe":
- No fabrication was introduced; fabrication was removed (Phase 2 above, verified by
  grep + build).
- No breaking change to any existing contract, route, or schema (Phase 3 above).
- A rollback point exists and was created before this branch's first commit
  (`v0.7-pre-remediation`, tagged and pushed at `a231122`) — a `git revert` of the merge
  commit fully restores `main` to its pre-P0 state with no data-layer cleanup required,
  since no migration ran.
- Every new code path fails closed by design (`requireCronAuth`'s three failure
  branches all deny; `processBatch()`'s claim-error branch returns an honest empty
  result rather than throwing past the caller).

Evidence for the disclosed gap:
- The full claim → execute → honest-failure → retry/dead-letter cycle has not been
  runtime-tested against a real queued job (Phase 2 above). This is a **verification
  gap in a code path that reuses already-proven logic** (`QueueManager`'s claim/fail
  methods, unchanged by this sprint), not a new, unproven mechanism — which is why it
  does not rise to "unsafe to merge," but it is also not nothing, and this report does
  not round it up to a clean pass.

**Recommendation:** merge, and record the deferred test as the first action item of
whichever sprint runs next against a confirmed dev/test database — not as a precondition
for this specific merge, since the merge itself introduces no fabrication and has a
proven rollback path.

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GyjerP42mTVzzK2ZkSeRCf
