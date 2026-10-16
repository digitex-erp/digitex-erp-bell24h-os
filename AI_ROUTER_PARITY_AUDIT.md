# AI Router Parity Audit

**Date:** 2026-10-16 (same session as the Shogo AI Router screenshot review). **Type:** read-only audit and planning. No application code modified. Repository: `digitex-erp/digitex-erp-bell24h-os`, checkout `C:\Users\Sanika\digitex-erp-bell24h-os`, branch `feature/communication-hub`, HEAD `ca8d1bb6d48e1b9dfc084acdfbe1a6b213d25695`, upstream `origin/feature/communication-hub`. Working tree: 22 pre-existing status entries, identical to the baseline already documented in `BELL24H_OS_BASELINE_FREEZE_AND_GIT_SAFETY_AUDIT.md` — unchanged, all preserved.

## Executive summary

**Bell24h-OS already has a real, substantially working AI Router — do not rebuild it.** `server/ai/ProviderRouter.ts` is a genuine multi-provider routing engine with a real circuit-breaker state machine, deadline-bounded fallback cascades, per-organization budget enforcement, and a live (not simulated) route-test endpoint. 146/146 existing tests pass (re-run fresh this session), 27 of which specifically exercise the router's deadline/fallback/false-success-rejection logic.

The gaps are real but narrower than the Shogo screenshots suggest, because **Shogo's own screenshots are explicitly honest that most of what they show is empty/demo state** (the task's own brief already notes this) — this audit does not treat Shogo as a source of truth, only as a feature checklist to verify against. Three findings matter more than anything in the Shogo comparison itself:

1. **A second, competing, insecure AI-provider UI/data path already exists in the destination**, inherited from earlier work — `src/pages/AiProvidersPage.tsx` reads/writes a tenant-readable `ai_providers` table whose `api_key` column is in plaintext and RLS-readable by any org member, entirely bypassing the real router. This is the "competing routing service" the task's rules warn against building — it's already there, not hypothetical.
2. **The real router's telemetry is not persisted** — it's a 100-entry in-memory ring buffer (`telemetryStore` in `ProviderRouter.ts`), never written to the real, correctly-RLS'd `ai_request_logs` table. This fully explains the discrepancy the task flagged between overview/telemetry numbers in the Shogo screenshots: on a serverless deployment, each function instance has its own independent, ephemeral buffer.
3. **`requireOperatorAuth` does not check for an operator/admin role** — it accepts any valid authenticated session (any org, any role), a shared service-bearer token, or (outside `NODE_ENV=production`) no authentication at all. Combined with finding #2's un-scoped global buffer, any authenticated user from any organization can currently read every other organization's AI request metadata via `GET /api/v1/ai-router/telemetry`.

## Phase 1 — Repository baseline

- Root/branch/HEAD/upstream: see header above — re-verified fresh this session, not assumed from an earlier report.
- Working tree: `package.json`, `server/ai/ProviderRouter.test.ts`, `src/pages/SystemDiagnosticsPage.tsx` modified; 19 untracked top-level entries (docs, scratch files, test files) — identical set already documented and preserved across this engagement's prior audits.
- Existing AI Router/Provider Manager files: `server/ai/ProviderRouter.ts` (831 lines), `ProviderManager.ts` (177 lines), `ProviderTypes.ts` (120 lines), plus 6 adapters: `NvidiaProvider.ts`, `DeepSeekProvider.ts`, `QwenProvider.ts`, `GLMProvider.ts`, `MiniMaxProvider.ts`, `GeminiProvider.ts`. No OpenAI/Anthropic/xAI/Mistral/OpenRouter/Colibrì adapter file exists anywhere.
- Existing test file: `server/ai/ProviderRouter.test.ts`, 27 tests (listed in full in the Feature Matrix doc).
- Existing test/build commands: `npx tsx --test server/ai/*.test.ts "server/communication/__tests__/*.test.ts" "server/middleware/*.test.ts"` → **146 pass, 0 fail, 32 suites** (re-run fresh this session). No GitHub Actions CI exists in this repo (confirmed in an earlier same-day audit, re-confirmed not to have changed) — only Vercel deployment + GitGuardian secret scanning run automatically.
- Relevant prior architecture decisions: this engagement's established, repeatedly-enforced boundary — Bell24h-OS owns shared platform infrastructure (AI routing, provider adapters); VyaparSethu owns marketplace business logic; shared capability exposed via API/SDK, never duplicated.

