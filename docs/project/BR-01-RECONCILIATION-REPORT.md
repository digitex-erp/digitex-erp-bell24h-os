# BR-01 — Reality & Security Reconciliation Report

**Baseline:** `docs/project/BR-01-PHASE0-BASELINE.md`
**Gap map:** `docs/architecture/REALITY_TO_TARGET_GAP_MAP.md`
**Prior evidence relied on:** `docs/project/AA-01-IMPLEMENTATION-AUDIT.md`,
`docs/project/AA-01-TICKETS.md` (both committed at HEAD, both re-verified against
source directly rather than taken on faith).

This report is **not final-closed**. Sections P0-B, P0-C, and P0-E require runtime
evidence only the founder can produce (live browser DevTools inspection; a Vercel
deployment check), and one static question requires one manual SQL query the founder
runs and pastes back, per the standing project convention of never automating or
requesting credentials for the Supabase SQL Editor. Everything answerable from source
and git history is complete below.

---

## 1. Security Status

**Client-side AI credentials: PARTIAL.**

- **Read path (browser receiving a provider key): VERIFIED safe already, before BR-01
  touched anything.** `AIManagerService.getProviders()` (`AiProviderService.ts:410-419`)
  explicitly excludes `api_key` from its `select(...)` projection. Every provider class
  throws `"API key is missing"` before it can call a provider, because the browser never
  has the value.
- **Write path (browser sending a raw key to Supabase): VERIFIED defect, now fixed.**
  `AiProvidersPage.tsx` built an insert/update payload containing the raw key typed into
  the form and sent it directly to the tenant-readable `ai_providers` table. RLS on that
  table is organization-isolation only (no column-level security), so any authenticated
  member of the *same* organization could retrieve a stored key with a direct
  `select('*')`, bypassing the app's curated read list. **Fixed this sprint** — see §6.
  Cross-tenant exposure (a *different* org reading it) remains formally unproven either
  way; this repo's own `MASTER_DATA_OWNERSHIP.md` already logs that as `RV-007 DEFERRED`,
  unrelated to and unresolved by this fix.
  **The fix stops the bug going forward; it does not tell you whether it already fired.**
  The SQL check below only answers "is a key stored in the column right now" — it cannot
  see a key that was typed, saved, and later overwritten with blank/placeholder text, nor
  can it see the historical fact that the raw value was transmitted over the wire at
  least once by anyone who used the form before this fix landed. A `has_key = false`
  result means "nothing to rotate today," not "no exposure ever occurred."
- **Env vars / client bundle: VERIFIED clean.** Only `VITE_SUPABASE_URL`/`VITE_SUPABASE_KEY`
  (the intentionally-public anon key) are injected into the client build. No provider-key
  env var of any name reaches `src/`. The local `dist/assets/*.js` bundle (built Aug 3;
  architecturally unchanged since) contains no `sk-…`/`AIza…`-shaped literal.

**Affected providers:** Gemini, OpenAI, Anthropic, DeepSeek, Qwen, GLM, MiniMax, NVIDIA
(every provider `AiProviderService.ts` defines a class for).

**Affected modules (source-level, per AA-01, re-confirmed):** AI Providers, Prompt
Studio, Content Planner, Image Studio, Video Studio, Job Orchestrator.

**Public exposure: still UNKNOWN, but re-checked with new evidence (2026-08-10).**
Re-queried Vercel directly (`list_teams` → `get_project` → `list_deployments`):

- Reachable team `bell24xs-projects` (`team_4QgVezq9OAa7UqzMkRMteKZX`) now lists **two**
  projects, not one. `digitex-erp-bell24h-os` (`prj_8oLwDwlcBgJAuf4FFFsSWwBcFBGp`, this
  repo, framework `vite`): **`live: false`, `latestDeployment: null`, `domains: []`,
  0 deployments returned by `list_deployments`** — unchanged from AA-01, re-confirmed.
- The second project, **`bell24h`** (`prj_4LwLtrACRqyo3YTNojIYTBh3sr1K`, framework
  `nextjs`), **is live**: `latestDeployment.readyState: "READY"`, `target: "production"`,
  domains include `bell24h.com`, `vyaparsethu.com`, `www.vyaparsethu.com`. Per this
  repo's own `.claude/skills/bell24h-verify/SKILL.md` trap #2, a Next.js project
  deployed to `bell24h.com`/`vyaparsethu.com` is **the other, unrelated VyaparSethu
  codebase**, not this one. Its live status says nothing about this repo's exposure.
- The founder's separately-reported "Ready" deployment lives under a different team
  (`vvishaal-penharkarbell24s-projects`) that still returns `403 Forbidden` to this
  tool's access — re-tried this checkpoint, same result as AA-01, no change.

**Net: within this tool's reachable Vercel access, `digitex-erp-bell24h-os` (this repo)
has zero deployments and is not live.** Whether the founder's separately-reported
deployment under the inaccessible team is this same codebase remains **UNKNOWN** —
neither confirmed nor refuted, not inferred either way.

**Key rotation required:** **Founder decision, pending the SQL check below.** The write
path could only have exposed a key if an organization actually typed a real one into the
form. That fact is not visible from source. Run this (read-only, returns presence/length
only, never the key itself) and paste the result back:

```sql
SELECT organization_id, provider_id, status,
       (api_key IS NOT NULL AND length(trim(api_key)) > 0) AS has_key,
       length(api_key) AS key_length
FROM public.ai_providers
ORDER BY organization_id, provider_id;
```

If any row shows `has_key = true`, treat that key as compromised and rotate it —
`docs/architecture/MASTER_DATA_OWNERSHIP.md:69-71` already recommends exactly this,
independent of BR-01.

**Key rotation completed:** Not applicable yet — pending the query above.

