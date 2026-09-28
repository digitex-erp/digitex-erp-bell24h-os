/**
 * Platform-certification fixes in this sprint:
 *  (1) Knowledge Vault "Could not load documents": vault health reports the REAL reason per table.
 *  (2) Admin Diagnostics "Direct DB Connection (Admin) — unauthenticated": the diagnostic DB routes are
 *      ADMIN-gated on the server (they read auth.users), and the browser now sends its session.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type pg from "pg";
import { checkVaultTables, vaultRemedy, VAULT_TABLES, type PostgrestFetcher } from "../../lib/vaultHealth.js";
import { requireAnyRole } from "../rbac.js";
import { createTestDb, seedOrg, seedUser, type TestDb } from "./helpers/testDb.js";
import { authenticate, silenceAudit } from "./helpers/httpHarness.js";

class Rest extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

describe("vault health — the real reason reaches the operator", () => {
  it("all tables readable -> ok, no remedy; one request per table, as the caller, minimal projection", async () => {
    const seen: string[] = [];
    const tokens = new Set<string>();
    const fetcher: PostgrestFetcher = async (token, q) => {
      tokens.add(token);
      seen.push(q);
      return [];
    };
    const rows = await checkVaultTables("caller-token", fetcher);
    assert.equal(rows.length, VAULT_TABLES.length);
    assert.ok(rows.every((r) => r.ok));
    assert.equal(vaultRemedy(rows), null);
    assert.deepEqual([...tokens], ["caller-token"], "the caller's own token is used, never a service key");
    assert.deepEqual(seen.sort(), VAULT_TABLES.map((t) => `${t}?select=id&limit=1`).sort());
  });

  it("a missing table is classified table_missing and the remedy names the migration file", async () => {
    const fetcher: PostgrestFetcher = async (_t, q) => {
      if (q.startsWith("vault_documents")) throw new Rest(404, "PostgREST request failed (404): {\"code\":\"PGRST205\",\"message\":\"Could not find the table 'public.vault_documents' in the schema cache\"}");
      return [];
    };
    const rows = await checkVaultTables("t", fetcher);
    const bad = rows.filter((r) => !r.ok);
    assert.equal(bad.length, 1);
    assert.deepEqual([bad[0].table, bad[0].reason, bad[0].status], ["vault_documents", "table_missing", 404]);
    assert.match(bad[0].detail!, /PGRST205/);
    assert.match(vaultRemedy(rows)!, /add_knowledge_vault\.sql/);
  });

  it("classifies permission problems, unconfigured servers and unknown upstream errors", async () => {
    const mk = (status: number, msg: string) => async () => {
      throw new Rest(status, msg);
    };
    const one = async (f: PostgrestFetcher) => (await checkVaultTables("t", f))[0];
    assert.equal((await one(mk(401, "PostgREST request failed (401): JWT expired"))).reason, "permission_denied");
    assert.equal((await one(mk(403, "PostgREST request failed (403): {\"code\":\"42501\",\"message\":\"permission denied for table vault_documents\"}"))).reason, "permission_denied");
    assert.equal((await one(mk(503, "Supabase server configuration missing (SUPABASE_URL / SUPABASE_ANON_KEY)."))).reason, "server_unconfigured");
    assert.equal((await one(mk(500, "PostgREST request failed (500): boom"))).reason, "upstream_error");
    assert.match(vaultRemedy(await checkVaultTables("t", mk(403, "42501")))!, /GRANT SELECT|RLS/);
    assert.match(vaultRemedy(await checkVaultTables("t", mk(503, "configuration missing")))!, /SUPABASE_URL/);
  });

  it("never throws, and never reports a failure as ok (non-HTTP errors included), with the detail capped", async () => {
    const rows = await checkVaultTables("t", async () => {
      throw new Error("x".repeat(5000));
    });
    assert.ok(rows.every((r) => !r.ok && r.reason === "upstream_error"));
    assert.ok(rows.every((r) => (r.detail ?? "").length <= 400));
  });
});

describe("ADMIN gate for the diagnostic DB routes", () => {
  let t: TestDb;
  let server: Server;
  let base: string;
  let unmute: () => void;
  let orgA: string;
  const U: Record<string, string> = {};
  const auditLines: string[] = [];
  const realLog = console.log;

  const call = async (who: string | null, pool?: pg.Pool) => {
    const headers: Record<string, string> = {};
    if (who) {
      headers["x-test-user"] = U[who];
      headers["x-test-org"] = orgA;
    }
    const r = await fetch(`${base}/api/check-table`, { headers });
    return { status: r.status, json: await r.json().catch(() => null) };
  };

  before(async () => {
    unmute = silenceAudit();
    console.log = (...a: unknown[]) => {
      if (typeof a[0] === "string" && a[0].startsWith('{"kind":"audit"')) auditLines.push(a[0]);
    };
    t = await createTestDb();
    orgA = await seedOrg(t.db, "A");
    U.admin = await seedUser(t.db, orgA, ["ADMIN"]);
    U.manager = await seedUser(t.db, orgA, ["MANAGER"]);
    U.viewer = await seedUser(t.db, orgA, ["VIEWER"]);
    U.norole = await seedUser(t.db, orgA, []);
    const app = express();
    // Same wiring as server.ts: requireAuth (stubbed) -> ADMIN gate -> handler
    app.get("/api/check-table", authenticate, requireAnyRole(() => t.pool, ["ADMIN"], "diagnostics"), (_req, res) => res.json({ success: true }));
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => {
    console.log = realLog;
    unmute();
    await new Promise<void>((r) => server.close(() => r()));
    await t.db.close();
  });

  it("no session -> 401; ADMIN -> 200; MANAGER / VIEWER / role-less -> 403", async () => {
    assert.equal((await call(null)).status, 401);
    assert.equal((await call("admin")).status, 200);
    for (const who of ["manager", "viewer", "norole"]) {
      const r = await call(who);
      assert.equal(r.status, 403, who);
      assert.equal(r.json.error, "forbidden");
    }
  });

  it("a denial is audited with the 'diagnostics' permission label", async () => {
    auditLines.length = 0;
    await call("viewer");
    const e = JSON.parse(auditLines.find((l) => l.includes("communication.authorize"))!);
    assert.deepEqual([e.outcome, e.metadata.permission, e.actor], ["denied", "diagnostics", U.viewer]);
  });

  it("fails CLOSED when the role lookup itself errors (503)", async () => {
    const broken = {
      query: () => Promise.reject(new Error("db down")),
      connect: () => Promise.reject(new Error("db down")),
    } as unknown as pg.Pool;
    const app = express();
    app.get("/x", authenticate, requireAnyRole(() => broken, ["ADMIN"], "diagnostics"), (_q, r) => r.json({ ok: true }));
    const s: Server = await new Promise((res) => {
      const srv = app.listen(0, "127.0.0.1", () => res(srv));
    });
    try {
      const r = await fetch(`http://127.0.0.1:${(s.address() as AddressInfo).port}/x`, { headers: { "x-test-user": U.admin, "x-test-org": orgA } });
      assert.equal(r.status, 503);
    } finally {
      await new Promise<void>((res) => s.close(() => res()));
    }
  });

  it("REGRESSION GUARD: server.ts really gates the diagnostic DB routes and exposes vault health", () => {
    const src = fs.readFileSync(path.resolve(import.meta.dirname, "..", "..", "..", "server.ts"), "utf8");
    assert.match(src, /app\.get\("\/api\/check-table", requireAuth, requireAnyRole\(getPool, \["ADMIN"\], "diagnostics"\)/);
    assert.match(src, /app\.get\("\/api\/check-users-count", requireAuth, requireAnyRole\(getPool, \["ADMIN"\], "diagnostics"\)/);
    assert.match(src, /app\.get\("\/api\/vault\/health", requireAuth,/);
  });

  it("REGRESSION GUARD: the diagnostics page sends the session (no bare fetch to the protected routes)", () => {
    const page = fs.readFileSync(path.resolve(import.meta.dirname, "..", "..", "..", "src", "pages", "SystemDiagnosticsPage.tsx"), "utf8");
    for (const route of ["/api/check-table", "/api/check-users-count", "/api/vault/health"]) {
      assert.ok(!new RegExp(`\\bfetch\\(['"\`]${route}`).test(page), `bare fetch() to ${route}`);
      assert.ok(page.includes(`authedFetchJson<any>('${route}')`), `authedFetchJson for ${route}`);
    }
  });
});
