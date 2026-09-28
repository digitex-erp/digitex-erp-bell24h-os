# Supabase RV-001 Readiness Report

**Date:** 2026-09-28. Read-only. No code modified. No live database connection was made or attempted — per the standing Bell24h-OS Runtime Verification policy, this session never requests, reads, or handles `DATABASE_URL`, Postgres passwords, service-role keys, or any DB connection string, and never drives the Supabase SQL Editor via browser automation, regardless of whether those values happen to be present locally. Every live-state item below is a generated query awaiting the founder's pasted result, not an executed check.

## What "RV-001" is

Per the existing Bell24h-OS Runtime Verification Standard (permanent workflow policy, 2026-08-04): every live-database check gets a permanent identifier (`RV-001`, `RV-002`, ...) and is closed only once pasted evidence is in hand, with one of `VERIFIED` / `PARTIAL` / `FAILED` / `UNKNOWN`. This report opens **RV-001 through RV-006** (below) — none can be closed in this pass because no live query has been run yet.

## Repository-side findings (direct file evidence — no DB access needed)

| Check | Evidence | Status |
|---|---|---|
| Supabase env vars present | `.env` contains `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY` (names only — values not read) | **Present locally.** Live reachability unverified — see RV-001. |
| `SUPABASE_SERVICE_KEY` | Not present in `.env`, only listed as a name in `.env.example` | **Absent.** Any server-side operation requiring the service role key will fail until this is set. |
| Schema-as-code exists | `supabase_schema.sql` (2,120 lines, checked into repo) defines `organizations`, `profiles`, `buyers`, `suppliers`, `rfqs`, `rfq_items`, `quotations`, RLS policies, and an `on_auth_user_created` trigger (line 516) firing `handle_new_user()` on `auth.users` insert | This is the **intended** schema, not proof of the **deployed** schema. |
| No migration tracking | No `migrations/` directory exists; schema changes live as 27 loose `add_*.sql` files (`add_ai_tables.sql` … `add_communication_hub.sql`) applied ad hoc, with no tracked "which ones actually ran against production" record in the repo | **Real risk**: schema-as-code and schema-as-deployed can silently drift. This is exactly what RV-002 below tests for. |

## Live-database checks (BLOCKED pending pasted evidence)

### RV-001 — Supabase connection reachable
**Objective:** confirm the Supabase Postgres instance named by `SUPABASE_URL` is reachable and accepting authenticated queries.
**SQL Query:**
```sql
select now() as server_time, current_database(), current_user;
```
**Expected Result:** one row with the current server timestamp, database name, and connected role.
**Interpretation:** a returned row = connection is live. An error (auth failure, timeout, DNS) = connection is broken; capture the exact error text, don't attempt a second query until that's resolved.
**Next Step:** run in the Supabase SQL Editor, paste the result (or exact error) back. **Status: UNKNOWN — awaiting evidence.**

### RV-002 — Schema drift check (deployed vs. checked-in)
**Objective:** confirm `organizations`, `profiles`, `buyers`, `suppliers`, `rfqs`, `rfq_items`, `quotations`, `communication_providers`, `communication_messages` all exist in the live database, matching `supabase_schema.sql` / `add_communication_hub.sql`.
**SQL Query:**
```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'organizations','profiles','buyers','suppliers','rfqs','rfq_items',
    'quotations','communication_providers','communication_messages'
  )
order by table_name;
```
**Expected Result:** all 9 table names returned.
**Interpretation:** fewer than 9 rows = specific tables are missing live (name the gap exactly once evidence returns) — this would mean either the checked-in SQL was never applied, or it was applied to a different database than the app currently points at. All 9 present = schema is at least structurally deployed (does not yet confirm columns/RLS match).
**Next Step:** paste the returned rows. **Status: UNKNOWN — awaiting evidence.**

### RV-003 — RLS enabled on core + Communication Hub tables
**Objective:** confirm Row Level Security is actually enabled (not just that policies exist in source) on the tables Phase 1's certification report flagged as source-verified-only.
**SQL Query:**
```sql
select relname, relrowsecurity, relforcerowsecurity
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in (
    'organizations','profiles','buyers','suppliers','rfqs',
    'communication_providers','communication_messages','communication_deliveries'
  )
order by relname;
```
**Expected Result:** `relrowsecurity = true` for every row.
**Interpretation:** any `false` means RLS is **not** enforced on that table regardless of what policies exist in source — a live tenant-isolation gap. This is the single most important result in this report given the constitution's evidence table treats "a policy exists in the schema" as insufficient on its own.
**Next Step:** paste the returned rows. **Status: UNKNOWN — awaiting evidence.**

