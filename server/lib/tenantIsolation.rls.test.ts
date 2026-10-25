/**
 * Cross-tenant RLS enforcement test (2026-10-25) -- Phase 5 of the
 * "Verify Database Role, RLS Enforcement and Tenant-Isolation Architecture"
 * task.
 *
 * Everything in `policyGeneratorCoverage.test.ts` and the Vault RLS report
 * checks POLICY EXISTENCE (via pg_policies / re-apply idempotency) but never
 * actually executes a query AS a restricted, non-owner role -- so it never
 * proves isolation genuinely holds, only that the policy text exists. This
 * file closes that gap: it creates a real, non-superuser Postgres ROLE
 * inside PGlite, switches to it with `SET ROLE`, and drives real
 * SELECT/INSERT/UPDATE/DELETE statements through it, exactly as Postgres's
 * RLS engine would evaluate them for a genuinely restricted connection (e.g.
 * what `postgrestFetch()`'s `authenticated` role experiences in production).
 *
 * WHAT THIS DOES **NOT** PROVE: whether the real `DATABASE_URL`/`pg.Pool`
 * connection used by server.ts is itself restricted or owns the tables. That
 * is Phase 2/3's question and requires a live database connection (tracked
 * separately, pending Supabase MCP OAuth). This file's "owner" queries
 * (plain queries with no `SET ROLE`) show what a table-owning connection
 * sees -- if `DATABASE_URL` turns out to BE the owner (which the matching
 * `run_migration.cjs` connection string makes likely, see the audit report),
 * these "owner" results are what pg.Pool actually experiences today;
 * if not, they're simply the control case for comparison.
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

/**
 * auth.uid() here reads a session GUC instead of a real JWT, so a single
 * PGlite connection can impersonate different authenticated users across
 * statements by just changing `app.current_uid` -- this is what lets one
 * physical connection stand in for "two different end-user requests" below.
 */
const BASE_FIXTURE = `
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
    SELECT NULLIF(current_setting('app.current_uid', true), '')::uuid;
  $$ LANGUAGE sql STABLE;
  CREATE OR REPLACE FUNCTION uuid_generate_v4() RETURNS uuid AS $$ SELECT gen_random_uuid(); $$ LANGUAGE sql;

  CREATE TABLE public.organizations (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE public.profiles (id UUID PRIMARY KEY, organization_id UUID REFERENCES public.organizations(id));

  ${slice("CREATE OR REPLACE FUNCTION public.get_current_org_id()", "-- 3. Roles")}

  CREATE ROLE app_role NOLOGIN;
  GRANT USAGE ON SCHEMA public TO app_role;
`;

interface Fixture {
  db: PGlite;
  orgA: string;
  orgB: string;
  userA: string;
  userB: string;
}

