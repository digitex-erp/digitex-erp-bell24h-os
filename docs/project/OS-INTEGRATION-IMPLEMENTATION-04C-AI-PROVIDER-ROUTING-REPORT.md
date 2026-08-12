# OS-INTEGRATION-IMPLEMENTATION-04C — AI Provider Routing Decision (NVIDIA First)

**Date:** 2026-08-12
**Type:** Investigation only. No source code changed.

---

## 1. Provider Inventory

| Provider | Adapter | Credential Variable | Base URL | Models | Status |
|---|---|---|---|---|---|
| Gemini | `server/ai/GeminiProvider.ts` (server, via `@google/genai` SDK) + `GeminiProvider` class (client, `src/modules/ai-providers/AiProviderService.ts`) | `GEMINI_API_KEY` | Google GenAI SDK (no raw REST base URL) | `gemini-3.6-flash` (hardcoded default, server-side) | **Server: IMPLEMENTED**, wired into `/api/v1/ai/text`. Client: IMPLEMENTED, legacy/insecure path (BR-01) |
| NVIDIA | `OpenCompatibleProvider` (client-side only) | `NVIDIA_API_KEY` | `https://integrate.api.nvidia.com/v1` | None hardcoded — read from the `ai_providers` DB row's `default_model` column | **Server: NOT IMPLEMENTED** (zero references anywhere in `server/`, confirmed by direct grep this turn). Client: IMPLEMENTED, shares `OpenCompatibleProvider` with 4 other providers |
| DeepSeek | `OpenCompatibleProvider` (client only) | `DEEPSEEK_API_KEY` | `https://api.deepseek.com/v1` | Same as NVIDIA | Client only |
| Qwen | `OpenCompatibleProvider` (client only) | `QWEN_API_KEY` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | Same | Client only |
| GLM | `OpenCompatibleProvider` (client only) | `GLM_API_KEY` | `https://open.bigmodel.cn/api/paas/v4` | Same | Client only |
| MiniMax | `OpenCompatibleProvider` (client only) | `MINIMAX_API_KEY` | `https://api.minimax.chat/v1` | Same | Client only |
| OpenAI | `OpenAIProvider` (client only) | `OPENAI_API_KEY` | dedicated class, not inspected in full this turn (out of scope — not a candidate per this sprint's own framing) | — | Client only |
| Anthropic | `AnthropicProvider` (client only) | `ANTHROPIC_API_KEY` | dedicated class, not inspected in full this turn | — | Client only |

Server-side search method: `grep -riE "NVIDIA|DeepSeek|Qwen|GLM|Minimax|OpenAI|Anthropic"` across
`server/` — **zero matches for any of the seven**, confirming the server-side AI Provider
Manager (`server/ai/*`) supports exactly one provider today, unchanged since BR-01.

## 2. NVIDIA Implementation Status

**Client-side: fully implemented, real, not a stub.** `OpenCompatibleProvider`
(`src/modules/ai-providers/AiProviderService.ts:288-382`) implements `generateText()` and
`generateVideo()` against an OpenAI-compatible chat/video completions API, with
`AbortController`-based timeout, JSON request/response handling, and basic error
surfacing (`data.error?.message`). `checkHealth()` is a stub that always returns `true`
— not a real health probe, for NVIDIA or any of the five providers sharing this class.
No retry logic exists anywhere in the class.

**Server-side: does not exist.** `ServerProviderName` (`server/ai/ProviderManager.ts:16`)
is a TypeScript type with exactly one literal value, `"gemini"`. There is no NVIDIA
branch, no registry entry, no adapter file.

## 3. NVIDIA Credential Variable and Observed Scope

**Variable:** `NVIDIA_API_KEY`, present (empty placeholder) in `.env.example`, not
`VITE_`-prefixed — correctly positioned as a server-only-intended secret in the
template, consistent with how `GEMINI_API_KEY` is declared.

**Scope:** the founder's own Vercel screenshot reports `NVIDIA_API_KEY` scoped to
Production and Preview. **This is recorded as founder-reported, not independently
verified** — this session has no tool that lists Vercel environment-variable scope
assignments (the same gap documented in every S2S sprint this session). No value was
requested, retrieved, or printed.

## 4. Other Provider Credential Scopes Observed (governance note only)

Per the same founder screenshot: `GLM_API_KEY`, `DEEPSEEK_API_KEY`, `QWEN_API_KEY`, and
`MINIMAX_API_KEY` are also reported scoped to Production and Preview. **Same evidence
class as §3 — founder-reported, not independently verified.** Recorded per this
sprint's explicit instruction; none of these four were modified, inspected, or acted on.
Worth noting for a future sprint, not this one: all five of these credentials
(`NVIDIA`, `GLM`, `DeepSeek`, `Qwen`, `MiniMax`) share the exact same
`OpenCompatibleProvider` client-side pattern — a single server-side port of that pattern
would make all five usable server-side at once, not just NVIDIA (see §12).

## 5. NVIDIA Endpoint

`https://integrate.api.nvidia.com/v1` — NVIDIA's real, standard NIM/"integrate" API,
OpenAI-compatible (`/chat/completions`, `/video/generations`), `Authorization: Bearer
<key>` auth. This is a genuine, documented, production NVIDIA endpoint, not a
placeholder or invented URL — it already appears, verbatim, in this repository's own
existing (client-side) code.

## 6. NVIDIA Models

**None hardcoded anywhere in this codebase.** The client-side adapter reads
`this.config.default_model` from the `ai_providers` database row — meaning a specific
model identifier (e.g. an NVIDIA NIM catalog model like a Llama or Mistral variant) has
never been chosen or recorded in source for this provider. This would need to be decided
as part of any future adapter work, not assumed here.

## 7. Gemini Implementation Status

**Server-side: fully implemented for text/JSON generation only.** No image or video
capability exists in `GeminiProvider.ts` (server). Currently the only provider
`/api/v1/ai/text` can reach. Its own credential status (`GEMINI_API_KEY`) remains
**UNKNOWN to this session directly** — the `PROVIDER_UNAVAILABLE` error quoted at the top
of this sprint's own mission text is treated as founder-reported (plausibly obtained via
the operator-run proof call this session recommended in the prior sprint), not something
this session independently re-triggered, since the same no-secure-caller blocker from
Sprint 04/04B is unchanged.

