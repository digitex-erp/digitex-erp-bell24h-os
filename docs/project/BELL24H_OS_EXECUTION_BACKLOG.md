# BELL24H_OS_EXECUTION_BACKLOG

**Repository:** `digitex-erp/digitex-erp-bell24h-os` (`HEAD = bd31707`)
**Phase:** Remediation Execution Planning — **planning only, no implementation**
**Date:** 2026-09-14
**Source of record, exclusively:** `docs/project/BELL24H_OS_PRODUCTION_READINESS_REPORT.md`
and `docs/project/BELL24H_OS_REMEDIATION_MASTER_PLAN.md`. No new audit was performed, no
code was written, no file was modified, no Communication Hub or Agent Runtime work was
implemented. Every Task ID below maps 1:1 to a blocker ID already defined in the Master
Plan (`GC-`, `FD-`, `SEC-`, `OR-`, `GOV-`, `CH-`, `AR-` prefixes) — restated here as an
executable backlog, not re-derived.

**Conversion choices, stated explicitly (interpretive, not dictated by either source
document):**

1. Communication Hub (`CH-1..3`) and Agent Runtime (`AR-1..3`) are listed as their own
   Epics (EPIC-06, EPIC-07) per Objective 2's implied completeness, but carry **no Task
   IDs, no effort, no sprint assignment** — the mission forbids implementing either, and
   the Master Plan already places both outside the critical path to Production Ready.
   Scheduling them would misrepresent this backlog as authorizing that work.
2. "Owner" actions (project owner / Council) and "Engineering" actions are two different
   kinds of backlog item with fundamentally different duration predictability. This
   backlog does not force owner actions into sprint boxes with the same confidence as
   engineering tasks — they're listed as "ongoing, start immediately" rather than pinned
   to a specific sprint, per the Master Plan's own observation that these have "the
   longest, least predictable lead time."
3. Sprint length is assumed to be roughly one week for planning-grid purposes only — the
   Master Plan never states a sprint cadence, and this backlog does not invent team size
   or velocity. Sprint numbers below are a dependency-ordered sequence, not a calendar
   commitment.

---

## 1. Epics

| Epic ID | Epic | Source blockers | In this backlog's scope? |
|---|---|---|---|
| EPIC-01 | Gate C Closure | GC-1, GC-2, GC-3, GC-4 | Yes |
| EPIC-02 | Governance Trust Repair | GOV-2, GOV-3, GOV-4 | Yes |
| EPIC-03 | Security & Tenant-Isolation Engineering | SEC-2, SEC-3, SEC-4, SEC-5, SEC-6 | Yes |
| EPIC-04 | Frontend Deployment Decision & Execution | FD-1, FD-2, FD-3 | Yes |
| EPIC-05 | Orchestration Baseline | OR-1, OR-2 | Yes |
| EPIC-06 | Communication Hub Readiness | CH-1, CH-2, CH-3 | **Listed only — no tasks scheduled, per Conversion Choice 1** |
| EPIC-07 | Agent Runtime Readiness | AR-1, AR-2, AR-3 | **Listed only — no tasks scheduled, per Conversion Choice 1** |
| EPIC-08 | Production Readiness Verification | Master Plan §9 step 10 | Yes — closes the backlog |

---

## 2. Workstreams

Cross-cutting execution tracks, grouped by who executes and what they depend on — not the
same grouping as Epics, since (for example) Gate C's four items split across two very
different kinds of actor.

| Workstream | Actor | Tasks |
|---|---|---|
| **WS-A — Owner & Council Actions** | Project owner / Council | TASK-01, TASK-02, TASK-03, TASK-05 |
| **WS-B — Trust & Hygiene Engineering** | Engineering | TASK-06, TASK-08 |
| **WS-C — Security & Tenancy Engineering** | Engineering | TASK-04, TASK-07, TASK-09, TASK-10, TASK-11, TASK-12, TASK-13 |
| **WS-D — Deployment & Orchestration Decisions** | Product / Project owner | TASK-14, TASK-16 |
| **WS-E — Deployment & Orchestration Execution** | Engineering | TASK-15, TASK-17 |
| **WS-F — Verification** | Engineering | TASK-18 |

WS-A and WS-D can start on day one, in parallel with WS-B, and their completion time is
genuinely unknown to this plan — everything else is sequenced around them, not blocked
waiting for them unless a specific dependency says so (Section 4).

---

## 3. Dependency Map

Restated from the Master Plan §2, as task-level edges:

```
TASK-09 (SEC-2: fix RLS-bypass)  ──────────► TASK-04 (GC-3 impl)
TASK-03 (GC-3 Council decision)  ──────────► TASK-04 (GC-3 impl)

TASK-01, TASK-02, TASK-04, TASK-05  ────────► GATE C PASS (all four required together —
                                                no partial credit, per the constitution
                                                rule both source docs already apply)

TASK-06 (remove hardcoded status) ─────────► TASK-15 (execute real deployment)
TASK-07 (fix/mark mock pages)     ─────────► TASK-15 (execute real deployment)
TASK-14 (deployment scope decision) ───────► TASK-15

TASK-16 (hosting/dequeue decision) ────────► TASK-17 (implement dequeue)

TASK-10 (RBAC primitive)          ─────────► TASK-18 (verification) — independent chain
TASK-11 (durable audit sink)      ─────────► TASK-18 — independent chain
TASK-12, TASK-13                  ─────────► TASK-18 — independent, no upstream dependency

TASK-08 (route/remove orphaned page) ──────► TASK-18 — independent, cosmetic

GATE C PASS + TASK-06 + TASK-07 + TASK-10 + TASK-11 + TASK-15 + TASK-17 ──► TASK-18 ──►
PRODUCTION READY
```

**No task in this backlog depends on EPIC-06 or EPIC-07.** Communication Hub and Agent
Runtime readiness depend on outputs of this backlog (TASK-16's hosting decision,
TASK-10's RBAC primitive, TASK-11's audit sink — per the Master Plan §2a) but nothing
here depends on them, confirming they can genuinely stay out of scope without blocking
Production Ready.

---

## 4. Critical Path

Three chains run in parallel; the **longest one paces the whole backlog**. Effort
values are the day-ranges already established in the Master Plan §8 — not re-estimated
here.

| Chain | Path | Length |
|---|---|---|
| **Chain 1 — Gate C engineering half** | TASK-09 (3–5d) → TASK-04 (3–5d) | **6–10 person-days**, plus however long TASK-01/02/03/05 (owner/Council) take in parallel — genuinely unknown, and per the Master Plan, likely the actual pacing factor in practice |
| **Chain 2 — RBAC** | TASK-10 alone | **5–10 person-days**, standalone |
| **Chain 3 — Durable audit** | TASK-11 alone | **3–10 person-days**, standalone with respect to every other Task ID in this backlog — but carries one internal prerequisite not modeled as its own task: a storage-technology decision made at the start of TASK-11 itself (see its Section 7 row) |
| **Chain 4 — Trust + deploy** | TASK-06 (<1d) + TASK-07 (1–5d) → TASK-15 (<1d) | **2–6 person-days** |
| **Chain 5 — Orchestration** | TASK-16 (decision, unknown) → TASK-17 (3–5d) | 3–5 engineering days + unknown decision latency |

**Engineering-only critical path ≈ 6–10 person-days** (Chain 1 and Chain 2 are roughly
tied for longest, assuming both can be staffed in parallel with the others). **The
genuine critical path is more likely paced by Chain 1's owner/Council components**
(TASK-01, TASK-02, TASK-03, TASK-05) than by engineering effort — this backlog does not
invent a completion date for those and flags that honestly rather than picking a number
that sounds plausible.

---

## 5. Owner Required Actions

Actions only the project owner (or, for one item, the Council) can perform — no engineering
session, this one included, should attempt or work around any of these:

| Task ID | Action | Why it must be the owner |
|---|---|---|
| TASK-01 | Run the `REVOKE`/rotation SQL against the live database (query already drafted in `GATE_C_CLOSURE_PACKAGE.md`) | Requires live DB credentials this and every prior session in this project has correctly refused to request |
| TASK-02 | Sign off on the ratified C.2C closure record | Governance sign-off — no engineering session can self-ratify its own governance criteria |
| TASK-03 | Council decides Option A/B/C for Knowledge Vault tenancy (Option B pre-recommended) | A product/data-ownership decision, not a technical one |
| TASK-05 | Perform one real login attempt against the current build, in incognito, and report the exact outcome | Requires real credentials no session should hold or request |
| TASK-14 | Decide whether the SPA should be deployed at all, or the deployment stays API-only by design | A product decision about what should be publicly reachable |
| TASK-16 | Decide the orchestration hosting mechanism (Vercel Cron / separate worker host / external managed queue) | A cost/infrastructure commitment, not a code-level choice |

---

## 6. Engineering Required Actions

