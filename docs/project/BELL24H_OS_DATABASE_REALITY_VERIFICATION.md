# BELL24H_OS DATABASE REALITY VERIFICATION

**Repository:** `digitex-erp/digitex-erp-bell24h-os`
**Phase:** Database Reality Verification (Phase 8C) — **audit only, no code modified, no
SQL modified, no migration created, nothing deployed**
**Date:** 2026-09-14

**Claim under review:** *"Database is empty because `public.users` does not exist."*

**Evidence discipline for this document:** two different kinds of claim are being
evaluated here, and they are kept separate throughout. (1) "Is `public.users` part of this
application's schema/code?" — answerable with certainty from repository source, verified
by grep this turn, zero live DB access needed. (2) "Is the live database actually empty?"
— **not answerable by this session**; no live database was queried, and this document does
not claim to know the current row counts in the real Supabase instance. Section C exists
specifically because that second question requires the Owner to run real SQL and report
real results — this document refutes the *reasoning*, not the database's actual current
contents, which remain genuinely unknown here.

---

## A. Database Reality Report

### A.1 — Does Bell24h-OS use `public.users`, `auth.users`, `public.profiles`, `public.organizations`?

Grepped this turn across every `.sql`, `.ts`, `.tsx`, `.js` file in the repository for
`public.users`, `FROM users`, `.from('users')`, and case-insensitive variants:

| Table | Used by this application? | Evidence |
|---|---|---|
| `public.users` | **No — zero references anywhere in the repository.** | Grep across `supabase_schema.sql`, `server/`, `src/`, and every other `.sql`/`.ts`/`.tsx`/`.js` file: 0 matches. |
| `auth.users` | **Yes** — Supabase's own built-in auth table. | `supabase_schema.sql:36` (`profiles.id ... REFERENCES auth.users(id)`), `:516-518` (`on_auth_user_created AFTER INSERT ON auth.users`), `server.ts:216` (`SELECT count(*) FROM auth.users;`) |
| `public.profiles` | **Yes** — this schema's actual "user record" table. | `supabase_schema.sql:35-47` (definition), used throughout `requireAuth.ts`, `currentOrganization.ts`, and 13 frontend files (35 call sites, per this session's prior audit) |
| `public.organizations` | **Yes** | `supabase_schema.sql:8-32` (definition), referenced by `get_current_org_id()`, `requireAuth.ts` indirectly (via `profiles.organization_id`), `SystemDiagnosticsPage.tsx`, `DashboardPage.tsx`, `OrganizationPage.tsx` |

### A.2 — Is `public.users` expected to exist?

**No.** This schema deliberately does not use a `public.users` table. Supabase's
convention — followed exactly here — is: `auth.users` (managed by Supabase Auth, not
defined in this repository's schema file at all) holds authentication identity, and
`public.profiles` (defined at `supabase_schema.sql:35-47`, `id` referencing `auth.users.id`
with `ON DELETE CASCADE`) holds the application-level profile/organization-membership
record. A table named `public.users` was never part of this design at any point evidenced
in this repository — not in `supabase_schema.sql`, not in any of the other `.sql` files in
the repo root, not in any application code.

### A.3 — Does absence of `public.users` prove the database is empty?

**No — this does not follow, for two independent reasons:**

1. **A table that was never supposed to exist cannot be evidence about the tables that
   do.** `public.users` not existing is expected, correct schema state, not an anomaly. It
   says nothing about whether `public.profiles`, `public.organizations`, or `auth.users`
   have rows.
2. **Even granting the (incorrect) premise that `users` was the right table to check, `42P01`
   ("relation does not exist") is a categorically different error from an empty result
   set.** `42P01` means the query referenced a name Postgres has no matching object for —
   it fires before any row-counting logic runs. It cannot be interpreted as "0 rows," only
   as "wrong name." An empty table would instead return `count = 0` successfully, not raise
   an error at all.

**The stated conclusion does not follow from the evidence that produced it.** See §E for
the formal verdict.

---

## B. Table Dependency Map

```
auth.users                              [Supabase-managed, not in supabase_schema.sql]
   │  referenced by (FK, ON DELETE CASCADE)
   ▼
public.profiles  ◄────────────────────────────────────────┐
   │  organization_id FK                                   │
   ▼                                                        │
public.organizations                                        │
                                                              │
public.get_current_org_id()  [SECURITY DEFINER]              │
   └─ internally: SELECT organization_id FROM public.profiles│
      WHERE id = auth.uid()  ─────────────────────────────────┘
   used by:
     - 30-table "Org isolation" policy loop (roles, companies, rfqs, orders, ...)
     - (after the approved remediation) profiles' and organizations' own SELECT policies

server/middleware/requireAuth.ts
   ├─ POST auth/v1/user            → Supabase Auth API (resolves against auth.users)
   └─ GET rest/v1/profiles?...     → PostgREST, queries public.profiles directly
                                       (NOT via get_current_org_id() — a distinct call path)

public.users  →  DOES NOT EXIST IN THIS SCHEMA. No code path, migration, or policy in
                  this repository references it. Referenced nowhere in B above.
```

**`get_current_org_id()` references:** `public.profiles` only (line 50-60).
**RLS policies (`profiles`, `organizations`, and the 30-table loop) reference:**
`public.profiles`, `public.organizations`, and `public.get_current_org_id()` — never
`public.users`.
**`requireAuth.ts` references:** Supabase's `auth/v1/user` endpoint and
`rest/v1/profiles` — never `public.users`.

---

## C. Verification SQL Package

For the Owner to run in the Supabase SQL Editor to determine the database's **actual**
current state (this session has not run any of these; none of their results are known
here):

```sql
-- 1. Confirm profiles and organizations exist as real tables
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('profiles', 'organizations');

-- 2. Confirm get_current_org_id() exists and inspect its current definition
SELECT proname, pg_get_functiondef(oid) AS definition
FROM pg_proc
WHERE proname = 'get_current_org_id' AND pronamespace = 'public'::regnamespace;

-- 3. Confirm the profiles/organizations SELECT policies exist and show their current text
SELECT polrelid::regclass AS table_name, polname, pg_get_expr(polqual, polrelid) AS using_expr
FROM pg_policy
WHERE polrelid IN ('public.profiles'::regclass, 'public.organizations'::regclass)
ORDER BY polrelid, polname;

-- 4. Actual row counts — the only way to know if the database is really empty
SELECT 'profiles' AS table_name, count(*) FROM public.profiles
UNION ALL
SELECT 'organizations', count(*) FROM public.organizations;

-- 5. auth.users row count (the real, Supabase-managed identity table)
SELECT count(*) FROM auth.users;

-- 6. Explicitly confirm public.users' absence, without triggering 42P01
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'users'
) AS public_users_exists;  -- expected: false

-- 7. Full inventory of what actually exists in the public schema
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' ORDER BY table_name;
```

Query 6 is the important contrast with whatever produced the original error: it asks the
same underlying question ("is there a `users` table?") in a way that returns a boolean
instead of raising `42P01` — demonstrating that the prior error was a consequence of *how*
the check was made (a direct `SELECT ... FROM public.users`, which errors on a missing
relation), not evidence about the database's actual contents.

---

## D. Root Cause Analysis of the `public.users` error

**Exact SQL text that produced `ERROR 42P01: relation "public.users" does not exist`:**
**not knowable from this session** — no query text, screenshot, or log excerpt from the
"previous execution attempt" was supplied in this conversation. This document does not
guess at the literal string; §7 below states precisely what can and cannot be determined
without it.

**What can be determined by elimination, with high confidence, from repository evidence:**

- It did not originate from `supabase_schema.sql` — that file never creates, references,
  or queries a table named `users`.
- It did not originate from `server.ts`, `requireAuth.ts`, or any other server-side file —
  grepped this turn, zero references to `public.users` anywhere in `server/`.
- It did not originate from any client-side file in `src/` — same grep, zero references.
- It did not originate from any of this session's own proposed or approved SQL (the
  `OWNER_EXECUTION_PACKAGE.md` remediation statements, or the verification queries in §C
  above) — none reference a `users` table.

