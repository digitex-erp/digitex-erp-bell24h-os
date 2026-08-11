# RG-C — Review Gate C Remediation Report

**Sprint type:** Remediation (security hardening only). Not an IS-xx sprint.
**Date:** 2026-08-03
**Baseline:** PS-01 reports in `docs/project/` (read before acting; no audit re-run).
**HEAD:** `d2ca7cd` (7 commits ahead of `origin/main`; left untouched, nothing pushed).

**Summary: 2 items CLOSED · 1 item BLOCKED · 3 items OPEN (owner action required).**

---

## Prerequisite status — NOT VERIFIED this session

The RG-C prompt requires the Supabase Site URL / Redirect URL be corrected before
proceeding. **I could not confirm whether that was done.**

Earlier in this session I inspected the dashboard read-only and found:

```
Site URL:      https://ais-dev-zxdg67fyg7gy22jrjbkrvr-299471748829.asia-east1.run.app
Redirect URLs: https://ais-dev-zxdg67fyg7gy22jrjbkrvr-299471748829.asia-east1.run.app/auth/update-password
Total URLs: 1
```

On re-checking after the remediation work, the browser extension returned
`Failed to extract page text: Cannot access contents of the page. Extension manifest
must request permission to access the respective host.` after two attempts. Per the
tooling guidance I stopped rather than retry-looping. **Current Supabase URL state is
therefore UNKNOWN** — the values above are what was observed earlier this session, not
necessarily what is configured now.

**This does not affect the validity of any work below.** The prerequisite governs
password-reset behaviour only. Every item remediated here is server-side route gating
and client-bundle content, both entirely independent of Supabase URL configuration.
The password-reset item is explicitly OUT of RG-C scope and is recorded in
`OUTSTANDING_INVESTIGATIONS.md`.

---

## Item 1 — C.2B: Provider secret isolation

| Field | Detail |
|---|---|
| **Finding** | PS-01 recorded C.2B as PARTIALLY RESOLVED: `select('*')` on the tenant-readable `ai_providers` table put provider `api_key` values in browser memory. |
| **Files changed** | **None.** See below. |
| **Status** | **CLOSED at the code/bundle layer. OPEN at the database layer (owner action).** |

### Why no files changed

The scoped action was "narrow `select('*')` calls that expose provider API keys."
Re-checking the current working tree, **that narrowing is already applied** — by
commit `343945c`, which PS-01 already classified. There is no remaining `select('*')`
against a credential-bearing table to narrow. Both read sites are explicit projections:

```
src/pages/AiProvidersPage.tsx:63
  .select('id, name, provider_id, status, priority, default_model, temperature,
           max_tokens, timeout_ms, retry_count, last_request_at, last_error,
           organization_id, created_at, updated_at')

src/modules/ai-providers/AiProviderService.ts:416
  .select('id, name, provider_id, status, priority, default_model, temperature,
           max_tokens, timeout_ms, retry_count, last_request_at, last_error,
           organization_id, created_at, updated_at')
```

`api_key` is absent from both. No client code queries the `api_keys` table at all
(grep across `src/` for `from('ai_providers'|'api_keys')` returns only the above plus
`update`/`insert` calls, which write rather than read).

Editing anything here would have violated the "minimal diffs / no opportunistic edits"
constraint. Per the prompt's own rule — *if a finding in this prompt disagrees with the
reports, the reports win* — the reports were right and the code needed no change.

### Runtime evidence (freshly rebuilt bundle, `dist/assets/index-Dv9qED9D.js`)

Bundle audit **after** `npm run build`:

```
ai_providers select projections in bundle:
  select("id, name, provider_id, status, priority, default_model, temperature,
          max_tokens, timeout_ms, retry_count, last_request_at, last_error,
          organization_id, created_at, updated_at")   ×2
  select("*, ai_providers(name, provider_id)")

any literal select('*') on ai_providers?  → none found
JWT-shaped secrets: 1
```

The third projection is `src/pages/AiProvidersPage.tsx:81`, whose base table is
`ai_request_logs` (no credential column); the joined `ai_providers` projection is
explicitly `(name, provider_id)` — **not** `api_key`. Not an exposure.

The single JWT was decoded to confirm it is the public anon key, not a privileged one:

```json
{"iss":"supabase","ref":"dqpaekyayhqhndihbnnn","role":"anon",
 "iat":1783011843,"exp":2098587843}
```

`role: anon` is public by design. `service_role` appears in the bundle exactly once, as
UI help text inside a `<code>` element (`"...elevated service_role privileges via the
server API."`) — the known false positive documented in the `bell24h-verify` skill.