## Phase 2 — Feature-by-feature comparison

### A. Router overview and route tester

- **Overview**: `GET /api/v1/ai-router/dashboard` → `aiRouter.getRouterDashboardData()` (`ProviderRouter.ts:789-811`) returns `{overview, registry, circuitBreakers, telemetry, policies}` in one call from one in-process module's state. **Status: PARTIAL.** The endpoint and UI wiring are real (`AiRouterDashboardPage.tsx:145`), but the underlying telemetry it reports is the ephemeral in-memory buffer (see Executive Summary #2) — real-looking numbers that are not durable or cross-instance-consistent.
- **Route tester**: `POST /api/v1/ai-router/route` (`server.ts:245-279`). **Status: COMPLETE, and genuinely live, not a simulation-only mock.** When called with no `prompt`, it returns `testRouteSimulation()`'s dry-run candidate-selection result only (`ProviderRouter.ts:813-830`). When called **with** a `prompt`, it additionally executes a real `routeText()` call through the real router and returns the actual provider/model/latency/tokens/fallbackFrom (`server.ts:258-273`). UI: `AiRouterDashboardPage.tsx` tab literally named "Route Simulator" (line 342), calling this same endpoint (line 214). This is the closest destination equivalent to Shogo's "Route Tester," and it is real.
- **Consistency between overview metrics and telemetry data**: **Status: BLOCKED by #2's root cause**, not by a UI bug. Both the overview and the dedicated telemetry endpoint read the identical in-process `telemetryStore` and would agree within one warm instance — but there is no cross-instance/cross-restart durability, so apparent disagreement (the exact symptom in the Shogo screenshot — 1 request/0% success/$0 cost vs. 0 total requests) is the expected behavior of an unpersisted, per-process buffer on a serverless deployment, not a data-pipeline bug to patch in the UI layer.

### B. Routing policies

Destination's actual `RoutingPolicy` type (`ProviderTypes.ts:14-18`): `"balanced" | "cost_optimized" | "latency_optimized" | "reasoning"` — **4 of the 8 Shogo-named policies, and not a 1:1 naming match even for those four.**

| Shogo policy | Destination equivalent | Status | Evidence |
|---|---|---|---|
| Fastest Response | `latency_optimized` | COMPLETE (different name, same intent) | `POLICY_CHAINS.latency_optimized` (`ProviderRouter.ts:274`), enforced server-side via `getCandidateProviders()` |
| Lowest Cost | `cost_optimized` | COMPLETE (different name) | `POLICY_CHAINS.cost_optimized` (line 272), enforced server-side |
| Balanced | `balanced` | COMPLETE (exact name match) | `POLICY_CHAINS.balanced` (line 270), enforced server-side, also the hardcoded default for backward-compat exports (lines 760, 771) |
| Highest Quality | Approximated by `reasoning` | PARTIAL — conceptually close, not identical | `POLICY_CHAINS.reasoning` (line 276) orders by reasoning-capable providers, not an explicit "quality" metric |
| Fallback Only | **None** | MISSING | No code path disables proactive provider selection in favor of fallback-only behavior |
| Cost Capped | **None** | MISSING | `BudgetExceededError`/`DAILY_BUDGET` (lines 49, 129-135) is a *request-count* cap per organization per day, not a *cost-ceiling-per-policy* — a structurally different mechanism, not a renamed version of this policy |
| Quality Minimum | **None** | MISSING | No minimum-quality-threshold gate exists anywhere in the candidate-selection logic |
| Region Restricted | **None** | MISSING | No region field exists on `ProviderMetadata`, `RouterOptions`, or anywhere in the routing logic |