**Post-fix runtime verification (P0-E): NOT PERFORMED against the deployed app — still
requires founder browser action against the actual deployed URL.** A local, lower-tier
check was attempted: `npx vite --port 5199 --strictPort` against this working tree,
navigating to `/ai-providers`. Result: correctly redirected to `/auth` (`ProtectedRoute`
enforcing as expected — consistent with prior audits). Going further to actually render
the disabled API Key field would have required the dev-only `AUTH_BYPASS` flag
(`VITE_AUTH_BYPASS=true` in `.env`, gated to dev builds only, no real credentials
involved) — both that `.env` edit and stopping the resulting dev server afterward were
blocked by this session's permission classifier. **The dev server on `localhost:5199`
was left running** (harmless — local-only, static SPA, no secrets); stop it manually
(`Ctrl+C` in its terminal, or find and end the `node`/`vite` process on port 5199) if
not wanted. The code-level evidence for the fix remains what §6 states: `npx tsc
--noEmit` clean, and the diff itself (§6) is small enough to read directly. Procedure
for the founder's own deployed-environment check (per the mission brief, unchanged):

1. Open the deployed Bell24h-OS URL → DevTools → Network.
2. Open **AI Providers**, add/edit a provider entry, confirm the **API Key** field is
   now disabled and the request body sent on save contains no `api_key` field.
3. Confirm no request to `generativelanguage.googleapis.com`, `api.openai.com`,
   `api.anthropic.com`, or any other provider domain originates from the page itself.
4. Report back only `EXPOSED = YES/NO`, provider, and location if any — never the key
   value.

**Checkpoint update (2026-08-10) — P0-B = BLOCKED, not classified as PASS/FAIL/SAFE.**
An attempt to exercise the actual runtime reported: Supabase requests returning
HTTP 500, AI Studio endpoints returning HTTP 404, no successful AI provider request
triggerable, and available browser automation insufficient to reliably inspect the
actual provider request payload. **This is recorded as-is, not independently
re-executed by this session.** Per the evidence standard: a failed test path is not
evidence of safety, and it is not evidence of exposure either — it is evidence that no
runtime test currently completes. P0-B remains **UNKNOWN/BLOCKED** until a working test
path exists. Do not read the 500s/404s as "the vulnerability is gone because nothing
works" — an environment that cannot serve any request cannot certify anything about
what it would do if it could.

---

## 2. AI Architecture Status

| Module | Direct Provider Call | Server API | AI Provider Manager | Credential Safe | Status |
|---|---|---|---|---|---|
| AI Providers | Yes (`AiProviderService.ts`) | No | No | **Yes**, as of this sprint's write-path fix (read path already safe) | PARTIAL |
| Prompt Studio | Yes (`AIManagerService.generate()`) | No | No | Yes (never receives a key) | PARTIAL — generation itself still fails |
| Content Planner | Yes | No | No | Yes | PARTIAL — generation never completes (see §3) |
| Image Studio | Yes | No | No | Yes | PARTIAL — generation never completes |
| Video Studio | Yes | No | No | Yes | PARTIAL — generation never completes |
| Job Orchestrator | Yes, via `JobOrchestratorService.processJob` | No | No | Yes | PARTIAL — worker that would run this is disabled (BLOCKED, §3) |
| Knowledge Vault (`/api/vault/ai-summary`, `/api/vault/mentor-advice`) | No | **Yes** | **Yes** | Yes | Correct, architecturally compliant — the only module already built this way |

