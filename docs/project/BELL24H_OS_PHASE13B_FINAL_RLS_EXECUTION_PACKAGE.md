# BELL24H_OS PHASE 13B — FINAL RLS EXECUTION PACKAGE

**Repository:** `digitex-erp/digitex-erp-bell24h-os`
**Branch:** `main @ c18218d` (identical SQL/source content to
`frontend-activation/fd1-vercel-build @ 080d9cf`)
**Phase:** Live RLS Recursion Root Cause Execution Package. **Audit and verification
only.** No SQL executed, no code/policy modified, no migration created, nothing deployed,
committed, or pushed.
**Date:** 2026-09-14
**Status:** intentionally uncommitted, per "Do NOT commit."

**This document consolidates**
`BELL24H_OS_PHASE13_RLS_RECURSION_REMEDIATION_PACKAGE.md` and
`BELL24H_OS_PHASE13A_LIVE_RLS_ROOT_CAUSE_INVENTORY.md` (both this session, same branch,
unchanged since) **into one self-contained, Owner-ready package**, and adds the one thing
those two deliberately left undrafted: Case 3 and Case 4's exact remediation SQL. Where
content is unchanged from those two documents it is stated once here, not re-derived —
this is the final, single document to hand to the Owner; the other two remain as the
audit trail behind it.

---

## A. Recursion Chain Validation

**Chain, with exact line references, re-verified this turn against the current file
content (unchanged since Phase 13/13A):**

```
organizations SELECT policy                    supabase_schema.sql:524-527
  USING: id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
    → inline subquery reads public.profiles, subject to profiles' own RLS
      ↓
profiles SELECT policy                          supabase_schema.sql:534-537
  USING: id = auth.uid() OR (organization_id IS NOT NULL AND organization_id =
         (SELECT organization_id FROM public.profiles WHERE id = auth.uid()))
    → inline subquery reads public.profiles — the SAME table this policy is attached to
      ↓
profiles SELECT policy evaluates again → same subquery → same self-read
      ↓
Postgres detects the cycle → ERROR 42P17
"infinite recursion detected in policy for relation \"profiles\""
```

**Where this connects to the live symptom:** `src/pages/SystemDiagnosticsPage.tsx:127`
runs `supabase.from('organizations').select('id').limit(1)` — the query that enters this
chain at its top. Line 134, `` `Database error: ${tableError.message}` ``, is the **only**
line in that file with that exact string prefix, and it matches the production-observed
text verbatim. This confirms the live error enters via the `organizations` read (diagnostics
step 3), not a direct `profiles` read — the `organizations → profiles → profiles` pattern,
not `profiles → profiles` alone.

## B. Full Policy Review — `profiles` and `organizations`

Every policy defined anywhere in the repository on either table (re-confirmed this turn:
`supabase_schema.sql` is the only file defining any policy on `profiles` or
`organizations`; the 21 other `.sql` files reference `profiles` only as a foreign-key
target, which runs as the table owner and never evaluates RLS):

| Policy | Table | Command | Line | Recursion type |
|---|---|---|---|---|
| `Users can view own profile or org members` | `profiles` | SELECT | 534-537 | **Direct** — reads its own table from inside its own policy |
| `Users can view their own organization` | `organizations` | SELECT | 524-527 | **Indirect** — not self-referencing, but reads `profiles`, which is where the direct recursion lives |
| `Users can update own profile` | `profiles` | UPDATE | 540-543 | **None** — `id = auth.uid()` only, no subquery |