**Every one of the 4 implemented policies is enforced server-side** (inside `getCandidateProviders()`, called from `routeText`/`routeJson`, never UI-only) — confirmed by reading the full `routeText` implementation (`ProviderRouter.ts:489-632`), which has no client-suppliable override that bypasses `POLICY_CHAINS`.

### C. Circuit breakers and fallback

**Status: COMPLETE for the core state machine; PARTIAL on test coverage.**

- State machine: `CLOSED → OPEN → HALF_OPEN` (`CircuitBreakerState`, `ProviderTypes.ts:20`). `FAILURE_THRESHOLD = 3` consecutive failures trips to `OPEN` with a 60s cooldown (`FAILURE_THRESHOLD`/`COOLDOWN_DURATION_MS`, `ProviderRouter.ts:173-174`). `getCircuitBreaker()` (lines 199-219) lazily transitions `OPEN → HALF_OPEN` once `cooldownUntil` has passed — a real, correct (if lazy-evaluated rather than timer-driven) half-open recovery mechanism. A failure while `HALF_OPEN` immediately re-trips to `OPEN` (line 235: `cb.state === "HALF_OPEN"` also triggers the trip condition) — correct "half-open probe failed" handling.
- **A failed provider cannot report false success**: confirmed directly — every call path that reaches `recordBreakerSuccess()` has first passed the empty/invalid-content guard (`ProviderRouter.ts:533-535`, "a 200/OK response with no usable text is not a success"), and this exact behavior is unit-tested (`ProviderRouter.test.ts:463` "whitespace-only provider content is rejected, not returned as a false success", and line 484 for malformed/missing-choices responses).
- **Retry-loop prevention**: the candidate list is a fixed, ordered array per call (`getCandidateProviders`); the loop (`ProviderRouter.ts:510-619`) advances `i` monotonically and never revisits an index — structurally impossible to loop on the same provider twice within one call.
- **Tests**: 27 tests in `ProviderRouter.test.ts`, but **zero of them directly exercise the circuit-breaker state machine itself** (no test asserts a provider actually reaches `OPEN` after 3 failures, or correctly transitions to `HALF_OPEN` after cooldown, or re-trips from `HALF_OPEN`). The 27 existing tests are concentrated on deadline/budget-share math and the false-success guard — a real, specific test-coverage gap.

### D. Provider capability registry

Destination's `ProviderCapabilities` type (`ProviderTypes.ts:22-28`): `{ text, json, reasoning, vision, streaming }` — **5 flags only.** Per-provider declared values (`ProviderManager.ts:52-117`):

| Provider | text | json | reasoning | vision | streaming |
|---|---|---|---|---|---|
| gemini | ✓ | ✓ | ✓ | ✓ | ✓ |
| nvidia | ✓ | ✓ | ✓ | ✗ | ✓ |
| deepseek | ✓ | ✓ | ✓ | ✗ | ✓ |
| qwen | ✓ | ✓ | ✓ | ✗ | ✓ |
| glm | ✓ | ✓ | ✗ | ✗ | ✓ |
| minimax | ✓ | ✓ | ✗ | ✗ | ✓ |

**Not represented in the capability type at all** (so cannot be true for any provider, regardless of what any UI card might claim): tool/function calling, image generation, video generation, audio generation, speech-to-text, text-to-speech, embeddings, classification, translation, summarization, extraction, long-context, private/local reasoning. **Status: MISSING** for all of these — this is a type-level gap, not a per-provider configuration gap. **Important finding: `vision: true` for Gemini is declared but not independently verified in this pass against the actual `GeminiProvider.ts` implementation code** — flagged as NOT VERIFIED rather than assumed correct, since the task explicitly warns against trusting a declared capability flag without checking the adapter.

### E. Workflows

