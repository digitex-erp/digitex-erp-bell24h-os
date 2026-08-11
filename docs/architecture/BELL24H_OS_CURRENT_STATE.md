# Bell24h-OS — Current-State Capability Inventory

**Prepared for:** BELL24H-OS ↔ VYAPARSETHU SDK/API Contract v1.0 (Implementation Chief Engineer sprint)
**Date:** 2026-08-10
**Method:** Re-confirmed against live repository state this turn (`git status`, direct
file reads of `server.ts`, `server/middleware/requireAuth.ts`, `server/middleware/rateLimit.ts`,
`server/audit.ts`, `src/main.tsx`), plus synthesis of already-runtime/code-verified findings
from BR-01, BR-02, and OODA-01 (not re-derived from zero — see Evidence column).
**Evidence hierarchy applied:** runtime > code (this turn) > code (prior sprint, re-confirmed
unchanged) > schema file > docs.

No drift found: `git status --short` and `git diff --stat` this turn are byte-identical in
scope to the BR-02 checkpoint (`server.ts` pre-existing auth-wiring diff + `src/pages/AiProvidersPage.tsx`
BR-01 fix; same untracked doc set). All capability rows below are current as of this inspection.

---

## Capability Table

Status column uses only the four values the mission brief mandates: **VERIFIED / TARGET /
INFERRED / UNKNOWN**. Where a capability is verified to exist but broken, disabled, or
partial, that nuance is carried in the "Current implementation" column, not invented as a
fifth status label. Two rows (Authentication, SDK/API) were updated after this table was
first drafted, once P0 implementation produced new runtime evidence — noted inline.

