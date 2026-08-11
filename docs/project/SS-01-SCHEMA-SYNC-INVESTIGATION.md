# SS-01 — Schema Sync Investigation

**Sprint type:** Read-only reconnaissance. No architecture decision, no remediation.
**Date:** 2026-08-04
**Trigger:** Live database inspection (performed by the project owner, reported to this
session) found the `public` schema contains exactly one table — `organizations`. None of
the tables the application code queries (`ai_providers`, `vault_documents`, `rd_library`,
`timeline_milestones`, `phases`, `decision_records`, or any user/profile table) exist.

**Confirmed at the end of this document: no SQL was executed, no schema sync was run, and
no file was modified during this investigation.**

---

## Step 1 — The Schema File

### Location and size

`supabase_schema.sql`, repository root. **2025 lines.** Last modified by commit `a0b000a`
("consolidate application code from digitex-erp-bell24h-os2"), 2026-07-28 07:21:47 +0530.
Full prior history:

```
a0b000a 2026-07-28 07:21:47  feat: consolidate application code from digitex-erp-bell24h-os2
29d6b25 2026-07-03 21:14:42  feat: add system diagnostics and expand Supabase config
314c518 2026-07-03 19:42:32  feat: add Publishing Center module
548cdba 2026-07-03 19:36:01  feat: implement SEO, Campaign, and Media modules
f636ed1 2026-07-03 17:08:08  feat: implement context engine and management UI
4998871 2026-07-03 16:49:18  feat: implement creative studios and job orchestrator
26a3044 2026-07-03 13:49:32  feat: implement AI provider management system
2e2486b 2026-07-03 07:23:54  feat: implement team management module
f81800a 2026-07-03 07:16:37  feat: implement organization support and auth flow
```

**Not currently modified** — `git status --porcelain supabase_schema.sql` returns nothing.
This investigation changed no line of it.

Nineteen additional `add_*.sql` fragment files exist at the repository root
(`add_ai_tables.sql`, `add_knowledge_vault.sql`, `add_seo_intelligence.sql`, etc.). A spot
check (`add_knowledge_vault.sql` against `supabase_schema.sql:1880-2025`) confirms the
consolidated file's Knowledge Vault section is a verbatim copy of the fragment — this
matches PS-01's earlier finding that the schema file was assembled by concatenating
per-feature fragments, harmlessly, via `CREATE TABLE IF NOT EXISTS`.

### Structural summary

**124 unique table names**, 111 `CREATE TABLE` statements (three names —
`seo_projects`, `campaigns`, `social_accounts` — are declared twice, a pre-existing,
already-documented duplication; harmless under `IF NOT EXISTS`).

### Does it define what the application expects?

**Yes — every table the application queries is present in this file:**