`workflowType` exists only as a free-form, unvalidated string field (`RouterOptions.workflowType`, `ProviderTypes.ts:96`; `TelemetryRecord.workflowType`, line 112) — it is passed through to telemetry for labeling only. **Confirmed by repo-wide search: none of the 29 Shogo-named workflows (chat/balanced routing, swarm reasoning, scenario reasoning, private reasoning, image/video generation, voice synthesis/STT, Company DNA reasoning/memory, knowledge graph extraction/relationship reasoning, buyer intelligence, supplier intelligence, supplier qualification, RFQ intelligence) has any dedicated route, handler, constant, or implementation anywhere in `server/`.** `grep` for `companyDna|CompanyDNA|knowledgeGraph|swarmReasoning|buyerIntelligence|supplierIntelligence|rfqIntelligence` across `server/` returns zero matches.

**Classification per the established architecture boundary** (Bell24h-OS = shared infra, VyaparSethu = marketplace logic):
- **Belongs in Bell24h-OS** (shared intelligence, provider-agnostic): chat/balanced routing (already exists as the router's core function), swarm reasoning, scenario reasoning, private/local reasoning, image/video generation (once those capabilities exist), voice synthesis/STT (overlaps with the already-real Voice Studio work in a separate branch — reuse, don't duplicate), Company DNA reasoning/memory, knowledge-graph extraction/relationship reasoning.
- **Must call VyaparSethu, not be implemented here**: buyer intelligence, supplier intelligence, supplier qualification, RFQ intelligence — these are marketplace-business-logic workflows by name; Bell24h-OS should expose a generic "run this prompt/workflow through the router" capability that VyaparSethu's own services call, never re-implement RFQ/buyer/supplier domain logic inside Bell24h-OS.
- **Status for all 29: MISSING** in the destination. None is a mislabeling or a UI-only stub — none exists at all.

### F. Budgets, telemetry, and benchmarks

- **Budgets**: `DAILY_BUDGET` (env `AI_REQUEST_DAILY_BUDGET`, default 200) enforced via `consumeBudget()` (`ProviderRouter.ts:154-168`), called as the very first line of both `routeText`/`routeJson` (lines 493, 638) — **enforced before any provider call, confirmed by code order, not inferred.** **Status: PARTIAL.** This is an organization-level *request-count* cap, not a cost-ceiling in currency, and it is held in an in-memory `Map` (`budgetByOrg`, line 57) — same non-durability problem as telemetry (resets on restart, not shared across serverless instances). No provider-level budget exists at all.
- **Telemetry**: real fields captured per request (provider, model, policy, workflowType, latency, tokens, status, fallbackFrom, errorMessage) — **Status: PARTIAL, MOCKED-adjacent.** The fields are real and correctly populated on every real request, but storage is the ephemeral `telemetryStore` ring buffer (`ProviderRouter.ts:316`), capped at 100 entries, never written to the real `ai_request_logs` table (which exists, has correct org-scoped RLS — `add_ai_tables.sql:23-55` — and is currently written only by the unrelated, dormant client-side `AiProviderService.ts:444`). **This table swap (router → real DB table) is the single highest-leverage fix available for Sprint D.**
- **Cost accounting**: `TokenUsage` (promptTokens/completionTokens/totalTokens) is captured, but **no currency-cost calculation exists anywhere in `ProviderRouter.ts`/`ProviderManager.ts`** — no price-per-token table, no cost field on `TelemetryRecord`. **Status: MISSING.**
- **Benchmarks**: **Status: MISSING.** No benchmark-running code, no stored benchmark result, no scheduled evaluation job found anywhere in `server/ai/`.
- **Tenant isolation of telemetry/budgets**: **Status: CONFIRMED GAP (not a potential risk — directly verified).** `getRecentTelemetry()`/`getTelemetrySummary()` (`ProviderRouter.ts:318-371`) operate on the single global `telemetryStore` with no `organizationId` filter anywhere in their signature or body. `requireOperatorAuth` (`server.ts:201-214`) does not check for an operator/admin role — see Phase 3.

