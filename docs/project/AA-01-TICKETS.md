# AA-01 Ticket Backlog

Generated from `docs/project/AA-01-IMPLEMENTATION-AUDIT.md` (commits `6249534`,
`64026ee`). Every ticket below traces to a specific, cited finding in that report.
No code was modified to produce this backlog — documentation only.

---

### AA-01-001
**Module:** Content Planner / Image Studio / Video Studio / Job Orchestrator
**Severity:** Critical
**Title:** `JobWorker` is never instantiated — no enqueued job ever executes
**Evidence:** `src/main.tsx:7,9` — the import and `JobWorker.getInstance().start()` call are both commented out. Grep across the repo found no other caller of `JobWorker` anywhere (AA-01 report, "Ground truth" section, and Job Orchestrator matrix row).
**Root Cause:** The polling worker that consumes `job_queue` and calls `JobOrchestratorService.processJob` was wired up in code but never activated in the app's entrypoint — looks like a debugging/staging comment-out that was never reverted.
**Files Involved:** `src/main.tsx`, `src/modules/job-orchestrator/JobWorker.ts`, `src/modules/job-orchestrator/JobOrchestratorService.ts`
**Recommended Fix:** Uncomment the two lines in `main.tsx`. Before shipping, confirm `processJob`'s AI calls actually work end-to-end (see AA-01-002) — re-enabling the worker alone will just move jobs from "queued forever" to "failing forever" until that's fixed too.
**Estimated Effort:** S (the visible code change is two lines; verifying it works end-to-end depends on AA-01-002)
**Dependencies:** Should be implemented together with AA-01-002 for a working result, not just a code-complete one.

---

### AA-01-002
**Module:** AI Providers / Prompt Studio / Content Planner / Image Studio / Video Studio / Job Orchestrator
**Severity:** Critical
**Title:** AI generation calls provider APIs directly from the browser, bypassing the server-side AI Router
**Evidence:** `src/modules/ai-providers/AiProviderService.ts:1-13` (header comment: "LEGACY — DO NOT USE FOR NEW SERVER ENDPOINTS... contradicts SECURITY_BASELINE.md... tracked as Critical Security Debt"); direct `fetch()` calls to Gemini (`:105`), OpenAI (`:156,197`), Anthropic (`:246`), and OpenAI-compatible providers (`:304,351`). None of the 6 calling modules import `server/ai/ProviderManager.ts` or `ProviderRouter.ts`.
**Root Cause:** A client-side AI service was built early (likely before the server-side AI Router existed) and never migrated. Only Knowledge Vault's two endpoints were built against the correct server-side pattern.
**Files Involved:** `src/modules/ai-providers/AiProviderService.ts`, `src/pages/AiProvidersPage.tsx`, `src/pages/PromptStudioPage.tsx`, `src/pages/ContentPlannerPage.tsx`, `src/pages/ImageStudioPage.tsx`, `src/pages/VideoStudioPage.tsx`, `src/modules/job-orchestrator/JobOrchestratorService.ts`, `server/ai/ProviderManager.ts`, `server/ai/ProviderRouter.ts`
**Recommended Fix:** Build server.ts (or a new router file) endpoints for text/image/video generation that call `ProviderRouter.ts`, mirroring the pattern already proven at `/api/vault/ai-summary` and `/api/vault/mentor-advice`. Replace every `AIManagerService.generate*()` call site with a `fetch("/api/...")` call to the new endpoint. Retire `AiProviderService.ts`'s direct-provider classes once all call sites are migrated.
**Estimated Effort:** L (new server endpoints + 6 call-site migrations + retiring legacy code)
**Dependencies:** Blocks a fully working AA-01-001. Fixing this properly (server-side key handling) also resolves the residual issue in AA-01-004.

---

