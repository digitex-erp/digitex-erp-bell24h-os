# BELL24H_OS PHASE 13C — LIVE RLS INVENTORY RESULTS

**Repository:** `digitex-erp/digitex-erp-bell24h-os`
**Branch:** `main` @ `c18218d`
**Phase:** Live RLS Inventory Execution & Root Cause Identification. **Audit and
verification only.** No code/SQL modified, no migration created, nothing deployed,
committed, or pushed.
**Date:** 2026-09-14
**Status:** intentionally uncommitted (no explicit "do not commit" this turn, but there
is also nothing yet to commit — see below).

---

## Status: NO LIVE QUERY WAS EXECUTED — this document contains no database results

This mission's instruction — "Execute ONLY the read-only inventory query against
Supabase" — asks this session to run SQL directly against the production database. **That
was not done, and will not be done, by this session.**

**Why, stated plainly rather than deferred to a footnote:**

1. **This session's own persistent, standing instruction is explicit and unconditional:**
   never request database credentials, and never automate the Supabase SQL Editor —
   generate one query, wait for the Owner to paste results back. This is not a
   preference being applied loosely; it is the exact reason every prior phase in this
   sprint (`OWNER_EXECUTION_PACKAGE.md`, Phase 13, 13A, 13B) prepared a copy-paste-ready
   query and handed it to the Owner rather than running it. Phase 13C does not get a
   different rule because its instruction says "execute" — the phrasing of a mission does
   not override a standing policy the user has set for this exact scenario.
2. **No credential capable of running this query exists in this session's reach, and
   none was requested.** `.env` (read earlier this session) holds only
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` — the anon key. That key is itself subject
   to the exact RLS recursion under investigation, and even without that problem, an anon
   key routed through PostgREST has no path to `pg_catalog`, `pg_policy`, or `pg_proc` —
   the inventory query in Phase 13B §Section 1 requires a direct SQL connection with
   catalog-read privilege (i.e., the Supabase SQL Editor, logged in as the project owner),
   not an API call this session could make with what it already has.
3. **A Supabase MCP server is configured but unauthenticated.** Authenticating it this
   turn, on this session's own initiative, in order to gain live database query access,
   is itself the exact action the standing policy prohibits — the policy is about not
   acquiring DB access autonomously, not only about not typing a password into a form.

**Nothing in Objectives A–F below can be completed without a real result set.** Rather
than infer, theorize, or reuse a prior turn's predicted state as if it were this turn's
evidence — which the mission explicitly forbids ("No assumptions. No theory. No inferred
state. Only report what the database returns.") — this document reports that no such
evidence exists yet, precisely as instructed.

---

## A–C. Live policy/function/owner extraction

**Not performed.** No query was run; no policy text, RLS/FORCE RLS status, or function
definition/owner was retrieved this turn. Section 1 of
`BELL24H_OS_PHASE13B_FINAL_RLS_EXECUTION_PACKAGE.md` remains the exact, unexecuted query
required to answer these.

## D. Which case is active?

**Cannot be determined this turn.** Cases 1–5 (Case 5, "unexpected state," is
this mission's own addition since Phase 13B — noted, and folded into Phase 13B's own
Section 2 step 4: "if none of the above match... stop and return the full Section 1
output for fresh analysis rather than guessing a fifth cause") are distinguished
exclusively by the live inventory result. None can be selected from repository evidence
alone — that determination was already made, correctly, across Phase 13/13A/13B, and
nothing this turn changes it.

## E. Comparison against `supabase_schema.sql` and Phase 13B

**Not performed** — there is no live-side value to compare against the repository's
documented policy text. The repository side of this comparison is already complete and
unchanged (Phase 13B §A/§B): `profiles`' SELECT policy is self-recursive at lines
534-537, `organizations`' SELECT policy transitively depends on it at lines 524-527.

## F. Evidence

None obtained this turn. No assumption, theory, or inferred state is substituted for it,
per this mission's own explicit instruction.

---

## Final Questions

**1. Which case is active?**
Unknown — requires the live query result.

**2. What exact policy is causing recursion?**
**Repository-side, this is already fully known and unchanged from Phase 13B:**
`"Users can view own profile or org members"` on `public.profiles`
(`supabase_schema.sql:534-537`), transitively exposing `"Users can view their own
organization"` on `public.organizations` (`:524-527`). **Whether this is still the exact
live policy text, or whether Cases 2-5 apply instead, is unknown** without the query
result.

**3. Is remediation required?**
Yes, in the sense that the live production error (`infinite recursion detected in policy
for relation "profiles"`, observed directly in Phase 12) proves something in the current
live database still needs fixing. **Which exact remediation is unknown** until Section 1's
output identifies the case.

**4. If remediation is required, which exact remediation block from Phase 13B should be
executed?**
**Cannot be selected yet.** Phase 13B's Section 3 has four statement blocks (A, A-1, B,
C), each conditioned on a specific evidence pattern that only the live inventory reveals.
Choosing one now would be exactly the "assumption"/"inferred state" this mission
prohibits.

**5. Is the project READY FOR RLS EXECUTION?**
No — for the same reason it was not ready at the end of Phase 13, 13A, or 13B: the live
database state remains unobserved by this session.

---

## What actually needs to happen next

Run `BELL24H_OS_PHASE13B_FINAL_RLS_EXECUTION_PACKAGE.md`'s **Section 1** query — reproduced
below unchanged, so this document also stands alone — in the Supabase SQL Editor, and
paste the full result grid back into this conversation. That single action is the only
thing separating this document from a genuine, evidence-based Phase 13C result.

```sql
-- PHASE 13B/13C LIVE INVENTORY — READ-ONLY. Paste the full result grid back.
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

Once that result is in hand, resolving it to a case and selecting the matching remediation
block is mechanical, per Phase 13B §Section 2's interpretation guide — no further
repository analysis is needed for that step.

---

## FINAL VERDICT

# NOT READY FOR RLS EXECUTION

Not because anything new was found wrong — because nothing was found at all this turn.
This session did not, and will not, execute SQL against Supabase itself, per the standing
manual-SQL workflow. The verdict is identical in substance to Phase 13/13A/13B's, for the
identical reason: live evidence does not yet exist in this session.
