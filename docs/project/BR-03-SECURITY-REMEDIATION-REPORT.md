# BR-03 — Bell24h-OS Security Boundary Remediation Report

**Sprint:** Implementation Chief Engineer — P0 Security Fix / Evidence-First / Minimal Scope
**Date:** 2026-08-11
**Branch:** `main` · **HEAD (unchanged by this sprint):** `2dd23563b49640330a9673ad11b2fbc20eeb6f79`

---

## 1. Executive Summary

IR-01 flagged `AutomationService.ts` and `SeoIntelligenceService.ts` as performing
Supabase queries "without verified organization/tenant scoping." Direct re-inspection
this sprint found that finding was **directionally right but materially imprecise**: both
tables involved already carry an `organization_id`-based RLS policy in
`supabase_schema.sql`, so the missing client-side filter was not, on its own,
cross-tenant-exploitable — RLS was already the enforcing layer, consistent with how the
rest of this codebase's client-side services work. What IR-01's flag correctly identified
was an absence of **defense-in-depth** and, more importantly, surfaced a genuine
**functional defect**: `AutomationService.createWorkflow()`'s insert never set
`organization_id`, so — given RLS's `WITH CHECK` on that column — every call to it would
have failed for every user, regardless of organization. Both are fixed this sprint with
the smallest change that reuses the codebase's own existing pattern.

A broader Phase 3 search surfaced one methodological trap worth stating plainly: an
initial grep-based check flagged `roles` and `audit_logs` as having zero RLS policies.
That was **wrong** — both tables are covered by a separate, dynamically-generated policy
loop (`EXECUTE format('ALTER TABLE public.%I ...', t)`) whose table names never appear as
literal strings in the schema file, so a naive text search misses them entirely. This was
caught and corrected before being reported as a finding — no false P0 is recorded below.

The client-side AI security question (Phase 4) resolved more precisely than IR-01's
framing suggested: the browser-facing `AiProviderService.ts` never actually populates
`api_key` in any current code path (the client-facing `select()` projection deliberately
excludes that column, confirmed by both the query itself and an explicit code comment).
The dangerous `fetch()`-with-credential code exists and is reachable from three pages, but
cannot execute successfully today because the credential is never present to send. Moving
this onto the server-side `ProviderRouter` is not a localized fix — it requires new
authenticated API surface and client rewiring — so per this sprint's own instructions,
that portion is **stopped and reported**, not implemented.

## 2. Pre-Existing Repository State

Re-verified this turn (`git status --short`, `git diff --stat`), consistent with every
checkpoint since the SDK/API and IR-01 sprints — no drift:

- `server.ts` — pre-existing diff (adds `requireAuth`/`aiRateLimit` to vault/check-table
  routes, plus one `/api/v1/health` route from the prior SDK sprint). **Not touched this
  sprint.**
- `server/middleware/requireAuth.ts` — pre-existing diff (request-ID propagation wrapper
  from the prior SDK sprint). **Not touched this sprint.**
