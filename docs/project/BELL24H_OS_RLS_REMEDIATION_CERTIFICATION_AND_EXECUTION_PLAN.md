# BELL24H_OS RLS BLOCKER REMEDIATION — CERTIFICATION & EXECUTION PLAN

**Repository:** `digitex-erp/digitex-erp-bell24h-os`
**Branch:** `frontend-activation/fd1-vercel-build`, `HEAD 0fa67f1`
**Phase:** RLS Blocker Remediation Certification (Phase 4) + RLS Remediation Execution
Plan (Phase 4) — **two missions received together this turn, answered as one document**
(see mapping below). **Audit only. No code modified. No SQL modified. No migration
created. Nothing deployed.**
**Date:** 2026-09-14

**This document is intentionally left UNCOMMITTED.** One of the two missions received
this turn explicitly states "Do NOT commit"; the other is silent on commits. Per this
session's established practice when two combined instructions differ, the more
restrictive one governs — this file is written to disk (both missions permit that; neither
forbids producing a deliverable) but not committed. Say so explicitly if you want it
committed, matching every other audit document this session.

**Evidence tier, stated once:** every finding below is fresh static source analysis
performed this turn — files re-read, patterns re-grepped, line numbers re-verified against
the current working tree (confirmed unchanged since the last RLS audit via `git log`/`git
status`: no commits have touched `supabase_schema.sql`, `server/middleware/requireAuth.ts`,
or `src/lib/currentOrganization.ts` since `050887f`). No live database was queried, no SQL
was executed, nothing was deployed. Where this document's conclusions differ from the two
prior committed documents (`1c0f79c`, `050887f`), that is flagged explicitly as a
correction, not silently substituted.

## Mapping: which section answers which mission

| This turn's requested deliverable | Section below |
|---|---|
| Mission A #1 Root Cause Certification / Mission B "exact dependency graph, failure chain, SQL objects" | §1–§2 |
| Mission A #4/#5 (is remediation complete / additional policies) | §3 |
| Mission A #6 (frontend code changes required) | §4 |
| Mission A #2/#7, Mission B (dependency chain, migration order, profiles-first/organizations-first/together) | §5 |
| Mission A #2 Final SQL Remediation Plan / Mission B "minimal remediation sequence" | §6 |
| Mission A #3 / Mission B "safe migration order" | §7 |
| Mission A #4 / Mission B #6 Rollback Plan | §8 |
| Mission A #5 / Mission B Risk Level, Estimated Engineering Hours | §9 |
| Mission A #6 Expected Result + explicit yes/no per feature | §10 |
| Mission A #3 which features blocked by each policy | §10 (same table, "today" column) |
| Mission B #7 Verification Plan | §11 |
| Mission A Final Verdict (GO / REQUIRES ADDITIONAL ANALYSIS) + Mission B GO/NO-GO for SQL implementation | §12 |

---

## 1. Root Cause Certification

### 1.1 Exact SQL policies causing recursion

Both re-read fresh this turn at `supabase_schema.sql`, lines confirmed unchanged from the
prior two audits:

**`public.profiles`, lines 534–537 — the self-recursive policy, the actual root cause:**

```sql
CREATE POLICY "Users can view own profile or org members" ON public.profiles
FOR SELECT USING (
  id = auth.uid() OR (organization_id IS NOT NULL AND organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid()))
);
```

The `OR` branch's subquery reads `public.profiles` from inside a policy attached to
`public.profiles`, as the calling user (not `SECURITY DEFINER`) — that inner read is
itself subject to this same policy, which contains the same subquery. Postgres raises
`42P17` once it detects the cycle.

**`public.organizations`, lines 524–527 — not self-recursive, but unsafe the same way:**

```sql
CREATE POLICY "Users can view their own organization" ON public.organizations
FOR SELECT USING (
  id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
);
```

This policy is on `organizations`, not `profiles` — it does not recurse into itself. But
its subquery reads `profiles` as the calling user, which means evaluating it requires
`profiles`' own `SELECT` policy to succeed. While that policy is the broken one above, this
query fails too — not from self-recursion, but as a downstream casualty.

**Confirmed unaffected, re-verified this turn:**
- `public.profiles` `UPDATE` policy (line 540–543): `id = auth.uid()` only, no subquery —
  safe, no change needed.
- `public.get_current_org_id()` (line 50–60): `SECURITY DEFINER`, safe — see §1.2.
- The 30-table `DO $$` loop (lines 546–575, `roles` through `tag_relations`): every policy
  calls `get_current_org_id()`, not a raw subquery — individually safe.
