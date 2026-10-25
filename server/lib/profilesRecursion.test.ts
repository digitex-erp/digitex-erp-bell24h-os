/**
 * profiles/organizations RLS recursion regression test (2026-10-25).
 *
 * This reproduces a bug already fully diagnosed in a pre-existing, uncommitted
 * document in this repo -- docs/project/BELL24H_OS_PHASE13B_FINAL_RLS_EXECUTION_PACKAGE.md
 * (dated 2026-09-14, written against `main @ c18218d`) -- which this test confirms is
 * STILL PRESENT, unchanged, in the current branch (`feature/communication-hub @
 * ca8d1bb6d4...`, same line numbers: supabase_schema.sql:524-527 and 534-537).
 *
 * THE BUG: `profiles`' own SELECT policy contains a subquery that reads
 * `FROM public.profiles` -- the same table the policy is attached to. Evaluating
 * the policy therefore re-triggers the policy, which Postgres detects as
 * infinite recursion (error 42P17) for any RLS-respecting (non-owner) role.
 * `organizations`' SELECT policy independently depends on the same subquery,
 * so it is also affected even though it isn't self-referencing.
 *
 * WHY THIS WAS MISSED BY EVERY OTHER TEST IN THIS REPO: every other PGlite
 * fixture in this session's test files (policyGeneratorCoverage.test.ts,
 * tenantIsolation.rls.test.ts) deliberately builds a SIMPLIFIED `profiles`
 * table with NO RLS enabled on it at all -- reasonable for testing OTHER
 * tables' isolation, but it means none of those tests could ever have caught
 * a bug that lives specifically in profiles' OWN policy. This file is the
 * first to slice profiles'/organizations' REAL policy text from
 * supabase_schema.sql and exercise it under a genuinely restricted role.
 *
 * SCOPE NOTE on blast radius: get_current_org_id() ALSO does
 * `SELECT organization_id FROM public.profiles WHERE id = auth.uid()`
 * internally, but as a SECURITY DEFINER function, it only avoids this same
 * recursion if its owning role bypasses profiles' RLS (Phase13B's "Case 3").
 * This file does not re-verify that ownership condition (it requires live
 * database access to know the real owner, tracked separately in
 * BELL24H_OS_DATABASE_ROLE_RLS_VERIFICATION.md) -- it only proves that a
 * DIRECT, ordinary read of `profiles` or `organizations` by a restricted role
 * hits the recursion, independent of that question.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const SCHEMA_PATH = path.join(REPO_ROOT, "supabase_schema.sql");

function slice(startMarker: string, endMarker: string): string {
  const sql = fs.readFileSync(SCHEMA_PATH, "utf8");
  const start = sql.indexOf(startMarker);
  const end = sql.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    throw new Error(`Could not locate slice "${startMarker}" .. "${endMarker}" in supabase_schema.sql`);
  }
  return sql.slice(start, end);
}

let db: PGlite;
let realUserId: string;

before(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
      SELECT NULLIF(current_setting('app.current_uid', true), '')::uuid;
    $$ LANGUAGE sql STABLE;

    CREATE TABLE public.organizations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT
    );
    CREATE TABLE public.profiles (
      id UUID PRIMARY KEY,
      organization_id UUID REFERENCES public.organizations(id)
    );

    CREATE ROLE app_role NOLOGIN;
    GRANT USAGE ON SCHEMA public TO app_role;
    GRANT USAGE ON SCHEMA auth TO app_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO app_role;
    GRANT SELECT ON public.organizations, public.profiles TO app_role;
  `);

  // The exact, real policy text, sliced verbatim from supabase_schema.sql lines 522-543.
  const realPolicies = slice(
    "-- Enable RLS and create policies",
    "-- Generate policies for all org_id dependent tables",
  );
  await db.exec(realPolicies);

  const org = (await db.query<{ id: string }>(`INSERT INTO public.organizations (name) VALUES ('Acme') RETURNING id`)).rows[0].id;
  realUserId = (await db.query<{ id: string }>(`INSERT INTO public.profiles (id, organization_id) VALUES (gen_random_uuid(), $1) RETURNING id`, [org])).rows[0].id;
});

after(async () => {
  await db.close();
});

test("1: profiles' own SELECT policy is self-referential -- confirmed still present verbatim in the current schema (supabase_schema.sql:534-537)", async () => {
  const policyText = slice('CREATE POLICY "Users can view own profile or org members"', "DROP POLICY IF EXISTS \"Users can update own profile\"");
  assert.match(
    policyText,
    /FROM public\.profiles WHERE id = auth\.uid\(\)/,
    "the inline subquery against profiles' own table is still present -- if this assertion ever fails, the bug has been fixed upstream and this whole test file (and the cross-referenced Phase13B package) should be updated/retired, not silently left stale",
  );
});

test("2: a restricted role reading profiles directly hits infinite recursion (42P17), reproducing the documented production symptom", async () => {
  await db.exec(`SET ROLE app_role;`);
  await db.query(`SELECT set_config('app.current_uid', $1, false)`, [realUserId]);
  await assert.rejects(
    () => db.query(`SELECT id, organization_id FROM public.profiles WHERE id = auth.uid()`),
    /infinite recursion detected in policy for relation "profiles"/i,
    "this is the exact error text and exact query shape SystemDiagnosticsPage.tsx:127/134 hits in production per the Phase13B package -- reproduced here from the real schema text, not asserted from reading the SQL alone",
  );
  await db.exec(`RESET ROLE;`);
});

test("3: a restricted role reading organizations is also blocked, via the same dependency on profiles' broken policy", async () => {
  await db.exec(`SET ROLE app_role;`);
  await db.query(`SELECT set_config('app.current_uid', $1, false)`, [realUserId]);
  await assert.rejects(
    () => db.query(`SELECT id FROM public.organizations LIMIT 1`),
    /infinite recursion detected in policy for relation "profiles"/i,
    "organizations' own policy isn't self-referencing, but it depends on the same broken profiles subquery, so it fails with the identical underlying error -- confirms the Phase13B 'indirect exposure' classification by execution, not just by reading the dependency chain",
  );
  await db.exec(`RESET ROLE;`);
});

test("4: the owning/unrestricted connection is unaffected -- RLS was never in its path, so this bug is invisible to anything using the owner-bypass path", async () => {
  const rows = await db.query<{ id: string }>(`SELECT id FROM public.profiles WHERE id = $1`, [realUserId]);
  assert.equal(rows.rows.length, 1, "the owner connection reads profiles fine -- this is exactly why a pg.Pool connection that bypasses RLS (per the separate ownership investigation) would never surface this bug, even though it is live and broken for any RLS-respecting caller");
});
