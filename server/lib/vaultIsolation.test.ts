/**
 * Knowledge Vault write-path tenant-isolation test.
 *
 * This is a REGRESSION-DOCUMENTING test, not a correctness test: it proves that the
 * CURRENT behavior of POST /api/vault/documents (server.ts) has no organization-level
 * isolation, by exercising the exact same query shape the route uses against the real
 * vault_documents DDL (sliced from supabase_schema.sql, not a hand-written stand-in).
 *
 * Why this lives here instead of asserting isolation: `vault_documents` has no
 * organization_id column today (confirmed by schema inspection), and the route's own
 * comment explains it intentionally stays on a raw pooled-connection INSERT because the
 * table's RLS policy has no INSERT rule. There is nothing to scope by yet. Per the P0
 * audit's Phase 1 proposal, closing this requires an owner-approved schema change
 * (organization_id column + INSERT policy) -- not implemented here.
 *
 * ACTION REQUIRED WHEN THAT FIX LANDS: update this test to seed two organizations, scope
 * the insert/query by organization_id, and assert cross-organization isolation holds.
 * Until then, this test's passing result IS the documented gap, not a clean bill of health.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

/** The real vault_documents DDL, sliced from supabase_schema.sql -- not a hand-written stand-in. */
function vaultDocumentsDdl(): string {
  const sql = fs.readFileSync(path.join(REPO_ROOT, "supabase_schema.sql"), "utf8");
  const start = sql.indexOf("CREATE TABLE IF NOT EXISTS vault_documents");
  const end = sql.indexOf("-- 2. R&D Library", start);
  if (start < 0 || end < 0) throw new Error("Could not locate the vault_documents DDL in supabase_schema.sql");
  return sql.slice(start, end);
}

let db: PGlite;

before(async () => {
  db = new PGlite();
  await db.exec(vaultDocumentsDdl());
});

after(async () => {
  await db.close();
});

test("1: confirmed -- vault_documents has no organization_id (or any ownership) column", async () => {
  const cols = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'vault_documents'`,
  );
  const names = cols.rows.map((r) => r.column_name);
  assert.ok(!names.includes("organization_id"), "if this now fails, the schema fix has landed -- update this test per its own header comment");
  assert.ok(!names.includes("user_id"), "no ownership column exists either, confirming backfill would require a manual owner decision");
});

test("2: documented gap -- a document inserted via the exact query shape of POST /api/vault/documents is visible to an unscoped SELECT regardless of which 'tenant' created it", async () => {
  // Mirrors server.ts's actual query: INSERT INTO vault_documents (title, category, content, tags) VALUES (...) RETURNING *
  const insertSql = `INSERT INTO vault_documents (title, category, content, tags) VALUES ($1, $2, $3, $4) RETURNING *`;
  const docA = await db.query<{ id: string }>(insertSql, ["Tenant A's confidential doc", "legal", "secret content for A", ["confidential"]]);
  const docB = await db.query<{ id: string }>(insertSql, ["Tenant B's confidential doc", "legal", "secret content for B", ["confidential"]]);

  // Mirrors the GET route's select shape (select=*) -- no WHERE clause scoping by any identity.
  const allDocs = await db.query<{ id: string; title: string }>(`SELECT id, title FROM vault_documents ORDER BY created_at`);
  const ids = allDocs.rows.map((r) => r.id);

  assert.ok(ids.includes(docA.rows[0].id), "tenant A's document exists");
  assert.ok(ids.includes(docB.rows[0].id), "tenant B's document exists");
  assert.equal(allDocs.rows.length, 2, "both documents are visible in a single unscoped query -- no isolation boundary exists at the data layer today");
});

test("3: no application-level authorization check beyond basic authentication exists in the schema itself", async () => {
  // There is no role/permission/ownership table referenced by vault_documents -- a foreign-key
  // sweep confirms it has zero FK constraints to any identity or org table.
  const fks = await db.query(
    `SELECT conname FROM pg_constraint WHERE conrelid = 'vault_documents'::regclass AND contype = 'f'`,
  );
  assert.equal(fks.rows.length, 0, "vault_documents has no foreign key to any identity/org table -- confirms isolation must be added at the schema level, not just in application code");
});
