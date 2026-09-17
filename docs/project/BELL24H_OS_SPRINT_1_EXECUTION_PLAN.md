# BELL24H_OS — SPRINT 1 EXECUTION PLAN

**Repository:** `digitex-erp/digitex-erp-bell24h-os` (`HEAD = bd31707`)
**Phase:** Sprint 1 Execution Planning — **planning only, no implementation**
**Date:** 2026-09-14
**Sources used, exclusively:** `BELL24H_OS_PRODUCTION_READINESS_REPORT.md`,
`BELL24H_OS_REMEDIATION_MASTER_PLAN.md`, `BELL24H_OS_EXECUTION_BACKLOG.md`
(all `docs/project/`). No new audit performed; no code written; nothing built.

**Scope note:** the Execution Backlog assigns three tasks specifically to "Sprint 1"
(`TASK-06`, `TASK-08`, `TASK-09`) and six further tasks to an **"Ongoing, from day
one"** track that is deliberately *not* sprint-boxed (`TASK-01`, `TASK-02`, `TASK-03`,
`TASK-05`, `TASK-14`, `TASK-16` — the owner/Council/Product decisions). This plan
includes both: the three sprint-boxed engineering tasks as Sprint 1's core deliverable,
and the six ongoing-track items as **Sprint 1's kickoff actions** — they have no
dependency, so the backlog's own logic says they should be triggered starting Sprint 1,
even though their *completion* isn't timeboxed to it. This isn't a new scoping decision;
it's making the backlog's existing two-tier structure explicit for a single sprint.

---

## 1. Sprint 1 Goals

1. Close the two cheapest, highest-trust-impact items in the entire backlog — remove the
   hardcoded fake status indicators and resolve the one orphaned page — with zero
   dependency risk and same-day completion.
2. Start the single longest-lead engineering item on the critical path
   (`TASK-09`, the RLS-bypass migration) as early as possible, since it gates `TASK-04`
   in Sprint 3 and the Master Plan's own recommended execution order calls for starting
   it early specifically to shorten the overall path to Production Ready.
3. Trigger every owner/Council/Product decision that has no engineering dependency,
   since these have the least predictable lead time of anything in the backlog and
   nothing gains from delaying their start.

## 2. Sprint 1 Tasks

### Core (sprint-boxed, engineering)

| Task ID | Task | Epic |
|---|---|---|
| TASK-06 | Remove/replace the 3 hardcoded-fake-status locations (Dashboard's infra/AI cards, `AdminService.getSystemHealth()`, `DatabasePage`'s unconditional `"Active"`) | EPIC-02 — Governance Trust Repair |
| TASK-08 | Route or remove the orphaned `IndustryDashboardPage.tsx` | EPIC-02 — Governance Trust Repair |
| TASK-09 | Migrate the 9 pooled-`DATABASE_URL` handlers off the RLS-bypassing connection pattern | EPIC-03 — Security & Tenant-Isolation Engineering |

### Kickoff (ongoing track, owner/Council/Product — triggered in Sprint 1, not timeboxed to it)

| Task ID | Task | Epic |
|---|---|---|
| TASK-01 | Execute the drafted `REVOKE`/rotation SQL on `ai_providers.api_key` | EPIC-01 — Gate C Closure |
| TASK-02 | Sign off on the ratified C.2C closure record | EPIC-01 — Gate C Closure |
| TASK-03 | Council decision: Option A/B/C for Knowledge Vault tenancy | EPIC-01 — Gate C Closure |
| TASK-05 | Perform + record one live login verification | EPIC-01 — Gate C Closure |
| TASK-14 | Decide deployment scope (ship the SPA for real, or stay documented API-only) | EPIC-04 — Frontend Deployment |
| TASK-16 | Decide orchestration hosting mechanism (Vercel Cron / separate worker / external queue) | EPIC-05 — Orchestration Baseline |

## 3. Task Order

