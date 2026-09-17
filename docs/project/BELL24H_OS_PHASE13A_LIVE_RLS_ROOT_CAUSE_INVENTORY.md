# BELL24H_OS PHASE 13A — LIVE RLS RECURSION ROOT CAUSE INVENTORY

**Repository:** `digitex-erp/digitex-erp-bell24h-os`
**Branch:** `main` @ `c18218d` (identical SQL/source content to `frontend-activation/fd1-vercel-build` @ `080d9cf`)
**Phase:** Live RLS Recursion Root Cause Inventory. **Audit only.** No SQL executed, no code/SQL modified, no migration created, nothing deployed, committed, or pushed.
**Date:** 2026-09-14
**Status:** intentionally uncommitted, per "Do NOT commit."

**This document builds directly on, and does not duplicate,**
`docs/project/BELL24H_OS_PHASE13_RLS_RECURSION_REMEDIATION_PACKAGE.md` (written this
session, same branch, same evidence base — nothing in the repository has changed since).
Where content is identical, this document references that file by path rather than
re-deriving it, so the two do not drift independently if either is edited later. What
this document adds: the A–E structure this mission specifically asks for, and one
genuinely new element — Case 4 (`FORCE ROW LEVEL SECURITY`), broken out as its own
decision-matrix row rather than folded into Case 3's ownership problem, because the two
have different remediation SQL despite producing the byte-identical error.

---

## A. Repository Policy Map

Full detail: `BELL24H_OS_PHASE13_RLS_RECURSION_REMEDIATION_PACKAGE.md` §A1–A4. Summary:

```
profiles       -> profiles                          [P2, line 534-537, self-recursive]
organizations  -> profiles                           [P1, line 524-527, transitively unsafe]
get_current_org_id() -> profiles                      [line 50-60, SECURITY DEFINER;
                                                         safe only if the D.8 gate holds]
```

**Every policy on `profiles`/`organizations`** (`supabase_schema.sql`, the only file in
the repository defining any):

| Policy | Table | Command | Reads |
|---|---|---|---|
| `Users can view their own organization` | `organizations` | SELECT (l.524-527) | `profiles`, inline |
| `Users can view own profile or org members` | `profiles` | SELECT (l.534-537) | `profiles`, inline (self) |
| `Users can update own profile` | `profiles` | UPDATE (l.540-543) | nothing — `id = auth.uid()` only |

**Every function those policies use:** none call a user-defined function directly — both
SELECT policies inline a raw subquery. `get_current_org_id()` (l.50-60) is not currently
called by either policy; it is the function the proposed fix routes through, and the only
function relevant to this investigation.

**No `profiles → organizations` edge exists anywhere in the repository** — confirmed by
grep, re-stated here because it rules out any cycle running the other direction.

## B. Runtime Error Chain

**Most likely chain, repository + live evidence combined:**

```
organizations policy (line 524-527)
  → inline subquery reads profiles
    → profiles policy (line 534-537)
      → inline subquery reads profiles (itself)
        → RECURSION → Postgres 42P17, reported on relation "profiles"
```

