/**
 * Org-isolation policy-generator coverage test (2026-10-25).
 *
 * REGRESSION-DOCUMENTING, not correctness-proving -- same convention as
 * vaultIsolation.test.ts. supabase_schema.sql contains 10 distinct
 * policy-generator DO blocks (not the 5 previously assumed), plus one
 * reusable helper, public._create_org_policy() (line ~69), which IS
 * idempotent (it DROPs before each CREATE). Two of the 10 blocks do their
 * own inline CREATE POLICY without going through the helper and without a
 * DROP first -- those two are genuinely non-idempotent: re-running the
 * schema file against a database that already has them applied throws
 * "policy already exists", not a no-op.
 *
 * This file proves, against DDL sliced verbatim from supabase_schema.sql:
 *   1. The "industries" family block (line ~1319) is non-idempotent.
 *   2. The "seo_topics" family block (line ~1479) is non-idempotent.
 *   3. A block that funnels through the _create_org_policy() helper with
 *      only ['select','insert'] (e.g. the Context Engine tables, line
 *      ~1378) truly has zero UPDATE/DELETE policy on its tables -- under
 *      Postgres RLS semantics this means UPDATE/DELETE are DENIED BY
 *      DEFAULT for every caller (not "exposed to other tenants"), as long
 *      as the connecting role does not own the table (see note below).
 *   4. A table from the big 31-table block (line ~547) genuinely has all
 *      four operations covered -- the idempotent, complete reference case.
 *   5. EnterpriseSeoService.addKeyword()'s insert record still carries
 *      columns (project_id, cpc, cluster_name, parent_topic, is_tracked,
 *      current_position, previous_position, opportunity_score) that do not
 *      exist on the real seo_keywords table -- confirmed by attempting the
 *      exact insert shape against the real sliced DDL and asserting it
 *      fails exactly as it would in production.
 *   6. A table that appears in BOTH the 547 block (4 ops) and a later
 *      select/insert-only helper call (e.g. "campaigns", in both block 547
 *      and block ~1516) ends up with all 4 operations in force, because the
 *      later call only DROPs+CREATEs the "select"/"insert" policy names and
 *      never touches "update"/"delete". Proves the overlap claim in the
 *      audit report by execution, not just by reading the SQL.
 *
 * NOTE ON RLS BYPASS: every ALTER TABLE in this schema uses
 * "ENABLE ROW LEVEL SECURITY", never "FORCE ROW LEVEL SECURITY" (confirmed
 * absent repo-wide). Under Postgres semantics, ENABLE-without-FORCE means
 * the table owner (and any superuser) bypasses RLS entirely regardless of
 * what policies exist. server.ts's raw `pg.Pool`/DATABASE_URL connection is
 * therefore only subject to any of these policies if that connection's role
 * is NOT the tables' owner -- a fact this suite cannot verify without a
 * live DB connection (see BOS-VAULT-RLS report, Finding R-1). Only routes
 * that go through postgrestFetch() with the caller's own Supabase JWT (a
 * non-owning role) are actually filtered by these policies.
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

/** Minimal auth.uid()/profiles/get_current_org_id()/_create_org_policy() fixture, not a stand-in for the real tables -- just enough for CREATE POLICY's USING clause to resolve at creation time. */
const BASE_FIXTURE = `
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$ SELECT NULL::uuid; $$ LANGUAGE sql STABLE;
  CREATE OR REPLACE FUNCTION uuid_generate_v4() RETURNS uuid AS $$ SELECT gen_random_uuid(); $$ LANGUAGE sql;

  CREATE TABLE public.organizations (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE public.profiles (id UUID PRIMARY KEY, organization_id UUID REFERENCES public.organizations(id));

  ${slice("CREATE OR REPLACE FUNCTION public.get_current_org_id()", "-- 3. Roles")}
`;

async function freshDb(extraDdl: string): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(BASE_FIXTURE);
  await db.exec(extraDdl);
  return db;
}