| Table | Line |
|---|---|
| `ai_providers` | 566 |
| `vault_documents` | 1892 |
| `rd_library` | 1904 |
| `timeline_milestones` | 1923 |
| `phases` | 1934 |
| `decision_records` | 1945 |
| `organizations` | 8 |
| `profiles` (the application's user table — `auth.users` itself is Supabase-managed and not defined here, correctly) | 35 |

**The schema file is not the problem.** It is complete, current, and matches what
`MASTER_DATA_OWNERSHIP.md` and `MASTER_MODULES.md` describe. The discrepancy is entirely
between this file and the live database's actual state.

---

## Step 2 — The Sync Mechanism

### Two independent code paths execute this same file — traced, not run

**Path A — the UI button.** `src/pages/SystemDiagnosticsPage.tsx`:
```
36:  const runMigration = async () => {
...
40:    const resp = await fetch('/api/migrate');
...
507:    onClick={runMigration}
516:    Synchronize Schema
```
A single `fetch('/api/migrate')`, no body, method defaults to `GET`.

**Server side**, `server.ts:147-195` — read this session, not executed:
```ts
/**
 * Executes the entire schema file — including the RLS-generation DO block —
 * against the database. Step 1 intent check (Sprint C.2A) found no production
 * caller: the only consumer is the /system/diagnostics page, and `run_migration.cjs`
 * already provides a standalone migration path. Disabled outside development.
 *
 * Retained as GET only because it is now unreachable in production; if this route
 * is ever re-enabled for production use it must become a POST behind requireAuth
 * plus an admin-role check, since a schema-mutating GET is CSRF-triggerable.
 */
app.get("/api/migrate", devOnly("migrate"), async (req, res) => {
  ...
  const sql = fs.readFileSync(schemaPath, 'utf8');
  const client = await dbPool.connect();
  await client.query("BEGIN;");
  await client.query(sql);
  await client.query("COMMIT;");
  ...
```

**This comment is itself a finding.** It documents that a prior sprint — referred to in the
comment as "Sprint C.2A" — deliberately gated this route behind `devOnly()` specifically
because it was found to have no legitimate production caller. `devOnly()` (`server.ts:40-57`)
returns a bare `404` when `NODE_ENV=production`, before the handler body ever runs.
**This is not a bug. It was an intentional security decision**, later implemented in commit
`cfa6cea` (one of the seven unpushed commits RG-C classified as "belongs, and verified
working"). RG-C independently confirmed the 404 at runtime: `curl` against a production build
returned `404` for `/api/migrate`, and `500` (reaching the handler) in dev.

**Path B — the standalone script.** `run_migration.cjs`, repository root, **unmodified since
the very first feature commit** (`f81800a`, 2026-07-03 07:16:37 — the oldest possible date
any file in this repo could carry). It reads `DATABASE_URL` from the environment, connects
via `pg`, reads `supabase_schema.sql`, and executes it as one `client.query(sql)` call — no
explicit transaction wrapper of its own, but Postgres's simple-query protocol treats a
semicolon-separated multi-statement string sent in one message as an implicit all-or-nothing
transaction, so a mid-file failure here would also roll back everything after the last
external checkpoint.

**This session did not run either path.** Both were located and read only.

### The "Unexpected token 'T', "The page c"..." symptom

A `JSON.parse` (or `fetch(...).json()`) failure with that exact error means the client
received a response whose body starts with the literal characters `The page c` — i.e., HTML
or plain text, not JSON. `/api/migrate`'s own handler always returns `res.json(...)` on every
code path (success or the caught-error branch), so **if that handler runs, this error cannot
happen.** The response is coming from something other than this Express route.

**The most evidenced explanation is a hosting mismatch, not an application bug.**
`vite.config.ts:19-30`:
```ts
server: {
  proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true } },
  // HMR is disabled in AI Studio via DISABLE_HMR env var.
  // Do not modify—file watching is disabled to prevent flickering during agent edits.
  hmr: process.env.DISABLE_HMR !== 'true',
```
The comment names **AI Studio** as the thing controlling this dev-server's runtime
behavior directly — strong evidence that AI Studio's preview environment (the same
`ais-dev-...run.app` Cloud Run origin found configured as the Supabase Site URL in an
earlier session) serves this app by running **Vite's own dev server**, not the combined
Express application (`npm run dev` / `tsx server.ts`, or the built `node dist/server.cjs`).
This is documented as a known trap in this repo's own `bell24h-verify` skill: *"`/api/*` on
a bare Vite server proxies to port 3000... every `/api` call returns [something that isn't
the real API]."* If nothing is listening on `:3000` in that preview container, `/api/migrate`
never reaches `server.ts` at all — it hits whatever answers on the proxy's behalf instead,
which is consistent with an HTML/plain-text error page rather than a JSON response.

**What I did not do:** make a live request to that URL to confirm the exact response text.
That is explicitly out of scope for a read-only investigation and was not necessary to reach
a well-evidenced conclusion. **Recommendation, not a finding:** the owner can safely confirm
this with a single `curl -i` against that origin's `/api/health` and `/api/migrate` — safe
specifically *because* the hypothesis is that the route is unreachable; if unreachable, a GET
request reproduces the same harmless 404/proxy-error every time and cannot trigger a sync
that was never reaching the handler in the first place. If the hypothesis is wrong and the
route *is* reachable there, the same GET would actually invoke the migration — which is
exactly why this session did not attempt it.

---

## Step 3 — Reconciling Against RG-C and PS-02

### C.2B — does the closure make sense given the live table inventory?

**No, and it needs to be said plainly: `ai_providers` does not exist in the live database.**

`GATE_C_REMEDIATION_REPORT.md` closed C.2B's code layer on the basis that
`AiProviderService.getProviders()` and `AiProvidersPage.tsx` no longer `select('*')` against
`ai_providers`, and that the shipped bundle contains no live secret (verified by decoding the
one bundled JWT as `role: anon`). **That code-level finding remains true and remains the
correct fix to have made** — a query that excludes a sensitive column is correct practice
regardless of whether the table currently exists, and matters immediately the moment the
table *does* exist (dev, or any future synced environment).

**What needs correcting is the risk characterization, not the fix.** `GATE_C_REMEDIATION_REPORT.md`
states *"The `ai_providers.api_key` column still exists and is still tenant-readable at the
database grant level"* — that sentence was written from reading `supabase_schema.sql`, the
file, not from a live database check (RG-C's own runtime tests never configured a
`DATABASE_URL`, so every "before" 500 response it captured was `"DATABASE_URL is not defined
in environment variables"` — proving the *routes* were unauthenticated, but never actually
reaching a real table one way or the other). Given this new finding, **the column may not
currently exist to be read from at all.** The specific exposure RG-C described — a browser
query pulling live `api_key` values out of a real table — was very likely never reachable in
this database's current state. It is not possible to say it was *never* reachable at any
point in the past (the table could have existed briefly and been dropped since); only that it
is not reachable now.

### The 8 routes RG-C gated — which tables do they actually touch?

| Route | Table/schema queried | Exists live? |
|---|---|---|
| `GET /api/check-table` | `information_schema.tables` filtered to `table_name='organizations'` | **Yes** — `organizations` is the one table present |
| `GET /api/check-users-count` | `auth.users` (Supabase-managed system schema, not `public`) | **Very likely yes** — `auth.users` is core Supabase infrastructure provisioned with every project, independent of whether the application's `public` schema was ever migrated. **INFERRED**, not directly queried this session |
| `GET /api/vault/documents` | `vault_documents` | **No** |
| `POST /api/vault/documents` | `vault_documents` | **No** |
| `GET /api/vault/rd` | `rd_library` | **No** |
| `GET /api/vault/timeline` | `timeline_milestones` | **No** |
| `GET /api/vault/phases` | `phases` | **No** |
| `GET /api/vault/decisions` | `decision_records` | **No** |

**6 of the 8 gated routes point at tables that do not exist. Only 2 point at objects that do.**
This does not make RG-C's `requireAuth` gating pointless — defense-in-depth is still correct,
and every one of these tables is expected to exist once schema sync actually runs, at which
point the gating becomes immediately load-bearing. But RG-C's own "before" evidence (uniformly
`DATABASE_URL is not defined`) never actually distinguished "auth is the only thing standing
between an anonymous caller and real data" from "there is no real data behind this route
regardless of auth, because the table isn't there." Both are true today; only the first was
stated.