## 8. Current Default-Provider Reason

**Hardcoded, not a configurable default.** Traced directly from source this turn:
`server/ai/ProviderRouter.ts` imports `* as gemini from "./GeminiProvider.js"` and its
`generateText()`/`generateJson()` functions call `gemini.generateText(opts)` /
`gemini.generateJson(opts)` directly — no branching, no lookup table, no
`provider` parameter read from anywhere. The file's own header comment already
self-documents this as intentional: *"multi-provider selection... remains [future
work]."* There is no database configuration, no organization-level setting, and no
route-level default involved — it is a single, direct function call to the only module
this file imports.

## 9. API Routing Capability

**None exists today.** `/api/v1/ai/text`'s request handler
(`server.ts`) destructures only `{ prompt }` from the request body — no `provider`,
`model`, `routingStrategy`, or `fallback` field is read, validated, or supported in any
way. No new field was invented this sprint (per the explicit instruction not to).

## 10. NVIDIA Readiness

**ADAPTER REQUIRED.** Per this sprint's own classification scheme: the credential is
reported present (§3, founder-reported); a complete, working, non-stub reference
implementation already exists in this codebase (client-side); but zero server-side code
path exists to reach it. This is the precise middle case the brief anticipated, not
"READY" and not "NOT SUITABLE."

## 11. Recommended First-Proof Provider

**NVIDIA — with a specific, narrow scoping recommendation, not a blanket endorsement.**
Reasoning, per Phase 8's evaluation criteria:

- **Existing implementation maturity:** Gemini's server-side adapter is more mature
  (already wired into the live route), but NVIDIA's *reference* implementation
  (client-side) is equally complete and uses a simpler, more portable protocol (plain
  OpenAI-compatible REST, vs. a dedicated SDK) — porting it server-side is a
  well-understood, low-risk task, not novel engineering.
- **Credential already available:** per the founder's screenshot, `NVIDIA_API_KEY` is
  already configured in both Production and Preview — a real, material advantage over
  Gemini, whose own key status is unverified from this session and was reported failing
  in this sprint's own mission text.
