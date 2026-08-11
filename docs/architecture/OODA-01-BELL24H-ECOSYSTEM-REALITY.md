# OODA-01 — Bell24h Ecosystem Reality & Architecture Reconnaissance

**Sprint type:** Reconnaissance only. No implementation. ACT phase locked.
**Date:** 2026-08-10
**Scope:** Read-only observation across Bell24h-OS (this repo), live domain evidence
for bell24h.com/vyaparsethu.com, and GitHub/Vercel API evidence reachable from this
session's tool access. VyaparSethu's and Admin/Outreach's actual source code were
**not** accessible from this session — findings about them are runtime-observed
(live site, headers, Vercel deployment metadata) or drawn from this repo's own prior
documentation, never from reading their code directly.

---

## 1. Executive Ground Truth

- **Bell24h-OS** (this repo, `digitex-erp/digitex-erp-bell24h-os`) is a Vite/React SPA
  + thin Express backend, backed by Supabase/Postgres. **It has never been deployed** —
  0 Vercel deployments in every team this session can reach. It is not the application
  running at bell24h.com.
- **bell24h.com, www.bell24h.com, vyaparsethu.com all resolve, live, to
  `www.vyaparsethu.com`** (verified by direct HTTP request this session — see §5).
  This is one Next.js application on Vercel, not four.
- **That live application's actual source repository is `github.com/bell24xcom/forBell24x`
  (public, org `bell24xcom`), branch `main`** — verified directly from Vercel deployment
  metadata. This is a **new finding**: nowhere in this repo's prior documentation
  (`PROJECT_CONTINUITY_REPORT.md`, `MASTER_CONTEXT/KERNEL_ARCHITECTURE.md`) is this
  GitHub org or repo name recorded. Those docs only ever named a local path
  (`C:/Users/Sanika/Projects/bell24h`). Whether that local path and `bell24xcom/forBell24x`
  are the same codebase, a fork, or something else entirely is **UNKNOWN** — not
  something this session can resolve without access to that path or repo.
- **Bell24h-OS and the live VyaparSethu are confirmed, evidenced, separate codebases**
  with no shared code, no shared repo, and (per this repo's side) no code-level
  reference to the other beyond documentation prose.
- **No trace of InsForge, blockchain, or any Admin/Outreach/CRM/scraping/enrichment
  infrastructure exists anywhere in Bell24h-OS's actual code.** Every mention found is
  either documentation describing the *other* application, or a UI label string with no
  behavior behind it.
- **An unused `prisma`/`@prisma/client` dependency sits in Bell24h-OS's
  `package.json`** with no `.prisma` schema file and zero imports anywhere in `src/` or
  `server/` — dead weight, not evidence of a Prisma-backed data layer in this repo.
- **BR-01's findings (client-side AI credential handling, disabled JobWorker, missing
  `created_by` column, queue field-validation gap) were re-checked against current code
  this session and remain unchanged** — HEAD is identical to BR-01's baseline
  (`2dd2356`), so no drift occurred between sprints.

---

## 2. Evidence Hierarchy Applied

Per the mission's stated hierarchy (runtime > code > database/schema-file > deployment
config > git history > docs > historical docs), this document labels every "database"
claim about Bell24h-OS as **schema-file-level evidence** (`supabase_schema.sql` in this
repo), not live-queried — this session has no database credentials and, per standing
project convention, does not request them. Where a claim rests only on a schema file,
it is marked `INFERRED`, never `VERIFIED`, even where the file is internally consistent.
The one place genuine tier-1 runtime evidence exists in this document is §5
(bell24h.com/vyaparsethu.com), obtained via direct HTTP requests this session, and the
Vercel deployment API queries in §5/§14.

---

## 3. Bell24h-OS Current State

**Repository:** `digitex-erp/digitex-erp-bell24h-os` · branch `main` · HEAD `2dd2356`
· 3 commits ahead of `origin/main`, unpushed · never deployed (§5).

**Stack:** Vite 6 + React 19 SPA (`src/`) + a single Express server (`server.ts`, 14
routes) + Supabase (Postgres, Auth, Storage) + a thin server-side AI layer
(`server/ai/*`). **Not Next.js.** `npm run dev` runs `tsx server.ts`, which mounts both
the API and Vite middleware on one process/port.

| Layer | Status | Evidence |
|---|---|---|
| Frontend (25 pages, SPA routing) | VERIFIED | `src/App.tsx`, `src/pages/*` |
| Backend API | PARTIALLY IMPLEMENTED — 14 routes total, only Knowledge Vault (7 routes) has real CRUD; rest of the app is Supabase-direct from the browser | `server.ts` |
| Services layer (`src/modules/*`) | PARTIALLY IMPLEMENTED — several are stubs (`CrmService`, `AdminService`, `SettingsService`, `VoiceService`, `AgentService`, `DatabaseService`, `KnowledgeBaseService` all return empty/fabricated data) | direct read, this session |
| Workers/queues | DEAD / LEGACY — `JobWorker` disabled, see §10 | `src/main.tsx:7,9` |
| Storage | PARTIALLY IMPLEMENTED — 2 buckets defined (`image_assets`, `video_assets`); Knowledge Vault has no storage bucket of its own | `supabase_schema.sql` |
| Database layer | INFERRED (schema file) — Supabase JS client (browser + server, RLS-enforced) and a raw `pg` pool (`server.ts`, RLS-bypassing, used in 9 request handlers) coexist | `src/lib/supabase.ts`, `server.ts:102-119` |
| Authentication | PARTIALLY IMPLEMENTED — `requireAuth` middleware previously runtime-verified (RG-C: live 401s on 10/13 routes); full login flow is owner-reported `V1.0 STABLE`, not independently observed this session | `server/middleware/requireAuth.ts` |
| Authorization | PARTIALLY IMPLEMENTED — org-scoping exists via RLS + `get_current_org_id()`; **no role/permission primitive exists server-side** (`hasPermission`/`checkRole`/`authorize` → 0 hits repo-wide) | `MASTER_MODULES.md:38`, re-confirmed this session |
| AI infrastructure | PARTIALLY IMPLEMENTED — see §9 | — |
| Deployment configuration | VERIFIED (dead) — Vercel project `digitex-erp-bell24h-os` exists, `live: false`, `latestDeployment: null`, 0 deployments, 0 domains | Vercel API, this session |