/** Sets up organizations A/B, users A/B (each a profile pointing at their org), and grants app_role access to `tableName`. Returns ids needed by the tests. */
async function seedTwoOrgs(db: PGlite, tableName: string): Promise<{ orgA: string; orgB: string; userA: string; userB: string }> {
  const orgA = (await db.query<{ id: string }>(`INSERT INTO public.organizations DEFAULT VALUES RETURNING id`)).rows[0].id;
  const orgB = (await db.query<{ id: string }>(`INSERT INTO public.organizations DEFAULT VALUES RETURNING id`)).rows[0].id;
  const userA = (await db.query<{ id: string }>(`INSERT INTO public.profiles (id, organization_id) VALUES (gen_random_uuid(), $1) RETURNING id`, [orgA])).rows[0].id;
  const userB = (await db.query<{ id: string }>(`INSERT INTO public.profiles (id, organization_id) VALUES (gen_random_uuid(), $1) RETURNING id`, [orgB])).rows[0].id;
  await db.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.${tableName} TO app_role;`);
  return { orgA, orgB, userA, userB };
}

async function asUser(db: PGlite, userId: string | null) {
  await db.exec(`SET ROLE app_role;`);
  if (userId) {
    await db.query(`SELECT set_config('app.current_uid', $1, false)`, [userId]);
  } else {
    await db.exec(`SELECT set_config('app.current_uid', '', false);`);
  }
}

async function asOwner(db: PGlite) {
  await db.exec(`RESET ROLE; SELECT set_config('app.current_uid', '', false);`);
}

// -----------------------------------------------------------------------
// Tests 1-6: full-coverage table ("tags", from the 547 block -- SELECT,
// INSERT, UPDATE, DELETE all present, the "complete reference case" per
// policyGeneratorCoverage.test.ts test 4).
// -----------------------------------------------------------------------
let db1: PGlite;
let f1: { orgA: string; orgB: string; userA: string; userB: string };
let rowA: string;
let rowB: string;

before(async () => {
  db1 = new PGlite();
  await db1.exec(BASE_FIXTURE);
  await db1.exec(`
    CREATE TABLE public.tags (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID REFERENCES public.organizations(id), name TEXT);
    ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Org isolation select" ON public.tags FOR SELECT USING (organization_id = public.get_current_org_id());
    CREATE POLICY "Org isolation insert" ON public.tags FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
    CREATE POLICY "Org isolation update" ON public.tags FOR UPDATE USING (organization_id = public.get_current_org_id());
    CREATE POLICY "Org isolation delete" ON public.tags FOR DELETE USING (organization_id = public.get_current_org_id());
    GRANT USAGE ON SCHEMA public TO app_role;
  `);
  f1 = await seedTwoOrgs(db1, "tags");
  rowA = (await db1.query<{ id: string }>(`INSERT INTO public.tags (organization_id, name) VALUES ($1, 'Org A tag') RETURNING id`, [f1.orgA])).rows[0].id;
  rowB = (await db1.query<{ id: string }>(`INSERT INTO public.tags (organization_id, name) VALUES ($1, 'Org B tag') RETURNING id`, [f1.orgB])).rows[0].id;
});
after(async () => {
  await db1.close();
});

test("1: Org A cannot read Org B's rows", async () => {
  await asUser(db1, f1.userA);
  const rows = await db1.query<{ id: string }>(`SELECT id FROM public.tags`);
  assert.deepEqual(rows.rows.map((r) => r.id), [rowA], "only Org A's own row is visible, Org B's row is filtered out by RLS");
});

test("2: Org A cannot insert a row claiming Org B's ownership", async () => {
  await asUser(db1, f1.userA);
  await assert.rejects(
    () => db1.query(`INSERT INTO public.tags (organization_id, name) VALUES ($1, 'forged')`, [f1.orgB]),
    /new row violates row-level security policy/i,
    "WITH CHECK rejects an insert whose organization_id doesn't match the caller's own org",
  );
});

test("3: Org A cannot update or delete Org B's row", async () => {
  await asUser(db1, f1.userA);
  const upd = await db1.query(`UPDATE public.tags SET name = 'hacked' WHERE id = $1`, [rowB]);
  assert.equal((upd as any).affectedRows ?? 0, 0, "the UPDATE matches zero rows -- RLS's USING clause hides Org B's row from Org A entirely, before any WHERE clause is even considered");
  const del = await db1.query(`DELETE FROM public.tags WHERE id = $1`, [rowB]);
  assert.equal((del as any).affectedRows ?? 0, 0, "same for DELETE");

  await asOwner(db1);
  const stillThere = await db1.query<{ name: string }>(`SELECT name FROM public.tags WHERE id = $1`, [rowB]);
  assert.equal(stillThere.rows[0]?.name, "Org B tag", "confirmed as the unrestricted owner connection: Org B's row was genuinely untouched, not just hidden from the response");
});

test("4: UPDATE's USING-as-WITH-CHECK blocks reassigning a row's ownership to another org", async () => {
  // tags' UPDATE policy has only a USING clause, no separate WITH CHECK -- per
  // Postgres semantics, the USING expression is then reused as the WITH CHECK
  // too, so the *new* row values must also satisfy organization_id = caller's org.
  await asUser(db1, f1.userA);
  await assert.rejects(
    () => db1.query(`UPDATE public.tags SET organization_id = $1 WHERE id = $2`, [f1.orgB, rowA]),
    /new row violates row-level security policy/i,
    "Org A cannot reassign its own row to Org B -- the implicit WITH CHECK (same as USING) catches this",
  );
});

test("5: missing tenant context (no auth.uid()) fails safely -- zero rows, not an error, not everything", async () => {
  await asUser(db1, null);
  const rows = await db1.query(`SELECT id FROM public.tags`);
  assert.equal(rows.rows.length, 0, "get_current_org_id() resolves to NULL when auth.uid() is NULL; organization_id = NULL is never true, so RLS safely denies all rows rather than erroring or defaulting open");
  await assert.rejects(
    () => db1.query(`INSERT INTO public.tags (organization_id, name) VALUES ($1, 'x')`, [f1.orgA]),
    /new row violates row-level security policy/i,
    "insert attempts also fail safely with no tenant context, not silently succeed",
  );
});

test("6: an unowned (organization_id IS NULL) legacy row is not exposed to any tenant under this policy shape", async () => {
  await asOwner(db1);
  await db1.exec(`INSERT INTO public.tags (organization_id, name) VALUES (NULL, 'orphaned legacy row')`);

  await asUser(db1, f1.userA);
  const asA = await db1.query<{ name: string }>(`SELECT name FROM public.tags WHERE name = 'orphaned legacy row'`);
  assert.equal(asA.rows.length, 0, "Org A cannot see the unowned row");

  await asUser(db1, f1.userB);
  const asB = await db1.query<{ name: string }>(`SELECT name FROM public.tags WHERE name = 'orphaned legacy row'`);
  assert.equal(asB.rows.length, 0, "Org B cannot see it either -- organization_id = NULL never satisfies '= get_current_org_id()' for any org, which is the SAFE direction to get this wrong in. This is the shape this schema actually uses; a policy written as 'organization_id = get_current_org_id() OR organization_id IS NULL' (a pattern already spotted once on prompt_categories' SELECT policy) would instead expose unowned rows to every tenant -- the opposite, unsafe outcome.");

  await asOwner(db1);
  const asOwnerConn = await db1.query<{ name: string }>(`SELECT name FROM public.tags WHERE name = 'orphaned legacy row'`);
  assert.equal(asOwnerConn.rows.length, 1, "the owner/unrestricted connection (what pg.Pool experiences, if it is in fact the table owner) sees the orphaned row fine -- RLS was never in its path to begin with");
});

// -----------------------------------------------------------------------
// Test 7: pooled-connection tenant-context leakage. A plain SET persists for
// the life of the session (realistic for a pooled connection reused across
// unrelated requests); SET LOCAL inside an explicit transaction resets the
// moment that transaction ends. This is the concrete evidence behind the
// Phase 7 recommendation: any future per-request tenant-context mechanism
// MUST use SET LOCAL inside a transaction per request, never a bare SET.
// -----------------------------------------------------------------------
test("7a: a bare SET leaks tenant context to the next logical request on a reused connection", async () => {
  const db = new PGlite();
  await db.exec(BASE_FIXTURE);
  try {
    await db.exec(`SELECT set_config('app.current_uid', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);`); // is_local=false -> session-wide
    const stillSet = await db.query<{ v: string }>(`SELECT current_setting('app.current_uid', true) as v`);
    assert.equal(stillSet.rows[0].v, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "a bare SET (is_local=false) is still visible with no transaction boundary at all -- on a real pooled connection, this value would still be set for whichever request borrows the connection next, unless something explicitly resets it first");
  } finally {
    await db.close();
  }
});

test("7b: SET LOCAL inside a transaction resets automatically at COMMIT -- the safe pattern", async () => {
  const db = new PGlite();
  await db.exec(BASE_FIXTURE);
  try {
    await db.query("BEGIN");
    await db.query(`SELECT set_config('app.current_uid', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', true)`); // is_local=true
    const duringTx = await db.query<{ v: string }>(`SELECT current_setting('app.current_uid', true) as v`);
    assert.equal(duringTx.rows[0].v, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    await db.query("COMMIT");
    const afterTx = await db.query<{ v: string }>(`SELECT current_setting('app.current_uid', true) as v`);
    assert.equal(afterTx.rows[0].v, "", "after COMMIT, the session-local setting is automatically cleared -- a subsequent request reusing this same physical connection starts with a clean slate, which is NOT what test 7a showed for a bare SET");
  } finally {
    await db.close();
  }
});