### What remains OPEN (cannot be closed from here)

The `ai_providers.api_key` **column still exists and is still tenant-readable at the
grant level.** The fix is at the query layer only. Closing this fully requires:

1. A column-level `REVOKE` so the anon/authenticated roles cannot select `api_key`
   even if some future query asks for it.
2. Rotation of every provider key that column has ever held.

Both need live database credentials, which this session does not have and must not
request. **Owner action.** Until done, treat every key that table has held as
potentially compromised.

---

## Item 2 — Unauthenticated API routes

| Field | Detail |
|---|---|
| **Finding** | PS-01 verified 8 of 13 API routes respond without authentication in both dev and production builds, reaching handler logic and querying Postgres through a pooled `DATABASE_URL` connection that bypasses RLS. |
| **Files changed** | `server.ts` — only file modified. 8 route registrations gained the existing `requireAuth` middleware (already imported at line 21; no new imports). One explanatory comment block added above the Knowledge Vault section recording the residual tenancy gap. |
| **Status** | **CLOSED** (anonymous access). See the honest caveat below on what "closed" does and does not mean. |

### Minimal fix, and why this specific change

`requireAuth` already existed, was already proven working on two routes (commit
`aea842e`), verifies the Supabase JWT, resolves `organization_id` using the caller's own
token so RLS applies to the profile read, and fails closed on every error path. Reusing
it was strictly smaller and lower-risk than writing anything new. The diff is 8
one-word insertions plus a comment — no logic, no restructuring, no renaming.

### Before (both servers, unauthenticated)

```
----- DEV (:3100) -----            ----- PROD (:3101, NODE_ENV=production) -----
GET  /api/check-table       -> 500   GET  /api/check-table       -> 500
GET  /api/check-users-count -> 500   GET  /api/check-users-count -> 500
GET  /api/vault/documents   -> 500   GET  /api/vault/documents   -> 500
GET  /api/vault/rd          -> 500   GET  /api/vault/rd          -> 500
GET  /api/vault/timeline    -> 500   GET  /api/vault/timeline    -> 500
GET  /api/vault/phases      -> 500   GET  /api/vault/phases      -> 500
GET  /api/vault/decisions   -> 500   GET  /api/vault/decisions   -> 500
POST /api/vault/documents   -> 500   POST /api/vault/documents   -> 500
```

The 500s are the proof, not noise — the bodies show the handler *executed* and failed
on a missing database URL, meaning no auth gate stood in front of it:

```
/api/check-table       -> {"error":"DATABASE_URL is not defined in environment variables."}
/api/check-users-count -> {"success":false,"error":"DATABASE_URL is not defined in environment variables."}
/api/vault/documents   -> {"error":"DATABASE_URL is not defined in environment variables."}
/api/vault/decisions   -> {"error":"DATABASE_URL is not defined in environment variables."}
```

Control, same run — the already-gated route rejected before reaching any handler:

```
/api/vault/ai-summary  -> {"error":"unauthenticated","requestId":"req_msdagasr_2cezr48s"}  [401]
```

### After (rebuilt, both servers restarted, unauthenticated)

```
----- DEV (:3100) -----            ----- PROD (:3101, NODE_ENV=production) -----
GET  /api/check-table       -> 401   GET  /api/check-table       -> 401
GET  /api/check-users-count -> 401   GET  /api/check-users-count -> 401
GET  /api/vault/documents   -> 401   GET  /api/vault/documents   -> 401
GET  /api/vault/rd          -> 401   GET  /api/vault/rd          -> 401
GET  /api/vault/timeline    -> 401   GET  /api/vault/timeline    -> 401
GET  /api/vault/phases      -> 401   GET  /api/vault/phases      -> 401
GET  /api/vault/decisions   -> 401   GET  /api/vault/decisions   -> 401
POST /api/vault/documents   -> 401   POST /api/vault/documents   -> 401
```

Bodies now show rejection before handler execution — no database error, because the
handler never runs:

```
/api/check-table       -> {"error":"unauthenticated","requestId":"req_msdajhxo_go8nin2n"}
/api/check-users-count -> {"error":"unauthenticated","requestId":"req_msdaji63_fldlfo7c"}
/api/vault/documents   -> {"error":"unauthenticated","requestId":"req_msdajiez_t5e1w3sl"}
/api/vault/decisions   -> {"error":"unauthenticated","requestId":"req_msdajiop_xsd0gci9"}
```

