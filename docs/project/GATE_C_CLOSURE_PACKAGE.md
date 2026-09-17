# Review Gate C — Closure Package

**Phase:** Review Gate C Closure (governance/audit only — no sprint work).
**Date:** 2026-09-06
**Scope:** Assessment and proposal generation only. No source, schema, or database
state was modified. No sprint (B.5, D, or otherwise) was started.
**Baseline re-audited:** `NEXT_SPRINT_RECOMMENDATION.md`, `GATE_C_REMEDIATION_REPORT.md`,
`PROJECT_CONTINUITY_REPORT.md` (all dated 2026-08-03/08-11), plus live inspection of
current `server.ts`, `supabase_schema.sql`, `src/store/useAuthStore.ts`,
`src/hooks/useAuth.ts`, and `server/middleware/requireAuth.ts` as of this HEAD.

`docs/architecture/OS_INTEGRATION_DECISION_RECORD_V1.md` (the closest match to the
requested `OS_INTEGRATION_DECISION_RECORD.md`) was checked and contains no reference to
Gate C, C.2B, or C.2C — it governs the unrelated VyaparSethu S2S-integration track. It
is not a source for this closure package and is not cited further below.

---

## Re-audit result (Task 1): nothing has moved since 2026-08-11

Every item was checked against the current working tree, not re-asserted from the old
reports. One month of unrelated commits (`OS-INTEGRATION-*`, `OS-LIVE-*` —VyaparSethu
S2S auth, NVIDIA provider, Vercel ownership) landed on `main` in the interim; none of
them touch Gate C.

| Prior finding | Then (2026-08-11) | Now (2026-09-06) | Evidence checked this session |
|---|---|---|---|
| 8 previously-open routes | CLOSED (`requireAuth` applied) | **Still CLOSED** | `server.ts:193,205,275,286,301,312,323,334` all still show `requireAuth` on the registration |
| C.2B — query/bundle layer | CLOSED | **Still CLOSED** | No `select('*')` reintroduced against `ai_providers` |
| C.2B — DB layer (`REVOKE` + rotation) | OPEN | **Still OPEN** | No `REVOKE` statement anywhere in the repo (`grep -rn REVOKE **/*.sql` → 0 hits) |
| C.2C | BLOCKED (no ratified record) | **Still BLOCKED** | `MASTER_CONTEXT/KERNEL_ARCHITECTURE.md` is now *tracked* (committed `8bfdd5f`, 2026-08-11, "add pre-existing architecture baseline") — but its header is unchanged: still `Status: **DESIGN — NOT FROZEN**`, and its §20 C.2C definition still bundles the excluded pool-migration work. Committing it as an archived baseline did not ratify it as a gate record. No other Gate C record file exists in the repository. |
| Knowledge Vault tenancy | OPEN (Council decision) | **Still OPEN** | `supabase_schema.sql:1960-2024` — none of the 5 tables has an `organization_id` column |
| Live login verification | OPEN (owner action) | **Still OPEN** | Nothing in the repo can attest to this either way |
| 7 (now on `main`) Gate-C-related commits | Held locally, unpushed | **On `origin/main`** | `git log origin/main` and `git branch --contains d2ca7cd` confirm `aea842e`, `cfa6cea`, `343945c`, `d2ca7cd` are on `main` |

**New observation, not in prior reports:** the client `User` type in
`src/store/useAuthStore.ts:3-8` carries no organization field at all — `id`, `email`,
`name`, `role` only. Organization context is resolved *only* server-side, inside
`requireAuth`, from the caller's Supabase profile. This matters for Task 5 below.

---

## Deliverable 1 — Gate C Closure Matrix