### `MASTER_DATA_OWNERSHIP.md` — discrepancies against the live inventory

**The scale of the discrepancy is total, not partial:** of 124 tables the document describes,
**123 do not exist live.** Every row in every layer's ownership table beyond `organizations`
itself describes a table that is schema-file-only.

This is not a case of the document overclaiming, however — its own opening disclaimer,
written before this finding existed, already carried the necessary hedge:

> *"States the intended model and records where reality differs. **No schema was inspected
> live, altered, or migrated.** RLS claims are read from `supabase_schema.sql` (the file),
> **not** the live database — that distinction is carried on every row."*

That caveat turns out to have been exactly the right one, and this finding is the concrete
reason it mattered — not a case of the document being wrong, but of the gap it warned about
being far larger than "policy not yet verified against a populated table." The gap is "table
not yet created." The `INFERRED` confidence labels throughout that document remain
technically accurate; what changes is how far "not yet verified" actually reaches. `ADR-002`'s
call for a cross-tenant isolation test, and `ADR-008`'s framing of the same, should both be
read now as: **that test cannot even be attempted against most of this schema today**, because
there is no tenant data anywhere to test isolation *of*. This is a prerequisite finding for
those ADRs, not a contradiction of them.

---

## Step 4 — Origin

**This session cannot determine the exact cause with certainty** — that would require
querying Supabase's own migration/point-in-time history, which is explicitly out of scope
(no SQL, read-only). What follows is reasoning from available evidence, labeled as such.

