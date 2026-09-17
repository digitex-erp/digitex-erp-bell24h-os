# BELL24H_OS PHASE 13D — OWNER INVENTORY QUERY PACKAGE

**Repository:** `digitex-erp/digitex-erp-bell24h-os`
**Branch:** `main` @ `c18218d`
**Phase:** Live Supabase RLS Inventory Interpretation. **Audit only.** No SQL executed by
this session, no migration created, no code modified, nothing committed, pushed, or
deployed. No credential requested.
**Date:** 2026-09-14
**Status:** intentionally uncommitted, per "No commits."

**This document contains exactly one query, and no remediation SQL of any kind** — no
`ALTER`, no `DROP POLICY`, no `CREATE POLICY` — per this phase's explicit constraint. It
consolidates the same, already-verified inventory query from
`BELL24H_OS_PHASE13_RLS_RECURSION_REMEDIATION_PACKAGE.md` §B.1 /
`BELL24H_OS_PHASE13A_LIVE_RLS_ROOT_CAUSE_INVENTORY.md` §C /
`BELL24H_OS_PHASE13B_FINAL_RLS_EXECUTION_PACKAGE.md` §Section 1 — unchanged, because
nothing about the repository or the question has changed since those were written. This
document's only new content is the interpretation guide in §E, written so the Owner can
resolve the result to a case **without pasting it back for further repository analysis
first** — a stricter, more self-sufficient bar than Phase 13B's interpretation guide,
which assumed a round-trip back to this session.

Per Phase 13C: **no query has been executed yet.** This package is what makes that
possible; it does not itself contain a result.

---

## A. Documents reviewed

