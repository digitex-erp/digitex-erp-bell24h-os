# BELL24H_OS FOUNDATION CERTIFICATION BLOCKER AUDIT

**Repository:** `digitex-erp/digitex-erp-bell24h-os`
**Phase:** Foundation Certification Blocker Audit — **audit only, no code changed, no
database changed, no migration run, no deploy**
**Date:** 2026-09-14
**Reported symptom:** `Database error: "infinite recursion detected in policy for relation
profiles"` — Postgres error `42P17`. This audit did not itself query the live database or
observe the dashboard's own output directly — the analysis below is static: reading the
policy definition and reasoning about what Postgres would do when evaluating it. That
reasoning predicts exactly this error, for exactly this table, with no other plausible
source of a `42P17` on `profiles` found anywhere in the schema (Sections 3-4). The match
between the predicted behavior and the reported symptom is precise enough that the two are
almost certainly the same defect, stated here as a strong inference from source, not as a
runtime observation.

No code was modified, no database object was altered, no migration was run.

---

## 1. Root Cause Analysis

The `profiles` table's own row-level security `SELECT` policy queries `profiles` from
inside itself, directly (not through the safe, existing helper function this schema
already uses everywhere else). Postgres must apply RLS to every read of a table, including
reads that happen *while evaluating another RLS policy on that same table* — so evaluating
this policy triggers a second evaluation of itself, which triggers a third, without bound,
until Postgres detects the cycle and raises `42P17`.

This is not a new or exotic bug pattern — it is the single most common way to break RLS on
a self-referencing "which org am I in" table, and this schema already contains the correct
fix for every *other* table (`public.get_current_org_id()`, a `SECURITY DEFINER` function)
— it simply isn't used by `profiles`' own policy, which predates or was written separately
from that convention.

## 2. Exact Policy Causing Recursion

`supabase_schema.sql:534-537`:

```sql
CREATE POLICY "Users can view own profile or org members" ON public.profiles
FOR SELECT USING (
  id = auth.uid() OR (organization_id IS NOT NULL AND organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid()))
);
```

The `OR` branch's subquery — `SELECT organization_id FROM public.profiles WHERE id =
auth.uid()` — reads `public.profiles` directly, as the querying user, from inside a policy
attached to `public.profiles`. That inner `SELECT` is itself subject to this same policy,
which contains the same subquery, which is itself subject to this same policy — the
recursion.

**Contrast with the working pattern this schema already uses for every other table**
(`supabase_schema.sql:50-60`, `569-572`):

```sql
CREATE OR REPLACE FUNCTION public.get_current_org_id()
RETURNS UUID AS $$
DECLARE
    org_id UUID;
BEGIN
    SELECT organization_id INTO org_id
    FROM public.profiles
    WHERE id = auth.uid();
    RETURN org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

`get_current_org_id()` runs the *identical* underlying query — but as `SECURITY DEFINER`,
which executes with the function owner's privileges rather than the calling user's. In this
schema's deployment (Supabase), that means the internal `profiles` read is not subject to
the calling user's RLS policy the way a direct, inline subquery is — no recursion. This
function is already used correctly by all 30 other organization-scoped tables
(`supabase_schema.sql`'s `DO $$ ... FOREACH t IN ARRAY tables ... $$` block, lines
546-575: `roles`, `user_roles`, `companies`, `rfqs`, `orders`, `tasks`, `notifications`,
`audit_logs`, `ai_agents`, `campaigns`, etc.) and by `organizations`' own `SELECT` policy's
*intent* (though see Section 4 — `organizations` itself inlines the subquery too, the same
unsafe way `profiles` does, rather than calling the function).

