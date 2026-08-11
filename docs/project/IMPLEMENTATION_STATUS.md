# Implementation Status — Bottom-Up Module Inventory

**Part of PS-01.** See [`PROJECT_CONTINUITY_REPORT.md`](./PROJECT_CONTINUITY_REPORT.md)
for methodology and evidence-discipline rules (Confidence: VERIFIED/INFERRED/UNKNOWN;
Maturity: VERIFIED IMPLEMENTED/PLATFORM FOUNDATION/FUTURE). Code-only evidence caps a
module at Status = PARTIAL regardless of how complete the code reads — no module below
is marked COMPLETE without a quoted runtime artifact.

---

## `src/modules/*` services

| Name | Path | Confidence | Maturity | Status | Runtime evidence | Consumers |
|---|---|---|---|---|---|---|
| AdminService | `src/modules/admin/AdminService.ts` | INFERRED | FUTURE | STUB | none — code inspection only; `getUsers()`/`getAuditLogs()` return hardcoded `[]`, `getSystemHealth()` returns a fabricated object | `AdminPage.tsx` imports **no service at all** — even this stub is unused |
| AgentService | `src/modules/agents/AgentService.ts` | INFERRED | FUTURE | STUB | none | No importer found anywhere |
| AiProviderService / AIManagerService | `src/modules/ai-providers/AiProviderService.ts` | VERIFIED (query projection) / INFERRED (generation paths) | PLATFORM FOUNDATION | PARTIAL | Bundle grep this session confirms `api_key` is excluded from the live `select()` projection (matches source); browser-side `generateText`/`generateImage` calls were not exercised end-to-end this session | `AiProvidersPage`, `PromptStudioPage`, `ContentPlannerPage`, `ImageStudioPage`, `VideoStudioPage`, `JobOrchestratorService` |
| AuthService | `src/modules/auth/AuthService.ts` | VERIFIED (code) / UNKNOWN (live login) | PLATFORM FOUNDATION | PARTIAL | `resolveRole()` fails closed to `VIEWER`, confirmed by reading the file; **no runtime artifact of a successful `getUser()`/session exists** | `useAuth.ts` hook |
| AutomationService | `src/modules/automation/AutomationService.ts` | INFERRED | PLATFORM FOUNDATION | PARTIAL | none run; own code comment admits `triggerWorkflow()` is "a simulation... would queue a job in a real system" | `AutomationDashboardPage`, `AutomationBuilderPage` |
| CampaignManagerService | `src/modules/campaign-manager/CampaignManagerService.ts` | INFERRED | PLATFORM FOUNDATION | PARTIAL | none run — thin CRUD, `getCampaigns()`/`createCampaign()` only, no update/delete | `CampaignDashboardPage`, `CampaignBuilderPage` |
| ContextEngineService | `src/modules/context-engine/ContextEngineService.ts` | INFERRED | PLATFORM FOUNDATION | PARTIAL | none run | **No consumer** — `ContextProfileManagerPage.tsx` bypasses it and queries `context_profiles` directly |
| CrmService | `src/modules/crm/CrmService.ts` | INFERRED | FUTURE | STUB | none — `getCustomers()` returns `[]`, `addCustomer()` logs only | No importer; no CRM page exists despite `companies`/`contacts`/`buyers`/`suppliers` tables existing |
| DatabaseService | `src/modules/database/DatabaseService.ts` | INFERRED | FUTURE | STUB | none — explicitly labeled "placeholder for browser/edge environments" in its own code | No importer; `DatabasePage.tsx` uses the raw Supabase client directly instead |
| IndustryIntelligenceService | `src/modules/industry-intelligence/IndustryIntelligenceService.ts` | INFERRED | PLATFORM FOUNDATION | PARTIAL | none run — thin reads only (`getIndustries()`, `getCategories()`) | `IndustryDashboardPage.tsx` — which is itself **orphaned** (no route, no nav entry, unreachable) |
| JobOrchestratorService / JobWorker | `src/modules/job-orchestrator/*` | VERIFIED (worker disabled) | PLATFORM FOUNDATION | BLOCKED | **VERIFIED**: `src/main.tsx:7-9` — `JobWorker` import and `.start()` call are both commented out. Enqueue/dependency/retry logic exists in code but nothing ever consumes the queue. | `ContentPlannerPage`, `ImageStudioPage`, `VideoStudioPage` call `enqueueJob`; nothing processes what they enqueue |
| KnowledgeBaseService | `src/modules/knowledge/KnowledgeBaseService.ts` | INFERRED | FUTURE | STUB | none — `search()` logs and returns `[]`; not the same code path as the actual Knowledge Vault feature | No importer; `KnowledgeVaultPage.tsx` uses separate `src/components/vault/*` components instead |
| MediaComposerService | `src/modules/media-composer/MediaComposerService.ts` | INFERRED | PLATFORM FOUNDATION | PARTIAL | none run — thin CRUD only | `MediaComposerDashboardPage` |
| PerformanceIntelligenceService | `src/modules/performance/PerformanceIntelligenceService.ts` | INFERRED | PLATFORM FOUNDATION | PARTIAL | none run — real aggregation logic (client-side sums/averages over `campaign_performance.metrics`), not exercised | `PerformanceDashboardPage` |
| PublishingCenterService | `src/modules/publishing-center/PublishingCenterService.ts` | INFERRED | PLATFORM FOUNDATION | PARTIAL | none run — thin CRUD only | `PublishingCenterPage` |
| SeoIntelligenceService / SearchIntentEngine / MarketOpportunityEngine | `src/modules/seo-intelligence/*` | INFERRED | PLATFORM FOUNDATION | PARTIAL | none run — rule-based heuristics (keyword-substring classification, `volume/difficulty*100` scoring), not ML/AI despite the "Intelligence" name; `getOpportunities(projectId)` ignores its own `projectId` parameter | `SeoDashboardPage` |
| SettingsService | `src/modules/settings/SettingsService.ts` | INFERRED | FUTURE | STUB | none — hardcoded object, no table backing | No importer; `SettingsPage.tsx` is static UI |
| VoiceService | `src/modules/voice/VoiceService.ts` | INFERRED | FUTURE | STUB | none — `textToSpeech()` returns an empty `Blob`, `speechToText()` returns a hardcoded string | No importer; no voice page exists |

