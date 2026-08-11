# PS-01 — Project Continuity & Recovery Audit

**Date:** 2026-08-03
**Auditor:** Claude Code, acting as Bell24h-OS Architecture Council
**Scope:** Assessment only. No source code, architecture, or git state was modified.
**HEAD at time of audit:** `d2ca7cd` (local, 7 commits ahead of `origin/main`)

---

## Pre-flight: Repository scope — RESOLVED WITH EVIDENCE

**Primary Repository = `C:\Users\Sanika\digitex-erp-bell24h-os` (this working tree).**

This is confirmed, not assumed, by:

- The project's own `bell24h-verify` skill, which draws a hard line between this
  repository (Vite + React SPA, Supabase auth, `digitex-erp-bell24h-os`) and a
  **different, unrelated project** at `C:/Users/Sanika/Projects/bell24h` (Next.js,
  MSG91 phone OTP, INSFORGE + Prisma, deployed to bell24h.com → vyaparsethu.com).
- `MASTER_CONTEXT/KERNEL_ARCHITECTURE.md` (untracked, Source B/C — see below) states
  explicitly: *"VyaparSethu today is an independent Next.js application using MSG91
  auth and INSFORGE — it shares no code with this repo."*
- The Vercel side of the scope question is answered with live API evidence, not
  inference (see Step 1): `.vercel/project.json` in this working tree points at Vercel
  project `digitex-erp-bell24h-os` (`prj_8oLwDwlcBgJAuf4FFFsSWwBcFBGp`), and calling the
  Vercel API for that exact project ID confirms `framework: "vite"`, `live: false`,
  `deployments: []`. So the Vercel project is this repository's deployment target, not
  a second repository — there is no scope ambiguity to resolve further.

**Conclusion:** VyaparSethu is out of scope entirely — not a "separate repository to
also audit," but a different codebase with no relationship to this one beyond sharing
a product family name. The only audit target is this working tree, and it does contain
the open Review Gate C work and the 7 unpushed commits. No scope error.

---

## Step 0.5 — Source-of-Truth Reconciliation

Three sources exist in this repository and must not be blended:

- **Source A — Repository reality:** this working tree, its git history, and what the
  build/runtime actually do when executed.
- **Source B — Recovered/prior assessment:** `MASTER_CONTEXT/KERNEL_ARCHITECTURE.md`
  (untracked, `git status` confirms `?? MASTER_CONTEXT/KERNEL_ARCHITECTURE.md`), which
  is itself a prior Claude Code session's audit, dated "verified 2026-07-30 at commit
  `d2ca7cd`" (i.e., our current HEAD). It is evidence of a prior investigation, not a
  file this session wrote, and its claims are re-derived below rather than inherited.
- **Source C — Planning & vision:** the tracked governance/report set added in commit
  `5c24483` (`ENGINEERING_GOVERNANCE.md`, `SECURITY_BASELINE.md`,
  `ARCHITECTURE_DECISIONS.md`, `AI_ROUTER_POLICY.md`, `SPRINT_EXECUTION.md`,
  `RISK_REGISTER.md`, `RECOMMENDATIONS.md`, `ARCHITECTURE_COMPLIANCE_REPORT.md`,
  `GOVERNANCE_READINESS_REPORT.md`, `REPOSITORY_HEALTH_REPORT.md`,
  `TECHNICAL_DEBT_REPORT.md`, `DOCUMENTATION_COVERAGE_REPORT.md`,
  `CODE_STANDARDS.md`), plus `MASTER_CONTEXT/PROJECT_CONSTITUTION.md`,
  `ARCHITECTURE.md`, `MODULES.md`, `API_CONTRACTS.md`, `DATABASE.md`, `ROADMAP.md`,
  `TESTING_GUIDE.md`, `CHANGELOG.md`.

### Reconciliation table (most load-bearing claims only)