### Was this database ever fully migrated?

**No affirmative claim of a successful migration exists anywhere in the repository.**
Searched: `MASTER_CONTEXT/CHANGELOG.md` (9 entries, all dated 2026-07-03, none mentioning
schema/migration success — the closest is *"Production Authentication Recovery (Diagnostics,
Supabase Client Refactor, Env Robustness)"*, which is about the auth *client*, not the
database schema); `REPOSITORY_HEALTH_REPORT.md` (2026-07-25) states RLS patterns are *"present
in `supabase_schema.sql`"* — carefully phrased as file-based, never asserting live state;
`GOVERNANCE_READINESS_REPORT.md`, `ARCHITECTURE_COMPLIANCE_REPORT.md`, and
`TECHNICAL_DEBT_REPORT.md` (all same commit batch) raise concerns about wiring and placeholders
but do not mention table existence either way.

**A structural observation worth recording:** neither known execution path
(`/api/migrate`'s explicit `BEGIN`/`COMMIT`/`ROLLBACK`, or `run_migration.cjs`'s single
multi-statement query under Postgres's implicit-transaction simple-query protocol) would
naturally leave *exactly one* table — `organizations`, the very first `CREATE TABLE` in the
file — sitting alone while everything after it is absent. A mid-file failure through either
path should roll back to zero new tables, not one. This suggests `organizations` most likely
arrived through some path other than a full run of this schema file: a manual creation via
Supabase's table editor, an earlier and different version of the schema, or a partial/manual
setup step predating the consolidated file. **This is inference, not a verified finding** —
resolving it with confidence would need Supabase's own history for this project, which this
session did not and should not access.

### A separate staging/dev Supabase project?

**None found.** Searched all tracked `.md`/`.ts`/`.tsx`/`.json` files for any
`*.supabase.co` reference other than the one confirmed live project
(`dqpaekyayhqhndihbnnn`). The only other occurrences are:
- `.claude/settings.local.json:28` — a Bash permission-allowlist rule using obviously fake
  placeholder values (`sentinelviteurl11111.supabase.co`, keys literally named
  `SENTINEL_VITE_SUPABASE_KEY`). Tooling configuration, not a real project reference.
- `placeholder.supabase.co` in `src/lib/supabase.ts` and the `bell24h-verify` skill — the
  documented, intentional fallback constant used when no real URL is configured, not a second
  project.

`.env.example` lists `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_KEY`, `DATABASE_URL`
all blank, with no project ref anywhere. Its `APP_URL` comment — *"AI Studio automatically
injects this at runtime with the Cloud Run service URL"* — independently corroborates the
AI-Studio/Cloud-Run hosting picture from Step 2, from a completely different file.

**There is one Supabase project in this repository's evidence, and it is the one already
connected: `dqpaekyayhqhndihbnnn`.**

---

## What needs to happen next — recommendation, not an action taken

1. **Confirm the hosting-mismatch hypothesis (Step 2) before anything else.** If AI Studio's
   preview environment is genuinely running bare Vite rather than the Express server, that is
   a deployment configuration problem, separate from and prerequisite to any schema question —
   fixing the schema will not fix `/api/*` being unreachable, and vice versa.
2. **Do not run `/api/migrate` or `run_migration.cjs` against the current production database
   without deciding, first, whether `organizations` (the one existing table, which may carry
   real data — this was not inspected) needs to be preserved, migrated, or is safe to be
   re-created alongside everything else.** `IF NOT EXISTS` will not touch it either way if it
   already matches; if its actual live shape differs at all from the file's definition, `IF NOT
   EXISTS` will silently skip it rather than reconcile the difference.
3. **Test against a non-production project first if one can be provisioned**, specifically
   because the origin of the current single-table state is unconfirmed (Step 4) — running an
   unfamiliar 2025-line script against the only live database, without knowing why it's in its
   current state, is exactly the kind of action that should not happen as a byproduct of
   investigating it.
4. **Re-scope RV-01, ADR-010, and ADR-011 once the schema is actually synced (or a decision is
   made not to sync it).** RV-01's cross-tenant test cannot proceed meaningfully against a
   database that has almost no tenant tables. ADR-010 (Vault tenancy) and ADR-011 (C.2C) both
   describe tables and RLS behavior that currently have nothing live to apply to.
5. **The decision to run the schema sync belongs to the project owner**, made with the
   `organizations`-table question above resolved first — not executed as a byproduct of this
   or any other investigation.

---

## Confirmation

- **No SQL was executed against any database** during this investigation. `supabase_schema.sql`
  and `run_migration.cjs` were read, not run.
- **No file in this repository was modified.** `git status --porcelain` before and after this
  investigation is unchanged for every file this document discusses.
- **No live HTTP request was made** to test the `/api/migrate` hosting hypothesis in Step 2;
  that hypothesis is reasoning from repository evidence, clearly labeled as such, with a
  specific safe verification step left to the owner.
- **No credentials were entered anywhere.**

---

# SS-02 — Pre-Sync Safety Check (organizations row protection)

**Sprint type:** Read-only verification. File-reading only — no SQL executed, no schema
sync run, no file modified.
**Depends on:** SS-01 (schema file location).
**Trigger:** A live query (run by the project owner, outside this session) confirmed
`public.organizations` contains one real row — **Digitex Studio**, created 2026-07-03,
never modified since. This section answers one question only: would running the schema
sync destroy that row?

## Step 1 — Every statement touching `organizations`, verbatim

Searched the entire 2025-line `supabase_schema.sql` (not just the region near the table
definition) for every mention of `organizations` — `CREATE`, `DROP`, `TRUNCATE`, `ALTER`,
`INSERT`, and any dynamic-SQL (`EXECUTE format(...)`) path that could reach it indirectly.
**Four statements touch the table or its policies. Zero touch its rows.**

**1. The table definition — `supabase_schema.sql:8-32`:**
```sql
-- 1. Organizations
CREATE TABLE IF NOT EXISTS public.organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    legal_name TEXT,
    ...
    deleted_at TIMESTAMPTZ
);
```
`IF NOT EXISTS` → **safe.** In Postgres this is a full no-op when a relation of that name
already exists in the schema — it does not inspect or reconcile columns, does not touch
existing rows, does not error. The file's own header (`:4-5`) states the intent directly:
*"Drop existing tables if necessary to avoid conflicts during testing — We will only create
tables IF NOT EXISTS for safety."* No table in this file is created without it.

**2–4. The RLS/policy block — `supabase_schema.sql:495-500`:**
```sql
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own organization" ON public.organizations;
CREATE POLICY "Users can view their own organization" ON public.organizations
FOR SELECT USING (
  id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
);
```
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` → **safe.** Idempotent in Postgres; re-enabling
  RLS that is already enabled is a no-op, not an error.