| Blocker | Current Status | Evidence | Owner | Action Required | Verification Method | Closure Criteria |
|---|---|---|---|---|---|---|
| **C.2B (DB layer)** — `ai_providers.api_key` column not `REVOKE`d; no rotation evidenced | OPEN | `supabase_schema.sql:599` — column exists, no grant restriction anywhere in tracked SQL | Project owner (needs live DB credentials this session must not request) | Run the `REVOKE` statement in Deliverable 4; rotate every key the column has ever held | Query `information_schema.role_column_grants` for `ai_providers.api_key` after the `REVOKE`; confirm `anon`/`authenticated` no longer appear | Zero non-privileged roles hold `SELECT` on the column, **and** a dated rotation record exists for every previously-stored key |
| **C.2C** — no ratified gate-closure definition exists anywhere in the repo | BLOCKED | `KERNEL_ARCHITECTURE.md` §20 is the only text defining it, is self-labeled `DESIGN — NOT FROZEN`, and bundles excluded architecture work | Project owner / Architecture Council | Ratify Deliverable 3 below and commit it as an actual Gate C record | A committed, non-"DESIGN" file exists stating precisely what C.2C requires, with an explicit sign-off line | The ratified record is committed to `main` and its stated criteria are independently met |
| **Knowledge Vault tenancy** — 5 tables have no `organization_id`; RLS is `USING (true)`; routes bypass RLS via pooled connection regardless | OPEN | `supabase_schema.sql:1960-2034`; `server.ts` vault routes use `getPool()` | Architecture Council | Choose Option A/B/C (Deliverable 2) and authorize the resulting migration as its own scoped sprint | Council decision recorded in a committed doc | Decision recorded **and** implemented **and** runtime-verified (a cross-tenant or cross-role read attempt is denied, per the constitution's evidence table) |
| **Live login verification (C.1J)** — no evidence any real user has ever completed login | OPEN | `PROJECT_CONTINUITY_REPORT.md` Step 0.5 — `KERNEL_ARCHITECTURE.md` says zero successful logins observed; `MASTER_CONTEXT/CHANGELOG.md` claims a recovery on 2026-07-03; the two contradict and neither is re-verifiable from source alone | Project owner (must perform the login personally; this session must not) | One live `signInWithPassword`/OTP attempt against the current build, in an incognito window | Owner reports the observed outcome — success and the resulting session, or the exact error code/message | A concrete, dated result exists, replacing "unknown" with either "confirmed working" or "confirmed broken: `<error>`" |

**Not gate-blocking, recorded for completeness (per the earlier reports' own scope
calls):**

| Item | Status | Why it doesn't block Gate C |
|---|---|---|
| Vault client code sends no `Authorization` header (6 files) | Known-broken since commit `aea842e`, pre-dates Gate C entirely | Feature-restoration, not a security gate; also moot until the tenancy decision above lands — no live user is affected (zero production deployments) |
| Supabase Site URL / Redirect URL point at an ephemeral Cloud Run origin | Open, last checked 2026-08-03, current state unknown | Affects password-reset UX only; `GATE_C_REMEDIATION_REPORT.md` explicitly scoped this out of RG-C |

---

## Deliverable 2 — Knowledge Vault Tenancy Recommendation

**Audited tables:** `vault_documents`, `rd_library`, `timeline_milestones`, `phases`,
`decision_records` — these are the five tables that actually exist
(`supabase_schema.sql:1960-2024`). No `vault_chunks`, `vault_embeddings`, `vault_tags`,
or `vault_relationships` tables exist anywhere in the schema; a prior version of this
task's instructions named those, and this report corrects the record rather than
inventing rows to match.

All five: no `organization_id` column; RLS enabled with `USING (true)` (public read,
no write policy at all); queried exclusively through `server.ts` handlers using a
pooled `DATABASE_URL` connection, which bypasses RLS regardless of policy. Seed data
and AI-prompt text reference a product called **"ICECRAFT,"** not Bell24h-OS or
VyaparSethu, and the schema's own comments describe deliberate **"Single Founder
Mode / No Auth"** design intent.

| | Option A — Retrofit multi-tenant | Option B — Admin-only, single-tenant | Option C — Quarantine/remove |
|---|---|---|---|
| **Benefits** | Fits a general platform-module shape if the Vault is ever meant to be tenant-facing | Matches the feature's actual, evidenced design intent; preserves the founder-tooling data (decision log, R&D notes, timeline) with least new risk | Eliminates the RLS-bypass surface entirely; smallest ongoing security liability |
| **Risks** | **Backfill risk is the real danger**: existing rows have no owner; assigning them to "the first organization" silently hands one tenant another's data. Also a false-isolation trap — new org-scoped policies are decorative unless the routes *also* stop using the pooled connection (separate architecture work) | Requires building a server-side authorization primitive that does not exist today (`hasPermission`/`checkRole`/`authorize` → 0 hits repo-wide) — smaller than Option A's scope, but not zero | Loses working functionality (founder timeline, decision log) with no replacement; needs a data-export step first or the loss is irreversible |
| **Migration complexity** | High — 5× `ALTER TABLE ADD COLUMN`, 5× FK, rewrite 5 RLS policies, add missing write policies, rewrite 8 SQL statements in `server.ts`, **and** migrate those routes off `getPool()` for the isolation to be real | Medium-low — no schema change; add one admin-role gate ahead of the existing `requireAuth`; the "build the primitive" line item is the only nontrivial part | Low for the platform (delete/disable routes and UI) — cost is entirely in the lost feature, not engineering effort |
| **Security impact** | Best end-state *if* done completely (schema + RLS + off-pool); worst partial state if the pool migration is skipped — looks fixed, isn't | Closes the anonymous/unauthenticated-any-user exposure (already partly done via `requireAuth`); residual risk is any-authenticated-user access until the admin-role primitive lands | Fully closes the exposure — nothing left to secure because nothing is reachable |
| **Governance impact** | Requires the Council to also greenlight the pool-migration architecture work as a dependency — scope creep risk into PS-02 territory | Self-contained; does not require resolving the Layer 0-6 / 9-stage / Kernel contradiction first | Requires an explicit decision to discard or externalize founder content — a product decision, not just a technical one |

### Recommendation: **Option B — keep single-tenant, admin-only**

The evidence points here specifically because the feature's own schema comments state
its design intent (`"Single Founder Mode"`), its seed content is unrelated to
Bell24h-OS's multi-tenant product (ICECRAFT), and Option A's backfill problem has no
clean answer — there is no principled way to assign existing founder-authored rows to
a tenant without guessing. Option C is the most defensible on pure security grounds but
destroys real content (the decision log and timeline exist to record exactly the kind
of governance history this closure package itself is an instance of) without first
confirming that content has value nowhere else.

This is a recommendation, not a decision — per governance, the Council/project owner
makes the final call, and Option B still requires them to authorize building the
missing authorization primitive as its own scoped follow-up.

---

## Deliverable 3 — C.2C Ratification Proposal

**Problem:** `MASTER_CONTEXT/KERNEL_ARCHITECTURE.md` §20 is the only document anywhere
that defines C.2C, and it cannot serve as the gate record because (a) its own header
declares `DESIGN — NOT FROZEN`, (b) it was written as one prior session's architecture
proposal, not a ratified governance artifact, and (c) it bundles C.2C's closure
criteria with "migrate 9 pool handlers off RLS bypass," which every prior report
(`GATE_C_REMEDIATION_REPORT.md`, `NEXT_SPRINT_RECOMMENDATION.md`) has independently
classified as architecture work, explicitly out of a security-remediation gate's scope.

**Proposal:**

1. **Which document becomes the ratified baseline:** neither adopt
   `KERNEL_ARCHITECTURE.md` §20 whole, nor write a new document from scratch. Extract
   only the already-agreed, already-scoped portion of its C.2C text — "apply
   `requireAuth` + org scope to all 8 open routes" — which is also independently
   corroborated by `GATE_C_REMEDIATION_REPORT.md` Item 2 (already closed) and
   `PROJECT_CONTINUITY_REPORT.md` Step 1. A new, small, standalone file —
   `docs/project/REVIEW_GATE_C_RECORD.md` — should be created to hold this, rather than
   promoting the untracked design doc's status.

2. **Changes required relative to the KERNEL_ARCHITECTURE.md text:**
   - Remove "migrate 9 pool handlers off RLS bypass" from C.2C's closure criteria —
     re-file it as its own architecture-track item (it already appears, correctly
     scoped, in `IMPLEMENTATION_STATUS.md` and the Vault tenancy memo above).
   - State explicitly that C.2C's *route-gating* half is **already closed** (8/8, with
     the before/after curl evidence in `GATE_C_REMEDIATION_REPORT.md`), so ratification
     is confirming a done fact, not opening new work.
   - Add the one piece C.2C never had: an explicit **closure criterion for C.2B's DB
     layer** (the `REVOKE` + rotation), since the two are tracked together in every
     report but only one half has ever had a written definition.

