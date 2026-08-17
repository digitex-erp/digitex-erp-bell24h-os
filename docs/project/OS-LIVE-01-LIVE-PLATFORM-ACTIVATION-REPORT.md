# OS-LIVE-01 — Live Platform Activation: Investigation Report

**Date:** 2026-08-18
**Scope:** Read-only repository/deployment truth-finding (Phases 1–8). Phases 9–11
(implementation, verification, production deployment) **did not run** — a hard blocker
was found before any code change was justified. See "Why Phase 9 did not run" below.

---

## 1. Git Truth (Phase 1)

```
HEAD        = c27f8e5cdd524ce1af510184164abd90e63e136d
origin/main = c27f8e5cdd524ce1af510184164abd90e63e136d
```
Working tree clean, branch `main`, in sync with `origin/main`. **PASS.**

---

## 2. Deployment Truth — why production shows a placeholder (Phase 2)

Two independent, compounding causes were found. Both are supported by direct evidence,
not inference from the project name.

### 2a. This repository's own Vercel config disables the real frontend build

`vercel.json`:
```json
{
  "version": 2,
  "framework": null,
  "outputDirectory": "dist",
  "buildCommand": "mkdir -p dist && echo '<!doctype html><title>Bell24h-OS staging</title><p>API-only staging build for OS-INTEGRATION-IMPLEMENTATION-01. See /api/v1/health.</p>' > dist/index.html",
  "rewrites": [{ "source": "/api/(.*)", "destination": "/api/index" }]
}
```
This `buildCommand` overrides `package.json`'s real build (`vite build && esbuild
server.ts ...`) with a one-line placeholder `dist/index.html`. This is intentional,
labeled inline as scoped to `OS-INTEGRATION-IMPLEMENTATION-01` (the S2S API-only
milestone) — **not a bug**, but the deliberate, minimum config needed at the time to
run the Express app as a Vercel serverless function (`api/index.ts` wraps
`server.ts`'s `createApp()`). A real, substantial Vite/React frontend exists in `src/`
(see §3) and is never built for Vercel because of this override. This matches **Phase
2 Outcome C — frontend build is intentionally disabled.**

### 2b. The Vercel project this session can inspect is *not* the project serving the live domain

This is the more serious finding, and it is **not one of Phase 2's listed hypotheses
(A–F)** — it needed to be added as its own category:

- `vercel inspect https://digitex-erp-bell24h-os.vercel.app --scope bell24xs-projects`
  → `Error: Can't find the deployment "digitex-erp-bell24h-os.vercel.app" under the
  context "bell24xs-projects"`
- `vercel domains inspect digitex-erp-bell24h-os.vercel.app --scope bell24xs-projects`
  → `Error: You don't have access to the domain digitex-erp-bell24h-os.vercel.app
  under bell24xs-projects.`
- The Vercel project this account *can* reach (`digitex-erp-bell24h-os`,
  `prj_8oLwDwlcBgJAuf4FFFsSWwBcFBGp`, team `bell24xs-projects`) lists only
  `*-bell24xs-projects.vercel.app` domains via `get_project` — the bare vanity domain
  is not among them.
