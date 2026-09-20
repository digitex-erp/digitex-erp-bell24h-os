# Gate C.2C — Ratification Review

**Repository:** `digitex-erp/digitex-erp-bell24h-os`
**Branch:** `feature/p0-remediation`
**Date:** 2026-09-20
**Type:** Governance review only. No code changed to produce this document.
**Source documents used, exclusively (per this mission's own scope constraint):**
`ARCHITECTURE_DECISION_RECORDS.md` (ADR-011), `BELL24H_OS_RUNTIME_REALITY_CERTIFICATION.md`,
`BELL24H_OS_REMEDIATION_MASTER_PLAN.md`, `BELL24H_OS_P0_REMEDIATION_IMPLEMENTATION_PLAN.md`,
`BELL24H_OS_MASTER_ARCHITECTURE_RECONCILIATION.md`. No new repository discovery performed.

---

## What this document is — and is not

This is a **recommendation package for the project owner / Architecture Council**, not a
ratification. ADR-011 itself is explicit that adopting its proposed definition requires the
repository to "commit this text... as an authoritative Gate C record and re-authorize the
work explicitly" — and `BELL24H_OS_EXECUTION_BACKLOG.md`'s TASK-02 independently states the
same principle in different words: *"no engineering session can self-ratify its own
governance criteria."* Nothing below constitutes that ratification. It presents the
evidence and a recommendation; the decision itself is named at the end as an action for the
owner/Council to take.

---

## Executive Summary

ADR-011 (frozen 2026-08-04, part of PS-02) proposed a four-part formal definition for Gate
C.2C — "tenant isolation is enforced on every request path" — and left it **OPEN**,
requiring explicit ratification before any `IS-xx` implementation sprint could begin. No
later document in this repository records that ratification, yet multiple sprints have run
since, including the one that produced this document's own supporting evidence.

Two separable questions exist, and conflating them is the single biggest risk in this
review:

1. **Is ADR-011's proposed definition the right bar to hold this project to?** — a
   procedural question, cheap to answer, and this review recommends **yes**.
2. **Does the project currently meet that bar?** — a substantive question, and the honest
   answer, checked against current evidence, is **no — 0 of 4 criteria are met.**

Ratifying (1) does not and must not imply (2). Treating a "yes" to the first as a "pass" on
the second would be exactly the kind of fabricated-pass this repository's own constitution
skill repeatedly warns against — in the opposite direction from the fabricated *success
paths* found and removed elsewhere this session, but the same failure mode: declaring
something true because declaring it is easier than the work of making it true.

---

## What Gate C.2 required

ADR-011's proposed text, quoted in full for reference:

> **C.2C — Tenant isolation is enforced on every request path.**
> Closed when **all** hold, each with a runtime artifact:
> 1. No request handler uses a pooled `DATABASE_URL` connection.
> 2. Cross-tenant isolation is demonstrated (org B query against org A rows → zero rows).
> 3. Every tenant table carries `organization_id` with a matching RLS policy, or is
>    explicitly exempted by a committed ADR.
> 4. A server-side authorization primitive exists and is applied to every route performing
>    a privileged action.

Explicitly **not** part of C.2C per the same ADR: the `ai_providers.api_key` REVOKE/rotation
(tracked separately as C.2B), the Knowledge Vault tenancy decision (ADR-010), and the
Schema Sync error (a DevOps concern).

## Why it was never ratified

No mechanism failure — simply no sprint since Aug 4 treated it as a required step before
proceeding. `NEXT_SPRINT_RECOMMENDATION.md` (PS-01, pre-dating ADR-011) correctly
recommended "Gate C Completion" work over jumping to `PS-02`/`IS-01`; PS-02 then produced
ADR-011 itself but froze the architecture without closing the loop it had just opened. Every
subsequent sprint — the Sep 14 audits, this session's RLS investigation, the AI Router
certification, and today's Phase 2/3 remediation — inherited that open state without
re-raising it. This document is the first point in the repository's history where it is
raised again, not because anything broke, but because the Master Architecture Reconciliation
(Section 0) surfaced it while answering a different question.

## What evidence now exists, per criterion

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | No handler uses pooled `DATABASE_URL` | **NOT MET** | `MASTER_MODULES.md` "Known issues" #2: 9 handlers still use the pooled connection, bypassing RLS. Unchanged by this session's work — Phase 2/3 touched worker/queue code, not these handlers |
| 2 | Cross-tenant isolation demonstrated | **NOT MET** | `CANONICAL_ARCHITECTURE.md`: "the highest-value untested claim in the system." Still never runtime-demonstrated as of this session. The `42P17` RLS recursion bug found this session (Phases 4–13E of the broader conversation) makes this *harder* to demonstrate today than when ADR-011 was written, not easier — some cross-org queries now error outright rather than merely being untested |
| 3 | Every tenant table has `organization_id` + matching RLS, or an ADR exemption | **NOT MET** | `permissions` table: no RLS at all (VERIFIED). Knowledge Vault's 5 tables: no `organization_id` column on any of them, `USING (true)` public-read policy (VERIFIED, ADR-010 still open — no exemption ADR exists, only an *unresolved* one) |
| 4 | Server-side authorization primitive exists and is applied | **NOT MET** | `hasPermission`/`checkRole`/`authorize` → 0 hits repository-wide, confirmed independently by three separate audits (PS-01, Sep 14, this session's Master Reconciliation). `role: 'ADMIN'` remains hardcoded client-side for every user |

**0 of 4 criteria met.** This has not regressed since ADR-011 was written — it was already
0 of 4 then — but it has also not improved, despite six weeks and multiple substantial
sprints landing in the meantime (AI Router expansion, Worker Fleet activation, fabrication
removal). None of that work touched tenant-isolation enforcement, because none of it was
scoped to.

## What decision must be recorded

Two decisions, kept explicitly separate per the Executive Summary:

**Decision A — Ratify ADR-011's proposed definition as the authoritative Gate C.2C bar.**
This is the procedural step ADR-011 itself asks for. It costs nothing technically — it
does not require any of the 4 criteria to already be met — and it converts an ambiguous
"someone should probably formalize this" into a named, committed record that future sprints
can be measured against, including the Sprint 3 (RBAC + durable audit) already planned in
the Master Reconciliation's roadmap.

**Decision B — Acknowledge Gate C.2C is NOT closed, and is not blocking current work by
owner choice, not by oversight.** The alternative to acknowledging this honestly is to keep
leaving it silently unaddressed, which is the actual status quo today and the thing this
review exists to stop. This does not require immediately staffing TASK-09/TASK-10 (the
engineering work to close it) — it requires recording, in a committed document, that the
gap is known, named, and deliberately sequenced (per the Master Reconciliation's roadmap,
Sprint 3) rather than accidentally ignored.

---

## Risks

| Risk | If Decision A is skipped | If Decision B is skipped |
|---|---|---|
| Governance drift | ADR-011 stays permanently "proposed," and the next audit finds the same open item again, unchanged, costing re-discovery time each time | Future sprints may assume tenant isolation is closer to done than it is, since nothing records that it explicitly isn't |
| False confidence | Low direct risk — the definition itself makes no claim about current state | **High** — this is the exact failure mode the fabricated-success-path fixes earlier this session exist to prevent, applied to governance instead of code |
| Merge/release risk | None directly | A future release decision could treat "Gate C" as closed by default, absent a document saying otherwise |

Neither decision, on its own, changes what code does today. Both change what the project
is honest with itself about.

---

## Approval Recommendation

**To the project owner / Architecture Council:**

1. **Approve Decision A** — ratify ADR-011's proposed C.2C definition as-is. No changes to
   its text are recommended; the four criteria are well-scoped and already cross-referenced
   by ADR-004, ADR-006, and ADR-010 Option B, so redefining them now would create more
   rework than it saves.
2. **Approve Decision B** — record, in this same sign-off, that Gate C.2C remains open with
   0 of 4 criteria met, and that closing it is scheduled as Sprint 3 of the roadmap in
   `BELL24H_OS_MASTER_ARCHITECTURE_RECONCILIATION.md`, not abandoned.
3. **Do not treat this document as ratification.** A dated sign-off line, added by the
   owner or Council below this section (or in a separate short addendum), is what converts
   this from a recommendation into a ratified record.

**Sign-off (to be completed by the owner/Council, not by this session):**

```
Decision A (ratify definition):  [ ] Approved   [ ] Rejected   [ ] Amended — describe:
Decision B (acknowledge open, scheduled Sprint 3): [ ] Approved   [ ] Rejected
Signed:
Date:
```

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GyjerP42mTVzzK2ZkSeRCf