**The fix pattern already exists in this codebase and is already proven safe** — it is not
present in the one place (`profiles`' own policy) where it is most needed, because a
self-referencing table cannot query itself directly from its own policy no matter how the
subquery is phrased; it must go through a mechanism (like `SECURITY DEFINER`) that steps
outside the calling user's RLS context.

## 3. Files Involved

| File | Role |
|---|---|
| `supabase_schema.sql:533-537` | **The defect itself** — the recursive policy definition |
| `supabase_schema.sql:50-60` | The existing, safe pattern (`get_current_org_id()`) the fix should reuse |
| `supabase_schema.sql:524-527` | `organizations` table's own `SELECT` policy — also inlines a raw `profiles` subquery directly (not via the safe function); not self-referencing itself, but any read of `organizations` still triggers a read of `profiles`, which still hits the broken policy above. A second, related exposure — see Section 4. |
| `server/middleware/requireAuth.ts:106-123` | **Every `requireAuth`-gated server route is affected.** Resolves `organizationId` via a direct PostgREST call (`GET {SUPABASE_URL}/rest/v1/profiles?id=eq.<uid>&select=organization_id`) using the caller's own bearer token — this goes through Postgres RLS exactly like a client-side query and would receive the same `42P17` error, surfaced to the caller as `403 organization_unresolved` or `503 auth_unavailable` depending on how the error is caught, not as the underlying database error. This means the failure mode reported by the dashboard ("RLS verification failing", "Login session missing") is consistent with, and likely directly caused by, this same recursion — not a separate auth bug. |
| `src/lib/currentOrganization.ts:32-36` | Shared client-side helper (`getCurrentOrganizationId()`), used by `SeoIntelligenceService`, `CampaignManagerService`, and others per this session's earlier module audit — same inline `profiles` query pattern, same exposure. Returns `null` on failure (its documented behavior), which surfaces upstream as `"No authenticated organization context"` — another symptom that looks like an auth problem rather than a database one. |
| `src/pages/DashboardPage.tsx`, `AppLayout.tsx`, `OrganizationPage.tsx`, `TeamPage.tsx`, `AiProvidersPage.tsx` (×3), `ContentPlannerPage.tsx` (×3), `ImageStudioPage.tsx` (×3), `VideoStudioPage.tsx` (×3), `PromptStudioPage.tsx` (×3), `JobOrchestratorPage.tsx`, `src/modules/ai-providers/AiProviderService.ts` (×3) | **Every one of these calls `supabase.from('profiles').select('organization_id').eq('id', ...)` directly**, independently re-implementing the same pattern `currentOrganization.ts`'s own header comment already documents as duplicated. Every call site is independently exposed — this is not confined to one page or one feature. |

**Not involved / confirmed unaffected:** `AuthService.resolveRole()` (`src/modules/auth/AuthService.ts:35-38`) queries `user_roles`, not `profiles` — unaffected. All 30 tables in the `DO $$` loop (`roles` through `tag_relations`) use `get_current_org_id()` — unaffected by this specific recursion, though they would still fail *indirectly* the moment `get_current_org_id()` itself can't resolve an org (it can't, currently — see Section 4) even though their own policies aren't recursive.

## 4. Database Objects Involved

| Object | Type | Status |
|---|---|---|
| `public.profiles` | Table | RLS enabled; its own `SELECT` policy is the root cause |
| `"Users can view own profile or org members"` | Policy on `public.profiles`, `FOR SELECT` | **Recursive — the defect** |
| `"Users can update own profile"` | Policy on `public.profiles`, `FOR UPDATE` | Not recursive (`id = auth.uid()` only, no subquery) — unaffected |
| `public.get_current_org_id()` | Function, `SECURITY DEFINER` | Correct, safe, already-proven pattern — **not currently called by `profiles`' own policy, which is the gap** |
| `"Users can view their own organization"` | Policy on `public.organizations`, `FOR SELECT` | Not itself recursive, but inlines the same unsafe raw `profiles` subquery instead of calling `get_current_org_id()` — any read of `organizations` fails for the same underlying reason once `profiles`' policy is broken |
| 30 tables' `"Org isolation select/insert/update/delete"` policies (`roles` … `tag_relations`) | Policies via `get_current_org_id()` | Individually correct pattern; **practically unusable right now** because the function they call resolves against the same broken `profiles` table state — not because their own policy logic is wrong |

## 5. Safe Remediation Plan

*(Recorded for the record — per this mission's audit-only scope, nothing below is executed
here; this is not a schema change and not a migration run.)*

