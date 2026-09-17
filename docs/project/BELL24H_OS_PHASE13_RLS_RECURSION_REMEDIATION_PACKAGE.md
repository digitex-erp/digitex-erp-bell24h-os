# BELL24H_OS PHASE 13 — LIVE RLS RECURSION REMEDIATION PACKAGE

**Repository:** `digitex-erp/digitex-erp-bell24h-os`
**Branch analyzed:** `main` @ `c18218d` (local working branch `frontend-activation/fd1-vercel-build` @ `080d9cf` is one docs-only commit ahead; every SQL and source file analyzed here is identical on both)
**Phase:** Live RLS Recursion Remediation Certification. **Audit and preparation only.** No SQL was executed. The database was not touched, and no code, SQL file, or migration was modified. Nothing was deployed, committed, or pushed.
**Date:** 2026-09-14
**Status:** intentionally **uncommitted**, per this phase's "Do NOT commit."

**Evidence rules for this document:**
- **[REPO]** means read directly from repository files this turn.
- **[LIVE]** means observed directly in production. The only live evidence is the Phase 12 browser capture of `https://digitex-erp-bell24h-os.vercel.app/system/diagnostics`.
- **[UNKNOWN]** means it cannot be answered without running the verification SQL in §B. It is not answered by inference.

Per instruction, nothing here assumes the Phase 8 SQL was ever executed.

---

## PART A — Repository Analysis

### Scope actually searched
- The `supabase/`, `database/`, `migrations/`, and `scripts/` directories **do not exist** in this repository. **[REPO]**
- All 22 `.sql` files are at the repository root: `supabase_schema.sql` plus 21 `add_*.sql`/`expand_*.sql` files. Every one was searched. **[REPO]**
- The other 21 files reference `profiles` only as a foreign-key target (`created_by UUID REFERENCES public.profiles(id)`, in 16 places) or through differently named tables (`context_profiles`, `brand_profiles`, `campaign_profiles`, `audience_profiles`). None defines a policy on `profiles` or `organizations`, and none contains `FROM profiles` or `FROM organizations`. **[REPO]**
- Foreign-key checks run as the table owner and do not evaluate RLS, so those references cannot take part in the recursion.

### A1 — Every policy defined on `profiles` and `organizations` [REPO]

Source: `supabase_schema.sql` only.

| # | Table | Policy name | Command | Expression | Line |
|---|---|---|---|---|---|
| P1 | `organizations` | `Users can view their own organization` | SELECT | `id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())` | 524–527 |
| P2 | `profiles` | `Users can view own profile or org members` | SELECT | `id = auth.uid() OR (organization_id IS NOT NULL AND organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid()))` | 534–537 |
| P3 | `profiles` | `Users can update own profile` | UPDATE | `id = auth.uid()` | 540–543 |

- RLS is enabled on both tables (lines 522 and 532).
- There is no `FORCE ROW LEVEL SECURITY` anywhere in the repository.
- There are no INSERT or DELETE policies on either table, and no UPDATE policy on `organizations`.

### A2 — Every function referenced by those policies [REPO]
- **P1, P2, and P3 reference no user-defined function.** They use only `auth.uid()`, Supabase's built-in JWT accessor, which reads request claims and queries no table.
- Other helper functions in the repository, none referenced by P1–P3:

| Function | Lines | Security | Reads | Role |
|---|---|---|---|---|
| `public.get_current_org_id()` | 50–60 | plpgsql, `SECURITY DEFINER` | `public.profiles` | Used by the 30-table "Org isolation" loop (546–575). **Proposed** for use in the replacement policies. |
| `public._create_org_policy()` | 69–87 | plpgsql, invoker | nothing at runtime | DDL generator only. Not called by any policy. |
| `public.handle_new_user()` | 506–513 | plpgsql, `SECURITY DEFINER` | inserts into `profiles` | Trigger on `auth.users`. Not called by any policy. |

### A3 — Every place one table queries the other [REPO]

| Direction | Where | Form |
|---|---|---|
| `organizations` → `profiles` | P1 (line 526) | Inline subquery, evaluated as the calling user and **subject to `profiles` RLS** |
| `profiles` → `profiles` | P2 (line 536) | Inline self-subquery, evaluated as the calling user and **subject to `profiles` RLS** |
| `profiles` → `organizations` | — | **None.** No policy or function on `profiles` reads `organizations`. |
| helper → `profiles` | `get_current_org_id()` (line 56) | `SECURITY DEFINER` read. It escapes RLS **only if** its owner is the table owner or holds `BYPASSRLS` (see C3). |
| `requireAuth.ts` → `profiles` | `server/middleware/requireAuth.ts:108–111` | PostgREST `GET /rest/v1/profiles?id=eq.<uid>` with the caller's own JWT, so it is subject to RLS |
| App → `profiles`/`organizations` | 13 files, 35 call sites (Phase 4 inventory; the diagnostics and route call sites were re-grepped this turn) | Direct `supabase-js` queries, subject to RLS |