`BELL24H_OS_PHASE13_RLS_RECURSION_REMEDIATION_PACKAGE.md`,
`..._PHASE13A_LIVE_RLS_ROOT_CAUSE_INVENTORY.md`, `..._PHASE13B_FINAL_RLS_EXECUTION_PACKAGE.md`,
`..._PHASE13C_LIVE_RLS_INVENTORY_RESULTS.md` — all four, all this session, all on this
branch. Their shared, unchanged finding: the repository-side root cause is fully
identified (`profiles`' self-recursive SELECT policy at `supabase_schema.sql:534-537`,
transitively exposing `organizations`' SELECT policy at `:524-527`); what remains unknown
is the live database's actual current policy/ownership state, which only a live query can
supply. Phase 13C confirmed no such query has been run by this session, and will not be —
per the standing manual-SQL workflow, this session does not request credentials or
execute SQL against Supabase itself.

## B/C. The inventory query

Inventory only — verified this turn, again, to contain no `ALTER`, `DROP POLICY`, or
`CREATE POLICY` statement anywhere in its text; every clause is a `SELECT` against a
system catalog (`pg_policy`, `pg_class`, `pg_proc`, `pg_roles`). It returns, in one
result grid, every item C requires: live policies on both tables, RLS/FORCE RLS state,
`get_current_org_id()`'s full definition and owner, both tables' owners, and the relevant
roles' `bypassrls`/`superuser` flags.

```sql
-- PHASE 13D OWNER INVENTORY — READ-ONLY, INVENTORY ONLY. No ALTER, DROP POLICY, or
-- CREATE POLICY statement appears anywhere in this query. Run this exactly as written,
-- then paste the full result grid back.
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

**Column reference, for reading the raw grid:**

| `kind` | `object` | `name` | `detail` | `definition` |
|---|---|---|---|---|
| `1_policy` | table name | policy name | command + permissive/restrictive + roles | `USING`/`WITH CHECK` text — **this is what §E reads** |
| `2_table` | table name | table owner | `rls_enabled=`/`force_rls=` — **this is what §E reads for Case 4** | (empty) |
| `3_function` | function name | function owner — **this is what §E reads for Case 3** | `security_definer=`/lang/config | full `CREATE FUNCTION` text |
| `4_role` | role name | (empty) | `superuser=`/`bypassrls=` — **this is what §E reads for Case 3** | (empty) |

---

## D. Deliverable

This file: `docs/project/BELL24H_OS_PHASE13D_OWNER_INVENTORY_QUERY.md`.

---

## E. Reading the result — self-contained, no repository round-trip required

Work through these in order. Each step only needs the `kind`/`object`/`name`/`detail`
columns already in front of you.

**Step 1 — look at every `1_policy` row where `object = profiles` or `object =
organizations`.**

- Does any `definition` column contain the text `FROM profiles` or `FROM
  public.profiles`?
  - **If yes, and it's the only SELECT policy on that table → CASE 1.** The original
    recursive policy is still in place on that table.
  - **If yes, and there is also a second SELECT policy on the same table whose
    `definition` instead contains `get_current_org_id()` → CASE 2.** A fix was applied
    but the old policy was never removed — Postgres evaluates every permissive policy on
    a table together, so the surviving old one keeps causing the recursion even though a
    correct one now also exists.
- If **no** `1_policy` row for either table contains `FROM profiles` — every SELECT
  policy's `definition` instead reads `get_current_org_id()` — **neither Case 1 nor Case
  2 applies.** Continue to Step 2.

**Step 2 — (only if Step 1 found no old-text policy) look at the `3_function` row where
`object = get_current_org_id`.**

- Its `name` column is the function's **owner**.
- Now look at the `2_table` row where `object = profiles`. Its `name` column is the
  **table's owner**.
- **Do these two owner values match exactly?**
  - **If they match → Case 3 does not apply.** Continue to Step 3.
  - **If they differ →** look at the `4_role` row whose `object` equals the function's
    owner (from this same step). Check its `detail`: does it say `bypassrls=true` or
    `superuser=true`?
    - **If both say `false` → CASE 3.** The policy fix is correctly installed, but the
      function that's supposed to bypass RLS is owned by a role that cannot do so, so its
      internal read still recurses.
    - **If either says `true` → Case 3 does not apply** (the mismatch doesn't matter,
      because this role can bypass RLS anyway regardless of ownership). Continue to Step
      3.

**Step 3 — (regardless of Step 2's outcome) look at the `2_table` row where `object =
profiles`. Check its `detail` column for `force_rls=`.**

- **If `force_rls=true` → CASE 4.** Even a correctly-owned function's internal read still
  hits RLS, because forced RLS applies row security to the table owner too. This can
  apply on its own, or alongside Case 3.
- **If `force_rls=false` → Case 4 does not apply.**

**If none of Steps 1–3 matched anything** — no old-text policy, ownership aligned or
bypass-capable, and `force_rls=false` — **the live state does not match any of the four
named cases.** Stop there and report the raw result grid rather than guessing further;
that outcome itself is new information this session has not yet accounted for.

---

## FINAL QUESTIONS

**1. Is the inventory query sufficient to identify the active root cause?**
Yes — for any of the four named cases. The three-step reading process in §E resolves the
raw grid to exactly one (or, for Case 3 combined with Case 4, two) of them using only the
columns the query already returns, with no additional query, no repository lookup, and no
judgment call beyond string/boolean comparison.

**2. Is any additional repository analysis still required?**
No. The repository side of this investigation was completed across Phase 13/13A/13B: all
22 SQL files searched, every policy on both tables mapped, every referenced function
traced, the live-error code path located to exact lines
(`SystemDiagnosticsPage.tsx:127,134`). Nothing further can be learned from source alone —
only the live query result adds anything new from here.

**3. What exact evidence is still missing before remediation can begin?**
The pasted result grid from §B/§C's query. That is the only missing item. It resolves
which case is active, and — per the already-drafted, already-reviewed remediation in
`BELL24H_OS_PHASE13B_FINAL_RLS_EXECUTION_PACKAGE.md` §Section 3 (not reproduced here, per
this phase's "no remediation SQL" constraint) — which exact statement block applies.

**4. GO / NO-GO for remediation execution?**
**NO-GO**, unchanged in substance from Phase 13/13A/13B/13C — no live evidence yet
exists in this session. This is not a new or stronger NO-GO; it is the same one, now
paired with a package that requires nothing further from this session to resolve once the
Owner runs it.

---
*(Deliberately uncommitted this turn — see status note at top.)*
