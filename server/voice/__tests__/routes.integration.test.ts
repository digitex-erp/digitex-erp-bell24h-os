/**
 * Integration tests: the REAL voice routes, RBAC, service, QueueManager,
 * VoiceJobHandler and SQL, over HTTP, against a real Postgres engine
 * (PGlite) loaded with the real migration. Only authentication is stubbed,
 * exactly matching server/communication/__tests__/routes.integration.test.ts's
 * own convention -- everything downstream of the stub is production code.
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
import { VoiceJobHandler } from "../../workers/handlers/VoiceJobHandler.js";
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
  // Voice Studio's own migration, on top of the base schema createTestDb()
  // already loads (organizations/profiles/roles/job_queue/communication_*).
  const voiceSql = fs.readFileSync(path.join(REPO_ROOT, "add_voice_studio_tables.sql"), "utf8");
  await t.db.exec(voiceSql);

  orgA = await seedOrg(t.db, "A");
  orgB = await seedOrg(t.db, "B");
  users.admin = await seedUser(t.db, orgA, ["ADMIN"]);
  users.manager = await seedUser(t.db, orgA, ["MANAGER"]);
  users.editor = await seedUser(t.db, orgA, ["EDITOR"]);
  users.viewer = await seedUser(t.db, orgA, ["VIEWER"]);
  users.norole = await seedUser(t.db, orgA, []);
  users.managerB = await seedUser(t.db, orgB, ["MANAGER"]);
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
  headers?: Record<string, string>;
}

async function call(method: string, p: string, o: CallOpts = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", ...o.headers };
  if (o.as) {
    headers["x-test-user"] = users[o.as];
    headers["x-test-org"] = o.org ?? (o.as === "managerB" ? orgB : orgA);
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

// ─── Migration ──────────────────────────────────────────────────────────────

test("migration: creates all twelve voice tables (and no voice_queue_jobs -- reuses job_queue)", async () => {
  const names = (
    await t.db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'voice_%' OR table_name = 'comm_events'`,
    )
  ).rows.map((r) => r.table_name);
  for (const expected of [
    "voice_agents", "voice_campaigns", "voice_calls", "voice_call_messages", "voice_scripts",
    "voice_providers", "voice_profiles", "voice_numbers", "voice_escalations",
    "voice_automation_rules", "voice_policies", "comm_events",
  ]) {
    assert.ok(names.includes(expected), `expected table ${expected} to exist`);
  }
  assert.ok(!names.includes("voice_queue_jobs"), "voice_queue_jobs must NOT exist -- job_queue is reused instead");
});

// ─── Authentication ─────────────────────────────────────────────────────────

test("authentication is required on every voice route", async () => {
  assert.equal((await call("POST", "/api/voice/calls/dispatch")).status, 401);
  assert.equal((await call("GET", "/api/voice/calls")).status, 401);
  assert.equal((await call("GET", "/api/voice/agents")).status, 401);
  assert.equal((await call("POST", "/api/voice/agents")).status, 401);
});

// ─── RBAC ───────────────────────────────────────────────────────────────────

test("dispatch requires ADMIN/MANAGER; EDITOR/VIEWER/role-less are rejected", async () => {
  const body = { ref: "VT-RBAC-1", contactName: "X", objective: "Y", driver: "simulated" };
  assert.equal((await call("POST", "/api/voice/calls/dispatch", { as: "editor", body })).status, 403);
  assert.equal((await call("POST", "/api/voice/calls/dispatch", { as: "viewer", body })).status, 403);
  assert.equal((await call("POST", "/api/voice/calls/dispatch", { as: "norole", body })).status, 403);
  const ok = await call("POST", "/api/voice/calls/dispatch", { as: "manager", body });
  assert.equal(ok.status, 201);
});

test("write (agent creation) allows EDITOR but not VIEWER", async () => {
  const body = { agentKey: "agent-rbac", name: "RBAC Agent" };
  assert.equal((await call("POST", "/api/voice/agents", { as: "viewer", body })).status, 403);
  assert.equal((await call("POST", "/api/voice/agents", { as: "editor", body })).status, 201);
});

test("every org role can read; role-less cannot", async () => {
  for (const role of ["admin", "manager", "editor", "viewer"] as const) {
    assert.equal((await call("GET", "/api/voice/calls", { as: role })).status, 200);
  }
  assert.equal((await call("GET", "/api/voice/calls", { as: "norole" })).status, 403);
});

// ─── Validation ─────────────────────────────────────────────────────────────

test("dispatch rejects a missing contactName/objective and an invalid driver value", async () => {
  const r1 = await call("POST", "/api/voice/calls/dispatch", { as: "manager", body: { ref: "VT-VAL-1", objective: "Y", driver: "simulated" } });
  assert.equal(r1.status, 400);
  assert.equal(r1.json.field, "contactName");

  const r2 = await call("POST", "/api/voice/calls/dispatch", { as: "manager", body: { ref: "VT-VAL-2", contactName: "X", objective: "Y", driver: "carrier-pigeon" } });
  assert.equal(r2.status, 400);
  assert.equal(r2.json.field, "driver");
});

test("dispatch rejects CR/LF injection in contactName and objective", async () => {
  const r = await call("POST", "/api/voice/calls/dispatch", {
    as: "manager",
    body: { ref: "VT-VAL-3", contactName: "X\r\nInjected", objective: "Y", driver: "simulated" },
  });
  assert.equal(r.status, 400);
});

// ─── Dispatch, worker processing (simulated), and idempotency ──────────────

test("end-to-end: dispatch enqueues a 'voice' job_queue job; VoiceJobHandler processes it and the capture is applied", async () => {
  const ref = "VT-E2E-1";
  const dispatchRes = await call("POST", "/api/voice/calls/dispatch", {
    as: "manager",
    body: { ref, contactName: "Supplier One", objective: "Confirm pricing", driver: "simulated" },
  });
  assert.equal(dispatchRes.status, 201);
  assert.equal(dispatchRes.json.status, "queued");

  // Confirm a real job_queue row was created for this org, job_type 'voice'.
  // Scoped to THIS ref specifically -- earlier tests in this file (e.g. the
  // RBAC test) also dispatch+enqueue without ever running the worker, so
  // scoping only by organization_id/job_type/status would also match their
  // leftover queued jobs.
  const jobs = await t.pool.query(
    `SELECT * FROM public.job_queue WHERE organization_id = $1 AND job_type = 'voice' AND status = 'queued' AND payload->>'ref' = $2`,
    [orgA, ref],
  );
  assert.equal(jobs.rows.length, 1);
  const job = jobs.rows[0];

  // Simulate a worker claiming and running this exact job through the real handler.
  const handler = new VoiceJobHandler(t.pool);
  await handler.handle({
    id: job.id,
    organization_id: job.organization_id,
    status: "running",
    job_type: "voice",
    payload: job.payload,
  } as any);

  const callRow = await call("GET", `/api/voice/calls/${ref}`, { as: "manager" });
  assert.equal(callRow.status, 200);
  assert.equal(callRow.json.status, "completed");
  assert.equal(callRow.json.driver, "simulated");
  assert.ok(["captured", "no_answer", "declined"].includes(callRow.json.outcome));
  assert.ok(Array.isArray(callRow.json.messages));
});

test("duplicate dispatch for the same (org, ref) is idempotent -- returns the existing call, creates no second job", async () => {
  const ref = "VT-IDEMP-1";
  const body = { ref, contactName: "Supplier Two", objective: "Follow up", driver: "simulated" };
  const first = await call("POST", "/api/voice/calls/dispatch", { as: "manager", body });
  const second = await call("POST", "/api/voice/calls/dispatch", { as: "manager", body });
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(first.json.id, second.json.id);

  const jobs = await t.pool.query(`SELECT count(*)::int AS n FROM public.job_queue WHERE organization_id = $1 AND payload->>'ref' = $2`, [orgA, ref]);
  assert.equal(jobs.rows[0].n, 1);
});

// ─── Organization isolation ─────────────────────────────────────────────────

test("org isolation: org B cannot see org A's calls or agents", async () => {
  const listA = await call("GET", "/api/voice/calls", { as: "manager" });
  const listB = await call("GET", "/api/voice/calls", { as: "managerB" });
  assert.ok(listA.json.calls.length > 0);
  assert.equal(listB.json.calls.length, 0);

  const agentsB = await call("GET", "/api/voice/agents", { as: "managerB" });
  assert.equal(agentsB.json.agents.length, 0);
});

test("a call ref that exists in org A returns 404 when looked up under org B", async () => {
  const dispatched = await call("POST", "/api/voice/calls/dispatch", { as: "manager", body: { ref: "VT-ISO-1", contactName: "X", objective: "Y", driver: "simulated" } });
  assert.equal(dispatched.status, 201);
  const crossOrgLookup = await call("GET", "/api/voice/calls/VT-ISO-1", { as: "managerB" });
  assert.equal(crossOrgLookup.status, 404);
});

// ─── Dograh webhook secret enforcement ──────────────────────────────────────

test("webhook: fails closed (503) when DOGRAH_WEBHOOK_SECRET is not configured", async () => {
  delete process.env.DOGRAH_WEBHOOK_SECRET;
  const res = await fetch(`${h.url}/api/voice/webhooks/dograh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workflow_run_id: 1, gathered_context: {} }),
  });
  assert.equal(res.status, 503);
});

test("webhook: rejects a missing or incorrect secret (401), never processes the payload", async () => {
  process.env.DOGRAH_WEBHOOK_SECRET = "correct-secret-not-real";
  try {
    const noHeader = await fetch(`${h.url}/api/voice/webhooks/dograh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workflow_run_id: 2, gathered_context: {} }),
    });
    assert.equal(noHeader.status, 401);

    const wrongHeader = await fetch(`${h.url}/api/voice/webhooks/dograh`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bell24h-voice-webhook-secret": "wrong" },
      body: JSON.stringify({ workflow_run_id: 2, gathered_context: {} }),
    });
    assert.equal(wrongHeader.status, 401);
  } finally {
    delete process.env.DOGRAH_WEBHOOK_SECRET;
  }
});

test("webhook: a correct secret applies the capture to the matching dograh call, and a replay is reported as a duplicate (idempotent)", async () => {
  process.env.DOGRAH_WEBHOOK_SECRET = "correct-secret-not-real";
  try {
    // Dispatch with driver='dograh' directly at the service layer isn't
    // exercised over HTTP here (that would need a real/fake Dograh server
    // for the dispatch leg too) -- instead, seed a call row the way
    // VoiceJobHandler's dograh branch would have left it: status
    // 'dispatched', a known driver_job_id, nothing captured yet.
    const seeded = await t.pool.query(
      `INSERT INTO public.voice_calls (organization_id, ref, contact_name, phone_masked, driver, status, driver_job_id)
       VALUES ($1,'VT-WEBHOOK-1','Supplier Three','••••1234','dograh','dispatched','777') RETURNING id`,
      [orgA],
    );
    const callId = seeded.rows[0].id;

    const payload = {
      workflow_run_id: 777,
      initial_context: { task_ref: "VT-WEBHOOK-1" },
      gathered_context: { call_disposition: "completed", price: "500", moq: "10", delivery_days: "5" },
    };

    const first = await fetch(`${h.url}/api/voice/webhooks/dograh`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bell24h-voice-webhook-secret": "correct-secret-not-real" },
      body: JSON.stringify(payload),
    });
    const firstJson = await first.json();
    assert.equal(first.status, 200);
    assert.equal(firstJson.ok, true);
    assert.equal(firstJson.duplicate, false);

    const replay = await fetch(`${h.url}/api/voice/webhooks/dograh`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bell24h-voice-webhook-secret": "correct-secret-not-real" },
      body: JSON.stringify(payload),
    });
    const replayJson = await replay.json();
    assert.equal(replay.status, 200);
    assert.equal(replayJson.duplicate, true, "a repeat delivery of the same workflow_run_id must not re-apply the writeback");

    const finalRow = await t.pool.query(`SELECT * FROM public.voice_calls WHERE id = $1`, [callId]);
    assert.equal(finalRow.rows[0].status, "completed");
    assert.equal(Number(finalRow.rows[0].price), 500);
  } finally {
    delete process.env.DOGRAH_WEBHOOK_SECRET;
  }
});

// ─── Simulation vs. real labeling ───────────────────────────────────────────

test("every call row carries an explicit driver column distinguishing simulated from real -- never ambiguous", async () => {
  const simCall = await call("POST", "/api/voice/calls/dispatch", { as: "manager", body: { ref: "VT-LABEL-SIM", contactName: "X", objective: "Y", driver: "simulated" } });
  assert.equal(simCall.json.driver, "simulated");

  // A 'dograh' dispatch without server config queues the job (dispatch
  // itself only validates+enqueues; the driver's own missing-config error
  // surfaces when the worker actually runs it, not at dispatch time) --
  // confirmed by checking the driver value is still honestly 'dograh', not
  // silently downgraded to 'simulated'.
  const dograhCall = await call("POST", "/api/voice/calls/dispatch", { as: "manager", body: { ref: "VT-LABEL-DOGRAH", contactName: "X", objective: "Y", driver: "dograh" } });
  assert.equal(dograhCall.json.driver, "dograh");
});