This is the `organizations policy → profiles policy → profiles policy → recursion`
pattern named in the mission's own example, not the `profiles policy →
get_current_org_id() → profiles` pattern — because as the repository currently defines
these policies, `get_current_org_id()` is not in the call path at all yet. That second
pattern only becomes live *after* the Phase 8 fix is applied (Case 3/4 below), if the
function's RLS-bypass assumption doesn't actually hold on the live database.

**Exact lines tying this to the live symptom:**
- `SystemDiagnosticsPage.tsx:127` — `supabase.from('organizations').select('id').limit(1)`, the query that runs
- `SystemDiagnosticsPage.tsx:134` — `` `Database error: ${tableError.message}` `` — the only line in the file with that exact string prefix, matching the live-observed text verbatim
- This confirms the error surfaces from the `organizations` read (step 3), not a direct `profiles` read — consistent with the chain above, not a `profiles`-first trigger.

## C. Live Inventory Query Package

One read-only package, copy/paste ready. Identical to
`BELL24H_OS_PHASE13_RLS_RECURSION_REMEDIATION_PACKAGE.md` §B.1 — reproduced here in full
so this document is self-contained and does not require cross-referencing another file at
execution time:

```sql
-- PHASE 13A LIVE INVENTORY — READ-ONLY. Paste the full result grid back.
SELECT '1_policy'::text AS kind, c.relname::text AS object, p.polname::text AS name,
       (CASE p.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE'
                      WHEN 'd' THEN 'DELETE' ELSE 'ALL' END)
       || CASE WHEN p.polpermissive THEN ' permissive' ELSE ' restrictive' END
       || ' roles=' || COALESCE((SELECT string_agg(r.rolname, ',') FROM pg_roles r WHERE r.oid = ANY (p.polroles)), 'public')
         AS detail,
       'USING: ' || COALESCE(pg_get_expr(p.polqual, p.polrelid), '-')
       || '  |  WITH CHECK: ' || COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '-') AS definition
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('profiles', 'organizations')
UNION ALL
SELECT '2_table', c.relname::text, pg_get_userbyid(c.relowner)::text,
       'rls_enabled=' || c.relrowsecurity::text || ' force_rls=' || c.relforcerowsecurity::text, NULL
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('profiles', 'organizations')
UNION ALL
SELECT '3_function', p.proname::text, pg_get_userbyid(p.proowner)::text,
       'security_definer=' || p.prosecdef::text || ' lang=' || l.lanname::text
       || ' config=' || COALESCE(array_to_string(p.proconfig, ','), '-'),
       pg_get_functiondef(p.oid)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l ON l.oid = p.prolang
WHERE n.nspname = 'public' AND p.proname IN ('get_current_org_id', 'handle_new_user', '_create_org_policy')
UNION ALL
SELECT '4_role', r.rolname::text, NULL,
       'superuser=' || r.rolsuper::text || ' bypassrls=' || r.rolbypassrls::text, NULL
FROM pg_roles r
WHERE r.oid IN (SELECT c.relowner FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relname IN ('profiles', 'organizations'))
   OR r.oid IN (SELECT p.proowner FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND p.proname = 'get_current_org_id')