**Not touched this sprint (explicit, founder-approved scope decision):** moving the 6
non-compliant modules' generation calls onto the server-side AI Provider Manager. That
Manager currently supports one provider (Gemini) and one modality (text) —
`server/ai/ProviderManager.ts`/`ProviderRouter.ts`. Building parity for 8 providers × 3
modalities across 6 modules is a feature build, not a stabilization fix, and was
explicitly declined as in-scope for BR-01 by the founder (recorded decision: "Minimal
fix only"). Recommended as its own decision gate — see §8.

---

## 3. JobWorker Status

**P1-A — full static trace (UI → API → DB → queue → worker → provider → storage →
result → UI), no runtime activation, no code changes:**

| Stage | Evidence | Reached today? |
|---|---|---|
| **UI** | `ContentPlannerPage.tsx` / `ImageStudioPage.tsx` / `VideoStudioPage.tsx` call `JobOrchestratorService.enqueueJob(...)` | Yes |
| **API** | **None exists in this flow.** `enqueueJob` (`JobOrchestratorService.ts:28-45`) writes directly from the browser via `supabase.from('job_queue').insert(...)` — no server route is involved at all. Confirmed: `server.ts` has zero references to `job_queue`, `JobWorker`, or `JobOrchestrator`. | N/A — step doesn't exist for this flow |
| **Database / Job Queue** | `job_queue` row created with `status: 'queued'`; `job_dependencies` populated if the job has deps | Yes |
| **JobWorker** | `JobWorker.getInstance().start()` — the only consumer of `job_queue` in the repo — is never called; import + call both commented out, `src/main.tsx:7,9`. Confirmed exhaustively: `job_queue` is referenced in exactly 3 files repo-wide (`JobOrchestratorPage.tsx` — read-only dashboard poll; `JobOrchestratorService.ts` — creates; `JobWorker.ts` — the disabled consumer). No other consumer exists anywhere. | **No — dead end here** |
| **Provider** | Would call `AIManagerService.generate/generateImage/generateVideo` (`JobOrchestratorService.ts:66,74-81`) → the client-side `AiProviderService.ts` path, which throws `"API key is missing"` before any network call, per §1 | Not reached (blocked upstream); independently would fail if reached |
| **Storage** | Would upload to Supabase Storage (`image_assets`/`video_assets` buckets, `AiProviderService.ts:579-593,644-657`) | Not reached |
| **Completion** | `processJob` would set `status: 'completed'` or route to `handleFailure` → `status: 'retrying'/'failed'` + a `job_logs` row (`JobOrchestratorService.ts:87-109`) | Not reached — job sits at `queued` forever, **with no `job_logs` entry explaining why**, since `handleFailure` itself never runs |
| **UI (result)** | `JobOrchestratorPage.tsx` polls `job_queue` every 5s and would display the status | Displays `queued` indefinitely; no error surfaced to the user — a silent-failure UX gap in its own right |

**Modules depending on JobWorker:** Content Planner (`job_type: 'content'`), SEO
(`job_type: 'seo'`, same code path), Image Studio (`'image'`), Video Studio
(`'video'`) — per the `switch` in `JobOrchestratorService.ts:72-84`. All four enqueue
successfully and then stop dead at the same point.

**Additional downstream blocker found (beyond "disabled"):** even granting reactivation,
the provider step fails independently and unconditionally (§1) — two separate blockers
stacked, not one.

| Module | Queue | Worker | Provider | Storage | Completion | Status |
|---|---|---|---|---|---|---|
| Content Planner | Real (`job_queue`, real enqueue/dependency/retry logic) | **Disabled** — import + `.start()` commented out, `src/main.tsx:7,9` | Would hit the dead client-side path if it ran | N/A — never reached | Never | **BLOCKED** |
| Image Studio | Real | Disabled (same worker) | Same | N/A | Never | **BLOCKED** |
| Video Studio | Real | Disabled (same worker) | Same | N/A | Never | **BLOCKED** |

**P1-B — why it was disabled:** Git history traced precisely. `4998871` ("feat:
implement creative studios and job orchestrator") introduced `JobWorker` live and
running. The very next commit, `943d55e` ("chore: implement runtime diagnostics and
error boundary"), disabled it — bundled into an unrelated diagnostics/error-boundary
change, with **no comment or commit-message reason given** for the disable specifically.
No incident report, no failure log, nothing else in the repo explains it.

**P1-C/D — reactivation was not attempted. Two independent, load-bearing reasons:**

1. **`JobWorker` is not a backend worker.** It is instantiated in `src/main.tsx`, the
   Vite SPA's browser entry point — a `setInterval` poller that only runs while some
   user's tab is open, using an unlocked `select` → separate `update` claim (two open
   tabs can grab the same job; no atomicity).
2. **Even reactivated, every job would fail immediately, not queue successfully.**
   `JobOrchestratorService.processJob` calls `AIManagerService.generate/generateImage/
   generateVideo` (`JobOrchestratorService.ts:66,74-81`) — the exact client-side path
   confirmed dead in §1 (browser never has `api_key`). Uncommenting the two lines in
   `main.tsx` changes the failure mode from "stuck at `queued` forever" to "fails at
   `running` every time" — not a real unblock, and indistinguishable from success to a
   user watching a spinner unless someone reads the `job_logs` table.

**P1-E — marking BLOCKED, not forced.** Per the evidence standard, "cannot safely
reactivate" with a stated, evidenced reason is a legitimate outcome. Forcing it would
produce a queue that appears to run and always fails — worse than the current honest
`queued` state, and would misrepresent the sprint's own P0 credential fix (a
"reactivated" worker is the most direct route back to exercising the exact client-side
provider-call path §1 just closed the write side of).

**Blocking dependency:** a real server-side job execution path does not exist yet — the
same gap named in §2. Resolving JobWorker and resolving the AI Provider Manager parity
gap are the same piece of work, not two separate fixes.

**Safest next action:** leave `JobWorker` disabled as-is (unchanged this sprint). Decide
JobWorker's fate in the same decision gate as AI Provider Manager parity (§8) — building
one without the other does not produce a working system.

---

## 4. Reality → Target Gap Map

Path: `docs/architecture/REALITY_TO_TARGET_GAP_MAP.md` — 27 capability rows, documentation
only, no architectural decisions made. Notable corrections surfaced while building it:

- The brief's assumed VyaparSethu stack ("Neon/PostgreSQL + Prisma") does not match this
  repo's own prior documentation, which states **INSFORGE** + MSG91 auth. Neither claim
  was independently re-verified against the VyaparSethu codebase (out of reach). Reported
  as a discrepancy, not resolved either way.
- Several capabilities (Trust/Verification, Communication, Agent Policy's policy layer,
  CRM's owning layer) have **no ADR at all**, not merely an unbuilt one — marked
  `UNDECIDED`, not inferred.

**Provenance note:** the gap map's Target Owner column leans heavily on
`docs/architecture/CANONICAL_ARCHITECTURE.md`, `MASTER_MODULES.md`, and
`MASTER_DATA_OWNERSHIP.md`. Those files self-report as **frozen PS-02 output
(2026-08-04)** and were treated as authoritative on that basis — but, like `server.ts`'s
pre-existing diff (`BR-01-PHASE0-BASELINE.md`), **they are untracked in git and were not
authored, reviewed, or committed by BR-01.** "Untracked" here reflects this repo's
working style, not draft/provisional status — but the founder should know BR-01 is
citing them, not vouching for them independently.

---

## 5. Remaining Critical Risks

Evidence-supported only:

1. **Knowledge Vault has no tenant boundary at all** (no `organization_id` on 5 tables,
   `USING (true)` RLS policy, pooled connection bypasses RLS regardless). Pre-existing,
   not touched by BR-01, already logged as `ADR-010` contested. Any authenticated user of
   any organization can read every row today.
2. **Public deployment reachability is still UNKNOWN** (§1). Until resolved, "is this
   exploitable by an outsider" cannot be answered — only "is this exploitable by an
   insider of a configured org," which is answered (yes, until the SQL check + any
   needed rotation completes).
3. **No server-side job execution path exists.** Content Planner, Image Studio, and
   Video Studio cannot complete generation end-to-end regardless of the credential fix —
   this is a functional gap, not just a security one.
4. **`ai_providers.api_key` column itself is unrevoked.** BR-01 stopped the browser from
   *writing* new plaintext keys; it did not `REVOKE` client read/write grants on the
   column or migrate existing values to server-side secret storage. That remains open,
   already logged in `MASTER_DATA_OWNERSHIP.md:67-71,138`.

---

## 6. Changes Made

| File | Why | What | Gate requirement satisfied |
|---|---|---|---|
| `src/pages/AiProvidersPage.tsx` | P0 write-path credential leak: raw `api_key` from the form was sent to a tenant-readable table any same-org authenticated member could read directly | Strip `api_key` from the insert/update payload (destructure it out before sending); disable the API Key input field; add an explanatory note pointing to the tracked follow-up tickets (`AA-01-002`/`AA-01-004`) | P0-D minimal remediation, founder-approved scope ("Minimal fix only") |
| `docs/project/BR-01-PHASE0-BASELINE.md` | Phase 0 requires a standalone evidence record before any change | New file — git baseline, pre-existing working-tree state, explicit non-attribution of pre-existing changes to BR-01 | Phase 0 |
| `docs/architecture/REALITY_TO_TARGET_GAP_MAP.md` | Required deliverable | New file — 27-row capability gap map | P1 Reality → Target Gap Map |
| `docs/project/BR-01-RECONCILIATION-REPORT.md` | Required deliverable | New file — this report | Final BR-01 report |

Verification performed on the code change: `npx tsc --noEmit` across the full project —
0 errors, before and after (the change introduces none). No runtime test was possible
without the founder's deployed-environment access (§1 P0-E).

---

## 7. Changes NOT Made

- No database merge.
- No database split.
- No SDK design.
- No API contract design.
- No VyaparSethu changes (no access to that codebase from this repo).
- No unrelated refactoring — `server.ts`'s pre-existing uncommitted diff was left
  untouched, as were all pre-existing untracked docs.
- No new features.
- No server-side AI Provider Manager expansion (multi-provider, multi-modality) —
  explicitly declined as out of BR-01 scope by founder decision.
- `JobWorker` was **not** reactivated, refactored, or otherwise modified — left exactly
  as found, per §3.
- No key rotation performed (no evidence yet that one is needed — pending §1's SQL
  check).

---

## 8. Recommended Next Decision Gates

Identification only, not implementation:

- **SEC-02 — Provider credential hardening.** `REVOKE` client grants on
  `ai_providers.api_key`; migrate any live keys found by §1's query to server-side
  secret storage; rotate anything found live.
- **JW-01 — Server-side job execution.** Replace the browser-resident `JobWorker` with
  an actual backend worker/cron process, and decide where its generation step calls out
  to (this is the same surface as PA-02 below — do not schedule them independently).
- **PA-02 — AI Provider Manager parity.** Decide whether/how to extend `server/ai/*` to
  cover the remaining 7 providers and image/video modalities, or scope down which
  modules are actually meant to support which providers. Blocks JW-01 and full closure
  of §2's PARTIAL rows.
- **ADR-010 resolution — Knowledge Vault tenancy.** Decide whether the 5 vault tables
  are platform-owned single-tenant content (as their current "public read" policy and
  ICECRAFT provenance suggest) or need real multi-tenant scoping, and handle the
  backfill-ownership hazard already logged in `MASTER_DATA_OWNERSHIP.md`.
- **DA-01 — Data ownership / system of record.** Whether Bell24h-OS's dormant
  marketplace schema (RFQ, Matching, Marketplace rows in the gap map) is retired,
  becomes the real system of record, or stays a mirror of a VyaparSethu-owned store —
  requires actual VyaparSethu codebase access to inform, which this repo does not have.
- **PA-01 — Bell24h-OS/VyaparSethu boundary.** Including resolving the Neon-vs-INSFORGE
  discrepancy surfaced in the gap map, and deciding the mechanism/timing for bringing
  VyaparSethu identity onto Bell24h-OS's L1, if that is even the intended direction.

---

## Queue Security Audit (2026-08-10) — read-only, no code changes

Triggered by the discovery in §3 that job submission has no server API boundary at
all — the browser writes to `public.job_queue` directly via the Supabase client. This
audit checks whether Postgres RLS is actually doing the enforcement work no API layer
is doing.

### Module trace

| Module | Client Write | Table | RLS | INSERT Policy | Fields Controlled by Client | Security Risk |
|---|---|---|---|---|---|---|
| Content Planner (`ContentPlannerPage.tsx:166-174`) | `JobOrchestratorService.enqueueJob(profile.organization_id, 'content', {topic, contentType, projectId, content_job_id})` | `public.job_queue` | **Enabled** | `WITH CHECK (organization_id = get_current_org_id())` | `job_type` (as literal `'content'` from this call site, but nothing stops a direct SDK call from sending any string — see below), `payload` (fully client-shaped JSON, no schema validation), `priority` (default `'medium'`, no allowlist enforced at DB) | MEDIUM — see findings below |
| Image Studio (`ImageStudioPage.tsx:156-164`) | Same call pattern; `payload = {prompt, negative_prompt, aspect_ratio, batch_size, model, ...}` | `public.job_queue` | Enabled | Same | Same, plus `model`/`providerId`-shaped fields land directly in `payload`, later read verbatim by `AIManagerService.generateImage` if a worker ever runs | MEDIUM |
| Video Studio (`VideoStudioPage.tsx:170-178`) | Same pattern; `payload = {prompt, negative_prompt, aspect_ratio, duration, frame_rate, ...}` | `public.job_queue` | Enabled | Same | Same | MEDIUM |

All three route through the same single chokepoint, `JobOrchestratorService.enqueueJob`
(`JobOrchestratorService.ts:28-45`), which does nothing beyond forwarding its arguments
into `supabase.from('job_queue').insert(...)` — no validation, no allowlist, no
server-side re-check of anything. Every finding below is about that chokepoint, not
about any one page.

### Answers to the 10 questions

1. **Which frontend modules can INSERT into `job_queue`?** Content Planner, Image
   Studio, Video Studio — all three via the same `enqueueJob` method. No server route
   sits in front of any of them (confirmed in §3: `server.ts` has zero references to
   `job_queue`).
2. **Which columns can they control?** All of: `organization_id` (attempted value only
   — see Q5), `job_type`, `payload` (arbitrary JSONB), `priority`. `status` is
   hardcoded to `'queued'` by the app's own `enqueueJob` call, but nothing at the DB
   enforces that if the app layer is bypassed (Q6).
3. **Does `job_queue` have RLS enabled?** **Yes** — `ALTER TABLE public.job_queue
   ENABLE ROW LEVEL SECURITY` (`supabase_schema.sql:1166`).
4. **What INSERT policy exists?** Exactly one: `CREATE POLICY "Org isolation insert"
   ON public.job_queue FOR INSERT WITH CHECK (organization_id =
   public.get_current_org_id())` (`supabase_schema.sql:1171`). `get_current_org_id()`
   is `SECURITY DEFINER`, resolves `organization_id` from `public.profiles` keyed on
   `auth.uid()` (`supabase_schema.sql:50-60`) — i.e. it is derived from the caller's
   verified JWT, not from any client-supplied value.
5. **Does the INSERT policy restrict `organization_id` correctly?** **Yes, verified
   correct.** Because `get_current_org_id()` re-derives the org server-side from the
   caller's own session rather than trusting the row being inserted, a forged
   `organization_id` argument to `enqueueJob` (e.g. calling it directly from DevTools
   with someone else's org id) would still be evaluated by Postgres against the
   caller's *real* org and rejected if they don't match. This is the one part of the
   boundary that holds regardless of what the JS layer sends.
6. **Can a browser client submit:**
   - **another `organization_id`?** **No** — blocked by Q5's `WITH CHECK`. Verified.
   - **arbitrary `job_type`?** **Yes** — `job_type TEXT NOT NULL` has no `CHECK`
     constraint at the DB level; the `'content'|'image'|'video'|...` union is a
     TypeScript-only constraint (`JobOrchestratorService.ts:4`), enforced at compile
     time, not runtime, and not at all if the Supabase client is called directly.
     Low practical impact today only because `processJob`'s `switch` has a `default:
     throw` for unrecognized types (`JobOrchestratorService.ts:83-84`) — but that's
     app-layer, not DB-layer, defense.
   - **arbitrary `priority`?** **Yes** — same gap, no `CHECK` constraint on
     `priority TEXT`.
   - **arbitrary provider information?** **Partially.** No provider *credential* can be
     injected this way — `AIManagerService.generateImage/generateVideo` resolve
     `config.api_key` from the org's own stored `ai_providers` rows, never from
     `job.payload` (confirmed by reading both call sites). But `payload.providerId` and
     `payload.model` are read verbatim and directly influence *which* provider/model a
     future worker would try first (`AiProviderService.ts` `generateImage`/
     `generateVideo` provider-sort logic) — a same-org actor can steer generation
     requests without any allowlist.
   - **arbitrary execution parameters?** **Yes** — `payload` is unconstrained `JSONB`
     with zero schema validation anywhere in the path from browser to (would-be)
     worker.
   - **arbitrary `status`?** **Yes, at the DB level** — no `CHECK` constraint restricts
     `status` values. The app's own `enqueueJob` always hardcodes `'queued'` on create,
     so this isn't reachable through the normal UI, only by calling the Supabase client
     directly with a fabricated payload (still same-org only, per Q5).
7. **Can the browser manipulate existing jobs with UPDATE/DELETE?**
   - **UPDATE: yes, but same-org only.** `FOR UPDATE USING (organization_id =
     get_current_org_id())` (`supabase_schema.sql:1172`) has no separate `WITH CHECK`,
     so Postgres reuses `USING` for both the visible-rows check and the new-row check —
     `organization_id` cannot be changed to another org (attempts are rejected), but
     **every other column is unrestricted**: any authenticated member of the *same* org
     can rewrite `status`, `payload`, `priority`, `job_type`, `retry_count`, or
     `max_retries` on any job in that org, including jobs created by a different
     teammate. There is no ownership check beyond organization membership (consistent
     with the "no server-side authorization primitive beyond org scope" gap already
     logged in `MASTER_MODULES.md:38`).
   - **DELETE: no.** No DELETE policy exists for `job_queue` at all
     (`supabase_schema.sql:1170-1172` lists only SELECT/INSERT/UPDATE). With RLS
     enabled and no matching policy, Postgres denies DELETE by default. Verified safe.
8. **Which role/user identity is used?** The browser Supabase client — anon key +
   the signed-in user's own JWT (`authenticated` Postgres role), per this repo's own
   `MASTER_DATA_OWNERSHIP.md:27-31` "Three access paths" table. Not the service role,
   not a pooled/admin connection.
9. **Does the queue contain secrets or provider credentials?** **No, by design of the
   current code** — nothing in `enqueueJob` or any of the three call sites writes an
   `api_key` or any other credential into `payload`. Because `payload` is unvalidated
   JSONB, nothing at the DB level would *stop* a client from writing an arbitrary
   string into it either — but there is no code path today that does, and doing so
   wouldn't leak anything beyond what that same org member already has.
10. **Does JobWorker trust queue fields supplied by the browser?** **Completely, with
    one additional defect found this pass.** `processNext()` does `select('*')` and
    passes the raw row straight into `processJob(job, job.created_by)`
    (`JobWorker.ts:31-43`) — `job.job_type` drives the `switch`, `job.payload` is
    passed verbatim into generation calls, `job.retry_count`/`job.max_retries` drive
    retry logic, all unrevalidated. **New finding:** `job.created_by` is read but
    **no `created_by` column exists anywhere in the `job_queue` schema**
    (`supabase_schema.sql:1132-1146`) — neither `JobOrchestratorService.enqueueJob`
    nor either INSERT call site ever writes one either. `job.created_by` would
    therefore be `undefined` at runtime. `processJob(job, undefined)` immediately
    fails the `profiles.select('organization_id').eq('id', userId).single()` lookup
    (`JobOrchestratorService.ts:47-56`) and throws `"User has no organization
    context"` before reaching any provider call. **This is a third, independent
    reason JobWorker cannot function even if reactivated**, on top of the two already
    documented in §3 (browser-resident/non-atomic; guaranteed-fail credential path).

### Finding

**MEDIUM**

Not HIGH/CRITICAL: the boundary that matters most — cross-tenant isolation on both
INSERT and UPDATE — holds, verified directly against the policy definitions and the
`SECURITY DEFINER` function they call, not inferred. No provider credential is
reachable through this table by any path. DELETE is correctly blocked by policy
absence.

Not LOW: within a single organization, there is **no field-level validation
anywhere in the path** — any authenticated org member (there is no role/permission
check narrower than "same org" anywhere in this repo, per `MASTER_MODULES.md:38`) can
fabricate `job_type`, `priority`, `status`, and arbitrary `payload` content including
which AI provider/model a job would target, and can rewrite any teammate's existing
job in the same org. This is currently inert only because JobWorker is disabled — the
moment any real consumer is built (JW-01/PA-02, §8), this gap becomes load-bearing and
should be closed *before*, not after, reactivation.

### Evidence

- `supabase_schema.sql:1132-1146` — `job_queue` table definition, no `CHECK`
  constraints on `status`, `job_type`, or `priority`.
- `supabase_schema.sql:1166-1172` — RLS enabled; exactly 3 policies (SELECT, INSERT,
  UPDATE), no DELETE policy.
- `supabase_schema.sql:50-60` — `get_current_org_id()`, `SECURITY DEFINER`, keyed on
  `auth.uid()`.
- `docs/architecture/MASTER_DATA_OWNERSHIP.md:27-31` — confirms browser access path is
  anon key + user JWT, RLS-enforced.
- `src/modules/job-orchestrator/JobOrchestratorService.ts:28-45` — `enqueueJob`, the
  single chokepoint, no validation.
- `src/modules/job-orchestrator/JobWorker.ts:31-44` — `processNext`, trusts the raw row
  entirely, including the non-existent `created_by` field.
- `src/pages/ContentPlannerPage.tsx:166-174`, `src/pages/ImageStudioPage.tsx:156-164`,
  `src/pages/VideoStudioPage.tsx:170-178` — the three call sites, identical pattern.

### Recommendation (documentation only — not implemented)

- Add DB-level `CHECK` constraints on `job_queue.status`, `job_queue.job_type`, and
  `job_queue.priority` restricting them to their known enum values — closes the
  same-org fabrication gap at the cheapest possible layer.
- Add a real `created_by UUID REFERENCES auth.users(id)` column, populated
  server-side (or at minimum client-side from `auth.uid()`, though a server path is
  preferable), so `JobWorker`/any future worker derives the acting identity from an
  actual column instead of a field that has never existed.
- Add an UPDATE `WITH CHECK` (not just `USING`) if any column-level restriction beyond
  organization membership is ever wanted (e.g. "only the creator or an admin may
  modify a job") — today any org member can rewrite any other member's job.
- Add a JSON-schema-level validation step (server-side, when JW-01/PA-02 build a real
  worker) before `payload` is ever passed to a provider call — never trust it as
  pre-validated just because it round-tripped through Postgres.
- All of the above belong to the JW-01/PA-02 decision gate already recommended in §8,
  not to a standalone fix — closing the field-validation gap without also solving the
  credential and worker-execution problems in §1/§3 doesn't produce a working, safe
  pipeline on its own.

---

## SQL Check Result

**PENDING — not yet run.** The founder has not yet executed or returned the result of
the read-only query from §1:

```sql
SELECT organization_id, provider_id, status,
       (api_key IS NOT NULL AND length(trim(api_key)) > 0) AS has_key,
       length(api_key) AS key_length
FROM public.ai_providers
ORDER BY organization_id, provider_id;
```

Per standing project convention, this query is generated for the founder to run
directly in the Supabase SQL Editor — it is not executed by this session, and no
database credentials have been requested. This section will be filled in once a result
is pasted back. Reminder (§1): a `has_key = false` result closes "is there something to
rotate right now," not "did the write-path bug ever transmit a key historically" — those
are different claims.

---

## BR-01 Final Status (2026-08-10)

```
P0 Static Remediation:     PARTIAL   (AiProvidersPage.tsx write-path fixed; re-verified)
P0-B Runtime Verification: BLOCKED   (Supabase 500s, AI Studio 404s reported; no working
                                       test path; not classified PASS/FAIL/SAFE)
P1 JobWorker:               BLOCKED   (disabled, not reactivated; 3 independent evidenced
                                       blockers: browser-resident/non-atomic worker,
                                       guaranteed-fail credential path, non-existent
                                       created_by column feeding an undefined userId)
Queue Security Audit:       COMPLETE  (Finding: MEDIUM — cross-tenant boundary holds;
                                       same-org field validation does not exist)
P2 Gap Map:                 COMPLETE  (28 rows, all checkpoint-minimum capabilities
                                       present)
SQL Check (live key scan):  PENDING   (founder has not yet run/returned it)
Vercel Deployment:          UNKNOWN   (digitex-erp-bell24h-os: 0 deployments in every
                                       team this tool can reach; founder-reported
                                       deployment sits behind a 403 team)
```

**BR-01: OPEN.**

---

## Outstanding founder actions before this report can close

1. Run the SQL query in §1 and paste back the result (no key values).
2. Perform the P0-E browser runtime check in §1 and report `EXPOSED = YES/NO` +
   location only — currently blocked by Supabase HTTP 500s / AI Studio HTTP 404s in
   whatever environment was last tested; needs a working test path first.
3. Confirm whether the "Ready" deployment previously reported under
   `vvishaal-penharkarbell24s-projects` (still `403` to this tool) is in fact this
   codebase — this tool can now positively confirm `digitex-erp-bell24h-os` has 0
   deployments in every Vercel team it *can* reach.

**STOP condition per BR-01 scope: no IS-01 work, no VyaparSethu work, no SDK/API design,
no database changes begin until this report is reviewed and approved.**

---

## Checkpoint — Final Classification (2026-08-10)

Read-only re-verification only; no files committed, no worker activated, no
architecture changed, no unrelated files touched this checkpoint (only
`AiProvidersPage.tsx` — pre-existing from the prior turn — and this report/gap-map
remain modified; `server.ts`'s pre-existing diff is still untouched).

| Item | Classification |
|---|---|
| P0 Static Security Remediation | **PARTIAL** — write-path defect fixed and re-verified (`tsc` clean, diff re-inspected, no key logging, field structurally cannot repopulate); full server-side provider migration explicitly out of scope this sprint |
| P0-B Runtime Security Verification | **BLOCKED** — no working test path (Supabase 500s, AI Studio 404s reported); not classified as PASS/FAIL/SAFE in either direction |
| P1 JobWorker | **BLOCKED** — not reactivated; two independent, evidenced blocking reasons (browser-resident non-atomic worker; guaranteed-fail provider step) |
| P2 Reality → Target Gap Map | **COMPLETE** — 28 rows, all 10 checkpoint-minimum capabilities present (including an added explicit "Trust Graph" row, distinguished from "Trust/Verification" and the generic L3 Knowledge Graph reservation) |
| Git State | **READY** (for review — not for commit/push). `main`, HEAD `2dd2356`, ahead of `origin/main` by 3, 2 modified files (1 BR-01, 1 pre-existing/unrelated), 11 untracked (2 new BR-01 reports + pre-existing docs) |
| Vercel Deployment | **UNKNOWN** (narrowed, not resolved) — `digitex-erp-bell24h-os` confirmed 0 deployments in every Vercel team this tool can reach; the founder's separately-reported live deployment sits in a team still returning `403` |
| **Overall BR-01** | **OPEN** |

BR-01 remains OPEN because P0-B runtime verification is blocked. Static remediation and
reconciliation work may be complete, but runtime security cannot be certified without a
functioning test path.

---

## BR-02 IMPLEMENTATION RESULTS (2026-08-10)

Preceded by OODA-03 (archive reconnaissance on `digitex-erp/bell24h`), which found no
evidence contradicting any prior conclusion and cleared BR-02 to proceed
(`G = YES`, no other repository's contents bear on Bell24h-OS's own runtime).

### Phase 1 — Supabase runtime failure

**"AI Studio 404s" — VERIFIED ROOT CAUSE, and it is correct behavior, not a defect.**
`/api/env/diagnostic` and `/api/migrate` are wrapped in `devOnly` middleware
(`server.ts:40-57`), which returns `404` (deliberately, not `403`) whenever
`NODE_ENV === "production"` — documented in its own code comment as intentional, to
avoid disclosing the route's existence. If these were hit against a
production-classified deployment, 404 is the designed response. **No code change
made or needed.**

**"Supabase 500s" — mechanism VERIFIED, live cause INFERRED, not independently
confirmed.** Every route using `getPool()` (`/api/check-table`,
`/api/check-users-count`, all 7 `/api/vault/*` routes) throws and returns exactly
`HTTP 500` with `{error: err.message}` if `DATABASE_URL` is unset
(`server.ts:102-119`). This is deterministic, fail-closed-by-design code — not a bug.
The most plausible explanation is `DATABASE_URL` (a server-only env var, never routed
through `vite.config.ts`'s client `define` block) isn't reaching the server process in
whatever hosting environment produced these 500s. **This cannot be confirmed without
live access this session doesn't have** — and, notably, the one route built to answer
this exact question (`/api/env/diagnostic`) is itself gated by the same `devOnly`
middleware that 404s under the same conditions, so it can't self-diagnose here either.
**No code change made** — the current fail-closed behavior is already correct; the
likely fix is a configuration action (setting `DATABASE_URL` in the actual hosting
environment's secrets), not a code change.

### Phase 2 — AI security boundary, full-repo re-scan

Searched all of `src/` for direct provider URLs (`generativelanguage.googleapis.com`,
`api.openai.com`, `api.anthropic.com`, `api.groq.com`, `api.perplexity.ai`, and the 5
OpenAI-compatible endpoints `AiProviderService.ts` defines) and for any client-side
provider SDK import (`openai`, `@anthropic-ai/sdk`, `@google/generative-ai`,
`@google/genai`, `groq-sdk`).

**Result: `AiProviderService.ts` remains the only client-side file with direct
provider URLs** — same finding as BR-01, nothing new. No provider SDK is imported
client-side anywhere (`@google/genai` is imported exactly once, server-side only, in
`server/ai/GeminiProvider.ts`). Every other `fetch()`/`axios` call site found in
`src/` (`FounderMemory.tsx`, `FounderTimeline.tsx`, `PhaseUnlockEngine.tsx`,
`RdLibrary.tsx`, `VaultDocuments.tsx`, `KnowledgeVaultPage.tsx`,
`SystemDiagnosticsPage.tsx`) calls this app's own relative `/api/vault/...` routes
(spot-checked directly), not an external provider. **No new exposure found. No code
change needed.**

### Phase 3 — JobWorker root-cause

Unchanged from BR-01/OODA-01, re-confirmed this pass: three independent blockers
(browser-resident/non-atomic worker; guaranteed-fail credential path;
`job.created_by` read but no such column exists, so `processJob(job, undefined)`
fails immediately). **JobWorker was not uncommented, not reactivated, not otherwise
modified** — per this sprint's own instruction ("Do NOT simply uncomment JobWorker")
and because a schema-dependent fix (below) hasn't been applied to a live database yet,
so any code change here would be dead code exercising nothing.

**The one schema-level correction that would matter is a migration, not a code
change, and is not applied — provided below for you to run when ready:**

```sql
-- BR-02: adds the column JobWorker.ts already reads but that has never existed.
-- WHY: JobWorker.ts:43 reads job.created_by; JobOrchestratorService.ts's enqueueJob
--      never writes it (nor does any of the 3 call sites). processJob(job, undefined)
--      fails immediately on the profile lookup — this is blocker #3 of 3 documented
--      in BR-01/OODA-01. Nullable, so this migration cannot break any existing row
--      or any current INSERT (none of them set it, and none would be required to).
-- CURRENT SCHEMA: public.job_queue has no created_by column at all
--      (supabase_schema.sql:1132-1146).
-- MINIMAL CHANGE: add exactly one nullable column, no default, no backfill of
--      existing rows (there is no reliable source to backfill from).
-- RISK: low — additive, nullable, no existing code path is broken by its absence
--      continuing (JobWorker stays disabled regardless) or its presence (nothing
--      currently writes to it, so nothing changes until enqueueJob is separately
--      updated to populate it — a follow-up code change, not included here, and not
--      safe to make blind against an unmigrated database).
ALTER TABLE public.job_queue
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);
```

**Also documented, also not applied — the field-validation gap from the BR-01 queue
audit:**

```sql
-- WHY: no CHECK constraint restricts job_queue.status/job_type/priority; any
--      authenticated same-org member can write an arbitrary value to any of them
--      (BR-01 Queue Security Audit, MEDIUM finding). Inert today only because
--      JobWorker has no live consumer to be confused by a fabricated value.
-- CURRENT SCHEMA: status TEXT NOT NULL DEFAULT 'queued', job_type TEXT NOT NULL,
--      priority TEXT DEFAULT 'medium' — all three unconstrained.
-- MINIMAL CHANGE: three CHECK constraints matching the values the application code
--      itself already uses as its only intended vocabulary
--      (JobOrchestratorService.ts:5,13).
-- RISK: low-medium — if any existing row already holds a value outside these lists
--      (unverified — this session cannot query the live table), the ALTER TABLE
--      will fail until that row is corrected first. Run the SELECT below before the
--      ALTER to check.
SELECT DISTINCT status FROM public.job_queue WHERE status NOT IN
  ('queued','scheduled','preparing','running','paused','retrying','completed','cancelled','failed');
SELECT DISTINCT job_type FROM public.job_queue WHERE job_type NOT IN
  ('content','image','video','voice','publishing','seo','automation','analytics');
SELECT DISTINCT priority FROM public.job_queue WHERE priority NOT IN
  ('critical','high','medium','low');

-- Only if both SELECTs above return zero rows:
ALTER TABLE public.job_queue
  ADD CONSTRAINT job_queue_status_check CHECK (status IN
    ('queued','scheduled','preparing','running','paused','retrying','completed','cancelled','failed'));
ALTER TABLE public.job_queue
  ADD CONSTRAINT job_queue_job_type_check CHECK (job_type IN
    ('content','image','video','voice','publishing','seo','automation','analytics'));
ALTER TABLE public.job_queue
  ADD CONSTRAINT job_queue_priority_check CHECK (priority IN
    ('critical','high','medium','low'));
```

**Neither migration was run.** No database credentials were used or requested, per
standing project convention — these are provided for you to run and paste results
back from, the same pattern as every other SQL check in this sprint sequence.

### Phase 4 — Queue security

Cross-tenant boundary re-confirmed intact, unchanged (RLS `WITH CHECK` re-derives
`organization_id` from `get_current_org_id()` server-side; not weakened, not touched).
The two `CHECK`-constraint corrections above are the minimum required to close the
same-org field-validation gap; nothing further was found necessary or safe to add
without exceeding "smallest correction."

### Phase 5 — End-to-end runtime test

**BLOCKED for all three modules.** No live, credentialed Bell24h-OS environment is
reachable this session (0 Vercel deployments confirmed in OODA-01 §5; local dev-server
testing requires the `AUTH_BYPASS` flag, and both the `.env` edit to set it and the
subsequent server-process cleanup were blocked by this session's permission classifier
in the prior BR-01 checkpoint). No provider response was fabricated.

```
Content Planner:  BLOCKED — no reachable environment to submit a job in
Image Studio:     BLOCKED — same
Video Studio:     BLOCKED — same
```

### Phase 6 — Security verification

```
RAW PROVIDER CREDENTIAL VISIBLE:  UNKNOWN / BLOCKED
```

No network inspection was possible without a reachable runtime (Phase 5). Not claimed
secure on the basis of static code alone, per this sprint's own explicit instruction.

### Phase 7 — Legacy repository boundary

"`digitex-erp/bell24h` remains a read-only reference repository. Potential extraction
candidates are deferred until separate component-level review." Nothing was imported,
copied, submoduled, or added as a dependency this sprint.

### Phase 8 — InsForge decision

Not installed, not integrated. Bell24h-OS remains on Supabase, its currently verified
architecture. No substitution authorized or performed.

### Phase 9 — VyaparSethu boundary

Not connected. No SDK/API contract created. No DNS change. No domain move. No
repository merge.

### BR-02 Summary Table

```
P0 Security Boundary:          PASS  (full-repo re-scan found no new client-side
                                       exposure; BR-01's fix re-verified unchanged)
Supabase Runtime:               BLOCKED (mechanism verified; live root cause requires
                                       environment access this session lacks)
JobWorker:                      BLOCKED (created_by mismatch NOT removed — the fix is
                                       a documented, unapplied migration; JobWorker
                                       remains disabled and unmodified)
Queue Security:                 BLOCKED (validation gap documented with exact,
                                       unapplied migration; cross-tenant boundary
                                       intact/unweakened)
Content Planner:                BLOCKED (no reachable runtime)
Image Studio:                   BLOCKED (no reachable runtime)
Video Studio:                   BLOCKED (no reachable runtime)
Runtime Credential Exposure:    UNKNOWN
```

**Success criteria honestly scored:** #2 (no new client-side secret) — met. #4 (tenant
isolation intact) — met. #6/#7/#8/#9 (no legacy import, no InsForge, no VyaparSethu
connection, no architecture migration) — met. #1 (Supabase root cause fixed or proven
externally blocked) — proven blocked, not fixed; the fix is a configuration action
outside this session's reach. #3 (`created_by` mismatch no longer present) — **not
met**; a correct, minimal, unapplied migration is provided instead of a live fix. #5
(at least one real end-to-end job completes, or a precise blocker is documented) — the
blocker is documented precisely (Phase 5); no job completed.

**Current HEAD:** `2dd23563b49640330a9673ad11b2fbc20eeb6f79`
**Branch:** `main`
**Files changed:** 0 this sprint (`server.ts`, `AiProvidersPage.tsx` — both pre-existing
from before BR-02, untouched this pass)
**Files added:** 0 (this report was edited in place, not newly created)
**Files deleted:** 0
**Unrelated changes:** preserved exactly, none touched
**TypeScript status:** not re-run this pass — no source file was edited, so no new
result to check
**Tests:** none run — no reachable environment (Phase 5)
**Runtime status:** unreachable, same as BR-01

```
BR-02 STATUS:
BLOCKED
```

Blocked on two things only the founder can supply: (1) access to whatever runtime
environment produced the reported 500s/404s, to confirm the `DATABASE_URL` inference
in Phase 1 and complete Phase 5/6; (2) a decision on whether to run the two migrations
above — until then, `created_by` stays missing and the field-validation gap stays
open, both by design of this sprint's own "founder runs schema changes" boundary, not
by oversight.
