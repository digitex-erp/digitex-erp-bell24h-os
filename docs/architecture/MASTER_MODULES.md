# Bell24h-OS — Master Module Inventory

**Part of PS-02.** Every module, assigned to a layer under
[`CANONICAL_ARCHITECTURE.md`](./CANONICAL_ARCHITECTURE.md).

**Maturity:** `VERIFIED IMPLEMENTED` · `PLATFORM FOUNDATION` (scaffolding, not yet
delivering value) · `FUTURE` (planned only).
**Confidence:** `VERIFIED` (runtime artifact) · `INFERRED` (code/docs) · `UNKNOWN`.

Layer assignments are decisions made by this sprint (ADR-001), not recovered facts.
Where a module sits in the wrong layer, that is recorded as future migration work —
**nothing was moved, renamed, or fixed.**

---

## Layer 0 — Infrastructure Substrate

| Module | Path | Maturity | Confidence | Evidence | Consumers | Depends on | Known issues |
|---|---|---|---|---|---|---|---|
| Supabase client | `src/lib/supabase.ts` | VERIFIED IMPLEMENTED | VERIFIED | Prod bundle bakes ref `dqpaekyayhqhndihbnnn`; JWT decodes `role: anon` | All client modules | `.env` → `vite.config.ts` | — |
| Postgres pool | `server.ts:102-119` | VERIFIED IMPLEMENTED | VERIFIED | Handlers return `DATABASE_URL is not defined` when unset | 9 handlers | `DATABASE_URL` | **Used inside request handlers → bypasses RLS** (rule 5 ×9) |
| Object storage | Supabase Storage (2 buckets) | PLATFORM FOUNDATION | INFERRED | Buckets + policies in schema | Image factory | L0 | Not exercised at runtime |
| DatabaseService | `src/modules/database/DatabaseService.ts` | FUTURE | INFERRED | Stub: `query()` → `[]`, `ping()` → `true` | **Nothing** | — | Dead code |
| **pgvector** | — | **FUTURE** | VERIFIED ABSENT | No extension, no vector column anywhere | — | — | Blocks all of L3 |
| Cache / queue (Redis) | — | FUTURE | UNKNOWN | Not present | — | — | Blocks durable counters, scale-out |

---

## Layer 1 — Identity, Tenancy & Security

| Module | Path | Maturity | Confidence | Evidence | Consumers | Depends on | Known issues |
|---|---|---|---|---|---|---|---|
| `requireAuth` | `server/middleware/requireAuth.ts` | VERIFIED IMPLEMENTED | **VERIFIED** | RG-C: 10 gated routes return `401 {"error":"unauthenticated"}`, dev **and** prod | 10 of 13 routes | L0 Supabase Auth | Identity only — no role/permission check |
| Authentication (end-to-end) | + `AuthPage.tsx`, `useAuth.ts` | VERIFIED IMPLEMENTED | **VERIFIED-BY-OWNER** | Certification Dashboard reported `V1.0 STABLE`, requiring `auth`+`db`+`session`+`jwt`+`org` all passing | L6 | L0, L1 | Reported by owner, not observed by this session |
| AuthService | `src/modules/auth/AuthService.ts` | PLATFORM FOUNDATION | INFERRED | `resolveRole()` fails closed to `VIEWER` | `useAuth.ts` | L0 | Client-side — UI affordance, **not** authorization |
| useAuthStore / AUTH_BYPASS | `src/store/useAuthStore.ts` | VERIFIED IMPLEMENTED | **VERIFIED** | 0 bypass markers in prod bundle (all 5 checked) | Protected pages | L0 | Temporary dev construct |
| Organizations | `organizations`, `profiles`, `OrganizationPage.tsx` | PLATFORM FOUNDATION | INFERRED | Hand-written policies `supabase_schema.sql:495-517` | Everything org-scoped | L0 | Page queries Supabase directly (rule 3) |
| Permissions / RBAC | `roles`, `permissions`, `user_roles` | PLATFORM FOUNDATION | VERIFIED (gap) | **`permissions` has no RLS and no policy** | Nothing enforces it | L0 | **No server-side authorization primitive** — `hasPermission`/`checkRole`/`authorize` → 0 hits |
| Audit | `server/audit.ts` | PLATFORM FOUNDATION | VERIFIED | Called from `requireAuth`, `rateLimit`, `ProviderRouter`, `devOnly` | L1/L2/L4 | — | **stdout only.** `audit_logs` table never written |
| Tenant isolation (cross-tenant) | RLS, schema-wide | PLATFORM FOUNDATION | **UNVERIFIED** | Owning-org read succeeds. **Second tenant returning zero rows never demonstrated** | — | L0 | Highest-value untested claim in the system (ADR-008) |
| Secret access policy | — | FUTURE | UNKNOWN | No envelope encryption, no KMS | — | — | Needed for Integration Hub credentials (ADR-006) |