### A4 — Recursive dependency chains, and the Table Dependency Graph [REPO]

```
CHAIN 1 — self-recursion (the defect as written in the repository)
  SELECT … FROM profiles
     └─ P2 USING: (SELECT organization_id FROM profiles …)
           └─ P2 USING: (SELECT organization_id FROM profiles …)
                 └─ … unbounded → ERROR 42P17 "infinite recursion detected in policy for relation profiles"

CHAIN 2 — transitive (the live production path, see C2)
  SELECT … FROM organizations
     └─ P1 USING: (SELECT organization_id FROM profiles …)
           └─ P2 → CHAIN 1 → 42P17 reported on relation "profiles"

CHAIN 3 — conditional: can occur only in a database where the Phase 8 replacement was applied
AND get_current_org_id() does NOT bypass RLS
  SELECT … FROM profiles
     └─ P2′ USING: organization_id = get_current_org_id()
           └─ get_current_org_id(): SELECT … FROM profiles   (RLS still applied if the owner lacks bypass)
                 └─ P2′ → get_current_org_id() → … → 42P17 on relation "profiles"

NON-RECURSIVE (safe)
  30 org-isolation tables → get_current_org_id() → profiles   (safe when the function bypasses RLS)
  P3 (UPDATE): id = auth.uid() → no table read
```

**The repository contains no `profiles → organizations → profiles` cycle.** No `profiles` policy reads `organizations`. The `organizations` policy is a victim of CHAIN 1, not a cycle of its own.

---

## PART B — Live Database Reality

**This session has no database access, requested no credentials, and ran none of the queries below.** Items B1–B5 are **[UNKNOWN]** until the Owner runs §B.1 and pastes the output. Per this project's manual-SQL workflow, this is **one read-only query**.

### B.1 — Live inventory query (read-only: catalog reads only, no writes, no RLS side effects)

