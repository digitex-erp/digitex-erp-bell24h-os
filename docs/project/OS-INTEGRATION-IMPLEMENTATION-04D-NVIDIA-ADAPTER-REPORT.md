# OS-INTEGRATION-IMPLEMENTATION-04D — Server-Side NVIDIA Provider Adapter

**Date:** 2026-08-12
**Starting HEAD:** `181fcc4` (clean working tree) — **VERIFIED**, `git rev-parse HEAD`,
`git status --short`, this turn.

---

## Architecture Discovered (Phase 1)

**`server/ai/ProviderManager.ts` — VERIFIED to exist exactly where the 04C-1 comment
named it.** Findings, from direct source inspection this turn:

1. **Server provider interface:** no shared, provider-agnostic interface file exists.
   `GeminiProvider.ts` exports its own `TextRequest`/`JsonRequest`/`ProviderResult<T>`
   types; nothing else in the repository defined a parallel or competing shape before
   this sprint.
2. **Server provider registration mechanism:** `ENV_VAR_BY_PROVIDER: Record<ServerProviderName, string>`
   in `ProviderManager.ts` — a real, minimal, reusable registry, structurally ready to
   widen (adding a literal to the `ServerProviderName` union + one map entry).
3. **Provider resolution mechanism:** **none existed at the routing level.**
   `ProviderRouter.ts` imported `GeminiProvider.ts` directly and called its functions by
   name — no factory, switch, or registry dispatched to "the right provider module."
   `ProviderManager.getCredential(provider)` only resolves *which env var to read*, a
   narrower, different kind of resolution than module dispatch.
4. **Gemini integration point:** `GeminiProvider.ts`'s `generateText`/`generateJson`,
   called directly by `ProviderRouter.ts`.