**The minimal, correct fix:** replace `profiles`' own `SELECT` policy's inline subquery
with a call to the function that already exists for exactly this purpose:

```sql
DROP POLICY IF EXISTS "Users can view own profile or org members" ON public.profiles;
CREATE POLICY "Users can view own profile or org members" ON public.profiles
FOR SELECT USING (
  id = auth.uid() OR (organization_id IS NOT NULL AND organization_id = public.get_current_org_id())
);
```

This is a one-line change to the policy body, reusing a function this schema already
trusts and already runs, with the same `SECURITY DEFINER` privilege boundary every other
table's policy already relies on — it introduces no new mechanism, no new privilege grant,
and no new trust boundary.

**Recommended, not required, alongside it:** apply the same substitution to
`organizations`' `SELECT` policy (`supabase_schema.sql:524-527`), replacing its inline
`profiles` subquery with `public.get_current_org_id()` too — not because it is itself
recursive, but because it is the same unsafe pattern, and leaving it inconsistent with the
fix above means a future edit to `profiles`' policy could reintroduce a variant of this bug
by copying the wrong example.

**Sequencing, per the manual-SQL workflow this project already follows:** this is a policy
replacement, not a data migration — no `ALTER TABLE`, no column change, no data movement.
It can be applied as a single, small, reviewable `DROP POLICY` + `CREATE POLICY` statement
pair, run manually by the project owner in the Supabase SQL editor, exactly as this
project's established workflow for schema changes already requires. It does not need to be
bundled with the full `supabase_schema.sql` re-run described in Section 7.

## 6. Risk Assessment

| Aspect | Assessment |
|---|---|
| **Fix complexity** | Very low — a 1-line policy-body substitution, reusing an existing, already-proven function |
| **Blast radius of the fix** | Contained to the `profiles` table's `SELECT` policy (and, if included, `organizations`' `SELECT` policy); does not touch the 30 already-correct `get_current_org_id()`-based policies, table structure, or any data |
| **Regression risk if applied as written above** | Low — the replacement expression is logically equivalent to the original intent (own row, or same-org row), just resolved through a non-recursive path. The `id = auth.uid()` branch (self-access) is untouched either way. |
| **Risk of NOT fixing it** | High, and current — every organization-scoped read in this application is affected today (Section 3's file list), not a future or edge-case risk. `requireAuth`-gated server routes fail to resolve organization context, client-side org-scoped pages fail to load real data, and this is very likely the direct cause of the dashboard's own "Login session missing" / "RLS verification failing" symptoms, not a separate issue. |
| **Risk of applying the fix incorrectly** (e.g., mistyping the replacement, or applying it via the full-schema re-run instead of a scoped statement) | Low-to-medium — mitigated by keeping the change to the smallest possible `DROP POLICY`/`CREATE POLICY` pair (Section 5) rather than re-running the entire `supabase_schema.sql`, which would also re-execute unrelated `INSERT` seed statements and every other table's policy drop/recreate, widening the change surface for no reason connected to this bug |

## 7. GO / NO-GO for Applying Schema Synchronization

# NO-GO — for the full `supabase_schema.sql` re-run specifically

Re-running the entire schema file (the mechanism behind this repo's `/api/migrate` route,
`server.ts:226-264`, which executes the whole file as one transaction) would **not fix this
bug** — the file as it stands today still contains the same recursive policy definition at
lines 534-537. Applying "schema synchronization" as currently defined would faithfully
reproduce the exact same defect, not resolve it. It is also broader than this fix needs:
it would re-run every table's `DROP POLICY`/`CREATE POLICY` pair and every seed `INSERT`,
none of which are implicated in this defect.

**GO — for the scoped, single-policy fix described in Section 5**, applied independently of
and before any broader schema synchronization. Once `supabase_schema.sql` itself is updated
to contain the corrected policy (a source-file edit, not covered by this audit's scope),
re-running full schema synchronization becomes safe and consistent again — but not before.

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GyjerP42mTVzzK2ZkSeRCf