**Most probable origin, stated as an inference, not a fact:** a manually-typed, ad-hoc
query run directly against the database (SQL Editor or an external client) using a
commonly-assumed table name (`users`) that does not match this schema's actual,
Supabase-standard convention (`auth.users` + `public.profiles`). This is a plausible,
common mistake — many frameworks do use a bare `users` table — but it is an inference
about intent, not a confirmed fact, since the actual query text is not available.

---

## E. Was the SQL part of approved remediation, an unrelated experiment, or an incorrect execution attempt?

**Not part of the approved remediation — confirmed with certainty.** Every version of the
approved RLS fix produced this session (`BELL24H_OS_RLS_REMEDIATION_CERTIFICATION_AND_EXECUTION_PLAN.md`,
`OWNER_EXECUTION_PACKAGE.md`) contains exactly two `DROP POLICY`/`CREATE POLICY` statement
pairs, touching only `public.profiles` and `public.organizations` — neither statement
references, queries, or could raise an error about `public.users` in any way. Running the
approved package exactly as written cannot produce this error.

**Between "unrelated experiment" and "incorrect execution attempt":** the evidence
narrows this to "incorrect execution attempt" as the more likely of the two — a
`SELECT`/inspection query against a table name that guesses wrong about this schema's
convention reads as an attempt to check something real (are there users?) using the wrong
name, not as a deliberate, unrelated test. But this session cannot rule out "unrelated
experiment" with certainty, since who ran the query and why is not evidenced here either.
**Stated as the honest limit of what this document can certify: the error is confirmed
unrelated to the approved remediation; its precise intent (accidental wrong name vs.
deliberate unrelated check) is not fully determinable without the original query text or
the person who ran it.**

---

## F. Is the "database is empty" conclusion valid?

**No.** The reasoning chain — `public.users` doesn't exist → therefore the database is
empty — fails at its first step (§A.3): `public.users` was never expected to exist in this
schema, so its absence is normal, correct state, not an anomaly requiring explanation, and
even if it were an anomaly, "relation does not exist" is not equivalent to "table exists
with zero rows." Whether the database is *actually* empty (§C's Query 4/5) remains a
genuinely open, separate question this document does not claim to answer — but it is not
established, and cannot be established, by the evidence cited for it.

---

## Final Verdict

# INVALID CONCLUSION

The claim "database is empty because `public.users` does not exist" does not follow from
its own premise, independent of whatever the database's real contents turn out to be. The
correct verification path is §C's query package, run against `public.profiles`,
`public.organizations`, and `auth.users` — the tables this schema actually defines — not a
table this application has never used.

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GyjerP42mTVzzK2ZkSeRCf