- `vault_documents`, `rd_library`, `timeline_milestones`, `decision_records` (lines
  2027–2038): each has exactly one policy, `"Public Read Access" ... USING (true)` — fully
  permissive, **zero dependency on `profiles` or `organizations`**, confirmed by direct
  read of the schema this turn. Not affected by this bug in either direction.
- No `FORCE ROW LEVEL SECURITY` appears anywhere in `supabase_schema.sql` (grepped this
  turn, zero matches) — this matters directly for §1.2's mechanism.

### 1.2 Why the fix pattern works — mechanism, verified

`get_current_org_id()` is `SECURITY DEFINER`, meaning its internal `SELECT ... FROM
public.profiles WHERE id = auth.uid()` executes with the function owner's privileges, not
the calling user's. In standard Postgres (and unmodified here, per the `FORCE ROW LEVEL
SECURITY` check above), a table's owner — and a `SECURITY DEFINER` function owned by that
same role — **bypasses that table's RLS entirely**, not merely "runs a different, safer
policy." The internal read never re-enters `profiles`' `SELECT` policy at all, regardless
of what that policy currently says. This is why the 30-table pattern has always been safe,
and it is the precise mechanism the remediation in §6 relies on.

### 1.3 Dependency chain (Mission B's "exact dependency graph")

```
public.profiles.SELECT policy (line 534)
  └─ inline subquery reads public.profiles directly (as calling user, RLS-enforced)
       └─ re-triggers the same policy → unbounded recursion → Postgres 42P17

public.organizations.SELECT policy (line 524)
  └─ inline subquery reads public.profiles directly (as calling user, RLS-enforced)
       └─ hits profiles' policy above → inherits its failure (not itself recursive)

public.get_current_org_id() [SECURITY DEFINER]
  └─ internal SELECT on public.profiles → RLS BYPASSED entirely (owner privilege)
       └─ always succeeds regardless of profiles' policy state
       └─ used by: the 30-table org-isolation loop (safe, unaffected)
       └─ NOT used by: requireAuth.ts or currentOrganization.ts (§1.4) — this is why
          those two call sites are exposed even though the function that would have
          protected them already exists in this schema
