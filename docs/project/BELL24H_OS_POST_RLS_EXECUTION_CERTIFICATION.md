# BELL24H_OS POST-RLS EXECUTION CERTIFICATION

**Repository:** `digitex-erp/digitex-erp-bell24h-os`
**Phase:** Post-RLS Execution Certification (Phase 7) — **audit only, no code/SQL
modified, no migration created, nothing deployed**
**Date:** 2026-09-14

**This document is intentionally left UNCOMMITTED**, per this turn's explicit "Do NOT
commit." (This turn does not say "do not modify repository files," unlike Phase 5/6, so
writing the file itself is in scope — only the commit step is withheld.)

---

## The gap this document must not paper over, stated first

This mission's own instruction says **"Assume the approved RLS remediation SQL has now
been executed in Supabase."** That is a hypothetical for the purpose of drafting a
certification procedure in advance — it is not a claim, and this document does not treat
it as a claim, that the SQL was actually run. **No screenshots, no `/system/diagnostics`
output, and no execution confirmation of any kind were provided this turn**, despite that
being exactly what the prior turn's own "Phase 6 → Phase 7" handoff plan called for
("Execute the approved SQL → Run Certification Dashboard → Capture screenshots → Return to
Claude with results"). That handoff has not happened yet.

**What this document is:** a ready-to-apply certification procedure — checklist, pass/fail
criteria, and the two-branch readiness accounting below — that can be executed against
real results the moment they exist.
**What this document is not:** confirmation that Dashboard, Knowledge Vault, Video
Studio, Image Studio, or the Certification Dashboard are actually working right now. That
remains unverified in this session, exactly as it was before this turn.

The underlying RLS fix itself (the two SQL statements) has already been independently
re-derived and approved three times this session (Phase 4's Certification, Phase 4's
Execution Plan, Phase 5's Implementation Package, Phase 6's Readiness Validation) — this
document does not re-litigate that approval. What remains genuinely open is **deployment
readiness**, which this document answers directly in §7, and it is a different question
from "is the SQL correct."

---

## 1. Post-Execution Verification Checklist

Run in this order once the SQL has actually been executed:

1. **Catalog check** (Supabase SQL Editor): confirm the installed policy text matches
   exactly —
   ```sql
   SELECT polrelid::regclass AS table_name, polname, pg_get_expr(polqual, polrelid) AS using_expr
   FROM pg_policy
   WHERE polrelid IN ('public.profiles'::regclass, 'public.organizations'::regclass)
   ORDER BY polrelid, polname;
   ```
2. **Foundation Certification Dashboard**: load `/system/diagnostics` while signed in as a
   real user. Screenshot or copy the `db`, `org`, `session`, `jwt`, and `allPassed` rows.
3. **Dashboard**: load `/dashboard`. Confirm metric cards render real counts, not an error
   state.
4. **Knowledge Vault**: load `/knowledge-vault`. Confirm all 5 components load real data
   (not the `authedFetchJson` 401 error state).
5. **Video Studio / Image Studio**: load each. Confirm project/job lists load (org-context
   check) — do **not** interpret "Generate" as a pass/fail signal here; that capability is
   out of this checklist's scope (§4).
6. **Backend spot-check** (optional, needs a real bearer token): `GET
   /api/vault/documents` — confirm it no longer returns `403 organization_unresolved`.

## 2. Pass / Fail Criteria

| Check | Pass | Fail |
|---|---|---|
| Catalog check | Both `using_expr` values contain `get_current_org_id()`, not a raw `profiles` subquery | Either still shows the old inline subquery text |
| `db` / `org` diagnostics | Both `status: 'pass'` | Either shows `'fail'` or a `42P17`/recursion message in `details` |
| `allPassed` | `true` while a real user is signed in | `false` while signed in (a real fail); `false` while signed out is expected, not a fail (§4 usage precondition) |
| Dashboard | Metric cards show real numbers | Error state, blank cards, or a thrown console error |
| Knowledge Vault | All 5 components show real rows or a genuine "empty" state | Any component shows the 401/session-error state introduced by the earlier Authorization-header fix |
| Video/Image Studio | Project/job list loads | List fails to load or throws — **not** evaluated by whether "Generate" produces output |

## 3. Certification Procedure

1. Owner executes the two approved SQL statements in the Supabase SQL Editor (this session
   does not execute SQL, per every prior phase's constraint).
2. Owner (or this session, if browser automation becomes available) runs the checklist in
   §1 and captures each result — screenshot, copied text, or `curl` output.
3. Results are returned to this session.
4. This session applies §2's pass/fail criteria to the actual results — not to the
   predicted results in §5 below — and issues a genuine Post-Execution Certification, only
   at that point converting "predicted" language into "confirmed" language.
5. Until step 4 happens, any statement that a feature "is now working" is not supportable
   by this session's evidence and should not be made.

## 4. Remaining Blockers After RLS Fix

Unchanged from Phase 4/5/6 — not re-derived here, only carried forward, since nothing
about them depends on whether the RLS fix specifically succeeded:

- **Video/Image Studio generation capability** — still 0%; no provider, `JobWorker`
  disabled. Unrelated to RLS.
- **TASK-14** — no recorded owner decision to deploy. Unrelated to RLS.
- **Live routing/render verification** — still unattempted this session (environment
  limitation: browser automation unavailable). Unrelated to RLS, though previously
  *compounded* by it — the RLS fix removes that compounding, it doesn't perform the
  verification itself.
- **`organizations`' missing INSERT/UPDATE/DELETE policies**, **`vault_documents`' missing
  INSERT policy** — pre-existing, separate gaps, not touched by this remediation.
- **Gate C's governance items, 848.8 kB bundle size** — pre-existing, unrelated.
- **Foundation Certification Dashboard's `allPassed` for a signed-out visitor** — expected
  `false`, not a defect (§2).

## 5. Updated Deployment Readiness % — two branches, not one number

Collapsing this into a single number would misrepresent what is and isn't actually known
this turn — the same discipline the Re-Verification document already applied to its
60%/0% split.

**Branch A — Confirmed, this session's actual evidence (unchanged from the last
Re-Verification):** still the same items as before; the RLS-blocked items (7-8 in that
document's checklist) remain formally unconfirmed as fixed, because no execution evidence
exists yet. **This number has not moved this turn.**

**Branch B — Conditional, IF the assumed execution succeeded exactly as designed:**
Dashboard, Video/Image Studio's org-context loading, Knowledge Vault's 5 read components,
and the Certification Dashboard's `db`/`org` checks would all move from blocked to
working — closing the single largest functional gap identified this session. Checklist
completion would rise from the prior 60% (6/10) to roughly 80% (8/10) — TASK-14 and live
render verification remain the two open items even in this best case.

**Do not read Branch B as this session's certified status.** It is the predicted result
of a procedure this session cannot itself execute or observe, offered so the Owner knows
what to expect when running the checklist in §1 — not a substitute for running it.

## 6. Updated Engineering Hours Estimate

Unchanged from prior phases: **0 hours** for the SQL (Owner-executed, already complete
per this turn's assumption); **~1 hour** to run and confirm the §1 checklist once real
access exists; **~2-4 hours** for the still-separate live render/routing verification
pass; TASK-14 has no engineering-hour equivalent. Total remaining engineering time for
this deploy's scope, assuming Branch B holds: **~3-5 hours**, down from the previously
estimated ~5-9 (the SQL-adjacent items drop out once real confirmation lands).

## 7. Final Go / No-Go Decision

**Answering deployment readiness — the question actually still open — not re-approving
the SQL, which was already GO'd three times:**

# NO-GO for deployment

Unchanged by this turn, and not because the RLS fix is in doubt — it isn't. Two
independent reasons hold regardless of whether the assumed SQL execution succeeded:

1. **No execution evidence exists in this session yet** (this document's opening
   section) — Branch A of §5 has not moved, and a deployment decision should not be made
   on Branch B's predicted state.
2. **TASK-14 and live render verification remain open even in Branch B's best case** —
   both are independent of RLS and unaffected by this fix succeeding.

---

## A. What should be working immediately after SQL execution (predicted, Branch B)

Dashboard (fully); Video Studio and Image Studio (org-context/data-loading only, not
generation); Knowledge Vault (all 5 read components); Foundation Certification Dashboard's
`db`/`org` checks (with a real signed-in session).

## B. What remains blocked even after SQL execution

Video/Image Studio generation (0%, separate gap); TASK-14; live routing/render
verification; `organizations`'/`vault_documents`' missing write policies; Gate C items;
bundle size; `allPassed` for a signed-out visitor (expected, not a defect).

## C. Exact next critical-path step after RLS remediation

**Convert this document's Branch B (predicted) into Branch A (confirmed):** Owner
executes the two SQL statements (if not already done), runs the §1 checklist, and returns
the actual results — screenshots or copied diagnostic output — to this session. Only then
can a genuine Post-Execution Certification be issued in place of this procedural one.
Independently of that, and not blocked by it: closing TASK-14 and obtaining a live
authenticated render/routing pass remain the two items that would still gate deployment
even after RLS is confirmed fixed.

---
*(Deliberately uncommitted this turn — see note at top.)*