### G. Provider adapters

| Provider (per task's named list) | Real adapter in destination | Supported ops | Auth method | Config status | Tests | Live-verification evidence |
|---|---|---|---|---|---|---|
| Gemini (Google) | ✓ `GeminiProvider.ts` | text, json | `GEMINI_API_KEY` env var | Code-level only, not independently probed for a live key this pass | Covered indirectly via router tests | None this pass (no live call made) |
| NVIDIA NIM | ✓ `NvidiaProvider.ts` | text, json | `NVIDIA_API_KEY` | Same | Several router tests use NVIDIA as the example provider (e.g. line 504) | D2 production success cited in code comment (`ProviderRouter.ts:124`, "one real observed production success (NVIDIA, 3,176ms per D2)") — historical evidence, not re-verified live this pass |
| DeepSeek | ✓ `DeepSeekProvider.ts` | text, json | `DEEPSEEK_API_KEY` | Same | Indirect | None this pass |
| Qwen (Alibaba DashScope) | ✓ `QwenProvider.ts` | text, json | `QWEN_API_KEY` | Same | Indirect | None this pass |
| GLM (Zhipu AI) | ✓ `GLMProvider.ts` | text, json | `GLM_API_KEY` / `GLN_API_KEY` alias | Same | Indirect | None this pass |
| MiniMax (text) | ✓ `MiniMaxProvider.ts` | text, json | `MINIMAX_API_KEY` / `NINIMAX_API_KEY` alias | Same | Indirect | None this pass — **this is the text-chat MiniMax, NOT the video-generation MiniMax a separate Video Factory audit this session found referenced in Shogo; the two must never be merged into one registry entry** |
| OpenAI | ✗ absent | — | — | MISSING | — | — |
| Anthropic | ✗ absent | — | — | MISSING | — | — |
| xAI | ✗ absent | — | — | MISSING | — | — |
| Mistral | ✗ absent | — | — | MISSING | — | — |
| OpenRouter | ✗ absent | — | — | MISSING | — | — |
| Colibrì | ✗ absent, and absent from Shogo's own source too except one register annotation ("Colibri unwired to frontend") — re-confirmed this pass, unchanged from an earlier audit | — | — | Not a real feature on either side | — | — |
| Pollinations (image) | ✗ absent from the AI Router; a separate Video Factory audit this session found Shogo's own video-dispatcher implementation of this name | — | — | MISSING for text/AI-Router purposes | — | — |
| FLUX / Stability / Ideogram / Recraft (image) | ✗ absent | — | — | MISSING | — | — |

**Credential handling (security-relevant, confirmed safe)**: `getCredential()`/`isProviderConfigured()` (`ProviderManager.ts:124-154`) read exclusively from `process.env`, never from any database table, and fail closed (throw `ProviderCredentialError` rather than returning a partial/invalid credential). The module's own header comment explicitly states the security contract: never read `public.ai_providers` because it's tenant-readable (`ProviderManager.ts:5-9`). **This contract is honored by `ProviderManager.ts`/`ProviderRouter.ts` themselves — the violation is in a separate, legacy file (`AiProviderService.ts`) that this same comment is clearly warning against, and that file still exists and is still wired into `AiProvidersPage.tsx`.**

## Phase 3 — Security and reliability review

| Finding | Severity | Evidence | Status |
|---|---|---|---|
| A second, insecure provider-config path (`ai_providers` table, plaintext `api_key`, RLS-readable by any org member) coexists with the real router | **HIGH** | `add_ai_tables.sql:2-18` (table def, `api_key TEXT`), lines 46 (`CREATE POLICY "Org isolation select" ... FOR SELECT`) — any authenticated member of the owning org can `SELECT api_key` directly; `src/pages/AiProvidersPage.tsx:112-152` writes/reads this table exclusively, never calling the real router endpoints | CONFIRMED |
| `requireOperatorAuth` does not enforce an operator/admin role | **HIGH** | `server.ts:201-214` — accepts (a) a shared service bearer token, (b) any valid session via a plain `requireAuth` fallback with no role check layered on top, or (c) no auth at all when `NODE_ENV !== "production"` | CONFIRMED |
| Cross-tenant telemetry read via the above | **HIGH** (compounds the two findings above) | `getRecentTelemetry`/`getTelemetrySummary` have no organization filter (`ProviderRouter.ts:318-371`); reachable by any authenticated user of any org through `GET /api/v1/ai-router/telemetry` | CONFIRMED |
| Circuit-breaker reset is similarly under-gated | **MEDIUM** | Same `requireOperatorAuth` gate on `POST /api/v1/ai-router/circuit-breakers/:provider/reset` (`server.ts:235`) — any authenticated user could force-reset a provider's breaker, potentially re-exposing a genuinely failing provider to traffic | CONFIRMED |
| Live route-test execution is billable/budget-consuming and reachable the same way | **MEDIUM** | `POST /api/v1/ai-router/route` with a `prompt` makes a real provider call (`server.ts:258-273`), consuming the calling org's daily request budget — acceptable if restricted to real operators, not acceptable under the current gate | CONFIRMED |
| Budget and telemetry are not durable/not horizontally consistent | **MEDIUM** | In-memory `Map`/array state (`ProviderRouter.ts:57, 316`) — resets on process restart, independent per serverless instance | CONFIRMED |
| No currency-cost accounting anywhere | **MEDIUM** | No cost field, no price table, searched and not found in `server/ai/` | CONFIRMED (functionality gap, not a vulnerability) |
| `vision: true` capability flag for Gemini not independently re-verified against adapter code this pass | LOW | Declared in `ProviderManager.ts:60` | NOT VERIFIED |
| Fail-closed credential resolution | — (positive finding) | `ProviderManager.ts:124-138` | CONFIRMED SAFE |
| No fabricated success path in the router itself | — (positive finding) | `ProviderRouter.ts:533-535` + `ProviderRouter.test.ts:463,484` | CONFIRMED SAFE, and tested |
| Timeout/retry/idempotency | PARTIAL | Deadline math is real and tested (27 tests); there is no explicit idempotency key on `routeText`/`routeJson` calls — a retried client request with the same intent would consume budget and attempt providers again with no dedup, though this is consistent with a stateless text-generation API rather than a clear defect | PARTIAL, not independently scored |

No live, paid provider call was made during this audit. No secret value is reproduced anywhere in this report or was printed to any terminal output during the investigation.

## Phase 4 — Evidence-based status register

See `AI_ROUTER_FEATURE_MATRIX.md` for the full per-feature register in the exact column format requested. Summary counts: of the ~45 distinct features/sub-features audited across policies, capabilities, workflows, and providers, **12 are COMPLETE, 9 are PARTIAL, 3 are MOCKED-adjacent (real fields, ephemeral storage), 29 are MISSING (all from the Workflows section), and 2 are NOT VERIFIED.** No percentage is assigned without the measurement basis stated directly beside it (see the matrix document's own methodology note). *(This count uses the 29 named Shogo workflows directly; `AI_ROUTER_FEATURE_MATRIX.md`'s own Methodology section instead consolidates them into 12 distinct categories for its precise 45-item, 12/45≈27% completion figure — see that document for the authoritative, reconciled denominator.)*

## Baseline test/build results (re-run this session, not assumed)

```
npx tsx --test server/ai/*.test.ts "server/communication/__tests__/*.test.ts" "server/middleware/*.test.ts"
→ tests 146, pass 146, fail 0, cancelled 0, skipped 0, todo 0, suites 32
```

No `npm run build`/`tsc --noEmit` was re-run in this specific audit pass (already independently re-confirmed clean for this exact codebase state in two earlier same-day audits this session — not re-duplicated here to stay within this task's own scope).