3. **Governance approval needed:** a named sign-off from the project owner (the
   "Architecture Council" is referenced throughout the prior reports but is not defined
   anywhere in this repository as a distinct body — as far as the tracked record shows,
   the project owner *is* the ratifying authority). The new record should carry a
   date and an explicit statement such as "Ratified by [owner], [date]" — its absence is
   precisely what left C.2C unclosable for the last five weeks.

**This proposal is not itself a ratification.** Per the stop condition, no such record
was created or committed by this session — only the proposal for what it should say.

---

## Deliverable 4 — Database Security Verification Package

**Not executed. Generated only**, per instruction and per the standing rule in this
project that live SQL against Supabase is run by the project owner in the SQL Editor,
never automated from this session.

### 4a. Verify current exposure (run first, before anything else)

```sql
-- Who can currently SELECT the api_key column directly?
SELECT grantee, privilege_type
FROM information_schema.role_column_grants
WHERE table_schema = 'public'
  AND table_name   = 'ai_providers'
  AND column_name  = 'api_key';

-- Sanity check: does any view expose it transitively?
SELECT table_name, view_definition
FROM information_schema.views
WHERE view_definition ILIKE '%api_key%';

-- Confirm there is no RLS policy silently already restricting reads
-- (a policy is not a substitute for a column-level REVOKE, but worth knowing)
SELECT policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'ai_providers';
```