```

### 1.4 All call sites — backend

Re-grepped this turn (`server/**/*.ts` for `profiles|organizations`): **exactly one
backend touchpoint**, `server/middleware/requireAuth.ts:106–123`. Read in full this turn:

```ts
const profileRes = await fetch(
  `${config.url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=organization_id`,
  { headers: { apikey: config.anonKey, Authorization: `Bearer ${token}` } },
);
```

This queries PostgREST with the caller's own bearer token (not the service key alone) —
PostgREST enforces RLS using the JWT's claims, so this hits the broken `profiles` policy
exactly like a client-side query. **Precision correction to the prior Blocker Audit
document:** `requireAuth.ts` does not surface the raw `"infinite recursion..."` string —
`!profileRes.ok` short-circuits to `deny(403, "organization_unresolved", ...)` (line 113)
before the response body's error text is ever inspected. The raw Postgres error string
only reaches a screen via `supabase-js` client calls, which propagate `error.message`
verbatim (confirmed at `SystemDiagnosticsPage.tsx:134,181`). **Every route gated by
`requireAuth`** — re-grepped this turn against `server.ts` — is blocked at this single
chokepoint, before its own handler logic ever runs:

`GET /api/check-table`, `GET /api/check-users-count`, `GET /api/vault/documents`, `POST
/api/vault/documents`, `GET /api/vault/rd`, `GET /api/vault/timeline`, `GET
/api/vault/phases`, `GET /api/vault/decisions`, `POST /api/vault/ai-summary`, `POST
/api/vault/mentor-advice` — **11 routes total**, all fail with `403
organization_unresolved` today, regardless of any Authorization header correctness,
regardless of the vault tables' own (permissive, §1.1) policies.

### 1.5 All call sites — frontend

Re-grepped fresh this turn across `src/` for `.from('profiles')` / `.from('organizations')`
— **13 files, 35 call sites** (a materially higher, more precise count than either prior
document's "~10 files / 13 call sites," which undercounted; this list supersedes that
figure):

| File | Call sites (line numbers) | `profiles` / `organizations` |
|---|---|---|
| `src/lib/currentOrganization.ts` | 33 | profiles |
| `src/pages/AiProvidersPage.tsx` | 56, 78, 97 | profiles ×3 |
| `src/components/layout/AppLayout.tsx` | 133, 135 | profiles, organizations |
| `src/modules/ai-providers/AiProviderService.ts` | 454, 536, 604 | profiles ×3 |
| `src/pages/ContentPlannerPage.tsx` | 63, 117, 141 | profiles ×3 |
| `src/pages/DashboardPage.tsx` | 20, 23, 26, 29 | profiles, organizations, profiles ×2 |
| `src/pages/ImageStudioPage.tsx` | 68, 110, 137 | profiles ×3 |
| `src/pages/JobOrchestratorPage.tsx` | 26 | profiles |
| `src/pages/OrganizationPage.tsx` | 31, 38, 50, 75 | profiles, organizations, profiles, organizations |
| `src/pages/PromptStudioPage.tsx` | 71, 124, 226 | profiles ×3 |
| `src/pages/SystemDiagnosticsPage.tsx` | 127, 174 | organizations ×2 |
| `src/pages/TeamPage.tsx` | 44, 58, 63, 106, 372 | profiles ×5 |
| `src/pages/VideoStudioPage.tsx` | 77, 122, 150 | profiles ×3 |

Every one of these is a direct, RLS-enforced query — none route through
`get_current_org_id()`, none are protected by §1.2's bypass mechanism. This is the exposure
surface on the client side.

---

## 2. Failure chain, end to end

1. Any authenticated user's browser calls `supabase.from('profiles')...` or
   `supabase.from('organizations')...` directly (§1.5), **or** a request reaches
   `requireAuth` (§1.4).
2. PostgREST evaluates the relevant policy under that user's JWT.
3. For `profiles`: the policy's own subquery re-enters itself → `42P17`.
   For `organizations`: the policy's subquery reads `profiles` → hits step 3's failure.
4. **Client-side:** `supabase-js` returns `{data: null, error: {message: "infinite
   recursion detected in policy for relation \"profiles\"", code: "42P17"}}` — surfaced
   verbatim wherever the calling code renders `error.message` (e.g.
   `SystemDiagnosticsPage.tsx:134,181`); most of the 35 call sites in §1.5 instead just
   destructure `data` without checking `error`, so they silently get `profile ===
   undefined` and any code that reads `profile.organization_id` next either throws or
   (where guarded) silently no-ops.
5. **Server-side:** `requireAuth.ts` sees `!profileRes.ok`, returns `403
   organization_unresolved` to the caller — the caller (a browser fetch via
   `authedFetchJson`, per this session's earlier fix) sees a 403, not the underlying SQL
   error text, unless it inspects the response body's `message` field.

---

## 3. Is the previously proposed remediation SQL complete? Are additional policies required?

**Yes, complete for the reported recursion — with one precision this turn adds that the
prior Investigation document (`050887f`) stated more weakly than the evidence supports.**

The prior document recommended fixing both `profiles` and `organizations` "in the same
pass," reasoning that skipping the `organizations` fix would leave the Certification
Dashboard "failing... until a user-level query happens to touch `profiles` through some
other path" — a hedge, not a proven claim. **Re-derived from first principles this turn:**

- `organizations`' policy is not self-recursive (§1.1) — its only defect is that it reads
  `profiles` inline, so it inherits whatever state `profiles`' own policy is in.
- Once `profiles`' policy is fixed to route through `get_current_org_id()` (§1.2, whose
  internal read bypasses RLS entirely), `organizations`' **existing, unmodified** policy's
  inline subquery against `profiles` succeeds too — it is no longer touching a recursive
  policy, it is touching a fixed one.
- **Therefore: fixing `profiles` alone is both necessary and independently sufficient to
  resolve both the `profiles` recursion and the `organizations` read failure.** The
  `organizations` fix is not causally required for either symptom to clear.

This is a genuine sharpening of, not a contradiction to, the prior document's
recommendation — the recommendation to fix both remains correct engineering practice
(§3.1), but the reasoning "otherwise it would continue failing" does not hold up, and
should not be repeated as if it were the justification.

**No policy beyond these two requires modification to resolve the reported recursion.**
Checked this turn and confirmed unaffected: the `profiles` `UPDATE` policy, all 30
org-isolation-loop policies, all 4 vault-table permissive policies, the 4 storage-bucket
policies (lines 581–584, unrelated table).

### 3.1 Why fix `organizations` anyway, even though it's not required

- **Consistency:** brings `organizations` in line with the `get_current_org_id()`
  convention every other tenant-scoped table already uses — the current inline-subquery
  form is the same unsafe *pattern* `profiles` had, just not self-referential in this one
  instance. Leaving it as a template risks a future copy-paste reintroducing a variant of
  this exact bug.
- **Performance:** the inline form does a real subquery read of `profiles` (subject to RLS)
  on every `organizations` row evaluated; `get_current_org_id()` is typically simpler for
  the planner to reason about and matches the already-proven pattern.
- **Zero cost to including it:** it is an independent, one-line `DROP`/`CREATE POLICY`
  pair (§6) with no ordering dependency that would make deferring it safer (§5).

### 3.2 A related, out-of-scope observation (not part of this remediation)

`organizations` has **zero `INSERT`/`UPDATE`/`DELETE` policies** — confirmed by grep this
turn (only one `CREATE POLICY` statement exists for this table, `SELECT` only). This means
no authenticated-role client can create or modify an organization row under RLS as
currently written; `handle_new_user()` (lines 506–518) only inserts a `profiles` row with
no `organization_id` set. This is a **pre-existing, separate gap**, unrelated to the
recursion bug and outside this mission's "focus ONLY on the database blockers [recursion]"
scope — recorded here per this repository's governance convention (report, do not fix
out-of-scope findings), not something either proposed SQL statement touches or needs to.

---

## 4. Are frontend code changes required?

**No frontend code change is required to resolve the recursion itself.** Every one of the
35 call sites in §1.5 and the one backend call site in §1.4 issues a logically correct
query against a policy that is currently broken — the code is not the defect; the policy
is. Once §6's SQL is applied, these same queries, unmodified, will succeed.

Two adjacent, non-blocking observations, recorded per the same out-of-scope convention as
§3.2 (not required, not recommended as part of *this* remediation, noted for completeness
per Mission A's explicit item 6):

- Most of the 35 frontend call sites destructure `{ data }` without checking `error`
  (§2 step 4) — meaning even after the SQL fix, a *future*, different failure at the same
  call sites would still fail silently rather than surface a distinct error state. This is
  a pre-existing shallow error-handling pattern, not something this recursion bug caused
  or that fixing the recursion needs to touch.
- `currentOrganization.ts` and the 13 files' direct queries would be functionally
  equivalent to (and slightly more consistent with) calling a shared,
  `get_current_org_id()`-backed helper — but that is a refactor for a different mission,
  not a requirement for this fix to work.

---

## 5. Dependency chain determination: profiles-first, organizations-first, or together?

Directly answering Mission B's explicit question, based on §3's re-derivation:

- **`profiles` must be fixed.** It is the root cause and the only genuinely required
  statement.
- **`profiles` fixed alone is sufficient for `organizations` reads to also succeed** — no
  separate fix to `organizations` is causally required (§3).
- **`organizations` fixed alone, with `profiles` left broken, would NOT fix `profiles`.**
  `organizations`' new policy (`id = public.get_current_org_id()`) would itself succeed
  (the function bypasses RLS internally, §1.2, regardless of `profiles`' policy state) —
  but every direct `profiles` read in §1.4/§1.5 would still recurse. Fixing only
  `organizations` leaves the majority of the exposure surface (35 of 36 call sites) still
  broken.
- **Both should be deployed together, in one script, in a single transaction** — not
  because order matters between them (it doesn't; they are independent statements on
  independent tables, and Postgres has no cross-table policy evaluation ordering concern
  here), but because there is no reason to split a two-statement, mutually-independent fix
  into two deployments when one is strictly simpler to verify and roll back as a unit.

**If, for any operational reason, they must be applied as two separate manual SQL Editor
runs:** apply `profiles` first (or simultaneously) — never apply only `organizations` and
consider the incident resolved, since that would leave the root cause (and 35 of 36 call
sites) untouched.

---

## 6. Final SQL Remediation Plan (minimal remediation sequence)

Both statements below are unchanged from the prior Blocker Audit/Investigation documents —
re-verified this turn against the current schema, still correct and still minimal:

```sql
-- Statement 1 (required, root cause)
DROP POLICY IF EXISTS "Users can view own profile or org members" ON public.profiles;
CREATE POLICY "Users can view own profile or org members" ON public.profiles
FOR SELECT USING (
  id = auth.uid() OR (organization_id IS NOT NULL AND organization_id = public.get_current_org_id())
);