```sql
-- PHASE 13 LIVE INVENTORY — READ-ONLY. Paste the full result grid back.
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

### B.2 — How each question is answered from that output

| Question | Read from | Decision rule |
|---|---|---|
| **B1** Current active policies | `1_policy` rows | Every row is an active policy. Compare against P1–P3 in §A1. |
| **B2** Current active functions | `3_function` rows | Does `get_current_org_id` exist, with `security_definer=true`? Does its definition still match lines 50–60? |
| **B3** RLS status | `2_table` rows | `rls_enabled` and `force_rls` for both tables. **`force_rls=true` would defeat the owner bypass** the fix depends on. |
| **B4** Old and new coexisting | `1_policy` rows | More than one SELECT policy on `profiles` (or on `organizations`) means they coexist. Postgres ORs permissive policies and evaluates **every** one, so **a single remaining recursive policy is enough to keep producing 42P17**. |
| **B5** Phase 8 status | Rows combined, as below | See the classification table below. |

**B5 classification** (Phase 8 statements: S1 = the `profiles` replacement, S2 = the `organizations` replacement):

| Observed | Classification |
|---|---|
| The `profiles` SELECT `USING` still contains `SELECT organization_id FROM profiles`, **and** the `organizations` `USING` contains it too | **Never executed** |
| Exactly one of the two contains `get_current_org_id()` | **Partially executed** |
| Both contain `get_current_org_id()`, no other SELECT policies exist, and 42P17 still reproduces | **Fully executed but ineffective.** Check the `4_role` rows: if the owner of `get_current_org_id` is **not** the owner of `profiles` **and** has `bypassrls=false` and `superuser=false`, CHAIN 3 (§A4) is live. |
| Any SELECT policy on `profiles`/`organizations` whose name is not in §A1 | **Out-of-repository policy present.** It was created outside this repository (for example in the Dashboard). Stop, and do not execute §D until it is reviewed. |

---

## PART C — Root Cause Certification

**C1. Which policy causes the error?**
- **[REPO]** P2, `"Users can view own profile or org members"` on `public.profiles` (lines 534–537). It is the only policy in the repository that reads its own table inline.
- **[UNKNOWN]** Whether P2 is still the live text, or whether another live policy is also recursive, is decided by §B.1.

**C2. What exact execution path triggers it?** **[LIVE]** plus **[REPO]**
1. A signed-in browser loads `/system/diagnostics`.
2. `runDiagnostics()` step 3 runs `supabase.from('organizations').select('id').limit(1)` (`SystemDiagnosticsPage.tsx:127`).
3. PostgREST evaluates the SELECT policy on `organizations` under the user's JWT. That policy reads `profiles`.
4. The `profiles` SELECT policy recurses, and Postgres raises 42P17 on relation `profiles`.
5. Line 134 renders `` `Database error: ${tableError.message}` ``.

The `Database error:` prefix appears at line 134 only, so the live string can only have come from this `organizations` read.

**C3. Which recursion path is it?**
- **[REPO]** As the repository defines it: **`organizations` → `profiles` → `profiles`** (CHAIN 2, ending in CHAIN 1). Of the paths listed in the mission, it is **not** `profiles → organizations → profiles`, which does not exist in the repository.
- **[UNKNOWN]** The live string alone cannot distinguish CHAIN 2 (Phase 8 never applied) from CHAIN 3 (a helper function that does not bypass RLS). Both produce the identical message on the identical request. §B.1's `1_policy` and `4_role` rows decide it.
- This correction matters. Earlier documents (Phase 4 onward) treated the `SECURITY DEFINER` owner bypass as settled. It is correct only if `get_current_org_id()`'s owner is the `profiles` owner or has `BYPASSRLS`. Nothing in the repository or the live evidence proves that about the live database.

**C4. Which policy must be removed?** P2, the current `profiles` SELECT policy, together with **any other live SELECT policy on `profiles` that reads `profiles` inline**. Only §B.1 can reveal the second group.

**C5. Which policy must be replaced?**
- P2 is replaced by P2′ (§D.4). This is required.
- P1 is replaced by P1′. This is recommended for consistency and not causally required, because P1 stops failing once P2 is fixed.

**C6. Which functions are safe to keep?**
- `_create_org_policy()` and `handle_new_user()` are unchanged and not involved.
- `get_current_org_id()` is safe **as defined** in the repository, **provided** the §B.1 `4_role` check passes.

**C7. Which functions require modification?**
- **None, if** §B.1 shows `get_current_org_id()` with `security_definer=true`, owned by the same role that owns `public.profiles` (or by a role with `bypassrls` or `superuser`), and `force_rls=false` on `profiles`.
- **If that check fails, no policy-only fix can be certified.** The function's ownership must be aligned first (`ALTER FUNCTION public.get_current_org_id() OWNER TO <profiles owner>`). That statement is **deliberately not included** in §D: the role name is [UNKNOWN] until §B.1 runs, and guessing it would be speculation.

---

## PART D — Remediation Package (prepared, NOT executed)

### D.1 Current live policy inventory
- **[UNKNOWN]** Produced by §B.1. Paste the result here before execution.
- **Expected if the repository matches live:** exactly P1, P2, and P3 from §A1.

### D.2 Root cause explanation
- P2 reads `profiles` from inside `profiles`' own SELECT policy as the calling user, so the policy re-triggers itself.
- The `organizations` policy (P1) inherits the failure because it reads `profiles` inline.
- The replacement routes both reads through `get_current_org_id()`. That function's `SECURITY DEFINER` read escapes RLS when its owner is exempt, which is verified by §B.1 rather than assumed.

### D.3 Policy removal SQL (run only after §B.1 passes the gate in D.8)

```sql
DROP POLICY IF EXISTS "Users can view own profile or org members" ON public.profiles;
DROP POLICY IF EXISTS "Users can view their own organization"   ON public.organizations;
-- Any additional SELECT policy found by §B.1 that is not in §A1 must be listed here BY EXACT NAME
-- after review. Nothing is dropped blindly.
```

### D.4 Policy replacement SQL

Run as one transaction together with D.3:

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

- `"Users can update own profile"` (P3) is not touched.
- No table, column, row, or function is modified.

### D.5 Rollback SQL (restores the exact repository-defined P1 and P2)

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

- Rollback touches no data.
- If §B.1 shows the live P1/P2 text differs from the repository, **the rollback must restore the live text captured in D.1, not the SQL above.**

### D.6 Verification SQL (after execution)

```sql
-- V1: the installed policy text (re-run §B.1 and compare the '1_policy' rows)