**No dependency exists among any of Sprint 1's nine tasks** — every one has `Dependency:
None` in the Execution Backlog. All nine can start on Day 1 of the sprint. Recommended
order reflects capacity and urgency, not correctness constraints:

1. **Day 1, in parallel:** trigger all six kickoff-track items (`TASK-01`, `TASK-02`,
   `TASK-03`, `TASK-05`, `TASK-14`, `TASK-16`) — these require no engineering time to
   *start* (a request/decision is initiated, not coded), so there is no reason to
   sequence them behind anything else.
2. **Day 1, in parallel with the above:** start `TASK-09` — it is the largest item in
   Sprint 1 (3–5 days) and the one most likely to run past a single sprint boundary if
   started late; starting it first, not last, is what shortens the critical path (Master
   Plan §9, step 3; Execution Backlog §8).
3. **Any point in the sprint, whenever engineering capacity opens between `TASK-09`
   work:** `TASK-06` and `TASK-08` — both same-day-sized (XS, <1 day each), independent
   of each other and of `TASK-09`, no urgency difference between them.

## 4. Dependencies

**Inbound (what blocks Sprint 1's tasks):** none. This is by design — Sprint 1 was
populated specifically with the backlog's zero-dependency items (Execution Backlog §6,
Blocked Tasks: all nine listed here appear in the "immediately startable" set).

**Outbound (what Sprint 1's tasks block, downstream):**

| This sprint's task | Blocks (later sprint) |
|---|---|
| TASK-09 | `TASK-04` (Sprint 3 — Knowledge Vault tenancy implementation) |
| TASK-03 | `TASK-04` (Sprint 3, jointly with `TASK-09` above) |
| TASK-14 | `TASK-15` (Sprint 3–4 — execute real deployment) |
| TASK-16 | `TASK-17` (Sprint 4 — implement job-queue dequeue) |
| TASK-01, TASK-02, TASK-04*, TASK-05 | Gate C reaching **PASS** (*TASK-04 depends on this sprint's TASK-03/TASK-09, not itself a Sprint 1 task) |

Slippage on any kickoff-track item (1–2, 14, 16) or on `TASK-09` directly lengthens the
critical path identified in the Execution Backlog (§1/§4) and the Readiness
Certification (§1) — this is the mechanism by which Sprint 1's punctuality affects every
later sprint, not a new risk invented for this plan.

## 5. Estimated Effort

| Task ID | Effort (from Execution Backlog §7) |
|---|---|
| TASK-06 | XS (<1 day) |
| TASK-08 | XS (<1 day) |
| TASK-09 | M (3–5 days) |
| TASK-01, TASK-02, TASK-05 | Owner — minutes/hours once actioned, not an engineering estimate |
| TASK-03, TASK-14, TASK-16 | Owner/Council/Product — decision-latency, not an engineering estimate |

**Sprint 1 engineering total: ~3–7 person-days** (XS + XS + M). Consistent with a
single ~1-week sprint **only if `TASK-09` starts on day one**; if it starts late in the
sprint, the Execution Backlog's own sequence (§8) already anticipates it carrying into
Sprint 2 ("finish TASK-09"), which this plan does not treat as a Sprint 1 failure — it
is the backlog's own accounted-for outcome, not a new risk.

## 6. Exit Criteria

Restated from Execution Backlog §7, unchanged:

| Task ID | Exit Criterion |
|---|---|
| TASK-06 | Repo-wide grep for the specific hardcoded strings (`"42 instances"`, unbacked `"Operational"` badges, unconditional `"Active"`) returns zero hits outside legitimate UI copy |
| TASK-08 | `IndustryDashboardPage` is either reachable via navigation or removed from the codebase — not left in limbo |
| TASK-09 | None of the 9 handlers construct a raw pooled connection for tenant-scoped reads/writes; RLS is the only isolation mechanism in the path |
| TASK-01 | `information_schema.role_column_grants` no longer lists `anon`/`authenticated` for `ai_providers.api_key`; rotation dated and recorded |
| TASK-02 | A committed, non-"DESIGN" file exists stating C.2C's criteria, with an explicit sign-off line |
| TASK-03 | A recorded tenancy decision exists in a committed doc |
| TASK-05 | A dated, concrete login result: "confirmed working" or "confirmed broken: `<error>`" |
| TASK-14 | A committed, dated deployment-scope decision exists |
| TASK-16 | A committed decision exists, matching the three hosting options already framed in the Communication Hub plan |

## 7. Risks

Carried forward from the Execution Backlog and Readiness Certification, applied to this
sprint specifically — nothing invented new here:

- **`TASK-09` is Sprint 1's highest-risk item on its own terms** — "Medium–High" per the
  backlog, because it touches a previously-flagged, recurring architecture violation
  across 9 separate handlers (`/api/check-*`, `/api/vault/*`). A partial or rushed
  migration risks the exact failure mode the source documents already warned about for
  the related `TASK-04`: "looks fixed, isn't."
- **The six kickoff-track items are this sprint's least predictable risk, not its
  smallest.** All are "Owner effort: Low" in isolation, but the Readiness Certification
  (§1) identified owner/Council response time — not engineering effort — as the more
  likely actual pacing constraint on the whole remediation timeline. A Sprint 1 that
  completes its three engineering tasks but fails to actually trigger these six items
  would look successful in the sprint review while quietly deferring the plan's real
  bottleneck.
- **`TASK-03` specifically carries the most schedule risk of the six** — the Master
  Plan itself notes no committed decision-maker or date exists for the Vault tenancy
  Council decision anywhere in the source documents; this is the item most likely to
  stall `TASK-04` in Sprint 3 if it doesn't land during Sprint 1.
- **No risk in this sprint touches Communication Hub or Agent Runtime** — confirmed by
  the Readiness Certification (§6): nothing in the 18-task backlog is blocked by either,
  and nothing in Sprint 1 creates a new dependency on them.

## 8. Definition of Done

Sprint 1 is done when:

- [ ] `TASK-06`'s exit criterion is independently verified (grep returns zero hits) —
      **must be complete**, not merely started.
- [ ] `TASK-08`'s exit criterion is independently verified — **must be complete**.
- [ ] `TASK-09` is either complete against its exit criterion, **or** in a clearly
      evidenced in-progress state with a named remaining scope, consistent with the
      Execution Backlog's own expectation that it may carry into Sprint 2 — **partial
      completion with a clear handoff is an acceptable Sprint 1 outcome for this task
      specifically; the other two are not.**
- [ ] All six kickoff-track items (`TASK-01`, `TASK-02`, `TASK-03`, `TASK-05`, `TASK-14`,
      `TASK-16`) have been **formally requested/initiated** — a dated record exists that
      each was put in front of the responsible owner/Council. **Completion of these
      items is explicitly not required for Sprint 1 to be done** — only their initiation
      is, per the backlog's own "ongoing, not sprint-boxed" design. Silence (never
      requested) is the only failure mode Sprint 1 is accountable for here.
- [ ] No hardcoded status indicator, no orphaned route, and no newly-introduced
      pooled-connection RLS bypass exists in the diff produced this sprint — i.e.,
      Sprint 1's own work doesn't reintroduce anything the backlog is trying to remove.

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GyjerP42mTVzzK2ZkSeRCf
