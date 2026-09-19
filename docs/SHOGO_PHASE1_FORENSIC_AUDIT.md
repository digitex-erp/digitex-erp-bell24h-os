# BELL24H-OS — SHOGO PARTIAL-DUMP PHASE-1 FORENSIC AUDIT + GAP CLOSURE

**Document ID:** `SHOGO-PHASE1-FORENSIC-AUDIT`  
**Repository:** `digitex-erp-bell24h-os`  
**Target Reference:** [Shogo Preview Application](https://96d80a5e-ec8f-4213-b941-201dbeb74ba2.preview.shogo.ai/)  
**Audit Phase:** Phase-1 (Partial Forensic Screenshot Dump)  
**Branch:** `feature/shogo-phase1-gap-audit`  
**Date:** September 19, 2026  

---

## ARCHITECTURAL BOUNDARY & NON-NEGOTIABLE PRINCIPLES

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                           STRICT ARCHITECTURAL BOUNDARY                          │
├────────────────────────────────────────┬─────────────────────────────────────────┤
│ BELL24H-OS                             │ VYAPARSETHU                             │
│ (Enterprise AI Operating System)       │ (B2B Sourcing & Commerce Platform)      │
├────────────────────────────────────────┼─────────────────────────────────────────┤
│ • AI Router, Policies & Telemetry      │ • B2B Marketplace Catalog               │
│ • Model Adapters & Circuit Breakers    │ • Supplier Directory & Verification     │
│ • Marketing Factory (SEO, Content,     │ • Wholesale Buyer Profiles              │
│   Images, Videos, Publishing)          │ • RFQs, Bidding & Tender Management     │
│ • Asynchronous PostgreSQL Queue Core   │ • Commerce Quotations & Invoicing       │
│ • Multi-Tenant RBAC & Org Isolation    │ • Commerce Escrow & Orders              │
│ • Centralized Audit Logging            │ • Marketplace-Specific CRM             │
└────────────────────────────────────────┴─────────────────────────────────────────┘
```

> **CORE MANDATE:** Bell24h-OS provides the foundational, reusable intelligence, queue, media, and marketing factory infrastructure consumed by VyaparSethu. **Under no circumstances will Bell24h-OS be turned into a commerce marketplace.** No marketplace, supplier, buyer, RFQ, or quotation pages belong inside Bell24h-OS.

---

## 1. CONFIRMED SCREENSHOT INVENTORY (PHASE-1)

The Phase-1 screenshot evidence dump establishes the following **46 reference capabilities**:

| # | Reference Area | Sub-Capability / View |
| :---: | :--- | :--- |
| **1** | Dashboard | Executive Overview Scorecard & Analytics |
| **2** | AI Studio | Studio Shell & Multi-Modal Hub |
| **3** | AI Studio | Playground (Prompt Testing & Execution) |
| **4** | AI Studio | Library (Prompt Templates & Variables) |
| **5** | AI Studio | Compare (Side-by-Side Model Comparison) |
| **6** | AI Studio | Costs (AI Spend Aggregation) |
| **7** | AI Studio | Models (Catalog & Context Specifications) |
| **8** | Image Factory | Generation Canvas (Text-to-Image Parameters) |
| **9** | Image Factory | Gallery (Asset Grid, Download, Preview) |
| **10** | Image Factory | Collections (Categorized Media Groups) |
| **11** | Image Factory | Templates (Reusable Marketing Design Presets) |
| **12** | Image Factory | Brand Kits (Palettes, Typography, Guidelines) |
| **13** | Image Factory | Queue (Asynchronous Render Task Tracker) |
| **14** | Image Factory | Costs (Image Generation Spend Accounting) |
| **15** | Image Factory | Editor (Canvas Adjustments, Cropping, Filters) |
| **16** | AI Router | Overview (Operational Command Scorecard) |
| **17** | AI Router | Policies (`fastest`, `lowest cost`, `balanced`, `fallback`) |
| **18** | AI Router | Circuit Breakers (Provider Failure Thresholds & Cooldown) |
| **19** | AI Router | Capabilities (Text, JSON, Reasoning, Vision Matrix) |
| **20** | AI Router | Workflows (Task-Specific Routing Profiles) |
| **21** | AI Router | Budgets (Multi-Period Spend Caps) |
| **22** | AI Router | Telemetry (Real-Time Latency, Tokens, Error Rates) |
| **23** | AI Router | Benchmarks (Model vs Model Quality/Speed Rankings) |
| **24** | AI Router | Adapters (Connection Status per Upstream LLM) |
| **25** | Video Factory | Generation Canvas (Text-to-Video Synthesis) |
| **26** | Video Factory | Library (Generated Clips & Project Archive) |
| **27** | Video Factory | Queue (Background Video Rendering Pipeline) |
| **28** | Video Factory | Costs (Video Generation Compute Accounting) |
| **29** | Video Factory | Providers (Status of Video AI Engines) |
| **30** | Video Factory | Tests (Test Generation Probe Modal) |
| **31** | Campaign Center | Campaigns (Multi-Channel Strategy Manager) |
| **32** | Campaign Center | Scheduling (Timezone-Aware Dispatch) |
| **33** | Campaign Center | Calendar (Unified Monthly/Weekly Matrix) |
| **34** | Publishing Center | Social Dispatch & Post Execution Engine |
| **35** | SEO Intelligence | Scorecard & Overall Visibility Health |
| **36** | SEO Intelligence | Keywords (Volume, Difficulty, Intent, CPC) |
| **37** | SEO Intelligence | Audits (Technical Crawl, Speed, Core Web Vitals) |
| **38** | SEO Intelligence | Meta Tags (Title, Descriptions, OpenGraph) |
| **39** | SEO Intelligence | Backlinks (Referring Domains & Domain Authority) |
| **40** | SEO Intelligence | Schema (JSON-LD Structured Data Validator) |
| **41** | SEO Intelligence | Content (Density, Readability & Heading Checks) |
| **42** | SEO Intelligence | Competitors (SERP Overlap & Keyword Gaps) |
| **43** | SEO Intelligence | Broken Links (404 Crawl & Redirect Auditing) |
| **44** | SEO Intelligence | Local SEO (Google Business Profile & NAP Citations) |
| **45** | SEO Intelligence | Rankings (Search Position Tracker) |
| **46** | SEO Intelligence | GEO (Generative Engine Optimization AI Citations) |

---

## 2. BELL24H-OS EXISTING CAPABILITIES (CODEBASE REALITY)

Audit of `digitex-erp-bell24h-os` establishes the following concrete assets:

1. **Foundations**: Supabase Auth (`useAuthStore`), PostgreSQL RLS across all tables, Organization Isolation (`public.get_current_org_id()`), and structured audit logging (`server/audit.ts`).
2. **Queue Fleet Subsystem**: `server/queue/QueueManager.ts` implementing atomic `FOR UPDATE SKIP LOCKED` dequeue, lease management, and heartbeat supervision with `server/workers/WorkerRegistry.ts`.
3. **Server AI Bridge**: `server/ai/ProviderRouter.ts` (in-memory budget + audit emission) wiring `GeminiProvider.ts` and `NvidiaProvider.ts` to `POST /api/v1/ai/text` and Vault endpoints.
4. **Marketing & SEO Suite**: Complete Enterprise SEO Center with 12 operational endpoints (`server/routes/seoRoutes.ts`), `CampaignDashboardPage.tsx`, `CampaignBuilderPage.tsx`, `ContentPlannerPage.tsx`, and `PublishingCenterPage.tsx`.
5. **Creative Studios**: `ImageStudioPage.tsx`, `VideoStudioPage.tsx`, `MediaComposerDashboardPage.tsx`, and `PromptStudioPage.tsx`.
6. **Knowledge Engine**: `KnowledgeVaultPage.tsx` with AI summary and mentoring endpoints.

---

## 3. FULL CAPABILITY CLASSIFICATION MATRIX

Every capability is classified strictly into:
- `[EXISTING]`: Verified in Bell24h-OS code.
- `[PARTIAL]`: Implemented in part; key features missing.
- `[MISSING]`: Not implemented in Bell24h-OS.
- `[NOT APPLICABLE]`: Belongs to VyaparSethu commerce layer.
- `[DEFERRED]`: Requires further screenshot dumps before acting.

| # | Reference Capability | Classification | Forensic Evidence in Bell24h-OS |
| :---: | :--- | :---: | :--- |
| **1** | Dashboard | **[EXISTING]** | `src/pages/DashboardPage.tsx` with metrics, activity feed, and navigation. |
| **2** | AI Studio (Shell) | **[PARTIAL]** | `AiProvidersPage.tsx` and `PromptStudioPage.tsx` exist as separate pages; unified tabbed studio shell is missing. |
| **3** | AI Studio Playground | **[EXISTING]** | `src/pages/PromptStudioPage.tsx:140-280` has live prompt execution, model selection, temperature slider, and variable injection. |
| **4** | AI Studio Library | **[EXISTING]** | `public.prompt_templates` table (`add_prompt_tables.sql`) + Library view in `PromptStudioPage.tsx:290-410`. |
| **5** | AI Studio Compare | **[MISSING]** | No side-by-side prompt execution across multiple models in `PromptStudioPage.tsx`. |
| **6** | AI Studio Costs | **[PARTIAL]** | `public.ai_request_logs` stores `tokens_used`, `latency_ms`, and `cost`, but no dedicated visual cost aggregation screen exists. |
| **7** | AI Studio Models | **[PARTIAL]** | Default models hardcoded in `AiProviderService.ts` and `ProviderManager.ts`; dynamic model capability catalog is absent. |
| **8** | Image Factory (Generate) | **[EXISTING]** | `src/pages/ImageStudioPage.tsx:110-195` supports prompt, negative prompt, aspect ratios, and model selection. |
| **9** | Image Factory (Gallery) | **[EXISTING]** | `src/pages/ImageStudioPage.tsx:210-320` renders generated asset grid with download and full preview. |
| **10** | Image Collections | **[EXISTING]** | `public.image_collections` table (`add_image_studio_tables.sql`) with collection tagging. |
| **11** | Image Templates | **[EXISTING]** | `public.image_templates` table (`add_image_studio_tables.sql`) storing style and prompt presets. |
| **12** | Brand Kits | **[EXISTING]** | `src/pages/ContextProfileManagerPage.tsx` manages Brand Identity, color palettes, tone, and guidelines. |
| **13** | Image Queue | **[EXISTING]** | Handled asynchronously via `server/queue/QueueManager.ts` and `server/workers/handlers/MediaJobHandler.ts`. |
| **14** | Image Costs | **[MISSING]** | No compute cost or credit consumption screen for image generation. |
| **15** | Image Editor | **[PARTIAL]** | Basic composer adjustments exist in `MediaComposerDashboardPage.tsx`, but advanced canvas layer filtering is missing. |
| **16** | AI Router Overview | **[PARTIAL]** | `server/ai/ProviderRouter.ts` runs on server; visual command center UI is missing. |
| **17** | AI Router Policies | **[MISSING]** | Policies (`fastest`, `lowest cost`, `balanced`, `fallback only`) not implemented in `server/ai/ProviderRouter.ts`. |
| **18** | AI Router Circuit Breakers | **[MISSING]** | Zero failure count trip switches or cooldown states in `server/ai/`. |
| **19** | AI Router Capabilities | **[MISSING]** | No server matrix mapping providers to supported modalities (text, json, reasoning, vision). |
| **20** | AI Router Workflows | **[PARTIAL]** | `AIJobHandler.ts` routes by job type, but fine-grained task routing profiles (`chat` vs `extraction`) are missing. |
| **21** | AI Router Budgets | **[PARTIAL]** | In-memory `AI_REQUEST_DAILY_BUDGET` exists in `ProviderRouter.ts:28`; persistent multi-tenant DB budgets missing. |
| **22** | AI Router Telemetry | **[PARTIAL]** | `emitAuditEvent` logs to stdout; DB logging of tokens/latency to `ai_request_logs` from server router is missing. |
| **23** | AI Router Benchmarks | **[MISSING]** | No automated benchmark testing or ranking across providers. |
| **24** | AI Router Adapters | **[PARTIAL]** | Gemini and Nvidia NIM implemented; DeepSeek, Qwen, GLM, MiniMax adapters missing on server. |
| **25** | Video Factory (Generate) | **[EXISTING]** | `src/pages/VideoStudioPage.tsx:140-220` with prompt, duration, aspect ratio, camera motion controls. |
| **26** | Video Factory (Library) | **[EXISTING]** | `public.video_projects` and `public.video_scenes` tables (`add_video_studio_tables.sql`). |
| **27** | Video Factory (Queue) | **[EXISTING]** | Queued via `job_type: "video"` in `server/queue/QueueManager.ts` and `MediaJobHandler.ts`. |
| **28** | Video Costs | **[MISSING]** | No dedicated video rendering compute cost tracker. |
| **29** | Video Providers | **[PARTIAL]** | Models declared in client types; active server-side video rendering provider adapters not wired. |
| **30** | Video Tests | **[EXISTING]** | Test prompt generator and sample render preview modal in `VideoStudioPage.tsx`. |
| **31** | Campaign Center | **[EXISTING]** | `src/pages/CampaignDashboardPage.tsx` and `src/pages/CampaignBuilderPage.tsx`. |
| **32** | Campaign Scheduling | **[EXISTING]** | Timezone-aware date pickers and schedule triggers in `CampaignBuilderPage.tsx`. |
| **33** | Campaign Calendar | **[EXISTING]** | Monthly/weekly scheduling calendar in `src/pages/ContentPlannerPage.tsx:150-280`. |
| **34** | Publishing Center | **[EXISTING]** | `src/pages/PublishingCenterPage.tsx` + `server/workers/handlers/PublishingJobHandler.ts`. |
| **35** | SEO Intelligence | **[EXISTING]** | `src/pages/SeoDashboardPage.tsx` + `server/routes/seoRoutes.ts:14-48`. |
| **36** | SEO Keywords | **[EXISTING]** | `server/routes/seoRoutes.ts:51-61` (`/api/seo/keywords`). |
| **37** | SEO Audits | **[EXISTING]** | `server/routes/seoRoutes.ts:63-75` (`/api/seo/audit`). |
| **38** | SEO Meta Tags | **[EXISTING]** | `server/routes/seoRoutes.ts:133-151` (`/api/seo/meta-tags`). |
| **39** | SEO Backlinks | **[EXISTING]** | `server/routes/seoRoutes.ts:153-171` (`/api/seo/backlinks`). |
| **40** | SEO Schema | **[EXISTING]** | `server/routes/seoRoutes.ts:173-191` (`/api/seo/schema`). |
| **41** | SEO Content | **[EXISTING]** | `server/routes/seoRoutes.ts:193-211` (`/api/seo/content-analysis`). |
| **42** | SEO Competitors | **[EXISTING]** | `server/routes/seoRoutes.ts:213-231` (`/api/seo/competitors`). |
| **43** | SEO Broken Links | **[EXISTING]** | `server/routes/seoRoutes.ts:233-251` (`/api/seo/broken-links`). |
| **44** | SEO Local | **[EXISTING]** | `server/routes/seoRoutes.ts:253-271` (`/api/seo/local`). |
| **45** | SEO Rankings | **[EXISTING]** | `server/routes/seoRoutes.ts:77-109` (`/api/seo/rankings`). |
| **46** | SEO GEO Citations | **[EXISTING]** | `server/routes/seoRoutes.ts:111-131` (`/api/seo/geo`). |

---

## 4. AI ROUTER GAP ANALYSIS

### Existing Architecture vs Shogo Requirements

```mermaid
flowchart LR
    subgraph Current Bell24h-OS
        R1[ProviderRouter.ts] --> G[GeminiProvider]
        R1 --> N[NvidiaProvider]
        R1 -. In-Memory Cap .-> B1[AI_REQUEST_DAILY_BUDGET]
        R1 -. Stdout .-> A1[emitAuditEvent]
    end

    subgraph Target Enterprise Architecture
        TR[AIRouter Core] --> P[Routing Policies: Balanced / Cost / Speed]
        TR --> CB[Circuit Breakers: Open / Half-Open / Closed]
        TR --> AD[Adapters: Gemini, Nvidia, DeepSeek, Qwen, GLM, MiniMax]
        TR --> DB[(public.ai_request_logs)]
        TR --> API[/api/ai-router/*]
    end
```

### Concrete Gaps:
1. **Missing Provider Adapters**:
   - `DEEPSEEK_API_KEY`, `QWEN_API_KEY`, `GLM_API_KEY`, and `MINIMAX_API_KEY` are provisioned in Vercel, but zero adapter files exist in `server/ai/`.
2. **Missing Routing Policy Engine**:
   - `ProviderRouter.ts` only accepts explicit `provider: "nvidia"` or defaults to Gemini. It cannot resolve dynamic policies such as `fastest`, `lowest cost`, or `balanced`.
3. **Missing Circuit Breaker State Machine**:
   - No tracking of consecutive failures (5xx/429), automatic tripping to `OPEN`, or exponential cooldown timers.
4. **Missing Telemetry Persistence**:
   - Prompt/completion tokens and latencies are not written to `public.ai_request_logs` during router execution.

---

## 5. AI STUDIO GAP ANALYSIS

1. **Compare Capability [MISSING]**:
   - Shogo provides a prompt comparator executing the same prompt against multiple models simultaneously. Bell24h-OS's `PromptStudioPage.tsx` only allows sequential single-model execution.
2. **Unified Studio Shell [PARTIAL]**:
   - Studio navigation is split between `/prompt-studio`, `/ai-providers`, `/image-studio`, and `/video-studio`. A unified shell with sub-tabs (`Playground`, `Library`, `Compare`, `Costs`, `Models`) provides better workflow continuity.

---

## 6. IMAGE FACTORY GAP ANALYSIS

1. **Storage & Assets [EXISTING]**:
   - Supabase Storage bucket `marketing-assets` is configured in `add_storage_bucket.sql`.
2. **Brand Kits & Guidelines [EXISTING]**:
   - Reusable brand context is managed cleanly in `ContextProfileManagerPage.tsx`.
3. **Cost Breakdown [MISSING]**:
   - No view tracks cumulative image render costs per tenant.

---

## 7. VIDEO FACTORY GAP ANALYSIS

### Marketing Factory Pipeline Alignment

```
SEO/GEO Intelligence (server/routes/seoRoutes.ts)
                    ↓
Topic & Keyword Insights (SeoCenterPage.tsx)
                    ↓
Content Generation (ContentPlannerPage.tsx)
                    ↓
Image Asset Synthesis (ImageStudioPage.tsx)
                    ↓
Video Factory (VideoStudioPage.tsx)
                    ↓
Asynchronous Queue (server/queue/QueueManager.ts)
                    ↓
Worker Fleet Execution (server/workers/handlers/MediaJobHandler.ts)
                    ↓
Publishing Center (PublishingCenterPage.tsx)
```

### Concrete Gaps:
1. **Queue Connection Verification**:
   - `MediaJobHandler.ts` handles `job_type: "video"`, but client `VideoStudioPage.tsx` must ensure jobs enqueue through `POST /api/v1/queue/enqueue` rather than direct client table inserts.
2. **Video Provider Health**:
   - Needs server-side probe indicating whether video synthesis engines (OpenSora, CogVideoX, Hunyuan) are operational.

---

## 8. SEO + GEO GAP ANALYSIS

1. **Endpoint Parity [EXISTING & 100% COMPLETE]**:
   - All 12 SEO & GEO domains requested in Phase-1 (`keywords`, `audits`, `meta-tags`, `backlinks`, `schema`, `content-analysis`, `competitors`, `broken-links`, `local`, `rankings`, `geo`, `dashboard`) are **fully implemented** in `server/routes/seoRoutes.ts`.
2. **Pipeline Connection [PARTIAL]**:
   - Keywords generated in `SeoCenterPage.tsx` should seamlessly feed into `ContentPlannerPage.tsx` and `PromptStudioPage.tsx` with a single click.

---

## 9. CAMPAIGN & PUBLISHING GAP ANALYSIS

1. **Campaign Management [EXISTING]**:
   - `CampaignDashboardPage.tsx` and `CampaignBuilderPage.tsx` provide complete campaign lifecycle tracking.
2. **Calendar [EXISTING]**:
   - `ContentPlannerPage.tsx` provides the monthly/weekly content distribution grid.
3. **Publishing Worker [EXISTING]**:
   - `PublishingJobHandler.ts` handles scheduled social dispatches via `job_type: "publishing"`.

---

## 10. ARCHITECTURE & MULTI-TENANCY DEPENDENCIES

All Bell24h-OS enhancements must conform to the following invariants:
1. **Zero Secret Leakage**:
   - All AI provider keys (`GEMINI_API_KEY`, `NVIDIA_API_KEY`, `DEEPSEEK_API_KEY`, `QWEN_API_KEY`, `GLM_API_KEY`, `MINIMAX_API_KEY`) reside strictly in `server/ai/ProviderManager.ts` and process environment.
2. **Strict Multi-Tenancy**:
   - All queries and mutations must include `organization_id` and be validated by Supabase Row Level Security (`public.get_current_org_id()`).
3. **URL Routing Integrity**:
   - All navigation must use standard React Router v6 URL paths. No in-memory `switch(activePage)` state that breaks deep linking.

---

## 11. DATABASE GAPS

Existing tables (`ai_providers`, `ai_request_logs`, `job_queue`, `job_logs`, `prompt_templates`, `video_projects`, `campaigns`) cover most needs. 

**Required Additions for Phase-1 Gap Closure:**
1. `public.ai_router_policies`: Store tenant-customizable routing policies (`balanced`, `cost_optimized`, `latency_optimized`).
2. `public.ai_router_budgets`: Store durable monthly/daily spend caps and alert thresholds per organization.
3. `public.feature_flags`: Dynamic feature enablement per tenant.

---

## 12. API GAPS (SERVER ENDPOINTS TO ADD)

The following endpoints must be added to `server.ts` to support the AI Router and Telemetry:
- `GET /api/v1/ai-router/dashboard`: Aggregated scorecard (requests, spend, active policies, breaker states).
- `GET /api/v1/ai-router/telemetry`: Latency and token consumption time-series from `public.ai_request_logs`.
- `GET /api/v1/ai-router/circuit-breakers`: Real-time health and trip status per provider.
- `POST /api/v1/ai-router/circuit-breakers/:provider/reset`: Manual trip reset for operators.
- `POST /api/v1/ai-router/route`: Route resolution tester (evaluates which provider/model satisfies a given policy and task).

---

## 13. VYAPARSETHU CONSUMPTION INTERFACE

To ensure clean decoupling, VyaparSethu will consume Bell24h-OS infrastructure via the following interfaces:
1. **S2S AI Text & JSON Generation**: `POST /api/v1/ai/text` via `requireServiceAuth` (`BELL24H_VYAPARSETHU_SERVICE_TOKEN`).
2. **Asynchronous Background Queue**: `POST /api/v1/queue/enqueue` for heavy background processing (RFQ notifications, supplier batch scoring).
3. **Marketing Factory Asset Generation**: Automated product image and promo video rendering through `MediaJobHandler`.

---

## 14. CONFIRMED PHASE-1 ACTIONABLE SCOPE

### In-Scope for Immediate Implementation (Bell24h-OS AI OS Foundation):
1. **Server-Side Missing AI Adapters**:
   - `server/ai/DeepSeekProvider.ts`
   - `server/ai/QwenProvider.ts`
   - `server/ai/GLMProvider.ts`
   - `server/ai/MiniMaxProvider.ts`
2. **AI Router Core Engine Enhancement**:
   - Dynamic policy evaluation (`balanced`, `cost_optimized`, `latency_optimized`).
   - Circuit breaker state machine (`CLOSED`, `OPEN`, `HALF-OPEN`).
   - Automatic fallback chain.
3. **AI Telemetry & Token Logging**:
   - Wire router completion to insert real metrics into `public.ai_request_logs`.
4. **AI Router Control Dashboard (`src/pages/AiRouterDashboardPage.tsx`)**:
   - Visual telemetry charts, active policies, circuit breaker status cards, and route tester.
5. **AI Studio Compare Mode**:
   - Side-by-side prompt comparator in `PromptStudioPage.tsx`.

### Strictly Out-of-Scope (Deferred or Belonging to VyaparSethu):
- ❌ Marketplace Directory & Search
- ❌ Supplier Catalog & Profiles
- ❌ Buyer Catalog & Procurement
- ❌ RFQ Exchange & Tender Bidding
- ❌ Commerce Order Management
- ❌ Voice Studio / Avatar Studio (Deferred pending next screenshot dump)