-- Statement 2 (not required, strongly recommended — §3.1)
DROP POLICY IF EXISTS "Users can view their own organization" ON public.organizations;
CREATE POLICY "Users can view their own organization" ON public.organizations
FOR SELECT USING (
  id = public.get_current_org_id()
);
```

Both are one-line policy-body substitutions reusing `get_current_org_id()`, a function
that already exists, is already proven across 30 tables, and introduces no new mechanism,
privilege grant, or trust boundary. Neither statement is a data migration — no `ALTER
TABLE`, no column change, no `INSERT`/`UPDATE` of existing rows.

---

## 7. Migration Execution Order / Safe Migration Order

1. Run Statement 1 (`profiles`) and Statement 2 (`organizations`) together, in a single
   Supabase SQL Editor execution, in the order shown above (no functional ordering
   requirement between them — see §5 — but running the root-cause statement first keeps
   the script's own narrative order matching its causal order).
2. Do **not** bundle this with a full `supabase_schema.sql` re-run — the full file still
   contains the original recursive policy text (source-level fix is a separate, later
   step, out of scope here) and re-running it would recreate every other table's policies
   and re-run seed `INSERT`s unnecessarily, widening the change surface for no reason
   connected to this fix (unchanged conclusion from the prior Blocker Audit, §7).
3. This is independent of, and has no ordering interaction with, any other pending
   migration — no other schema change is queued or implicated by this fix.

---

## 8. Rollback Plan

Both statements are trivially reversible — restore each policy's original `USING`
expression via the same `DROP POLICY` / `CREATE POLICY` pattern, substituting the original
(recursive/unsafe) body back in:

```sql
-- Rollback Statement 1
DROP POLICY IF EXISTS "Users can view own profile or org members" ON public.profiles;
CREATE POLICY "Users can view own profile or org members" ON public.profiles
FOR SELECT USING (
  id = auth.uid() OR (organization_id IS NOT NULL AND organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid()))
);

