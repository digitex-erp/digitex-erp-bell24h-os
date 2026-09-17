# BELL24H_OS EXECUTION READINESS REPORT

**Repository:** `digitex-erp/digitex-erp-bell24h-os` (`HEAD = bd31707`)
**Phase:** Execution Planning Validation Sprint — **audit and certification only, no
implementation, no new plans, no new backlog**
**Date:** 2026-09-14
**Source of record, exclusively:**
1. `docs/project/BELL24H_OS_PRODUCTION_READINESS_REPORT.md`
2. `docs/project/BELL24H_OS_REMEDIATION_MASTER_PLAN.md`
3. `docs/project/BELL24H_OS_EXECUTION_BACKLOG.md`

No new audit was performed. The 9-handler, pooled-`DATABASE_URL` finding itself comes
entirely from the three source documents. None of the three cites exact file/line locations
for it, and Section 4 of this mission cannot be answered without them — so those line numbers
were confirmed this session via one targeted `grep` of `server.ts` at `HEAD = bd31707`,
solely to make Section 4 concrete. That grep, and the one assumption it required, are
disclosed explicitly in Section 4 rather than presented as already established. No code was
written, no file was modified, no commit was made, no new plan or backlog was created.

---

## 1. Task-by-Task Validation

All 18 Task IDs in `BELL24H_OS_EXECUTION_BACKLOG.md` §7, checked against that document's own
§3 (Dependency Map), §5/§6 (Owner/Engineering Required Actions), and the Master Plan's §7
(Production Readiness Criteria).

| Task | Dependency | Owner | Effort | Exit Criteria | Blocking Items (what it gates downstream) |
|---|---|---|---|---|---|
| TASK-01 | None | Project Owner | Owner (minutes, once run) | `information_schema.role_column_grants` no longer lists `anon`/`authenticated` for `ai_providers.api_key`; rotation dated | Gate C PASS (jointly w/ 02, 04, 05) |
| TASK-02 | None | Project Owner/Council | Owner (sign-off only) | Committed, non-"DESIGN" file with explicit sign-off line | Gate C PASS |
| TASK-03 | None | Council | Owner (decision latency, unknown) | Recorded tenancy decision in a committed doc | TASK-04 (jointly w/ TASK-09) |
| TASK-04 | TASK-03, TASK-09 | Engineering | M (3–5d) | Cross-tenant read denied, demonstrated at runtime | Gate C PASS (jointly w/ 01, 02, 05); TASK-18 |
| TASK-05 | None | Project Owner | Owner (minutes) | Dated, concrete result: "confirmed working" or "confirmed broken: `<error>`" | Gate C PASS |
| TASK-06 | None | Engineering | XS (<1d) | Repo-wide grep for named hardcoded strings returns zero hits outside legitimate UI copy | TASK-15 |
| TASK-07 | None *(see §2 — scope is actually gated on an unscoped product call)* | Engineering + Product | S–M (1–5d) | Neither Settings nor Admin presents fabricated data as real | TASK-15 |
| TASK-08 | None | Engineering | XS (<1d) | Page reachable via navigation, or removed from codebase | None that gates Production Ready *(see §2)* |
| TASK-09 | None | Engineering | M (3–5d) | None of the 9 handlers construct a raw pooled connection for tenant-scoped reads/writes | TASK-04 |
| TASK-10 | None | Engineering | L (5–10d) | Identified routes/pages gated by a real `authorize(ctx, action, resource)` call, fails closed | TASK-18 |
| TASK-11 | None *(internal, unmodeled prerequisite: a storage-technology choice made at its own start)* | Engineering | M–L (3–10d) | Sensitive mutations durably persisted and queryable, not stdout-only | TASK-18 |
| TASK-12 | None | Engineering | S (1–2d) | A repeated request with the same idempotency key does not double-execute | None that gates Production Ready *(see §2)* |
| TASK-13 | None | Engineering | S (1–2d) | Rate-limit/budget state survives a cold start, consistent across warm instances | None that gates Production Ready *(see §2)* |
| TASK-14 | None | Product/Project Owner | Owner (decision latency) | Committed, dated deployment-scope decision | TASK-15 |
| TASK-15 | TASK-06, TASK-07, TASK-14 | Engineering | XS (<1d) | Deployed URL content matches the decided scope; no fabricated data reachable by a real user | TASK-18 |
| TASK-16 | None | Product/Project Owner | Owner (decision latency) | Committed decision matching the three hosting options already framed | TASK-17 |
| TASK-17 | TASK-16 | Engineering | M (3–5d) | A submitted job reaches `completed` or `failed`, not permanently `queued` | TASK-18 |
| TASK-18 | TASK-01, 02, 04, 05, 06, 07, 10, 11, 15, 17 | Engineering | S (1–2d) | New, dated report shows every Master Plan §7 criterion independently evidenced, not inferred | PRODUCTION READY |