- **API compatibility / model availability:** NVIDIA NIM is a real, standard,
  well-documented API with broad open-model access; specific model choice is
  undetermined (§6) and would need to be picked, not a blocker to the readiness
  classification itself.
- **Cost / latency / reliability:** genuinely unknown — no operational history for either
  provider in this codebase, and this sprint correctly did not attempt a live call to
  find out.
- **Fallback capability:** neither provider has it today (§9) — irrelevant to choosing
  between them right now, relevant to a future routing-layer sprint.
- **Future Video Factory integration (forward-looking only, not implemented or scoped
  this sprint):** `OpenCompatibleProvider` already implements `generateVideo()` using the
  same base-URL pattern; `GeminiProvider.ts` (server) has zero video capability. This is
  a real signal, not a reason to act now — Video Factory itself remains untouched per
  this sprint's explicit boundary.
- **Enterprise scalability / vendor lock-in:** the strongest architectural argument for
  NVIDIA specifically is that it is not really "NVIDIA vs. Gemini" — the same
  `OpenCompatibleProvider`-style adapter, once ported server-side, would unlock NVIDIA,
  DeepSeek, Qwen, GLM, and MiniMax simultaneously (all five share one client-side class
  today, and per §4, at least four of the five report the same Production+Preview
  credential scope). Building one small OpenAI-compatible server-side adapter is a
  higher-leverage move than building a second bespoke, single-provider adapter the way
  `GeminiProvider.ts` was built.

**This is not "Option A" (Gemini) or pure "Option B" (NVIDIA only) — it is closer to
Option C's spirit** (provider-neutral routing), scoped down to what's actually minimal:
build the adapter class once, register NVIDIA as its first real instance, leave routing
logic / fallback / provider-selection-by-request out of scope for now (consistent with
§9's finding that no such mechanism exists yet and Phase 9's instruction not to build a
second routing layer in this sprint).

## 12. Whether Gemini Is Actually Required

**No — not architecturally.** Nothing in the AI Provider Manager's design requires
Gemini specifically; `ProviderRouter.ts`'s own header comment already frames the current
Gemini-only state as a narrow, deliberate starting point, not a permanent architectural
commitment. The `/api/v1/ai/text` contract itself is provider-agnostic (it just proxies a
prompt to whatever `generateText()` resolves to) — nothing about its request/response
shape assumes Gemini.

## 13. Required Next Action

Per this sprint's own routing logic: **NVIDIA requires a minimal adapter** →
`OS-INTEGRATION-IMPLEMENTATION-04D — IMPLEMENT NVIDIA PROVIDER ADAPTER`. Not attempted
this sprint, per Phase 9's explicit instruction to report rather than build when an
adapter is required. No GEMINI_API_KEY was added, requested, or discussed as an action
item — this sprint's finding does not depend on resolving Gemini's status at all.

## 14. Minimal Code Change Required (not implemented this sprint — described only)

If/when `OS-INTEGRATION-IMPLEMENTATION-04D` proceeds, the smallest correct change,
reusing existing patterns rather than inventing new ones:

1. Add `"nvidia"` to `ServerProviderName` in `server/ai/ProviderManager.ts`, and a
   `nvidia: "NVIDIA_API_KEY"` entry to `ENV_VAR_BY_PROVIDER` — a two-line change to an
   existing, already-correct file.
2. A new `server/ai/NvidiaProvider.ts` (or a shared
   `server/ai/OpenAICompatibleProvider.ts` parameterized by base URL, mirroring the
   client-side `OpenCompatibleProvider` shape but without ever touching browser code),
   implementing the same `generateText`/`generateJson`-equivalent surface
   `GeminiProvider.ts` already exposes, so `ProviderRouter.ts` can call it the same way.
3. `ProviderRouter.ts` would need one new exported function (or a `provider` parameter on
   the existing ones) to actually reach the new adapter — this is the one place genuine
   new logic is required, since today it hardcodes the Gemini call site (§8). Even this
   should stay minimal: a provider-name argument threaded through, not a new routing
   engine.

None of this was implemented in this sprint.