---

## Layer 2 — Platform Core Services

| Module | Path | Maturity | Confidence | Evidence | Consumers | Depends on | Known issues |
|---|---|---|---|---|---|---|---|
| Job Orchestrator | `src/modules/job-orchestrator/JobOrchestratorService.ts` | PLATFORM FOUNDATION | INFERRED | Real enqueue/dependency/retry against `job_queue` | 3 studio pages | L0, L4 | Runs **client-side**; no server scheduler |
| JobWorker | `src/modules/job-orchestrator/JobWorker.ts` | PLATFORM FOUNDATION | **VERIFIED (disabled)** | `src/main.tsx:7-9` — import **and** `.start()` both commented out | **Nothing** | L2 | **Queue is write-only. Jobs enqueue and never run.** |
| Rate limiting | `server/middleware/rateLimit.ts` | PLATFORM FOUNDATION | INFERRED | Applied to 2 AI routes | L4 routes | — | In-memory per-process; wrong across instances |
| Automation / Workflow | `src/modules/automation/AutomationService.ts` | PLATFORM FOUNDATION | INFERRED | CRUD on `automation_workflows` | Automation pages | L0 | `triggerWorkflow()` is a simulation per its own comment |
| API Gateway | `server.ts` | PLATFORM FOUNDATION | VERIFIED | 13 routes; 10 gated, 2 `devOnly`, `/api/health` open | L6 client | L1 | No `/api/v1`, no pagination, no problem-details |
| Event Bus / Outbox | — | **FUTURE** | VERIFIED ABSENT | No domain events anywhere | — | — | Audit cannot become an event projection without it |
| **Enterprise Integration Hub** | — | **FUTURE** | VERIFIED ABSENT | 0 real hits for ERP/CRM/MCP/Razorpay/Salesforce/WhatsApp connectors. Only UI placeholder text in `SettingsPage.tsx` and a "Webhook" dropdown option | — | L1, L2 | Element 5 — reserved (ADR-006) |
| Notification Platform | `notifications` table only | FUTURE | INFERRED | Table exists; no service, no sender | — | — | Schema-only |
| Observability | — | FUTURE | VERIFIED ABSENT | No OpenTelemetry, metrics, or tracing | — | — | `console.log` only |

---

## Layer 3 — Knowledge & Memory Substrate

**This layer is essentially unbuilt — the largest gap between target and reality.**

| Module | Path | Maturity | Confidence | Evidence | Consumers | Depends on | Known issues |
|---|---|---|---|---|---|---|---|
| Context / profile store | `context_profiles`, `brand_profiles`, `campaign_profiles`, `audience_profiles`, `context_variables` | PLATFORM FOUNDATION | INFERRED | 5 tables with org-isolation policies | `ContextEngineService` | L0 | Its own page bypasses the service |
| ContextEngineService | `src/modules/context-engine/ContextEngineService.ts` | PLATFORM FOUNDATION | INFERRED | Flattens profile + variables to a map | **Nothing** | L0 | `ContextProfileManagerPage` queries Supabase directly instead |
| Knowledge Vault | `src/components/vault/*`, `vault_*` (5 tables), 7 routes | PLATFORM FOUNDATION | **VERIFIED (defective)** | Routes `requireAuth`-gated (RG-C). Tables have **no `organization_id`**; policies `USING (true)`; handlers bypass RLS | `KnowledgeVaultPage` | L0 | **Contested — ADR-010.** Not tenant-safe. UI 401s (no client token). ICECRAFT provenance |
| KnowledgeBaseService | `src/modules/knowledge/KnowledgeBaseService.ts` | FUTURE | INFERRED | Stub: `search()` logs and returns `[]` | **Nothing** | — | Dead code; unrelated to the Vault feature |
| **Industry Knowledge Pack registry** | — | **FUTURE** | VERIFIED ABSENT | 0 hits for "knowledge pack"; **0 category seed rows** | — | L0 | Element 2 — reserved (ADR-003, ADR-009) |
| **Vector store / embeddings** | — | **FUTURE** | VERIFIED ABSENT | No pgvector, no embedding column | — | L0 | Blocks Memory + Knowledge Runtimes |
| **Knowledge Graph** | — | FUTURE | VERIFIED ABSENT | — | — | L0 | — |
| **Search index** | — | FUTURE | VERIFIED ABSENT | No `tsvector`, no hybrid ranking | — | L0 | — |