| Capability / Claim | Repository Evidence (A) | Recovered Evidence (B) | Planning Evidence (C) | Reconciled Finding |
|---|---|---|---|---|
| API routes require auth | 8 of 13 routes unauthenticated, verified live via curl (Step 1) | Same figure: "8 unauthenticated request routes" (Gap #1, §18) | `SECURITY_BASELINE.md` checklist item "RBAC tested server-side" — unchecked | **VERIFIED (A)**: matches B exactly. Gate C is open. |
| RLS bypass via pooled `DATABASE_URL` | 9 routes call `getPool()` directly, verified by reading `server.ts` and confirming no ORM/RLS path is used | "9 routes bypass RLS via direct pool" (Gap #2, §18) | `ARCHITECTURE_DECISIONS.md` forbids direct DB connections from modules | **VERIFIED (A)**, matches B. |
| Provider API key in browser | `AiProviderService.getProviders()` explicitly excludes `api_key` from its Supabase projection (verified by reading the file); legacy class still ships in the client bundle | "17 `api_key` refs in shipped client bundle" (Gap #4) — not recounted exactly by this session, but bundle grep this session ran confirms all `api_key` occurrences found are `if (!config.api_key) throw` guards or UI placeholder strings, not live secrets | `SECURITY_BASELINE.md`: "Never store provider keys in ordinary tenant-readable records" | **VERIFIED (A)** for the current HEAD (commit `343945c` fixed the query projection); the underlying `ai_providers.api_key` **column** still exists in the schema and is still tenant-readable in principle — the fix is at the query layer, not the schema/RLS layer. Not fully closed. |
| AUTH_BYPASS reaches production | Absent from production bundle (0 matches for `dev-user-id`, `Developer Admin`, `AUTH_BYPASS` in `dist/assets/*.js`); requires explicit `VITE_AUTH_BYPASS=true` opt-in even in dev (commit `d2ca7cd`) | Not separately re-verified in B (B's evidence baseline is the same commit) | — | **VERIFIED (A)**, direct runtime/bundle evidence this session. |
| Login has ever succeeded | Not tested this session (barred from entering credentials) | "Authentication | complete [declared] | Not verified once. Zero successful logins observed" | `MASTER_CONTEXT/CHANGELOG.md` claims a "Production Authentication Recovery" on 2026-07-03 | **UNKNOWN**, and B and C directly contradict each other. This session's own runtime test shows `requireAuth` correctly returns 401 for an anonymous request in both dev and prod builds — that verifies the **rejection** path only. It says nothing about whether a real credential can complete a login. That remains untested and requires the project owner. |
| Vercel deployment state | `list_deployments` for `prj_8oLwDwlcBgJAuf4FFFsSWwBcFBGp` returns `{"deployments": [], "count": 0}`; `get_project` returns `"live": false, "domains": []` — **VERIFIED via live Vercel API call this session** | "zero deployments" (§11, §10) | — | **VERIFIED (A)**, independently confirmed, not merely inherited. |
| Vercel environment variables | Not obtainable — no MCP tool available in this session returns project env vars | asserted as "zero environment variables" (prompt baseline, and echoed in B) | — | **UNKNOWN** by this session's direct evidence. Do not conflate with the deployments finding above, which *is* independently verified — these are two different claims with two different confidence levels. |
| Job queue worker running | `src/main.tsx` lines 7–9: `JobWorker` import and `.start()` call are both commented out — **verified by reading the file directly** | "Jobs are queued but workers are not started" (`RISK_REGISTER.md` R-003, and independently in B's module table) | — | **VERIFIED (A)**, matches both B and C. |
| Layer 0–6 architecture model | Not found anywhere in any tracked or untracked document — confirmed by direct grep across `MASTER_CONTEXT/` and root docs | `KERNEL_ARCHITECTURE.md` uses a 5-tier (Products/Modules/Kernel/Adapters/Infra) + 10-"Runtime" model, not "Layer 0–6" | `ARCHITECTURE_DECISIONS.md` defines a 9-stage named pipeline (Foundation → Marketplace → Industry Intelligence → SEO Intelligence → Enterprise AI Router → Content/Creative Factories → Publishing → Performance Intelligence → Learning/Optimization) — also not "Layer 0–6" | **CONTRADICTION — surfaced, not resolved.** See Step 0.7. |
| RFQ / Quote / Buyer / Supplier management | Tables exist (`rfqs`, `rfq_items`, `quotations`, `quotation_items`, `buyers`, `suppliers`) with RLS org-isolation policies, but **no service, no page, no CRUD UI** references them anywhere in `src/` — confirmed by repo-wide grep and module inventory (Step 2) | Not addressed in B | `MASTER_CONTEXT/MODULES.md` does not list these as modules either | **VERIFIED (A) ABSENT as a feature.** Schema-only. A planning document mentioning a table is not evidence of a working module. |

---

## Step 0.7 — Architecture Baseline: contradiction surfaced, not resolved

The PS-01 instructions assert the frozen baseline is a numbered **Layer 0–6** model.
Direct evidence contradicts this:

- `ARCHITECTURE_DECISIONS.md` (tracked, committed `5c24483`, 2026-07-25) defines the
  approved target architecture as a **9-stage named pipeline**: Foundation →
  Marketplace → Industry Intelligence → SEO Intelligence → Enterprise AI Router →
  Content and Creative Factories → Publishing → Performance Intelligence → Learning
  and Optimization. It is not numbered, and it is not called "Layer 0–6" anywhere in
  its text.
- `MASTER_CONTEXT/KERNEL_ARCHITECTURE.md` (untracked, Source B, Sprint C.3A, explicitly
  labeled **"DESIGN — NOT FROZEN"**) proposes a different model again: a 5-tier stack
  (Products → Modules → Kernel → Adapters → Infra) wrapping 10 named Runtimes
  (Security, Event, AI, Memory, Workflow, Agent, Graph, Search, Commerce, Analytics).
- Neither document uses the phrase "Layer 0–6," and neither proposes a "Transformer
  Runtime" layer (confirmed by direct grep — this exclusion in the PS-01 instructions
  appears to guard against a model that isn't present in this repository at all).

**This is reported as a finding, per the instruction to surface baseline contradictions
loudly rather than smooth them over.** It is an ADR candidate for PS-02, not a decision
this audit makes. Whichever of the three descriptions ("Layer 0–6," the 9-stage
pipeline, or the Kernel's 5-tier/10-runtime model) is meant to be authoritative needs an
explicit decision — right now the repository's own committed governance documents do
not agree with each other, let alone with the PS-01 prompt's framing.

One point of actual agreement across B and C, independent of the layer-numbering
question: **"Bell24h-OS is the platform; applications consume it, never the reverse"**
is stated consistently in `ARCHITECTURE_DECISIONS.md`, `KERNEL_ARCHITECTURE.md`, and
`MASTER_CONTEXT/PROJECT_CONSTITUTION.md`. That invariant is not in dispute.

---

## Step 1 — Repository Health

### Git state

```
On branch main
Your branch is ahead of 'origin/main' by 7 commits.
Untracked files:
  MASTER_CONTEXT/KERNEL_ARCHITECTURE.md
nothing added to commit but untracked files present
```

`git rev-list --left-right --count origin/main...HEAD` → `0  7` (0 unique to
`origin/main`, 7 unique to `HEAD`). `origin/main` tip is `a0b000a`.

### The 7 unpushed commits — classified

| Commit | Date | Summary | Classification |
|---|---|---|---|
| `281c08a` | 2026-07-28 12:56 | `fix: load dotenv in vite.config` — 1-line fix so `.env` reaches `process.env` before Vite's `define` block reads it | **Belongs.** Prerequisite bugfix; without it every production build silently bakes `placeholder.supabase.co`. |
| `17cab7e` | 2026-07-28 20:35 | `docs: add bell24h-verify project skill` | **Belongs.** Tooling/process, no functional risk. |
| `b5426e5` | 2026-07-28 20:38 | `docs: add bell24h-constitution project skill` | **Belongs.** Same category. |
| `aea842e` | 2026-07-28 21:20 | `fix(security): authenticate and gate the vault AI endpoints` — adds `requireAuth`, `server/ai/*`, `server/audit.ts`, `server/middleware/rateLimit.ts`; **verified this session** via live curl: anonymous POST to `/api/vault/ai-summary` returns `401 {"error":"unauthenticated"}` in both dev and production builds | **Belongs, and verified working**, not just code-inspected. |
| `cfa6cea` | 2026-07-28 21:52 | `fix(security): disable /api/migrate and /api/env/diagnostic in production` — **verified this session**: both return `404` under `NODE_ENV=production`, both remain reachable (200/500) in dev | **Belongs, and verified working.** |
| `343945c` | 2026-07-28 23:59 | `fix(security): stop the browser requesting ai_providers.api_key` — narrows the `select()` projection | **Belongs.** Reduces exposure at the query layer (schema/RLS layer still open — see Step 0.5 table). |
| `d2ca7cd` | 2026-07-29 01:23 | `fix(auth): gate AUTH_BYPASS behind explicit VITE_AUTH_BYPASS opt-in` — **verified this session**: 0 dev-bypass markers in the production bundle | **Belongs, and verified working.** |

**Conclusion on the 7 commits:** all seven are genuine, individually-scoped fixes, and
four of them (`aea842e`, `cfa6cea`, `343945c`, `d2ca7cd`) are independently verified at
runtime this session, not merely code-reviewed. They should **not** be pushed yet —
not because they are wrong, but because pushing now would put a *partially* remediated
security posture on `origin/main` without any label distinguishing "fixed" from "still
open." Eight of thirteen API routes remain unauthenticated after all seven commits
(Step 5). Push once Gate C is fully closed, or push now with an explicit, visible
note that Gate C remains open — that is a judgment call for the project owner, not
this audit.

### Build

```
$ npm run build
vite v6.4.3 building for production...
✓ 1870 modules transformed.
dist/index.html                 0.42 kB
dist/assets/index-DrZM06ZJ.css  59.31 kB
dist/assets/index-anH7NC9L.js   853.24 kB
✓ built in 10.61s
dist/server.cjs 20.1kb
```
**Builds cleanly.** One warning (853 kB main chunk exceeds the 500 kB guidance) —
noted under Technical Debt, not a defect.

### Lint / typecheck

```
$ npm run lint   (tsc --noEmit)
```
No output — exits clean. **Passes.**

### Tests

No test files exist anywhere under `src/`, `server/`, or the repo root (only
`node_modules/**/*.test.*` match any test-file glob). No `vitest.config.*` or
`jest.config.*`. `package.json` defines no `test` script. **There is no test suite.**
This matches `REPOSITORY_HEALTH_REPORT.md` and `TECHNICAL_DEBT_REPORT.md` (Source C,
2026-07-25), independently re-confirmed here.

### CI

No `.github/workflows/`, no `.gitlab-ci.yml`, no `azure-pipelines.yml`, no
`.circleci/`. **No CI configuration exists.**

### TODO / FIXME / HACK markers

Repo-wide grep (excluding `node_modules`) for `TODO|FIXME|HACK|XXX`: one match, in
`supabase_schema.sql:259`, and it is a false positive (`status TEXT DEFAULT 'TODO'`,
a data enum value, not a marker). **Zero actual markers.**

### Review Gate status — C.2B / C.2C

Per the untracked `KERNEL_ARCHITECTURE.md` (Source B) and independently verified this
session against `server.ts`:

- **C.2C** ("apply `requireAuth` + org scope to all 8 open routes; migrate 9 pool
  handlers off RLS bypass") — **OPEN.** Verified via live curl against both a dev
  server and a production build (`NODE_ENV=production`): `GET /api/check-users-count`,
  `GET /api/check-table`, `GET|POST /api/vault/documents`, `GET /api/vault/rd`,
  `GET /api/vault/timeline`, `GET /api/vault/phases`, `GET /api/vault/decisions` all
  respond without any 401 — they reach application logic and only fail locally on
  missing `DATABASE_URL`. Only `/api/vault/ai-summary` and `/api/vault/mentor-advice`
  are gated (`requireAuth` + rate limit, confirmed 401 without a token).
- **C.2B** ("apply the column `REVOKE`; rotate every provider key") — **OPEN.** The
  browser-side query no longer selects `api_key` (commit `343945c`), but the
  `ai_providers.api_key` column itself still exists, unRESTRICTed at the column-grant
  level, and there is no evidence any key has been rotated.

**Both are unclosed. Review Gate C is OPEN.**

---

## Step 2 — What Actually Exists (bottom-up discovery)

Full module-by-module inventory with Confidence/Maturity labels is in
[`IMPLEMENTATION_STATUS.md`](./IMPLEMENTATION_STATUS.md). Summary of method: enumerated
`src/modules/*`, `src/pages/*`, `server.ts` routes, and `supabase_schema.sql` tables
from the filesystem outward — not from a prior list — via a dedicated exploration pass
that read every module's actual source file, not just its name.

**Headline findings:**

- Of 18 `src/modules/*` service classes, **8 are stubs** returning hardcoded/empty data
  (`AdminService`, `AgentService`, `CrmService`, `DatabaseService`,
  `KnowledgeBaseService`, `SettingsService`, `VoiceService`, and effectively
  `ContextEngineService` which is bypassed by its own page).
- `IndustryDashboardPage.tsx` is **fully orphaned** — not referenced by any route, any
  nav item, or any other file. It has real backing logic (`IndustryIntelligenceService`)
  that is unreachable in the running app.
- 8 routed pages exist with no sidebar entry (`seo-intelligence`, `campaigns` +
  `campaigns/builder`, `media-composer`, `publishing-center`, `automation` +
  `automation/builder`, `performance-intelligence`) — reachable only by direct URL or
  in-page cross-link, not through primary navigation.
- `JobWorker` (the queue's consumer loop) is defined but its `.start()` call is
  commented out in `src/main.tsx` — **queued jobs are never processed client-side**,
  and no server-side worker exists either.
- `src/lib/supabase.ts` / `/system/diagnostics` confirm a live, configured Supabase
  project (`dqpaekyayhqhndihbnnn`) is reachable from this build when `.env` is present
  locally — but that `.env` is a local, gitignored file created for testing, not a
  committed or Vercel-side configuration.

### Negative check (planning-doc capability names vs. repository reality)

| Capability | Status | Evidence |
|---|---|---|
| Wallet | **ABSENT** | No source references; only appears once in a compiled `dist` bundle, unrelated to a Bell24h feature |
| Ledger | **ABSENT** | No matches anywhere |
| Escrow | **ABSENT in code** | Mentioned only in `KERNEL_ARCHITECTURE.md` (planning) |
| Trust Score | **ABSENT** | No matches |
| Ratings | **ABSENT** | No matches |
| Nearby SEO / GEO | **ABSENT** | No matches for either term; `KERNEL_ARCHITECTURE.md` module table lists "GEO Engine — Not built" |
| Provider Manager | **PRESENT, but not as a UI capability** | `server/ai/ProviderManager.ts` exists (server-side credential resolver, real and wired) |
| OmniRoute | **ABSENT from application code** | No file under `src/` or `server/` implements or calls it; only named in planning docs |
| Prompt Studio | **PRESENT** | `src/pages/PromptStudioPage.tsx`, routed, in sidebar, uses `AIManagerService` (legacy browser AI path) |
| Authentication | **PRESENT** | Full Supabase auth path exists; **whether it has ever completed a successful login is UNKNOWN** — see Outstanding Investigations |
| Organizations | **PRESENT** | `organizations` table, `OrganizationPage.tsx`, `organization_id` threaded through nearly every table |
| Permissions | **PRESENT as a table only** | `permissions` table exists but has **no RLS enabled and no policy anywhere**; no enforcement code exists |
| Supplier Management | **ABSENT as a feature; table only** | `suppliers` table exists with RLS; no service, no UI |
| Buyer Management | **ABSENT as a feature; table only** | `buyers` table exists with RLS; no service, no UI |
| RFQs | **ABSENT as a feature; tables only** | `rfqs`/`rfq_items` exist; no service, no UI |
| Quotes | **ABSENT as a feature; tables only** (named `quotations`) | `quotations`/`quotation_items` exist; no service, no UI |
| Deals | **ABSENT** | No matches; closest analog (`orders`) exists as a table only |

---

## Step 3 — Engineering Timeline

Reconstructed from `git log` (21 commits total, first commit `6fdbbf0` 2026-07-02
23:30, current HEAD `d2ca7cd` 2026-07-29 01:23) and commit stats.

- **2026-07-02 23:30 → 2026-07-03 23:30 (one continuous ~24h burst, 12 commits):**
  initial scaffold through team management, AI provider management, creative studios,
  job orchestrator, context engine, SEO/Campaign/Media modules, Publishing Center,
  runtime diagnostics. This is the bulk of the application's feature surface, all
  built in a single day. **Last completed sprint by evidence:** this burst, ending at
  `943d55e` ("implement runtime diagnostics and error boundary").
- **Gap: 2026-07-03 23:30 → 2026-07-25 09:47 (22 days), no commits to this repo.**
  The next commit's message — `a0b000a`: *"consolidate application code from
  digitex-erp-bell24h-os2"* — implies parallel work happened in a separate working
  copy (`...os2`) during this gap and was merged back in on 2026-07-28. This is
  **INFERRED**, not directly observed: this repository has no record of what happened
  in `...os2` during the gap. Flagged as an unaccounted-for period rather than
  fabricating a narrative.
- **2026-07-25 09:47 (`5c24483`):** single commit adding the entire governance/report
  document set (13 files, 437 lines) — `ENGINEERING_GOVERNANCE.md` through
  `GOVERNANCE_READINESS_REPORT.md`. This reads as a **planning sprint**, not an
  implementation one — no source files changed in this commit.
- **2026-07-28 07:21 (`a0b000a`):** the Knowledge Vault consolidation — 21 files,
  +2200/-1185 lines. Brought in `add_knowledge_vault.sql`, `src/components/vault/*`,
  `KnowledgeVaultPage.tsx`, and substantially rewrote `useAuth.ts`, `AuthPage.tsx`,
  `SystemDiagnosticsPage.tsx`, `src/lib/supabase.ts`. This is the single largest
  functional commit in the history and the origin of the Knowledge Vault feature that
  is now central to the open security findings (its schema comment reads *"even
  though user said No Auth"* — see Step 5).
- **2026-07-28 12:56 → 2026-07-29 01:23 (7 commits, ~12.5 hours):** the security
  remediation sequence audited in Step 1 — dotenv fix, two project skills, three
  security fixes, one auth-bypass fix. **This is the currently active, unfinished
  work** — Gate C.2B/C.2C remain open.
- **Since 2026-07-29 01:23 (audit date 2026-08-03, ~5 days idle):** no further
  commits. `MASTER_CONTEXT/KERNEL_ARCHITECTURE.md` was authored during or after this
  window (its own header claims verification "at commit `d2ca7cd`") but was never
  committed — it sits untracked in the working tree. This is **work in progress,
  deliberately or accidentally left uncommitted** — cannot be distinguished from here.
- **No commits or branches were found that could not be accounted for.** `git log
  --all` shows a single linear branch (`main`); no other local branches, no stashes.

---

## Step 4 — Architecture Alignment

Given the baseline contradiction surfaced in Step 0.7, "target location under
Bell24h-OS v2.0" cannot be assigned with confidence for most modules — the committed
`ARCHITECTURE_DECISIONS.md` pipeline and the untracked `KERNEL_ARCHITECTURE.md`
Kernel model would place the same module in different positions. What can be said
without resolving that dispute:

| Module | Current location | Verdict |
|---|---|---|
| Auth (Supabase, `requireAuth`, `AuthService`) | `src/modules/auth`, `server/middleware/requireAuth.ts` | **UNCLEAR — needs Council decision** on which target model applies, but functionally this is Foundation-tier under either model |
| `AiProviderService` (browser-resident, legacy) | `src/modules/ai-providers` | **MIGRATES TO PLATFORM**, explicitly and repeatedly flagged as legacy by its own header comment, by `AI_ROUTER_POLICY.md`, and by `KERNEL_ARCHITECTURE.md` §16 |
| `server/ai/*` (ProviderRouter, ProviderManager, GeminiProvider) | `server/ai` | **STAYS / IS the correct platform-side seed** — both C-sources agree this is the right shape, just narrow in scope (Gemini only, 2 endpoints only) |
| Vault module (`src/components/vault/*`, `vault_*` tables) | `src/components/vault`, root `server.ts` routes | **UNCLEAR** — this module's own schema comments describe it as a single-tenant "founder mode" feature with no org isolation by original design, which does not fit an org-scoped platform model at all. Needs an explicit Council decision on whether it is in-scope for Bell24h-OS or should be removed/quarantined as out-of-product debt. |
| RFQ/Quote/Buyer/Supplier tables (no service layer) | `supabase_schema.sql` only | **NO ACTION** — nothing exists to migrate; these are schema-only |
| Job Orchestrator / `JobWorker` | `src/modules/job-orchestrator` | **UNCLEAR** — real logic exists but its worker is not started anywhere (client or server); a genuine platform module would need a server-side runtime, which does not exist |

**Layer boundary violations found:**
- `src/pages/*` (7 of them — `DashboardPage`, `OrganizationPage`, `TeamPage`,
  `AuthPage`, `SystemDiagnosticsPage`, `JobOrchestratorPage`,
  `ContextProfileManagerPage`, `DatabasePage`) call the Supabase client **directly**,
  bypassing their own module's service layer entirely — `ContextProfileManagerPage`
  queries `context_profiles` directly instead of using `ContextEngineService`, for
  example. `CODE_STANDARDS.md` (Source C) itself calls this "legacy behavior" that
  "must not be copied into new modules" — an acknowledgment that it already exists.
- Every one of the 8 currently-unauthenticated `server.ts` routes queries Postgres via
  a pooled `DATABASE_URL` connection, which is a documented forbidden pattern in
  `ARCHITECTURE_DECISIONS.md` ("a module may not open a database connection") and in
  `KERNEL_ARCHITECTURE.md` §12 ("forbidden in request handlers").

---

## Step 5 — Technical Debt & Security

**Security (highest priority, per governance):**

1. **8 of 13 `server.ts` API routes are unauthenticated** — `/api/check-table`,
   `/api/check-users-count`, `GET|POST /api/vault/documents`, `/api/vault/rd`,
   `/api/vault/timeline`, `/api/vault/phases`, `/api/vault/decisions`. **VERIFIED** via
   live curl against both a local dev server and a `NODE_ENV=production` build this
   session — all reach application logic without a 401, distinguishable from the two
   protected AI routes which correctly return 401. This is Review Gate C's central
   open item.
2. **9 routes bypass RLS via a pooled `DATABASE_URL` connection** (the 8 above, plus
   `/api/migrate`, which is otherwise dev-only-gated). Direct-pool access ignores
   Postgres RLS entirely regardless of what policies exist on the underlying tables.
3. **The Knowledge Vault tables (`vault_documents`, `rd_library`,
   `timeline_milestones`, `phases`, `decision_records`) have RLS *enabled* but with a
   literal `"Public Read Access" ... USING (true)` policy** — confirmed by reading
   `supabase_schema.sql` lines 1958–1970 directly. The schema's own comment reads:
   *"Enable RLS (even though user said No Auth, it's good practice"* and *"Allow
   public access for 'Single Founder Mode'."* This strongly suggests the Vault feature
   was designed as a single-tenant personal tool (prompts reference a product called
   **"ICECRAFT"**, not Bell24h-OS or VyaparSethu — see `AiProviderService`'s prompt
   text and the schema's seed data), not a Bell24h-OS multi-tenant module. This is a
   **surprising finding worth flagging loudly**: even in a fully-authenticated future
   state, these specific tables have no `organization_id` column and no tenant
   isolation by design, so "gate the route" alone would not make them tenant-safe.
4. `AUTH_BYPASS` — **VERIFIED FIXED.** Requires `import.meta.env.DEV` (statically
   false in production) **and** an explicit `VITE_AUTH_BYPASS=true` opt-in. Confirmed
   absent from the production bundle (0 matches for all bypass markers).
5. `ai_providers.api_key` client exposure — **PARTIALLY FIXED.** The browser query no
   longer selects the column (verified by reading `AiProviderService.ts`), but the
   column itself is unREVOKEd and no key rotation is evidenced. `server/ai/*`
   correctly resolves credentials from `process.env` only and is never imported from
   `src/`.
6. `role: 'ADMIN'` hardcoded for every user — **VERIFIED FIXED**, superseding the
   `bell24h-verify` skill's "known open violations" note. `useAuth.ts` now calls
   `AuthService.resolveRole()`, which queries `user_roles`/`roles` and fails closed to
   `VIEWER` on any error. (The skill note predates commit `aea842e`; this audit's own
   direct file read confirms the current state supersedes it.)
7. `status: 'pass'` hardcoded for unperformed checks — **VERIFIED FIXED.**
   `SystemDiagnosticsPage.tsx`'s realtime check now explicitly reports
   `not_implemented` with a comment stating a fabricated pass would misrepresent the
   result.
8. `permissions` table has no RLS and no policy anywhere — **open, not previously
   tracked** in the known-violations list; found independently this session.
9. `job_priorities` table: RLS enabled, **no policy defined at all** — found
   independently; effectively locks out all access under RLS unless a policy exists
   elsewhere that this audit did not find.
10. `workflow_templates` table: created, but never included in any RLS-enable
    statement — found independently.

**Duplicate logic / dead code:**
- `seo_projects`, `campaigns`, and `social_accounts` are each defined **twice** in
  `supabase_schema.sql` under `CREATE TABLE IF NOT EXISTS` (harmless due to
  `IF NOT EXISTS`, but indicates the schema file was assembled from separate
  per-feature SQL fragments without dedup).
- 8 of 18 `src/modules/*` services are stubs (see Step 2) — dead weight, not
  functioning features, despite being "present" in the filesystem.
- `IndustryDashboardPage.tsx` is fully orphaned (unreachable, no route).

**Performance:** one build warning — main JS chunk is 853 kB minified (232 kB gzip),
above Vite's 500 kB guidance. Not investigated further; flagged per instructions to
report rather than fix.

---

## Step 6 — Readiness Assessment

### Architecture Freeze readiness: **2/6 criteria met**

| Criterion | Met? | Evidence |
|---|---|---|
| Complete module inventory produced with evidence | ❌ Not met | An inventory exists (`IMPLEMENTATION_STATUS.md`), but "complete" implies it can be checked against an agreed target model, and it cannot be — see next row. Listing what exists is not the same as a freeze-ready inventory. |
| Every module has an assigned target layer | ❌ Not met | Cannot be done until the Layer 0–6 / 9-stage pipeline / Kernel-runtime contradiction (Step 0.7) is resolved by the Council — not one module in `IMPLEMENTATION_STATUS.md` has an assigned target layer, because there is no single agreed model to assign it to |
| Layer boundary violations enumerated | ✅ Met | Step 4 lists concrete violations (7 pages bypassing their module's service layer; 9 routes using forbidden direct-pool access) — this doesn't depend on which layer model wins, since "a page skipped its own module's service" is a violation under any of the three candidate models |
| Data ownership per module identified | ❌ Not met | Several tables (`seo_projects`, `campaigns`, `social_accounts`) are duplicated across schema sections with unclear single ownership; the Vault tables have no `organization_id` at all, so "which module owns this data" is genuinely unanswered, not just undocumented |
| Duplicate capabilities identified | ✅ Met | Step 5 — schema duplicates and 8 stub services identified with file references |
| Open architectural questions listed | ✅ Met | Step 0.7, Step 4 — the baseline contradiction itself, plus the Vault-tenancy question, are both explicitly recorded |

**2/6 met.** The two unmet criteria that most matter (module inventory *against a
target*, and per-module target-layer assignment) both stem from the same unresolved
baseline contradiction (Step 0.7) — resolving that single Council question would very
likely also resolve "data ownership per module," since ownership is easiest to state
once a target model exists to state it against. This is consistent with
`KERNEL_ARCHITECTURE.md`'s own independent scoring reaching the same conclusion via a
different method (27/100, "Architecture CANNOT be frozen").

### Module Extraction readiness: **0/3 criteria met**

| Criterion | Met? | Evidence |
|---|---|---|
| Platform-bound modules identified with dependency maps | ❌ Not met | `IMPLEMENTATION_STATUS.md` identifies candidate modules (e.g. `server/ai/*` as the correct platform-side AI seed) but no dependency map has been produced for any of them |
| Extraction blockers named per module | ❌ Not met | Not attempted this audit — blocked upstream by Architecture Freeze not being ready |
| Consumer impact assessed | ❌ Not met | Consumers are listed per module in `IMPLEMENTATION_STATUS.md` (which pages/services import what), but the *impact* of extracting any given module on those consumers has not been assessed |

Not pursued further this session, per the constitution's sequencing rule that a later
gate cannot be scored as ready while an earlier one (Architecture Freeze) is open —
the three rows above are recorded as unmet rather than skipped, so the ratio is
auditable against its own criteria like the other gates.

### Bell24h-OS Implementation readiness: **0/4 criteria met**

| Criterion | Met? | Evidence |
|---|---|---|
| Review Gate C fully passed (hard prerequisite) | ❌ Not met | Step 1 — C.2B and C.2C both open, verified via runtime test |
| Architecture frozen (PS-02 complete) | ❌ Not met | PS-02 has not run; Architecture Freeze readiness above is 2/6 |
| API contracts defined | ❌ Not met | `MASTER_CONTEXT/API_CONTRACTS.md` lists 11 method signatures with no request/response schemas; `DOCUMENTATION_COVERAGE_REPORT.md` itself calls a full API reference a remaining gap |
| Build and test pipeline verified operational | ❌ Not met | Build passes; there is no test pipeline (no tests exist) and no CI |

### Application Migration readiness: **0/2 criteria met**

| Criterion | Met? | Evidence |
|---|---|---|
| Platform modules implemented with stable APIs | ❌ Not met | No module has reached "implemented with a stable API" status — even the most complete server-side piece (`server/ai/ProviderRouter.ts`) is explicitly self-documented as a narrow, 2-endpoint, Gemini-only boundary, not a stable general API |
| Migration sequence defined | ❌ Not met | `KERNEL_ARCHITECTURE.md` §16 proposes a migration order (Prompt Studio → Content Planner → Image Factory → Video Factory → JobOrchestrator), but that document is Source B/untracked design work, not an adopted plan |

Recorded rather than skipped, for the same auditability reason as Module Extraction
above — both gates are blocked upstream by Architecture Freeze and Bell24h-OS
Implementation not being ready, but each unmet criterion still has its own evidence
line rather than a bare ratio.

---

## Step 7 — Next Sprint Recommendation

See [`NEXT_SPRINT_RECOMMENDATION.md`](./NEXT_SPRINT_RECOMMENDATION.md).

---

## Cross-references

- [`IMPLEMENTATION_STATUS.md`](./IMPLEMENTATION_STATUS.md) — full module-by-module
  inventory with Confidence/Maturity/Status labels and runtime evidence.
- [`OUTSTANDING_INVESTIGATIONS.md`](./OUTSTANDING_INVESTIGATIONS.md) — the
  investigation register (Step 0.6).
- [`NEXT_SPRINT_RECOMMENDATION.md`](./NEXT_SPRINT_RECOMMENDATION.md) — Step 7.
