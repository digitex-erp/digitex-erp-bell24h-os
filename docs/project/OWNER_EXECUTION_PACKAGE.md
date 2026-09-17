# OWNER EXECUTION PACKAGE — RLS Recursion Fix (`profiles` / `organizations`)

**Repository:** `digitex-erp/digitex-erp-bell24h-os`
**Purpose:** one self-contained package for the Owner to run manually in the Supabase SQL
Editor — no other document needs to be open at the same time.
**Prepared by:** Claude Code, audit/preparation only — **no SQL executed by this session,
no secret requested or seen, no code modified, no migration created, no commit made.**
**Source documents this package consolidates (not superseded, just combined):**
`BELL24H_OS_RLS_REMEDIATION_CERTIFICATION_AND_EXECUTION_PLAN.md`,
`BELL24H_OS_POST_RLS_EXECUTION_CERTIFICATION.md`,
`BELL24H_OS_FOUNDATION_CERTIFICATION_BLOCKER_AUDIT.md` (`1c0f79c`),
`..._INVESTIGATION.md` (`050887f`).
**Date:** 2026-09-14

**This document is intentionally left UNCOMMITTED**, per this turn's explicit "Do NOT
create commits."

---

## 0. What this fixes, in one sentence

`public.profiles`' own `SELECT` policy queries `public.profiles` from inside itself,
causing Postgres error `42P17` ("infinite recursion detected in policy for relation
profiles") for every authenticated user; the fix below routes that check through the
existing, already-proven `get_current_org_id()` function instead.

---

## 1. Exact SQL block to execute

Copy this entire block into the Supabase SQL Editor and run it as one execution:

```sql
-- =========================================================
-- RLS RECURSION FIX — profiles + organizations
-- Two independent policy substitutions. No data is touched.
-- =========================================================

-- Statement 1 — REQUIRED. Root cause.
DROP POLICY IF EXISTS "Users can view own profile or org members" ON public.profiles;
CREATE POLICY "Users can view own profile or org members" ON public.profiles
FOR SELECT USING (
  id = auth.uid() OR (organization_id IS NOT NULL AND organization_id = public.get_current_org_id())
);

-- Statement 2 — not causally required (Statement 1 alone already unblocks this table's
-- reads too), included for consistency with the rest of the schema and to avoid leaving
-- an unsafe pattern as a copy-paste template for the future.
DROP POLICY IF EXISTS "Users can view their own organization" ON public.organizations;
CREATE POLICY "Users can view their own organization" ON public.organizations
FOR SELECT USING (
  id = public.get_current_org_id()
);
```

Both statements reuse `public.get_current_org_id()`, a function that already exists in
this schema and is already used safely by 30 other tables — nothing new is introduced.

## 2. Exact rollback SQL block

Run this only if something looks wrong after execution and you want to restore the exact
prior state (see §6 for when that would actually be warranted):

```sql
-- =========================================================
-- ROLLBACK — restores the original (broken) policies
-- =========================================================

DROP POLICY IF EXISTS "Users can view own profile or org members" ON public.profiles;
CREATE POLICY "Users can view own profile or org members" ON public.profiles
FOR SELECT USING (
  id = auth.uid() OR (organization_id IS NOT NULL AND organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid()))
);

DROP POLICY IF EXISTS "Users can view their own organization" ON public.organizations;
CREATE POLICY "Users can view their own organization" ON public.organizations
FOR SELECT USING (
  id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
);
```

No data is touched by either direction — this only ever restores the recursion bug, it
does not risk data loss.

## 3. Exact pre-execution screenshots required

Capture these **before** running §1, so there is a clear before/after:

1. `/system/diagnostics`, full page, while signed in — specifically the `Database Check`
   and `Organization Context` rows (should currently show `fail`/error text) and the
   `allPassed`/overall score indicator.
2. `/dashboard` — showing its current error or blank-card state.
3. `/knowledge-vault` — showing its current error state on at least one of the 5 panels.
4. (Optional but useful) the Supabase SQL Editor result of the catalog check in §5, Query
   A — run it once *before* §1 to have a documented "before" policy text alongside the
   "after."

## 4. Exact post-execution screenshots required

Capture these immediately **after** running §1, in the same order, from the same pages:

1. `/system/diagnostics`, full page, same signed-in session — `Database Check` and
   `Organization Context` rows, plus `allPassed`/overall score.
2. `/dashboard` — metric cards.
3. `/knowledge-vault` — all 5 panels.
4. Supabase SQL Editor output of §5 Query A (post-fix policy text) and, if run, Query B.

## 5. Exact verification queries

**Query A — confirm the installed policy text** (safe, reads catalog metadata only, no
RLS implications either direction):

```sql
SELECT polrelid::regclass AS table_name, polname, pg_get_expr(polqual, polrelid) AS using_expr
FROM pg_policy
WHERE polrelid IN ('public.profiles'::regclass, 'public.organizations'::regclass)
ORDER BY polrelid, polname;
```

Expected `using_expr` after the fix: both should reference `get_current_org_id()`, neither
should contain a raw `SELECT organization_id FROM public.profiles` subquery.

**Query B — optional, simulate a real authenticated user directly in the SQL Editor**
(replace `<user-uuid>` with a real `profiles.id` from your own data):

```sql
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub": "<user-uuid>"}';

SELECT id, organization_id FROM public.profiles WHERE id = auth.uid();
SELECT id, name FROM public.organizations LIMIT 1;

RESET ROLE;
```

Expected: both `SELECT`s return a row with no error. Any `42P17` here means the fix did
not take effect as intended.

## 6. Exact pass / fail criteria

| Check | Pass | Fail |
|---|---|---|
| Query A | Both rows show `get_current_org_id()` in `using_expr` | Either row still shows the old inline `profiles` subquery |
| Query B | Both `SELECT`s return a row, no error | Either raises `42P17` or any other error |
| `/system/diagnostics` — `Database Check` | `pass` | `fail` or shows a recursion-related error string |
| `/system/diagnostics` — `Organization Context` | `pass` | `fail`, or shows `RLS/Query Error` |
| `/system/diagnostics` — `allPassed` / overall | `true` (while signed in) | `false` while signed in — signed-out `false` is expected, not a fail |
| `/dashboard` | Real metric numbers render | Error state or blank cards |
| `/knowledge-vault` | All 5 panels show real data or a genuine empty state | Any panel shows the session/401 error state |

**If any row fails:** do not proceed to Phase 9. Run §2's rollback, re-capture the
pre-execution screenshots' equivalents to confirm rollback succeeded, and return the
failing result (not just "it didn't work") to this session for root-cause follow-up —
the specific error text matters.

## 7. Phase 9 entrance criteria

All of the following must be true before the next phase begins:

1. Every row in §6's table shows **Pass**, evidenced by an actual post-execution
   screenshot or copied output (§4) — not by assumption.
2. No rollback was needed, or if one was needed and re-applied, the re-applied fix has
   itself been re-verified against §6 with a fresh set of passing results.
3. The pre- and post-execution screenshots (§3, §4) are both in hand, so the before/after
   comparison is auditable, not just asserted.

Explicitly **not** required to enter Phase 9 (these are separate, already-documented, RLS-
unrelated gaps): TASK-14 (owner ship decision), a live routing/render verification pass,
Video/Image Studio's generation capability. Phase 9, per the prior certification chain, is
scoped to confirming the RLS fix's own result — deployment readiness remains a separate,
later determination.

---

## Final Verdict

# READY FOR OWNER SQL EXECUTION

The package above is complete, self-contained, and requires nothing beyond what a
Supabase SQL Editor session and standard dashboard access already provide — no secret,
credential, or connection string of any kind is needed to run §1, §2, or §5's queries (all
run under the Editor's own session, per this project's established manual-SQL workflow).
This verdict certifies the package is ready to hand to the Owner — it does not itself
certify that execution will succeed; §6/§7 exist precisely to make that determination from
real results once they exist.

---
*(Deliberately uncommitted this turn — see note at top.)*
