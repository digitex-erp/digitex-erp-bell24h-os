/**
 * LIVE privilege-enforcement test for harden_ai_providers_credentials.sql,
 * using a real Postgres engine (PGlite, @electric-sql/pglite -- the same
 * package this repo already depends on for its other PGlite-based tests).
 *
 * This exists because the 5 tests in aiProvidersCredentialGrant.test.ts are
 * static-content checks of the migration file's text, not proof that
 * Postgres actually enforces the grant. This test applies the REAL
 * migration file's exact SQL content, switches to the `authenticated`
 * Postgres role, and asserts the database itself rejects/allows exactly
 * what's expected -- no mocking of the privilege system.
 *
 * SCOPE NOTE on RLS: this repo's full RLS policy for ai_providers depends on
 * get_current_org_id(), which calls auth.uid() (a Supabase-platform
 * function reading the caller's JWT claims -- not available in plain
 * PGlite, which has no Supabase extension loaded). Rather than skip RLS
 * entirely, this test defines a narrow, explicitly-labelled TEST-ONLY
 * stand-in for get_current_org_id() that reads a session-local setting
 * instead of auth.uid()/profiles -- it changes nothing in the real
 * database, only in this test's own isolated in-memory PGlite instance.
 * The REAL RLS policies (copied verbatim from supabase_schema.sql) are
 * applied unmodified on top of that stand-in, so this test proves row-level
 * isolation and the new column-level grant compose correctly together, not
 * just the column grant in isolation.
 *
 * Communication Hub's own PGlite test harness (createTestDb/asTenant) would
 * be the more complete way to do this, but it lives on the still-unmerged
 * feature/communication-hub branch (PR #1), not on `main` -- not merged
 * into this branch just to borrow a test helper, per this task's own
 * instruction. This self-contained harness is deliberately minimal.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATION_PATH = path.resolve(import.meta.dirname, "..", "..", "..", "harden_ai_providers_credentials.sql");
const migrationSql = fs.readFileSync(MIGRATION_PATH, "utf8");

let db: PGlite;
const orgA = "11111111-1111-1111-1111-111111111111";
const orgB = "22222222-2222-2222-2222-222222222222";

before(async () => {
  db = new PGlite();

  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;

    -- TEST-ONLY stand-in: the real get_current_org_id() calls auth.uid(),
    -- a Supabase-platform function unavailable in plain PGlite. This reads
    -- a session-local GUC instead -- never used outside this test file.
    CREATE OR REPLACE FUNCTION public.get_current_org_id() RETURNS UUID AS $$
      SELECT current_setting('test.current_org_id', true)::uuid;
    $$ LANGUAGE sql STABLE;

    CREATE TABLE public.ai_providers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        status TEXT DEFAULT 'ACTIVE',
        priority INTEGER DEFAULT 0,
        api_key TEXT,
        default_model TEXT,
        temperature NUMERIC DEFAULT 0.7,
        max_tokens INTEGER DEFAULT 2048,
        timeout_ms INTEGER DEFAULT 30000,
        retry_count INTEGER DEFAULT 3,
        last_request_at TIMESTAMPTZ,
        last_error TEXT,
        organization_id UUID,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- The real RLS policies, copied verbatim from supabase_schema.sql.
    ALTER TABLE public.ai_providers ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Org isolation select" ON public.ai_providers FOR SELECT USING (organization_id = public.get_current_org_id());
    CREATE POLICY "Org isolation insert" ON public.ai_providers FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
    CREATE POLICY "Org isolation update" ON public.ai_providers FOR UPDATE USING (organization_id = public.get_current_org_id());
    CREATE POLICY "Org isolation delete" ON public.ai_providers FOR DELETE USING (organization_id = public.get_current_org_id());
  `);

  // The real migration under test -- applied verbatim, not re-typed.
  await db.exec(migrationSql);

  await db.query(
    `INSERT INTO public.ai_providers (name, provider_id, api_key, organization_id) VALUES ($1, $2, $3, $4)`,
    ["Org A provider", "gemini", "sk-real-secret-not-actually-real", orgA],
  );
  await db.query(
    `INSERT INTO public.ai_providers (name, provider_id, api_key, organization_id) VALUES ($1, $2, $3, $4)`,
    ["Org B provider", "nvidia", "sk-another-secret-not-real", orgB],
  );
});

after(async () => {
  await db.close();
});

async function asOrgAuthenticated<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  // SET LOCAL only persists for the remainder of the current transaction;
  // each db.exec()/db.query() call here is its own implicit transaction
  // (autocommit), so a session-level SET is used instead -- it persists
  // across statements on this connection until explicitly reset below.
  await db.exec(`SET ROLE authenticated; SET test.current_org_id = '${orgId}';`);
  try {
    return await fn();
  } finally {
    await db.exec(`RESET test.current_org_id; RESET ROLE;`);
  }
}

describe("harden_ai_providers_credentials.sql — live PGlite privilege enforcement", () => {
  test("an authenticated org member CANNOT select api_key directly", async () => {
    await assert.rejects(
      () => asOrgAuthenticated(orgA, () => db.query(`SELECT api_key FROM public.ai_providers WHERE organization_id = $1`, [orgA])),
      /permission denied/i,
    );
  });

  test("an authenticated org member CANNOT retrieve api_key via SELECT *", async () => {
    await assert.rejects(
      () => asOrgAuthenticated(orgA, () => db.query(`SELECT * FROM public.ai_providers WHERE organization_id = $1`, [orgA])),
      /permission denied/i,
    );
  });

  test("an authenticated org member CAN select the non-secret columns for their own org", async () => {
    const result = await asOrgAuthenticated(orgA, () =>
      db.query<{ name: string; provider_id: string }>(
        `SELECT name, provider_id FROM public.ai_providers WHERE organization_id = $1`,
        [orgA],
      ),
    );
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].name, "Org A provider");
  });

  test("row-level isolation still holds: org A cannot see org B's row even for permitted columns", async () => {
    const result = await asOrgAuthenticated(orgA, () =>
      db.query(`SELECT name FROM public.ai_providers WHERE organization_id = $1`, [orgB]),
    );
    assert.equal(result.rows.length, 0, "RLS must still scope rows by organization, independent of the new column grant");
  });

  test("an authenticated org member CANNOT write api_key via INSERT", async () => {
    await assert.rejects(
      () =>
        asOrgAuthenticated(orgA, () =>
          db.query(
            `INSERT INTO public.ai_providers (name, provider_id, api_key, organization_id) VALUES ($1, $2, $3, $4)`,
            ["New", "deepseek", "attempted-write-not-real", orgA],
          ),
        ),
      /permission denied/i,
    );
  });

  test("an authenticated org member CAN insert the legitimate non-secret fields for their own org -- the real app's own write path still works", async () => {
    const inserted = await asOrgAuthenticated(orgA, () =>
      db.query<{ id: string }>(
        `INSERT INTO public.ai_providers (name, provider_id, organization_id) VALUES ($1, $2, $3) RETURNING id`,
        ["Legit new provider", "qwen", orgA],
      ),
    );
    assert.equal(inserted.rows.length, 1);
  });

  test("an authenticated org member CANNOT write api_key via UPDATE", async () => {
    await assert.rejects(
      () =>
        asOrgAuthenticated(orgA, () =>
          db.query(`UPDATE public.ai_providers SET api_key = $1 WHERE organization_id = $2`, ["new-key-not-real", orgA]),
        ),
      /permission denied/i,
    );
  });

  test("an authenticated org member CAN update legitimate non-secret fields for their own org", async () => {
    await asOrgAuthenticated(orgA, () =>
      db.query(`UPDATE public.ai_providers SET status = $1 WHERE organization_id = $2`, ["INACTIVE", orgA]),
    );
    const check = await db.query<{ status: string }>(
      `SELECT status FROM public.ai_providers WHERE organization_id = $1 LIMIT 1`,
      [orgA],
    );
    assert.equal(check.rows[0].status, "INACTIVE");
  });

  test("a server-side (superuser/unrestricted) connection retains full access -- the authoritative router's own credential path is unaffected", async () => {
    // The real server (server/ai/ProviderManager.ts) never queries this
    // table via SQL at all -- it resolves credentials from process.env.
    // This assertion instead proves the migration doesn't accidentally
    // lock the table down for every role, which would break any genuinely
    // privileged administrative path (e.g. a future service-role-backed
    // secret-storage endpoint, per ticket AA-01-002/AA-01-004).
    // Filtered by the original seeded row's own name, not just organization_id
    // -- an earlier test in this file inserts a second orgA row, so row
    // count alone isn't a reliable assertion across the whole suite.
    const res = await db.query(`SELECT api_key FROM public.ai_providers WHERE name = 'Org A provider'`);
    assert.equal(res.rows.length, 1);
    assert.ok((res.rows[0] as any).api_key, "the unrestricted connection must still read the real value");
  });
});