// -----------------------------------------------------------------------
// Test 8: the same cross-tenant proof as tests 1-3, but against a table
// from the 104 newly-found STANDALONE policy statements (not a DO-loop),
// to confirm enforcement genuinely holds there too, not just for "tags".
// -----------------------------------------------------------------------
test("8: cross-tenant isolation also genuinely holds for a standalone-policy table (content_projects), not just the loop-generated ones", async () => {
  const db = new PGlite();
  await db.exec(BASE_FIXTURE);
  await db.exec(`
    CREATE TABLE public.content_projects (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID REFERENCES public.organizations(id), name TEXT);
    ALTER TABLE public.content_projects ENABLE ROW LEVEL SECURITY;
    ${slice('CREATE POLICY "Org isolation select" ON public.content_projects', 'CREATE POLICY "Org isolation select" ON public.content_topics')}
    GRANT USAGE ON SCHEMA public TO app_role;
  `);
  try {
    const f = await seedTwoOrgs(db, "content_projects");
    const a = (await db.query<{ id: string }>(`INSERT INTO public.content_projects (organization_id, name) VALUES ($1,'A proj') RETURNING id`, [f.orgA])).rows[0].id;
    await db.query(`INSERT INTO public.content_projects (organization_id, name) VALUES ($1,'B proj')`, [f.orgB]);

    await asUser(db, f.userA);
    const rows = await db.query<{ id: string }>(`SELECT id FROM public.content_projects`);
    assert.deepEqual(rows.rows.map((r) => r.id), [a], "same isolation guarantee holds for a standalone (non-loop) policy table");
  } finally {
    await db.close();
  }
});