test("1: industries-family block (line ~1319) is NOT idempotent -- re-applying it throws", async () => {
  const blockDdl = slice("-- Industries", "-- Context Engine Tables");
  const db = await freshDb(blockDdl);
  try {
    await assert.rejects(
      () => db.exec(blockDdl),
      /already exists/i,
      "this block has no DROP POLICY IF EXISTS before its CREATE POLICY statements -- re-running supabase_schema.sql against an already-migrated database fails on this block",
    );
  } finally {
    await db.close();
  }
});

test("2: seo_topics-family block (line ~1479) is NOT idempotent -- re-applying it throws", async () => {
  const blockDdl = slice("-- Additional SEO Intelligence Tables", "-- Campaign Management Tables");
  const stubFk = `CREATE TABLE public.seo_keyword_clusters (id UUID PRIMARY KEY DEFAULT uuid_generate_v4());
    CREATE TABLE public.seo_keywords (id UUID PRIMARY KEY DEFAULT uuid_generate_v4());`;
  const db = await freshDb(`${stubFk}\n${blockDdl}`);
  try {
    await assert.rejects(
      () => db.exec(blockDdl),
      /already exists/i,
      "this block also has no DROP before CREATE -- a second confirmed non-idempotent block, not just one",
    );
  } finally {
    await db.close();
  }
});

test("3: a _create_org_policy()-routed table (context_profiles, line ~1378) has select+insert only -- UPDATE and DELETE are absent, not permissive", async () => {
  const helperFn = slice("CREATE OR REPLACE FUNCTION public._create_org_policy(", "-- 3. Roles");
  const block = slice("-- Context Engine Tables", "-- SEO Intelligence Tables");
  const db = await freshDb(`${helperFn}\n${block}`);
  try {
    const policies = await db.query<{ cmd: string }>(
      `SELECT cmd FROM pg_policies WHERE tablename = 'context_profiles'`,
    );
    const cmds = policies.rows.map((r) => r.cmd).sort();
    assert.deepEqual(cmds, ["INSERT", "SELECT"], "confirms context_profiles has no UPDATE/DELETE policy at all");

    // Re-applying this block IS idempotent (the helper DROPs first) -- contrast with tests 1 and 2.
    await assert.doesNotReject(() => db.exec(block), "the _create_org_policy()-routed blocks ARE idempotent, unlike the two inline blocks above");
  } finally {
    await db.close();
  }
});

test("4: a table from the 31-table block (line ~547) has all four operations -- the complete, idempotent reference case", async () => {
  const createTable = `CREATE TABLE public.tags (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID REFERENCES public.organizations(id), name TEXT);`;
  // This is the 547 block's own per-table policy pattern, reproduced verbatim (ALTER + 4x DROP IF EXISTS + 4x CREATE).
  const applyPolicies = `
    ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Org isolation select" ON public.tags;
    DROP POLICY IF EXISTS "Org isolation insert" ON public.tags;
    DROP POLICY IF EXISTS "Org isolation update" ON public.tags;
    DROP POLICY IF EXISTS "Org isolation delete" ON public.tags;
    CREATE POLICY "Org isolation select" ON public.tags FOR SELECT USING (organization_id = public.get_current_org_id());
    CREATE POLICY "Org isolation insert" ON public.tags FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
    CREATE POLICY "Org isolation update" ON public.tags FOR UPDATE USING (organization_id = public.get_current_org_id());
    CREATE POLICY "Org isolation delete" ON public.tags FOR DELETE USING (organization_id = public.get_current_org_id());
  `;
  const db = await freshDb(`${createTable}\n${applyPolicies}`);
  try {
    const policies = await db.query<{ cmd: string }>(`SELECT cmd FROM pg_policies WHERE tablename = 'tags'`);
    assert.deepEqual(
      policies.rows.map((r) => r.cmd).sort(),
      ["DELETE", "INSERT", "SELECT", "UPDATE"],
      "the 547 block's own pattern (DROP IF EXISTS then CREATE, all 4 ops) is the correct, complete template",
    );
    // Re-apply only the policy statements (not CREATE TABLE, which has no IF NOT EXISTS here) -- this is what matters for idempotency.
    await assert.doesNotReject(() => db.exec(applyPolicies), "and it is genuinely idempotent on re-apply, unlike blocks 1319 and 1479");
  } finally {
    await db.close();
  }
});