**Function recursion:** not present in the repository as currently written — neither
SELECT policy calls `get_current_org_id()` today; both inline a raw subquery instead. The
function only enters the picture *after* the proposed fix is applied (Section 3), and
**only under Case 3 or Case 4** would it introduce a new, function-mediated recursion path
(`profiles → get_current_org_id() → profiles`, RLS still applied because the bypass
doesn't hold) — this is why Section 1's inventory must be checked before, not skipped
after, applying Section 3.

## C. Section 1 SQL — Extracted, Verified

The exact query, extracted unchanged from
`BELL24H_OS_PHASE13_RLS_RECURSION_REMEDIATION_PACKAGE.md` §B.1 /
`BELL24H_OS_PHASE13A_LIVE_RLS_ROOT_CAUSE_INVENTORY.md` §C, reproduced in full in Section 1
below so this document requires no cross-reference at execution time.

**Verification, re-checked this turn line by line:**
- **Read-only, confirmed:** every `FROM`/`JOIN` targets a system catalog —
  `pg_policy`, `pg_class`, `pg_namespace`, `pg_proc`, `pg_language`, `pg_roles`. No
  `SELECT ... FROM public.profiles` or `FROM public.organizations` appears anywhere in the
  query text.
- **Cannot trigger recursion, confirmed:** catalog views are not subject to
  row-level security at all (RLS applies only to ordinary tables a user queries directly,
  never to `pg_catalog`/`pg_policy`/`pg_proc` reads) — this query cannot enter the chain
  mapped in Section A regardless of what state `profiles`'/`organizations`' policies are
  in.
- **Returns everything needed to distinguish all 4 cases, confirmed:** `1_policy` rows
  give the live `USING` text (Cases 1/2), `2_table` gives `force_rls` (Case 4),
  `3_function` gives the function's owner and `security_definer` flag (Case 3), `4_role`
  gives that owner's `bypassrls`/`superuser` status (also Case 3).

## D. Final Decision Matrix

| Case | Evidence pattern (from Section 1's output) | Root cause | Remediation SQL | Rollback SQL | Risk |
|---|---|---|---|---|---|
| **1 — Original recursive policies still active** | `1_policy` for `profiles` shows `USING` still containing `SELECT organization_id FROM profiles` (or `FROM public.profiles`) | The fix from earlier phases was never applied | Section 3, Statement A (drop + recreate both policies via `get_current_org_id()`) | Section 5, Statement A | LOW — proven pattern, minimal, reversible, already independently certified across Phase 4-8 |
| **2 — Mixed old + new policies** | `1_policy` shows **two or more** SELECT policies on the same table — one already using `get_current_org_id()`, another still inlining `FROM profiles` | A partial or duplicate application left a stale policy in place; Postgres ORs every permissive policy together, so even one bad policy keeps the table blocked | Section 3, Statement A's `DROP POLICY IF EXISTS` clauses, **plus** an explicit `DROP POLICY IF EXISTS "<exact stale name from Section 1's output>"` for any name not already covered | Section 5, Statement A (restores exactly one, the original, policy — do not restore a name that was never part of the documented design) | LOW — same drop/recreate mechanism, just naming one more policy explicitly rather than guessing it |
| **3 — `get_current_org_id()` owner mismatch** | `1_policy` shows only `get_current_org_id()`-based text (no inline `FROM profiles` remains anywhere); `3_function`'s owner for `get_current_org_id` (the `object` column) does **not** equal `2_table`'s `profiles` owner; and that function-owner's `4_role` row shows `bypassrls=false` **and** `superuser=false` | The policy fix is correctly installed, but `SECURITY DEFINER`'s owner-privilege bypass never activates, because the function is not owned by a role that can skip `profiles`' RLS — so the function's internal read re-enters RLS and recurses one level deeper than before | `ALTER FUNCTION public.get_current_org_id() OWNER TO <profiles_owner>;` — **`<profiles_owner>` must be copied verbatim from this package's own Section 1 output, the `2_table` row where `object = 'profiles'`, its `name` column value. This session does not know that value and has not guessed it — do not substitute a common default (`postgres`, `service_role`, etc.) without confirming it against Section 1's actual output.** | `ALTER FUNCTION public.get_current_org_id() OWNER TO <original_owner_from_section_1>;` — the original owner must also come from a Section 1 capture taken **before** this statement runs | MEDIUM — a genuine ownership/privilege change, narrow in scope (one function) but not previously drafted or reviewed before this document; confirm the target role is appropriate (least-privilege, not accidentally granting broader ownership than intended) before running |
| **4 — `FORCE ROW LEVEL SECURITY` enabled** | `2_table`'s `force_rls` for `profiles` reads `true` — this defeats the `SECURITY DEFINER` bypass **even when Case 3's ownership check passes**, because forced RLS applies row security to the table owner too | `profiles` has row-level security forced for all roles, including owners and `SECURITY DEFINER` functions running as the owner — so `get_current_org_id()`'s internal read is still subject to the same recursive-in-intent policy chain even with correct ownership | `ALTER TABLE public.profiles NO FORCE ROW LEVEL SECURITY;` | `ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;` | MEDIUM — single statement, but changes the table's security enforcement mode; `supabase_schema.sql` contains no `FORCE ROW LEVEL SECURITY` statement anywhere (confirmed by grep, both this turn and Phase 13), so if Section 1 shows `true` live, it was set outside this repository — understand why before reversing it, not just reflexively |

**Cases are not mutually exclusive.** Read every `1_policy`/`2_table` row from Section 1's
output against every case above, not just the first match — for example, `profiles` could
match Case 1 while `organizations` independently matches Case 2 if a stale policy was left
only on one table.

---

## E. OWNER EXECUTION PACKAGE

### Section 1 — Read-only inventory SQL

```sql
-- PHASE 13B LIVE INVENTORY — READ-ONLY. Run this first. Paste the full result grid back
-- before proceeding to Section 3. This query cannot modify anything and cannot trigger
-- the recursion under investigation (Section C above explains why).
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

### Section 2 — Interpretation guide

1. Look at every `1_policy` row. Does any `definition` still contain the text `FROM
   profiles` or `FROM public.profiles`? → **Case 1** applies to that table (possibly
   both).
2. If a table has **more than one** SELECT policy row, and only some contain `FROM
   profiles` → **Case 2** applies; note the exact stale `name` value(s).
3. If **no** `1_policy` row for either table contains `FROM profiles` (the fix text is
   fully installed) → proceed to check ownership and force-RLS:
   - Find the `3_function` row for `get_current_org_id`. Note its `object` column (the
     owner).
   - Find the `2_table` row for `profiles`. Note its `object` column (the owner).
   - **If these two values differ**, find the `4_role` row for the function's owner. If
     `bypassrls=false` and `superuser=false` → **Case 3** applies.
   - Regardless of Case 3's result, check the `2_table` row for `profiles`'s `force_rls`
     value. If `true` → **Case 4** applies (and can co-occur with Case 3).
4. If none of the above match — no stale policy text, ownership aligned or the owner has
   bypass/superuser, and `force_rls=false` — **the recursion is not explained by anything
   in this decision matrix.** Stop and return the full Section 1 output for fresh analysis
   rather than guessing a fifth cause.

### Section 3 — Approved remediation SQL

**Statement A — Case 1 / Case 2 base fix.** Required whenever any `1_policy` row still
contains the inline `profiles` subquery. Safe to run even if only one of the two tables
still shows the old text — both `DROP POLICY IF EXISTS` clauses are no-ops on a table
that's already correct.

```sql
BEGIN;

DROP POLICY IF EXISTS "Users can view own profile or org members" ON public.profiles;
CREATE POLICY "Users can view own profile or org members" ON public.profiles
FOR SELECT USING (
  id = auth.uid()
  OR (organization_id IS NOT NULL AND organization_id = public.get_current_org_id())
);

DROP POLICY IF EXISTS "Users can view their own organization" ON public.organizations;
CREATE POLICY "Users can view their own organization" ON public.organizations
FOR SELECT USING (
  id = public.get_current_org_id()
);

COMMIT;
```

**Statement A-1 — Case 2 only, additional.** Run **only if** Section 2's step 2 found a
stale policy name not covered by Statement A (i.e., a name other than the two above).
Replace `<exact_stale_policy_name>` and `<table>` with the literal values from Section 1's
output — do not run this with placeholder text still in it:

```sql
DROP POLICY IF EXISTS "<exact_stale_policy_name>" ON public.<table>;
```

**Statement B — Case 3 only.** Run **only if** Section 2's step 3 confirmed a genuine
owner mismatch with no bypass/superuser. `<profiles_owner>` must be the literal value from
Section 1's `2_table` row for `profiles` — copy it exactly, do not guess:

```sql
ALTER FUNCTION public.get_current_org_id() OWNER TO <profiles_owner>;
```

**Statement C — Case 4 only.** Run **only if** Section 2's step 3 confirmed
`force_rls=true` on `profiles`:

```sql
ALTER TABLE public.profiles NO FORCE ROW LEVEL SECURITY;
```

**Sequencing:** Statement A first (if needed), then A-1 (if needed), then B and/or C (if
needed) — B and C are independent of each other and of A, and may be run in either order
relative to each other, but both should follow A so that Section 1 is re-checked against
the base fix before deciding whether the deeper ownership/force-RLS causes are still live.

### Section 4 — Verification SQL

**V1 — re-run Section 1 in full** and compare against the interpretation guide (Section
2) — confirm no case still matches.

**V2 — simulate an authenticated user** (replace `<user-uuid>` with a real
`profiles.id`):

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"<user-uuid>","role":"authenticated"}', true);
SELECT id, organization_id FROM public.profiles WHERE id = auth.uid();  -- expect 1 row, no error
SELECT id, name FROM public.organizations LIMIT 1;                      -- expect a row (or none), no 42P17
ROLLBACK;
```

**V3 — live application check:** load `https://digitex-erp-bell24h-os.vercel.app/system/diagnostics`
while signed in; confirm the "Database Connection" row no longer shows the recursion text.

### Section 5 — Rollback SQL

**Rollback for Statement A** (restores the exact original text from
`supabase_schema.sql`, lines 524-527 and 534-537):

```sql
BEGIN;

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

COMMIT;
```

If Section 1's captured live text (before any change) differed from the repository's
documented text, restore **that captured text**, not the block above — this block is the
repository's documented original only.

**Rollback for Statement B:** `ALTER FUNCTION public.get_current_org_id() OWNER TO
<original_owner_captured_in_Section_1_before_the_change>;` — this value must come from a
Section 1 run taken **before** Statement B executes; it cannot be filled in in advance.

**Rollback for Statement C:** `ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;`

### Section 6 — Pass / Fail criteria

| Check | PASS | FAIL |
|---|---|---|
| V1, `profiles` SELECT policy | Exactly one, `USING` contains `get_current_org_id()`, no inline `FROM profiles` | Any inline `FROM profiles` remains, or more than one SELECT policy exists |
| V1, `organizations` SELECT policy | `USING` is `id = get_current_org_id()` | Still contains `FROM profiles` |
| V1, `force_rls` (if Statement C ran) | `false` | `true` |
| V1, function owner (if Statement B ran) | Matches `<profiles_owner>` | Unchanged from the pre-fix value |
| V2, `profiles` query | Returns the user's row, no error | Any `42P17` or other error |
| V2, `organizations` query | No error | `42P17` |
| V3, `/system/diagnostics` "Database Connection" | `pass`, no recursion text | Still shows `infinite recursion detected in policy for relation "profiles"` |
| V3, `/system/diagnostics` "Organization Loaded" | `pass` | `RLS/Query Error` |

**Any FAIL:** apply the matching Section 5 rollback for whichever statement(s) were run,
then return the exact failing output — including which case's evidence pattern was
observed in Section 1 — for fresh analysis rather than a second guess.

---

## Final Questions

**1. Is the runtime error consistent with the repository findings?**
Yes. The production error text is a verbatim match to what Section A's chain predicts,
and it enters through the exact code path (`SystemDiagnosticsPage.tsx:127,134`) already
identified.

**2. Is the recursion source already identified?**
**Repository-side, yes — unconditionally.** The direct recursion is `profiles`' own
SELECT policy (line 534-537); the indirect exposure is `organizations`' SELECT policy
(line 524-527). **Live-database-side, not yet** — Section 1's inventory is what
distinguishes whether the repository's documented (broken) text is still what's running
live, or whether a fix was already attempted and one of Cases 2-4 is the actual live
cause.

**3. Is additional repository analysis required?**
No. Every SQL file in the repository has been searched (22 files, confirmed no other
policy definitions exist), every policy on both tables has been read and mapped, every
function referenced has been traced, and the exact live-error code path has been located
line-by-line. Nothing further can be learned from static repository analysis alone.

**4. Is the inventory query now the only remaining blocker?**
Yes. Section 1 is the single remaining step between this package and a confirmed
diagnosis. Its result deterministically selects among Cases 1-4 (or reveals a fifth,
unmatched pattern, per Section 2 step 4) and, for Cases 1/2/4, fully determines the SQL to
run with no further judgment calls; Case 3 requires one value be copied from that same
result, not invented.

**5. Is the project ready for live SQL execution after inventory results are obtained?**
Conditionally yes — **for whichever case(s) the inventory results actually show**, using
the exact remediation SQL in Section 3, following Section 6's pass/fail criteria, with
Section 5's rollback ready. It is not a blanket "yes, run everything in Section 3" — only
the statements matching the observed case(s) should be run, per Section D's matrix and
Section 2's interpretation guide.

---

## FINAL VERDICT

# READY FOR INVENTORY EXECUTION

**This is not a reversal of Phase 13's or Phase 13A's verdict** — both answered "is the
remediation SQL ready to run," and correctly said additional investigation was required
before that could be true, because the live cause was still unknown. **This turn's
question is narrower and different: is the inventory query itself ready to hand to the
Owner?** That question is now answered yes — Section 1's query is verified read-only,
verified incapable of triggering the recursion it investigates (Section C), and verified
to return every field Section D's decision matrix needs to resolve unambiguously to one
or more of the four named cases, each with its exact, pre-drafted remediation already
attached.

**The remediation SQL itself is still not certified safe to run blind** — it is certified
safe to run **once matched to the correct case** via Section 1's output. That distinction
is the entire reason this document exists as a package rather than a single script: the
next action is to run Section 1, not to run all of Section 3.