### 4b. REVOKE (the actual fix — run only after reviewing 4a's output)

```sql
-- Column-level revoke: anon/authenticated can still SELECT the row,
-- just not this specific column.
REVOKE SELECT (api_key) ON public.ai_providers FROM anon;
REVOKE SELECT (api_key) ON public.ai_providers FROM authenticated;

-- If server-side access to api_key should go through service_role only
-- (matches server/ai/ProviderManager.ts, which already reads from
-- process.env, not this table, so this is a defense-in-depth step):
-- REVOKE SELECT (api_key) ON public.ai_providers FROM PUBLIC;
```

### 4c. Verify the REVOKE took effect

```sql
-- Re-run 4a's first query — anon/authenticated should no longer appear
-- for column_name = 'api_key'. Only service_role/postgres should remain.
SELECT grantee, privilege_type
FROM information_schema.role_column_grants
WHERE table_schema = 'public'
  AND table_name   = 'ai_providers'
  AND column_name  = 'api_key';
```

### 4d. Key rotation checklist (manual — no SQL rotates a third-party key)

- [ ] Enumerate every row ever present in `ai_providers.api_key` (requires either a
      backup/point-in-time snapshot, or an admin `SELECT` run once by the owner in the
      SQL Editor — not this session).
- [ ] For each distinct provider (Gemini, OpenAI, Anthropic, NVIDIA, etc.) referenced by
      `provider_id`, generate a new API key at that provider's dashboard.
- [ ] Update the corresponding value **in the environment the server actually reads
      from** (`server/ai/ProviderManager.ts` resolves credentials from `process.env`,
      confirmed by source read — so the fix belongs in Vercel/host env vars, not this
      table, once the app is deployed there).
- [ ] Revoke/delete the old key at the provider's dashboard so it stops working even if
      a copy leaked.