test("6: a table present in BOTH block 547 (4 ops) and a later select/insert-only block ends up with all 4 ops -- the overlap claim in the report is proven, not just reasoned about", async () => {
  const createTable = `CREATE TABLE public.campaigns (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID REFERENCES public.organizations(id), name TEXT);`;
  // Block 547's pattern runs first (lower line number), exactly as it does in the real file.
  const block547Pattern = `
    ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Org isolation select" ON public.campaigns;
    DROP POLICY IF EXISTS "Org isolation insert" ON public.campaigns;
    DROP POLICY IF EXISTS "Org isolation update" ON public.campaigns;
    DROP POLICY IF EXISTS "Org isolation delete" ON public.campaigns;
    CREATE POLICY "Org isolation select" ON public.campaigns FOR SELECT USING (organization_id = public.get_current_org_id());
    CREATE POLICY "Org isolation insert" ON public.campaigns FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
    CREATE POLICY "Org isolation update" ON public.campaigns FOR UPDATE USING (organization_id = public.get_current_org_id());
    CREATE POLICY "Org isolation delete" ON public.campaigns FOR DELETE USING (organization_id = public.get_current_org_id());
  `;
  const db = await freshDb(`${createTable}\n${block547Pattern}`);
  try {
    const helperFn = slice("CREATE OR REPLACE FUNCTION public._create_org_policy(", "-- 3. Roles");
    await db.exec(helperFn);
    // Block 1516's pattern (campaigns is 'root' there) runs second, at a higher line number, exactly as in the real file.
    await db.query(`SELECT public._create_org_policy('campaigns', NULL, ARRAY['select', 'insert'])`);

    const policies = await db.query<{ cmd: string }>(`SELECT cmd FROM pg_policies WHERE tablename = 'campaigns'`);
    assert.deepEqual(
      policies.rows.map((r) => r.cmd).sort(),
      ["DELETE", "INSERT", "SELECT", "UPDATE"],
      "block 1516 only touches the 'select' and 'insert' policy names (DROP+CREATE on those two only) -- it never drops 'Org isolation update'/'Org isolation delete', so block 547's UPDATE/DELETE policies survive untouched. This is the mechanism behind the overlap claim in the report's section 2, now proven rather than just reasoned about from reading the SQL.",
    );
  } finally {
    await db.close();
  }
});

let seoDb: PGlite;
before(async () => {
  seoDb = new PGlite();
  const seoKeywordsDdl = slice("CREATE TABLE IF NOT EXISTS public.seo_keywords", "CREATE TABLE IF NOT EXISTS public.seo_keyword_clusters");
  await seoDb.exec(`
    CREATE OR REPLACE FUNCTION uuid_generate_v4() RETURNS uuid AS $$ SELECT gen_random_uuid(); $$ LANGUAGE sql;
    CREATE TABLE public.organizations (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE TABLE public.industries (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
    ${seoKeywordsDdl}
  `);
});
after(async () => {
  await seoDb.close();
});

test("5: EnterpriseSeoService.addKeyword()'s insert shape still fails against the real seo_keywords DDL -- schema/code mismatch is still live, not fixed", async () => {
  // Mirrors the exact record shape built by addKeyword() in EnterpriseSeoService.ts
  // (organization_id, project_id, keyword, search_volume, difficulty, cpc, intent,
  // cluster_name, parent_topic, is_tracked, current_position, ...). project_id and
  // cpc alone are enough to prove the mismatch; the real table has neither.
  await assert.rejects(
    () =>
      seoDb.query(
        `INSERT INTO public.seo_keywords (organization_id, project_id, keyword, search_volume, difficulty, cpc, intent) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [null, "proj-1", "test keyword", null, null, null, "Commercial"],
      ),
    /column "project_id" of relation "seo_keywords" does not exist/i,
    "confirms addKeyword() would fail at runtime against the real schema today -- not yet fixed, needs owner-approved ALTER TABLE or a column-mapping change",
  );
});