**IS-00.1 through IS-00.5, AA-01, BR-01:** no separate numbered files for the IS-00.x
sprints were found in this repo; their outputs, if any, are not distinguishable from
the general schema/RLS-generator code already inspected (`_create_org_policy` helper
noted in git log, `supabase_schema.sql:62+`). AA-01 and BR-01 outputs
(`docs/project/AA-01-*.md`, `docs/project/BR-01-*.md`) were re-checked against current
code this session (§9, §10) — **no drift found**, HEAD is unchanged since BR-01.

---

## 4. VyaparSethu Current State

**This session has no access to VyaparSethu's source code.** Everything below is
either (a) live runtime evidence from the deployed site, or (b) prior documentation in
*this* repo describing VyaparSethu — never a direct code read.

| Aspect | Status | Evidence |
|---|---|---|
| Live and public | VERIFIED | Direct HTTP requests, this session (§5) |
| Framework | VERIFIED | `Vary: RSC, Next-Router-State-Tree, Next-Router-Prefetch` response headers (Next.js-specific) + Vercel project metadata (`framework: nextjs`) |
| Hosting | VERIFIED | `Server: Vercel` header; Vercel deployment API |
| Source repository | VERIFIED (newly established this session) | Vercel deployment metadata: `github.com/bell24xcom/forBell24x`, branch `main`, commit `5531e714...` |
| Relationship to the local path named in this repo's docs (`C:/Users/Sanika/Projects/bell24h`) | UNKNOWN | Not re-derivable without access to that path or the GitHub repo |
| Auth | INFERRED — MSG91 phone OTP, per this repo's own prior docs; corroborated by live CSP header allowing `api.msg91.com`/`control.msg91.com` connections | `KERNEL_ARCHITECTURE.md:576-577`; CSP header, this session |
| Database | UNKNOWN — this repo's prior docs claim "INSFORGE + Prisma" in one place and the BR-01 mission brief separately assumed "Neon + Prisma"; **neither has been independently verified against VyaparSethu's actual code or database this session** | Conflicting documentation only — flagged, not resolved, in BR-01 and again here |
| Payments | INFERRED — live | CSP `connect-src` allows `api.razorpay.com`, `checkout.razorpay.com` |
| AI provider calls | UNKNOWN, worth flagging | CSP `connect-src` on the live site explicitly allows browser connections to `api.groq.com`, `api.openai.com`, and `*.nvidia.com`. This is the *same shape* of finding BR-01 investigated in Bell24h-OS (client-reachable provider domains) — but this session did not, and should not without explicit scope, attempt to trigger a generation request on a live third-party-adjacent production site to see whether a key is actually sent. Recorded as a candidate for a dedicated, explicitly-scoped security review of VyaparSethu, not investigated further here. |
| RFQs, buyers, suppliers, quotes, deals, matching, trust, verification, escrow, marketplace, search, SEO, analytics, communication, admin, CRM | UNKNOWN | No code access; the live site's commit history (visible via Vercel deployment metadata) shows active work on `/suppliers`, `/supplier/[id]`, `/industrial-cluster`, `/learn` — consistent with a real marketplace/supplier-directory product, but this is inference from routing/SEO commit messages, not a feature inventory |

**Do not read "UNKNOWN" above as "doesn't exist."** It means this session has no
admissible evidence either way — a materially different claim from Bell24h-OS's many
`VERIFIED ABSENT` findings, which come from direct code search in a repo this session
can actually read.

---

## 5. Bell24h.com / DNS / Deployment Current State

Direct HTTP requests, this session (tier-1 runtime evidence):

| Domain | HTTP | Redirects to | Redirect count |
|---|---|---|---|
| `bell24h.com` | 200 | `https://www.vyaparsethu.com/` | 1 |
| `www.bell24h.com` | 200 | `https://www.vyaparsethu.com/` | 1 |
| `vyaparsethu.com` | 200 | `https://www.vyaparsethu.com/` | 1 |
| `www.vyaparsethu.com` | 200 | (canonical — serves directly) | 0 |

Vercel project `bell24h` (`prj_4LwLtrACRqyo3YTNojIYTBh3sr1K`) has all four as attached
domain aliases on the same deployment (`dpl_HirbeezksrAY967NM2DTucZMpzab`, `READY`,
`target: production`, created from `github.com/bell24xcom/forBell24x@main`).

**Conclusion: `bell24h.com` is not a separate application.** It is a domain alias in
front of the single VyaparSethu Next.js deployment. There is no evidence of any
application logic, redirect rule, or gateway specific to the `bell24h.com` hostname
distinct from `vyaparsethu.com` — DNS/Vercel alias only, exactly the kind of
domain-implies-architecture inference the mission brief warned against, now
**checked and found to be just an alias, not a separate app.**