### AA-01-003
**Module:** Knowledge Vault
**Severity:** Critical
**Title:** Vault tables have no `organization_id` — any authenticated user can read every organization's data
**Evidence:** `server.ts:199-205`, code comment states directly: *"`requireAuth` closes anonymous access to these routes. It does NOT make the data tenant-safe — these tables carry no organization_id column... Any authenticated user of any organization can still read every row."*
**Root Cause:** The 5 vault tables (`vault_documents`, `rd_library`, `timeline_milestones`, `phases`, `decision_records`) were designed as founder/single-tenant tooling and never extended for multi-tenancy when the rest of the app went multi-org.
**Files Involved:** `supabase_schema.sql` (table definitions for the 5 vault tables), `server.ts:206-377` (all 7 vault routes)
**Recommended Fix:** This is a schema-level fix, not a code patch — add an `organization_id` column to all 5 tables, backfill existing rows, add RLS policies, and add `organization_id` filtering to every vault query in `server.ts`. Treat this with the same rigor as the SS-03/IS-00.x migration sprints (static investigation → minimal diff → transaction-safety check → manual-SQL verification) given it touches production schema and data.
**Estimated Effort:** XL (schema migration + backfill + RLS + server route changes + full manual verification cycle)
**Dependencies:** None blocking, but should follow the same evidence-discipline workflow already established for schema changes in this repo (SS-01 through SS-03, IS-00.1–IS-00.5).

---

### AA-01-004
**Module:** AI Providers
**Severity:** Critical
**Title:** Browser still writes plaintext `api_key` to the `ai_providers` table
**Evidence:** `AiProvidersPage.tsx:106,108` — `.update(payload)` / `.insert(payload)` where `payload = { ...formData, organization_id }` and `formData.api_key` is bound to a password input at `AiProvidersPage.tsx:445-452`. The earlier fix (commit `343945c`) only removed `api_key` from the **read** path — the write path was never addressed.
**Root Cause:** Partial fix — the original security review addressed "the browser requesting `api_key`" (a read) but the form's insert/update payload was never audited for the same field.
**Files Involved:** `src/pages/AiProvidersPage.tsx`, `src/modules/ai-providers/AiProviderService.ts`
**Recommended Fix:** Move provider-key entry to a server-side endpoint (`POST /api/ai-providers`) that accepts the key, writes it server-side, and never returns it. Short-term mitigation if the full fix (AA-01-002) is delayed: strip `api_key` from the client `payload` before every `insert`/`update` call and require a separate, audited server-side path to set it.
**Estimated Effort:** S for the short-term mitigation; folds into AA-01-002's effort for the real fix
**Dependencies:** Best resolved as part of AA-01-002 (moving AI provider management server-side generally).

---

### AA-01-005
**Module:** Authentication
**Severity:** High
**Title:** `/system/diagnostics` is reachable with zero authentication
**Evidence:** `App.tsx:74` — registered as a bare sibling route outside the `ProtectedRoute` wrapper that starts at `App.tsx:76`. No `AuthRedirect` or `ProtectedRoute` wraps it.
**Root Cause:** Likely an oversight when the route was added — every other route in the app is nested under the single shared `ProtectedRoute`, but this one was added as a top-level sibling instead.
**Files Involved:** `src/App.tsx`, `src/pages/SystemDiagnosticsPage.tsx`
**Recommended Fix:** Move the route inside the `ProtectedRoute`-wrapped block (or wrap it individually if it needs to stay outside `AppLayout` for some reason).
**Estimated Effort:** S
**Dependencies:** None.

---

### AA-01-006
**Module:** Publishing
**Severity:** High
**Title:** Publishing Center has no actual mechanism to publish to any external platform
**Evidence:** `PublishingCenterService.ts:21-31` — only `getQueue()` (unfiltered `select('*')`) and `enqueuePublishingTask()` (never called from the page) exist. No social-platform API calls, no OAuth flow, no external `fetch()` of any kind found in `src/modules/publishing-center/`. `PublishingCenterPage.tsx` has no create/update/delete UI at all — it only renders `getQueue()`'s result.
**Root Cause:** The module was scaffolded (table + read path) but the feature it's named for — actually posting content somewhere — was never built.
**Files Involved:** `src/pages/PublishingCenterPage.tsx`, `src/modules/publishing-center/PublishingCenterService.ts`
**Recommended Fix:** Scope this as a real feature build: define which platforms are in scope, add OAuth/connection UI, build the create-task flow (the service method already exists, just needs a caller), and add the actual external posting logic (likely as a new server-side endpoint, following the AA-01-002 pattern rather than calling third-party APIs from the browser). Also add `organization_id` scoping (see AA-01-008) and a `.catch()` on the current unhandled `getQueue().then(...)` call.
**Estimated Effort:** L
**Dependencies:** Should follow the server-side-call pattern established by AA-01-002, if that lands first.

---

