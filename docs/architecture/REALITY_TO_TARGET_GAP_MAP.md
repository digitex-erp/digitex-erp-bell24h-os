# Reality → Target Gap Map

**Produced by:** BR-01 — Reality & Security Reconciliation
**Documentation only.** This map does not authorize any architectural change, database
merge/split, SDK/API contract, or ownership transfer. Those decisions belong to later,
explicitly named decision gates (see the final BR-01 report, Section 8).

**Method:** every row is built from evidence already committed/present in this working
tree — primarily `docs/architecture/CANONICAL_ARCHITECTURE.md`, `MASTER_MODULES.md`,
`MASTER_DATA_OWNERSHIP.md`, `ARCHITECTURE_DECISION_RECORDS.md` (PS-02, frozen
2026-08-04), and `docs/project/AA-01-IMPLEMENTATION-AUDIT.md` / `AA-01-TICKETS.md` —
cross-checked against source where BR-01 re-verified a claim directly. Where "Target
Owner" cites an ADR, that reflects an *already frozen* prior decision in this repo, not
a new one made here. Where no ADR addresses a capability, Target Owner is **UNDECIDED**.

---

## Correction — VyaparSethu database stack

The BR-01 brief's assumed baseline states *"VyaparSethu: Neon/PostgreSQL + Prisma."*
This repo's own prior investigation does not support that:

- `MASTER_CONTEXT/KERNEL_ARCHITECTURE.md:576-577` (untracked, this working tree):
  *"VyaparSethu today is an independent Next.js application using MSG91 auth and
  INSFORGE — it shares no code with this repo."*
- `docs/project/PROJECT_CONTINUITY_REPORT.md:18-22`: describes VyaparSethu as *"Next.js,
  MSG91 phone OTP, INSFORGE + Prisma, deployed to bell24h.com → vyaparsethu.com"* — a
  **different, unrelated project** at a separate local path.

Both sources name **INSFORGE**, not Neon. Neither source was re-verified by BR-01
against the actual VyaparSethu codebase (out of reach — it is not part of this
repository and BR-01 has no tool access to it). **This map reports the discrepancy
rather than silently adopting either claim.** Treat "VyaparSethu current stack" as
**PARTIAL** everywhere below: sourced from this repo's own prior docs, not
independently confirmed at the source.

Bell24h-OS's own stack — **Supabase/PostgreSQL** — is **VERIFIED**: `src/lib/supabase.ts`,
`supabase_schema.sql`, and the production bundle baking in Supabase project ref
`dqpaekyayhqhndihbnnn` (`MASTER_MODULES.md:20`).

---

## Gap map