- [ ] Record the rotation date per provider (e.g., in `OUTSTANDING_INVESTIGATIONS.md`)
      so "no evidence of rotation" stops being true.
- [ ] Re-run 4a to confirm the table itself no longer needs to hold a live secret at
      all, if the long-term design is env-var-only credential resolution.

---

## Deliverable 5 — Authentication Verification Checklist

Audited: `server/middleware/requireAuth.ts`, `src/hooks/useAuth.ts`,
`src/store/useAuthStore.ts`. **No live login was attempted — this session must not
enter credentials.** Everything below is a checklist for the project owner to execute
and report results against; source-level observations are marked as such, not as
verified runtime behavior.

| Property | Source-level observation | What the owner must do to verify | Prerequisite missing? |
|---|---|---|---|
| **Login works** | `useAuth.ts:19` calls `supabase.auth.getSession()`; `onAuthStateChange` listener (`useAuth.ts:44`) drives the store on real sign-in events. No fabricated pass path exists outside `AUTH_BYPASS`, which is confirmed absent from production builds. | Perform one real `signInWithPassword` or OTP login against the current build, in an incognito window, and report the exact outcome (success + landing page, or the exact error). | **Yes — live credential + owner action.** This is the C.1J item already tracked as OPEN. |
| **Logout works** | `useAuthStore.ts:47-54` — real logout path calls `set({ user: null, isAuthenticated: false, isLoading: false })`; the `AUTH_BYPASS` branch explicitly disables logout ("Logout disabled in development mode") but only when the dev-only bypass is active. | After a successful login, click logout and confirm the session actually clears (both client state and that a subsequent protected call is rejected). | Same as above — needs a completed login first. |
| **Session persistence** | `useAuth.ts:19` restores from `supabase.auth.getSession()` on mount, which reads Supabase's own persisted session (localStorage, by Supabase client default) — this is standard SDK behavior, not custom code, so no separate persistence bug is visible from source. | Log in, refresh the page (or reopen the tab), confirm the user is still authenticated without re-entering credentials. | Needs a completed login first. |
| **Organization context works** | **Gap found this session, not in prior reports:** the client-side `User` type (`useAuthStore.ts:3-8`) has no organization field at all — `id`, `email`, `name`, `role` only. Organization context is resolved *exclusively* server-side, inside `requireAuth`, from the caller's own Supabase-authenticated profile lookup (per that file's header comment). There is no client-visible "current organization" state to check independently of a server call. | Verify server-side only: an authenticated call to an org-scoped endpoint returns data scoped to the caller's own `organization_id`, and a second account in a different organization gets a different (non-overlapping) result set. This is a genuine two-account test, not something one login can confirm alone. | **Yes — needs two distinct organizations' credentials**, which this session neither has nor should request. |

**Do not fabricate results for any row above.** Where the owner cannot complete an
item (e.g., only one test account exists), the correct entry is "not verified —
missing second-organization test account," not an inferred pass.

---

## Deliverable 6 — Final Gate C Readiness Assessment

**Gate Decision: BLOCKED**

Per the constitution's own rule: "PASS requires every criterion to be a genuine,
evidenced pass. One unverified item means BLOCKED — not 'conditional pass.'" Four items
remain open, none of them closable by further code inspection:

1. C.2B database layer — needs the project owner to run Deliverable 4's `REVOKE` and
   rotate keys.
2. C.2C — needs the project owner/Council to ratify Deliverable 3 and commit it.
3. Knowledge Vault tenancy — needs the Council to pick Option A/B/C from Deliverable 2
   (Option B recommended) and authorize the follow-on work as its own sprint.
4. Live login verification — needs the project owner to perform one login and report
   the result.

None of these are "more investigation" items — the facts needed to act are already
in this package. They are two human decisions and one piece of owner-executed
verification, not further audit work.

**No sprint was started.** No queue, worker, runtime, Communication Hub, or Industry
Intelligence work was touched, per the stop condition. Sprint B.5 remains correctly
blocked until this gate produces a PASS.

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012ZFnfse6FQkg3HHFk566rZ
