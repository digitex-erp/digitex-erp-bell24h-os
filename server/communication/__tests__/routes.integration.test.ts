/**
 * Integration tests: the REAL routes, RBAC, rate limiter, service, QueueManager and SQL, over
 * HTTP, against a real Postgres engine (PGlite) loaded with the real migration.
 * Only authentication is stubbed (requireAuth verifies Supabase JWTs over the network); the stub
 * sets req.auth exactly as requireAuth does, so everything downstream is production code.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express, { type RequestHandler } from "express";
import type pg from "pg";
import type { AuthedRequest } from "../../middleware/requireAuth.js";
import { registerCommunicationRoutes } from "../routes.js";
import { CommunicationService } from "../CommunicationService.js";
import { createTestDb, seedOrg, seedUser, type TestDb } from "./helpers/testDb.js";

let t: TestDb;
let orgA: string;
let orgB: string;
const users: Record<string, string> = {};
let h: Harness;

const realLog = console.log;
before(async () => {
  // Audit events are JSON lines on stdout; keep test output readable.
  console.log = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith('{"kind":"audit"')) return;
    realLog(...args);
  };
  t = await createTestDb();
  orgA = await seedOrg(t.db, "A");
  orgB = await seedOrg(t.db, "B");
  users.admin = await seedUser(t.db, orgA, ["ADMIN"]);
  users.manager = await seedUser(t.db, orgA, ["MANAGER"]);
  users.manager2 = await seedUser(t.db, orgA, ["MANAGER"]);
  users.editor = await seedUser(t.db, orgA, ["EDITOR"]);
  users.viewer = await seedUser(t.db, orgA, ["VIEWER"]);
  users.norole = await seedUser(t.db, orgA, []);
  users.managerB = await seedUser(t.db, orgB, ["MANAGER"]);
  // A user who belongs to org A but whose ONLY role assignment is a role in org B.
  users.crossOrgRole = await seedUser(t.db, orgA, []);
  const roleB = (await t.db.query<{ id: string }>(`SELECT id FROM public.roles WHERE name='MANAGER' AND organization_id=$1`, [orgB])).rows[0].id;
  await t.db.query(`INSERT INTO public.user_roles (user_id, role_id, organization_id) VALUES ($1,$2,$3)`, [users.crossOrgRole, roleB, orgB]);
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

async function serve(pool: pg.Pool, limits?: { send?: number; retry?: number; write?: number }): Promise<Harness> {
  const app = express();
  app.use(express.json());
  registerCommunicationRoutes(app, { getPool: () => pool, authenticate, limits: { send: 1000, retry: 1000, write: 1000, ...limits } });
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
  key?: string | null;
  body?: unknown;
  headers?: Record<string, string>;
}

async function call(harness: Harness, method: string, path: string, o: CallOpts = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", ...o.headers };
  if (o.as) {
    headers["x-test-user"] = users[o.as];
    headers["x-test-org"] = o.org ?? (o.as === "managerB" ? orgB : orgA);
  }
  if (o.key) headers["Idempotency-Key"] = o.key;
  const res = await fetch(`${harness.url}${path}`, {
    method,
    headers,
    body: o.body === undefined || method === "GET" ? undefined : JSON.stringify(o.body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, text, headers: res.headers };
}

const newKey = () => `key-${randomUUID()}`;
const email = (extra: Record<string, unknown> = {}) => ({
  channelType: "email",
  recipient: "buyer@example.com",
  subject: "RFQ 42",
  body: "<p>Hello</p>",
  ...extra,
});
const count = async (sql: string, params: unknown[] = []) => (await t.db.query<{ n: number }>(sql, params)).rows[0].n;

describe("authentication is required on every route", () => {
  for (const [method, path] of [
    ["POST", "/api/communications/send"],
    ["GET", "/api/communications/templates"],
    ["POST", "/api/communications/templates"],
    ["GET", "/api/communications/history"],
    ["GET", `/api/communications/status/${randomUUID()}`],
    ["POST", `/api/communications/retry/${randomUUID()}`],
  ] as const) {
    it(`${method} ${path.replace(/[0-9a-f-]{36}/, ":id")} -> 401 without identity`, async () => {
      const r = await call(h, method, path, { as: null, key: newKey(), body: email() });
      assert.equal(r.status, 401);
    });
  }
});

describe("B3 — role-based access control", () => {
  it("MANAGER and ADMIN can send", async () => {
    for (const as of ["manager", "admin"] as const) {
      const r = await call(h, "POST", "/api/communications/send", { as, key: newKey(), body: email() });
      assert.equal(r.status, 201, `${as}: ${r.text}`);
    }
  });

  it("EDITOR, VIEWER, role-less users and users whose role belongs to ANOTHER org cannot send (403)", async () => {
    for (const as of ["editor", "viewer", "norole", "crossOrgRole"] as const) {
      const before = await count(`SELECT COUNT(*)::int AS n FROM public.communication_messages`);
      const r = await call(h, "POST", "/api/communications/send", { as, key: newKey(), body: email() });
      assert.equal(r.status, 403, `${as}: ${r.text}`);
      assert.equal(r.json.error, "forbidden");
      assert.equal(await count(`SELECT COUNT(*)::int AS n FROM public.communication_messages`), before, `${as} must not create a row`);
    }
  });

  it("template writes: ADMIN/MANAGER/EDITOR yes; VIEWER and role-less no", async () => {
    const tpl = { name: "t", channelType: "email", subject: "s", body: "b" };
    for (const as of ["admin", "manager", "editor"] as const) {
      assert.equal((await call(h, "POST", "/api/communications/templates", { as, body: tpl })).status, 201, as);
    }
    for (const as of ["viewer", "norole", "crossOrgRole"] as const) {
      assert.equal((await call(h, "POST", "/api/communications/templates", { as, body: tpl })).status, 403, as);
    }
  });

  it("reads: every org role can read; a role-less user cannot", async () => {
    for (const as of ["admin", "manager", "editor", "viewer"] as const) {
      assert.equal((await call(h, "GET", "/api/communications/history", { as })).status, 200, as);
      assert.equal((await call(h, "GET", "/api/communications/templates", { as })).status, 200, as);
    }
    assert.equal((await call(h, "GET", "/api/communications/history", { as: "norole" })).status, 403);
  });

  it("retry needs the send permission", async () => {
    const id = randomUUID();
    assert.equal((await call(h, "POST", `/api/communications/retry/${id}`, { as: "editor" })).status, 403);
    assert.equal((await call(h, "POST", `/api/communications/retry/${id}`, { as: "viewer" })).status, 403);
  });

  it("fails CLOSED when the role lookup errors (503, never allow)", async () => {
    const broken = {
      query: (text: string, params?: unknown[]) =>
        text.includes("user_roles") ? Promise.reject(new Error("db down")) : t.pool.query(text, params),
      connect: () => t.pool.connect(),
    } as unknown as pg.Pool;
    const hb = await serve(broken);
    try {
      const r = await call(hb, "POST", "/api/communications/send", { as: "manager", key: newKey(), body: email() });
      assert.equal(r.status, 503);
      assert.equal(r.json.error, "authorization_unavailable");
    } finally {
      await hb.close();
    }
  });
});

describe("B2 — input validation at the API boundary (400, nothing stored)", () => {
  const send = (body: unknown, key: string | null = newKey()) => call(h, "POST", "/api/communications/send", { as: "manager", key, body });
  const rows = () => count(`SELECT COUNT(*)::int AS n FROM public.communication_messages`);

  it("rejects CR/LF injection in recipient and subject", async () => {
    const start = await rows();
    for (const body of [
      email({ recipient: "victim@example.com\r\nRCPT TO:<attacker@evil.test>" }),
      email({ recipient: "victim@example.com>\r\nDATA" }),
      email({ subject: "Quote\r\nBcc: attacker@evil.test" }),
      email({ subject: "Quote\nBcc: attacker@evil.test" }),
    ]) {
      const r = await send(body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.json.error, "validation_failed");
    }
    assert.equal(await rows(), start);
  });

  it("rejects bad recipients per channel, unapproved channels, and missing fields", async () => {
    for (const body of [
      email({ recipient: "not-an-email" }),
      { channelType: "sms", recipient: "9876543210", body: "otp" },
      { channelType: "whatsapp", recipient: "a@example.com", body: "hi" },
      email({ channelType: "twilio" }),
      email({ channelType: "voice" }),
      email({ channelType: "push" }),
      email({ channelType: undefined }),
      email({ recipient: undefined }),
      email({ body: undefined, templateId: undefined }),
      email({ templateId: "not-a-uuid" }),
      email({ campaignId: "not-a-uuid" }),
      email({ variables: "nope" }),
      email({ body: "" }),
    ]) {
      const r = await send(body);
      assert.equal(r.status, 400, JSON.stringify(body));
    }
  });

  it("Idempotency-Key is REQUIRED and format-checked", async () => {
    assert.equal((await send(email(), null)).status, 400);
    for (const bad of ["short", "has space in it", "x".repeat(129)]) {
      assert.equal((await send(email(), bad)).status, 400, bad);
    }
  });

  it("CRLF smuggled through a template VARIABLE is caught after substitution", async () => {
    const tpl = await call(h, "POST", "/api/communications/templates", {
      as: "manager",
      body: { name: "greet", channelType: "email", subject: "Hello {{name}}", body: "Hi {{name}}", variables: ["name"] },
    });
    assert.equal(tpl.status, 201);
    const start = await rows();
    const bad = await send({ channelType: "email", recipient: "buyer@example.com", templateId: tpl.json.template.id, variables: { name: "A\r\nBcc: x@evil.test" } });
    assert.equal(bad.status, 400);
    assert.equal(await rows(), start);

    const good = await send({ channelType: "email", recipient: "buyer@example.com", templateId: tpl.json.template.id, variables: { name: "Asha" } });
    assert.equal(good.status, 201);
    assert.equal(good.json.message.subject, "Hello Asha");
    assert.equal(good.json.message.body, "Hi Asha");
  });

  it("a template from ANOTHER organization cannot be used", async () => {
    const tpl = await call(h, "POST", "/api/communications/templates", {
      as: "managerB",
      body: { name: "b-only", channelType: "email", subject: "s", body: "b" },
    });
    const r = await send({ channelType: "email", recipient: "buyer@example.com", templateId: tpl.json.template.id });
    assert.equal(r.status, 400);
  });

  it("template creation validates subject, body, name, variables and channel", async () => {
    const mk = (b: Record<string, unknown>) => call(h, "POST", "/api/communications/templates", { as: "editor", body: { name: "n", channelType: "email", body: "b", ...b } });
    assert.equal((await mk({ subject: "x\r\nBcc: a@b.co" })).status, 400);
    assert.equal((await mk({ body: "" })).status, 400);
    assert.equal((await mk({ name: "" })).status, 400);
    assert.equal((await mk({ name: "x".repeat(201) })).status, 400);
    assert.equal((await mk({ variables: ["ok", "bad name!"] })).status, 400);
    assert.equal((await mk({ variables: "x" })).status, 400);
    assert.equal((await mk({ channelType: "twilio" })).status, 400);
    assert.equal((await mk({ variables: ["a", "b_2"] })).status, 201);
  });

  it("query params are validated (no arrays, no unknown enum values)", async () => {
    assert.equal((await call(h, "GET", "/api/communications/templates?channelType=twilio", { as: "viewer" })).status, 400);
    assert.equal((await call(h, "GET", "/api/communications/templates?channelType[]=email", { as: "viewer" })).status, 400);
    assert.equal((await call(h, "GET", "/api/communications/history?status=hacked", { as: "viewer" })).status, 400);
    assert.equal((await call(h, "GET", "/api/communications/history?channelType=voice", { as: "viewer" })).status, 400);
    assert.equal((await call(h, "GET", "/api/communications/history?status=queued&channelType=email&limit=5", { as: "viewer" })).status, 200);
  });
});

describe("B3 — idempotency keys", () => {
  it("first request creates (201); an identical replay returns the SAME message (200, deduplicated) with one row and one job", async () => {
    const key = newKey();
    const first = await call(h, "POST", "/api/communications/send", { as: "manager", key, body: email() });
    assert.equal(first.status, 201);
    assert.equal(first.json.deduplicated, false);
    assert.ok(first.json.message.job_id);

    const replay = await call(h, "POST", "/api/communications/send", { as: "manager", key, body: email() });
    assert.equal(replay.status, 200);
    assert.equal(replay.json.deduplicated, true);
    assert.equal(replay.headers.get("idempotent-replay"), "true");
    assert.equal(replay.json.message.id, first.json.message.id);

    assert.equal(await count(`SELECT COUNT(*)::int AS n FROM public.communication_messages WHERE idempotency_key=$1`, [key]), 1);
    assert.equal(await count(`SELECT COUNT(*)::int AS n FROM public.job_queue WHERE job_type='communication' AND payload->>'messageId'=$1`, [first.json.message.id]), 1);
  });

  it("the replay is honored across users of the same org (the key belongs to the org, not the caller)", async () => {
    const key = newKey();
    const a = await call(h, "POST", "/api/communications/send", { as: "manager", key, body: email() });
    const b = await call(h, "POST", "/api/communications/send", { as: "manager2", key, body: email() });
    assert.equal(b.status, 200);
    assert.equal(b.json.message.id, a.json.message.id);
  });

  it("reusing a key for a DIFFERENT recipient or channel is refused (422) and creates nothing", async () => {
    const key = newKey();
    await call(h, "POST", "/api/communications/send", { as: "manager", key, body: email() });
    const start = await count(`SELECT COUNT(*)::int AS n FROM public.communication_messages`);
    const other = await call(h, "POST", "/api/communications/send", { as: "manager", key, body: email({ recipient: "someone-else@example.com" }) });
    assert.equal(other.status, 422);
    assert.equal(other.json.error, "idempotency_key_reuse");
    const otherChannel = await call(h, "POST", "/api/communications/send", { as: "manager", key, body: { channelType: "sms", recipient: "+919876543210", body: "otp" } });
    assert.equal(otherChannel.status, 422);
    assert.equal(await count(`SELECT COUNT(*)::int AS n FROM public.communication_messages`), start);
  });

  it("the same key in a different organization is an independent message", async () => {
    const key = newKey();
    const a = await call(h, "POST", "/api/communications/send", { as: "manager", key, body: email() });
    const b = await call(h, "POST", "/api/communications/send", { as: "managerB", key, body: email() });
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.notEqual(a.json.message.id, b.json.message.id);
  });

  it("concurrent identical requests collapse to one message and one job", async () => {
    const key = newKey();
    const rs = await Promise.all(Array.from({ length: 6 }, () => call(h, "POST", "/api/communications/send", { as: "manager", key, body: email() })));
    const ids = new Set(rs.map((r) => r.json.message.id));
    assert.equal(ids.size, 1);
    assert.equal(rs.filter((r) => r.status === 201).length, 1);
    assert.equal(rs.filter((r) => r.status === 200).length, 5);
    assert.equal(await count(`SELECT COUNT(*)::int AS n FROM public.job_queue WHERE job_type='communication' AND payload->>'messageId'=$1`, [[...ids][0]]), 1);
  });

  it("crash recovery: a message row that was stored but never enqueued gets its job on replay (still one message)", async () => {
    const key = newKey();
    const inserted = await t.db.query<{ id: string }>(
      `INSERT INTO public.communication_messages (organization_id, channel_type, recipient, subject, body, status, idempotency_key)
       VALUES ($1,'email','buyer@example.com','RFQ 42','<p>Hello</p>','queued',$2) RETURNING id`,
      [orgA, key],
    );
    const r = await call(h, "POST", "/api/communications/send", { as: "manager", key, body: email() });
    assert.equal(r.status, 200);
    assert.equal(r.json.message.id, inserted.rows[0].id);
    assert.ok(r.json.message.job_id, "job must have been enqueued on replay");
    assert.equal(await count(`SELECT COUNT(*)::int AS n FROM public.job_queue WHERE payload->>'messageId'=$1`, [inserted.rows[0].id]), 1);
  });
});

describe("B3 — organization quotas", () => {
  const withQuota = async (env: Record<string, string>, fn: () => Promise<void>) => {
    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(env)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    try {
      await fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };
  const sms = (n: number) => ({ channelType: "sms", recipient: `+9198765${String(10000 + n)}`, body: "otp" });

  it("enforces a rolling 24h per-org, per-channel ceiling with 429 + Retry-After", async () => {
    const org = await seedOrg(t.db, "quota-org");
    const mgr = await seedUser(t.db, org, ["MANAGER"]);
    users.qMgr = mgr;
    await withQuota({ COMM_QUOTA_SMS_PER_DAY: "3" }, async () => {
      for (let i = 0; i < 3; i++) {
        const r = await call(h, "POST", "/api/communications/send", { as: "qMgr", org, key: newKey(), body: sms(i) });
        assert.equal(r.status, 201, `send ${i}: ${r.text}`);
      }
      const over = await call(h, "POST", "/api/communications/send", { as: "qMgr", org, key: newKey(), body: sms(99) });
      assert.equal(over.status, 429);
      assert.equal(over.json.error, "quota_exceeded");
      assert.equal(over.headers.get("retry-after"), "3600");
      assert.equal(await count(`SELECT COUNT(*)::int AS n FROM public.communication_messages WHERE organization_id=$1 AND channel_type='sms'`, [org]), 3);
    });
  });

  it("is per organization and per channel: other orgs and other channels are unaffected", async () => {
    const org = await seedOrg(t.db, "quota-org-2");
    users.q2 = await seedUser(t.db, org, ["MANAGER"]);
    await withQuota({ COMM_QUOTA_SMS_PER_DAY: "1", COMM_QUOTA_EMAIL_PER_DAY: "50" }, async () => {
      assert.equal((await call(h, "POST", "/api/communications/send", { as: "q2", org, key: newKey(), body: sms(1) })).status, 201);
      assert.equal((await call(h, "POST", "/api/communications/send", { as: "q2", org, key: newKey(), body: sms(2) })).status, 429);
      // same org, other channel
      assert.equal((await call(h, "POST", "/api/communications/send", { as: "q2", org, key: newKey(), body: email() })).status, 201);
      // other org, same channel
      const other = await seedOrg(t.db, "quota-other");
      users.q3 = await seedUser(t.db, other, ["MANAGER"]);
      assert.equal((await call(h, "POST", "/api/communications/send", { as: "q3", org: other, key: newKey(), body: sms(3) })).status, 201);
    });
  });

  it("counts the whole organization, not the individual caller", async () => {
    const org = await seedOrg(t.db, "quota-org-3");
    users.q4a = await seedUser(t.db, org, ["MANAGER"]);
    users.q4b = await seedUser(t.db, org, ["ADMIN"]);
    await withQuota({ COMM_QUOTA_SMS_PER_DAY: "2" }, async () => {
      assert.equal((await call(h, "POST", "/api/communications/send", { as: "q4a", org, key: newKey(), body: sms(1) })).status, 201);
      assert.equal((await call(h, "POST", "/api/communications/send", { as: "q4b", org, key: newKey(), body: sms(2) })).status, 201);
      assert.equal((await call(h, "POST", "/api/communications/send", { as: "q4a", org, key: newKey(), body: sms(3) })).status, 429);
    });
  });

  it("an idempotent REPLAY still succeeds at the limit (it creates nothing); cancelling frees a slot", async () => {
    const org = await seedOrg(t.db, "quota-org-4");
    users.q5 = await seedUser(t.db, org, ["MANAGER"]);
    await withQuota({ COMM_QUOTA_SMS_PER_DAY: "1" }, async () => {
      const key = newKey();
      const first = await call(h, "POST", "/api/communications/send", { as: "q5", org, key, body: sms(1) });
      assert.equal(first.status, 201);
      assert.equal((await call(h, "POST", "/api/communications/send", { as: "q5", org, key: newKey(), body: sms(2) })).status, 429);
      const replay = await call(h, "POST", "/api/communications/send", { as: "q5", org, key, body: sms(1) });
      assert.equal(replay.status, 200);
      assert.equal(replay.json.message.id, first.json.message.id);

      await new CommunicationService(t.pool).cancelMessage(org, first.json.message.id, users.q5);
      assert.equal((await call(h, "POST", "/api/communications/send", { as: "q5", org, key: newKey(), body: sms(3) })).status, 201);
    });
  });

  it("messages older than 24h fall out of the window", async () => {
    const org = await seedOrg(t.db, "quota-org-5");
    users.q6 = await seedUser(t.db, org, ["MANAGER"]);
    await withQuota({ COMM_QUOTA_SMS_PER_DAY: "1" }, async () => {
      const first = await call(h, "POST", "/api/communications/send", { as: "q6", org, key: newKey(), body: sms(1) });
      await t.db.query(`UPDATE public.communication_messages SET created_at = NOW() - INTERVAL '25 hours' WHERE id=$1`, [first.json.message.id]);
      assert.equal((await call(h, "POST", "/api/communications/send", { as: "q6", org, key: newKey(), body: sms(2) })).status, 201);
    });
  });

  it("a quota of 0 disables the channel", async () => {
    await withQuota({ COMM_QUOTA_WHATSAPP_PER_DAY: "0" }, async () => {
      const r = await call(h, "POST", "/api/communications/send", { as: "manager", key: newKey(), body: { channelType: "whatsapp", recipient: "+919876543210", body: "hi" } });
      assert.equal(r.status, 429);
    });
  });
});

describe("B3 — rate limiting", () => {
  it("returns 429 + Retry-After once the per-org send budget is spent, and does not affect other orgs", async () => {
    const hr = await serve(t.pool, { send: 2 });
    try {
      const go = (as: keyof typeof users) => call(hr, "POST", "/api/communications/send", { as, key: newKey(), body: email() });
      assert.equal((await go("manager")).status, 201);
      assert.equal((await go("manager2")).status, 201); // same org, other user: shared budget
      const limited = await go("admin");
      assert.equal(limited.status, 429);
      assert.equal(limited.json.error, "rate_limited");
      assert.ok(Number(limited.headers.get("retry-after")) >= 1);
      assert.equal((await go("managerB")).status, 201, "another org has its own budget");
    } finally {
      await hr.close();
    }
  });

  it("a low-privilege member cannot burn the org's send budget (role is checked BEFORE the limiter)", async () => {
    const hr = await serve(t.pool, { send: 2 });
    try {
      for (let i = 0; i < 6; i++) {
        const r = await call(hr, "POST", "/api/communications/send", { as: "viewer", key: newKey(), body: email() });
        assert.equal(r.status, 403);
      }
      assert.equal((await call(hr, "POST", "/api/communications/send", { as: "manager", key: newKey(), body: email() })).status, 201);
      assert.equal((await call(hr, "POST", "/api/communications/send", { as: "manager", key: newKey(), body: email() })).status, 201);
    } finally {
      await hr.close();
    }
  });

  it("template writes and retries have their own limiters", async () => {
    const hr = await serve(t.pool, { write: 1, retry: 1 });
    try {
      const tpl = { name: "n", channelType: "email", body: "b" };
      assert.equal((await call(hr, "POST", "/api/communications/templates", { as: "editor", body: tpl })).status, 201);
      assert.equal((await call(hr, "POST", "/api/communications/templates", { as: "editor", body: tpl })).status, 429);
      await call(hr, "POST", `/api/communications/retry/${randomUUID()}`, { as: "manager" });
      assert.equal((await call(hr, "POST", `/api/communications/retry/${randomUUID()}`, { as: "manager" })).status, 429);
    } finally {
      await hr.close();
    }
  });
});

describe("organization isolation (application layer)", () => {
  it("history and status never cross organizations", async () => {
    const a = await call(h, "POST", "/api/communications/send", { as: "manager", key: newKey(), body: email({ recipient: "only-a@example.com" }) });
    const b = await call(h, "POST", "/api/communications/send", { as: "managerB", key: newKey(), body: email({ recipient: "only-b@example.com" }) });

    const histA = await call(h, "GET", "/api/communications/history?limit=200", { as: "viewer" });
    const recips = histA.json.messages.map((m: any) => m.recipient);
    assert.ok(recips.includes("only-a@example.com"));
    assert.ok(!recips.includes("only-b@example.com"));

    assert.equal((await call(h, "GET", `/api/communications/status/${a.json.message.id}`, { as: "viewer" })).status, 200);
    assert.equal((await call(h, "GET", `/api/communications/status/${b.json.message.id}`, { as: "viewer" })).status, 404);
    assert.equal((await call(h, "GET", "/api/communications/status/not-a-uuid", { as: "viewer" })).status, 404);
  });

  it("templates are listed per organization", async () => {
    const list = await call(h, "GET", "/api/communications/templates", { as: "viewer" });
    assert.ok(list.json.templates.every((x: any) => x.organization_id === orgA));
  });

  it("a caller cannot pass organizationId in the body to act on another org", async () => {
    const r = await call(h, "POST", "/api/communications/send", { as: "manager", key: newKey(), body: email({ organizationId: orgB }) });
    assert.equal(r.status, 201);
    assert.equal(r.json.message.organization_id, orgA);
  });
});

describe("retry", () => {
  const failed = async (retryCount = 0, org = orgA) => {
    const r = await t.db.query<{ id: string }>(
      `INSERT INTO public.communication_messages (organization_id, channel_type, recipient, subject, body, status, retry_count)
       VALUES ($1,'email','buyer@example.com','s','b','failed',$2) RETURNING id`,
      [org, retryCount],
    );
    return r.rows[0].id;
  };

  it("re-queues a failed message once: status queued, retry_count+1, one new job keyed to the retry", async () => {
    const id = await failed();
    const r = await call(h, "POST", `/api/communications/retry/${id}`, { as: "manager" });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.message.status, "queued");
    assert.equal(r.json.message.retry_count, 1);
    assert.equal(await count(`SELECT COUNT(*)::int AS n FROM public.job_queue WHERE idempotency_key=$1`, [`comm-msg:${id}:1`]), 1);

    // Retrying again while it is queued is a state error, not a second job.
    assert.equal((await call(h, "POST", `/api/communications/retry/${id}`, { as: "manager" })).status, 409);
    assert.equal(await count(`SELECT COUNT(*)::int AS n FROM public.job_queue WHERE payload->>'messageId'=$1`, [id]), 1);
  });

  it("is capped at max_retries so retry cannot become an unbounded re-send button", async () => {
    const id = await failed(3);
    const r = await call(h, "POST", `/api/communications/retry/${id}`, { as: "manager" });
    assert.equal(r.status, 409);
    assert.match(r.json.detail, /retry limit/);
  });

  it("cannot retry another org's message (404), a sent message (409), or a non-uuid (404)", async () => {
    const other = await failed(0, orgB);
    assert.equal((await call(h, "POST", `/api/communications/retry/${other}`, { as: "manager" })).status, 404);
    const sent = (await t.db.query<{ id: string }>(
      `INSERT INTO public.communication_messages (organization_id, channel_type, recipient, body, status) VALUES ($1,'email','a@example.com','b','sent') RETURNING id`, [orgA])).rows[0].id;
    assert.equal((await call(h, "POST", `/api/communications/retry/${sent}`, { as: "manager" })).status, 409);
    assert.equal((await call(h, "POST", "/api/communications/retry/not-a-uuid", { as: "manager" })).status, 404);
  });
});

describe("error responses do not leak internals", () => {
  it("a database failure returns a stable code + requestId, never the underlying message", async () => {
    const flaky = {
      query: (text: string, params?: unknown[]) =>
        text.includes("FROM public.communication_templates")
          ? Promise.reject(new Error("connection string postgres://svc:hunter2@db.internal exploded"))
          : t.pool.query(text, params),
      connect: () => t.pool.connect(),
    } as unknown as pg.Pool;
    const hf = await serve(flaky);
    try {
      const r = await call(hf, "GET", "/api/communications/templates", { as: "viewer" });
      assert.equal(r.status, 500);
      assert.equal(r.json.error, "internal_error");
      assert.ok(r.json.requestId);
      assert.ok(!r.text.includes("hunter2") && !r.text.includes("postgres://"));
    } finally {
      await hf.close();
    }
  });
});