### AA-01-007
**Module:** Admin
**Severity:** High
**Title:** `/admin` has no role-based access control — any authenticated user can reach it
**Evidence:** `ProtectedRoute` (`App.tsx:36-49`) only checks `isAuthenticated`, not `role`. No additional guard exists on the `admin` route (`App.tsx:98`) or inside `AdminPage.tsx`.
**Root Cause:** `ProtectedRoute` was designed as a single generic auth gate; no role-aware route wrapper was ever built for admin-only pages.
**Files Involved:** `src/App.tsx`, `src/pages/AdminPage.tsx`, `src/hooks/useAuth.ts`, `src/modules/auth/AuthService.ts`
**Recommended Fix:** Add a role check — either a new `AdminRoute` wrapper component that reads the resolved role from `useAuth()`/`AuthService.resolveRole()` and redirects non-admins, or extend `ProtectedRoute` to accept a `requiredRole` prop.
**Estimated Effort:** S
**Dependencies:** Natural to implement alongside AA-01-012 (rebuilding AdminPage itself), since both touch the same route.

---

### AA-01-008
**Module:** Context Engine / Campaign Center / SEO Center / Automation Center / Database Center
**Severity:** High
**Title:** No client-side organization scoping — queries rely solely on RLS enforcement, which is unproven
**Evidence:** Confirmed absence of any `.eq('organization_id', ...)` filter: `ContextProfileManagerPage.tsx:16`; `CampaignManagerService.ts:23,29`; `SeoIntelligenceService.ts:16,22`; `AutomationService.ts:32,42,53,66`; `DatabasePage.tsx:27`. Cross-referenced against `docs/project/RV-FOUNDATION-CERTIFICATION.md`: RLS is confirmed enabled repo-wide (RV-006 VERIFIED), but cross-tenant enforcement itself is RV-007 DEFERRED — never runtime-proven, because only one organization currently exists in the database.
**Root Cause:** These 5 modules were built assuming RLS alone is sufficient, unlike the 9 modules that also add an explicit client-side filter as defense-in-depth (Dashboard, Organizations, Teams, Content Planner, Image Studio, Video Studio, AI Providers, Prompt Studio, Job Orchestrator).
**Files Involved:** `src/pages/ContextProfileManagerPage.tsx`, `src/modules/campaign-manager/CampaignManagerService.ts`, `src/modules/seo-intelligence/SeoIntelligenceService.ts`, `src/modules/automation/AutomationService.ts`, `src/pages/DatabasePage.tsx`
**Recommended Fix:** Add `.eq('organization_id', profile.organization_id)` to every query in these 5 modules, following the pattern already used in Dashboard/Teams/Job Orchestrator. Mechanical, low-risk change once the pattern is copied consistently.
**Estimated Effort:** M
**Dependencies:** Independent of other tickets; real risk reduction depends on RV-007 eventually being verified with a second tenant (tracked separately in `RV-FOUNDATION-CERTIFICATION.md`, not this backlog).

---

### AA-01-009
**Module:** Dashboard / Database Center / Analytics (Performance Intelligence) / Admin
**Severity:** High
**Title:** Multiple pages render hardcoded values as if they were live system state
**Evidence:** Dashboard's "AI Provider Status" badges (`DashboardPage.tsx:166-190`, no backing state variable); Database Center's "Connected"/"Online"/"Healthy" badges (`DatabasePage.tsx:61,71,81`, not derived from any check); `PerformanceDashboardPage.tsx:71,81,91,101` static "+X% from last month" trend text and `:148-176` hardcoded "Optimization Health" percentages; AdminPage's fake audit-log entries (`AdminPage.tsx:72-84`, hardcoded timestamps like "2 mins ago").
**Root Cause:** These were built as visual mockups during earlier UI passes and never connected to real state — but they render convincingly enough to be mistaken for live data by anyone not reading source.
**Files Involved:** `src/pages/DashboardPage.tsx`, `src/pages/DatabasePage.tsx`, `src/pages/PerformanceDashboardPage.tsx`, `src/pages/AdminPage.tsx`
**Recommended Fix:** For each: either wire to a real check/query, or replace with an explicit "Not available" / "—" state so it's honest about not being live. Do not ship fabricated status indicators either way.
**Estimated Effort:** S (per instance; bundle as one pass since the fix pattern is identical)
**Dependencies:** None. AdminPage's instance folds naturally into AA-01-012 if that's done first.

---

