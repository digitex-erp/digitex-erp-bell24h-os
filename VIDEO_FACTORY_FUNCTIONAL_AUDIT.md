# Video Factory — Functional Audit

**Date:** 2026-10-16. **Repo:** `digitex-erp/digitex-erp-bell24h-os`, branch `feature/communication-hub`, HEAD `ca8d1bb6d48e1b9dfc084acdfbe1a6b213d25695`. Working tree: 21 pre-existing modified/untracked entries, unchanged — none touched by this audit. **Read-only** except for this and 3 sibling report files.

## Phase 1 baseline

- `git status --short`: 3 modified (`package.json`, `server/ai/ProviderRouter.test.ts`, `src/pages/SystemDiagnosticsPage.tsx`), 18 untracked top-level entries — matches the already-documented baseline exactly.
- Worktrees: primary (`feature/communication-hub`), `bell24h-os-fd1-certification` (`feature/p0-remediation`), `bell24h-os-voice-studio-migration` (`feature/shogo-voice-studio-migration`, HEAD `ead4463`) — neither of the latter two entered this pass.
- No automated tests exist for Video Studio/Video Factory anywhere: `grep -rl "video_jobs|video_projects|VideoStudioPage|generateVideo" --include="*.test.ts" .` returns zero matches.
- No CI workflow exists in this repo (re-confirmed, consistent with every prior audit this engagement).

## Root cause of the reported live-site failures — live-reproduced, not assumed