- `DROP POLICY IF EXISTS "..." ON public.organizations` → **safe with respect to data.**
  This drops an *access rule*, not the table or any row — dropping and recreating a policy
  has zero effect on stored data. `IF EXISTS` makes it error-free whether or not the policy
  was already there. (One transient effect worth naming precisely, since "safe" shouldn't
  read as "nothing happens": for the instant between the `DROP` and the following `CREATE`,
  inside the same transaction, a non-owner querying under RLS would see zero rows rather
  than being denied — but this is a policy-visibility window, not a data change, and it
  closes within the same transaction before `COMMIT`.)
- `CREATE POLICY ...` → **safe.** Recreates the same read rule.

**No `DROP TABLE`, no `TRUNCATE`, and no `INSERT INTO organizations` exist anywhere in the
file.** Confirmed by a whole-file scan, not a scan scoped to the `organizations` sections —
the file contains **zero** `DROP TABLE` or `TRUNCATE` statements against *any* table, and
its only `INSERT` statements target `public.profiles`, `storage.buckets` (×3),
`public.job_priorities`, and the five Knowledge Vault tables (`timeline_milestones`,
`phases`, `vault_documents`, `rd_library`, `decision_records`) — none of them
`organizations`. There is no seed data for `organizations` to conflict with the existing
`digitex-studio` row.