- That same accessible project currently has **zero environment variables** in any
  environment (`vercel env ls production/preview/development` → "No Environment
  Variables found", verified multiple times this sprint).
- Yet the live domain is demonstrably running the real, correctly-configured
  `requireServiceAuth` code path right now (black-box test, no secret used: a random
  discarded token gets `401 "Service credential rejected."`, which only happens when a
  real secret **is** configured server-side).

**Conclusion: `https://digitex-erp-bell24h-os.vercel.app` is served by a different
Vercel account/project than the one visible to this session.** Repository inspection
(§2a) explains what the *accessible* project would serve if it were live — it does not
and cannot explain what the real production domain currently serves, because that is a
separate, currently inaccessible deployment. This was independently established (and
cross-checked) across three prior OS-INTEGRATION-GATE-B-02 investigation turns this
session, each arriving at the same result via different methods (Vercel MCP tool,
`vercel` CLI, live HTTP behavioral tests).

---

## 3. Existing Application Inventory (Phase 3)

Frontend: Vite + React Router SPA. `src/App.tsx` defines 21 routed pages behind a
`ProtectedRoute` (real Supabase-session-gated) plus `/auth/*` and
`/system/diagnostics`. This is a materially complete enterprise app shell, not a
skeleton — several pages are 400–650 lines with real Supabase CRUD wired in
(`OrganizationPage.tsx` 610 lines, `TeamPage.tsx` 646 lines, `PromptStudioPage.tsx` 596
lines, `ImageStudioPage.tsx` 506 lines, `VideoStudioPage.tsx` 465 lines).

| Module | Classification | Evidence |
|---|---|---|
| Authentication | **VERIFIED IMPLEMENTED** | Real Supabase session flow (`useAuth.ts`, `AuthPage`), `AuthService.resolveRole()` reads `user_roles`→`roles`. Dev auth bypass (`AUTH_BYPASS` in `useAuthStore.ts`) is provably excluded from production builds: requires `import.meta.env.DEV` (statically `false` under `vite build`) **and** an explicit `VITE_AUTH_BYPASS=true` opt-in — not a live risk, well-documented in-code. |
| Organizations | **VERIFIED IMPLEMENTED** | `OrganizationPage.tsx` — traced, not just sized: real read path (`profiles`→`organizations` join by `organization_id`, plus a member list read), real write path (`supabase.from('organizations').update(...)` on save), plus a real Storage upload for the org logo. No dedicated service file — calls Supabase directly, RLS-enforced. |
| Users / Teams | **VERIFIED IMPLEMENTED** | `TeamPage.tsx` — traced: reads `profiles`/`roles` by `organization_id`, writes real role assignments (`user_roles` delete+insert on change) and a real `audit_logs` insert on the action. |
| RBAC / Permissions | **PARTIALLY IMPLEMENTED** | Role resolution is real (`AuthService.resolveRole`, 4-tier `VIEWER<EDITOR<MANAGER<ADMIN`, fails closed to `VIEWER`) but the code's own comment states it "drives UI affordances only" — server-side/RLS enforcement is the actual authorization boundary and wasn't exhaustively re-audited this sprint. |
| AI Provider Manager | **BROKEN (client path) / VERIFIED (server S2S path)** | Two independent implementations exist. (1) `server/ai/{NvidiaProvider,ProviderManager,ProviderRouter}.ts` — server-side, credential-resolving, is the path Gate A/B-02 verified end-to-end for NVIDIA via `/api/v1/ai/text`. (2) `src/modules/ai-providers/AiProviderService.ts` (665 lines) — runs in the **browser**, is explicitly self-labeled `"LEGACY — DO NOT USE FOR NEW SERVER ENDPOINTS"` in its own header comment, and deliberately never receives `api_key` (excluded from the client-side Supabase projection, tracked in-repo as "Critical Security Debt"). Every provider class in this file (`GeminiProvider`, `OpenAIProvider`, `AnthropicProvider`, `OpenCompatibleProvider` for DeepSeek/Qwen/GLM/MiniMax/NVIDIA) will throw `"<name> API key is missing"` on every real invocation in production. This is the class actually used by the in-app Prompt Studio / Content Planner / Image Studio / Video Studio UIs — see below. |
| Prompt Studio | **UI ONLY / BROKEN GENERATION** | 596-line page exists and is wired to `AIManagerService.generate()`, which uses the broken client path above. |
| AI Content Planner | **UI ONLY / BROKEN GENERATION** | `ContentPlannerPage.tsx`, 447 lines, same dependency. |
| Image Studio | **UI ONLY / BROKEN GENERATION** | `ImageStudioPage.tsx`, 506 lines, calls `AIManagerService.generateImage()` → same broken client path; Supabase Storage upload code (`image_assets` bucket) is real and reachable **only if** generation ever succeeded, which it structurally cannot right now. |
| Video Studio | **UI ONLY / BROKEN GENERATION** | `VideoStudioPage.tsx`, 465 lines — full project/job/asset UI, writes real rows to `video_projects`/`video_jobs`/`video_assets`, enqueues via `JobOrchestratorService`. Generation itself fails the same way as Image Studio (see §7 for full detail — this module gets its own phase because of the frozen spec). |
| Voice Studio | **FOUNDATION ONLY** | `VoiceService.ts` is 9 lines — a stub. |
| Communication Hub (WhatsApp/MSG91/Twilio) | **NOT IMPLEMENTED** | No matching code anywhere under `src/`. Per the architecture constitution, provider-specific comms integrations belong inside Bell24h-OS — none exist yet. This is a real, currently-missing module, not a misclassification. |
| SEO Center | **FOUNDATION ONLY** | `SeoIntelligenceService.ts` (62 lines) + two "engine" files (`MarketOpportunityEngine.ts` 7 lines, `SearchIntentEngine.ts` 10 lines) — thin stubs, not scoring/analysis engines yet. |
| Social Publisher | **FOUNDATION ONLY** | `PublishingCenterService.ts`, 32 lines — a bare `publishing_queue` insert/list wrapper. No channel API integration (no LinkedIn/X/Instagram calls) exists. |
| CRM | **FOUNDATION ONLY / STUB** | `CrmService.ts`, 8 lines. |
| Marketplace | **NOT IMPLEMENTED** | No matching module or route found anywhere in `src/`. |
| Knowledge Base | **PARTIALLY IMPLEMENTED** | Two separate things exist under this name: `KnowledgeBaseService.ts` (9-line stub) vs. the actually-developed **Knowledge Vault** feature — `KnowledgeVaultPage.tsx` (179 lines) plus 6 real components (`FounderMemory`, `FounderTimeline`, `InnovationPipeline`, `PhaseUnlockEngine`, `RdLibrary`, `VaultDocuments`). The Vault is meaningfully built; the generic "Knowledge Base" service is not. |
| Automation | **FOUNDATION ONLY** | `AutomationService.ts`, 113 lines — the most substantial of the "thin" modules but still a queue/rule wrapper, not a verified rule-execution engine. |
| Analytics | **FOUNDATION ONLY** | `PerformanceIntelligenceService.ts`, 89 lines. |
| Audit / Evidence | **PARTIALLY IMPLEMENTED, self-documented gap** | `server/audit.ts` emits structured JSON audit events on every auth/S2S/rate-limit decision — real and in active use (confirmed via `requireServiceAuth.ts`, `rateLimit.ts`). Its own header states events are stdout-only right now; durable persistence needs `DATABASE_URL`, which is not configured in this environment. Not silently broken — explicitly tracked as follow-up in the code itself. |
| Storage | **READY (infra) / unreachable (upstream broken)** | Supabase Storage buckets `image_assets` and `video_assets` are provisioned via SQL migration with correct public-read/authenticated-insert policies. The upload code that targets them is real, but it's downstream of the broken client-side AI generation path (see AI Provider Manager row), so it's currently unreachable in practice. |
| Observability | **NOT IMPLEMENTED (beyond audit log)** | No metrics/tracing/dashboard code found beyond the structured audit events above. |

---

## 4. Frontend / Live-Site Gap (Phase 4)

**Minimum change, if this repository's Vercel project were confirmed to be the live
one:** remove the placeholder `buildCommand` override in `vercel.json` and let Vercel
run the project's real build (`vite build && esbuild server.ts ...`), keeping the
existing `/api/(.*)` → `/api/index` rewrite untouched. No architecture change, no UI
rewrite — this is exactly the "smallest safe change" the task calls for.

**This was not applied.** Per §2b, changing `vercel.json` in *this* repository would
only affect the Vercel project this session can reach — which is demonstrably **not**
the project serving `https://digitex-erp-bell24h-os.vercel.app` today. Applying and
deploying the fix here would produce a build that never reaches the real production
URL, giving false confidence that "the site is fixed" when nothing observable would
change. This is the exact **Phase 11 stop condition** ("if production still serves the
placeholder, STOP and report the exact blocker") — reached before Phase 9 rather than
after, because the evidence for it was already conclusive.

---

## 5. Security / Production Boundary (Phase 5)

- **No provider credential reaches the browser via env vars.** `grep`-ing `src/` for
  `VITE_*`/`NEXT_PUBLIC_*` usage surfaces only `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY`/`VITE_SUPABASE_KEY` (Supabase anon key — intended to be
  public, protected by RLS) and `VITE_AUTH_BYPASS` (dev-only flag, see §3). No AI
  provider key is defined with a client-exposed prefix anywhere.
- **The AI provider key IS at risk via a different mechanism**, already flagged
  in-repo (not a new finding): `AiProviderService.ts`'s `getProviders()` explicitly
  excludes the `api_key` column from its Supabase query. That is a **client-code
  discipline** boundary, not a **Row-Level-Security** boundary — RLS controls which
  *rows* of `ai_providers` a client can see, not which *columns*. A different/modified
  client issuing `select('*')` against the same table would not be stopped by RLS if
  the row itself is visible to that organization member. The repository's own header
  comment already tracks this as "Critical Security Debt" pending a dedicated
  migration to server-side secret storage. Confirmed accurate; not expanded further,
  per instruction not to silently broaden scope.
- **Known P1s, checked and confirmed still present** (not fixed this sprint, per
  instruction):
  - `/api/check-users-count` and `/api/check-table` (`server.ts:193,205`): gated by
    `requireAuth` (any authenticated user, any organization) but not organization- or
    role-scoped, and both return raw `err.message` to the client on failure (500
    responses leak internal DB error text).
  - `/api/v1/ai/text` rate limiting: confirmed **absent**. `rateLimit()` middleware
    exists and is genuinely applied to `/api/vault/ai-summary` (`server.ts:359`), but
    the S2S AI endpoint at `server.ts:90` has no such middleware in its chain — it is
    authenticated but not throttled.
  - `JobOrchestratorService.ts` / `JobWorker.ts` browser-shipped architecture: verified
    directly — `JobWorker.start()` runs a client-side `setInterval` polling
    `job_queue`, meaning job processing (including AI generation calls) depends on a
    browser tab staying open, and runs in the same broken-credential client context as
    §3's AI Provider Manager finding.
  - Provider credential environment-scope governance: this entire report is itself
    evidence of the underlying issue (§2b) — the account/project holding the real
    production secrets is not the one governed by this repository's visible tooling.

---

## 6. Runtime Foundation Audit (Phase 6)

| Foundation | Implemented | Deployed | Real backend | Production-safe | Test evidence |
|---|---|---|---|---|---|
| Authentication | Yes | Unknown (§2b) | Yes (Supabase) | Yes (bypass provably build-gated) | Not re-run this sprint (out of scope) |
| Organizations / Users / RBAC | Yes (CRUD); role-check partial | Unknown (§2b) | Yes (Supabase + RLS) | UI-level only for RBAC | None re-run |
| Supabase / RLS | Yes — 230 `ROW LEVEL SECURITY`/`CREATE POLICY` statements in `supabase_schema.sql` | Unknown (§2b) | Yes | Row-level only, not column-level (§5) | None re-run |
| AI Provider Manager (server path) | Yes, NVIDIA only | **Verified live** (independent of §2b — confirmed via S2S proof in prior sprints) | Yes | Yes | Gate A/B-02 evidence (not re-run, per instruction) |
| AI Provider Manager (client path) | Yes, but structurally broken | N/A | No (credential always undefined) | N/A — never returns real output | Confirmed broken by direct code read this sprint |
| Prompt Studio / Content Planner / Image Studio | UI complete | Unknown (§2b) | No (depends on broken client path) | N/A | Confirmed broken by direct code read |
| Storage | Buckets provisioned via SQL | Unknown (§2b) | Yes (Supabase Storage) | Yes (policies correct) | Unreachable in practice (upstream broken) |
| Queue processing | Exists (`job_queue`, dependencies, retries) | Unknown (§2b) | Yes (Supabase-backed) | **No** — runs in-browser, single-tab-dependent | None |
| Audit / logging | Exists, active | Unknown (§2b) | Partial — stdout only, no durable store | Partial, self-documented gap | None re-run |

---

## 7. Enterprise Video Studio / Video Factory Readiness (Phase 7)

**Explicitly not implemented this sprint, per instruction — inspection only.**

| Frozen spec requirement | Status | Evidence |
|---|---|---|
| `video_projects`, `video_jobs`, `video_assets` tables | **Present** | `add_video_studio_tables.sql`; used live by `VideoStudioPage.tsx`. |
| `video_templates`, `video_styles`, `video_variants`, `video_timelines` | **Not found** | No matching table or code reference anywhere in the repo. |
| Video Pipeline Orchestrator (dedicated) | **Not implemented** | No `VideoStudioService.ts` / `VideoPipelineOrchestrator.ts` exists. The generic `JobOrchestratorService`/`JobWorker` (browser-based, see §5) is the only queue mechanism, shared undifferentiated across `image`/`video`/`content`/`voice`/etc. job types. |
| Provider adapters: MiniMax Video, Open-Sora, CogVideoX, LTX Video, Hunyuan Video | **UI selectable, zero working adapters** | `VideoStudioPage.tsx` lists all five as selectable `PROVIDERS`. `AiProviderService.ts` has a generic `OpenCompatibleProvider` class construction for `minimax`, but its `generateVideo()` path is the same client-side, credential-less path documented in §3 — it will always fail. Open-Sora/CogVideoX/LTX/Hunyuan have **no adapter code at all**, client or server — they exist only as UI dropdown labels. |
| Routing through AI Provider Manager | Nominally yes, but through the broken client instance, not the verified server one | See §3 |
| Job states (Queued→Preparing→Generating→Rendering→Uploading→Completed/Failed/Retry/Cancelled) | **Partially modeled** | `JobStatus` type in `JobOrchestratorService.ts` has `queued/scheduled/preparing/running/paused/retrying/completed/cancelled/failed` — close to spec but uses a single generic `running` rather than distinct `Generating`/`Rendering`/`Uploading` stages; `VideoStudioPage.tsx`'s own status badge switch only handles `completed/running/queued/failed`. |
| Storage (Supabase Storage) | **Provisioned**, correct policies | `add_video_storage.sql` |
| Persistent queue, retries, timeout, provider fallback, storage/network failure handling, logging, metrics | **Partially present, not verified working** | Retry counting and `job_logs` inserts exist in `JobOrchestratorService.processJob`/`handleFailure`; no timeout handling visible in the video path specifically; "fallback" only means "try the next configured provider in priority order," all of which fail identically since none have real credentials client-side; no metrics beyond the audit log. |

**Verdict: Video Studio / Video Factory is NOT READY.** The UI is the most complete
piece of this module by a wide margin; the actual generation pipeline cannot produce a
video today, for the same root cause documented in §3/§5 (browser-side job processing
with a deliberately credential-less AI provider client), plus four of five target
providers have no adapter code whatsoever. Scaling to "2,000+ branded videos/day" is
not a tuning problem from here — it requires a genuinely new server-side pipeline.

---

## 8. Feature Completion Roadmap (Phase 8)

**P0 — production/live-site blockers**
1. Identify and gain access to whichever Vercel account/team actually owns
   `digitex-erp-bell24h-os.vercel.app` (§2b). Nothing about "making the live app
   available" is actionable until this is resolved — it is upstream of every other P0
   item.
2. Once resolved: apply the `vercel.json` build-command fix (§4) in *that* project (or
   confirm it already builds the real frontend there) and redeploy.

**P1 — security/runtime blockers**
1. Scope/org-check `+` stop leaking raw DB errors on `/api/check-table` and
   `/api/check-users-count`.
2. Add rate limiting to `/api/v1/ai/text` (pattern already exists in `rateLimit.ts`,
   just needs to be mounted there).
3. Migrate `ai_providers.api_key` off a tenant-readable table + rotate all provider
   credentials once moved (the repo's own tracked "Critical Security Debt").
4. Move job processing (`JobOrchestratorService`/`JobWorker`) server-side — its current
   browser/`setInterval` design is both an availability problem (needs an open tab) and
   the direct cause of every "broken generation" finding in §3.

**P2 — foundational capability completion**
1. Give AI-driven UI modules (Prompt Studio, Content Planner, Image Studio) a real
   server-side generation path, mirroring the already-proven NVIDIA `/api/v1/ai/text`
   pattern, instead of the legacy browser client.
2. Durable audit-event persistence (needs `DATABASE_URL` wired in whichever
   environment is actually live).
3. Bring RBAC enforcement to parity with its UI-level role resolution (server-side
   checks beyond "drives UI affordances only").

**P3 — Enterprise Video Studio / Video Factory**
Not ready to start per Phase 7's findings and per instruction ("do not start P3/P4
until the runtime foundation required by those modules is actually ready") — this
depends on P1.4 (server-side job processing) and P2.1 (real server-side AI Provider
Manager path) landing first. Building actual provider adapters (Open-Sora, CogVideoX,
LTX, Hunyuan, MiniMax Video) and the dedicated orchestrator/entity set
(`video_templates`/`video_styles`/`video_variants`/`video_timelines`) comes after.

**P4 — Voice / Communication / SEO / Social / CRM / Automation / Analytics**
Lowest priority by instruction, and correctly so by evidence — every module in this
band is FOUNDATION ONLY or NOT IMPLEMENTED (§3), and several (Communication Hub,
Marketplace) don't exist in this repository at all yet.

---

## 9. Why Phase 9 (implementation) did not run

Phase 11 of this task specifies its own stop condition: *"If production still serves
the placeholder: STOP. Report the exact blocker."* This investigation reached that
exact state of certainty **before** Phase 9, not after — making any code change in
Phase 9 an action with no way to verify its effect on the real production domain, and
a risk of reporting false success. Per the task's own security section and this
session's operating rules, STOP was the correct outcome once §2b was established
(and it was independently re-confirmed three times across this session using three
different methods: Vercel MCP API, `vercel` CLI project/domain inspection, and live
HTTP behavioral testing).

---

## 10. Build / Typecheck / Test Results

**Not run.** Phase 10 verification is downstream of Phase 9's implementation, which did
not occur. No source files were changed, so there is nothing new to verify.

---

## 11. Production Deployment Evidence

- Live root: `https://digitex-erp-bell24h-os.vercel.app/` — confirmed live, serving
  (per prior sprints' evidence) the placeholder HTML at `/`, and a working
  `/api/v1/health` (`status: ok`, `apiVersion: v1`) and `/api/v1/ai/text` (S2S-gated).
- Owning Vercel project/account: **not determinable from this session** (§2b).
- Accessible project (`digitex-erp-bell24h-os`, `prj_8oLwDwlcBgJAuf4FFFsSWwBcFBGp`,
  team `bell24xs-projects`): latest deployment `dpl_k9wxJRarfhr7gNsFoNYSda2T2ntk`,
  `readyState: READY`, `target: null`, **no GitHub integration** (re-confirmed: this
  project has never carried a git commit SHA on any deployment record). A `git push`
  to `origin/main` will **not** trigger a redeploy of this project, and — since this
  project isn't confirmed to be the live one anyway — would not affect the real
  production URL either way.
- Whether the *real, live* project (the inaccessible one from §2b) has GitHub
  integration at all is **unknown** — that fact was established only for this
  accessible project and, separately, for the unrelated VyaparSethu project
  (`bell24xcom/forBell24x`, confirmed linked, in an earlier sprint). Phase 13's
  assumption that `git push origin/main` is a meaningful deployment step for Bell24h-OS
  cannot be confirmed either way until §2b's account-access gap is closed.

---

## 12. Next Recommended Sprint

**Exactly one:** *"OS-LIVE-02 — Vercel Account Reconciliation."* A human-only sprint:
the operator locates and grants this environment access to whichever Vercel
account/team actually hosts `digitex-erp-bell24h-os.vercel.app` (most likely a
founder/personal account distinct from `bell24hhelpline-8523`'s `bell24xs-projects`
team). Everything in this report's P0–P1 roadmap is blocked on that single access
resolution; no further automated investigation of *this* repository's Vercel
configuration will change the outcome.