---

## Layer 4 — Enterprise AI Runtime (the AI-OS kernel)

| Runtime / Module | Path | Maturity | Confidence | Evidence | Consumers | Depends on | Known issues |
|---|---|---|---|---|---|---|---|
| Provider Manager | `server/ai/ProviderManager.ts` | PLATFORM FOUNDATION | VERIFIED | Resolves `GEMINI_API_KEY` from `process.env` only; fails closed | `GeminiProvider` | L0 env | **Single provider only** |
| ProviderRouter | `server/ai/ProviderRouter.ts` | PLATFORM FOUNDATION | VERIFIED | Wired to both AI routes; emits audit per attempt | 2 routes | L1, L4 | Self-documented as "NOT the full Enterprise AI Router" |
| GeminiProvider | `server/ai/GeminiProvider.ts` | PLATFORM FOUNDATION | INFERRED | Imported only by `ProviderRouter` | L4 | L4 | Not exercised (no key configured) |
| AI budget | `ProviderRouter.ts:27-59` | PLATFORM FOUNDATION | INFERRED | Per-org daily cap | L4 | — | In-memory `Map`; resets on restart |
| **AiProviderService (LEGACY)** | `src/modules/ai-providers/AiProviderService.ts` | PLATFORM FOUNDATION | VERIFIED | `select()` excludes `api_key` (RG-C bundle-verified) | 5 pages + JobOrchestrator | L0 | **MISPLACED — browser-resident L4.** A second, parallel AI path. Must be replaced, not adapted (ADR-012) |
| Prompt Runtime | `PromptStudioPage.tsx`, `prompt_*` (6 tables) | PLATFORM FOUNDATION | INFERRED | Full RLS set incl. per-user favourites | L6 UI | L0, L4 | Routes AI through the **legacy browser path** |
| Agent Runtime | `src/modules/agents/AgentService.ts` | FUTURE | INFERRED | Stub: `listAgents()` → `[]`, `spawnAgent()` logs | **Nothing** | — | Dead code. Element 3 depends on this |
| **OmniRoute** | — | **FUTURE** | VERIFIED ABSENT | No file in `src/` or `server/` references it | — | L4 | Planning docs claim "installed, not integrated" — no repository evidence either way |
| **Context Runtime** | — | FUTURE | VERIFIED ABSENT | No token budgeting or compression | — | L3 | — |
| **Memory Runtime** | — | FUTURE | VERIFIED ABSENT | — | — | L3 | Blocked on pgvector |
| **Knowledge Runtime** | — | FUTURE | VERIFIED ABSENT | — | — | L3 | Blocked on pack registry |
| **Reasoning Runtime** | — | FUTURE | VERIFIED ABSENT | 0 hits | — | L4 | — |
| **Transformer Runtime** | — | **FUTURE (reserved)** | VERIFIED ABSENT | 0 hits for transformer/foundation model | — | L0, L3 | Element 1 — reserved, deliberately unbuilt (ADR-002) |
| **Foundation Models (multi-provider)** | — | FUTURE | VERIFIED ABSENT | Only Gemini exists | — | L4 | Claude/GPT/Llama/Mistral/Groq all absent |

---

## Layer 5 — Applied AI Capabilities

### AI Factory Platform (Element 4)

**Architecturally one platform with seven modality adapters (ADR-005). Today it is three
disconnected studios** — and the schema shows the anti-pattern directly: `image_projects/
templates/styles/jobs/assets` and `video_projects/templates/styles/jobs/assets` are
near-identical shapes duplicated per modality (Confidence: **VERIFIED** — schema read).