All 18 tasks are individually well-formed: each has a stated dependency (or explicitly
`None`), an owner, an effort size, and a runtime-evidenced (not source-inferred) exit
criterion, consistent with the constitution's evidence table. The three exceptions are
named inline above and expanded in Section 2.

---

## 2. Gaps, Inconsistencies, and Non-Executable-as-Written Items

**No circular dependencies exist.** Every edge in the backlog's dependency map (§3) and
Full Backlog Table (§7) runs strictly forward toward TASK-18 / PRODUCTION READY; no task
depends, directly or transitively, on a task that depends on it.

### 2.1 Internal contradiction: the backlog's own dependency narrative disagrees with its own dependency table

`BELL24H_OS_EXECUTION_BACKLOG.md` §3 lists three individual arrows into TASK-18 that its own
§7 Full Backlog Table then omits from TASK-18's `Dependency` column:

> `TASK-12, TASK-13 ──► TASK-18 — independent, no upstream dependency`
> `TASK-08 (route/remove orphaned page) ──► TASK-18 — independent, cosmetic`

but the consolidated formula two lines later in the same section, and the Full Backlog
Table's TASK-18 row, both list only:

> `GATE C PASS + TASK-06 + TASK-07 + TASK-10 + TASK-11 + TASK-15 + TASK-17 ──► TASK-18`

TASK-08, TASK-12, and TASK-13 are drawn as feeding TASK-18 in one place and excluded from it
in the two places that are actually operative (the consolidated formula and the machine-
readable `Dependency` column). This is a genuine internal inconsistency in the backlog
document, not a reading ambiguity. **It does not change the true critical path** — the
consolidated formula and the Full Backlog Table agree with each other and with the Master
Plan's own §7 criteria (Section 3, below) — but the backlog's §3 narrative should be
corrected to match before being treated as authoritative prose.

### 2.2 TASK-12 and TASK-13 are consistently under-tracked across the backlog document

This is the same pattern as 2.1, compounding rather than isolated:

- Absent from the Full Backlog Table's TASK-18 `Dependency` column (confirmed above).
- Absent from `BELL24H_OS_EXECUTION_BACKLOG.md` §6 "Engineering Required Actions" — that
  table lists TASK-04, 06, 07, 08, 09, 10, 11, 15, 17, 18, but not TASK-12 or TASK-13, even
  though both are Engineering-owned tasks in the Full Backlog Table (§7).
- Absent from the Master Plan's §7 "Production Readiness Criteria" checklist — SEC-5
  (idempotency, TASK-12) and SEC-6 (Postgres-backed rate limiting, TASK-13) are named
  Security blockers in the Master Plan §1f and real, current production defects (§9 of the
  Readiness Report explicitly states SEC-6 is "not reliable in production today"), but
  neither appears as a checkable item in the criteria TASK-18 is defined to re-verify.

Net effect: TASK-12 and TASK-13 can be skipped entirely and TASK-18 can still pass, and
PRODUCTION READY can still be declared under this plan's own definition. This is not a
backlog invention — it is inherited faithfully from the Master Plan's own §7 scope (which
never included SEC-5/SEC-6) — so it is not grounds to fault the backlog's fidelity to its
source. It is, however, a real planning gap worth naming plainly: two acknowledged,
currently-live production defects have no gate forcing their resolution before this plan
calls the system Production Ready.

### 2.3 TASK-07's scope is gated on a decision with no task, owner, or date — unlike its siblings

TASK-14 and TASK-16 both externalize their "decide, then implement" pattern into a dedicated
Owner task (TASK-14 → TASK-15; TASK-16 → TASK-17) with its own exit criterion. TASK-07 does
not: its own row states the dependency as "None (scope depends on a product call not modeled
as a formal task here)," and its Owner is listed as "Engineering + Product" combined — but no
Owner Required Action (§5) exists for the product call itself, only the Engineering
Required Action (§6) for implementation. As written, engineering cannot correctly size or
start TASK-07 until an unscoped, untracked product decision (wire Settings/Admin for real,
vs. mark them non-functional and hide them) has been made. This is inherited from the Master
Plan (which treats GOV-3 the same way, §4/§9), not introduced by the backlog — so it is a
carried-forward gap, not a new defect, but it means TASK-07 is the one task in this backlog
that cannot actually be started as written without an out-of-band decision this plan does
not track anywhere as its own action item.

