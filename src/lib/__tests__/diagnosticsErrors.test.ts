import { describe, it } from "node:test";
import assert from "node:assert/strict";
// Same shape as AuthedFetchError (an Error with a numeric status) without importing the Supabase client.
class AuthedFetchError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
import { diagnosticError, vaultLoadError } from "../diagnosticsErrors.js";

describe("diagnosticError — 'unauthenticated' must not be reported as a database failure", () => {
  it("401 -> a warning that says to sign in (never a hard failure, never the raw code)", () => {
    const r = diagnosticError(new AuthedFetchError(401, "unauthenticated"));
    assert.equal(r.status, "warn");
    assert.match(r.message, /Sign in/);
    assert.ok(!r.message.includes("unauthenticated"));
  });
  it("403 -> a failure that names the ADMIN requirement", () => {
    const r = diagnosticError(new AuthedFetchError(403, "forbidden"));
    assert.deepEqual([r.status, /ADMIN/.test(r.message)], ["fail", true]);
  });
  it("503 and other statuses keep the server's reason", () => {
    assert.match(diagnosticError(new AuthedFetchError(503, "authorization_unavailable")).message, /authorization_unavailable/);
    assert.equal(diagnosticError(new AuthedFetchError(500, "relation does not exist")).message, "relation does not exist");
  });
  it("a non-HTTP error is a failure with its own message", () => {
    assert.deepEqual(diagnosticError(new Error("network down")), { status: "fail", message: "network down" });
    assert.equal(diagnosticError("weird").status, "fail");
  });
  it("never returns 'pass'", () => {
    for (const e of [new AuthedFetchError(401, "x"), new AuthedFetchError(403, "x"), new AuthedFetchError(500, "x"), new Error("x"), null]) {
      assert.notEqual((diagnosticError(e) as { status: string }).status, "pass");
    }
  });
});

describe("vaultLoadError — the real cause must reach the screen", () => {
  it("401 keeps the session message", () => {
    assert.match(vaultLoadError(new AuthedFetchError(401, "unauthenticated"), "documents"), /session could not be verified/);
  });
  it("a missing table surfaces the server's PostgREST reason and points at diagnostics", () => {
    const msg = vaultLoadError(new AuthedFetchError(404, "PostgREST request failed (404): PGRST205 Could not find the table 'public.vault_documents'"), "documents");
    assert.match(msg, /Could not load documents \(HTTP 404/);
    assert.match(msg, /PGRST205/);
    assert.match(msg, /System Diagnostics/);
  });
  it("no server detail -> still states the HTTP status", () => {
    assert.match(vaultLoadError(new AuthedFetchError(500, "Request failed (500)"), "the roadmap"), /Could not load the roadmap \(HTTP 500\)\. Open System/);
  });
  it("non-HTTP errors are shown, not hidden", () => {
    assert.match(vaultLoadError(new Error("Failed to fetch"), "phases"), /Could not load phases: Failed to fetch/);
  });
});