**Reproduced directly in a browser** against `https://digitex-erp-bell24h-os.vercel.app/video-studio` (read-only navigation, DOM reads, console/network capture — no data was written; an attempt to create a test project was blocked by this session's own safety tooling before any write occurred, and the dialog was cancelled cleanly instead):

- Page loads correctly, is logged in as a real Supabase user (`id=<test-user-id>`), **zero console errors** throughout the whole interaction.
- Network capture of the actual Supabase REST calls on page load:
  ```
  GET /rest/v1/profiles?select=organization_id&id=eq.<test-user-id>   → 200
  GET /rest/v1/video_projects?select=*&organization_id=eq.<test-org-id>&order=created_at.desc → 200
  GET /rest/v1/organizations?select=id,name&id=eq.<test-org-id>      → 200
  ```
  Every request succeeds (200). The `profiles` lookup resolves a real `organization_id`. **This refutes the most obvious hypothesis** (that the org lookup silently fails) for this specific account — the read path works, and "No Projects Found" for this account reflects a genuinely empty `video_projects` result for that org, not a hidden query failure.
- Page text: exactly `"No Projects Found / Create a video project to start generating videos. / Create First Project"` — matches the owner's report verbatim.
- Clicking **"Create First Project"** (`src/pages/VideoStudioPage.tsx` line 268, `onClick={() => setIsNewProjectOpen(true)}`) **does open a real dialog** with working `Project Name`/`Brand` fields and a `Create Project` submit button (confirmed via accessibility-tree read, not a screenshot guess) — this button is **not** a dead placeholder. Typing into the dialog to complete an end-to-end create-and-verify test was blocked by this session's own write-safety control before any Supabase insert occurred; the dialog was cancelled, so the **create path's success/failure was not directly observed live** — only that it opens correctly. Flagging this explicitly as unverified rather than claiming it works.

**Two real, confirmed-by-code defects found, independent of the above, that would make the page look non-functional even when the underlying queries succeed:**

1. **Every async handler in `VideoStudioPage.tsx` swallows errors silently.** `fetchProjects` (line 75), `fetchJobsAndAssets` (line 97), `handleCreateProject` (line 117), and `handleGenerate` (line 144) all end their catch blocks with `console.error(err)` and nothing else — no toast, no inline error message, no retry affordance. Worse: `handleCreateProject` line 122-123 and `handleGenerate` line 150 both do `const { data: orgData } = await supabase.from('profiles')...single()` **without checking `error`**, then `if (!orgData?.organization_id) return;` — if that lookup ever fails for any reason (RLS denial, network blip, a user whose profile genuinely has no org), the function returns silently with **zero user-visible feedback of any kind**. From a user's perspective, clicking "Create Project" would appear to do precisely nothing — exactly the reported symptom — even though this specific account's lookup happened to succeed when this audit reproduced it.
2. **The server-side worker fleet that would process a real video job only runs once per day.** `vercel.json`'s `crons` entry: `{"path": "/api/v1/workers/tick", "schedule": "0 0 * * *"}` — midnight only. `VideoStudioPage.tsx`'s `handleGenerate` (line 170) does correctly call `JobOrchestratorService.enqueueJob(..., 'video', ...)`, which inserts a real row into `public.job_queue` (`JobOrchestratorService.ts` line 29) — the same table the real server-side `WorkerRegistry`/`MediaJobHandler` polls. `MediaJobHandler.processVideoJob` (`server/workers/handlers/MediaJobHandler.ts` lines 107-130) **does** write back to `public.video_jobs.status = 'failed'` with an honest `error_message` when it runs — so the architecture is NOT fundamentally broken, it is just **starved**: a job created at, say, 9am would sit in `'queued'` status, visibly doing nothing, for up to ~15 hours before the next midnight tick ever touches it. Anyone testing the live site during the day would see a job that never progresses and reasonably conclude "nothing happens."

**Conclusion on root cause:** no single bug explains every symptom perfectly, but two concrete, cited defects — (1) total silence on every error path, and (2) a once-per-day worker tick — are each independently sufficient to produce exactly what was reported ("buttons appear nonfunctional," "no real production workflow"), without needing to assume anything is broken that this audit couldn't verify. The empty project list for the specific account tested is a genuine empty state, not a hidden failure, **for that account** — whether OTHER accounts hit the silent-failure path in (1) was not and cannot be verified without their credentials.

## Lifecycle stage audit (see companion `VIDEO_FACTORY_FEATURE_MATRIX.md` for the full table)

Highlights not already covered above:

- **No real video-generation provider exists anywhere, server or client.** `MediaJobHandler.processVideoJob` always throws `PROVIDER_NOT_CONFIGURED: no video-generation provider is wired to Video Factory yet` — this is an *honest* failure (explicitly, by design — the handler's own comment says it previously fabricated a success row and was fixed to stop doing that), not a bug, but it means **no video has ever been or can currently be really generated** by this system regardless of the two defects above.
- **A second, disabled, dead-end client-side job processor exists**: `src/modules/job-orchestrator/JobWorker.ts`, commented out in `src/main.tsx` lines 7-9. If re-enabled, it would call `AIManagerService.generateVideo()` (`src/modules/ai-providers/AiProviderService.ts`), whose own `getProviders()` query deliberately excludes the `api_key` column (documented in that file's header as "Critical Security Debt") — every call would throw `"API key is missing"` before any real network request. This is dead code today (never runs), not a live risk, but should be deleted rather than left dormant.
- **Provider roster mismatch**: the UI's 5 providers (`opensora, cogvideox, ltxvideo, hunyuan, minimax`) have zero overlap with any provider this repo's `server/ai/*` adapters actually implement for video (the 6 real `ProviderRouter` adapters are text-only; the destination's "minimax" adapter is `MiniMax-Text-01`, unrelated to video). All 5 are **UI labels with no backend behind them** at all — not even an honest-failure path specific to each; they all funnel into the same single `PROVIDER_NOT_CONFIGURED` message regardless of which is selected.
- **`video_projects`/`video_jobs`/`video_assets` RLS grants tenant `INSERT/UPDATE/DELETE` directly** (`add_video_studio_tables.sql`) — architecturally different from Voice Studio/Communication Hub's backend-gatekept pattern, because this page writes straight from the browser to Supabase. Not inherently unsafe (RLS still scopes by `organization_id`), but a real, un-reconciled divergence in this codebase's conventions, and `organization_id` is nullable on every one of these tables (same class of weakness already on record for Communication Hub).
- **Storage bucket for video assets is public** (`add_video_storage.sql`, noted in the earlier Phase 0 pass, not re-verified line-by-line this pass) — anyone with a URL can read it; acceptable only if filenames are genuinely unguessable UUIDs, not independently re-confirmed this pass.

## Capacity/architecture reality check (Phase 2C)

The current design has: durable job rows (yes, `job_queue` + `video_jobs`), but **no evidence of bounded concurrency, provider rate limiting, backpressure, idempotency keys, dead-letter visibility specific to video, or any load test** — none of this can exist meaningfully yet because there is no real provider call to bound, rate-limit, or load-test. **The 2,000-videos/day target is entirely unevidenced at this stage** and must not be asserted as feasible or infeasible from this audit; it is simply not yet measurable.

## What is NOT verified in this pass (explicit)

- Whether `handleCreateProject`'s actual Supabase insert succeeds for a real browser session (dialog opens correctly; the write itself was not completed, by this session's own safety control, not by any error encountered).
- Whether `add_video_studio_tables.sql`/`add_video_storage.sql` were ever applied via a tracked migration process, or hand-applied directly in Supabase's SQL editor (no automated runner exists in this repo for any migration, confirmed repeatedly this engagement) — the live network evidence above proves the tables **exist and are queryable in production**, which is stronger evidence than usual for this repo, but the *process* by which they got there is still unverified.
- Whether other user accounts hit the silent profile/org lookup failure described above — only one account's behavior was observed.