### AA-01-010
**Module:** Automation Center
**Severity:** High
**Title:** Workflow execution is simulated, not real; visual Builder canvas is non-functional
**Evidence:** `AutomationService.ts:63-64`, code comment: *"In a real system, this would queue a job in the background // For now, we simulate the start of an execution."* `triggerWorkflow` only inserts a `workflow_history` row with `status: 'started'` — nothing ever transitions it to `completed`/`failed`. `AutomationBuilderPage.tsx:96-99,114-117` render a static "Visual Node Editor v1.0" placeholder with one inert node; `:45-48` — both "Save Draft" and "Publish Workflow" call the same handler with `status: 'draft'` regardless of which button is pressed.
**Root Cause:** The dashboard/monitoring shell was built first; the actual execution engine and visual builder were scaffolded with placeholder behavior and never completed.
**Files Involved:** `src/modules/automation/AutomationService.ts`, `src/pages/AutomationDashboardPage.tsx`, `src/pages/AutomationBuilderPage.tsx`
**Recommended Fix:** Decide whether Automation Center should route through the same job-execution mechanism as AA-01-001/002 (recommended, avoids building a second parallel execution system) or have its own. Build a real Builder UI or scope down the "visual editor" framing until one exists.
**Estimated Effort:** M
**Dependencies:** Consider sequencing after AA-01-001/002 if execution is unified onto the same job engine.

---

### AA-01-011
**Module:** Settings
**Severity:** Medium
**Title:** SettingsPage is a fully static mockup with zero backend wiring
**Evidence:** `SettingsPage.tsx` has no Supabase import, no `SettingsService` import, no `useState`/`useEffect` for data — every field uses hardcoded `defaultValue` (e.g. `"John Doe"` at line 40, fake API key at line 84). Every button lacks an `onClick` handler. `SettingsService.ts:11-22` — both `getSettings()` and `updateSettings()` are explicitly commented "Placeholder implementation"; `updateSettings` only `console.log`s.
**Root Cause:** Scaffolded as a UI mockup during an earlier design pass, never connected.
**Files Involved:** `src/pages/SettingsPage.tsx`, `src/modules/settings/SettingsService.ts`
**Recommended Fix:** Wire `SettingsService.ts` to real Supabase reads/writes against a settings table (or `profiles`/`organizations` columns, depending on what "settings" should mean here), then connect `SettingsPage.tsx` to it with real state and handlers.
**Estimated Effort:** M
**Dependencies:** None.

---

### AA-01-012
**Module:** Admin
**Severity:** Medium
**Title:** AdminPage is a fully static mockup with zero backend wiring
**Evidence:** `AdminPage.tsx:5-10` hardcoded fake `users` array; `:72-84` hardcoded fake audit log; no Supabase import in the page. `AdminService.ts:4-23` — `getUsers()` and `getAuditLogs()` both explicitly commented "Placeholder", return `[]`; `getSystemHealth()` returns a hardcoded object. Neither service method is imported by the page.
**Root Cause:** Same pattern as AA-01-011 — scaffolded UI, never connected; `getUsers()`'s own comment notes it requires `SUPABASE_SERVICE_KEY`, implying this was intentionally deferred pending a service-role-backed endpoint.
**Files Involved:** `src/pages/AdminPage.tsx`, `src/modules/admin/AdminService.ts`
**Recommended Fix:** Build the server-side endpoint `getUsers()`'s comment anticipates (needs elevated privileges, so this must be server-side, not client Supabase calls), wire `getAuditLogs()` to the real `audit_logs` table (already used elsewhere, e.g. `TeamPage.tsx`), and connect the page.
**Estimated Effort:** M
**Dependencies:** Pair with AA-01-007 (role gate) — building real admin functionality without access control first would be worse than the current fake-data state.

---

