# Video Factory — Feature/Lifecycle Matrix

Companion to `VIDEO_FACTORY_FUNCTIONAL_AUDIT.md`. Status vocabulary: COMPLETE, PARTIAL, MISSING, UI-ONLY, MOCKED, BLOCKED, NOT VERIFIED. No single blended percentage — UI/backend/persistence/test/deployment are separate columns.

| Stage | UI | Backend | Persistence | Provider/Integration | Tests | Deployment-verified | Evidence |
|---|---|---|---|---|---|---|---|
| Project create/list/select | COMPLETE | PARTIAL (silent failure path, see audit §root cause) | COMPLETE (`video_projects`, live 200 on read) | N/A | MISSING | PARTIAL — read path live-confirmed 200; create path not completed live | `VideoStudioPage.tsx:75-142` |
| Project edit/delete/archive | MISSING | MISSING | N/A (no columns/handlers for it) | N/A | MISSING | NOT VERIFIED | No edit/delete/archive UI or handler found anywhere in `VideoStudioPage.tsx` |
| Video config (type/aspect/duration/fps/quality/seed) | COMPLETE | COMPLETE (fields pass through to `video_jobs` insert) | COMPLETE | N/A | MISSING | NOT VERIFIED (not live-tested) | `VideoStudioPage.tsx:19-28, 144-186` |
| Script/content inputs, reusable templates | PARTIAL (prompt + negative prompt only) | MISSING (no template table read/write found) | `video_templates` table exists, unused by this page | N/A | MISSING | NOT VERIFIED | `add_video_studio_tables.sql` defines `video_templates`; no reference to it in `VideoStudioPage.tsx` |
| Brand assets/logos/audio/media storage | PARTIAL (a "Brand" text field on the project only) | MISSING | MISSING (no asset-upload table/bucket reference for brand assets found) | N/A | MISSING | NOT VERIFIED | `VideoStudioPage.tsx:249-250` — a free-text field, not an asset upload |
| Provider/model selection | UI-ONLY | MOCKED (every provider funnels to the identical honest-failure message) | N/A | **MISSING** — zero of the 5 listed providers (opensora/cogvideox/ltxvideo/hunyuan/minimax) has any real adapter | MISSING | Live-confirmed the dropdown renders; selection has no backend effect | `VideoStudioPage.tsx:29-35`; `MediaJobHandler.ts:107-130` |
| Job creation/queueing | COMPLETE | COMPLETE (real `job_queue` row via `JobOrchestratorService.enqueueJob`) | COMPLETE | N/A | MISSING | BLOCKED — real pipeline, but cron runs once/day (see audit) | `JobOrchestratorService.ts:28-45`; `vercel.json` crons |
| Worker execution | COMPLETE (honest-failure path) | COMPLETE | COMPLETE (`video_jobs.status` correctly updated to `'failed'`) | MISSING (no real provider to execute) | MISSING | BLOCKED by once-daily cron | `MediaJobHandler.ts:107-130`; `WorkerRegistry.ts:288` |
| Progress/retry/timeout/cancellation | MISSING (UI shows status badge only, no retry/cancel button) | PARTIAL (heartbeat/lease-renewal exists at the `MediaJobHandler` level, generic to all media jobs, not video-specific) | PARTIAL | N/A | MISSING | NOT VERIFIED | `MediaJobHandler.ts:38-52` (heartbeat only); no cancel/retry UI found |
| Provider callback/webhook | MISSING | MISSING | N/A | N/A | MISSING | N/A | No webhook route found for any video provider |
| Asset storage/preview/download | COMPLETE (UI) | PARTIAL (reads real `video_assets` table; nothing ever writes a real row to it since no provider succeeds) | COMPLETE schema, structurally empty forever until a real provider exists | MISSING | MISSING | NOT VERIFIED | `VideoStudioPage.tsx:381-422`; `add_video_studio_tables.sql` |
| Publishing to channels | MISSING | MISSING | N/A | N/A | MISSING | N/A | No publishing integration referenced anywhere in Video Studio code |
| Analytics on real outcomes | MISSING | MISSING | N/A | N/A | MISSING | N/A | No analytics view/query found |
| Tenant isolation/authorization/quotas/audit | PARTIAL | PARTIAL (RLS scopes by `organization_id`, but column is nullable; no quota/budget enforcement found; no audit-event emission found for video-specific actions, unlike `MediaJobHandler`'s own `emitAuditEvent` calls on *failure*, which do exist) | PARTIAL | N/A | MISSING | Live-confirmed RLS scoping works for the one account tested (query correctly filtered to that org) | `add_video_studio_tables.sql` RLS policies; `MediaJobHandler.ts` audit calls |

## Provider matrix (the 5 UI-listed providers — none of Shogo's 8 reference providers appear here at all; see the separate Phase 0 reconciliation for why Shogo's own 8 are mostly unreal too)

| Provider (UI label) | Adapter implementation | Supported models/params | Required config | Health-check | Sync/async | Pricing source | Tests | Blocker |
|---|---|---|---|---|---|---|---|---|
| Open-Sora | MISSING | N/A | N/A | N/A | N/A | N/A | MISSING | No adapter exists anywhere |
| CogVideoX | MISSING | N/A | N/A | N/A | N/A | N/A | MISSING | No adapter exists anywhere |
| LTX Video | MISSING | N/A | N/A | N/A | N/A | N/A | MISSING | No adapter exists anywhere |
| Hunyuan Video | MISSING | N/A | N/A | N/A | N/A | N/A | MISSING | No adapter exists anywhere |
| MiniMax (video) | MISSING — name collides with an unrelated real TEXT adapter (`server/ai/MiniMaxProvider.ts`, `MiniMax-Text-01`) | N/A | N/A | N/A | N/A | N/A | MISSING | Must not be implemented by extending the existing text `ProviderRouter` registry — needs its own, separately-keyed adapter |

**No percentage assigned anywhere in this document.** By the measurement criterion established in the Phase 0 reconciliation (real/tested/non-simulated backend paths implemented ÷ real paths that exist to be ported), Video Factory's real-provider coverage is **0 of 5** listed providers, and the pipeline up to (but not including) provider execution is otherwise substantially real — a genuinely two-track state, not a single number.
