# AI Router Sprint Backlog

Companion to `AI_ROUTER_PARITY_AUDIT.md` and `AI_ROUTER_FEATURE_MATRIX.md`. These are proposed workstreams for review and reordering — **not permission to implement every sprint in one pass.** Each item lists scope, dependencies, affected files (where already known from this audit), acceptance criteria, tests, and rollback considerations, and separates Bell24h-OS-side work from any required VyaparSethu integration.

## Sprint A — Baseline, gap register, test coverage (this audit)

**Status: DONE.** Delivered as `AI_ROUTER_PARITY_AUDIT.md` + `AI_ROUTER_FEATURE_MATRIX.md`, this document. No code changed.

## Sprint B — Fix access control and complete core routing behaviors

**Priority: HIGHEST — this is a live security gap, not a feature gap, and should move before any new feature work.**

1. **Fix `requireOperatorAuth` to actually check an operator/admin role.**
   - Scope: `server.ts:201-214`. Add a real role check (reuse the existing role-lookup pattern already established for Communication Hub/Voice Studio RBAC — do not invent a second role-resolution mechanism) before `next()` is called via the `requireAuth` fallback path. The service-token and dev-mode-no-auth branches can stay as-is if intentional, but should be explicitly commented as such rather than left to imply they're incidental.
   - Dependencies: none — this is isolated to one middleware function and its 5 call sites.
   - Affected files (known): `server.ts`.
   - Acceptance criteria: a non-operator authenticated user gets 403 on all 5 `/api/v1/ai-router/*` endpoints; an operator/admin succeeds; existing service-token and dev-mode paths behave identically to today for those specific cases.
   - Tests: add a dedicated test file mirroring `server/middleware/requireServiceAuth.test.ts`'s own pattern (already in this repo, untracked but present) — missing role → 401/403, correct role → next() called, never discloses role requirements in the denial body.
   - Rollback: revert the single middleware function; no data migration involved.

2. **Scope telemetry and budget reads to the caller's own organization** (once role-gating above exists, this becomes defense-in-depth rather than the only protection).
   - Scope: `ProviderRouter.ts:318-371` (`getRecentTelemetry`, `getTelemetrySummary`) — add an optional `organizationId` filter parameter; `server.ts:281-290` passes the caller's own org unless the caller is a genuine cross-org platform operator (a role distinct from a single org's admin — needs a product decision on who that is).
   - Dependencies: Item 1 (role model) should land first so "platform operator" vs. "org admin" is a meaningful distinction.
   - Acceptance criteria: an org-scoped operator sees only their own org's telemetry; a platform-level operator (if that role is kept) can still see cross-org data, explicitly.
   - Tests: new test asserting org A's requests never appear in org B's telemetry response.
   - Rollback: revert the filter; telemetry returns to unscoped (not recommended to ship without Item 1 already in place).