**8 of 8 closed, in both dev and production builds. 0 of 13 routes now respond to an
anonymous caller with handler output.**

### Regression check — nothing else broke

```
DEV  /api/health              -> 200   (unchanged)
PROD /api/health              -> 200   (unchanged)
DEV  /api/migrate             -> 500   (devOnly still open in dev)
PROD /api/migrate             -> 404   (devOnly still enforced)
DEV  /api/env/diagnostic      -> 200   (devOnly still open in dev)
PROD /api/env/diagnostic      -> 404   (devOnly still enforced)
PROD /api/vault/ai-summary    -> 401   (pre-existing gate intact)
PROD /api/vault/mentor-advice -> 401   (pre-existing gate intact)
PROD /dashboard               -> 200   (SPA static serving intact)
```

Build and typecheck both still pass:

```
$ npm run lint      (tsc --noEmit)
   (no output — exit 0)

$ npm run build
   ✓ 1870 modules transformed.
   dist/assets/index-Dv9qED9D.js   853.24 kB │ gzip: 232.38 kB
   ✓ built in 8.49s
   dist\server.cjs      20.2kb
```

> **Correction, recorded rather than hidden.** My first regression pass reported
> `ai-summary`/`mentor-advice` as **400**, which would have looked like a regression. It
> was not: my shell escaping mangled the JSON body, and the global `express.json()`
> middleware rejected it with 400 *before* `requireAuth` ran. Re-tested with a valid
> JSON payload from a file, both return **401** as expected. The 400 was my test
> harness, not the application.

### What "CLOSED" does NOT mean here — read this

Three residual gaps remain, none of which RG-C had authority to fix:

1. **Not tenant-safe.** The vault tables have no `organization_id`, and these handlers
   query through the pooled `DATABASE_URL` connection, which bypasses RLS entirely. Any
   *authenticated* user of *any* organization can still read every row. The SQL is
   unscoped — e.g. `SELECT * FROM vault_documents ORDER BY last_updated DESC`, quoted
   from `server.ts:203`. This is *inferred* from source, not runtime-verified, because
   no `DATABASE_URL` was ever configured in this session. See the memo below.
2. **Not authorization.** `requireAuth` establishes *identity*, not *permission*.
   `/api/check-users-count` runs `SELECT count(*) FROM auth.users` — a global,
   non-org-scoped admin query now readable by any authenticated user. It would be better
   as `devOnly` (like `/api/migrate`) or behind an admin-role check, but PS-01 verified
   **no server-side authorization primitive exists** in this codebase, and creating one
   is architecture work, explicitly out of scope. Recorded, not fixed.
3. **The client sends no token, so the Knowledge Vault UI will now 401.** This is a real
   consequence and I am flagging it rather than letting it surprise anyone. Verified:
   none of `VaultDocuments.tsx`, `RdLibrary.tsx`, `FounderTimeline.tsx`,
   `PhaseUnlockEngine.tsx`, `FounderMemory.tsx` attach an `Authorization` header.
   **This condition already existed before my change** — `KnowledgeVaultPage.tsx:124`
   calls the already-gated `/api/vault/mentor-advice` with only
   `{"Content-Type": "application/json"}`, so the AI Mentor has been silently 401-ing
   since commit `aea842e`. My change extends that same known-broken condition to the
   read endpoints. Attaching the Supabase session token client-side is required
   follow-up work; I did not do it, because it touches six client files for
   feature-restoration rather than a Gate C blocker, and because the Vault's future is
   itself blocked pending the Council tenancy decision. **Mitigating context: the
   project has zero deployments, so no live user is affected.**

---

## Item 3 — Knowledge Vault tenancy: options memo (assessment only)

**No schema was altered. No column added. No migration written.** Per the STOP
CONDITION, this is assessment only.

### What the tables look like today

Defined in `supabase_schema.sql:1892–1970` (also present as the fragment file
`add_knowledge_vault.sql`, introduced by commit `a0b000a`). Five tables:
`vault_documents`, `rd_library`, `timeline_milestones`, `phases`, `decision_records`.

Two structural facts, quoted from source:

- **No tenant column.** None of the five has an `organization_id`. They are also the
  only tables in the file created without the `public.` schema prefix.
