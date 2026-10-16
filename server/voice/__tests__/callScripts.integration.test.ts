/**
 * Call Scripts integration tests: the REAL voice routes, RBAC, service, and
 * SQL, over HTTP, against a real Postgres engine (PGlite) loaded with the
 * real migration -- same harness convention as
 * routes.integration.test.ts and server/communication's own integration
 * tests. Only authentication is stubbed.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express, { type RequestHandler } from "express";
import type pg from "pg";
import type { AuthedRequest } from "../../middleware/requireAuth.js";
import { registerVoiceRoutes } from "../routes.js";
import { createTestDb, seedOrg, seedUser, type TestDb } from "../../communication/__tests__/helpers/testDb.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

let t: TestDb;
let orgA: string;
let orgB: string;
const users: Record<string, string> = {};
let h: Harness;

const realLog = console.log;
before(async () => {
  console.log = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith('{"kind":"audit"')) return;
    realLog(...args);
  };
  t = await createTestDb();
  const voiceSql = fs.readFileSync(path.join(REPO_ROOT, "add_voice_studio_tables.sql"), "utf8");
  await t.db.exec(voiceSql);

  orgA = await seedOrg(t.db, "A");
  orgB = await seedOrg(t.db, "B");
  users.admin = await seedUser(t.db, orgA, ["ADMIN"]);
  users.editor = await seedUser(t.db, orgA, ["EDITOR"]);
  users.viewer = await seedUser(t.db, orgA, ["VIEWER"]);
  users.norole = await seedUser(t.db, orgA, []);
  users.editorB = await seedUser(t.db, orgB, ["EDITOR"]);
  h = await serve(t.pool);
});
after(async () => {
  console.log = realLog;
  await h.close();
  await t.db.close();
});

const authenticate: RequestHandler = (req, res, next) => {
  const userId = req.header("x-test-user");
  const organizationId = req.header("x-test-org");
  if (!userId || !organizationId) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  (req as AuthedRequest).auth = { userId, organizationId, token: "test" };
  (req as AuthedRequest).requestId = "req-test";
  next();
};

interface Harness {
  url: string;
  close: () => Promise<void>;
}

async function serve(pool: pg.Pool): Promise<Harness> {
  const app = express();
  app.use(express.json());
  registerVoiceRoutes(app, { getPool: () => pool, authenticate });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

interface CallOpts {
  as?: keyof typeof users | null;
  org?: string;
  body?: unknown;
}

async function call(method: string, p: string, o: CallOpts = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (o.as) {
    headers["x-test-user"] = users[o.as];
    headers["x-test-org"] = o.org ?? (o.as === "editorB" ? orgB : orgA);
  }
  const res = await fetch(`${h.url}${p}`, {
    method,
    headers,
    body: o.body === undefined || method === "GET" ? undefined : JSON.stringify(o.body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON response, leave json null */
  }
  return { status: res.status, json };
}

const baseScript = {
  code: "rfq-followup-v1",
  name: "RFQ Follow-up",
  language: "en-IN",
  tone: "professional",
  variables: ["buyer_name", "supplier_name", "rfq_number", "price"],
  opening: "Hello {{supplier_name}}, this is {{buyer_name}} following up on {{rfq_number}}.",
  verification: "Can you confirm you are the contact for {{supplier_name}}?",
  purpose: "We would like to confirm pricing.",
  questions: "What is your best price for this order?",
  objections: "I understand cost is a concern.",
  negotiation: "Our target price is {{price}}.",
  closing: "Thank you for your time.",
  escalation: "I will escalate this to a human representative.",
  fallback: "Let me have someone call you back.",
};

// ─── Migration ──────────────────────────────────────────────────────────────