-- V2: simulate an authenticated user. Replace <user-uuid> with a real profiles.id.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"<user-uuid>","role":"authenticated"}', true);
SELECT id, organization_id FROM public.profiles WHERE id = auth.uid();  -- expect 1 row, no error
SELECT id, name FROM public.organizations LIMIT 1;                      -- expect a row (or none), no 42P17
ROLLBACK;
```

### D.7 Pass/Fail criteria

| Check | PASS | FAIL |
|---|---|---|
| V1 `profiles` SELECT | Exactly one SELECT policy, `USING` contains `get_current_org_id()` | Any SELECT policy still contains `FROM profiles` inline, or more than one SELECT policy exists |
| V1 `organizations` SELECT | `USING` is `id = get_current_org_id()` | Still contains `FROM profiles` |
| V2 `profiles` query | Returns the user's row, no error | Any 42P17 or error |
| V2 `organizations` query | No error | 42P17 |
| `/system/diagnostics`, "Database Connection" row (production, signed in) | `pass` | Still shows `infinite recursion detected in policy for relation "profiles"` |
| `/system/diagnostics`, "Organization Loaded" row | `pass`, or `warn` for "Authentication required" only if the session-state issue below reproduces | `RLS/Query Error` |
| `/dashboard` | Real counts render | Error state or blank cards |
| `/knowledge-vault` | Panels load, with no 403 | 403 `organization_unresolved` |

**Any FAIL:** run D.5 (or the live-text rollback), then return the exact failing output.

### D.8 Evidence checklist, and the execution gate

**Gate:** do not run D.3 or D.4 until §B.1's output is pasted and **all three** conditions hold:
1. The only SELECT policies on `profiles`/`organizations` are the §A1 names.
2. `get_current_org_id` has `security_definer=true`.
3. Its owner equals the `profiles` owner, **or** has `bypassrls` or `superuser`; and `force_rls=false`.

**Evidence to capture:**
- [ ] §B.1 output **before** execution (saved as D.1)
- [ ] `/system/diagnostics` screenshot **before** (already on record in `BELL24H_OS_FRONTEND_ACTIVATION_DEPLOYMENT_REPORT.md`)
- [ ] D.4 execution result (success, or the error text)
- [ ] V1 output (§B.1 re-run) **after**
- [ ] V2 output **after**
- [ ] `/system/diagnostics`, `/dashboard`, `/knowledge-vault`, `/organization`, and `/team` screenshots **after**, signed in

---

## PART E — Execution Readiness

**A. Can remediation be performed safely?**
- **The SQL itself is low-risk:** two SELECT-policy substitutions in one transaction, no data touched, symmetric rollback.
- **It cannot yet be certified *effective*.** The live policy inventory and function ownership (§B.1) are unobserved. One of the two causes consistent with the live evidence (CHAIN 3) would make D.4 a no-op for the error.

**B. Expected blast radius.**
- Changed: the SELECT policies on `profiles` and `organizations` only.
- Unchanged: P3 (`profiles` UPDATE), the 30 org-isolation tables, the Vault's permissive policies, storage policies, all functions, and all data.
- Behaviour after the change: users can see their own profile, same-org profiles, and their own organization. That is the intent already encoded in P1/P2, now with no recursion.

**C. Affected routes** (all read `profiles`/`organizations` directly or through `requireAuth`) **[REPO]**:

| Route | Dependency |
|---|---|
| `/dashboard` | `DashboardPage.tsx:20, 23, 26, 29` |
| `/knowledge-vault` | `requireAuth.ts:108–111` gates all `/api/vault/*` routes. The Vault tables' own policies are `USING (true)`. |
| `/organization` | `OrganizationPage.tsx:31, 38, 50, 75` |
| `/team` | `TeamPage.tsx:44, 58, 63, 106, 372` |
| `/system/diagnostics` | `SystemDiagnosticsPage.tsx:127, 174` |

**D. Expected outcome after remediation** (conditional on the D.8 gate passing):
- The five routes above stop failing with 42P17 or `403 organization_unresolved`.
- **Not fixed by this package:**
  - The `/system/diagnostics` session-state inconsistency observed live in Phase 12: the page shows an authenticated user and a valid JWT alongside "No active session", plus `Direct DB Connection (Admin): Error: unauthenticated`. That is a separate client or `requireAuth` token issue, not RLS.
  - Video/Image Studio generation.
  - The missing INSERT, UPDATE, and DELETE policies on `organizations`.

---

## FINAL VERDICT

# ADDITIONAL INVESTIGATION REQUIRED

**What is certified:**
- The repository-level root cause (P2 self-recursion, reached live through P1 from diagnostics step 3).
- The complete remediation, rollback, verification, and pass/fail package above.

**What blocks "READY":**
- The live database's actual policy inventory and the ownership/`BYPASSRLS` status of `get_current_org_id()` are unobserved.
- The live error is equally consistent with "Phase 8 never ran" and with "Phase 8 ran but the helper function does not escape RLS". Under the second cause, executing §D would change nothing.
- Declaring READY would mean assuming the answer, which this phase forbids.

**The investigation remaining is one step:** the Owner runs the read-only §B.1 query in the Supabase SQL Editor and pastes the full result. If the D.8 gate conditions hold, this package becomes **READY FOR PHASE 13 EXECUTION** with no further changes. If they do not, the output names the exact additional statement required.
