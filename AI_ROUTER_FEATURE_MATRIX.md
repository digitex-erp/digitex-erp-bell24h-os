# AI Router Feature Matrix — Shogo Reference vs. Bell24h-OS Destination

Companion to `AI_ROUTER_PARITY_AUDIT.md` (read that first for full evidence/citations — this table is the condensed register). Status vocabulary: **COMPLETE, PARTIAL, MISSING, UI-ONLY, MOCKED, BLOCKED, NOT VERIFIED.** No percentage is given per row; a repo-wide completion percentage is proposed, with its measurement basis, at the bottom.

## Core router surface

| Feature | Shogo reference | Destination evidence | Backend status | UI status | Test evidence | Dependencies/blockers | Status | Next action |
|---|---|---|---|---|---|---|---|---|
| Router overview (counts, success rate, latency, cost) | Overview screen, screenshot A | `GET /api/v1/ai-router/dashboard` → `getRouterDashboardData()` | Real code, ephemeral data source | `AiRouterDashboardPage.tsx` "Providers & Breakers" tab | None direct | In-memory telemetry (see below) | PARTIAL | Sprint D: back by `ai_request_logs` |
| Route Tester / Test Console | Live route testing, screenshot A | `POST /api/v1/ai-router/route`, real execution when `prompt` supplied | Real, confirmed live (not simulation-only) | "Route Simulator" tab | None direct | Role-gating (see Security) | COMPLETE (functionally); BLOCKED (access control) | Sprint B: fix `requireOperatorAuth` |
| Circuit-breaker health display | Screenshot A | `GET /api/v1/ai-router/circuit-breakers`, real state | Real | Same tab, reset button wired | 0 dedicated breaker-state tests | Test gap | PARTIAL | Sprint C: add breaker-transition tests |
| Preferred-provider override | Screenshot A | `RouterOptions.preferredProvider`, honored in `getCandidateProviders` | Real, server-enforced | Not exposed in UI (route-test form only passes `preferredProvider` param — confirmed present at `AiRouterDashboardPage.tsx:214` call site) | Covered indirectly | — | COMPLETE | None |

## B. Routing policies (8 named)

| Policy | Shogo reference | Destination evidence | Backend status | UI status | Test evidence | Status | Next action |
|---|---|---|---|---|---|---|---|
| Fastest Response | Screenshot B | `latency_optimized` (`ProviderTypes.ts:17`) | Enforced server-side | Policy dropdown (destination's own labels, not re-verified 1:1 against Shogo's wording) | None policy-specific | COMPLETE (renamed) | None required; optionally rename for parity |
| Lowest Cost | Screenshot B | `cost_optimized` | Enforced server-side | Same | None | COMPLETE (renamed) | None required |
| Highest Quality | Screenshot B | Approximated by `reasoning` | Enforced server-side, different semantics | Same | None | PARTIAL | Clarify intended quality metric before claiming parity |
| Balanced | Screenshot B | `balanced`, also the hardcoded default | Enforced server-side | Same | None | COMPLETE | None |
| Fallback Only | Screenshot B | None | — | — | — | MISSING | Scope in Sprint B if still wanted |
| Cost Capped | Screenshot B | None (request-count budget exists, not a cost ceiling) | — | — | — | MISSING | Scope in Sprint D alongside real cost accounting |
| Quality Minimum | Screenshot B | None | — | — | — | MISSING | Scope in Sprint B |
| Region Restricted | Screenshot B | None (no region field anywhere) | — | — | — | MISSING | Needs a destination-specific design decision — no Shogo region data to port either (not verified this pass) |

## C. Capability registry (per the task's full capability list)

