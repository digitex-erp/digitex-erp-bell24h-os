/**
 * Knowledge Vault SQL: re-runnable (it used to abort on a second run or after supabase_schema.sql), no duplicate seed
 * rows, and the hardening migration closes anonymous reads without breaking signed-in reads. Real Postgres engine
 * (PGlite) with Supabase's `anon` / `authenticated` roles and their default grants, so the privilege checks are real.
 *
 * Limits: this proves the SQL files. It does NOT tell us why "Could not load documents" happens in the live project —
 * that needs the live database (see the read-only query in PHASE2_COMPLETION_REPORT.md).
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyMigration, createTestDb, type TestDb } from "./helpers/testDb.js";

let t: TestDb;
const TABLES = ["vault_documents", "rd_library", "timeline_milestones", "phases", "decision_records"];

before(async () => {
  t = await createTestDb();
});
after(async () => {
  await t.db.close();
});

const one = async (sql: string) => (await t.db.query<any>(sql)).rows[0];
const asRole = async <T>(role: "anon" | "authenticated", fn: () => Promise<T>): Promise<T> => {
  await t.db.exec(`SET ROLE ${role}`);
  try {
    return await fn();
  } finally {
    await t.db.exec("RESET ROLE");
  }
};

describe("add_knowledge_vault.sql", () => {
  it("applies, and applying it AGAIN (or after supabase_schema.sql created the same policies) succeeds", async () => {
    await applyMigration(t.db, "add_knowledge_vault.sql");
    await applyMigration(t.db, "add_knowledge_vault.sql");
    await applyMigration(t.db, "add_knowledge_vault.sql");
  });

  it("does not duplicate the seed rows on a re-run; phases keep their primary key", async () => {
    assert.equal((await one(`SELECT COUNT(*)::int n FROM timeline_milestones`)).n, 18);
    assert.equal((await one(`SELECT COUNT(*)::int n FROM phases`)).n, 3);
  });

  it("leaves exactly one read policy per table (no accumulation)", async () => {
    for (const table of TABLES) {
      assert.equal((await one(`SELECT COUNT(*)::int n FROM pg_policies WHERE tablename = '${table}'`)).n, 1, table);
    }
  });

  it("documents the original exposure: anonymous can read the vault before hardening", async () => {
    assert.equal(await asRole("anon", async () => (await one(`SELECT COUNT(*)::int n FROM timeline_milestones`)).n), 18);
  });
});

describe("add_knowledge_vault_hardening.sql", () => {
  it("is re-runnable", async () => {
    await applyMigration(t.db, "add_knowledge_vault_hardening.sql");
    await applyMigration(t.db, "add_knowledge_vault_hardening.sql");
  });

  it("anonymous readers are refused on every vault table", async () => {
    for (const table of TABLES) {
      await assert.rejects(() => asRole("anon", () => t.db.query(`SELECT * FROM ${table} LIMIT 1`)), /permission denied/i, table);
    }
  });

  it("signed-in users can still read every vault table (the screens keep working)", async () => {
    assert.equal(await asRole("authenticated", async () => (await one(`SELECT COUNT(*)::int n FROM timeline_milestones`)).n), 18);
    for (const table of TABLES) await asRole("authenticated", () => t.db.query(`SELECT * FROM ${table} LIMIT 1`));
  });

  it("leaves exactly one policy per table, scoped to authenticated", async () => {
    for (const table of TABLES) {
      const rows = (await t.db.query<any>(`SELECT policyname, roles FROM pg_policies WHERE tablename = '${table}'`)).rows;
      assert.equal(rows.length, 1, table);
      assert.equal(rows[0].policyname, "Authenticated read");
      assert.ok(String(rows[0].roles).includes("authenticated") && !String(rows[0].roles).includes("public"), table);
    }
  });

  it("does not turn the vault into a write surface: signed-in users still cannot INSERT (no INSERT policy)", async () => {
    await assert.rejects(
      () => asRole("authenticated", () => t.db.query(`INSERT INTO vault_documents (title, category, content) VALUES ('x','y','z')`)),
      /row-level security/i,
    );
  });

  it("states honestly that there is still no per-organization isolation (no organization_id column)", async () => {
    const cols = (await t.db.query<any>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'vault_documents'`)).rows.map((r) => r.column_name);
    assert.ok(!cols.includes("organization_id"), "if this ever fails, update the hardening file's header and the report: isolation now exists");
  });
});