- `src/pages/AiProvidersPage.tsx` — pre-existing diff (BR-01's credential write-path fix).
  **Not touched this sprint.**
- `server/lib/requestContext.ts`, `server/lib/errors.ts` — pre-existing untracked files
  from the prior SDK sprint. **Not touched this sprint.**
- `docs/architecture/IR-01-INTEGRATION-READINESS-REPORT.md`,
  `BELL24H_OS_CURRENT_STATE.md`, `BELL24H_OS_VYAPARSETHU_SDK_API_CONTRACT_V1.md`,
  `BELL24H_OS_SDK_API_IMPLEMENTATION_REPORT.md`,
  `PREVIOUS_SDK_IMPLEMENTATION_CHANGE_AUDIT.md` — all pre-existing, read as source of
  truth per this sprint's instructions, **not modified**.
- All other untracked files (`.mcp.json`, `MASTER_CONTEXT/`, remaining `docs/project/*.md`)
  — pre-existing from earlier sprints, **not touched**.

None of the above were reverted, cleaned, or altered. **Classification: VERIFIED.**

## 3. IR-01 Findings Re-Verification

| IR-01 finding | Re-verified this sprint | Classification |
|---|---|---|
| P0-A: `AutomationService.ts` unscoped queries | Confirmed no `.eq('organization_id', ...)` existed in the code (accurate as a code-level observation) — but RLS was already enforcing the same restriction on `automation_workflows` (`supabase_schema.sql`, "Org isolation select/insert/update" policies, `organization_id = get_current_org_id()`). Not independently exploitable as stated. | VERIFIED (code-level claim correct; severity was overstated relative to the RLS-backed reality) |
| P0-B: `SeoIntelligenceService.ts` unscoped queries | Same shape: no client-side filter, but `seo_projects`/`seo_keywords` both have `organization_id`-based RLS SELECT/INSERT policies (`supabase_schema.sql:1411-1412`). | VERIFIED (same nuance as above) |
| P0-C: client-side AI execution path (`AIManagerService`) used by Prompt/Image/Video Studio | Confirmed — all three pages import `AIManagerService` from `AiProviderService.ts` (grep, this turn). But see §7: the credential itself is never present in the browser today. | VERIFIED (path confirmed; live exploitability more precisely characterized in §7) |
| P0-D: additional equivalent patterns | See §6 — none found that are both real and exploitable beyond the two already-known items. | VERIFIED (search performed; see caveats) |

## 4. AutomationService Findings

Traced per the brief's required format:

**Tables queried:** `automation_workflows` (root, has `organization_id`),
`workflow_history` (child, no `organization_id` column — scoped via
`automation_workflows.organization_id` through an RLS `EXISTS` subquery).

**Client:** the browser Supabase JS client (`src/lib/supabase.ts`), initialized with the
anon/publishable key, not a service-role key — confirmed by reading that file. This means
RLS is enforced for every query this service makes; it is not a pooled `DATABASE_URL`/`pg`
connection (that pattern, which does bypass RLS, exists only in `server.ts`'s vault
routes, not here).

**Called from:** `src/pages/AutomationBuilderPage.tsx` (`createWorkflow`) and, per a
repo-wide search this turn, no other current caller (`getWorkflows`/`getWorkflowHistory`
are defined but not yet wired into a page — dead-but-harmless).

**Does the service bypass `requireAuth`?** Not applicable — this is a browser→Supabase
call with no Express hop at all, so `requireAuth.ts` was never in this path to begin with
and is not "bypassed" in the sense of a defect; it simply doesn't apply here.

| # | FACT | RISK | CURRENT QUERY | TENANT SOURCE | SAFE FIX |
|---|---|---|---|---|---|
| 1 | `getWorkflows()` had no `.eq('organization_id', ...)` | Low — RLS already scopes `automation_workflows` SELECT | `supabase.from('automation_workflows').select('*')` | RLS only (before fix) | Add `.eq('organization_id', orgId)` where `orgId` comes from `getCurrentOrganizationId()` (resolves via the authenticated session, never client input) |
| 2 | `createWorkflow()` never set `organization_id` on insert | **Functional defect, not a leak**: RLS's `WITH CHECK (organization_id = get_current_org_id())` rejects a NULL `organization_id`, so this insert failed for every caller before this fix | `supabase.from('automation_workflows').insert([workflow])` (no `organization_id` field existed on the type) | None — the field wasn't populated at all | Resolve `organization_id` from the authenticated session and include it in the insert payload |
| 3 | `getWorkflowHistory()` has no `organization_id` column to filter by | None beyond what RLS already provides — this table is RLS-scoped via its parent through an `EXISTS` subquery | `supabase.from('workflow_history').select('*')` | RLS only | Not fixed — no column exists to filter by without a schema change (out of scope); documented in code |
| 4 | `triggerWorkflow()` inserts into `workflow_history` by `workflow_id` with no ownership check in application code | None beyond RLS — the INSERT policy's `EXISTS` subquery already verifies the referenced `workflow_id` belongs to the caller's organization | `supabase.from('workflow_history').insert([{workflow_id,...}])` | RLS only, contingent on row 2's fix being applied (so real `automation_workflows` rows carry correct `organization_id`) | Not changed — correct by construction once row 2 is fixed |

## 5. SeoIntelligenceService Findings

**Trace:** these methods have **no route → middleware chain** — they are called directly
from `src/pages/SeoDashboardPage.tsx` (`getOpportunities`), which itself has no
`requireAuth`-equivalent gate (it's a client route, gated only by whatever the app's
top-level router does for authenticated pages — not inspected further, out of this
sprint's narrow scope). Tenant isolation, as with AutomationService, is enforced entirely
by Supabase RLS on `seo_projects`/`seo_keywords` (both have `organization_id` and
explicit "Org isolation select/insert" policies, `supabase_schema.sql:1411-1412`).

| FACT | RISK | CURRENT QUERY | TENANT SOURCE | SAFE FIX |
|---|---|---|---|---|
| `getProjects()`/`getKeywords()` had no `.eq('organization_id', ...)` | Low — RLS already scopes both tables | `supabase.from('seo_projects'/'seo_keywords').select('*')` | RLS only (before fix) | Add `.eq('organization_id', orgId)` via `getCurrentOrganizationId()`, same pattern as AutomationService |
| `getOpportunities(projectId)` accepts but never applies `projectId` | None — unrelated to tenant isolation; `seo_keywords` has no column linking it to a specific `seo_projects` row, so this cannot leak cross-project data because there is no per-project filtering mechanism to bypass. The result is scoped to the caller's own organization (via the fix above), just not further narrowed to one project. | `getKeywords()` (unfiltered by project) | N/A | Not fixed — would require a schema change (a project-linking column) to do correctly; reported, not implemented |

## 6. Broader Tenant-Isolation Search

Scope: every `supabase.from(...)` call site across `src/`, cross-checked against
`supabase_schema.sql` for `organization_id` presence and RLS policy coverage.

**Methodological note, stated plainly:** dynamically-generated RLS DDL (`EXECUTE
format('ALTER TABLE public.%I ...', t)` inside a `DO $$ ... $$` loop, `supabase_schema.sql`
lines 545-574) means the literal table name never appears next to `ALTER TABLE`/`CREATE
POLICY` in the file text. A first-pass grep for `ALTER TABLE public.roles` and `ALTER
TABLE public.audit_logs` found nothing and was about to be reported as a new P0 (no RLS on
two security-sensitive tables). That would have been **wrong** — both tables are in the
loop's table array (line 549-556) and do have full `select`/`insert`/`update`/`delete`
"Org isolation" policies. This was caught by reading the surrounding SQL block before
finalizing, not reported as a false finding.

| Table | organization_id column? | RLS policy found? | Classification |
|---|---|---|---|
| `automation_workflows` | Yes | Yes (root) | Fixed — §4 |
| `workflow_history` | No (child) | Yes (child, via parent) | SAFE / EXISTING |
| `seo_projects`, `seo_keywords` | Yes | Yes (root) | Fixed — §5 |
| `roles`, `audit_logs` | Yes | Yes (dynamic loop — see methodological note) | SAFE / EXISTING (initially misclassified, corrected before reporting) |
| `media_packages`, `media_assets`, `media_timelines`, `media_compositions`, `media_exports` | No (child chain) | Yes (child, via `media_projects` → org) | SAFE / EXISTING |
| `campaign_performance` | No (child) | Yes (child, via `campaigns` → org) | SAFE / EXISTING |
| `context_profiles`, `industries`, `industry_categories`, `recommendations`, `learning_models`, `publishing_queue`, `campaigns` | Yes | Confirmed present for each via schema grep this turn | SAFE / EXISTING (client-side `.eq()` filter absent in most consuming service classes, same defense-in-depth gap as §4/§5, **not fixed** — see P1 below) |
| `ContentPlannerPage.tsx`, `VideoStudioPage.tsx`, `ImageStudioPage.tsx`, `JobOrchestratorPage.tsx`, `TeamPage.tsx` | — | — | **SAFE / EXISTING at the call-site level** — each of these page components already resolves `organization_id` via the same `profiles`-lookup pattern and applies it inline (confirmed by direct grep of each file this turn); the earlier appearance of "unscoped" `select('*')` calls in a first-pass grep was a false signal from only matching the `.select()` line and missing the `.eq()` on an adjacent line of the same fluent chain |

**Architectural pattern observed, not a single scattered bug:** every **service class**
that isn't a page component (`AutomationService`, `SeoIntelligenceService`,
`PerformanceIntelligenceService`, `MediaComposerService`, `PublishingCenterService`,
`CampaignManagerService`, `IndustryIntelligenceService`) lacks the client-side
organization filter that every **page component** consistently has. Only the two named in
IR-01 were fixed this sprint, per the explicit instruction to fix only findings "clearly
within the same narrow remediation pattern" and not perform an unrestricted sweep. The
other five service classes are the same pattern and the same low-severity
(RLS-backed) gap — listed as P1 in §12, not fixed here, so this sprint's diff stays
reviewable and scoped to what IR-01 actually named.

**No new P0 finding survived verification.** The one candidate (`roles`/`audit_logs`) was
disproven before being reported.

## 7. Client-Side AI Security Assessment

Direct answers to the seven questions, from source this turn:

1. **Does browser code call external AI providers directly?** Yes —
   `AiProviderService.ts` contains direct `fetch()` calls to
   `generativelanguage.googleapis.com` (Gemini), `api.openai.com` (OpenAI, two
   endpoints), and `api.anthropic.com` (Anthropic), plus others via `this.baseUrl`.
2. **Does browser code access provider credentials?** **No, not in any current code
   path.** The file's own client-facing `select()` (line 415-416) explicitly omits
   `api_key` from its column list, and the `AIProviderConfig.api_key` field's own doc
   comment states: "Never populated in the browser... this is always undefined here."
   Every provider method's `if (!this.config.api_key) throw` guard fires before any
   `fetch()` with a real key could occur. Confirmed by reading the full file this turn —
   no other query in `src/` selects `api_key` from `ai_providers`.
3. **Does browser code write/read provider configuration?** Reads a credential-free
   projection (see above). Writes: fixed by BR-01 — `api_key` is stripped from every
   outgoing payload in `AiProvidersPage.tsx`, and the UI's key-entry field is `disabled`.
4. **Does the service call Bell24h-OS server APIs?** No — it calls external providers
   directly from the browser, and separately calls Supabase directly. It does not call
   `server.ts` or `server/ai/*` at all.
5. **Does the service call Supabase directly?** Yes — for provider configuration
   (credential-free) and for `ai_request_logs`.
6. **Which pages depend on this service?** `AiProvidersPage.tsx`, `PromptStudioPage.tsx`,
   `ImageStudioPage.tsx`, `VideoStudioPage.tsx` — confirmed by import, this turn.
7. **Can the entire path be safely moved behind `ProviderManager`/`ProviderRouter`
   without redesigning the AI architecture?**

   **STOP — this portion requires a broader change than this sprint's scope permits.**

   - **FACT:** `server/ai/ProviderRouter.ts` exposes `generateText`/`generateJson` for one
     provider (Gemini) — text/JSON only. No server-side image or video generation
     capability exists anywhere in this repository (confirmed in IR-01 and re-confirmed
     this turn — no diff to `server/ai/*`).
   - **CONFLICT:** Moving `ImageStudioPage.tsx`/`VideoStudioPage.tsx` behind a
     server-side provider path would require building new server-side generation
     capability that does not exist — not a localized fix, and explicitly out of scope
     ("Do not add new AI providers... Do not create a second AI routing system").
     `PromptStudioPage.tsx` is closer (text generation exists server-side already), but
     moving it still requires a new authenticated `/api/v1` (or similar) route plus
     rewiring a 596-line page's request flow — real, scoped feature work, not a
     same-sprint security patch.
   - **IMPACT:** Leaving these three pages as-is means the architecturally-wrong pattern
     (browser-resident provider client, direct external `fetch()`) remains in place. The
     immediate risk from it is currently low (§7.2 — no credential is actually reachable
     today), but the pattern itself stays a standing liability: any future change that
     reintroduces `api_key` to the client projection (for a plausible-sounding reason,
     without recognizing the consequence) would re-open real exposure instantly, and none
     of these three pages can currently generate real output for a user who has
     configured a real provider, since every call fails on the missing-key guard.
   - **OPTIONS:** (1) leave as-is, tracked as a dedicated future migration sprint; (2)
     migrate `PromptStudioPage.tsx` only, as the narrowest of the three, in a follow-up
     sprint scoped for exactly that; (3) attempt all three now, which would mean building
     new server-side image/video generation capability under time pressure inside a
     security sprint.
   - **RECOMMENDED DECISION:** (1), with (2) as the natural next dedicated sprint once
     decided — no code change made to any of these three pages or to `AiProviderService.ts`
     this sprint.

## 8. Changes Implemented

| File | Change | Why |
|---|---|---|
| `src/lib/currentOrganization.ts` | **New.** `getCurrentOrganizationId()` — resolves the signed-in user's `organization_id` from the authenticated Supabase session (`auth.getUser()` → `profiles`), never from caller input. Extracted from the existing inline pattern already used 4× in `AiProvidersPage.tsx` and independently reimplemented per-page elsewhere — not a new mechanism. | Shared helper so `AutomationService`/`SeoIntelligenceService` (plain classes, no React hook access) can resolve the same trusted context other parts of the app already use |
| `src/modules/automation/AutomationService.ts` | `getWorkflows()`: added `.eq('organization_id', ...)`. `createWorkflow()`: now includes `organization_id` in the insert payload (fixes a previously-broken insert — see §4 row 2). `getWorkflowHistory()`/`triggerWorkflow()`: unchanged, documented why | Defense-in-depth + one real correctness fix |
| `src/modules/seo-intelligence/SeoIntelligenceService.ts` | `getProjects()`/`getKeywords()`: added `.eq('organization_id', ...)`. `getOpportunities()`: unchanged, documented why its `projectId` parameter remains unused | Defense-in-depth |

**Not changed, by design:** `server.ts`, `server/middleware/requireAuth.ts`, any file
under `server/ai/*`, `AiProviderService.ts`, `AiProvidersPage.tsx`,
`PromptStudioPage.tsx`, `ImageStudioPage.tsx`, `VideoStudioPage.tsx`, `supabase_schema.sql`
(no migration applied), `JobWorker.ts`/`src/main.tsx` (JobWorker repair explicitly out of
scope), any file outside this repository.

## 9. Security Test Results

Per the brief: where a live database/session is unavailable, do not fake the test.

| Test | Result | Basis |
|---|---|---|
| A. Authorized same-organization access | **NOT VERIFIABLE** | No live authenticated Supabase session available this session (standing project convention: this session does not hold or request database credentials) |
| B. Unauthorized / missing authentication | **NOT VERIFIABLE** (for these two services specifically — they have no auth gate of their own; Supabase itself would reject an unauthenticated `auth.getUser()` call, returning null, which `getCurrentOrganizationId()` handles by returning `null` → the calling method throws rather than proceeding) | Code-level: **VERIFIED** that a null/missing session causes `getCurrentOrganizationId()` to return `null` and both `getWorkflows()`/`createWorkflow()`/`getProjects()`/`getKeywords()` to throw rather than silently query unfiltered — read directly from the modified files |
| C. Cross-organization access attempt | **NOT VERIFIABLE** (would require two real tenants and two real sessions, unavailable this session) | — |
| D. Client-supplied `organization_id` cannot override trusted context | **VERIFIED** | Code inspection: `organization_id` is never accepted as a parameter to any modified method — it is resolved exclusively inside `getCurrentOrganizationId()` from the authenticated session, with no caller-supplied override path |
| E. Existing authorized application path continues to work | **VERIFIED (typecheck only)** — `npx tsc --noEmit` passes; `AutomationBuilderPage.tsx`'s call to `createWorkflow({name, description, status})` still matches the unchanged `Omit<Workflow, 'id'\|'created_at'>` signature; `SeoDashboardPage.tsx`'s call to `getOpportunities('default-project-id')` is unchanged. **NOT VERIFIABLE at runtime** (no live session) | `npx tsc --noEmit` this turn |
| F. Existing protected routes return the established auth error shape | **N/A to this sprint's changes** — no Express route was touched; `requireAuth.ts`'s error shape is unmodified this sprint (confirmed via `git diff` showing zero changes to that file this turn) | — |
| G. No provider credentials appear in browser-facing responses | **VERIFIED** (§7.2) — confirmed by reading `AiProviderService.ts`'s client-facing `select()` projection, which excludes `api_key` | This turn, static |
| H. No provider credential is written to client-readable storage | **VERIFIED, unchanged from BR-01** — `AiProvidersPage.tsx`'s write path still strips `api_key` before every insert/update (re-confirmed: zero diff to this file this sprint) | `git diff` (no change) + BR-01 |

## 10. Build/Test Results

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **PASS** (exit 0, no output) |
| Unit/integration tests | **NOT RUN — REASON:** no test suite exists in this repository (confirmed no `*.test.ts`/`*.spec.ts` files, consistent with every prior sprint's finding) |
| Runtime smoke test | **NOT RUN — REASON:** this sprint's changes are entirely browser-side service classes calling Supabase directly; a meaningful smoke test requires a live authenticated session against a real Supabase project, which this session does not hold and does not request, per standing project convention. Starting the Vite dev server alone (no session) would not exercise the changed code paths meaningfully — `getCurrentOrganizationId()` would simply return `null` and the guarded methods would throw, which is already verified by direct code reading (§9, row B) |
| Vite build | **NOT RUN** — no reason to expect a build-breaking change beyond what `tsc --noEmit` already covers for this changed surface (two service files + one new lib file, no JSX, no new dependency) |

## 11. Remaining P0 Findings

**None confirmed remaining after this sprint's fixes and search.** The one candidate that
looked P0 mid-investigation (`roles`/`audit_logs` apparently missing RLS) was disproven
before being reported (§6).

## 12. Remaining P1/P2 Findings

**P1 — same defense-in-depth gap, not yet fixed, RLS-backed (low urgency):**
`PerformanceIntelligenceService.ts`, `MediaComposerService.ts`,
`PublishingCenterService.ts`, `CampaignManagerService.ts`,
`IndustryIntelligenceService.ts` — all query RLS-protected, `organization_id`-bearing
tables without an application-level filter, the identical pattern fixed in §4/§5. Not
fixed this sprint to keep the diff scoped to IR-01's two named findings plus what's
directly adjacent (§4 row 2's insert fix). Recommended as a single, narrow follow-up
sprint applying the exact same `getCurrentOrganizationId()` pattern to these five files.

**P2 — correctness bugs, not security defects, not fixed (schema change required or out
of narrow-pattern scope):**
- `SeoIntelligenceService.getOpportunities()` ignores its `projectId` parameter (§5) —
  requires a schema column to fix correctly.
- Duplicate `CREATE TABLE IF NOT EXISTS public.seo_projects` definitions exist in
  `supabase_schema.sql` (lines 403 and 1371) — harmless (the first wins, both include
  `organization_id`), but schema hygiene, not a defect worth a migration on its own.

**P2 — architectural, requires a dedicated sprint, not fixed:**
- Client-side AI execution path (§7) — recommended as its own future sprint, starting
  with `PromptStudioPage.tsx` only.

## 13. VyaparSethu Integration Impact

**None.** No file outside this repository was inspected or modified. No cross-system
authentication was created. This sprint's fixes narrow an existing internal tenant
boundary; they do not change, and are not a substitute for, the cross-system
authentication gap IR-01 identified as the primary blocker to any VyaparSethu
integration (IR-01 §9.1/§10.2, unchanged by this sprint).

## 14. Git State

```
Branch:  main
HEAD:    2dd23563b49640330a9673ad11b2fbc20eeb6f79   (unchanged — no commit made)
```

**PRE-EXISTING CHANGES** (confirmed unmodified by this sprint via diff comparison):
`server.ts`, `server/middleware/requireAuth.ts`, `src/pages/AiProvidersPage.tsx`,
`server/lib/requestContext.ts`, `server/lib/errors.ts`, all `docs/architecture/*.md` and
`docs/project/*.md` files, `.mcp.json`, `MASTER_CONTEXT/KERNEL_ARCHITECTURE.md`.

**BR-03 CHANGES:**
```
 M src/modules/automation/AutomationService.ts
 M src/modules/seo-intelligence/SeoIntelligenceService.ts
?? src/lib/currentOrganization.ts
?? docs/project/BR-03-SECURITY-REMEDIATION-REPORT.md
```

No commit, no push, no deploy, no reset, no revert, no file deletion. Awaiting founder
review.

## 15. Final Verdict

**Both IR-01-named findings verified and remediated with the smallest available fix.**
Severity was more precisely characterized than IR-01's original framing: RLS was already
the enforcing layer for both, so this sprint's fixes are defense-in-depth plus one genuine
functional-bug fix (`createWorkflow`'s broken insert), not a closure of an active
cross-tenant leak. No new P0 was found (one false-positive candidate was caught and
corrected before being reported). The client-side AI credential-exposure question was
resolved more precisely than previously documented: the credential is not currently
reachable by the browser in any live code path, and the remaining architectural
non-compliance is correctly stopped and reported rather than force-fixed. Five files carry
the same low-severity, RLS-backed gap as a documented P1 for a future narrow follow-up.
`npx tsc --noEmit` passes. No commit, push, or deploy occurred. **Sprint complete —
stopping here.**