### 2.4 Components named in the Readiness Report with no corresponding blocker ID or task

The Master Plan's blocker list (§1) is explicitly scoped to Objective 2's 7 categories. Two
components the Production Readiness Report itself classifies as gaps never received a
blocker ID in that process and therefore have no task in the backlog at all:

- **Publishing Center** — `PublishingCenterService.enqueuePublishingTask()` exists but no UI
  anywhere calls it (Readiness Report §4); not covered by OR-1/OR-2/OR-3 (which address only
  `job_queue`/Video/Image Studio, not `publishing_queue`).
- **Media Composer** — one real stat card, no create/manage UI of any kind (Readiness Report
  §4).

Neither is required by the Master Plan's §7 Production Readiness Criteria, so their absence
from the backlog does not threaten this plan's own definition of Production Ready — but they
are real, evidenced gaps that currently have zero path to closure anywhere in this
three-document chain. Low severity; noted for completeness, not flagged as a defect in the
backlog's fidelity to its sources.

### 2.5 Tasks that cannot be executed as written

Only one: **TASK-07**, per 2.3 above — not because its own definition is malformed, but
because the product decision it depends on is untracked. Every other task, including the
long-lead and highest-risk items (TASK-09, TASK-10, TASK-11), is executable exactly as
specified once its stated dependency (if any) is satisfied.

---

## 3. True Critical Path

The Master Plan (§3) and the Backlog (§4) agree: the longest **engineering-only** chain is a
near-tie between Chain 1 (TASK-09 → TASK-04, 6–10 person-days) and Chain 2 (TASK-10 alone,
5–10 person-days). But neither source document treats engineering effort as the actual
pacing factor — both state explicitly that the Council decision in TASK-03 has no committed
decision-maker or date anywhere in the source material, making it, not engineering time, the
most likely real-world bottleneck. The path below is the **true** critical path in that
sense — dependency-honest, not effort-optimistic:

```
TASK-03  (Council: Knowledge Vault tenancy decision — unknown duration, no committed date)
   │
   ├──────────────┐
   ▼              ▼
TASK-09        (in parallel: TASK-01, TASK-02, TASK-05 — Owner actions,
(3–5d)          unknown duration, no dependency on TASK-03/09)
   │
   ▼
TASK-04  (Vault tenancy implementation, 3–5d — requires BOTH TASK-03 and TASK-09)
   │
   ▼
GATE C PASS  (requires TASK-01 + TASK-02 + TASK-04 + TASK-05 simultaneously —
              no partial credit, per the constitution rule both source docs apply)
   │
   │   (converging in parallel, all also required before TASK-18:)
   │   TASK-06 + TASK-07 ──► TASK-15   (trust fixes → real deploy)
   │   TASK-10                          (RBAC primitive, 5–10d)
   │   TASK-11                          (durable audit, 3–10d)
   │   TASK-16 ──► TASK-17              (hosting decision → dequeue, 3–5d)
   ▼
TASK-18  (re-run Production Readiness Report methodology against Master Plan §7 criteria)
   │
   ▼
PRODUCTION READY
```

**Reading this path correctly:** TASK-10 and TASK-11 are each independently as long as, or
longer than, the TASK-09→TASK-04 chain (5–10d and 3–10d respectively vs. 6–10d combined) —
they are not shorter side-branches, they are co-equal candidates for "the" critical path
depending on staffing. The one element genuinely gating everything else, per both source
documents' own analysis, is **TASK-03's decision latency**, because it sits upstream of
TASK-04, which is itself required for Gate C, which is required for TASK-18. Nothing in
Chains 2 (TASK-10), 3 (TASK-11), 4 (TASK-06/07→TASK-15), or 5 (TASK-16→TASK-17) depends on
TASK-03 — they can run fully in parallel with it — so TASK-03 only paces the overall plan if
it is *not* resolved before those other chains finish, which given "unknown duration, no
committed date," it may well not be.

---

## 4. First Engineering Task to Execute

**Recommendation: TASK-09** (migrate the 9 pooled-`DATABASE_URL` handlers off the
RLS-bypassing connection pattern), started the same day as TASK-06 and every Owner/Council
kickoff item, not sequenced behind any of them.