ORDER BY 1, 2, 3;
```

**What each of the mission's 9 requested items maps to, in this one package:**

| # | Requested | Source rows |
|---|---|---|
| 1 | Policies on `profiles` | `1_policy` where `object='profiles'` |
| 2 | Policies on `organizations` | `1_policy` where `object='organizations'` |
| 3 | RLS enabled state | `2_table`, `rls_enabled=` |
| 4 | FORCE RLS state | `2_table`, `force_rls=` |
| 5 | Function definitions | `3_function`, `definition` column (full `pg_get_functiondef`) |
| 6 | Function owners | `3_function`, `object` column |
| 7 | Table owners | `2_table`, `object` column |
| 8 | `rolbypassrls` | `4_role`, `bypassrls=` |
| 9 | `rolsuper` | `4_role`, `superuser=` |

This is read-only: `pg_policy`, `pg_class`, `pg_proc`, `pg_roles` are catalog views; no
`SELECT ... FROM profiles`/`organizations` occurs, so this query cannot itself trigger the
recursion being investigated.

## D. Decision Matrix

| Case | Identifying evidence (from §C's output) | Required remediation | Risk |
|---|---|---|---|
| **1 — Original recursive policy still exists** | `1_policy` rows for `profiles` show `USING` still containing `SELECT organization_id FROM profiles` (or `FROM public.profiles`) | Run the full D.3+D.4 statements from the Phase 13 package (drop + recreate both policies via `get_current_org_id()`) | LOW — the fix is proven-pattern, minimal, reversible |
| **2 — Remediation policy exists but old policy still remains** | `1_policy` shows **two or more** SELECT policies on the same table — one referencing `get_current_org_id()`, another still inlining `FROM profiles` | Drop the leftover old-text policy by its exact name (Postgres ORs all permissive policies together — even one bad policy keeps the table blocked, per Phase 13 §B.2) | LOW — a `DROP POLICY IF EXISTS` naming the specific stale policy; no new logic needed |
| **3 — Remediation policy exists but function ownership prevents bypass** | `1_policy` shows only the `get_current_org_id()`-based text (no inline `FROM profiles` remains); `3_function`'s `get_current_org_id` owner (from `object` column) does **not** match `2_table`'s `profiles` owner; and that owner's `4_role` row shows `bypassrls=false` and `superuser=false` | `ALTER FUNCTION public.get_current_org_id() OWNER TO <profiles_owner>;` — realigns ownership so the function's internal read escapes RLS as `SECURITY DEFINER` intends | MEDIUM — a real schema change (ownership reassignment), narrow in scope but not previously drafted or reviewed anywhere in this session; must be reviewed against least-privilege before running, not treated as a drop-in extra line |
| **4 — `FORCE ROW LEVEL SECURITY` causes recursion** | `2_table`'s `force_rls=` for `profiles` reads `true` — this applies **even when Case 3's ownership check passes**, because `FORCE ROW LEVEL SECURITY` makes RLS apply to the table owner too, defeating the `SECURITY DEFINER` bypass regardless of who owns the function | `ALTER TABLE public.profiles NO FORCE ROW LEVEL SECURITY;` — a distinct statement from Case 3's, touching the table's RLS enforcement mode, not the function's ownership | MEDIUM — narrow, single-statement, but changes the table's security posture; the repository has no record of `FORCE ROW LEVEL SECURITY` ever being set (absent from `supabase_schema.sql` entirely), so if `true` is observed live, it was set outside this repository and should be understood, not just reversed, before acting |

**Case 3 and Case 4 are kept separate deliberately, not collapsed into one "ownership
problem" bucket** — both defeat the same owner-bypass mechanism, both would produce the
identical `42P17` text on an already-"fixed" policy, but they are independent conditions
with independent, non-interchangeable remediation SQL. A live database could show either,
both, or neither, and §C's package already captures the exact fields needed to tell them
apart in one pass.

**Cases are not mutually exclusive** — a live database could match Case 1 for `profiles`
while an unrelated leftover policy also matches Case 2, for instance. Read every
`1_policy`/`2_table` row against every case, not just the first match.

## E. Execution Readiness Gate

**Must the inventory query be run first.**

**Reasoning:** the live symptom (`42P17` on `profiles`) is consistent with all four cases
in §D, and each case has different — in Case 3 vs. Case 4, non-overlapping — required
SQL. Case 1's remediation (drop + recreate via `get_current_org_id()`) would leave Case 3
or Case 4 completely unaddressed if either is the actual live state, because in both of
those, the "fixed" policy text is already installed and recursion is happening one level
deeper, inside the function's own read. Running Case 1's SQL against a Case-3 or Case-4
database would not fail loudly — it would silently no-op on the real problem, DROP/CREATE
a policy that was already correct, and leave the Owner believing remediation was applied
when the underlying cause remains. That silent-failure risk is exactly why the §C package
must run and be reviewed before any remediation statement is chosen, not just before
"any SQL" in the abstract.

---

## FINAL VERDICT

# ADDITIONAL INVESTIGATION REQUIRED

Unchanged from `BELL24H_OS_PHASE13_RLS_RECURSION_REMEDIATION_PACKAGE.md` — this turn adds
a sharper decision matrix (specifically, separating Case 4 from Case 3) and the A–E
framing this mission asked for, but no new live evidence has arrived. The verdict does not
move until the Owner runs §C's query and pastes the result; the more detailed matrix
narrows what that result will mean, it does not substitute for it.

**Next action:** the Owner runs §C's package in the Supabase SQL Editor and returns the
full result grid. That single output resolves §D's matrix to exactly one (or more) case,
at which point the corresponding remediation SQL — already drafted for Case 1/2 in
`BELL24H_OS_PHASE13_RLS_RECURSION_REMEDIATION_PACKAGE.md` §D, and named but not yet
drafted for Case 3/4 above, pending review — becomes executable.