| Task ID | Action |
|---|---|
| TASK-04 | Implement Knowledge Vault tenancy per the Council's TASK-03 decision (schema + RLS + off-pool migration) |
| TASK-06 | Remove/replace the three hardcoded-fake-status locations |
| TASK-07 | Wire Settings/Admin to real data and actions, or clearly mark them non-functional/hide from navigation |
| TASK-08 | Route or remove the orphaned `IndustryDashboardPage.tsx` |
| TASK-09 | Migrate the 9 pooled-connection handlers off the RLS-bypassing pattern |
| TASK-10 | Build the RBAC/`authorize()` primitive at L1 |
| TASK-11 | Build a durable audit sink to replace stdout-only `server/audit.ts` |
| TASK-12 | Add idempotency-key enforcement to existing mutating routes |
| TASK-13 | Move rate-limit/AI-budget counters from in-memory to Postgres-backed state |
| TASK-15 | Execute the deployment-config fix (real `vite build`) once TASK-06/07/14 are done |
| TASK-17 | Implement the minimal real dequeue mechanism for the existing `job_queue`, per TASK-16's decision |
| TASK-18 | Re-run the Production Readiness Report's methodology against its own Section 7 criteria to confirm the classification has genuinely changed |

---

## 7. Full Backlog

| Epic ID | Task ID | Task | Dependency | Effort | Risk | Owner | Sprint | Exit Criteria |
|---|---|---|---|---|---|---|---|---|
| EPIC-01 | TASK-01 | Execute `REVOKE`/rotation SQL on `ai_providers.api_key`; rotate every previously-exposed key | None | Owner | **Low** effort, **High** stakes if delayed — keys remain treated as compromised until this runs | Project Owner | Ongoing (start immediately) | `information_schema.role_column_grants` no longer lists `anon`/`authenticated` for this column; rotation dated and recorded |
| EPIC-01 | TASK-02 | Sign off on the ratified C.2C closure record | None | Owner | **Low** — proposal text already drafted, this is sign-off only | Project Owner / Council | Ongoing | A committed, non-"DESIGN" file exists stating C.2C's criteria, with an explicit sign-off line |
| EPIC-01 | TASK-03 | Council decision: Option A/B/C for Knowledge Vault tenancy | None | Owner | **Medium** — no committed decision-maker/date exists in source docs; this is the item most likely to stall TASK-04 | Council | Ongoing | A recorded decision in a committed doc |
| EPIC-01 | TASK-04 | Implement Vault tenancy (schema + RLS + off-pool migration) per TASK-03's decision | TASK-03, TASK-09 | M (3–5d) | **Medium–High** — schema change + RLS rewrite + route migration; source docs warn a partial version "looks fixed, isn't" | Engineering | Sprint 3 | A cross-tenant read attempt against these 5 tables is denied, demonstrated at runtime — not asserted from source |
| EPIC-01 | TASK-05 | Perform + record one live login verification | None | Owner | **Low** effort, but this is the one Gate C item with literally zero prior evidence either way | Project Owner | Ongoing | A dated, concrete result: "confirmed working" or "confirmed broken: `<error>`" |
| EPIC-02 | TASK-06 | Remove/replace the 3 hardcoded-fake-status locations (Dashboard cards, `AdminService.getSystemHealth()`, `DatabasePage`'s unconditional "Active") | None | XS (<1d) | **Low** — small, well-scoped, no architecture change | Engineering | Sprint 1 | Repo-wide grep for the specific hardcoded strings (`"42 instances"`, `"Operational"` badges with no backing check, unconditional `"Active"`) returns zero hits outside legitimate UI copy |
| EPIC-02 | TASK-07 | Wire Settings/Admin to real data/actions, or mark them clearly non-functional and hide from nav until fixed | None (scope depends on a product call not modeled as a formal task here) | S–M (1–5d) | **Medium** — effort is unknown until the wire-vs-mark decision is made; treated informally, not as a separate Owner task, since it doesn't block anything else in this backlog either way | Engineering + Product | Sprint 2 | Neither page presents fabricated data indistinguishable from real functionality |
| EPIC-02 | TASK-08 | Route or remove `IndustryDashboardPage.tsx` | None | XS (<1d) | **Low** — cosmetic, no dependency either direction | Engineering | Sprint 1 | Page is either reachable via navigation or removed from the codebase — not left in limbo |
| EPIC-03 | TASK-09 | Migrate 9 pooled-`DATABASE_URL` handlers off the RLS-bypassing pattern | None | M (3–5d) | **Medium–High** — touches a recurring, previously-flagged architecture violation across `/api/check-*` and `/api/vault/*` | Engineering | Sprint 1–2 | None of the 9 handlers construct a raw pooled connection for tenant-scoped reads/writes; RLS is the only isolation mechanism in the path |
| EPIC-03 | TASK-10 | Build RBAC/`authorize()` primitive at L1 | None | L (5–10d) | **High** — "genuinely new infrastructure with no prior implementation in this repo to estimate from directly" (Master Plan §8) | Engineering | Sprint 2–3 | At least the routes/pages this backlog's source docs identified as needing it are gated by a real `authorize(ctx, action, resource)` call, fails closed |
| EPIC-03 | TASK-11 | Build durable audit sink, replacing stdout-only `server/audit.ts` | None | M–L (3–10d) | **High** — same "new infrastructure" flag as TASK-10; needs a storage decision first, not modeled as a separate task | Engineering | Sprint 2–3 | Sensitive mutations (auth denials, provider changes, admin actions) are durably persisted and queryable, not stdout-only |
| EPIC-03 | TASK-12 | Add idempotency-key enforcement to existing mutating routes | None | S (1–2d) | **Low–Medium** | Engineering | Sprint 2 | A repeated request with the same idempotency key does not double-execute |
| EPIC-03 | TASK-13 | Move rate-limit/AI-budget counters to Postgres-backed state | None | S (1–2d) | **Low–Medium** — bounded scope, but corrects a real production defect (state resets on every serverless cold start) | Engineering | Sprint 2 | Rate-limit/budget state survives a cold start and is consistent across concurrent warm instances |
| EPIC-04 | TASK-14 | Decide deployment scope: ship the SPA for real, or stay documented-API-only | None | Owner | **Medium** — whichever way this goes, it ends a currently-undocumented drift between repo and deployment | Product / Project Owner | Ongoing | A committed, dated decision exists — no more silent gap between what the repo contains and what's live |
| EPIC-04 | TASK-15 | Execute the build-config fix (real `vite build`) if TASK-14 says "ship it" | TASK-06, TASK-07, TASK-14 | XS (<1d) | **Low** technical risk; **High** risk if executed before TASK-06/07 land — ships fabricated data to real users | Engineering | Sprint 3–4 | Deployed URL content matches the decided scope; no fabricated data reachable by a real user |
| EPIC-05 | TASK-16 | Decide orchestration hosting mechanism (Vercel Cron / separate worker / external queue) | None | Owner | **Medium** — three materially different cost/ops profiles, no default is obviously correct from source docs alone | Product / Project Owner | Ongoing | A committed decision exists, matching the three options already framed in the Communication Hub plan |
| EPIC-05 | TASK-17 | Implement minimal real dequeue for the existing `job_queue` per TASK-16's decision | TASK-16 | M (3–5d) | **Medium** | Engineering | Sprint 4 | A job submitted through Video Studio or Image Studio reaches `completed` or `failed`, not permanently `queued` |
| EPIC-08 | TASK-18 | Re-run the Production Readiness Report's methodology against its own §7 criteria | TASK-01, 02, 04, 05, 06, 07, 10, 11, 15, 17 | S (1–2d) | **Low** effort, but this is the task that actually confirms the classification changed — skipping it would mean asserting Production Ready rather than evidencing it | Engineering | Sprint 5 | A new, dated report exists showing every Section 7 criterion independently evidenced as true, not inferred |

---

## 8. Execution Sequence — Sprint 1 through Production Ready

**Ongoing, from day one (not sprint-boxed):** TASK-01, TASK-02, TASK-03, TASK-05
(EPIC-01's owner/Council items), TASK-14, TASK-16 (EPIC-04/05's decisions). Nothing below
waits for these to *start* — only specific downstream tasks wait for them to *finish*
(Section 3).

**Sprint 1:** TASK-06, TASK-08 (trivial, independent trust fixes) + start TASK-09
(longest-lead engineering item in Chain 1, started early per dependency-shortening logic —
mirrors the Master Plan's own execution-order recommendation).

**Sprint 2:** Finish TASK-09; start TASK-10 and TASK-11 (both standalone, both long-lead);
TASK-07, TASK-12, TASK-13 (independent, moderate-sized).

**Sprint 3:** TASK-04 (now unblocked if TASK-03 has landed and TASK-09 is done); continue
TASK-10/TASK-11 if not yet finished; TASK-15 becomes eligible once TASK-06/TASK-07/TASK-14
are all done.

**Sprint 4:** TASK-15 (if not already executed); TASK-17 (once TASK-16 has landed).

**Sprint 5:** TASK-18 — verification. **This is the only task that actually produces the
Production Ready classification.** Everything before it is remediation; this is the
evidence step, run with the same discipline (live checks over source inspection, no
inferred passes) as both source documents already established.

**What "Production Ready" looks like at the end of Sprint 5, mechanically:** Gate C shows
PASS (TASK-01, 02, 04, 05 all independently evidenced — no partial credit); TASK-06/07
mean no fabricated data reaches a real user; TASK-09 means no tenant-scoped route relies
on an RLS bypass; TASK-10/11 mean real authorization and durable audit exist; TASK-15
means the deployed URL matches a real decision, not silent drift; TASK-17 means at least
one existing generation feature actually completes a job. **Communication Hub and Agent
Runtime readiness (EPIC-06/07) remain explicitly open after this sequence** — this backlog
was never scoped to close them, per Conversion Choice 1.

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GyjerP42mTVzzK2ZkSeRCf