test("migration: creates voice_script_versions (additive, alongside voice_scripts)", async () => {
  const names = (
    await t.db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('voice_scripts','voice_script_versions')`,
    )
  ).rows.map((r) => r.table_name);
  assert.ok(names.includes("voice_scripts"));
  assert.ok(names.includes("voice_script_versions"));
});

// ─── Authentication ─────────────────────────────────────────────────────────

test("authentication is required on every script route", async () => {
  assert.equal((await call("GET", "/api/voice/scripts")).status, 401);
  assert.equal((await call("POST", "/api/voice/scripts")).status, 401);
  assert.equal((await call("GET", "/api/voice/scripts/x")).status, 401);
  assert.equal((await call("PATCH", "/api/voice/scripts/x")).status, 401);
  assert.equal((await call("POST", "/api/voice/scripts/x/duplicate")).status, 401);
  assert.equal((await call("POST", "/api/voice/scripts/x/publish")).status, 401);
  assert.equal((await call("POST", "/api/voice/scripts/x/preview")).status, 401);
});

// ─── RBAC ───────────────────────────────────────────────────────────────────

test("write operations require EDITOR+; VIEWER and role-less are rejected", async () => {
  assert.equal((await call("POST", "/api/voice/scripts", { as: "viewer", body: baseScript })).status, 403);
  assert.equal((await call("POST", "/api/voice/scripts", { as: "norole", body: baseScript })).status, 403);
  const ok = await call("POST", "/api/voice/scripts", { as: "editor", body: baseScript });
  assert.equal(ok.status, 201);
});

test("read operations allow every org role; role-less is rejected", async () => {
  for (const role of ["admin", "editor", "viewer"] as const) {
    assert.equal((await call("GET", "/api/voice/scripts", { as: role })).status, 200);
  }
  assert.equal((await call("GET", "/api/voice/scripts", { as: "norole" })).status, 403);
});

// ─── CRUD + validation ──────────────────────────────────────────────────────

test("create rejects a missing name and an undeclared {{variable}}", async () => {
  const noName = await call("POST", "/api/voice/scripts", {
    as: "editor",
    body: { ...baseScript, code: "val-1", name: "" },
  });
  assert.equal(noName.status, 400);
  assert.equal(noName.json.field, "name");

  const undeclared = await call("POST", "/api/voice/scripts", {
    as: "editor",
    body: { ...baseScript, code: "val-2", opening: "Hi {{buyer_name}}, your {{secret_field}} is ready." },
  });
  assert.equal(undeclared.status, 400);
  assert.equal(undeclared.json.field, "variables");
});

test("create rejects an unknown declared variable name", async () => {
  const r = await call("POST", "/api/voice/scripts", {
    as: "editor",
    body: { ...baseScript, code: "val-3", variables: ["buyer_name", "not_a_real_variable"] },
  });
  assert.equal(r.status, 400);
  assert.equal(r.json.field, "variables");
});

test("create rejects a duplicate code for the same organization (409)", async () => {
  const first = await call("POST", "/api/voice/scripts", { as: "editor", body: { ...baseScript, code: "dup-code-1" } });
  assert.equal(first.status, 201);
  const second = await call("POST", "/api/voice/scripts", { as: "editor", body: { ...baseScript, code: "dup-code-1" } });
  assert.equal(second.status, 409);
});

test("get returns the full script with sections and an empty version history before any publish", async () => {
  await call("POST", "/api/voice/scripts", { as: "editor", body: { ...baseScript, code: "get-1" } });
  const r = await call("GET", "/api/voice/scripts/get-1", { as: "viewer" });
  assert.equal(r.status, 200);
  assert.equal(r.json.status, "draft");
  assert.equal(r.json.version, 0);
  assert.deepEqual(r.json.versions, []);
  assert.equal(r.json.opening, baseScript.opening);
});

test("get returns 404 for a code that does not exist in this organization", async () => {
  const r = await call("GET", "/api/voice/scripts/does-not-exist", { as: "viewer" });
  assert.equal(r.status, 404);
});

// ─── Draft / published state machine and versioning ────────────────────────

test("publish snapshots version 1, flips status to published; editing afterward reverts to draft; publishing again creates version 2", async () => {
  await call("POST", "/api/voice/scripts", { as: "editor", body: { ...baseScript, code: "lifecycle-1" } });

  const firstPublish = await call("POST", "/api/voice/scripts/lifecycle-1/publish", { as: "editor" });
  assert.equal(firstPublish.status, 200);
  assert.equal(firstPublish.json.published, true);
  assert.equal(firstPublish.json.status, "published");
  assert.equal(firstPublish.json.version, 1);

  const afterPublish = await call("GET", "/api/voice/scripts/lifecycle-1", { as: "viewer" });
  assert.equal(afterPublish.json.versions.length, 1);
  assert.equal(afterPublish.json.versions[0].version, 1);

  // Re-publishing with no changes is a no-op, not a second snapshot.
  const noopPublish = await call("POST", "/api/voice/scripts/lifecycle-1/publish", { as: "editor" });
  assert.equal(noopPublish.status, 200);
  assert.equal(noopPublish.json.published, false);

  const edited = await call("PATCH", "/api/voice/scripts/lifecycle-1", {
    as: "editor",
    body: { closing: "An updated closing line." },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.json.status, "draft", "editing published content must revert status to draft");

  const secondPublish = await call("POST", "/api/voice/scripts/lifecycle-1/publish", { as: "editor" });
  assert.equal(secondPublish.status, 200);
  assert.equal(secondPublish.json.version, 2);

  const final = await call("GET", "/api/voice/scripts/lifecycle-1", { as: "viewer" });
  assert.equal(final.json.versions.length, 2);
  assert.equal(final.json.closing, "An updated closing line.");
});

test("an archived script cannot be edited or published (409)", async () => {
  await call("POST", "/api/voice/scripts", { as: "editor", body: { ...baseScript, code: "archived-1" } });
  // No route exposes archiving in this batch (deliberately out of the
  // required operation list) -- seed the state directly to exercise the
  // service-layer guard.
  await t.pool.query(`UPDATE public.voice_scripts SET status = 'archived' WHERE organization_id = $1 AND code = $2`, [
    orgA,
    "archived-1",
  ]);

  const edit = await call("PATCH", "/api/voice/scripts/archived-1", { as: "editor", body: { closing: "x" } });
  assert.equal(edit.status, 409);

  const publish = await call("POST", "/api/voice/scripts/archived-1/publish", { as: "editor" });
  assert.equal(publish.status, 409);
});

// ─── Duplicate ───────────────────────────────────────────────────────────────

test("duplicate creates a fresh draft (version 0) copying content, independent of the source's publish state", async () => {
  await call("POST", "/api/voice/scripts", { as: "editor", body: { ...baseScript, code: "src-1" } });
  await call("POST", "/api/voice/scripts/src-1/publish", { as: "editor" });

  const dup = await call("POST", "/api/voice/scripts/src-1/duplicate", { as: "editor", body: { newCode: "src-1-copy" } });
  assert.equal(dup.status, 201);
  assert.equal(dup.json.status, "draft");
  assert.equal(dup.json.version, 0);
  assert.equal(dup.json.opening, baseScript.opening);

  const dupDetail = await call("GET", "/api/voice/scripts/src-1-copy", { as: "viewer" });
  assert.deepEqual(dupDetail.json.versions, [], "a duplicate must not inherit the source's publish history");
});

test("duplicate rejects a newCode that already exists (409)", async () => {
  await call("POST", "/api/voice/scripts", { as: "editor", body: { ...baseScript, code: "src-2" } });
  await call("POST", "/api/voice/scripts", { as: "editor", body: { ...baseScript, code: "src-2-taken" } });
  const r = await call("POST", "/api/voice/scripts/src-2/duplicate", { as: "editor", body: { newCode: "src-2-taken" } });
  assert.equal(r.status, 409);
});

// ─── Preview ─────────────────────────────────────────────────────────────────

test("preview substitutes declared variables, escapes the substituted value, and never places a call", async () => {
  await call("POST", "/api/voice/scripts", { as: "editor", body: { ...baseScript, code: "preview-1" } });
  const r = await call("POST", "/api/voice/scripts/preview-1/preview", {
    as: "viewer",
    body: { sampleValues: { buyer_name: "Acme<script>", supplier_name: "Globex" } },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.preview, true);
  assert.match(r.json.disclaimer, /preview only/i);
  assert.ok(r.json.sections.opening.includes("Acme&lt;script&gt;"), "substituted value must be HTML-escaped");
  assert.ok(r.json.sections.opening.includes("Globex"));
  // price was declared but not supplied a sample -> bracketed placeholder, not blank.
  assert.ok(r.json.sections.negotiation.includes("[price]"));

  // Confirm no call-related side effect occurred.
  const calls = await t.pool.query(`SELECT count(*)::int AS n FROM public.voice_calls WHERE organization_id = $1`, [orgA]);
  const jobs = await t.pool.query(`SELECT count(*)::int AS n FROM public.job_queue WHERE organization_id = $1`, [orgA]);
  assert.equal(calls.rows[0].n, 0);
  assert.equal(jobs.rows[0].n, 0);
});

test("preview rejects an unknown sample variable name", async () => {
  await call("POST", "/api/voice/scripts", { as: "editor", body: { ...baseScript, code: "preview-2" } });
  const r = await call("POST", "/api/voice/scripts/preview-2/preview", {
    as: "viewer",
    body: { sampleValues: { not_allowed: "x" } },
  });
  assert.equal(r.status, 400);
});

// ─── Organization isolation ─────────────────────────────────────────────────

test("org isolation: org B cannot see, edit, publish, or duplicate org A's scripts", async () => {
  await call("POST", "/api/voice/scripts", { as: "editor", body: { ...baseScript, code: "iso-1" } });

  const listB = await call("GET", "/api/voice/scripts", { as: "editorB" });
  assert.equal(listB.json.scripts.length, 0);

  const getB = await call("GET", "/api/voice/scripts/iso-1", { as: "editorB" });
  assert.equal(getB.status, 404);

  const editB = await call("PATCH", "/api/voice/scripts/iso-1", { as: "editorB", body: { closing: "hijacked" } });
  assert.equal(editB.status, 404);

  const publishB = await call("POST", "/api/voice/scripts/iso-1/publish", { as: "editorB" });
  assert.equal(publishB.status, 404);

  const dupB = await call("POST", "/api/voice/scripts/iso-1/duplicate", { as: "editorB", body: { newCode: "iso-1-stolen" } });
  assert.equal(dupB.status, 404);
});
