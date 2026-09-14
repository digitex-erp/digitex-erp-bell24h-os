# BELL24H_OS FOUNDATION CERTIFICATION BLOCKER INVESTIGATION

**Repository:** `digitex-erp/digitex-erp-bell24h-os`
**Phase:** Foundation Certification Blocker Investigation — **audit only, no code changed,
no SQL changed, no deploy**
**Date:** 2026-09-14

This investigation builds directly on `BELL24H_OS_FOUNDATION_CERTIFICATION_BLOCKER_AUDIT.md`
(committed `1c0f79c`, same session) — the root cause and remediation SQL are not re-derived,
they are cited. This document's new work is: (1) locating and tracing the actual "Foundation
Certification Dashboard" the mission refers to, which the prior audit did not identify by
name, and (2) answering the specific blocking-scope questions this mission asks as explicit
yes/no determinations, each with its own evidence, rather than as a general blast-radius
list.

No live database was queried. No code or SQL was modified.

---

## 1. Root Cause Report

**Identical root cause to the prior audit, restated briefly, with one new piece of direct
evidence added:**

`supabase_schema.sql:534-537`'s `SELECT` policy on `public.profiles` inlines a subquery
against `profiles` itself (`SELECT organization_id FROM public.profiles WHERE id =
auth.uid()`), rather than routing through `public.get_current_org_id()` — the
`SECURITY DEFINER` function this schema already uses safely for every other
organization-scoped table. Reading `profiles` re-triggers the same policy, which contains
the same subquery, without bound — Postgres error `42P17`.

**New this turn — the exact dashboard is identified, and its own code shows precisely how
the reported error text reaches the screen:**

The "Foundation Certification Dashboard" is `src/pages/SystemDiagnosticsPage.tsx`, routed at
`/system/diagnostics`, titled in its own UI "Certification Dashboard" (line 233) and
"Runtime Verification Dashboard" (line 313). Its `runDiagnostics()` function runs two
Supabase queries that both resolve to the broken policy chain:

- **Step 3, "Database Check"** (line 127): `supabase.from('organizations').select('id').limit(1)`
- **Step 7, "Organization Context"** (line 174): `supabase.from('organizations').select('id, name').limit(1).single()`

Neither queries `profiles` directly — both query `organizations`. But `organizations`' own
`SELECT` policy (`supabase_schema.sql:524-527`) *also* inlines a raw subquery against
`profiles` (`id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())`)
instead of calling `get_current_org_id()`. Evaluating that policy requires reading
`profiles`, which hits the same recursive `profiles` policy. The resulting Postgres error
message is surfaced verbatim: line 134, `` `Database error: ${tableError.message}` ``, and
line 181, `` `RLS/Query Error: ${error.message}` `` — this is almost certainly the exact
code path that produced the reported string `"infinite recursion detected in policy for
relation profiles"` on screen. This is now direct code-path evidence for the reported
symptom, not only a structural prediction as in the prior audit.

## 2. Affected Files

Carried forward from the prior audit (`server/middleware/requireAuth.ts`,
`src/lib/currentOrganization.ts`, and ~10 page/module files that query `profiles` directly —
not re-listed in full here, see that document), plus one newly-implicated file this turn:

| File | New finding this turn |
|---|---|
| `src/pages/SystemDiagnosticsPage.tsx` | **The Foundation Certification Dashboard itself.** Two of its own checks (`db`, `org`) query `organizations`, not `profiles` — and fail for the same underlying reason via `organizations`' policy. This is the file that produces the on-screen "Certification Blocked" state and the reported error text. |

## 3. Affected SQL Policies

| Policy | Table | Recursive? | Role in this investigation |
|---|---|---|---|
| `"Users can view own profile or org members"` | `public.profiles`, `FOR SELECT` | **Yes — the root cause** | Any read of `profiles` fails |
| `"Users can view their own organization"` | `public.organizations`, `FOR SELECT` | No (not self-referencing) | **But unsafe the same way** — inlines a raw `profiles` subquery instead of `get_current_org_id()`. This is the policy the Certification Dashboard's own two failing checks actually hit. Confirmed evaluated by `SystemDiagnosticsPage.tsx` lines 127 and 174. |
| `"Org isolation select/insert/update/delete"` (×30 tables, via `get_current_org_id()`) | `roles` … `tag_relations` | No | Individually correct pattern; **practically blocked anyway** wherever a page first needs to resolve `organization_id` via the direct `profiles`/`organizations` pattern before reaching one of these tables |
| No table or policy literally named "membership" exists in this schema | — | — | Per this mission's Task 5 ("Membership policies"): `profiles` *is* the membership record (its own source comment, line 531: "users can see members of their own organization") — there is no separate membership table. `user_roles` (role assignment) uses the safe `get_current_org_id()` pattern and is not itself recursive. |