| Capability | Current Bell24h-OS | Current VyaparSethu | Current System of Record | Target Owner | Evidence | Gap | Confidence |
|---|---|---|---|---|---|---|---|
| **Authentication** | Supabase Auth + `requireAuth` middleware (10/13 server routes gated); `AuthPage.tsx`/`useAuth.ts` real. Owner-reported `V1.0 STABLE` (not independently observed by any session with login access). | Independent Next.js app; MSG91 phone OTP + INSFORGE. Shares no code with this repo. | Two separate systems — Supabase `auth.users` (Bell24h-OS) and MSG91/INSFORGE (VyaparSethu). No shared identity today. | L1 Bell24h-OS per frozen PS-02 model; VyaparSethu's onboarding onto it is named as "a separate migration" with no schedule — **UNDECIDED** when/how. | `MASTER_MODULES.md:33-36`; `CANONICAL_ARCHITECTURE.md:123-127`; `KERNEL_ARCHITECTURE.md:575-577` | Two non-federated identity systems; no SSO; migration mechanism and timing undecided. | VERIFIED (Bell24h-OS side) / PARTIAL (VyaparSethu side) |
| **Organizations** | `organizations`/`profiles` tables, hand-written RLS policies, real `OrganizationPage.tsx` (R+U, no C/D). | Unknown — out of reach of this repo. | Bell24h-OS `organizations` table, own domain only. | L1 Bell24h-OS, tenant root (ADR-008). | `MASTER_DATA_OWNERSHIP.md:85-87` | Whether VyaparSethu orgs map 1:1 to Bell24h-OS `organization_id` is undocumented anywhere in this repo. | VERIFIED (Bell24h-OS) / UNKNOWN (cross-system mapping) |
| **Users** | No dedicated module; folds into Teams. `profiles`/`user_roles`/`roles`. | Unknown. | Bell24h-OS `profiles`/`auth.users`. | L1 Bell24h-OS. | `AA-01-IMPLEMENTATION-AUDIT.md:77` | Absence of a distinct Users module looks intentional (per AA-01), not a defect. | VERIFIED |
| **Teams** | `/team` real page; roles/user_roles/audit_logs wiring; **invite is an explicit `alert()` mock**, not functional. | Unknown. | Bell24h-OS. | L1 Bell24h-OS. | `AA-01-IMPLEMENTATION-AUDIT.md:78` | Invite flow simulated, not real. | VERIFIED |
| **AI Provider Manager** | `server/ai/ProviderManager.ts`/`ProviderRouter.ts` real, server-side, credential-safe — but **Gemini-only, text-only**, used by 2 of 13 routes. A **parallel legacy client-side path** (`AiProviderService.ts`) is still live, consumed by 5 pages + JobOrchestrator. BR-01 closed the plaintext-key **write** leak in `AiProvidersPage.tsx` this sprint (see final report §6); full server-side parity was explicitly **not** authorized this sprint. | Unknown / out of scope. | `server/ai/*` is the intended sole path (ADR-012: legacy path "must be replaced, not adapted"). | L4 Bell24h-OS, sole holder of provider credentials (frozen PS-02). | `MASTER_MODULES.md:82-86`; this report's P0-A findings | Legacy path still live in 5 modules; server path covers 1 of 8 providers, 0 of 3 non-text modalities. | VERIFIED |
| **AI Generation** (text/image/video) | Content/Image/Video Studio have real UI + DB, but generation never completes end-to-end: client-side path always fails (`api_key` deliberately never reaches the browser) and the one component that would run a job, `JobWorker`, is disabled (see this report's P1 finding — **BLOCKED**, not reactivated). | Unknown. | None — nothing completes today. | L5 AI Factory Platform over L4 kernel (ADR-005). | This report §P1; `AA-01-IMPLEMENTATION-AUDIT.md` ground truth | End-to-end generation pipeline non-functional for all three modalities. | PARTIAL — strong static/source evidence; no live run performed (blocked before reaching runtime test) |
| **RFQ** | `rfqs`/`rfq_items` tables exist with org RLS but **zero service, page, or CRUD path anywhere in `src/`**. | Unknown — presumed the live/functional owner given VyaparSethu's stated domain, not verified from this repo. | UNDECIDED — dormant schema in Bell24h-OS Postgres vs. presumed-real VyaparSethu implementation on a separate DB. | L6 VyaparSethu (ADR-001). | `MASTER_DATA_OWNERSHIP.md:178`; `MASTER_MODULES.md:151` | Orphaned duplicate schema in Bell24h-OS with no behavior. | VERIFIED (Bell24h-OS side) / UNKNOWN (VyaparSethu side) |
| **Matching** | No table, service, or code anywhere (verified by direct schema search). | Unknown. | None currently in Bell24h-OS. | L6 VyaparSethu (retained as VyaparSethu's own domain flow per the 9-stage pipeline, `CANONICAL_ARCHITECTURE.md:221-222`). | Direct `supabase_schema.sql` search; `ARCHITECTURE_DECISION_RECORDS.md:76` | Not built in Bell24h-OS at all. | VERIFIED ABSENT (Bell24h-OS) / UNKNOWN (VyaparSethu) |
| **Communication** | No module, table, or service found. | Unknown. | None. | **UNDECIDED** — not named as an element in any frozen architecture doc. | Direct search, `src/modules/` listing | Entirely unaddressed by current architecture planning, not merely unbuilt. | VERIFIED ABSENT (Bell24h-OS) / UNKNOWN (VyaparSethu) |
| **WhatsApp** | Zero real integration; named only as a future Integration Hub connector target. | Unknown. | None. | L2 Enterprise Integration Hub, platform-owned connector definitions (ADR-006). | `MASTER_MODULES.md:55`; `ARCHITECTURE_DECISION_RECORDS.md:396-400` | Reserved name only. | VERIFIED ABSENT |
| **Media** | Media Composer real module, routed, **absent from nav**; `media_*` (6 tables). | Unknown. | Bell24h-OS `media_*` tables. | L5 (applied capability grouping). | `MASTER_MODULES.md:140` | Built but unreachable via normal navigation. | PARTIAL (RLS scoping INFERRED, not runtime-tested) |
| **Image Generation** | Image Studio real UI + DB (`image_*`, 5 tables + storage bucket); generation non-functional (same root cause as AI Generation row). | Unknown. | None functional. | L5 AI Factory — Image Factory (ADR-005). | `MASTER_MODULES.md:111`; this report §P1 | Non-functional end-to-end; server-side path has zero image-generation capability today. | PARTIAL |
| **Video Generation** | Video Studio real UI + DB (`video_*`, 7 tables); generation non-functional, same root cause. | Unknown. | None functional. | L5 AI Factory — Video Factory (ADR-005). | `MASTER_MODULES.md:112`; this report §P1 | Same as Image Generation; zero server-side video-modality support exists anywhere. | PARTIAL |
| **Voice** | `VoiceService.ts` — 10-line stub (`return new Blob()`, hardcoded transcript string), imported by nothing. | Unknown. | None — dead code. | L5 AI Factory — Voice Factory (ADR-005). | `AA-01-IMPLEMENTATION-AUDIT.md:86`; `MASTER_MODULES.md:113` | Stub only, unreachable. | VERIFIED |
| **Trust / Verification** | No table, module, or reference anywhere. | Unknown. | None. | **UNDECIDED** — not named as even a reserved/future element in any frozen doc. | Direct schema + doc search | Not merely unbuilt — entirely absent from architecture planning. | VERIFIED ABSENT (Bell24h-OS) / UNKNOWN (VyaparSethu) |
| **Trust Graph** | No table or code named "trust graph" anywhere (`graph_nodes`/`graph_edges` exist only as a *generic*, unbuilt L3 knowledge-graph reservation — not trust-scoped, no trust-relationship semantics defined for it). | Unknown. | None. | **UNDECIDED** — no ADR defines a trust-graph capability distinct from the generic L3 Knowledge Graph reservation. | `MASTER_DATA_OWNERSHIP.md:125` (`graph_nodes`/`graph_edges`, FUTURE); direct search for "trust graph" — 0 hits | Not merely unbuilt — no architecture doc has scoped what a trust graph would even mean here (edges = trust relationships? verification provenance? undefined). | VERIFIED ABSENT (Bell24h-OS) / UNKNOWN (VyaparSethu) |
| **Agent Policy** | Agent Runtime itself is a stub (`AgentService.ts`: `listAgents()` → `[]`, `spawnAgent()` logs only); no server-side authorization primitive exists to build a policy layer on (`hasPermission`/`checkRole`/`authorize` → 0 hits). | Unknown. | None. | L4 Agent Runtime (ADR-004) — but "Agent Policy" specifically has no ADR of its own. | `MASTER_MODULES.md:38,88` | Both the runtime and any policy layer over it are unbuilt. | VERIFIED ABSENT |
| **Job Queue** | `job_queue`/`job_dependencies`/`job_logs` real schema + RLS; `JobOrchestratorService` has real enqueue/dependency/retry logic. **`JobWorker` (the only consumer) is disabled** — see this report's P1 finding: even if reactivated it runs client-side (browser-tab-dependent, non-atomic job claiming) and calls the dead client-side AI path. Marked **BLOCKED**, not reactivated. | Unknown. | Bell24h-OS `job_queue` — write-only today. | L2 Job Orchestration / server-side scheduler (implied by L2 definition; no ADR names a specific replacement design). | `MASTER_MODULES.md:49-50`; this report §P1 | Queue never drains; no safe reactivation path found; no server-side worker exists. | VERIFIED |
| **Knowledge** | Knowledge Vault real (7 `requireAuth`-gated routes) but **none of its 5 tables have `organization_id`**; RLS policy is `USING (true)` (public read), no write policy, and handlers use the RLS-bypassing pooled connection regardless. | Unknown. | Bell24h-OS vault tables — ownership **contested, ADR-010 not resolved**. | Contested — L3 registry if platform-owned "ICECRAFT" content, or a real multi-tenant module if not; **not yet decided**. | `MASTER_MODULES.md:69`; `MASTER_DATA_OWNERSHIP.md:53-65,116-120` | No tenant boundary; authenticated cross-org read is open; existing rows have no clear owner (backfill hazard). | VERIFIED |
| **Memory / Context** | Context Engine has real tables but its own page bypasses the service layer; no pgvector, no embeddings anywhere — Memory Runtime is **verified absent**. | Unknown. | Bell24h-OS `context_profiles` etc. only; no memory substrate exists. | L3 substrate + L4 Memory Runtime (ADR-002 split). | `MASTER_MODULES.md:67-68,72,91` | Entire Memory Runtime + vector store layer unbuilt, blocked on pgvector. | VERIFIED ABSENT (Memory Runtime) |
| **Analytics** | No distinct "Analytics" module; closest analog is `PerformanceDashboardPage`, itself PARTIAL — several "trend" percentages are hardcoded, aggregation is client-side. | Unknown. | None real. | L5 (grouped with SEO/GEO/Publishing). | `AA-01-IMPLEMENTATION-AUDIT.md:96`; `MASTER_MODULES.md:139,142` | No real rollups; existing dashboard mixes live counts with fabricated trend values. | VERIFIED |
| **Payments** | No tables, no code anywhere. | Unknown (Razorpay named only as a future Integration Hub connector target). | None. | L5 Commerce primitives (no dedicated ADR beyond the general L5 admission test). | `MASTER_MODULES.md:143` | Entirely unbuilt. | VERIFIED ABSENT |
| **Escrow** | No tables, no code anywhere. | Unknown. | None. | L5 Commerce primitives (same as Payments). | `MASTER_MODULES.md:143` | Entirely unbuilt. | VERIFIED ABSENT |
| **Notifications** | `notifications` table exists; no service, no sender. | Unknown. | None functional. | L2 Notification Platform. | `MASTER_MODULES.md:56` | Table with no delivery mechanism. | VERIFIED |
| **Publishing** | Publishing Center real page, read-only display; `enqueuePublishingTask` exists but is **never called**; only module with **no org scoping at all**; no mechanism to publish to any external platform exists anywhere. | Unknown. | Bell24h-OS `publishing_*` (10 tables) — display-only. | L5 (grouped with SEO/GEO/Analytics). | `AA-01-IMPLEMENTATION-AUDIT.md:87`; `MASTER_MODULES.md:137` | Bare queue-table viewer; no C/U/D; no org scoping; no real external-publish mechanism. | VERIFIED |
| **CRM** | `CrmService.ts` stub (`getCustomers()` → `[]`); no page/route; unconnected to its own `companies`/`contacts` tables. | Unknown. | None functional; `companies`/`contacts` schema-only. | **UNDECIDED** — no ADR assigns CRM to L5 (reusable) vs. L6 (VyaparSethu-domain). | `MASTER_MODULES.md:156`; `MASTER_DATA_OWNERSHIP.md:175` | Dead code, unreachable, disconnected from its own tables. | VERIFIED |
| **Search** | No search index, no `tsvector`, no hybrid ranking anywhere. | Unknown. | None. | L3 Knowledge & Memory Substrate (search index component). | `MASTER_MODULES.md:74` | Entirely unbuilt. | VERIFIED ABSENT |
| **Marketplace** | `buyers`/`suppliers`/`products`/`categories`/`rfqs`/`quotations`/`orders`/`companies`/`contacts` (12 table groups) exist with org RLS, but **zero service, page, or CRUD path anywhere in `src/`** — schema without behavior. | Presumed the live, functioning marketplace application per this repo's own docs (buyers, suppliers, RFQs, quotes, deals, trade workflows) — **not independently verified**, out of reach of this repo's tools. | **UNDECIDED** — open question for a future Data Architecture decision gate, explicitly not resolved here. | L6 VyaparSethu, explicitly (ADR-001, correcting an earlier doc that had assigned it to the platform). | `MASTER_DATA_OWNERSHIP.md:171-184`; `MASTER_MODULES.md:151`; `ARCHITECTURE_DECISION_RECORDS.md` ADR-001 | Duplicate/orphaned marketplace schema sitting unused in Bell24h-OS's Supabase; real system-of-record status vs. VyaparSethu's own DB is unresolved. | VERIFIED (Bell24h-OS side — schema-only) / UNKNOWN (VyaparSethu side) |

---

## Reading this map

- **UNKNOWN "Current VyaparSethu" is the common case**, not an oversight: this repo has
  no code, database, or tool access to the VyaparSethu codebase. Every VyaparSethu-side
  cell above is either sourced from this repo's own prior documentation (and labeled
  PARTIAL for that reason) or explicitly marked UNKNOWN where no such documentation
  exists.
- **UNDECIDED Target Owner rows** (Communication, Trust/Verification, Agent Policy's
  policy layer specifically, CRM, RFQ/Marketplace system-of-record) are not gaps in this
  document — they are accurately reporting that no ADR in this repository has assigned
  them yet. Do not read a target ADR citation elsewhere in this table as BR-01 having
  made that assignment; every cited ADR predates this sprint.
- This table does not change if VyaparSethu is later found to use Neon, INSFORGE, or
  something else — that correction belongs to whoever next gets direct access to the
  VyaparSethu codebase, not to inference from this repository.
