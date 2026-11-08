/**
 * Regression test for the AiProvidersPage.tsx edit-save compatibility fix
 * with harden_ai_providers_credentials.sql (AI Router security Finding A).
 *
 * Before this fix, openEditProvider's `{...p}` spread carried id,
 * organization_id, created_at, and updated_at into formData, and
 * handleSaveProvider's update payload included all of them -- columns the
 * migration's UPDATE grant excludes. Postgres rejects an UPDATE outright if
 * any ungranted column appears in its SET clause, so every provider edit
 * would have failed with a permission-denied error once the migration is
 * applied. This proves buildProviderUpdatePayload() strips all five
 * protected fields (api_key plus the four immutable columns) regardless of
 * whether the caller supplies them, while preserving every legitimate
 * editable field.
 *
 * The "exact match" test below reads harden_ai_providers_credentials.sql
 * from disk and parses its real UPDATE (...) grant column list -- the same
 * stripSqlComments-then-regex approach server/middleware/__tests__/
 * aiProvidersCredentialGrant.test.ts already uses -- rather than duplicating
 * that list as a hand-typed literal, so a future edit to the migration's
 * UPDATE grant is caught here automatically instead of silently drifting.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildProviderUpdatePayload } from "./providerUpdatePayload";

const PROTECTED_FIELDS = ["api_key", "id", "organization_id", "created_at", "updated_at"];

const MIGRATION_PATH = path.resolve(import.meta.dirname, "..", "..", "harden_ai_providers_credentials.sql");

/** Mirrors aiProvidersCredentialGrant.test.ts's own helper: strips `-- ...` line comments so parsing matches only real SQL. */
function stripSqlComments(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

/**
 * Reads and parses the real migration's UPDATE (...) grant column list.
 * Throws -- never returns an empty or partial list silently -- if the file
 * is missing, the UPDATE clause can't be found, or it parses as empty, so a
 * broken parser or a reshaped migration fails this test loudly instead of
 * passing by accident.
 */
function readUpdateGrantColumnsFromMigration(): string[] {
  const raw = fs.readFileSync(MIGRATION_PATH, "utf8"); // throws ENOENT if the migration file is missing/moved
  const sql = stripSqlComments(raw);
  const match = sql.match(/\bUPDATE\s*\(([^)]*)\)/);
  if (!match) {
    throw new Error(
      `Could not find a "UPDATE (...)" column-grant clause in ${MIGRATION_PATH} -- the migration's shape may have changed; update this parser, don't bypass it.`,
    );
  }
  const columns = match[1]
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  if (columns.length === 0) {
    throw new Error(`Parsed an empty UPDATE column list from ${MIGRATION_PATH} -- refusing to treat that as a valid grant.`);
  }
  return columns;
}

describe("buildProviderUpdatePayload", () => {
  test("strips all five protected fields from a full provider row (the real openEditProvider shape)", () => {
    // Mirrors what openEditProvider's {...p} spread actually produces: every
    // column from fetchProviders()'s SELECT, since api_key is never fetched
    // but the other four protected columns are.
    const formData = {
      id: "provider-1",
      name: "Gemini Prod",
      provider_id: "gemini",
      status: "ACTIVE",
      priority: 1,
      default_model: "gemini-pro",
      temperature: 0.7,
      max_tokens: 2048,
      timeout_ms: 30000,
      retry_count: 3,
      last_request_at: "2026-10-17T00:00:00Z",
      last_error: null,
      organization_id: "org-a",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-10-17T00:00:00Z",
    };

    const payload = buildProviderUpdatePayload(formData);

    for (const field of PROTECTED_FIELDS) {
      assert.ok(
        !(field in payload),
        `${field} must never appear in the UPDATE payload -- it is excluded from the migration's UPDATE grant (or, for api_key, from every grant)`,
      );
    }
  });

  test("also strips api_key specifically if present (e.g. a stale form field), not just the four immutable columns", () => {
    const payload = buildProviderUpdatePayload({ name: "X", api_key: "sk-not-real" });
    assert.ok(!("api_key" in payload));
  });

  test("preserves every legitimate editable field unchanged", () => {
    const formData = {
      id: "provider-1",
      name: "Gemini Prod",
      provider_id: "gemini",
      status: "ACTIVE",
      priority: 1,
      default_model: "gemini-pro",
      temperature: 0.7,
      max_tokens: 2048,
      timeout_ms: 30000,
      retry_count: 3,
      last_request_at: "2026-10-17T00:00:00Z",
      last_error: "timeout",
      organization_id: "org-a",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-10-17T00:00:00Z",
    };

    const payload = buildProviderUpdatePayload(formData);

    assert.deepEqual(payload, {
      name: "Gemini Prod",
      provider_id: "gemini",
      status: "ACTIVE",
      priority: 1,
      default_model: "gemini-pro",
      temperature: 0.7,
      max_tokens: 2048,
      timeout_ms: 30000,
      retry_count: 3,
      last_request_at: "2026-10-17T00:00:00Z",
      last_error: "timeout",
    });
  });

  test("the resulting payload's keys are an exact match for harden_ai_providers_credentials.sql's real UPDATE grant column list, read from disk", () => {
    const formData = {
      id: "provider-1",
      name: "X",
      provider_id: "gemini",
      status: "ACTIVE",
      priority: 0,
      default_model: "m",
      temperature: 0.5,
      max_tokens: 1,
      timeout_ms: 1,
      retry_count: 1,
      last_request_at: null,
      last_error: null,
      organization_id: "org-a",
      created_at: "t",
      updated_at: "t",
      api_key: "sk-not-real",
    };

    const payload = buildProviderUpdatePayload(formData);
    const expectedUpdateGrantColumns = readUpdateGrantColumnsFromMigration();

    assert.deepEqual(Object.keys(payload).sort(), [...expectedUpdateGrantColumns].sort());
  });

  test("readUpdateGrantColumnsFromMigration itself parses a non-empty column list from the real migration file", () => {
    const columns = readUpdateGrantColumnsFromMigration();
    assert.ok(columns.length > 0, "the parser must never silently return an empty list");
    assert.ok(!columns.includes("api_key"), "api_key must never appear in the UPDATE grant");
  });
});
