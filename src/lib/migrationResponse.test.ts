import { test } from "node:test";
import assert from "node:assert/strict";
import { interpretMigrationResponse } from "./migrationResponse.ts";

test("404 with an empty body is reported as disabled, not parsed as an error", () => {
  const result = interpretMigrationResponse(404, false, null);
  assert.equal(result.disabled, true);
  assert.match(result.error!, /disabled in this environment/);
});

test("500 with a valid JSON error body surfaces the server-provided message", () => {
  const result = interpretMigrationResponse(500, false, { error: "schema execution failed: relation already exists" });
  assert.equal(result.error, "schema execution failed: relation already exists");
  assert.equal(result.disabled, undefined);
});

test("a non-404 failure with no parsed body falls back to a status-based message", () => {
  const result = interpretMigrationResponse(502, false, null);
  assert.equal(result.error, "Migration request failed (HTTP 502).");
});

test("a successful 200 JSON response passes through unchanged", () => {
  const data = { success: true, message: "Database schema synchronized successfully!" };
  const result = interpretMigrationResponse(200, true, data);
  assert.deepEqual(result, data);
});

test("a 200 response whose body failed to parse is still treated as a failure, not a false success", () => {
  const result = interpretMigrationResponse(200, true, null);
  assert.equal(result.success, undefined);
  assert.match(result.error!, /HTTP 200/);
});