5. **NVIDIA client-side reference:** `OpenCompatibleProvider`
   (`src/modules/ai-providers/AiProviderService.ts:288-382`) — OpenAI-compatible REST,
   `https://integrate.api.nvidia.com/v1/chat/completions`, `Authorization: Bearer <key>`,
   `AbortController` timeout, `{model, messages, temperature, max_tokens}` request body,
   `data.choices?.[0]?.message?.content` response extraction. Used as a **wire-format
   reference only** — no browser-specific credential handling was carried into the new
   server module (per 04D's own instruction).
6. **Server-side credential access pattern:** `ProviderManager.getCredential(provider)` —
   reads `process.env[envVar]` only, throws `ProviderCredentialError` (fail-closed) if
   absent/empty. Module header explicitly forbids import from `src/`.
7. **Provider configuration model:** no per-organization/per-tenant provider config
   exists server-side (unlike the client-side legacy path, which reads per-org rows from
   `ai_providers`). Server-side model selection is a hardcoded default with an optional
   caller override — no provider-selection mechanism existed before this sprint.
8. **Error normalization pattern:** `ProviderRouter.run()` wraps every call, emitting a
   structured audit event on both success and failure via the existing `emitAuditEvent`.
   Before this sprint, the `provider` field in that audit metadata was **hardcoded to the
   literal string `"gemini"`** even inside the generic wrapper — a real, previously
   undetected defect that would have mislabeled any second provider's calls had one been
   added without noticing this. Fixed as part of this sprint's minimal change (§ below).
9. **Multi-provider scaffolding: PARTIAL.** Credential-layer scaffolding
   (`ENV_VAR_BY_PROVIDER`) was real and reusable; routing-layer scaffolding did not
   exist and was added, minimally, this sprint.

## Design (Phase 2)

- **Existing provider contract NVIDIA implements:** `GeminiProvider.ts`'s own
  `TextRequest`/`ProviderResult<T>` types, imported and reused directly — no new
  provider-interface file was created, since one instance doesn't justify introducing a
  new abstraction layer.
- **Where NVIDIA is registered:** `ProviderManager.ts` — `ServerProviderName` widened to
  `"gemini" | "nvidia"`, `ENV_VAR_BY_PROVIDER` gained one entry (`nvidia:
  "NVIDIA_API_KEY"`).
- **How the existing ProviderManager resolves it:** the same, unmodified
  `getCredential(provider)` function — zero new logic needed there beyond the registry
  widening.
- **Whether `/api/v1/ai/text` must change: NO, deliberately deferred.** Per this sprint's
  own Phase 9 ("adapter and manager readiness... the real production proof belongs to
  04E") and Phase 5's explicit warning against inventing a routing framework, the route
  itself was left untouched. NVIDIA is reachable through a new, additive
  `ProviderRouter.generateNvidiaText()` export — ready for 04E to wire up (via the route
  or a dedicated proof path) without this sprint guessing at what that wiring should
  look like.
- **Whether the existing Gemini path must change:** only the one internal defect fix
  (§ above) — `generateText`/`generateJson`'s own behavior, inputs, and outputs are
  byte-identical; both now explicitly pass `"gemini"` as the provider label they always
  implicitly meant.
- **Files modified:** `server/ai/ProviderManager.ts`, `server/ai/ProviderRouter.ts`.
  **Files created:** `server/ai/NvidiaProvider.ts`.

## Server Adapter Implementation (Phase 3)

`server/ai/NvidiaProvider.ts` — `generateText(req: TextRequest): Promise<ProviderResult<string>>`,
mirroring `GeminiProvider.ts`'s exact exported shape. `NVIDIA_API_KEY` read only via
`ProviderManager.getCredential("nvidia")` — never a direct `process.env` read, no
`NEXT_PUBLIC_`/`VITE_` exposure, no browser dependency of any kind. 30-second
`AbortController` timeout. Errors normalized to plain `Error` objects with either the
provider's own `error.message` (on a non-2xx response) or a generic, fixed string
(network failure / timeout) — **the raw credential is never interpolated into any thrown
message**, verified directly (§ Security Verification).

**Model default:** `meta/llama-3.1-8b-instruct` — **a new design decision made in this
sprint**, since no NVIDIA model was ever chosen anywhere in this repository before now
(04C found the client-side reference reads an unset DB column instead of hardcoding
one). Documented in the adapter's own header comment; reconsider before real production
use if a different NVIDIA NIM catalog model is preferred.

`generateJson` was **not** implemented for NVIDIA — nothing calls it for this provider
yet (`/api/v1/ai/text` only ever needs `generateText`), and adding it now would be
scope beyond what this sprint's minimal-change mandate calls for. **DEFERRED.**

## Provider Registration (Phase 4)

NVIDIA reachable via `ProviderRouter.generateNvidiaText(ctx, opts)` — same
budget/audit/error-handling wrapper (`run()`) as Gemini, now parameterized by a
`provider: string` argument instead of a hardcoded literal. **IMPLEMENTED.** No fallback
routing, no load balancing, no provider scoring — none were built, per explicit
instruction.

## Gemini Handling (Phase 5)

**UNCHANGED in behavior.** `GEMINI_API_KEY` is not required to use NVIDIA — the two
providers' credential resolution is fully independent (separate `ServerProviderName`
values, separate env vars, separate adapter modules). The existing
`generateText`/`generateJson` exports (used by `/api/vault/ai-summary` and
`/api/vault/mentor-advice`) call `run(ctx, "gemini", ...)` — identical runtime behavior
to before this sprint, confirmed by inspection (the only change to their call sites is
the added literal argument, which reproduces exactly what `run()` always did implicitly).

## Tests (Phase 6)

**No test framework exists in this repository** (`find` for `*.test.ts`/`*.spec.ts`,
and `package.json` for `vitest`/`jest`/`mocha`/a `test` script — all empty, unchanged
from every prior sprint's finding). Per this sprint's own fallback instruction, this
limitation is documented rather than papered over by installing an unrelated framework.

Substituted a temporary, uncommitted verification script (outside the repository, in the
session scratchpad, never committed) that intercepts `globalThis.fetch` to test the
adapter's real logic without any network access to NVIDIA's actual API and without any
real credential — a fake, randomly-generated, never-persisted value stood in for
`NVIDIA_API_KEY`. **5/5 checks passed:**

| # | Check | Result |
|---|---|---|
| 1 | Missing `NVIDIA_API_KEY` fails safely (`ProviderCredentialError`, code `provider_credentials_unavailable`) **before** any network call is attempted | PASS |
| 2 | `ProviderManager.getCredential("nvidia")` / `isProviderConfigured("nvidia")` resolve correctly once configured | PASS |
| 3 | Request construction correct — exact URL (`https://integrate.api.nvidia.com/v1/chat/completions`), method, `Authorization: Bearer <key>` header, and body shape (`{model, messages: [{role:"user",content}]}`) all verified; response correctly normalized to `{data, model, latencyMs}` | PASS |
| 4 | A non-2xx NVIDIA response is normalized to a clean `Error` carrying the provider's own message, never the credential | PASS |
| 5 | A network/timeout failure produces a fixed, generic error message — confirmed the fake key does not leak into it even when deliberately embedded in the simulated underlying error | PASS |

**IMPLEMENTED**, within the repository's actual conventions (runtime verification, not a
unit-test framework) — consistent with every prior sprint this session.

## Security Verification (Phase 7)

- `NVIDIA_API_KEY` read only inside `NvidiaProvider.ts`, only via
  `ProviderManager.getCredential()` — **VERIFIED**, source inspection.
- No `NEXT_PUBLIC_NVIDIA_API_KEY` / `VITE_NVIDIA_API_KEY` anywhere — **VERIFIED**, `grep`
  this turn, zero matches.
- No new client-side reference: `grep -rl "NvidiaProvider|ProviderManager|ProviderRouter" src/`
  → zero matches — **VERIFIED**, this turn.
- Fresh `npm run build`, then `grep -c "NVIDIA_API_KEY" dist/assets/*.js` → **0
  occurrences** — **VERIFIED**, this turn (rebuilt specifically for this check, not
  reused from 04C-1).
- No credential in tests: the verification script's fake key never appears in any
  assertion failure message by design (every test explicitly asserts its absence from
  thrown errors) — **VERIFIED**, §Tests.
- No credential in logs: `emitAuditEvent`'s metadata for AI requests only ever carries
  `provider` (a name string), `model`, `latencyMs`, and `errorCode` — never a credential
  value, unchanged shape from before this sprint — **VERIFIED**, source inspection.
- `OpenCompatibleProvider` was **not modified, removed, or touched** — 04C-1's NO
  EXPOSURE classification stands unchanged; no new evidence contradicting it was found.

**CLIENT-SIDE CREDENTIAL EXPOSURE: NONE.**

## Build / Typecheck / Tests (Phase 8)

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **PASS** (exit 0, no output) |
| `npm run build` | **PASS** — `dist/index.html`, `dist/assets/*.{css,js}`, `dist/server.cjs`, `dist/server.cjs.map` all produced, no errors |
| Verification script (mock-based, see §Tests) | **PASS** — 5/5 |

No pre-existing unrelated failure was encountered.

## Real NVIDIA Call (Phase 9)

**NVIDIA REAL PRODUCTION CALL: NOT ATTEMPTED — DEFERRED TO 04E.** No real credential was
requested, retrieved, or used. `vercel env pull` was not run.

## Remaining Blocker Before Real NVIDIA Proof

Same structural blocker as every S2S/AI proof sprint this session: no secure mechanism
exists for this session to construct an authenticated request (S2S or provider-level)
without a real secret becoming visible to it. 04E will need either the operator running
the real proof call directly, or a deliberately-built credential-mediation mechanism —
neither exists today. The adapter and manager are otherwise fully ready.

## P1 Follow-up (observation only, not investigated or modified this sprint)

**`JobOrchestratorService.ts` was found to be browser-shipped**, per 04C-1's Phase 1
import-graph findings (it imports `AiProviderService.ts`, the same file containing
`OpenCompatibleProvider`, and is itself under `src/modules/job-orchestrator/`, so it
ships to the client bundle). This is unusual for job-orchestration code — typically a
server/background-process concern — and warrants a separate architecture review. **Not
investigated, refactored, relocated, or modified in this sprint**, per explicit
instruction. Logged here as a P1 follow-up only.