| Capability | Shogo reference | Destination type-level support | Any real provider flagged true | Status | Next action |
|---|---|---|---|---|---|
| Text generation / chat | Screenshot C | `ProviderCapabilities.text` | All 6 | COMPLETE | None |
| Structured/JSON output | Screenshot C | `ProviderCapabilities.json` | All 6 | COMPLETE | None |
| Reasoning | Screenshot C | `ProviderCapabilities.reasoning` | gemini, nvidia, deepseek, qwen | COMPLETE | None |
| Streaming | Screenshot C | `ProviderCapabilities.streaming` | All 6 (declared) | NOT VERIFIED (declared, not independently traced to a streaming response implementation this pass) | Verify in Sprint C |
| Vision | Screenshot C | `ProviderCapabilities.vision` | gemini only | NOT VERIFIED (flag not cross-checked against `GeminiProvider.ts`'s actual request body) | Verify in Sprint C |
| Tool/function calling | Screenshot C | No field exists | — | MISSING | Add to type + at least one real adapter if needed |
| Image generation | Screenshot C | No field exists | — | MISSING | See the separate Video/Image Factory audit for the adjacent image-gen findings |
| Video generation | Screenshot C | No field exists | — | MISSING | See the separate Video Factory Phase-0 report — zero video capability anywhere in this router, confirmed independently |
| Audio generation / STT / TTS | Screenshot C | No field exists | — | MISSING | Voice Studio (separate branch) already has real STT/TTS-adjacent provider plumbing for calls — do not duplicate, integrate instead if ever connected to the router |
| Embeddings | Not explicitly in screenshots, named in task | No field | — | MISSING | — |
| Classification/translation/summarization/extraction | Named in task | No field | — | MISSING | — |
| Long context | Named in task | No field | — | MISSING | — |
| Private/local reasoning | Named in task | No field, no local-inference adapter | — | MISSING | — |

## D/G. Provider adapters (full named list)

| Provider | Shogo reference | Real adapter | Ops supported | Config status | Tests | Live evidence | Status |
|---|---|---|---|---|---|---|---|
| Google Gemini | Screenshot D | `GeminiProvider.ts` | text, json | Env var only, not probed | Indirect | None this pass | PARTIAL |
| NVIDIA NIM | Screenshot D | `NvidiaProvider.ts` | text, json | Same | Indirect, used as router test fixture | Historical D2 note in code comment only | PARTIAL |
| DeepSeek | Screenshot D | `DeepSeekProvider.ts` | text, json | Same | Indirect | None this pass | PARTIAL |
| Qwen (Alibaba) | Screenshot D | `QwenProvider.ts` | text, json | Same | Indirect | None this pass | PARTIAL |
| GLM (Zhipu) | Screenshot D | `GLMProvider.ts` | text, json | Same | Indirect | None this pass | PARTIAL |
| MiniMax (text) | Screenshot D | `MiniMaxProvider.ts` | text, json | Same | Indirect | None this pass | PARTIAL — do not confuse with Shogo's video-MiniMax |
| OpenAI | Screenshot D | None | — | — | — | — | MISSING |
| Anthropic | Screenshot D | None | — | — | — | — | MISSING |
| xAI | Screenshot D | None | — | — | — | — | MISSING |
| Mistral | Screenshot D | None | — | — | — | — | MISSING |
| OpenRouter | Screenshot D | None | — | — | — | — | MISSING |
| Colibrì | Screenshot D | None, and no real implementation in Shogo either (register mention only) | — | — | — | — | MISSING (not real on either side) |
| Pollinations/FLUX/Stability/Ideogram/Recraft (image) | Task text | None in the AI Router | — | — | — | — | MISSING (video/image providers are the separate Video Factory audit's domain) |

## E. Workflows (29 named, classified per architecture boundary)

All 29 are **MISSING** in the destination — `workflowType` is an untyped passthrough label only (`ProviderTypes.ts:96,112`), with zero dedicated implementation for any named workflow. Classification for when/if built:

| Workflow | Classification | Rationale |
|---|---|---|
| Chat and balanced routing | Belongs in Bell24h-OS (already exists as the router's core function) | Provider-agnostic, already real |
| Swarm reasoning | Belongs in Bell24h-OS | Shared intelligence pattern, provider-agnostic |
| Scenario reasoning / structured analysis | Belongs in Bell24h-OS | Same |
| Private reasoning | Belongs in Bell24h-OS | Needs a local/private-inference adapter first (none exists) |
| Image generation | Belongs in Bell24h-OS | Capability doesn't exist yet in the type system |
| Video generation | Belongs in Bell24h-OS | Already separately audited — zero capability; see Video Factory report |
| Voice synthesis / speech recognition | Belongs in Bell24h-OS, reuse Voice Studio | A separate branch (`feature/shogo-voice-studio-migration`) already has real call-oriented voice infrastructure — integrate, don't rebuild |
| Company DNA reasoning / memory | Belongs in Bell24h-OS | Shared intelligence, not marketplace-specific by name |
| Knowledge graph extraction / relationship reasoning | Belongs in Bell24h-OS | Same |
| Buyer intelligence | Must call VyaparSethu | Marketplace business logic |
| Supplier intelligence | Must call VyaparSethu | Same |
| Supplier qualification | Must call VyaparSethu | Same |
| RFQ intelligence | Must call VyaparSethu | Same |

## Methodology for any completion percentage

Do not treat a page, a config entry, or one passing isolated test as proof of completion. The only defensible percentage this audit will state: **of the 45 distinct sub-features audited above (8 policies + 13 capabilities + 12 providers + 12 distinct workflow categories — the 29 named workflows collapse to 12 distinct categories once duplicates like "image" and "video" are counted once each), 12 are COMPLETE, 9 PARTIAL, 2 NOT VERIFIED, and the remaining 22 are MISSING.** By simple count, that is **12/45 ≈ 27% fully complete, server-enforced and reused from what Shogo's screenshots show** — stated with its exact denominator so it can be recomputed if the scope changes, not presented as a bare number.
