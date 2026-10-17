/**
 * Static-content regression test for harden_ai_providers_credentials.sql
 * (AI Router security Finding A: ai_providers.api_key column-level
 * exposure). Cheap and fast, but proves only that the SQL text looks
 * right -- not that Postgres actually enforces it.
 *
 * For the live-database proof (applying this same migration in a real
 * Postgres engine, switching to the `authenticated` role, and asserting
 * the database itself rejects/allows exactly what's expected), see the
 * companion `aiProvidersCredentialGrant.live.test.ts` in this same
 * directory -- built this same pass once a self-contained PGlite harness
 * was confirmed feasible without needing Communication Hub's own
 * (still-unmerged, PR #1) tenant-role test helper.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const MIGRATION_PATH = path.resolve(import.meta.dirname, "..", "..", "..", "harden_ai_providers_credentials.sql");

/** Strips `-- ...` line comments so regex checks below match only real SQL, never prose that happens to mention a keyword like GRANT/TO/anon while explaining the migration's rationale. */
function stripSqlComments(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}
const sql = stripSqlComments(fs.readFileSync(MIGRATION_PATH, "utf8"));

const EXPECTED_SAFE_COLUMNS = [
  "id", "name", "provider_id", "status", "priority", "default_model",
  "temperature", "max_tokens", "timeout_ms", "retry_count",
  "last_request_at", "last_error", "organization_id", "created_at", "updated_at",
];

describe("harden_ai_providers_credentials.sql", () => {
  test("api_key never appears inside any GRANT column list", () => {
    // Extract just the GRANT statement's column-list portion (between the
    // first "GRANT SELECT (" and the final "TO authenticated;"), so a
    // mention of api_key in a comment (explaining the finding) doesn't
    // produce a false failure -- only the actual privilege grant matters.
    const grantMatch = sql.match(/GRANT SELECT \(([\s\S]*?)TO authenticated;/);
    assert.ok(grantMatch, "expected to find the GRANT ... TO authenticated; statement");
    const grantClause = grantMatch[1];
    assert.ok(
      !/\bapi_key\b/.test(grantClause),
      "api_key must never appear in any column-level GRANT -- it must stay unreadable and unwritable via PostgREST",
    );
  });

  test("every expected non-secret column is present in the SELECT grant", () => {
    const selectMatch = sql.match(/GRANT SELECT \(([\s\S]*?)\)/);
    assert.ok(selectMatch, "expected to find a GRANT SELECT (...) column list");
    const selectColumns = selectMatch[1];
    for (const col of EXPECTED_SAFE_COLUMNS) {
      assert.ok(
        new RegExp(`\\b${col}\\b`).test(selectColumns),
        `expected column "${col}" to be readable -- its absence would be an accidental regression, not a security improvement`,
      );
    }
  });

  test("ALL privileges are revoked from both anon and authenticated before any re-grant", () => {
    assert.match(sql, /FOREACH r IN ARRAY ARRAY\['anon', 'authenticated'\]/);
    assert.match(sql, /REVOKE ALL ON public\.ai_providers FROM %I/);
  });

  test("anon receives no grant at all -- only authenticated does", () => {
    const grantStatements = sql.match(/GRANT [\s\S]*?;/g) ?? [];
    for (const stmt of grantStatements) {
      assert.ok(
        !/TO anon\b/.test(stmt),
        `expected no GRANT to target anon directly; found: ${stmt.slice(0, 80)}...`,
      );
    }
  });

  test("the migration contains no destructive statement (no DROP TABLE, TRUNCATE, or unscoped DELETE FROM)", () => {
    assert.doesNotMatch(sql, /\bDROP TABLE\b/i);
    assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
    assert.doesNotMatch(sql, /\bDELETE FROM\b/i);
  });
});