### AA-01-013
**Module:** Organizations / Teams / Knowledge Vault / Context Engine / AI Providers / Prompt Studio / Content Planner / Image Studio / Video Studio / Campaign Center / SEO Center / Automation Center / Database Center
**Severity:** Medium
**Title:** No module has complete CRUD; Update/Delete are the most common gaps, several also lack error handling and loading states
**Evidence:** Per-module gaps cited in the AA-01 matrix: Organizations (no Create/Delete for orgs, tracked separately as AA-01-024), Content/Image/Video Studio (no Update, Image Studio's Delete button has no handler, Video Studio has no Delete UI at all), Knowledge Vault (Read-only for RD Library/Timeline/Phases/Decisions; "New Document"/"Record Decision"/"Unlock Phase" buttons have no handlers), Context Engine ("New Profile" button dead, no error handling, no loading state), Campaign Center / SEO Center / Automation Center / Database Center (no error handling, no loading state; SEO Center's `getOpportunities` also silently ignores its `projectId` argument, `SeoIntelligenceService.ts:27-34`).
**Root Cause:** Consistent pattern across modules built early in the project: Create+Read shipped first, Update/Delete and defensive UI states were deferred and never returned to.
**Files Involved:** `src/pages/OrganizationPage.tsx`, `src/pages/TeamPage.tsx`, `src/components/vault/*.tsx`, `src/pages/ContextProfileManagerPage.tsx`, `src/pages/ContentPlannerPage.tsx`, `src/pages/ImageStudioPage.tsx`, `src/pages/VideoStudioPage.tsx`, `src/pages/CampaignDashboardPage.tsx`, `src/pages/SeoDashboardPage.tsx`, `src/pages/AutomationDashboardPage.tsx`, `src/pages/DatabasePage.tsx`, plus each module's `*Service.ts`
**Recommended Fix:** This is a large, mechanical backlog item best split per-module into individually schedulable sub-tickets at implementation time (not held as one PR). Prioritize by which modules are otherwise closest to done (see AA-01 report's "Closest to working" list).
**Estimated Effort:** L (as a category; individual module fixes are S–M each)
**Dependencies:** None blocking; natural to fold in alongside AA-01-008's per-module work since both touch the same files.

---

### AA-01-014
**Module:** Teams
**Severity:** Medium
**Title:** Member invitation is explicitly simulated — no real account is created
**Evidence:** `TeamPage.tsx:104-105`, code comment: *"Create auth user (simulated, usually requires server-side admin client) // Since we can't create auth.users from client without login, we will just record the attempt in audit logs."* `TeamPage.tsx:117` shows a "Mock successful invite" `alert()`. Only an `audit_logs` row is written (`:109`); no `profiles`/`auth.users` row is created, no invite email is sent.
**Root Cause:** Creating a Supabase Auth user requires the service role key, which correctly cannot live in client code — this was scaffolded as a stand-in pending a server-side endpoint that was never built.
**Files Involved:** `src/pages/TeamPage.tsx`
**Recommended Fix:** Build a server-side invite endpoint (using the Supabase service role, server-side only) that creates the auth user and sends a real invite email, then replace the simulated flow in `TeamPage.tsx` with a call to it.
**Estimated Effort:** M
**Dependencies:** Benefits from the server-side endpoint pattern established by AA-01-002/AA-01-012 (both need service-role-backed server endpoints too — worth building the pattern once).

---

### AA-01-015
**Module:** Industry Intelligence (out-of-scope-list item, discovered during Analytics investigation)
**Severity:** Medium
**Title:** `IndustryDashboardPage.tsx` is fully built but has zero route — completely unreachable
**Evidence:** Full read of `src/App.tsx` confirms no import and no `<Route>` for `IndustryDashboardPage` anywhere in the file, despite the page existing and calling a real service (`IndustryIntelligenceService.getIndustries()`).
**Root Cause:** Unknown from static evidence alone — either the route was removed at some point, or the page was built and never wired in. No commit-history investigation was performed as part of AA-01 (out of its read-only, current-state scope).
**Files Involved:** `src/pages/IndustryDashboardPage.tsx`, `src/App.tsx`, `src/modules/industry-intelligence/IndustryIntelligenceService.ts`
**Recommended Fix:** Decide whether this page is wanted. If yes, add the import + route in `App.tsx` (trivial) and audit it properly (it wasn't in AA-01's 23-module scope, so it hasn't had a real CRUD/auth/AI review). If no, delete the dead file.
**Estimated Effort:** S (either direction)
**Dependencies:** None.

---

### AA-01-016
**Module:** Database Center / Context Engine
**Severity:** Medium
**Title:** Two dedicated service files are dead stubs, unused by their own pages
**Evidence:** `DatabaseService.ts:1-14` — comment "Database client placeholder for browser/edge environments"; `query()` only `console.log`s and returns `[]`; `ping()` returns hardcoded `true`; not imported by `DatabasePage.tsx` (which queries Supabase directly instead). `ContextEngineService.ts` — confirmed via grep to have exactly one reference repo-wide (its own file); not imported by `ContextProfileManagerPage.tsx`.
**Root Cause:** Both look like an initial service-layer scaffold that was abandoned in favor of direct Supabase calls in the page, without removing the now-orphaned file.
**Files Involved:** `src/modules/database/DatabaseService.ts`, `src/modules/context-engine/ContextEngineService.ts`
**Recommended Fix:** Either delete both files, or make them the real data-access layer and refactor the pages to use them instead of inline Supabase calls (architectural consistency choice, not urgent either way).
**Estimated Effort:** S
**Dependencies:** None.

---

### AA-01-017
**Module:** SEO Center
**Severity:** Medium
**Title:** "SEO Intelligence" engines are plain arithmetic/keyword matching, not AI, and a query parameter is silently ignored
**Evidence:** `SearchIntentEngine.ts:2-9` — pure `includes("how to")`/`includes("buy")` substring matching. `MarketOpportunityEngine.ts:2-6` — pure arithmetic. Neither imports `AIManagerService`, `ProviderManager`, or `ProviderRouter`. Separately, `SeoDashboardPage.tsx:10` passes a hardcoded `'default-project-id'` into `getOpportunities()`, but `SeoIntelligenceService.ts:27-34` never uses the parameter — it fetches all keywords unconditionally.
**Root Cause:** The "Intelligence" naming implies AI-driven analysis that was never built; the ignored parameter suggests the function was written before project-scoping was decided and never revisited.
**Files Involved:** `src/modules/seo-intelligence/SearchIntentEngine.ts`, `src/modules/seo-intelligence/MarketOpportunityEngine.ts`, `src/modules/seo-intelligence/SeoIntelligenceService.ts`, `src/pages/SeoDashboardPage.tsx`
**Recommended Fix:** Either rename to set accurate expectations (e.g. "SEO Keyword Scoring") or genuinely add an AI-assisted layer via the server-side pattern from AA-01-002. Separately, fix `getOpportunities` to actually filter by the passed project ID (or remove the parameter if project-scoping isn't wanted).
**Estimated Effort:** S
**Dependencies:** None.

---

### AA-01-018
**Module:** Voice Studio
**Severity:** Low
**Title:** No route or page exists — only a dead 10-line stub, unwired
**Evidence:** Case-insensitive repo-wide grep for `voice-studio`/`VoiceStudio` found no route or page. `VoiceService.ts` (10 lines) — `textToSpeech()` only `console.log`s and returns `new Blob()`; `speechToText()` returns the hardcoded literal `"Transcribed text placeholder"`. Grep confirms the class is referenced nowhere else in the repo.
**Root Cause:** Scaffolded as a placeholder for a feature that was never built out; `JobOrchestratorService.ts`'s `JobType` union even includes `'voice'`, but `processJob`'s switch statement has no `case 'voice':` and nothing ever enqueues one.
**Files Involved:** `src/modules/voice/VoiceService.ts`, `src/modules/job-orchestrator/JobOrchestratorService.ts` (unused `'voice'` type)
**Recommended Fix:** Product decision needed: build a real Voice Studio (page + route + real TTS/STT provider integration, following the AA-01-002 server-side pattern) or remove the stub and the unused `'voice'` job type to stop implying a feature exists.
**Estimated Effort:** S to remove the stub / L to build the real feature — blocked on a product decision either way
**Dependencies:** Blocked by product scope decision.

---

### AA-01-019
**Module:** Developer Center
**Severity:** Low
**Title:** Zero code footprint repository-wide
**Evidence:** Case-insensitive grep for "developer center" / "developer-center" / "DeveloperCenter" across `src/`, `server/`, and `docs/` returned no matches anywhere.
**Root Cause:** Named in the product's module list but never started — no scaffold, no stub, nothing.
**Files Involved:** None exist yet.
**Recommended Fix:** Product decision needed on scope before any implementation ticket can be sized meaningfully.
**Estimated Effort:** Unknown until scoped — likely XL if built as a full module
**Dependencies:** Blocked by product scope decision.

---

### AA-01-020
**Module:** Users
**Severity:** Low
**Title:** "Users" does not exist as a distinct module — functionality lives inside Teams
**Evidence:** Case-insensitive grep for "users" in `src/App.tsx` and `src/pages/*.tsx` found no dedicated route or page. Real member/role management is in `TeamPage.tsx` (see AA-01-014 for its gaps); `AdminPage.tsx`'s "User Management" card is separately covered by AA-01-012.
**Root Cause:** Likely intentional — "Users" and "Teams" were probably always meant to be the same feature, not two separate ones, but this was never explicitly documented as a scope decision.
**Files Involved:** N/A — documentation/scope clarification only.
**Recommended Fix:** Confirm with the founder whether "Users" was meant to be a distinct module (e.g., a system-wide user directory across organizations, for admin use) or was always meant to fold into Teams. If the former, it's a new build; if the latter, close this as intentional and update the module list used for future audits.
**Estimated Effort:** XS (decision only)
**Dependencies:** None.

---

### AA-01-021
**Module:** Analytics
**Severity:** Low
**Title:** "Analytics" does not exist as a distinct module — closest analog is Performance Intelligence, which is narrower in scope
**Evidence:** Case-insensitive grep for "analytics" across `src/App.tsx` and `src/pages/*.tsx` found no matches. `PerformanceDashboardPage.tsx` (route `performance-intelligence`) is scoped specifically to campaign/content performance metrics (`campaign_performance`, `recommendations`, `learning_models` tables) — no site traffic, session, funnel, or product/order analytics of any kind.
**Root Cause:** Same pattern as AA-01-020 — likely an intentional naming difference that was never documented as such.
**Files Involved:** N/A — documentation/scope clarification only.
**Recommended Fix:** Confirm with the founder whether general-purpose analytics (traffic, funnels, product usage) was ever intended as a separate module, or whether "Performance Intelligence" was always meant to be the complete answer to "Analytics." If the former, it's a new build.
**Estimated Effort:** XS (decision only)
**Dependencies:** None.

---

### AA-01-022
**Module:** CRM / Agents (out-of-scope-list items)
**Severity:** Low
**Title:** Two additional service files exist with no corresponding page or route
**Evidence:** `src/modules/crm/CrmService.ts` and `src/modules/agents/AgentService.ts` exist; no `CrmPage`/`AgentsPage` import or route found in `src/App.tsx`. These were outside AA-01's requested 23-module scope and were not audited in depth — this finding is a byproduct of the repo-structure sweep, not a full review.
**Root Cause:** Unknown — same unreachable-service pattern as Developer Center and pre-AA-01-fix Industry Intelligence, but not investigated further since out of scope.
**Files Involved:** `src/modules/crm/CrmService.ts`, `src/modules/agents/AgentService.ts`
**Recommended Fix:** A follow-up audit (or an expansion of AA-01's scope) is needed before this can be sized — first confirm whether either was intended to ship, and if so, what a real audit of their actual implementation depth looks like.
**Estimated Effort:** S to scope / unknown to fix, pending that scoping work
**Dependencies:** Blocked by a scoping decision; likely deserves its own AA-02-style audit rather than a single ticket.

---

### AA-01-023
**Module:** Cross-cutting (Phase 2 / deployment verification)
**Severity:** Low
**Title:** Phase 2 runtime verification remains outstanding — this tool has no access to the team hosting the live deployment
**Evidence:** `docs/project/AA-01-IMPLEMENTATION-AUDIT.md`, "Blocker found before Phase 2 could start" section: `list_teams` only returns `bell24xs-projects`; a direct `get_project` call against `vvishaal-penharkarbell24s-projects` returned `403 Forbidden`. The founder independently confirmed a live Production deployment for commit `942dcbd` via direct browser inspection.
**Root Cause:** The Vercel MCP connection used by this tool is scoped to a different team/account than the one the actual project is deployed under.
**Files Involved:** N/A — tooling/access configuration, not application code.
**Recommended Fix:** Either grant this tool's Vercel identity access to `vvishaal-penharkarbell24s-projects`, or perform Phase 2 verification manually (same evidence-discipline pattern as the RV-001–RV-007 sprints: one check at a time, founder observes and pastes results). Until then, none of the 23 modules' Phase 2 status can move off `⚪ UNKNOWN`.
**Estimated Effort:** S (access grant) or M (manual verification pass covering all 23 modules)
**Dependencies:** Blocks re-verification of every other ticket's runtime behavior, but blocks nothing else — all code-level tickets above can proceed independently.

---

### AA-01-024
**Module:** Organizations
**Severity:** Medium
**Title:** No Create flow exists for organizations
**Evidence:** `OrganizationPage.tsx:158-168` — the "No Organization Found" empty state tells the user to "contact your administrator" or "create a new organization," but no create handler, form, or Supabase insert exists anywhere in the file for this entity.
**Root Cause:** Likely by design if organizations are meant to be created only at signup (unconfirmed) — but the empty-state UI itself implies a self-service path that doesn't exist, which is misleading regardless of the underlying intent.
**Files Involved:** `src/pages/OrganizationPage.tsx`
**Recommended Fix:** Either build the create-org flow the empty state promises, or change the empty-state copy to match actual capability (e.g., "Contact support to set up your organization").
**Estimated Effort:** S (copy fix) or M (real create flow) — depends on product decision
**Dependencies:** None.

---

## Summary

### Tickets by severity

| Severity | Count | IDs |
|---|---|---|
| Critical | 4 | AA-01-001, AA-01-002, AA-01-003, AA-01-004 |
| High | 6 | AA-01-005, AA-01-006, AA-01-007, AA-01-008, AA-01-009, AA-01-010 |
| Medium | 8 | AA-01-011, AA-01-012, AA-01-013, AA-01-014, AA-01-015, AA-01-016, AA-01-017, AA-01-024 |
| Low | 6 | AA-01-018, AA-01-019, AA-01-020, AA-01-021, AA-01-022, AA-01-023 |
| **Total** | **24** | |

### Suggested fix order (accounting for dependencies)

1. **AA-01-005** (unauthenticated diagnostics route) — trivial, zero dependencies, close it first.
2. **AA-01-001 + AA-01-002 together** — re-enable `JobWorker` and build the server-side AI Router endpoints in the same effort; doing #1 alone just changes the failure mode. This is the single highest-leverage pair in the backlog (unblocks Content Planner, Image Studio, Video Studio simultaneously) and folds in **AA-01-004**'s real fix as a side effect.
3. **AA-01-003** (Knowledge Vault tenant isolation) — schedule as its own schema-migration sprint, following the SS-03/IS-00.x evidence-discipline pattern already proven in this repo. Independent of #2, can run in parallel.
4. **AA-01-007 + AA-01-012** together (Admin role gate + real Admin backend) — gate before you build, not after.
5. **AA-01-008 + AA-01-013** together — both touch the same 5–13 module files (org scoping and missing CRUD); doing them in the same pass per module avoids opening each file twice.
6. **AA-01-006** (Publishing real feature) and **AA-01-010** (Automation real execution) — both are "build the actual mechanism" tickets; sequence after #2 if execution is meant to share one job engine, otherwise independent.
7. **AA-01-009, AA-01-011, AA-01-014, AA-01-015, AA-01-016, AA-01-017, AA-01-024** — independent, lower-risk, can be picked up opportunistically or batched into one "cleanup" sprint.
8. **AA-01-018, AA-01-019, AA-01-020, AA-01-021, AA-01-022** — not implementation work yet; these need product/founder scope decisions before they can be sized or scheduled at all.
9. **AA-01-023** — resolve access whenever convenient; it blocks re-verification, not further code work.

### Groupable into one sprint vs. independent

**Natural single-sprint bundles** (same files or same root cause, cheaper to do together):
- AA-01-001 + AA-01-002 + AA-01-004 (job execution + AI routing + key exposure — one architectural fix)
- AA-01-007 + AA-01-012 (Admin route gate + Admin backend)
- AA-01-008 + AA-01-013 (org scoping + CRUD completeness, same module files)
- AA-01-011 + AA-01-009's AdminPage/SettingsPage instances (mockup pages, same pattern)

**Fully independent** (safe to schedule in any order, no shared files or root cause):
- AA-01-003 (schema migration — needs its own dedicated sprint regardless)
- AA-01-005 (one-line route fix)
- AA-01-006 (new feature build)
- AA-01-010 (Automation-specific)
- AA-01-014 (Teams invite — though it shares "needs a server-side endpoint" DNA with AA-01-002/012, it doesn't share files)
- AA-01-015, AA-01-016, AA-01-017, AA-01-022, AA-01-024
- AA-01-018, AA-01-019, AA-01-020, AA-01-021 (decision-blocked, not sprint work until scoped)
- AA-01-023 (access/tooling, not application code)
