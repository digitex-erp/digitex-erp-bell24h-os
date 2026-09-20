# BELL24H-OS P0 REMEDIATION IMPLEMENTATION PLAN

**Repository:** `digitex-erp/digitex-erp-bell24h-os` (`main @ 5629b87`)
**Scope:** planning only. No code modified, no PR created. Findings taken as accepted
evidence per this mission's own instruction — not re-audited. One additional structural
fact was confirmed fresh this turn (method signatures on `WorkerRegistry`/
`WorkerSupervisor`), since Phase 2's file-impact analysis requires knowing the exact
shape of what exists, not just that it exists.
**Date:** 2026-09-20

---

## PHASE 1 — Remediation Design

### Blocker 1 & 2: Worker Runtime / Queue processing do not execute in production

**Root Cause:** `api/index.ts` (the actual Vercel serverless entry point) calls only
`createApp()`. `WorkerRegistry.start()`/`WorkerSupervisor.start()`'s one call site
(`server.ts:700-701`) lives inside `startServer()`'s `app.listen()` callback — a
persistent-process startup path Vercel's serverless runtime never executes. This is
the same underlying fact as Blocker 5 ("production execution path differs from local
execution path") — not a separate defect, the general statement of this one.

**Impact:** Every feature depending on background execution (Video/Image generation,
Publishing, any future job type) is inert in production regardless of its own
correctness — jobs accumulate at `queued` forever.

**Recommended Fix:** Do **not** try to make `.start()` run inside a serverless
invocation — `WorkerRegistry.start()` depends on `pollTimeout`/`heartbeatInterval`
(internal `setInterval`/`setTimeout` loops, confirmed by its own private fields),
which cannot survive a serverless function returning. Instead, add a **bounded,
single-pass processing method**, modeled directly on the pattern
`WorkerSupervisor.runReaperTick()` already uses in this exact codebase
(`async runReaperTick(): Promise<{ deadWorkersCount, reapedJobsCount }>` — claims,
does one unit of work, returns a result, no timers). A sibling method on
`WorkerRegistry` — e.g. `processBatch(maxJobs): Promise<{claimed, completed, failed}>`
— would claim up to N ready jobs via the existing `QueueManager` and dispatch each to
the existing `aiHandler`/`mediaHandler`/`publishingHandler` instances (already private
fields on `WorkerRegistry`), then return. Expose this behind a new, secret-gated route,
and drive it with a Vercel Cron entry. This reuses 100% of the existing claim logic and
handler dispatch — no new queue system, no new worker abstraction, no second
deployment target.

**Risk Level:** MEDIUM. The change is additive and reuses proven code, but it is the
one change that actually turns job execution on in production — anything wrong in the
new batch method or its secret-gating is now live-reachable for the first time.

**Estimated Complexity:** LOW-MEDIUM. One new method (small, closely modeled on an
existing one), one new route, one `vercel.json` addition.

### Blocker 3: Media generation contains simulated execution paths

**Root Cause:** `MediaJobHandler.processImageJob`/`processVideoJob` `setTimeout` then
mark the job `'completed'` with a fabricated asset URL — no call to any real
generation provider exists in either method.

**Impact:** Currently dormant (Blockers 1-2 mean these methods never run in
production) — but this is the single most dangerous blocker to leave unaddressed
*after* 1-2 are fixed. The moment job execution turns on, these two methods would
begin reporting fabricated success as real, silently, to real users.

**Recommended Fix — two distinct stages, not one, and the distinction matters for the
Final Question below:**
- **Stage A (in scope for "smallest and safest," no new capability):** replace the
  `setTimeout` + fake-success block with an honest failure/pending state — e.g. mark
  the job `failed` with `error: "No generation provider configured"` — mirroring the
  exact fix pattern already shipped in this repo for Dashboard/AdminService/
  DatabasePage (the earlier TASK-06 fabricated-status remediation). This requires no
  new provider, no new architecture — only removing a lie.
- **Stage B (explicitly separate, larger, new capability — not a "fix"):** wire a real
  image/video generation provider, following the same adapter shape already proven for
  Gemini/NVIDIA/DeepSeek/Qwen/GLM/MiniMax in `server/ai/`. This is net-new
  construction and is why it is sequenced later, not part of P0.

**Risk Level:** LOW for Stage A (purely subtractive/corrective on code that doesn't
currently run). MEDIUM for Stage B (new external dependency, new failure modes to
handle).

**Estimated Complexity:** LOW (Stage A — a few lines per method). HIGH (Stage B — a
full new provider integration, out of this plan's scope).

### Blocker 4: Publishing contains simulated execution paths

**Root Cause:** `PublishingJobHandler`'s dispatch `setTimeout`s then reports success,
identical pattern to Blocker 3. Additionally — and this is a second, independent gap
— `PublishingCenterService.enqueuePublishingTask()`, the only method that would ever
create a job for this handler, has zero callers anywhere in the repository. This
handler is unreachable from *both* directions today.

**Recommended Fix:** Same two-stage treatment as Blocker 3 (Stage A: honest failure;
Stage B: real channel integration). The reachability gap (nothing calls
`enqueuePublishingTask`) is a **separate, third piece of work**, not fixed by either
stage — noted here so it isn't assumed solved as a side effect of fixing the handler.

**Risk Level:** LOW for Stage A. The reachability gap itself is zero risk to fix
(wiring a UI button to an existing method) but is a distinct task.

**Estimated Complexity:** LOW (Stage A). MEDIUM (wiring the UI create-action). HIGH
(Stage B, real channel integration).

### Blocker 5: Production execution path differs from local execution path

Not a sixth, separate defect — the general statement of Blockers 1-2's root cause.
No separate fix is designed for this; fixing 1-2 resolves it. Recorded here only so it
isn't mistaken for outstanding work once 1-2 are closed.

---

## PHASE 2 — File Impact Analysis

| File | Purpose | Why Modification Required | Expected Change |
|---|---|---|---|
| `server/workers/WorkerRegistry.ts` | Owns job claiming + handler dispatch | Needs a bounded, serverless-safe entry point; none exists today (`start()`/`stop()` are both continuous-loop-oriented) | Add one new method, e.g. `processBatch(maxJobs)`, modeled on `WorkerSupervisor.runReaperTick()`'s shape — claims up to N jobs, dispatches to the existing `aiHandler`/`mediaHandler`/`publishingHandler`, returns a summary. Does not touch `start()`/`stop()` or their internal timers. |
| `server.ts` | Express route registration | Needs a new route to trigger the bounded batch method, gated so only Vercel's own cron (or an equivalent trusted caller) can invoke it | Add one new route (e.g. `POST /api/v1/jobs/tick`), protected by a new shared-secret check (this repo has no existing cron-secret pattern — confirmed this turn — so this is a small, new, additive guard, not a reuse of something already present) |
| `vercel.json` | Deployment/cron configuration | No `crons` key exists today | Add one `crons` entry pointing at the new tick route, on an interval matched to acceptable job latency and the Vercel plan's cron granularity limits (a cost/plan decision, not purely technical — flag for confirmation before implementing) |
| `server/workers/handlers/MediaJobHandler.ts` | Processes image/video jobs | `processImageJob`/`processVideoJob` currently fabricate success | Remove the `setTimeout` + fake-`completed` block in both methods; replace with an honest `failed` outcome and a clear reason string (Stage A only — no provider call added here) |
| `server/workers/handlers/PublishingJobHandler.ts` | Processes publishing jobs | Dispatch is simulated | Same treatment as above |
| `src/modules/publishing-center/PublishingCenterService.ts` / `PublishingCenterPage.tsx` | Publishing UI + enqueue method | `enqueuePublishingTask()` has zero callers | Separate, smaller task: wire an existing or new UI action to call this method — not required for Blocker 4's Stage A fix, but required before Publishing can be exercised at all |

**Not required for this plan's scope, listed so they aren't assumed included:** any new
file under `server/ai/` or equivalent for a real image/video/publishing provider
(Stage B for Blockers 3-4) — genuinely new construction, a separate, later plan.

---

## PHASE 3 — Implementation Order

**Step 1 — Remove the fabrication (Blockers 3 & 4, Stage A only).**
No dependency on anything else; safe to do first regardless of Blocker 1-2's status,
since these methods don't currently run in production either way.

**Step 2 — Add the bounded batch method + tick route + cron registration (Blockers
1 & 2).**
**Must happen after Step 1, never before.** This is the one sequencing rule that
matters most: turning on execution before removing the fabrication would make the
first real jobs processed in production report fake success. Step 1 makes that
impossible by construction before Step 2 makes execution possible at all.

**Step 3 — Verify end-to-end** (see Phase 4) before considering P0 closed.

**Step 4 — (separate plan, not part of this one) Stage B:** real provider/channel
integration for Image/Video/Publishing, plus the Publishing reachability wiring.
Sequenced after Step 3 is confirmed stable, since it builds on a now-honestly-working
foundation rather than a still-fabricating one.

**Dependency summary:** Step 2 depends on Step 1. Step 3 depends on Step 2. Step 4
depends on Step 3. No step in this plan depends on Step 4.

---

## PHASE 4 — Verification Plan

### Worker/Queue activation (Steps 1-2 combined effect)

- **Verification Steps:** Enqueue a real job via the existing `POST
  /api/v1/queue/enqueue` route. Wait one cron interval. Query job status (via
  `GET /api/v1/queue/metrics`, or a direct row check).
- **Success Criteria:** Job transitions `queued` → `processing` → a terminal state
  (`completed` or `failed`) within one tick cycle, without manual intervention.
- **Failure Criteria:** Job remains `queued` past two or more tick intervals.
- **Production Validation Method:** The already-existing `GET /api/v1/workers/status`
  route (`server.ts:358-372`) — currently would report a never-started state per the
  Runtime Reality Certification; after this fix, an authenticated call to it should
  show real, non-zero processing activity.

### Fabrication removal (Blockers 3 & 4, Stage A)

- **Verification Steps:** Enqueue an image or video job, allow it to be claimed and
  processed (post Step 2), inspect the resulting `image_jobs`/`video_jobs` row.
- **Success Criteria:** Row shows an honest `failed` status with a clear reason —
  never `completed` with a fabricated URL.
- **Failure Criteria:** Row shows `completed` with an `assetUrl` that returns 404/
  does not exist when fetched directly.
- **Production Validation Method:** One direct HTTP check against a resulting
  `assetUrl` — confirms it was never claimed as real when it isn't.

---

## PHASE 5 — MVP Certification Forecast

**After this plan's scope (Steps 1-3 only — Stage A + activation, not Stage B):**

| Area | READY | PARTIAL | MOCKED | STUBBED |
|---|---|---|---|---|
| Queue Runtime | 100% | 0% | 0% | 0% |
| Worker Runtime | 100% | 0% | 0% | 0% |
| Image Studio | 0% | 0% | **0%** | 100% |
| Video Studio | 0% | 0% | **0%** | 100% |
| Publishing Engine | 0% | 0% | **0%** | 100% (and still unreachable pending the separate wiring task) |
| AI Provider Manager | unchanged — not addressed by this plan; remains at its own "runtime verification pending" status per `docs/AI_ROUTER_LIVE_RUNTIME_CERTIFICATION.md` | | | |

The MOCKED column reaching 0% across Image/Video/Publishing is the actual point of
this plan — it does not mean those three become READY. It means they stop lying about
what they can do. Reaching READY on those three requires Stage B, a separate plan.

---

## OUTPUT

**1. Root Cause Matrix, 2. File Impact Matrix, 3. Implementation Order, 4.
Verification Checklist, 5. Production Readiness Forecast** — Phases 1, 2, 3, 4, 5
above, respectively.

**6. Risk Assessment:** highest risk in this plan is Step 2 (new code that actually
turns on production execution for the first time) — mitigated by doing it only after
Step 1 removes the fabrication, and by modeling the new method directly on
`runReaperTick()`'s already-proven bounded shape rather than inventing a new
execution pattern. Lowest risk is Step 1 (purely subtractive, on code that doesn't
currently run).

---

## FINAL QUESTION

**What is the smallest and safest set of changes required to move Bell24h-OS from
MOCKED EXECUTION to REAL EXECUTION without introducing architectural changes?**

The honest answer splits in two, and collapsing it into one would overstate what the
small path actually achieves:

- **For Queue Runtime and Worker Runtime: the smallest safe change reaches genuine
  REAL EXECUTION.** One new bounded method (modeled on an existing pattern already in
  this codebase), one new route, one cron entry — no architectural change, no new
  deployment target, full reuse of the existing claim logic.
- **For Image Studio, Video Studio, and Publishing Engine: the smallest safe change
  reaches honest STUBBED, not REAL EXECUTION.** There is no way to shrink the gap
  further than that, because no real generation or publishing capability exists
  anywhere in this codebase to reuse — reaching REAL EXECUTION for these three
  unavoidably requires at least one new provider or channel integration each (Stage
  B), which is new construction, not a fix, and is correctly excluded from this P0
  plan's scope rather than smuggled in as if it were smaller than it is.

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GyjerP42mTVzzK2ZkSeRCf