**Why this one, not TASK-06:** both are zero-dependency and immediately startable. The
Master Plan's own Recommended Execution Order (§9) names GOV-2/TASK-06 first in reading
order ("start immediately... smallest possible scope") but separately states starting SEC-2/
TASK-09 early is what "shortens the critical path" (§9 step 3, §3 step 1). TASK-06 is safe,
trivial, and should also start immediately — but it sits on Chain 4 (→TASK-15), which is not
the longest chain. TASK-09 sits on Chain 1, which is tied for the longest engineering chain
and is also the one prerequisite for TASK-04, which is itself required for Gate C. Starting
the longest-lead item first is the standard reason to prioritize it; starting TASK-06 same-
day, in parallel, costs nothing since neither task shares a dependency or an engineer's
critical path slot with the other. This is the same interpretive choice the Master Plan
itself makes for the whole plan (§9 steps 2–3); this section is naming the same task the
Master Plan already implies, not inventing a new one.

**Exact file locations** (none of the three source documents cites line numbers for the
9-handler finding; the table below was produced by one targeted `grep` of `server.ts` at
`HEAD = bd31707` this session, solely to make this section concrete — not a new audit of the
finding itself, which is unchanged from the source documents):

| Route | Handler location | Query location |
|---|---|---|
| `GET /api/check-table` | `server.ts:193` | `server.ts:195–197` |
| `GET /api/check-users-count` | `server.ts:205` | `server.ts:207–208` |
| `GET /api/vault/documents` | `server.ts:275` | `server.ts:277–278` |
| `POST /api/vault/documents` | `server.ts:286` | `server.ts:289–290` |
| `GET /api/vault/rd` | `server.ts:301` | `server.ts:303–304` |
| `GET /api/vault/timeline` | `server.ts:312` | `server.ts:314–315` |
| `GET /api/vault/phases` | `server.ts:323` | `server.ts:325–326` |
| `GET /api/vault/decisions` | `server.ts:334` | `server.ts:336–337` |