## 4. Severity Assessment — Binary Determinations

| Question | Answer | Evidence |
|---|---|---|
| **Does it block all authenticated users?** | **Yes.** | The recursion is structural — a property of the policy definition, not of who is querying. Every authenticated user's read of `profiles` (directly) or `organizations` (via its policy) hits the identical code path in Postgres, regardless of identity, role, or organization. |
| **Does it block organization loading?** | **Yes.** | Directly demonstrated by the Certification Dashboard's own "Organization Context" check (Section 1) and independently by `src/lib/currentOrganization.ts`'s `getCurrentOrganizationId()`, used by `SeoIntelligenceService`, `CampaignManagerService`, and others (prior audit). Both fail the same way. |
| **Does it block dashboard functionality?** | **Yes.** | `src/pages/DashboardPage.tsx:20` resolves `organization_id` via a direct `profiles` query as its very first data call — every metric card (team members, active users, roles configured) depends on this succeeding first. It does not. |
| **Does it block Video Studio?** | **Yes.** | `src/pages/VideoStudioPage.tsx` resolves `organization_id` via a direct `profiles` query at 3 separate call sites (lines 77, 122, 150 per this session's earlier grep) before any project/job CRUD can run. |
| **Does it block Image Studio?** | **Yes.** | `src/pages/ImageStudioPage.tsx` has the identical pattern at 3 call sites, same conclusion. |

**Net severity: Critical, present in the schema as written today** — not a future or
edge-case risk. As in Section 1, this is a strong inference from source (every code path
this codebase has to resolve `organization_id` runs through the broken `profiles` policy or
the `organizations` policy that depends on it), not a claim independently confirmed by
querying a live database this session. Every organization-scoped feature in the deployed
(once the frontend build is fixed) or locally-run application depends on resolving
`organization_id` first.

## 5. Remediation Plan

Unchanged from the prior audit — reusing the existing, already-proven pattern, not
introducing a new mechanism:

```sql
DROP POLICY IF EXISTS "Users can view own profile or org members" ON public.profiles;
CREATE POLICY "Users can view own profile or org members" ON public.profiles
FOR SELECT USING (
  id = auth.uid() OR (organization_id IS NOT NULL AND organization_id = public.get_current_org_id())
);
```

**New emphasis from this investigation's findings:** the `organizations` table's own policy
substitution (recommended, not required, in the prior audit) is now better evidenced as
worth doing in the same pass — it is the exact policy the Certification Dashboard's own
checks hit, so leaving it unfixed means the Certification Dashboard would continue failing
its "Database Check" and "Organization Context" rows even after the `profiles` fix alone,
until a user-level query happens to touch `profiles` through some other path. Fixing both in
one pass, together:

```sql
DROP POLICY IF EXISTS "Users can view their own organization" ON public.organizations;
CREATE POLICY "Users can view their own organization" ON public.organizations
FOR SELECT USING (
  id = public.get_current_org_id()
);
```

Both are one-line policy-body substitutions, both reuse `get_current_org_id()`, both are
independently reviewable, and neither requires a full schema re-run (see the prior audit's
Section 7 for why a full `supabase_schema.sql` re-run would not fix this).

## 6. GO / NO-GO Recommendation

# GO — for the scoped two-policy fix (both statements in Section 5)
# NO-GO — for declaring Foundation Certification passed without applying it

This is not a marginal call: every binary question in Section 4 resolved to "yes, blocked,"
and the mechanism is now traced from the exact SQL policy through to the exact line of the
exact dashboard file producing the exact reported error text. There is no code path in this
application that reaches "Foundation Certified" (`SystemDiagnosticsPage.tsx`'s `allPassed`,
line 212) while this policy remains as written — `diagnostics.org.status` and
`diagnostics.db.status` cannot both be `'pass'` under the current schema, and both are
required inputs to `allPassed`. The certification dashboard's own logic will keep reporting
"Certification Blocked" — correctly — until the fix in Section 5 is applied by the project
owner through this repository's established manual-SQL workflow.

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GyjerP42mTVzzK2ZkSeRCf
