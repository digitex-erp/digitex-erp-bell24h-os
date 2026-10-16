# Bell24h-OS — Implementation Sprint Backlog (Video Factory-led, per this audit)

Ordered by risk and dependency, per Phase 8's own instruction list. Each item: scope, dependencies, expected files, acceptance criteria, tests, rollback. Nothing in this backlog has been implemented — this audit was read-only except for its own report files.

## 1. Fix Video Studio's silent-failure UX (smallest, highest-leverage fix)

**Scope:** add real error surfacing to every async handler in `src/pages/VideoStudioPage.tsx` (`fetchProjects`, `handleCreateProject`, `handleGenerate`, `fetchJobsAndAssets`) — a visible error banner/toast instead of `console.error`-only, and check the `profiles` lookup's own `error` field instead of silently bailing on `if (!orgData?.organization_id) return`.
**Dependencies:** none — pure frontend change, no schema/migration/provider work needed.
**Expected files:** `src/pages/VideoStudioPage.tsx` only.
**Acceptance criteria:** a forced failure (e.g. temporarily revoking a test account's org assignment) produces a visible, specific error message, not silence.
**Tests:** none exist for this page today; this fix should not be blocked on building a frontend test harness first (consistent with how the Call Scripts UI batch elsewhere in this engagement found its own harness-less equivalent acceptable for a first pass) — but adding one should be considered alongside Item 2 below if a harness is approved for this page.
**Rollback:** trivial — a frontend-only diff, revertable with no data implications.

## 2. Change the worker-tick cron cadence (or add an on-demand trigger)

**Scope:** `vercel.json`'s `crons` entry currently fires once daily. Either shorten the interval (Vercel's cron minimum is 1-minute granularity on some plans — verify the actual plan's limits before committing to a number) or add a second trigger path (e.g., the job-creation request itself calling `/api/v1/workers/tick` immediately after insert, in addition to the safety-net daily cron).
**Dependencies:** none technical; may have a cost/plan implication (more frequent serverless invocations) worth flagging to the project owner before changing.
**Expected files:** `vercel.json`, possibly `JobOrchestratorService.ts`/`VideoStudioPage.tsx` if adding an immediate-trigger call.
**Acceptance criteria:** a job created outside the midnight window is picked up and marked `failed` (honestly, since no provider exists yet) within a reasonable window (minutes, not hours) — verifiable without implementing a real provider at all, since the honest-failure path already works end-to-end.
**Tests:** a new integration test exercising enqueue → tick → status update, reusing the existing `job_queue`/`WorkerRegistry` test patterns already established for Voice Studio's equivalent flow in this engagement.
**Rollback:** trivial config change, revertable.

## 3. Delete the dormant client-side video/image job processor

**Scope:** remove `src/modules/job-orchestrator/JobWorker.ts`'s video/image dispatch paths (or the whole file, if nothing else depends on it) rather than leaving it commented-out-but-present — it is non-functional today (missing `api_key` in its own client projection) and a latent risk if ever accidentally re-enabled (double-processing against the same `job_queue` the real server worker also polls).
**Dependencies:** confirm nothing else imports `JobWorker`/`AIManagerService.generateVideo()`/`generateImage()` before deleting.
**Expected files:** `src/modules/job-orchestrator/JobWorker.ts`, `src/main.tsx` (remove the dead commented-out call), possibly `src/modules/ai-providers/AiProviderService.ts` if its video/image methods become unreferenced.
**Acceptance criteria:** build succeeds, no other page breaks, `main.tsx` has no commented-out dead code for this path.
**Tests:** existing build/type-check is sufficient evidence for a deletion; no new test needed.
**Rollback:** `git revert` — a deletion-only diff.

## 4. One real video provider adapter (first genuine capability)

**Scope:** implement one real server-side adapter — recommend **Pollinations** first (per the parallel Phase 0 reconciliation's own finding: it's Shogo's only genuinely free-tier real reference implementation) — as a new `VideoJobHandler`, mirroring this engagement's own already-proven `VoiceJobHandler` pattern exactly (reuse `job_queue`/`QueueManager`, never a second queue; honest fail-closed on missing config, never fabricate success).
**Dependencies:** Items 1-3 should land first so the surrounding UX/cadence/dead-code issues don't mask whether the new adapter itself works. Needs a real API credential (external dependency, not a code blocker).
**Expected files:** new `server/workers/handlers/VideoJobHandler.ts`, a small change to `WorkerRegistry.ts`'s dispatch switch (moving `video` off `MediaJobHandler` once a real handler exists, same pattern as the Voice Studio engagement's own `WorkerRegistry` fix), no schema change needed (tables already exist).
**Acceptance criteria:** a real, successful generation produces a real `video_assets` row with a real, playable URL — demonstrated in a test environment with a real (even if low-cost/free-tier) credential, not simulated.
**Tests:** unit tests for the adapter (mocked HTTP, following the Voice Studio engagement's `voiceDriver.test.ts` pattern of asserting the exact request shape without a real network call) plus one deliberately-gated live-smoke test, run only with explicit approval and real credentials — never as part of the default suite.
**Rollback:** the new handler is additive; reverting it leaves `MediaJobHandler`'s existing honest-failure behavior intact for `video`.

## 5. Resolve the MiniMax naming collision before adding a second provider

**Scope:** before implementing any second video adapter (especially one also named "MiniMax"), explicitly namespace video provider keys separately from the text `ProviderRouter`'s registry (e.g. a distinct `video:minimax` key, never sharing a lookup table with the text adapter) to prevent a future accidental merge of two unrelated capabilities under one name.
**Dependencies:** Item 4's pattern should exist first, to apply the same discipline consistently.
**Expected files:** whatever registry Item 4 introduces.
**Acceptance criteria:** no code path can resolve "minimax" to the wrong adapter type.
**Tests:** a targeted unit test asserting the video and text registries are structurally separate.
**Rollback:** trivial, naming-only.

## 6. Reconcile the RLS write-access divergence (decision, not urgent code)

**Scope:** decide — as a deliberate architectural choice, not a silent default — whether Video Factory's direct-from-browser-write pattern is an accepted second convention alongside Voice Studio/Communication Hub's backend-gatekept pattern, or whether it should be migrated to go through a backend service instead. This audit does not recommend one over the other; it flags that the divergence exists and is currently undecided.
**Dependencies:** none technically urgent; worth resolving before Video Factory grows much further, since every new table/feature added under the current pattern deepens the divergence.
**Expected files:** TBD, pending the decision.
**Acceptance criteria:** a documented decision in `ARCHITECTURE_DECISIONS.md` (the existing file this repo already uses for this purpose).
**Tests:** N/A for the decision itself.
**Rollback:** N/A.

## 7. Nullable `organization_id` hardening (defer, not a blocker)

Same class of finding already on record for Communication Hub — a future migration adding `NOT NULL` across `video_projects`/`video_templates`/`video_styles`/`video_jobs`/`video_assets`/`video_timelines`/`video_variants`, plus the equivalent for Communication Hub's tables, as one consolidated hardening pass rather than piecemeal. Not urgent; no exploited path found in either module.

## Explicitly deferred, not started, not scoped this pass

Image Studio's likely-identical provider gap (same `MediaJobHandler.processImageJob` pattern) is a near-certain Item 4-equivalent waiting to happen, but was not independently deep-audited this pass — recommend a companion audit before assuming it needs the exact same fix. Campaign/Publishing/Context-Profile pages' apparent placeholder status (31-49 lines each) was flagged by size only, not read — any work there should start with actually reading those files, not with this backlog's inference.