**`organizations` is also not swept up by any of the nine generic-loop `DO $$ ... FOREACH t
IN ARRAY tables ...` blocks** that programmatically `DROP POLICY`/`CREATE POLICY` on other
tables via `EXECUTE format(...)` (checked every `ARRAY[...]` in the file — the loop at
`:522-529` that is closest in position to the organizations block explicitly lists 30 other
table names and does not include `organizations`; it is handled only by its own
hand-written block above).

**One file mentions `organizations` and was deliberately excluded from this analysis for a
concrete reason, not an oversight:** `add_org_fields.sql` (repository root) contains
`ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS legal_name TEXT, ...` and seven
similar columns. **This file is never read by either sync mechanism** — both read only
`supabase_schema.sql` by that literal filename (confirmed in Step 2 below) — and in any
case every column it would add is already present in the `CREATE TABLE` statement itself
(`legal_name` at `:11`, `gst_number` at `:17`, `msme_number` at `:21`), so it is redundant
as well as unreachable. It cannot affect the verdict.

## Step 2 — Execution order

**Both sync paths execute the file as one verbatim string, top to bottom, with no
reordering, splitting, or filtering logic of any kind.** Read directly, not inferred:

**`server.ts:177-183`** (`/api/migrate`):
```ts
const sql = fs.readFileSync(schemaPath, 'utf8');
...
await client.query("BEGIN;");
await client.query(sql);
await client.query("COMMIT;");
```

**`run_migration.cjs:22-25`:**
```js
const sql = fs.readFileSync('supabase_schema.sql', 'utf8');
...
await client.query(sql);
```

In both, the entire file is read into one string and handed to a single `client.query()`
call. Neither contains a parser, a statement splitter, or any logic that could reorder,
skip, or filter individual statements — `node-postgres`'s simple-query protocol executes a
semicolon-separated multi-statement string in exactly the order it appears. **There is no
runner script in this codebase that reorders anything.** `server.ts` additionally wraps the
whole file in an explicit `BEGIN`/`COMMIT`, with `ROLLBACK` on any error (`:186`) —
`run_migration.cjs` has no explicit wrapper of its own, but Postgres's simple-query
protocol still treats a multi-statement batch sent in one message as an implicit
all-or-nothing unit.

Since Step 1 found no destructive statement anywhere in the file, **execution order is
moot for this specific question** — there is nothing for the `organizations` handling to
need protecting from, regardless of what runs before or after it.

## Step 3 — Verdict

**YES.** Every statement in `supabase_schema.sql` that touches `public.organizations` is
provably non-destructive: the table creation is `IF NOT EXISTS` (a no-op against an
existing table), the RLS enable is idempotent, and the only other operation is a
policy drop-and-recreate pair, which does not touch rows and is itself `IF EXISTS`-guarded.
The file contains no `DROP TABLE`, no `TRUNCATE`, and no seed `INSERT` for this table
anywhere in its 2025 lines, and both mechanisms that can execute it run the file verbatim
in its written order with no reordering logic that could introduce one. **Running the
schema sync, as this file and these two code paths are written today, would not delete or
overwrite the Digitex Studio row.**

This verdict is based on the file's content and the sync code's logic, both read in full —
not on a live execution, which this check was explicitly barred from performing. It says
nothing about the ~123 other tables the sync would newly create (that is SS-01's broader
subject, not this question), and nothing about whether some condition outside this file —
a live trigger, a constraint, or an extension not shown here — could behave unexpectedly.
None was found in the file, and this check had no live-database access with which to look
for one elsewhere.

**Running the sync remains the project owner's decision, to be made separately from this
verdict.**