### RV-004 — Organizations seeded
**Objective:** confirm at least one organization exists (needed for every other RV check and for Phase 2's buyer/supplier accounts, which are FK'd to `organizations.id`).
**SQL Query:**
```sql
select id, name, created_at from public.organizations order by created_at asc limit 10;
```
**Expected Result:** at least one row. The implementation report referenced `activate_vyaparsethu_root_org.sql`, suggesting a root org was intended to be seeded — this query confirms whether that happened.
**Interpretation:** zero rows = nothing downstream (buyers, suppliers, RFQs, C4 accounts) can exist yet; this alone would make Phase 2's C4 readiness **BLOCKED**, not just partial.
**Next Step:** paste the returned rows (organization names/ids are fine to share; nothing sensitive). **Status: UNKNOWN — awaiting evidence.**

### RV-005 — Profiles + auth trigger firing correctly
**Objective:** confirm `public.profiles` rows are actually created via the `on_auth_user_created` trigger when a user signs up (not just that the trigger is defined in source).
**SQL Query:**
```sql
select count(*) as auth_users, (select count(*) from public.profiles) as profiles
from auth.users;
```
**Expected Result:** the two counts should be equal (every auth user has exactly one profile row).
**Interpretation:** `profiles < auth_users` means the trigger isn't firing for some existing users (either it was added after those users signed up, or it's broken) — new signups should still be checked separately if this mismatches. Equal counts is good evidence the trigger works for the current user base, though not a guarantee for the next signup.
**Next Step:** paste both counts. **Status: UNKNOWN — awaiting evidence.**

### RV-006 — Environment variables reach the client correctly (build-time check)
**Objective:** per the constitution's evidence table ("env var reaches the client" requires checking the built bundle, not the dashboard), confirm what's actually compiled into `dist/assets/*.js`.
**Method:** repository-side, no DB needed — grepped the build produced in Phase 1 directly.
**Result:**
- `grep -c "SUPABASE_SERVICE_KEY\|DATABASE_URL" dist/assets/*.js` → **1 matching line**, but every occurrence on inspection is a plain-text UI/diagnostic string (`"Check if DATABASE_URL is reachable..."`, `<code>DATABASE_URL</code>` in help text) — **not** a secret value. The literal name appears; no value does.
- That UI text belongs to a client-side "system diagnostics" panel that calls `/api/env/diagnostic` and reads a `variables.DATABASE_URL.value` field. Checked the matching server route (`server.ts:262-291`, `devOnly("env-diagnostic")`): it only ever returns `{loaded, length, suffix}` (last 8 characters) per key — it never sends a `.value` field. The client code's `.value` read is against a shape the server doesn't produce, so this is dead/vestigial client code, not a live leak. The route itself is also hard-disabled in production (`devOnly` returns a bare 404 and audit-logs the blocked attempt when `NODE_ENV === "production"`, `server.ts:57-72`) — confirmed by reading that guard directly, not inferred.
- **`VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` values ARE compiled into the client bundle as literal strings** (confirmed by direct grep — the anon-key JWT and the project URL both appear inlined in `dist/assets/*.js`). This is Vite's designed behavior for `VITE_`-prefixed vars and matches Supabase's public-anon-key model — **not** itself a defect. Its safety is entirely contingent on RLS actually being enforced on every table the anon key can reach, which is exactly RV-003 above and is currently **unverified**. Flagging the dependency explicitly rather than letting it be assumed safe.
**Status: PASS** on the two checks that don't need a live DB (no server-only secret *value* in the bundle; the diagnostic route is prod-disabled). **Contingent** on RV-003 for the anon-key exposure to be safe in practice.

## Overall status

**BLOCKED.** Nothing in RV-001 through RV-005 can be marked READY, PARTIAL, or FAILED — all require pasted evidence that doesn't exist yet. RV-006 is the only item with real evidence (PARTIAL — the negative check passed, the positive check wasn't run). Per the constitution: this is a legitimate "cannot verify" outcome, not a fabricated pass or fail. The five SQL queries above are ready to run in the Supabase SQL Editor whenever the founder is available; each is a single, isolated check per the workflow policy.

**Recommended order:** RV-001 (connection) → RV-004 (orgs seeded) → RV-002 (schema drift) → RV-003 (RLS) → RV-005 (auth trigger). If RV-001 fails, stop — nothing else can be meaningfully interpreted until the connection itself is confirmed live.