`digitex-erp-bell24h-os` (this repo's Vercel project) has **zero** domains and zero
deployments — it has never served the `bell24h.com` traffic or any other traffic.

---

## 6. Admin/Outreach Current State

**No Admin/Outreach/CRM/scraping/enrichment/campaign-automation infrastructure exists
anywhere in Bell24h-OS's actual code.** Direct search this session:

| Capability | Finding | Evidence |
|---|---|---|
| CRM | DEAD / LEGACY — `CrmService.ts` stub, `getCustomers()` → `[]`, no page, no route, unconnected to its own `companies`/`contacts` tables | `MASTER_MODULES.md:156`, re-confirmed |
| Supplier scraping | NOT FOUND — zero hits for "scrap" (case-insensitive) anywhere in `src/`/`server/` | direct search, this session |
| Supplier enrichment | NOT FOUND — the one "enrich" hit (`TeamPage.tsx:78`) is a local variable name for client-side data joining, unrelated to lead/data enrichment | direct search, this session |
| Email/WhatsApp/SMS | NOT FOUND as infrastructure — the only hits are UI dropdown label strings in `PromptStudioPage.tsx:59` ("WhatsApp", "Email" as content-type options), no send capability behind them | direct search, this session |
| Campaigns | PARTIALLY IMPLEMENTED — `CampaignManagerService.ts` + `campaigns`/`campaign_assets` tables exist with real CRUD (Create/Read, no Update/Delete), but it's an internal marketing-content campaign tracker, not an outreach/lead-gen system | `MASTER_MODULES.md:138` |
| Lead management, marketing automation, outreach | NOT FOUND | direct search, this session |
| Analytics | PARTIALLY IMPLEMENTED (see gap map) — no dedicated module; closest analog `PerformanceDashboardPage` has fabricated trend data mixed with live counts | `AA-01-IMPLEMENTATION-AUDIT.md:96` |

**Ownership classification: none of the above are Bell24h-OS capabilities today** —
they are either absent, or (Campaigns) a thin, unrelated internal feature. Whether
VyaparSethu or a separate internal system owns real Admin/Outreach infrastructure is
**UNKNOWN** — no code access (§4).

---

## 7. Database Reality

**Bell24h-OS — schema-file evidence only (`supabase_schema.sql`), not live-queried:**

| Metric | Value | Note |
|---|---|---|
| Tables (`CREATE TABLE` statements) | **127** | Not "124" as previously reported elsewhere — recounted directly this session. All ~20 `add_*.sql` incremental migration files in the repo root are spot-checked as already folded into `supabase_schema.sql` (e.g. all 12 tables from `add_automation_platform.sql` present) — they are historical migration scripts, not additive |
| Schemas | 1 (`public`) | No `CREATE SCHEMA` statements found |
| Extensions | 1 (`uuid-ossp`) | No `pgvector`, no other extensions |
| Functions | 3 | Includes `get_current_org_id()` (`SECURITY DEFINER`, keyed on `auth.uid()`) and the reusable RLS-policy-generator helper |
| Triggers | 1 | Very little schema-level business logic — consistent with the "logic lives in the app" pattern found throughout |
| Storage buckets | 2 (`image_assets`, `video_assets`) | Knowledge Vault, Media Composer, and other modules referencing storage have no bucket of their own in this file |
| RLS | Enabled on tenant tables (INFERRED, schema-file) | Broad pattern via the `_create_org_policy` generator |
| Organization isolation | INFERRED (schema-file) — every INSERT/UPDATE policy checked this session and in BR-01 re-derives `organization_id` from `get_current_org_id()` server-side, not from client-supplied values | `supabase_schema.sql`, re-verified §10 |
| Cross-tenant enforcement (a *different* org actually denied) | **UNKNOWN** — never demonstrated with a live second-tenant test, per this repo's own `MASTER_DATA_OWNERSHIP.md:40-51` (`RV-007 DEFERRED`) | unchanged since BR-01 |
| Audit infrastructure | PARTIALLY IMPLEMENTED — `audit_logs` table exists, RLS-scoped, but is **never written** (0 INSERT call sites) | `MASTER_MODULES.md:39` |
| Migrations | No formal migration tool detected (no `supabase/migrations/` dir, no Prisma migrations) — schema managed as a flat `.sql` file plus incremental `add_*.sql` scripts | direct search |

**Prisma:** `@prisma/client` and `prisma` are both listed in `package.json`
(dependencies/devDependencies) — but **no `.prisma` schema file exists anywhere in this
repo, and no code in `src/` or `server/` imports or uses Prisma.** Classification:
**DEAD / LEGACY** (an installed-but-unused dependency), not evidence that Bell24h-OS has
a Prisma-backed data layer. This directly bears on the ORIENT-04 database boundary
question below.

**VyaparSethu:** database provider/ORM is **UNKNOWN** — see §4, conflicting
documentation not resolved this session.

---

## 8. Authentication / Tenancy

(Bell24h-OS only — no VyaparSethu code access.)

| Element | Status | Evidence |
|---|---|---|
| Authentication (session/JWT) | PARTIALLY IMPLEMENTED — Supabase Auth; `requireAuth` middleware previously runtime-verified (RG-C, live 401s); full flow owner-reported `V1.0 STABLE`, not independently re-observed this session | `server/middleware/requireAuth.ts` |
| Organizations | INFERRED (schema-file) — `organizations`/`profiles`, hand-written RLS | `MASTER_DATA_OWNERSHIP.md:85-87` |
| Profiles/Users | PARTIALLY IMPLEMENTED — no dedicated "Users" module, folds into Teams | `AA-01-IMPLEMENTATION-AUDIT.md:77` |
| Teams | PARTIALLY IMPLEMENTED — real page, invite flow is an explicit `alert()` mock | `AA-01-IMPLEMENTATION-AUDIT.md:78` |
| Roles/RBAC | PARTIALLY IMPLEMENTED — `roles`/`user_roles` tables exist; `permissions` table has **no RLS and no policy at all**; **no server-side authorization primitive exists** (`hasPermission`/`checkRole`/`authorize` → 0 hits) | `MASTER_MODULES.md:38`, re-confirmed |
| RLS | INFERRED (schema-file) — org-isolation pattern applied broadly via a reusable generator | `supabase_schema.sql:62+` |
| `organization_id` propagation | PARTIALLY IMPLEMENTED — present on most tenant tables; **absent** on all 5 Knowledge Vault tables (contested, `ADR-010`) | `MASTER_DATA_OWNERSHIP.md:53-65` |
| JWT handling | INFERRED — `auth.uid()` used throughout RLS policies and `get_current_org_id()` | `supabase_schema.sql:50-60` |
| Server-side authorization | PARTIALLY IMPLEMENTED — `requireAuth` = identity only, no role/permission check | `MASTER_MODULES.md:33` |
| Client-side authorization | PARTIALLY IMPLEMENTED — `AuthService.resolveRole()` fails closed to `VIEWER`, but is a UI affordance, not a security boundary | `MASTER_MODULES.md:35` |

**Organization isolation is enforced at:**
- **A. Database (RLS)** — yes, INFERRED from schema file, re-verified directly against
  policy text this session and in BR-01 (`job_queue`, `ai_providers` both re-derive org
  from `auth.uid()` server-side).
- **B. Server** — partially; 9 request handlers in `server.ts` use a pooled
  `DATABASE_URL` connection that **bypasses RLS entirely** (`MASTER_MODULES.md:21`).
- **C. Client** — no reliable enforcement; multiple pages skip org filtering client-side
  (7 of 19 routed modules per AA-01), relying solely on RLS.
- **D. Multiple layers together, consistently** — **no**. Coverage is uneven across
  A/B/C; the pooled-connection bypass in B is a real gap in the one place a second
  layer would matter most.

---

## 9. AI Runtime

Full trace (unchanged since BR-01; re-verified against current code this session —
HEAD identical to BR-01's baseline, so no drift possible):

```
Browser → (client-side path, 6 modules) → AiProviderService.ts → provider API directly
Browser → (2 Knowledge Vault endpoints only) → server.ts → ProviderRouter.ts → ProviderManager.ts → GeminiProvider.ts → Gemini
```

| Element | Status | Evidence |
|---|---|---|
| `AiProviderService.ts` (client-side, legacy) | VERIFIED — self-documented "Critical Security Debt" in its own header comment; used by AI Providers, Prompt Studio, Content Planner, Image Studio, Video Studio, Job Orchestrator | `AiProviderService.ts:1-13` |
| Client read path for `api_key` | **STATIC SECURITY FINDING, already closed.** `getProviders()` explicitly excludes `api_key` from its `select()` — browser never receives a real key via this path | `AiProviderService.ts:410-419` |
| Client write path for `api_key` | **STATIC SECURITY FINDING — remediated in BR-01.** `AiProvidersPage.tsx` no longer sends the raw key to Supabase; field disabled | BR-01 report §1, §6; re-verified this session (`git diff` unchanged since BR-01) |
| **Runtime security exposure** | **NOT CONFIRMED — BLOCKED.** BR-01's attempt to exercise the live app hit Supabase 500s / AI Studio 404s; no working test path exists. This is distinct from "safe" — it means untested, not clean | BR-01 report §1 |
| Server-side AI Provider Manager | PARTIALLY IMPLEMENTED — `server/ai/ProviderManager.ts`/`ProviderRouter.ts`, **Gemini-only, text-only**, wired to exactly 2 of 13 server routes | `MASTER_MODULES.md:82-84` |
| AI request logging | PARTIALLY IMPLEMENTED — `ai_request_logs` table + `logRequest()` exist and are called; client `select('*')` on logs pulls prompt/response text (data-minimization concern, not a credential leak) | `MASTER_DATA_OWNERSHIP.md:139` |
| Fallback / retry | PARTIALLY IMPLEMENTED — priority-ordered provider iteration with retry exists in `AIManagerService`, but only exercises the dead client-side path | `AiProviderService.ts:452-533` |
| Queueing | DEAD / LEGACY — see §10 | — |
| Environment variables | VERIFIED clean — only `VITE_SUPABASE_URL`/`VITE_SUPABASE_KEY` reach the client build; no provider-key `VITE_*` var exists anywhere in `src/` | direct search, re-confirmed BR-01 |
| Client bundle | VERIFIED clean (local `dist/`, slightly stale build) — no `sk-…`/`AIza…`-shaped literal | BR-01 report §1 |

**Distinguishing the two claim types, as the mission requires:** the *static* finding
(client-side calls, self-documented as a security debt) is VERIFIED. Whether that debt
has ever produced an actual runtime exposure to a real user is UNKNOWN — P0-B remains
BLOCKED, not resolved in either direction.

---

## 10. Queue / Worker Reality

Unchanged since BR-01, re-verified this session:

```
UI (Content Planner / Image Studio / Video Studio)
  → JobOrchestratorService.enqueueJob() — browser writes directly to Supabase, NO API layer
  → public.job_queue (INSERT, RLS org-checked)
  → JobWorker — DISABLED, import + .start() commented out, src/main.tsx:7,9
  → [dead end — nothing consumes the queue]
  → provider / storage / result / UI — never reached
```

| Claim (BR-01) | Re-checked? | Status |
|---|---|---|
| JobWorker disabled | Yes | **VERIFIED, unchanged** — `src/main.tsx:7,9` still commented out |
| Browser writes `job_queue` directly, no server API | Yes | **VERIFIED, unchanged** — `server.ts` has zero references to `job_queue`/`JobWorker`/`JobOrchestrator` |
| `job_queue` RLS protects `organization_id` | Yes | **VERIFIED, unchanged** — INSERT/UPDATE both re-derive org from `get_current_org_id()`; cross-org write/update rejected. DELETE has no policy at all (default-deny) |
| `JobWorker` expects `created_by` | Yes | **VERIFIED, unchanged** — `JobWorker.ts:43` reads `job.created_by` |
| `job_queue` lacks a `created_by` column | Yes | **VERIFIED, unchanged** — no such column in `supabase_schema.sql:1132-1146`; neither `enqueueJob` nor any of the 3 call sites (Content Planner/Image Studio/Video Studio) ever writes one. `processJob(job, undefined)` fails immediately on the profile lookup |
| Field-level validation on `status`/`job_type`/`priority`/`payload` | New this session (BR-01 queue audit) | **VERIFIED ABSENT** — no `CHECK` constraints; any same-org authenticated member can fabricate any value in any of these columns, including on another teammate's existing job (UPDATE has no per-owner restriction, only org-level) |

**Modules depending on JobWorker:** Content Planner, Image Studio, Video Studio, SEO
(shares the `'content'`/`'seo'` code path). All enqueue successfully and stop dead at
the same point.

**JobWorker was NOT reactivated, will NOT be reactivated as part of this
reconnaissance sprint (ACT locked).**

---

## 11. Security Reality

Only findings this session (or BR-01, re-verified) can actually evidence:

| Finding | Severity | Static/Runtime | Evidence | Current Status |
|---|---|---|---|---|
| Client-side AI provider calls (6 modules) | Real, self-documented debt | Static | `AiProviderService.ts:1-13` | Read path already safe (excludes key); write path fixed BR-01 |
| `ai_providers.api_key` still selectable at grant level (no `REVOKE`) | Medium | Static | `MASTER_DATA_OWNERSHIP.md:69-71,138` | Open — SEC-02 decision gate |
| Direct browser writes to `job_queue`, no server API boundary | Medium | Static | §10, BR-01 queue audit | Open — no field validation same-org |
| `job_queue` missing `created_by` | Low-medium (functional, not exposure) | Static | §10 | Open — blocks safe JobWorker reactivation |
| Knowledge Vault: no `organization_id` on any of 5 tables, `USING (true)` RLS = public read | High (functional exposure, contested ownership) | Static (schema-file) | `MASTER_DATA_OWNERSHIP.md:53-65` | Open, `ADR-010` unresolved |
| 9 server handlers use pooled `DATABASE_URL`, bypassing RLS entirely | High (defeats the DB-layer control where it's used) | Static | `MASTER_MODULES.md:21` | Open |
| `permissions` table: RLS enabled, zero policies (denies everything, but also: no authorization primitive exists to enforce role-based access anywhere) | Medium | Static | `MASTER_MODULES.md:38` | Open |
| `/system/diagnostics` reachable with zero authentication | Low-medium | Static, previously runtime-corroborated | `AA-01-IMPLEMENTATION-AUDIT.md:105-106` | Open |
| Cross-tenant RLS isolation never demonstrated live | Unrated — unproven either way | Neither confirmed nor refuted | `MASTER_DATA_OWNERSHIP.md:40-51` | `RV-007 DEFERRED` |
| Runtime P0-B verification | N/A — blocked, not a finding | Attempted, blocked | BR-01 report §1 | Supabase 500s / AI Studio 404s, no working test path |
| VyaparSethu CSP allows browser `connect-src` to `api.groq.com`/`api.openai.com` | UNKNOWN severity — flagged, not investigated | Runtime (header only) | `curl -I https://www.vyaparsethu.com/`, this session | Candidate for a dedicated, separately-scoped VyaparSethu review — **not investigated further here, no code access, no live exploitation attempted** |
| Prisma client installed, unused | Informational, not a vulnerability | Static | `package.json:17,60`; no `.prisma` file, no imports | Dead dependency |
| CORS / rate limiting | PARTIALLY IMPLEMENTED — rate limiting exists on 2 AI routes only, in-memory (per-process, wrong across instances); no CORS policy inspected this session | `MASTER_MODULES.md:51` | Open |
| Queue field manipulation (same-org) | Medium | Static | §10 | Open, tied to JW-01/PA-02 |

No new "queue manipulation via a different org" finding — that specific path was
checked directly (§10) and is blocked by RLS.

---

## 12. Blockchain Reality

**NOT FOUND.** Direct search this session across `src/`, `server/`, `package.json`, and
the full top-level directory listing for `web3`, `ethers`, `hardhat`, `solidity`,
`smart contract`, `blockchain`, `wallet connect`, `metamask` — zero hits. No
`contracts/` directory, no deployment scripts, no network/wallet configuration
anywhere in Bell24h-OS. Classification: **NOT FOUND** (not "not production-ready" —
there is no source code, no planned-architecture reference, nothing at all).

VyaparSethu: **UNKNOWN** — no code access.

---

## 13. InsForge Current Evidence

**What exists today:** five documentation mentions in this repo
(`docs/project/PROJECT_CONTINUITY_REPORT.md`, `MASTER_CONTEXT/KERNEL_ARCHITECTURE.md`,
`.claude/skills/bell24h-verify/SKILL.md`, and this session's own BR-01/OODA-01 reports)
— **every one of them describes InsForge as part of VyaparSethu's stack, not
Bell24h-OS's.** Direct search of `package.json`, `.env.example`, and every file in
`src/`/`server/` for "insforge" (case-insensitive): **zero matches.**

**What does not exist:** no InsForge SDK/package dependency, no InsForge environment
variable, no InsForge URL, no InsForge Edge Function, no InsForge client
instantiation, anywhere in Bell24h-OS's actual code.

**Is it connected?** No — not to this repo.

**Is it production?** UNKNOWN for VyaparSethu (no code access); the CSP header
observed this session for `www.vyaparsethu.com` does not name any `insforge` domain in
`connect-src`, which is at least mildly *against* InsForge being a live browser-facing
dependency of the current production VyaparSethu build — but this is a single negative
data point, not a determination, since InsForge could be called server-side only (which
a CSP header would never reveal).

**Is it legacy?** UNKNOWN — no repository evidence for VyaparSethu either way.

**Is there any evidence it is currently part of Bell24h-OS?** **No. None.**

**Classification: NOT FOUND** (in Bell24h-OS). Reference-only in documentation about a
different application.

**INSFORGE DECISION STATUS = NOT YET DECIDED**

---

## 14. System Boundary Map

```
bell24h.com ──────┐
www.bell24h.com ───┼── VERIFIED: HTTP redirect (curl, this session) ──┐
vyaparsethu.com ───┘                                                   │
                                                                        ▼
                                                          www.vyaparsethu.com
                                                          VERIFIED: Next.js on Vercel
                                                          VERIFIED: source = github.com/
                                                                    bell24xcom/forBell24x
                                                                    (this session, Vercel API)
                                                                        │
                                                          UNKNOWN ──────┤────── UNKNOWN
                                                          (DB, backend                (relationship to
                                                           internals —                 admin/outreach —
                                                           no code access)             §6, not found in
                                                                                        Bell24h-OS)

digitex-erp-bell24h-os (this repo)
    │
    ├── VERIFIED: never deployed (0 Vercel deployments, 0 domains)
    ├── VERIFIED: no code-level reference to VyaparSethu's actual repo/domain
    ├── VERIFIED: no InsForge, no blockchain, no admin/outreach code
    └── UNKNOWN ── relationship to VyaparSethu beyond shared branding/org
                    ("Bell24h-OS is to become the orchestration kernel beneath
                     VyaparSethu" — KERNEL_ARCHITECTURE.md, self-labelled
                     "DESIGN — NOT FROZEN", i.e. aspiration, not current state)
```

**No arrow above connects Bell24h-OS to the live VyaparSethu deployment today.** The
only documented relationship is aspirational planning text in an explicitly
not-frozen design document.

---

## 15. Capability Ownership Matrix

| Capability | Bell24h-OS | VyaparSethu | Admin/Outreach | Other | Evidence | Status |
|---|---|---|---|---|---|---|
| Auth | PARTIALLY IMPLEMENTED (Supabase) | INFERRED (MSG91, per docs) | N/A | — | §8, §4 | Two separate, non-federated systems |
| Organizations | INFERRED (schema-file) | UNKNOWN | N/A | — | §8 | — |
| Users | PARTIALLY IMPLEMENTED (folds into Teams) | UNKNOWN | N/A | — | §8 | — |
| RBAC | PARTIALLY IMPLEMENTED (no server primitive) | UNKNOWN | N/A | — | §8 | Real gap in Bell24h-OS |
| AI | PARTIALLY IMPLEMENTED (§9) | UNKNOWN, CSP suggests client-reachable providers | N/A | — | §9, §4 | Same *shape* of risk suspected, not confirmed, on VyaparSethu |
| AI Provider Manager | PARTIALLY IMPLEMENTED (Gemini/text only) | UNKNOWN | N/A | — | §9 | — |
| RFQ | PARTIALLY IMPLEMENTED (schema-only, no code) | UNKNOWN, presumed real | N/A | — | Gap map | Orphaned schema in Bell24h-OS |
| Matching | NOT FOUND | UNKNOWN | N/A | — | Gap map | — |
| Trust / Verification | NOT FOUND | UNKNOWN | N/A | — | Gap map | No ADR names this at all |
| Knowledge | PARTIALLY IMPLEMENTED (no tenant boundary, contested) | UNKNOWN | N/A | — | §8 | `ADR-010` unresolved |
| Memory | NOT FOUND | UNKNOWN | N/A | — | Gap map | Blocked on `pgvector` |
| Search | NOT FOUND | UNKNOWN | N/A | — | Gap map | — |
| Communication | NOT FOUND | UNKNOWN | N/A | — | §6 | No ADR at all |
| WhatsApp | NOT FOUND (UI label only) | INFERRED live (MSG91) | N/A | — | §6, §4 | — |
| Email | NOT FOUND (UI label only) | UNKNOWN | N/A | — | §6 | — |
| SMS | NOT FOUND | INFERRED live (MSG91) | N/A | — | §4 | — |
| Voice | DEAD / LEGACY (10-line stub) | UNKNOWN | N/A | — | Gap map | — |
| Workflow | PARTIALLY IMPLEMENTED (`triggerWorkflow` simulated) | UNKNOWN | N/A | — | `MASTER_MODULES.md:52` | — |
| Agents | DEAD / LEGACY (stub) | UNKNOWN | N/A | — | `MASTER_MODULES.md:88` | — |
| Queues | DEAD / LEGACY (§10) | UNKNOWN | N/A | — | §10 | — |
| Workers | DEAD / LEGACY (§10) | UNKNOWN | N/A | — | §10 | — |
| Storage | PARTIALLY IMPLEMENTED (2 buckets) | UNKNOWN | N/A | — | §7 | — |
| Analytics | PARTIALLY IMPLEMENTED (fabricated trend data) | UNKNOWN | N/A | — | §6 | — |
| SEO/GEO | PARTIALLY IMPLEMENTED (rule-based, no AI) | INFERRED active (live commit history shows real SEO fixes) | N/A | — | §4, `MASTER_MODULES.md:135` | VyaparSethu's SEO work looks materially more real than Bell24h-OS's |
| CRM | DEAD / LEGACY | UNKNOWN | NOT FOUND anywhere in this repo | — | §6 | — |
| Campaigns | PARTIALLY IMPLEMENTED (thin, internal) | UNKNOWN | — | — | §6 | Not an outreach system |
| Scraping | NOT FOUND | UNKNOWN | NOT FOUND | — | §6 | — |
| Enrichment | NOT FOUND | UNKNOWN | NOT FOUND | — | §6 | — |
| Payments | NOT FOUND | INFERRED live (Razorpay, CSP) | N/A | — | §4 | Owned by VyaparSethu, not Bell24h-OS |
| Escrow | NOT FOUND | UNKNOWN | N/A | — | Gap map | — |
| Wallet | NOT FOUND | UNKNOWN | N/A | — | Gap map | — |
| Ledger | NOT FOUND | UNKNOWN | N/A | — | Gap map | — |
| Blockchain | NOT FOUND | UNKNOWN | N/A | — | §12 | — |

---

## 16. Duplication Matrix

| Capability | System A | System B | Duplicate? | Evidence | Risk |
|---|---|---|---|---|---|
| Marketplace schema (RFQ, buyers, suppliers, quotations, orders, products, categories) | Bell24h-OS (`supabase_schema.sql`, 12 table groups, org-scoped, zero code) | VyaparSethu (presumed real implementation, unverified DB) | **Possible duplication — unresolved.** Bell24h-OS's copy is inert (schema only); cannot confirm whether it mirrors, predates, or is unrelated to VyaparSethu's actual store | `MASTER_DATA_OWNERSHIP.md:171-184`; §4 | Two systems of record risk if both are ever populated independently — this is exactly the open `DA-01` question, not resolved here |
| AI provider calling pattern | Bell24h-OS: client-side `AiProviderService.ts` (self-documented debt) | VyaparSethu: CSP allows client `connect-src` to `api.groq.com`/`api.openai.com` | **Same architectural pattern, independently observed** — not code duplication (different codebases) but the same *class* of risk in both | §9, §4 | If confirmed on VyaparSethu's side, this is not a shared fix — each app needs its own remediation |
| Auth/tenancy model | Bell24h-OS: Supabase Auth + `organization_id` RLS | VyaparSethu: MSG91 phone OTP (inferred) | Not duplication — genuinely different systems, no overlap found | §8, §4 | Two separate identity systems, no federation (already logged in the BR-01 gap map) |
| Prisma tooling | Bell24h-OS: `package.json` lists it, unused | VyaparSethu: named in this repo's docs as part of its stack (disputed — see §4 Neon-vs-INSFORGE conflict) | **Cannot determine** — Bell24h-OS's Prisma is dead weight, not an active data layer, so there is no live duplication to compare against | §7 | Low — informational only |

**No consolidation proposed.** Per mission scope, this section only identifies
duplication candidates.

---

## 17. Database Boundary

| | Bell24h-OS | VyaparSethu | Other |
|---|---|---|---|
| **Provider** | Supabase/Postgres — VERIFIED (`src/lib/supabase.ts`, project ref baked into build per `MASTER_MODULES.md:20`) | UNKNOWN — this repo's own docs conflict: `INSFORGE` (`KERNEL_ARCHITECTURE.md`) vs. Neon assumed in the BR-01 brief. Neither confirmed | — |
| **ORM** | None — direct `@supabase/supabase-js` client + raw `pg` pool. `@prisma/client` present in `package.json` but **unused, no schema, no imports** (§7) | UNKNOWN (Prisma named in docs, unverified) | — |
| **Schema** | 127 tables, 1 schema (`public`), 1 extension (`uuid-ossp`), 3 functions, 1 trigger — schema-file evidence only | UNKNOWN | — |
| **Auth relationship** | `auth.uid()` → `profiles.organization_id` via `SECURITY DEFINER` function | UNKNOWN (MSG91-based, mechanics not visible) | — |
| **Tenant model** | `organization_id` on most tables (absent on 5 Knowledge Vault tables) | UNKNOWN | — |
| **Important tables** | `organizations`, `profiles`, `ai_providers`, `job_queue`, `vault_documents` (contested), marketplace schema (12 groups, inert) | UNKNOWN | — |
| **Current integration between the two DBs** | **None found.** No code in Bell24h-OS connects to, references, or imports anything targeting a VyaparSethu database | — | — |
| **Evidence** | Direct schema-file read, this session + BR-01 | Documentation only, conflicting | — |

**No merge or split recommendation.** This is the `DA-01` decision gate named in §19,
not something this document resolves.

---

## 18. Documentation vs. Reality

| Documented claim | Source | Reality found this session | Verdict |
|---|---|---|---|
| "124 public tables" | Prior session reporting (referenced in the OODA-01 mission brief) | **127**, recounted directly from `supabase_schema.sql` | Documentation slightly stale — not a large discrepancy, but not exact either |
| "VyaparSethu: Neon/PostgreSQL + Prisma" | BR-01 mission brief's assumed baseline | This repo's own docs say INSFORGE instead; neither confirmed against VyaparSethu directly | **Contradiction, still unresolved** — flagged in BR-01, flagged again here |
| "VyaparSethu is an independent Next.js application... shares no code with this repo" | `KERNEL_ARCHITECTURE.md:576-577` | **Confirmed and sharpened** — now have the actual repo (`bell24xcom/forBell24x`), not just "independent" | Documentation was directionally correct; this session adds the missing specific |
| "VyaparSethu deployed to bell24h.com → vyaparsethu.com" | `PROJECT_CONTINUITY_REPORT.md:18-19` | **Confirmed exactly** — live redirect chain matches precisely | Accurate |
| "Bell24h-OS is to become the orchestration kernel beneath VyaparSethu" | `KERNEL_ARCHITECTURE.md:11`, self-labelled `DESIGN — NOT FROZEN` | No code-level evidence of any such relationship existing today | Aspiration correctly labelled as such in its source document — not a contradiction, a plan |
| "AA-01/BR-01 findings (JobWorker, client-side AI keys, queue gaps)" | `docs/project/AA-01-*.md`, `docs/project/BR-01-*.md` | **All re-verified, unchanged** | Accurate, current |
| Prisma as part of Bell24h-OS's data layer | Not explicitly claimed anywhere, but its presence in `package.json` could mislead a reader | No actual usage anywhere | Latent documentation risk — nothing currently claims this, but nothing disclaims it either |

---

## 19. Decision Readiness Matrix

Per mission instruction: identify the decisions, do not make them.

| # | Decision | Evidence available | Evidence missing | Risk | Decision owner |
|---|---|---|---|---|---|
| D-01 | What is the actual Bell24h-OS system of record? | Schema-file inventory (127 tables), auth/RLS mechanics | Live-queried DB state (never obtained, no credentials this session) | Low urgency — Bell24h-OS is undeployed, so "system of record for what, in production" doesn't yet apply | Founder |
| D-02 | What is the actual VyaparSethu system of record? | Live site confirmed real/active; source repo now known (`bell24xcom/forBell24x`) | Database provider (Neon vs. INSFORGE conflict unresolved), schema, no code access | High — this is the live, revenue/user-facing system; unresolved DB identity blocks any integration planning | Whoever owns `bell24xcom/forBell24x` access |
| D-03 | Should Bell24h-OS provide shared services to VyaparSethu? | None currently connects them (§14) | Any technical feasibility assessment — requires VyaparSethu code access first | Medium — premature to plan without D-02 | Founder |
| D-04 | Where should AI execution occur? | Bell24h-OS: server path exists but covers 1 provider/1 modality (§9). VyaparSethu: CSP suggests client-side calls exist too (§4, unconfirmed) | Full provider/modality parity requirements; VyaparSethu's actual AI architecture | High — same-shaped credential-exposure risk suspected on both sides independently | Founder + whoever can review VyaparSethu's actual code |
| D-05 | Where should background jobs execute? | Bell24h-OS: `JobWorker` browser-resident, disabled, missing `created_by` (§10) | VyaparSethu's job/queue architecture, if any | Medium — Bell24h-OS's own job pipeline needs a decision regardless of VyaparSethu | Founder |
| D-06 | Where should Communication Hub live? | Neither system has one today (§6, §15) — WhatsApp/Email/SMS found only as VyaparSethu-side live integrations (MSG91) or Bell24h-OS UI labels | Full requirements; whether VyaparSethu's MSG91 usage is meant to generalize | Low-medium — nothing exists yet to migrate or duplicate | Founder |
| D-07 | Should WhatsApp infrastructure be OS-level or application-level? | VyaparSethu appears to already have MSG91 live (§4); Bell24h-OS has none | Whether MSG91 is WhatsApp specifically or SMS/OTP only — CSP evidence doesn't distinguish | Low-medium | Founder |
| D-08 | Should InsForge be evaluated as an alternative execution platform? | Zero InsForge presence in Bell24h-OS (§13); unconfirmed presence in VyaparSethu | Any InsForge capability assessment at all — this session did not evaluate InsForge itself, only searched for its presence | Low — nothing currently depends on it either way | Founder |
| D-09 | What belongs permanently to VyaparSethu? | Live evidence: Payments (Razorpay), Auth (MSG91), SEO/supplier-directory features (§4) | Full feature inventory — no code access | Medium | Founder |
| D-10 | What belongs permanently to Bell24h-OS? | AI Provider Manager pattern (even if partial), Knowledge Vault (contested), the org/RBAC substrate | Whether any of this is meant to be reusable by VyaparSethu at all (ties to D-03) | Medium | Founder |
| D-11 *(new, surfaced this session)* | Is `bell24xcom/forBell24x` actually the same codebase as the local path (`C:/Users/Sanika/Projects/bell24h`) this repo's docs previously referenced? | Vercel deployment metadata gives the GitHub identity; prior docs give a local path; nothing links them | Direct comparison — needs access to both | Low urgency technically, but blocks trusting *any* future VyaparSethu-side documentation in this repo until resolved | Founder |

---

## 20. FACTS THE ARCHITECTURE TEAM MUST KNOW

1. **Bell24h-OS has never been deployed.** Zero Vercel deployments, zero domains, in
   every team this session's tools can reach. Any planning that assumes it is "in
   production" in any form is working from a false premise.
2. **`bell24h.com` is not a separate application** — it is a DNS/Vercel alias in front
   of the live VyaparSethu Next.js deployment. There are three domains and one app.
3. **The live VyaparSethu app's real source repo is `github.com/bell24xcom/forBell24x`**
   — a fact not previously recorded anywhere in this repo's documentation. Whether this
   matches the local path this repo's docs have been citing (`C:/Users/Sanika/Projects/
   bell24h`) is unresolved (D-11).
4. **VyaparSethu's database provider is still genuinely unknown** — this repo's own
   documentation disagrees with itself (INSFORGE vs. the BR-01 brief's Neon assumption),
   and neither has been checked against the actual system.
5. **VyaparSethu's live CSP header allows browser connections to `api.groq.com` and
   `api.openai.com`** — the same *shape* of risk BR-01 found and partially remediated in
   Bell24h-OS. Not confirmed as an actual exposure; flagged as a priority item for a
   dedicated, properly-scoped VyaparSethu security review, which this session could not
   perform (no code access, and live-production probing was correctly out of scope).
6. **No architectural connection exists between Bell24h-OS and VyaparSethu today.** The
   "orchestration kernel" relationship is a named aspiration in a document that labels
   itself `DESIGN — NOT FROZEN`, not a current state.
7. **JobWorker cannot be safely reactivated as-is** — three independent, evidenced
   reasons (browser-resident/non-atomic; guaranteed-fail credential path; a
   `created_by` column that has never existed but is read as if it does).
8. **Bell24h-OS's Prisma dependency is dead weight**, not a data-layer decision already
   made — don't let its presence in `package.json` be read as "this repo uses Prisma."
9. **No InsForge, blockchain, CRM, scraping, enrichment, or outreach infrastructure
   exists in Bell24h-OS.** These are not partial or planned — they are entirely absent
   from the codebase.
10. **127 tables exist in Bell24h-OS's schema file; almost none of it is exercised at
    runtime** — 0 full-CRUD modules (per AA-01), most tables written to by at most one
    or two code paths, several (the entire marketplace schema, 12 table groups) have
    zero application code touching them at all.

---

## Methodology note

This document was produced entirely from: (a) direct reads of Bell24h-OS source files
and its schema file, (b) `git`/`gh`/Vercel API queries against this session's actual
tool access, (c) live HTTP requests to the four public domains named in the mission,
and (d) this repo's own prior committed/uncommitted documentation, cross-checked rather
than trusted. No VyaparSethu, InsForge, or blockchain code was read because none of it
exists in this repository and no other repository was accessible this session.