// -----------------------------------------------------------------------
// Test 9: re-applying a STANDALONE block (not a DO-loop) is NOT idempotent --
// extends policyGeneratorCoverage.test.ts's proof (which only covered the 2
// non-idempotent DO-loop blocks) to the newly-found 104 standalone
// statements, confirmed here for ai_providers specifically.
// -----------------------------------------------------------------------
test("9: the standalone ai_providers policy block is NOT idempotent -- re-applying it throws, same defect class as the 2 DO-loop blocks already proven", async () => {
  const db = new PGlite();
  await db.exec(BASE_FIXTURE);
  const block = slice("ALTER TABLE public.ai_providers ENABLE ROW LEVEL SECURITY", "CREATE TABLE IF NOT EXISTS public.prompt_categories");
  await db.exec(`
    CREATE TABLE public.ai_providers (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID REFERENCES public.organizations(id));
    CREATE TABLE public.ai_request_logs (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID REFERENCES public.organizations(id));
  `);
  try {
    await db.exec(block);
    await assert.rejects(
      () => db.exec(block),
      /already exists/i,
      "confirms the standalone-statement finding empirically, not just by grep: this block has no DROP POLICY IF EXISTS anywhere, so it is not safe to re-apply, exactly like the industries-family and seo_topics-family DO-loop blocks",
    );
  } finally {
    await db.close();
  }
});