| Factory | Path | Maturity | Confidence | Evidence | Known issues |
|---|---|---|---|---|---|
| Content Factory | `ContentPlannerPage.tsx`, `content_*` (5) | PLATFORM FOUNDATION | INFERRED | Full RLS set | Legacy browser AI path |
| Image Factory | `ImageStudioPage.tsx`, `image_*` (5) + bucket | PLATFORM FOUNDATION | INFERRED | Full RLS set | Same |
| Video Factory | `VideoStudioPage.tsx`, `video_*` (7) | PLATFORM FOUNDATION | INFERRED | Full RLS set | Same |
| Voice Factory | `src/modules/voice/VoiceService.ts` | FUTURE | INFERRED | Stub: `new Blob()` / hardcoded string | Dead code |
| Document Factory | — | FUTURE | VERIFIED ABSENT | — | — |
| CAD Factory | — | FUTURE | VERIFIED ABSENT | Only hit is an ICECRAFT seed row tagged `CAD` | Needed by 3DFabrica |
| Digital Asset Factory | — | FUTURE | VERIFIED ABSENT | No provenance/versioning layer | — |

### Enterprise AI Support (Element 3)

**All six are FUTURE. Zero occurrences of "assistant" in `src/`, `server/`, or the schema**
(Confidence: **VERIFIED ABSENT**). Architecturally these are six *profiles* over one L4
Agent Runtime, not six modules (ADR-004).

| Assistant | Status | Blocked on |
|---|---|---|
| Public · Buyer · Supplier · Admin · Developer · Trade | **FUTURE** ×6 | L4 Agent Runtime (stub), L3 knowledge packs (absent), L1 authorization primitive (absent) |

The closest existing artifact is the "AI Founder Mentor" in `KnowledgeVaultPage.tsx` — a
single hardcoded prompt against one endpoint, **not** an assistant framework.

### Other applied capabilities

| Module | Path | Maturity | Confidence | Known issues |
|---|---|---|---|---|
| SEO Intelligence | `src/modules/seo-intelligence/*` | PLATFORM FOUNDATION | INFERRED | Rule-based heuristics, **no AI** despite the name; `getOpportunities(projectId)` ignores its own parameter |
| GEO Engine / AI Discovery | — | FUTURE | VERIFIED ABSENT | No matches for GEO / Nearby SEO |
| Publishing | `src/modules/publishing-center/*`, `publishing_*` (10) | PLATFORM FOUNDATION | INFERRED | Thin CRUD; routed but absent from nav |
| Campaign Manager | `src/modules/campaign-manager/*` | PLATFORM FOUNDATION | INFERRED | No update/delete; `campaigns` defined **twice** in schema |
| Performance Intelligence | `src/modules/performance/*` (9 tables) | PLATFORM FOUNDATION | INFERRED | Aggregates **client-side** — will not scale |
| Media Composer | `src/modules/media-composer/*` (6 tables) | PLATFORM FOUNDATION | INFERRED | Routed but absent from nav |
| Industry Intelligence | `src/modules/industry-intelligence/*` (6 tables) | PLATFORM FOUNDATION | INFERRED | Sole consumer `IndustryDashboardPage` is **orphaned** → effectively dead. Ownership open (ADR-003) |
| Analytics | — | FUTURE | VERIFIED ABSENT | No rollups |
| Commerce: Payment · Wallet · Ledger · Escrow | — | **FUTURE** | **VERIFIED ABSENT** | Wallet/Ledger/Trust Score/Ratings → no source matches; Escrow → planning docs only |

---

## Layer 6 — Applications