**Disclosed assumption — the count does not fully reconcile.** The grep above finds exactly
**8** handlers matching the pattern the source documents name ("`/api/check-*`,
`/api/vault/*`"), not 9. A 9th pooled-connection call site exists at `GET /api/migrate`
(`server.ts:226`, query at `229, 248–255`), but it is `devOnly`-gated and 404s in production
(Readiness Report §6a) and is not named by the "`/api/check-*`, `/api/vault/*`" pattern
description. Folding it in to reach "9" is this report's own inference to reconcile the
source documents' stated count, not a fact either source document states — a reader should
treat the 9th handler's identity as unconfirmed, and TASK-09's exit criterion as covering, at
minimum, the 8 handlers listed in the table above.

**Expected deliverable:** each of the 7 `/api/vault/*` handlers above (the two `/api/check-*`
routes are diagnostic-only, not tenant-scoped data, and `/api/migrate` is devOnly — the
tenant-scoped subset that actually needs an RLS-respecting rewrite) reads/writes through the
Supabase client (`requireAuth`-bound, RLS-enforcing) instead of `getPool()`'s pooled
`DATABASE_URL` connection, so that Postgres RLS — not application code — is the only tenant
isolation mechanism in the path, matching TASK-09's exit criterion verbatim.

**Risks:** Medium–High per the backlog's own rating — this is a recurring, previously-flagged
architecture violation across 9 handlers, not a single isolated fix; the source documents
explicitly warn (re: the related TASK-04) that a partial or rushed version of this kind of
migration "looks fixed, isn't." The vault routes currently have no `organization_id`
scoping at the RLS-policy level either (Gate C item GC-3) — TASK-09 alone does not close
GC-3, it only removes the pooled-connection bypass that would otherwise make a future RLS
policy decorative. Doing TASK-09 before TASK-03's Council decision is deliberate and correct
per the Master Plan (§9 step 3: "it does not wait on the GC-3 decision, only the GC-3
*implementation* waits on it"), not a sequencing error.

**Validation method:** per the constitution's evidence table, source-level inspection ("the
code now uses `supabase.from(...)` instead of `dbPool.query(...)`") is insufficient on its
own. Required evidence is runtime: an authenticated request from Tenant A against
`/api/vault/*` for a resource actually owned by Tenant B must return no rows (RLS denial),
demonstrated live — not asserted from the diff.

---

## 5. Gate C as Prerequisite — Confirmed Where the Source Documents Say So, Named as Absent Where They Don't

| Downstream track | Confirmed mandatory prerequisite? | Evidence |
|---|---|---|
| **Communication Hub** | **Yes** | Readiness Report §12: "Starting Communication Hub... work before Gate C closes would mean building new capability on top of a foundation this repository's own governance has already declared unstable." Master Plan places CH-1..3 as dependency-graph nodes explicitly outside Phase 1–3 (the path to Production Ready), consistent with — not contradicting — Gate C being a prerequisite for starting that track at all. |
| **Agent Runtime** | **Yes** | Same Readiness Report §12 citation, explicitly naming Agent Runtime alongside Communication Hub. Master Plan §1d/§9 frames AR-1..3 the same way as CH-1..3. |
| **Production Certification** | **Yes — definitionally** | Master Plan §7's first checkable criterion is "Gate C shows PASS, not BLOCKED." The Readiness Report's FINAL CLASSIFICATION is NOT PRODUCTION READY *specifically and solely* because Gate C is BLOCKED (the report is explicit that this holds "independent of how well the API layer scores... or how many modules... are genuinely real"). TASK-18's own exit criterion re-verifies this same criterion set. |
| **Marketplace Integration** | **Cannot be confirmed from these documents** | "Marketplace Integration" does not appear as a tracked component, blocker ID, epic, or workstream in any of the three source documents. The only "marketplace" reference across all three is incidental: the Readiness Report's §3 note that `/database`'s hardcoded table list "belong[s] to an unrelated marketplace schema" — a data hygiene observation about `DatabasePage.tsx`, not a description of a Marketplace Integration initiative. Per the constitution's evidence discipline, this is reported as **absent from scope**, not inferred to be either gated or ungated by Gate C. |

---

## 6. Final Classification

# READY FOR EXECUTION

All 18 tasks are individually well-formed (dependency, owner, effort, runtime-evidenced exit
criterion). No circular dependencies exist. The operative execution artifacts — the Full
Backlog Table (`BELL24H_OS_EXECUTION_BACKLOG.md` §7) and its consolidated critical-path
formula (§3, final line) — are internally consistent with each other and with the Master
Plan's §7 Production Readiness Criteria; an engineer executing directly from the Full
Backlog Table would not be misled by any defect found in this audit.

This classification carries the following **named corrections and conditions**, none of
which block starting engineering work today, all of which should be resolved before this
backlog is treated as the final word on what "done" means:

1. **Correct the self-contradiction in `BELL24H_OS_EXECUTION_BACKLOG.md` §3** (Section 2.1,
   above) — the narrative dependency-chain listing should match the consolidated formula and
   the Full Backlog Table's TASK-18 `Dependency` column, which are the two that actually
   govern execution.
2. **Decide, explicitly, whether TASK-12 and TASK-13 are meant to gate Production Ready.**
   As currently scoped (faithfully inherited from the Master Plan's own §7), they do not —
   meaning two acknowledged, currently-live production defects (SEC-5, SEC-6) can remain
   open when TASK-18 passes. This may be an intentional, acceptable scope choice; it is not
   currently a *stated* one anywhere in the three documents, and should become one.
3. **Give TASK-07 the same decision/implementation split TASK-14 and TASK-16 already have**
   — a named product decision (wire vs. mark-and-hide) with its own owner and, ideally, a
   target date, ahead of the engineering task it currently unscopes.
4. **Do not assume Gate C's prerequisite relationship extends to "Marketplace Integration"**
   — no such initiative is defined in any of the three source documents; treat this as an
   open question for whoever raised it, not as answered by this audit.

None of the four conditions above changes the Section 3 critical path, the Section 4
recommended first task, or the Section 5 Gate C findings — they are corrections to the
backlog's own internal documentation and scope statements, not blockers to beginning TASK-09
and the Owner/Council kickoff items today.

**Why 2.2 does not tip this to BACKLOG REQUIRES REVISION.** That finding is the most
serious one in this audit — it means TASK-18 can pass, and PRODUCTION READY can be declared,
while two acknowledged, currently-live security defects (SEC-5, SEC-6) remain open. This
report weighed that against the same no-partial-credit discipline this session applied to
Gate C, and did not soften it: the reason this stays READY FOR EXECUTION rather than
REQUIRES REVISION is that the defect is in the *verification gate's* completeness
(what TASK-18 checks), not in the *execution sequence* itself — the Full Backlog Table's
Sprint 2 assignment still schedules TASK-12 and TASK-13 as real, intended work, and nothing
in the backlog instructs anyone to skip them. An engineer following the sprint sequence as
written would still do the work; only the automated "did we actually verify it" step would
fail to notice if they didn't. That is a real gap in the plan's rigor, named as Condition 2
above, not a reason to withhold the whole backlog from execution — but it is close enough to
that line that it should not be re-litigated silently in a future pass: if Condition 2 is
not resolved before TASK-18 is actually run, this report's classification should be treated
as provisional on that point.

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GyjerP42mTVzzK2ZkSeRCf