| Capability | Current implementation | Current owner | API/SDK | Runtime verified | Status | Evidence |
|---|---|---|---|---|---|---|
| Authentication | Supabase email/password JWT, verified server-side by re-checking token against `/auth/v1/user` on every request | `server/middleware/requireAuth.ts` | None — internal Express middleware, no client SDK wrapper | YES — unauthenticated `curl` to a protected route returns `401 {"error":"unauthenticated",...}` at runtime (this sprint's P0 smoke test) | VERIFIED | Runtime (this sprint): `curl http://localhost:5299/api/check-table` → 401; code: `requireAuth.ts:49-123` |
| Organizations / tenant context | `organization_id` resolved server-side from `profiles` table using the caller's own token (RLS-respecting, not service-role) | `requireAuth.ts` (resolution) + Supabase RLS policies (enforcement) | None | Code only — resolving a real `organization_id` requires a valid Supabase session token, not available this session | VERIFIED (code) | Code (this turn): `requireAuth.ts:102-119` |
| Users | Supabase `auth.users` + `profiles` table | Supabase | None | Not re-tested this turn | INFERRED (unchanged since OODA-01) | OODA-01 |
| Teams | No dedicated team/membership model found beyond single `organization_id` per profile | — | — | — | UNKNOWN | Absence noted, not proven |
| RBAC | `role: 'ADMIN'` hardcoded for every user client-side (`useAuth.ts`) — no server-side role enforcement found | `src/hooks/useAuth.ts` (client only) | None | Not re-tested this turn | VERIFIED (implementation is hardcoded/non-functional, not real RBAC) — known open violation | bell24h-verify skill "Known open violations" table; unchanged |
| RLS (row-level security) | Present in schema (`supabase_schema.sql`), enforced only when queries go through Supabase's REST/JS client with the caller's own token; **bypassed** by any route using pooled `DATABASE_URL`/`pg` client | Supabase policies + `requireAuth`'s use-caller-token pattern | None | Not re-tested this turn (requires live DB) | VERIFIED (partial: enforced on `requireAuth`-protected routes, historically bypassed on `/api/vault/*` prior to the pre-existing uncommitted fix) | OODA-01, BR-02, re-confirmed this turn: `server.ts` diff still uncommitted, still shows requireAuth added to all 7 vault routes |
| AI Provider Manager (server-side) | Single-provider (Gemini only, text/JSON only) credential resolver + budget-limited router with audit emission | `server/ai/ProviderManager.ts`, `server/ai/ProviderRouter.ts` | Internal function exports (`generateText`, `generateJson`) — no external SDK surface | Code-verified BR-01; unchanged this turn (no diff in `server/ai/*`) | VERIFIED (architecturally correct but narrow) | BR-01 (full file reads), re-confirmed via `git diff --stat` (no changes) |
| AI Provider Manager (client-side, legacy) | `AiProviderService.ts` — browser-resident, historically wrote raw API keys to a tenant-readable table | `src/services/AiProviderService.ts`, `src/pages/AiProvidersPage.tsx` | None (direct provider calls from browser) | Code-verified BR-01; write-path key exposure fixed (BR-01), UI input disabled | VERIFIED (P0 write-path fixed; broader client-side provider-call pattern, self-documented "Critical Security Debt", NOT re-architected this sprint) | BR-01 diff, re-confirmed this turn (`git diff --stat` unchanged since BR-01) |
| AI execution (server-authorized) | Only reachable via `ProviderRouter.run()`, which wraps every call with per-org daily budget + audit emission | `server/ai/ProviderRouter.ts` | Internal only | Code-verified | VERIFIED | BR-01 |
| Prompt Studio | Not located in this repository | — | — | — | TARGET (confirmed absent) | Absence noted across OODA-01/02 |
| Communication Hub (WhatsApp/Email/SMS) | Not implemented in Bell24h-OS. Real WhatsApp/MSG91 integration exists only in the separate legacy repo `digitex-erp/bell24h` | — | — | — | TARGET (confirmed absent in this repo) | OODA-02 |
| Media (image/video/voice generation) | Referenced conceptually (Image Studio, Video Studio module names appear in BR-02 Phase 5 test plan) but no working generation pipeline confirmed end-to-end this session | Unclear/unverified | None | BR-02 could not runtime-test (no reachable deployment) | UNKNOWN | BR-02 Phase 5 |
| Agent Runtime | Not implemented. No agent execution, policy, or risk-classification code found anywhere in this repo | — | — | — | TARGET (confirmed absent) | This inspection (no hits for "agent" runtime patterns beyond doc references) |
| Policy Engine | Not implemented as a distinct system. The only policy-like enforcement found is `requireAuth`'s fail-closed pattern and the in-memory per-org `rateLimit` | `server/middleware/requireAuth.ts`, `server/middleware/rateLimit.ts` | None | Code-verified this turn | VERIFIED (narrow: auth + rate limiting only, not a general policy engine) | This turn: `rateLimit.ts` full read |
| Workflow Engine | `JobOrchestratorService` + `JobWorker` exist but `JobWorker` is disabled (commented out) in `src/main.tsx`; no evidence of it ever running in production | `src/modules/job-orchestrator/JobWorker.ts`, `JobOrchestratorService` | None | Static trace only (BR-02 Phase 3); confirmed still disabled this turn | VERIFIED (present, disabled, not wired to any trigger) | BR-02 Phase 3, re-confirmed this turn: `src/main.tsx:7-9` still commented out |
| Event Bus | No pub/sub or canonical event-naming system found; `emitAuditEvent` is a structured **log** emission, not an event bus (no subscribers, no delivery guarantee) | `server/audit.ts` (log-only) | None | Code-verified this turn | TARGET (not present as an event bus; audit logging is a distinct, narrower thing) | This turn: `audit.ts` full read |
| Audit | Structured JSON audit records to stdout only (`kind, timestamp, actor, organizationId, action, targetType, targetId, outcome, requestId, metadata`). **No durable persistence** — `ai_request_logs`/audit tables require `DATABASE_URL`, not configured in this environment, per the file's own header comment | `server/audit.ts` | Internal only (`emitAuditEvent`, `newRequestId`) | Code-verified this turn | VERIFIED (real, structured, but not durable) | This turn: `audit.ts:1-44` full read |
| Evidence (anchoring/attestation) | Not implemented. No hashing, anchoring, or evidence-chain code found in this repo. Real (non-production-confirmed) blockchain/evidence code exists only in the separate legacy repo | — | — | — | TARGET (confirmed absent) | OODA-02 |
| Storage | Supabase Storage referenced in docs; not independently re-verified this turn | Supabase | None | Not re-tested | INFERRED (unchanged since OODA-01) | OODA-01 |
| Search / vector | No vector search, embeddings pipeline, or search index found in this repository | — | — | — | TARGET (confirmed absent) | OODA-01, this inspection |
| Observability | Console-only structured audit logs (see Audit row); no metrics, tracing, or log-drain integration confirmed | `server/audit.ts` | None | Code-verified | VERIFIED (logging only, no metrics/traces) | This turn |
| Usage / cost metering | Per-organization daily budget tracked in-memory (`Map`) inside `ProviderRouter.ts` for AI calls only; resets on process restart, not durable, not scoped to any other capability | `server/ai/ProviderRouter.ts` | None | Code-verified BR-01 | VERIFIED (AI-only, in-memory) | BR-01 |
| SDK / API (external, versioned) | Before this sprint: no `/api/v1/` namespace existed. **This sprint (P0):** added `/api/v1/health`, additive only — all existing routes (`/api/health`, `/api/vault/*`, etc.) unchanged | `server.ts` | `/api/v1/health` only; no external SDK/client library | YES — `curl http://localhost:5299/api/v1/health` returns `200 {"status":"ok","apiVersion":"v1","requestId":...}` this sprint | VERIFIED (minimal — one demonstration route, not a capability surface) | This sprint's runtime smoke test; see implementation report |
| Provider adapters (generalized, beyond AI) | Only the AI vertical has a provider-adapter pattern (`GeminiProvider.ts` behind `ProviderManager`). No equivalent pattern exists for Communication, Media, or other verticals — expected, since those verticals don't exist yet in this repo | `server/ai/GeminiProvider.ts` | None | Code-verified BR-01 | VERIFIED (AI-only) | BR-01 |
| Blockchain / evidence anchoring | Not present in Bell24h-OS. Present (Solidity/Hardhat/Polygon, not confirmed production-deployed) only in the separate legacy repo `digitex-erp/bell24h` | — | — | — | TARGET (confirmed absent); DO NOT import per this sprint's explicit boundary rule | OODA-02 |
| Queue / worker system | `job_queue` Supabase table exists; browser-resident `JobWorker` polls it but is disabled; missing `created_by` column (referenced in code, absent from schema per BR-02); two draft migrations (column + CHECK constraints) prepared but not applied | `src/modules/job-orchestrator/`, Supabase `job_queue` table | None | Static trace only; runtime completion test BLOCKED (no reachable environment) | VERIFIED (present, broken: disabled worker + incomplete schema) | BR-02 Phase 3-4, re-confirmed this turn (`JobWorker.ts:33,43` still references `job_queue`/`created_by`) |

---

## Summary of what actually exists vs. what the contract must treat as TARGET

**Real, runtime-adjacent substrate to reuse (not rebuild):**
- Auth boundary with fail-closed identity/org resolution (`requireAuth.ts`)
- A request-ID convention (`newRequestId()`), currently doubling as both the audit
  correlation key and the client-facing error-response ID — generated fresh per request,
  never accepted from an inbound header
- A structured error-response shape: `{ error: <code string>, requestId }` with codes
  `unauthenticated`, `invalid_token`, `auth_unavailable`, `organization_unresolved`,
  `no_organization` (auth-domain only; not a general-purpose taxonomy)
- Per-organization rate limiting (`rateLimit.ts`), composable with `requireAuth`
- Structured (but non-durable) audit event emission (`audit.ts`)
- A narrow, correctly-boundaried server-side AI credential/execution path (`server/ai/*`)

**Confirmed absent — must be TARGET-only in the contract doc, not stubbed this sprint:**
Teams/membership model, real RBAC enforcement, Prompt Studio, Communication Hub, Agent
Runtime, general Policy Engine, Event Bus, Evidence/anchoring, Search/vector, durable
Observability, versioned external API surface, non-AI provider adapters, blockchain.

**Confirmed present but broken/disabled — do not silently "fix" as part of contract work:**
RBAC (hardcoded ADMIN), JobWorker (disabled, schema-incomplete), client-side AI provider UI
(write-path fixed, broader pattern still legacy).