| Application / Module | Path | Maturity | Confidence | Evidence | Known issues |
|---|---|---|---|---|---|
| VyaparSethu marketplace domain | `buyers`, `suppliers`, `rfqs`, `rfq_items`, `quotations`, `quotation_items`, `orders`, `order_items`, `products`, `categories`, `companies`, `contacts` | FUTURE | **VERIFIED (schema-only)** | Tables exist with org RLS. **No service, page, or CRUD anywhere in `src/`** — only `DatabasePage.tsx` row-counts them | Entire marketplace is schema without behaviour |
| **3DFabrica** | — | **FUTURE** | VERIFIED ABSENT | No fabric/PBR/material-library/digital-twin code | Scope now decided (ADR-007): digital fabric intelligence. Depends on L5 CAD + Image + Digital Asset factories, none of which exist |
| Knowledge Book | — | FUTURE | UNKNOWN | No code in this repository | — |
| Application shell (25 pages) | `src/pages/*`, `src/components/layout/*` | VERIFIED IMPLEMENTED | VERIFIED | Prod build serves SPA; `/dashboard` → 200 | 8 pages routed but not in nav; `IndustryDashboardPage` orphaned |
| System Diagnostics | `src/pages/SystemDiagnosticsPage.tsx` | VERIFIED IMPLEMENTED | **VERIFIED-BY-OWNER** | Reported `V1.0 STABLE` | **Outside `ProtectedRoute`** — publicly reachable |
| CRM | `src/modules/crm/CrmService.ts` | FUTURE | INFERRED | Stub: `getCustomers()` → `[]` | Dead code; unconnected to `companies`/`contacts` |
| Admin | `src/modules/admin/AdminService.ts`, `AdminPage.tsx` | FUTURE | INFERRED | Stub returns fabricated health (`activeNodes: 42`); page imports **no** service | Pure static UI |
| Settings | `src/modules/settings/SettingsService.ts`, `SettingsPage.tsx` | FUTURE | INFERRED | Stub; page imports no service | Pure static UI; "Third-Party Integrations" tab is a placeholder |

---

## Known issues (recorded, not fixed)

### Security / correctness

| # | Issue | Confidence | Layer |
|---|---|---|---|
| 1 | `ai_providers.api_key` still exists, tenant-readable; no `REVOKE`, no rotation | VERIFIED (open) | L4 |
| 2 | 9 handlers query via pooled `DATABASE_URL`, **bypassing RLS** | VERIFIED | L0/L2 |
| 3 | Cross-tenant isolation never demonstrated | **UNVERIFIED** | L1 |
| 4 | No server-side authorization primitive (`hasPermission` → 0 hits) | VERIFIED | L1 |
| 5 | `permissions` table: no RLS, no policy | VERIFIED | L1 |
| 6 | `job_priorities`: RLS on, **no policy** → denies all | VERIFIED | L2 |
| 7 | `workflow_templates`: created, RLS **never enabled** | VERIFIED | L2 |
| 8 | Vault tables: no `organization_id`, `USING (true)` public read | VERIFIED | L3 |
| 9 | Vault UI 401s — client attaches no `Authorization` header (6 files) | VERIFIED | L3/L6 |
| 10 | `/api/check-users-count` exposes global `auth.users` count to any authenticated user | VERIFIED | L2 |
| 11 | Audit stdout-only; `audit_logs` unwritten | VERIFIED | L1 |
| 12 | `/system/diagnostics` outside `ProtectedRoute` | INFERRED | L6 |

### Structural / technical debt

| # | Issue | Confidence |
|---|---|---|
| 13 | `JobWorker.start()` commented out — queue never drains | VERIFIED |
| 14 | 8 of 18 module services are stubs returning empty/fabricated data | VERIFIED |
| 15 | `IndustryDashboardPage` orphaned; 8 further pages routed but not in nav | VERIFIED |
| 16 | `seo_projects`, `campaigns`, `social_accounts` each defined twice in schema | VERIFIED |
| 17 | Per-modality table duplication (`image_*` vs `video_*` near-identical) — the anti-pattern ADR-005 corrects | VERIFIED |
| 18 | In-memory rate limiter + AI budget break on scale-out | VERIFIED |
| 19 | No test suite, no CI (`.github/` absent) | VERIFIED |
| 20 | Main bundle 853 kB (gzip 232 kB), above Vite's 500 kB guidance | VERIFIED |
| 21 | `package.json` name still `react-example` | VERIFIED |
| 22 | **Schema Sync error — JSON parse failure loading `supabase_schema.sql`** | **REPORTED, not reproduced.** DevOps, not architecture. Deferred to IS-xx |
| 23 | `server.ts` modified in the working tree (RG-C, uncommitted) | VERIFIED |

### Layer-boundary violations (ADR-013)

| Violation | Count | Rule |
|---|---|---|
| L6 pages calling L0 Supabase directly, bypassing their own L5 service | 7+ | Rule 3 |
| Request handlers opening a pooled RLS-bypassing connection | 9 | Rule 5 |
| L4 provider logic resident in the browser | 1 module, 5 consumers | L4 credential rule |
| `ContextProfileManagerPage` bypassing `ContextEngineService` | 1 | Rule 3 |