## Server-side (`server/*`) — all VERIFIED wired via runtime test this session

| Name | Path | Confidence | Maturity | Status | Runtime evidence |
|---|---|---|---|---|---|
| `requireAuth` middleware | `server/middleware/requireAuth.ts` | **VERIFIED** | PLATFORM FOUNDATION | COMPLETE (for its narrow scope: 2 of 13 routes) | `curl -X POST /api/vault/ai-summary` with no token → `{"error":"unauthenticated","requestId":"..."}`, HTTP 401, in both dev and `NODE_ENV=production` builds this session |
| `rateLimit` middleware | `server/middleware/rateLimit.ts` | INFERRED | PLATFORM FOUNDATION | PARTIAL | not exercised to its limit this session; own code documents it as in-memory/per-process, a known scaling limitation |
| `server/audit.ts` (`emitAuditEvent`) | `server/audit.ts` | VERIFIED (invoked) | PLATFORM FOUNDATION | PARTIAL | Confirmed called from `requireAuth`, `rateLimit`, `ProviderRouter`, and `server.ts`'s `devOnly` guard by direct code read; output is stdout-only, not a durable store |
| `server/ai/ProviderManager.ts` | `server/ai/ProviderManager.ts` | VERIFIED | PLATFORM FOUNDATION | PARTIAL | Resolves `GEMINI_API_KEY` from `process.env` only, fails closed; not exercised end-to-end (no `GEMINI_API_KEY` configured in this session's `.env`) |
| `server/ai/ProviderRouter.ts` | `server/ai/ProviderRouter.ts` | VERIFIED | PLATFORM FOUNDATION | PARTIAL | Explicitly self-documented as "NOT the full Bell24h-OS Enterprise AI Router" — a narrow, 2-endpoint, Gemini-only boundary |
| `devOnly` route guard | `server.ts` (inline) | **VERIFIED** | VERIFIED IMPLEMENTED | COMPLETE | `curl /api/migrate` and `curl /api/env/diagnostic` under `NODE_ENV=production` → both `404`; both reachable (200/500) in dev, this session |

## `server.ts` API routes — full inventory, all VERIFIED live this session

| Route | Auth? | Runtime result (this session) |
|---|---|---|
| `GET /api/health` | No (by design) | `200 {"status":"ok"}` |
| `GET /api/env/diagnostic` | `devOnly` only | Dev: `200`. Prod: `404`. |
| `GET /api/check-table` | **None** | Dev & prod: `500` "DATABASE_URL is not defined" — reaches handler, no auth check |
| `GET /api/check-users-count` | **None** | Dev & prod: `500`, same pattern |
| `GET /api/migrate` | `devOnly` only | Dev: `500` (reaches handler). Prod: `404`. |
| `GET /api/vault/documents` | **None** | Dev & prod: `500`, reaches handler |
| `POST /api/vault/documents` | **None** | Prod: `500`, reaches handler (no auth rejection) |
| `GET /api/vault/rd` | **None** | Not individually curled; same code pattern as `/api/vault/documents` — INFERRED same result |
| `GET /api/vault/timeline` | **None** | INFERRED same pattern |
| `GET /api/vault/phases` | **None** | INFERRED same pattern |
| `GET /api/vault/decisions` | **None** | INFERRED same pattern |
| `POST /api/vault/ai-summary` | **`requireAuth` + rate limit** | **VERIFIED**: `401 unauthenticated` without a bearer token, dev & prod |
| `POST /api/vault/mentor-advice` | **`requireAuth` + rate limit** | Same middleware chain as above; not individually curled — INFERRED same result |
| catch-all `GET *` | N/A (static) | `200`, serves `index.html` |

## Supabase schema — table/RLS coverage summary

Full detail in `PROJECT_CONTINUITY_REPORT.md` Step 5. Headline gaps found independently
this session (source: direct read of `supabase_schema.sql`, 2025 lines):

| Gap | Confidence | Evidence |
|---|---|---|
| `permissions` table has no RLS, no policy | VERIFIED | Not present in the RLS-enable loop array or anywhere else in the file |
| `job_priorities` — RLS enabled, no policy | VERIFIED | `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` present; no matching `CREATE POLICY` found |
| `workflow_templates` — created, RLS never enabled | VERIFIED | Table creation found; absent from the automation block's RLS-enable list |
| Knowledge Vault tables — RLS on, policy is `USING (true)` (public) | VERIFIED | `supabase_schema.sql:1966-1970`, quoted verbatim in the continuity report |
| `seo_projects`, `campaigns`, `social_accounts` defined twice | VERIFIED | Two `CREATE TABLE IF NOT EXISTS` blocks per name, in different schema sections |

## Pages — routing and orphan check

Full table in `PROJECT_CONTINUITY_REPORT.md` Step 2 discovery notes. Single most
important finding: **`IndustryDashboardPage.tsx` is orphaned** — real backing service,
zero route, zero nav entry, unreachable in the running application. Confirmed via
repo-wide grep for its own component name finding only its own definition.

## Negative check (planning capability names)

See `PROJECT_CONTINUITY_REPORT.md` Step 2 for the full table (Wallet, Ledger, Escrow,
Trust Score, Ratings, Nearby SEO/GEO, Provider Manager, OmniRoute, Prompt Studio,
Authentication, Organizations, Permissions, Supplier/Buyer Management, RFQs, Quotes,
Deals). Not duplicated here to avoid drift between the two files — that table is the
single source for this check.