-- Rollback Statement 2
DROP POLICY IF EXISTS "Users can view their own organization" ON public.organizations;
CREATE POLICY "Users can view their own organization" ON public.organizations
FOR SELECT USING (
  id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
);
```

**When rollback would actually be needed:** essentially never, for a policy-only change
of this shape — the new policy is logically equivalent to the old policy's *intent* (own
row, or same-org row), just resolved through a non-recursive path, so there is no
plausible "the new policy denies access the old one granted" regression to roll back from.
The only realistic rollback trigger is a typo in the statement itself, which the "run,
then immediately re-check `/system/diagnostics`" step in §11 would catch within the same
session. No data is touched by either direction, so rollback carries no data-loss risk.

---

## 9. Engineering Risk Assessment / Risk Level / Estimated Engineering Hours

**Risk Level: LOW.**

| Aspect | Assessment |
|---|---|
| Fix complexity | Very low — two one-line policy-body substitutions, reusing an existing, proven function |
| Blast radius | Contained to two `SELECT` policies; does not touch table structure, data, the 30 already-correct policies, or the 4 vault permissive policies |
| Regression risk | Low — new policies are logically equivalent in intent to the old ones, resolved through a non-recursive path (§8) |
| Risk of NOT fixing | High and current — 11 backend routes and 35 frontend call sites affected today (§1.4–1.5), not a future risk |
| Execution risk | Low-to-medium, mitigated by keeping the change to the smallest possible statement pair rather than a full schema re-run (§7) |

**Estimated Engineering Hours:** **0 engineering hours** for the SQL itself — it is
Owner-executed, per this project's established manual-SQL workflow (never automated or
credential-requested by this or any session), and both statements are already fully
drafted above, requiring no further engineering. The only engineering-adjacent time is
**~1 hour** to re-verify `/system/diagnostics` reaches `allPassed = true` post-fix (§11) —
consistent with the estimate already given in the Re-Verification document (`
BELL24H_OS_DEPLOYMENT_READINESS_REVERIFICATION.md`), not re-derived differently here.

---

## 10. Expected Result After Fix — explicit per-feature determination

Per-feature answers, each split into "org-context resolution" (what this SQL fix actually
controls) versus any separate, unrelated gap that the fix does not touch — no answer below
is rounded up past what the evidence supports:

| Feature | Blocked today by | After SQL fix |
|---|---|---|
| **Dashboard** | `DashboardPage.tsx:20,23,26,29` — 4 direct `profiles`/`organizations` reads, all recurse today | **Yes — fully unblocked.** All 4 calls succeed once the policy is fixed; nothing else gates this page's data. |
| **Video Studio** | `VideoStudioPage.tsx:77,122,150` — 3 `profiles` reads for org context, recurse today | **Org-context resolution: yes, unblocked** — project/job CRUD (loading, listing) will work. **Generation capability: no change** — 0% today because no server-side video-generation provider exists and `JobWorker` is disabled (`src/main.tsx`), a separate, pre-existing gap this SQL fix does not touch. |
| **Image Studio** | `ImageStudioPage.tsx:68,110,137` — same pattern | Same split as Video Studio: **org-context yes, generation capability unaffected (still 0%).** |
| **Knowledge Vault** | Server-side: `requireAuth.ts`'s `organizationId` resolution (§1.4) blocks all 9 vault routes with `403` before their own handlers run, regardless of the Authorization-header fix already shipped (`4bfd2b4`) | **Yes — the 5 read-only vault components become fully operational.** Once `requireAuth` stops returning 403, the vault tables' own policy is already fully permissive (`USING (true)`, §1.1) — no further gate exists downstream. The `POST /api/vault/documents` create path is a separate case: it already runs on the pooled `DATABASE_URL` connection (RLS bypassed by design, per this session's earlier decision not to migrate it, since no `INSERT` policy exists on `vault_documents` — §3.2-adjacent, unrelated to this fix) — it works today already and is neither newly broken nor newly fixed by this remediation. |
| **Foundation Certification Dashboard** (`/system/diagnostics`) | `db`/`org` diagnostic steps (`SystemDiagnosticsPage.tsx:127,174`), both query `organizations`, both recurse today via §1.3's chain | **Conditionally yes.** `db` and `org` will both report `'pass'` after the fix (§3's re-derivation: `organizations` reads succeed once `profiles` is fixed). But `allPassed` (line 212–218) also requires `session.status==='pass'` and `jwt.status==='pass'`, which require an actual logged-in user viewing the page — a usage precondition, not a code or SQL blocker. **With a real authenticated user loading the page after the fix, `allPassed` should reach `true`; the SQL fix alone does not make it `true` for an unauthenticated visitor, which is expected/correct behavior, not a residual defect.** |

---

## 11. Verification Plan

1. Apply §6's two statements via the Supabase SQL Editor (Owner-executed, per this
   project's manual-SQL workflow — this session neither executes SQL nor requests
   credentials).
2. Load `/system/diagnostics` while signed in as a real user; confirm `db` and `org` both
   show `'pass'` and `allPassed` reaches `true` (§10).
3. Load `/dashboard`; confirm the metric cards render real counts, not an error state.
4. Load `/knowledge-vault`; confirm all 5 components load real data (not the error state
   the `authedFetchJson` migration already added for a 401 — this should now be a
   different, resolved path entirely, a `200` with real rows).
5. Spot-check one of the 9 `requireAuth`-gated vault routes directly (e.g. `GET
   /api/vault/documents` with a real bearer token) and confirm it no longer returns `403
   organization_unresolved`.
6. This verification plan does not require and should not attempt to verify Video/Image
   Studio's generation capability — that remains a separate, already-documented 0% gap,
   unaffected by this fix either direction (§10).

---

## 12. Final Verdict

# GO FOR DATABASE REMEDIATION
# GO for SQL implementation (§6's two statements)

Both framings of this turn's verdict question point to the same answer: the root cause is
precisely identified (§1), the proposed fix is verified complete and independently
sufficient for the reported symptom (§3, §5), no additional policy needs to change (§3),
no frontend code needs to change (§4), the fix is Owner-executable in one small,
independently-reviewable SQL Editor run with no ordering complexity (§6–§7) and a trivial,
low-risk rollback (§8), and the expected result after applying it is precisely bounded —
real, meaningful unblocking for Dashboard, Video/Image Studio's org-scoped data, Knowledge
Vault's read surface, and the Foundation Certification Dashboard, explicitly not
overstated to also claim Video/Image Studio's generation capability or an unauthenticated
`allPassed` (§10).

This verdict certifies the SQL is ready to run — it does not itself authorize deployment
of the frontend branch, which remains gated separately on TASK-14 and the live
routing/render verification already documented in
`BELL24H_OS_DEPLOYMENT_READINESS_REVERIFICATION.md`, unaffected by this document.

---
*(Deliberately uncommitted this turn — see note at top.)*