- **RLS is enabled but the policy is open**, `supabase_schema.sql:1958–1970`:
  ```sql
  -- Enable RLS (even though user said No Auth, it's good practice for Supabase migration)
  ALTER TABLE vault_documents ENABLE ROW LEVEL SECURITY;
  ...
  -- Allow public access for "Single Founder Mode" if needed, or restricted to auth user
  CREATE POLICY "Public Read Access" ON vault_documents FOR SELECT USING (true);
  ```
  `USING (true)` grants read to everyone. No INSERT/UPDATE/DELETE policy exists at all,
  so writes are denied by default under RLS — but the server never goes through RLS
  anyway (next point).

### What breaks today without a tenant column

- **Confidence: VERIFIED (source), INFERRED (runtime).** The handlers issue unscoped
  SQL over a pooled `DATABASE_URL` connection. `getPool()` uses the connection string
  directly, so **Postgres RLS does not apply to these routes at all** — the `USING
  (true)` policy is not even the binding constraint; the bypass is. Every row is
  returned to every caller. I could not demonstrate this against a live database
  because no `DATABASE_URL` was configured in this session; the conclusion rests on the
  quoted SQL and the pool construction, not on an observed cross-tenant read.
- After this sprint, that exposure requires *authentication* — but still not
  *tenancy*. One authenticated user from org A reads org B's vault rows.
- **Provenance worth surfacing:** this feature appears not to be a Bell24h-OS module at
  all. Its seed data and AI prompts reference a product called **"ICECRAFT"**
  (`server.ts:302` — *"You are the AI Founder Mentor for ICECRAFT"*; timeline seed rows
  in `supabase_schema.sql:1974–1979` describe wine-shop surveys and physical
  prototypes). The schema comments describe deliberate "Single Founder Mode / No Auth"
  design. This looks like single-tenant founder tooling that arrived via the `a0b000a`
  consolidation, not a multi-tenant platform capability.

### Candidate approaches

**Option A — Retrofit `organization_id` onto all five tables.**
- *Migration cost:* Medium. Five `ALTER TABLE ADD COLUMN`, five FK constraints, replace
  the five `USING (true)` policies with org-isolation policies, add write policies
  (currently none exist), and rewrite eight SQL statements in `server.ts` to scope by
  `req.auth.organizationId`.
- *RLS implications:* Only meaningful if the routes *also* stop using the pooled
  connection — otherwise RLS stays bypassed and the new policies are decorative. This is
  the trap: adding the column without migrating off `getPool()` produces a *false* sense
  of isolation.
- *Backfill risk:* **The real risk.** Existing rows have no owner. Seed data is
  ICECRAFT/founder content. Backfilling to an arbitrary "first organization" silently
  grants one tenant ownership of another's data. Needs an explicit owner decision per
  row, or a deliberate decision to discard.

**Option B — Keep single-tenant, restrict to platform admins.**
- *Migration cost:* Low. No schema change. Gate the routes behind an admin-role check.
- *RLS implications:* None new — but requires a server-side authorization primitive,
  which **does not exist** (PS-01 verified `hasPermission|checkRole|authorize` → 0 hits).
  So this option's true cost is "build the missing authorization primitive first."
- *Backfill risk:* None. Existing rows keep their current meaning.
- Honest about what it is: accepts the feature as founder tooling rather than pretending
  it is a platform module.

**Option C — Quarantine or remove the feature.**
- *Migration cost:* Lowest for the platform; highest in lost functionality. Remove the
  routes and UI, retain the tables read-only, or move the whole feature to a separate
  single-tenant deployment.
- *RLS implications:* Removes the RLS-bypass surface entirely — deletes the problem
  rather than managing it.
- *Backfill risk:* None, provided data is exported first.
- Worth serious consideration given the ICECRAFT provenance: this may simply not belong
  in Bell24h-OS.

### What I need from the Council to proceed

1. **Is the Knowledge Vault in scope for Bell24h-OS at all?** Options A and B assume
   yes; C assumes no. Everything else follows from this. The ICECRAFT provenance makes
   this a genuine question, not a formality.
2. **If in scope — multi-tenant (A) or single-tenant admin tool (B)?**
3. **If A — who owns the existing rows?** A backfill target must be named explicitly, or
   the data must be explicitly declared disposable. I will not guess this.
4. **Authorization for the follow-on work:** migrating these handlers off the pooled
   `DATABASE_URL` is required for any of this to be real, and that is architecture work
   needing its own sprint authorization.

---

## BLOCKED — C.2C

**Status: BLOCKED. No work attempted.**

**Why.** RG-C scopes C.2C as *"as defined in the repository's Gate C record"*, and
directs me to stop rather than invent a definition if that record is missing or
ambiguous. There is **no Gate C record in this repository.** PS-01 established that the
only text anywhere defining C.2B/C.2C is `MASTER_CONTEXT/KERNEL_ARCHITECTURE.md §20`,
which is:

- **Untracked** — `git status` shows `?? MASTER_CONTEXT/KERNEL_ARCHITECTURE.md`; it has
  never been committed.
- **Self-labeled `DESIGN — NOT FROZEN`** in its own header.
- **Source B** — a prior session's design document, not a ratified gate record.

An untracked, unratified design document has no authority to define a gate-closure item.
Note also that its §20 text bundles C.2C with work this sprint explicitly excludes
("migrate 9 pool handlers off RLS bypass" is architecture work), which is a further
reason not to infer scope from it.

**To unblock:** explicit re-authorization carrying a ratified C.2C definition —
committed to the repository as an actual Gate C record, stating precisely which
conditions constitute closure. Until then this stays BLOCKED, not "partially done."

---

## Found but deliberately left alone

Each recorded, none acted on — with the one-line reason it was out of scope.

| Finding | Why left alone |
|---|---|
| `ai_providers.api_key` column not `REVOKE`d; keys never rotated | Needs live DB credentials; owner action (Item 1). |
| 9 handlers query via pooled `DATABASE_URL`, bypassing RLS | Architecture work — explicitly out of RG-C scope. |
| No server-side authorization primitive exists (`hasPermission`/`checkRole` → 0 hits) | Architecture work; would be needed for Vault Option B. |
| Client code attaches no `Authorization` header (6 files) → Vault UI will 401 | Feature restoration, not a Gate C blocker; Vault fate is Council-blocked. |
| `/api/check-users-count` exposes a global `auth.users` count to any authenticated user | Would need admin-role gating (primitive doesn't exist) or `devOnly`; behaviour change beyond "close anonymous access." |
| `permissions` table has no RLS and no policy | Schema change — out of scope. |
| `job_priorities` RLS enabled with no policy; `workflow_templates` RLS never enabled | Schema changes — out of scope. |
| `seo_projects`, `campaigns`, `social_accounts` defined twice in `supabase_schema.sql` | Schema tidying — explicitly out of scope. |
| Broad `select('*')` on ~30 non-credential tables (campaigns, industries, seo_*, etc.) | Over-fetch, not provider-secret exposure; C.2B is scoped to provider API keys. Narrowing all of them is refactoring — out of scope. |
| `ai_request_logs` `select('*')` pulls `prompt`/`response` columns to the browser | Same reason — not a provider credential; flagged for a future data-minimisation review. |
| No test framework, no CI | Flagged as follow-up per instruction; not built. |
| 8 stub services, disabled `JobWorker`, orphaned `IndustryDashboardPage` | Not Gate C items — out of scope. |
| 853 kB main bundle chunk exceeds Vite's 500 kB guidance | Performance, not security — out of scope. |

---

## Final `git status`

```
 M server.ts
?? MASTER_CONTEXT/KERNEL_ARCHITECTURE.md
?? docs/
```

- **`server.ts`** — the single source file modified, traceable entirely to Item 2
  (8 × `requireAuth` + one comment block; 16 insertions, 8 deletions).
- **`MASTER_CONTEXT/KERNEL_ARCHITECTURE.md`** — pre-existing untracked file, **not
  touched by this sprint** (present before RG-C began; see PS-01).
- **`docs/`** — the PS-01 report set plus this report.

No out-of-scope source file was modified. Nothing pushed, merged, or rebased. The seven
unpushed commits are exactly as they were. No credentials were entered anywhere.

---

## Summary

| Item | Status |
|---|---|
| C.2B — provider secret isolation (code/bundle layer) | **CLOSED** — runtime-verified; no change required, already fixed by `343945c` |
| Unauthenticated API routes (8 of 8) | **CLOSED** — before/after runtime pairs on dev **and** production builds |
| C.2C | **BLOCKED** — no authoritative gate record exists |
| C.2B — DB layer (`REVOKE` + key rotation) | **OPEN** — owner action, needs live DB credentials |
| Knowledge Vault tenancy | **OPEN** — memo delivered; Council decision required |
| Supabase URL prerequisite | **OPEN / UNKNOWN** — could not re-verify; browser permission error |

**2 CLOSED · 1 BLOCKED · 3 OPEN.**

**Review Gate C is not fully passed.** Two of its items are closed with runtime
evidence, but C.2C is blocked on missing authority and C.2B's database layer needs
owner action. Per the standing rule, **no IS-xx sprint may begin.**