3. **Add explicit `fallback_only`, `cost_capped`, `quality_minimum` policies** (defer `region_restricted` — no region data model exists yet, needs its own design, see Sprint G).
   - Scope: `ProviderTypes.ts` (extend `RoutingPolicy` union), `ProviderRouter.ts` (`POLICY_CHAINS`, plus new enforcement logic: `fallback_only` should mean "do not proactively select a provider; only engage on the current primary's failure" — needs its own code path, not just a `POLICY_CHAINS` entry; `cost_capped` needs a real per-request or per-policy cost ceiling, which depends on Sprint D's cost-accounting work landing first or being stubbed deliberately; `quality_minimum` needs a minimum-capability or minimum-reasoning-tier gate).
   - Dependencies: `cost_capped` specifically depends on Sprint D (real cost accounting) existing first, or must be explicitly scoped as "request-count-capped" instead and relabeled honestly if cost accounting isn't ready yet — do not claim a cost cap enforces currency cost before currency cost is tracked.
   - Acceptance criteria: each new policy enforced server-side, with its own test proving the policy actually changes candidate selection/behavior (not just that the string is accepted).
   - Rollback: additive to the `RoutingPolicy` union; removing is a type-level revert with no data impact (policies aren't persisted).

## Sprint C — Capability registry, provider adapters, resilience tests

1. **Verify (not assume) the `vision`/`streaming` capability flags against each adapter's actual implementation.** Scope: read `GeminiProvider.ts` and all 6 adapters' request-building code; correct any flag found to be aspirational rather than implemented. Acceptance: every `true` capability flag has a corresponding, traceable code path in that adapter.
2. **Add circuit-breaker state-machine tests** — currently zero exist. Scope: `server/ai/ProviderRouter.test.ts`. Cover: 3 consecutive failures trips `OPEN`; cooldown expiry transitions to `HALF_OPEN` on next `getCircuitBreaker()` call; a failure while `HALF_OPEN` re-trips to `OPEN`; a success while `HALF_OPEN` or `CLOSED` resets `consecutiveFailures`/clears `cooldownUntil`. Acceptance: 4+ new passing tests, no change to production code required (this is a coverage gap, not a behavior defect).
3. **Extend the capability type** to add the flags the task asked about (tool-calling at minimum, since that's the most broadly useful and is table-stakes for most modern model APIs) — only if/when a real adapter actually supports it; otherwise leave `MISSING` honestly rather than adding an always-false flag that implies future intent as current capability.
4. **Decide the `ai_providers`/`AiProvidersPage.tsx` question** (see Sprint G — flagged separately since it's as much an architecture/security decision as an implementation task).

## Sprint D — Budgets, cost accounting, telemetry persistence (highest-value fix from this audit)

1. **Wire `ProviderRouter.ts`'s `recordTelemetry()` to also write to the real `ai_request_logs` table**, replacing (or supplementing, during a transition) the in-memory ring buffer as the source of truth for the dashboard/telemetry endpoints.
   - Scope: `ProviderRouter.ts` (add a DB-write call, likely via a small new `server/ai/telemetryStore.ts` or similar, following this repo's established pattern of a thin persistence layer per feature — do not introduce a second ORM or raw-connection pattern; reuse whatever pool/connection convention `server.ts`/other handlers already use), `server.ts` (dashboard/telemetry route handlers read from the DB instead of/alongside the in-memory buffer).
   - Must preserve: `organizationId`-scoped RLS already correctly defined on `ai_request_logs` (`add_ai_tables.sql:43,52-55`) — writes must supply the real caller's `organizationId`, never a service-role bypass that writes with no tenant attribution.
   - Dependencies: none blocking — the table already exists and is already correctly shaped (`add_ai_tables.sql:23-41`); this is a pure "point the real writer at the real table" fix.
   - Acceptance criteria: a request's telemetry survives a server restart; two requests from different orgs are each visible only to their own org via the existing RLS; the dashboard/telemetry endpoints show numbers consistent with the DB, not an in-memory artifact that can silently diverge across instances.
   - Tests: an integration test (PGlite-based, matching this repo's established test convention) asserting a routed request produces exactly one `ai_request_logs` row with the correct organization_id, and that a second org's query never sees it.
   - Rollback: keep the in-memory buffer as a fallback read path if the DB write fails, rather than making router calls fail when telemetry persistence has a problem — telemetry is observability, not a thing that should ever block a real AI response.
2. **Add real currency-cost accounting**, once a price-per-token table/config exists per provider/model. Needs a product decision on pricing-source-of-truth (hardcoded table vs. provider-reported). Do not invent prices — label any static/assumed price explicitly as an estimate, consistent with the parent task's own instruction.
3. **Add provider-level (not just org-level) budget enforcement**, once cost accounting exists to measure against.

## Sprint E — Workflow routing and shared-intelligence connection

Scope only once Sprints B-D land (workflow routing without durable telemetry/cost tracking would be flying blind). For each of the 12 distinct workflow categories in the Feature Matrix classified "Belongs in Bell24h-OS": design a typed `WorkflowType` (replacing the current untyped string) with its own default policy/capability requirements. For each classified "Must call VyaparSethu": do not implement in this repo — document the API contract Bell24h-OS should expose so VyaparSethu can call it, and stop there.

## Sprint F — Benchmarks and route-tester UX polish

The route-tester backend is already real (Sprint A finding) — this sprint is UI/UX polish plus adding a genuine benchmark-running capability (currently fully MISSING): a reproducible, scheduled or on-demand evaluation that runs a fixed prompt set across configured providers and records comparable, real latency/quality/cost results — not a static or seeded "benchmark" number.

## Sprint G — Security regression, integration, production-readiness, and the `ai_providers` decision

1. **Decide and act on `AiProvidersPage.tsx` / `ai_providers` table / `AiProviderService.ts`.** This is the single highest-severity open item from this audit and deserves its own explicit decision before any other sprint ships, not a silent fix bundled into something else:
   - **Option 1 (recommended)**: delete `ai_providers`'s role as a credential store entirely (keep the table only if something else genuinely needs org-level provider *preferences*, with credentials removed from its schema), delete `AiProviderService.ts`'s generation code paths (already confirmed non-functional and already flagged as "Critical Security Debt" in its own header comment), and migrate `AiProvidersPage.tsx` to call the real `/api/v1/ai-router/*` endpoints instead.
   - **Option 2**: if `ai_providers` must be kept for some reason not visible in this audit, at minimum strip the `api_key` column's tenant SELECT policy (service-role-only read) and stop writing real key values into it from anywhere.
   - This decision affects both the Video Factory audit's own findings (the same dormant `JobWorker`/`AiProviderService` path) and this one — coordinate rather than fixing twice.
2. Full security regression once B-D land: re-run the 146-test baseline plus whatever new tests Sprints B/C/D add; confirm no fabricated-success path was introduced anywhere in the new telemetry-write or policy-enforcement code.
3. Document the migration/deployment procedure for `ai_request_logs` becoming the real telemetry sink (this repo has no automated migration runner — confirmed in an earlier same-day audit — so this needs the same manual-apply documentation convention already used for every other migration in this engagement).

## What this backlog deliberately does not include

Building OpenAI/Anthropic/xAI/Mistral/OpenRouter adapters, or any image/video provider, is **not** scoped here as a numbered sprint item — the task's own instruction was "do not assume all can be integrated immediately," and this audit found no evidence any of them is needed yet by a concrete, waiting caller. Add a provider when a real workflow in Sprint E actually requires it, not speculatively.
