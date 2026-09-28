/**
 * Durable audit log (Phase 2, item 9): the real migration on a real Postgres engine, the real sink, the real routes.
 * Covers append-only enforcement, redaction, failure isolation, organization scoping, RBAC, validation, and the
 * honesty of /api/audit/status.
 */
import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { emitAuditEvent, setAuditSink } from "../../audit.js";
import { createAuditSink, getAuditSinkStats, redactMetadata, resetAuditSinkStats } from "../../lib/auditStore.js";
import { registerAuditRoutes } from "../../lib/auditRoutes.js";
import { applyMigration, createTestDb, seedOrg, seedUser, type TestDb } from "./helpers/testDb.js";
import { authenticate, call, serveApp, type Harness } from "./helpers/httpHarness.js";

let t: TestDb;
let h: Harness;
let orgA: string;
let orgB: string;
const U: Record<string, string> = {};
const realLog = console.log;
const realDbUrl = process.env.DATABASE_URL;

const flush = () => new Promise((r) => setTimeout(r, 30));
const as = (who: string, org = orgA) => ({ user: U[who], org });
const emit = (over: Partial<Parameters<typeof emitAuditEvent>[0]> = {}) =>
  emitAuditEvent({ actor: "actor-1", organizationId: orgA, action: "test.event", targetType: "thing", targetId: "t1", outcome: "success", requestId: "req-1", ...over });

before(async () => {
  console.log = (...a: unknown[]) => {
    if (typeof a[0] === "string" && a[0].startsWith('{"kind":"audit"')) return; // keep test output readable
    realLog(...a);
  };
  process.env.DATABASE_URL = "postgres://test-only";
  t = await createTestDb();
  await applyMigration(t.db, "add_audit_log.sql");
  orgA = await seedOrg(t.db, "A");
  orgB = await seedOrg(t.db, "B");
  U.admin = await seedUser(t.db, orgA, ["ADMIN"]);
  U.manager = await seedUser(t.db, orgA, ["MANAGER"]);
  U.viewer = await seedUser(t.db, orgA, ["VIEWER"]);
  U.norole = await seedUser(t.db, orgA, []);
  U.adminB = await seedUser(t.db, orgB, ["ADMIN"]);
  h = await serveApp((app) => registerAuditRoutes(app, { getPool: () => t.pool, authenticate }));
});
after(async () => {
  console.log = realLog;
  setAuditSink(null);
  if (realDbUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = realDbUrl;
  await h.close();
  await t.db.close();
});
afterEach(() => {
  setAuditSink(null);
  resetAuditSinkStats();
});

const count = async (sql = "SELECT COUNT(*)::int AS n FROM public.audit_events", p: unknown[] = []) => (await t.db.query<any>(sql, p)).rows[0].n as number;

describe("the sink persists events", () => {
  it("writes every field, and stdout emission is unaffected", async () => {
    setAuditSink(createAuditSink(() => t.pool));
    const before = await count();
    emit({ action: "sink.roundtrip", metadata: { channelType: "email", n: 3 } });
    await flush();
    assert.equal(await count(), before + 1);
    const row = (await t.db.query<any>(`SELECT * FROM public.audit_events WHERE action = 'sink.roundtrip'`)).rows[0];
    assert.deepEqual([row.actor, row.organization_id, row.target_type, row.target_id, row.outcome, row.request_id], ["actor-1", orgA, "thing", "t1", "success", "req-1"]);
    assert.deepEqual(row.metadata, { channelType: "email", n: 3 });
    assert.equal(getAuditSinkStats().written >= 1, true);
  });

  it("without a registered sink nothing is written (and nothing throws)", async () => {
    const before = await count();
    emit({ action: "no.sink" });
    await flush();
    assert.equal(await count(), before);
  });

  it("a non-UUID organization id is stored as NULL rather than failing the write", async () => {
    setAuditSink(createAuditSink(() => t.pool));
    emit({ action: "sink.badorg", organizationId: "not-a-uuid" });
    emit({ action: "sink.noorg", organizationId: null });
    await flush();
    assert.equal(await count(`SELECT COUNT(*)::int AS n FROM public.audit_events WHERE action IN ('sink.badorg','sink.noorg') AND organization_id IS NULL`), 2);
  });
});

describe("a broken sink can never break the caller, and is COUNTED", () => {
  it("a database error is swallowed by the request path but recorded in the stats", async () => {
    const broken = { query: async () => { throw new Error("connection refused"); } } as any;
    setAuditSink(createAuditSink(() => broken));
    assert.doesNotThrow(() => emit({ action: "sink.down" }));
    await flush();
    const s = getAuditSinkStats();
    assert.equal(s.failed, 1);
    assert.match(s.lastFailure!, /connection refused/);
    assert.ok(s.lastFailureAt);
  });

  it("a sink that throws synchronously or rejects also cannot reach the caller", async () => {
    setAuditSink(() => { throw new Error("sync boom"); });
    assert.doesNotThrow(() => emit());
    setAuditSink(async () => { throw new Error("async boom"); });
    assert.doesNotThrow(() => emit());
    await flush();
  });

  it("a CHECK violation (e.g. an invalid outcome) is counted, not thrown", async () => {
    setAuditSink(createAuditSink(() => t.pool));
    emit({ outcome: "weird" as any });
    await flush();
    assert.equal(getAuditSinkStats().failed, 1);
  });
});

describe("append-only", () => {
  it("UPDATE, DELETE and TRUNCATE are rejected by the database itself", async () => {
    setAuditSink(createAuditSink(() => t.pool));
    emit({ action: "immutable.row" });
    await flush();
    await assert.rejects(() => t.db.query(`UPDATE public.audit_events SET outcome = 'failure' WHERE action = 'immutable.row'`), /append-only/);
    await assert.rejects(() => t.db.query(`DELETE FROM public.audit_events WHERE action = 'immutable.row'`), /append-only/);
    await assert.rejects(() => t.db.query(`TRUNCATE public.audit_events`), /append-only/);
    assert.equal(await count(`SELECT COUNT(*)::int AS n FROM public.audit_events WHERE action = 'immutable.row' AND outcome = 'success'`), 1);
  });

  it("tenant roles have no privileges at all (RLS on, no policy, grants revoked)", async () => {
    const r = (await t.db.query<any>(`SELECT has_table_privilege('authenticated','public.audit_events','SELECT') s, has_table_privilege('authenticated','public.audit_events','INSERT') i, has_table_privilege('anon','public.audit_events','SELECT') a, (SELECT relrowsecurity FROM pg_class WHERE relname='audit_events') rls, (SELECT COUNT(*)::int FROM pg_policies WHERE tablename='audit_events') policies`)).rows[0];
    assert.deepEqual([r.s, r.i, r.a, r.rls, r.policies], [false, false, false, true, 0]);
  });

  it("the migration is re-runnable", async () => {
    await applyMigration(t.db, "add_audit_log.sql");
    await applyMigration(t.db, "add_audit_log.sql");
  });
});

describe("redaction", () => {
  it("replaces secret-looking keys at any depth, truncates long strings, caps size and depth", () => {
    const r = redactMetadata({
      channelType: "email",
      apiKey: "sk-live-123",
      Authorization: "Bearer abc",
      nested: { password: "p", ok: 1, deeper: { client_secret: "x", fine: true } },
      prompt: "the user's private prompt",
      messageBody: "hello",
      long: "x".repeat(2000),
    }) as any;
    assert.equal(r.channelType, "email");
    assert.equal(r.apiKey, "[redacted]");
    assert.equal(r.Authorization, "[redacted]");
    assert.equal(r.prompt, "[redacted]");
    assert.equal(r.messageBody, "[redacted]");
    assert.deepEqual(r.nested, { password: "[redacted]", ok: 1, deeper: { client_secret: "[redacted]", fine: true } });
    assert.ok(r.long.length < 600 && r.long.endsWith("[truncated]"));
    let deep: any = { v: 1 };
    for (let i = 0; i < 10; i++) deep = { d: deep };
    assert.match(JSON.stringify(redactMetadata(deep)), /depth-limit/);
    const wide = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`k${i}`, "y".repeat(300)]));
    const capped = redactMetadata(wide) as any;
    assert.ok(JSON.stringify(capped).length < 9000);
    assert.deepEqual(redactMetadata(undefined), {});
  });

  it("nothing secret reaches the table when a caller makes the mistake", async () => {
    setAuditSink(createAuditSink(() => t.pool));
    emit({ action: "leak.attempt", metadata: { token: "eyJhbGciOi", nested: { apiKey: "sk-secret" } } });
    await flush();
    const row = (await t.db.query<any>(`SELECT metadata::text m FROM public.audit_events WHERE action = 'leak.attempt'`)).rows[0];
    assert.ok(!row.m.includes("eyJhbGciOi") && !row.m.includes("sk-secret"));
  });
});

describe("GET /api/audit/events", () => {
  before(async () => {
    setAuditSink(createAuditSink(() => t.pool));
    for (let i = 0; i < 6; i++) emit({ action: "communication.message.enqueued", targetId: `m${i}`, actor: "u-a" });
    emit({ action: "communication.authorize", outcome: "denied", actor: "u-b" });
    emit({ action: "audit.100%_literal", targetId: "wild" });
    emit({ action: "communication.message.enqueued", organizationId: orgB, targetId: "OTHER-ORG" });
    await flush();
    setAuditSink(null);
  });

  it("is ADMIN only: manager, viewer, no-role are refused; unauthenticated is 401", async () => {
    for (const who of ["manager", "viewer", "norole"]) assert.equal((await call(h, "GET", "/api/audit/events", as(who))).status, 403, who);
    assert.equal((await call(h, "GET", "/api/audit/events")).status, 401);
    assert.equal((await call(h, "GET", "/api/audit/events", as("admin"))).status, 200);
  });

  it("is organization-scoped: an org never sees another org's events", async () => {
    const a = await call(h, "GET", "/api/audit/events?limit=200", as("admin"));
    assert.ok(a.json.events.length > 0);
    assert.ok(!a.json.events.some((e: any) => e.target_id === "OTHER-ORG"));
    const b = await call(h, "GET", "/api/audit/events?limit=200", as("adminB", orgB));
    assert.deepEqual(b.json.events.map((e: any) => e.target_id), ["OTHER-ORG"]);
  });

  it("filters: action prefix (wildcards are literal), outcome, targetId, actor, date range; newest first; paging", async () => {
    const q = (s: string) => call(h, "GET", `/api/audit/events${s}`, as("admin"));
    assert.equal((await q("?action=communication.message.")).json.total, 6);
    assert.equal((await q("?action=communication.")).json.total >= 7, true);
    assert.equal((await q("?action=audit.100%25")).json.total, 1, "% is escaped, so it matches the literal");
    assert.equal((await q("?action=%25")).json.total, 0, "a bare % is not a wildcard");
    assert.equal((await q("?outcome=denied")).json.events.every((e: any) => e.outcome === "denied"), true);
    assert.equal((await q("?targetId=m3")).json.total, 1);
    assert.equal((await q("?actor=u-b")).json.total, 1);
    assert.equal((await q("?since=2999-01-01T00:00:00Z")).json.total, 0);
    assert.ok((await q("?until=2999-01-01T00:00:00Z")).json.total > 0);
    const page1 = (await q("?limit=2&offset=0")).json;
    const page2 = (await q("?limit=2&offset=2")).json;
    assert.equal(page1.events.length, 2);
    assert.notEqual(page1.events[0].id, page2.events[0].id);
    const times = (await q("?limit=200")).json.events.map((e: any) => Date.parse(e.occurred_at));
    assert.deepEqual(times, [...times].sort((x, y) => y - x));
  });

  it("rejects bad filters with 400 and never runs them", async () => {
    for (const bad of ["?outcome=maybe", "?limit=0", "?limit=201", "?limit=abc", "?offset=-1", "?since=yesterday", `?action=${"a".repeat(201)}`, "?targetType=a%0Ab"]) {
      assert.equal((await call(h, "GET", `/api/audit/events${bad}`, as("admin"))).status, 400, bad);
    }
  });

  it("a SQL-injection string in a filter is inert", async () => {
    const r = await call(h, "GET", `/api/audit/events?targetId=${encodeURIComponent("x' OR '1'='1")}`, as("admin"));
    assert.equal(r.status, 200);
    assert.equal(r.json.total, 0);
  });

  it("reading the audit log is itself audited (filter NAMES only, never values)", async () => {
    setAuditSink(createAuditSink(() => t.pool));
    await call(h, "GET", "/api/audit/events?actor=u-secret-actor&outcome=denied", as("admin"));
    await flush();
    setAuditSink(null);
    const row = (await t.db.query<any>(`SELECT metadata, actor FROM public.audit_events WHERE action = 'audit.events.read' ORDER BY occurred_at DESC LIMIT 1`)).rows[0];
    assert.deepEqual(row.metadata.filters.sort(), ["actor", "outcome"]);
    assert.ok(!JSON.stringify(row.metadata).includes("u-secret-actor"));
  });

  it("denied attempts on the audit routes are themselves recorded as denials", async () => {
    setAuditSink(createAuditSink(() => t.pool));
    await call(h, "GET", "/api/audit/events", as("viewer"));
    await flush();
    setAuditSink(null);
    assert.ok((await count(`SELECT COUNT(*)::int AS n FROM public.audit_events WHERE action = 'communication.authorize' AND outcome = 'denied' AND metadata->>'permission' = 'audit.read'`)) >= 1);
  });
});

describe("GET /api/audit/status never claims health it cannot prove", () => {
  it("ADMIN only", async () => {
    assert.equal((await call(h, "GET", "/api/audit/status", as("viewer"))).status, 403);
  });

  it("no_events_yet → healthy only after a real row was written; failing when only failures happened", async () => {
    let r = await call(h, "GET", "/api/audit/status", as("admin"));
    assert.equal(r.json.persistence.state, "no_events_yet");
    setAuditSink(createAuditSink(() => t.pool));
    emit({ action: "status.probe" });
    await flush();
    r = await call(h, "GET", "/api/audit/status", as("admin"));
    assert.equal(r.json.persistence.state, "healthy");
    assert.equal(r.json.persistence.sink.written >= 1, true);
    assert.ok(r.json.summary.last_24h >= 1);
    resetAuditSinkStats();
    setAuditSink(createAuditSink(() => ({ query: async () => { throw new Error("down"); } }) as any));
    emit({ action: "status.fail" });
    await flush();
    r = await call(h, "GET", "/api/audit/status", as("admin"));
    assert.equal(r.json.persistence.state, "failing");
  });

  it("not_configured when the server has no DATABASE_URL", async () => {
    const keep = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      assert.equal((await call(h, "GET", "/api/audit/status", as("admin"))).json.persistence.state, "not_configured");
    } finally {
      process.env.DATABASE_URL = keep;
    }
  });

  it("table_missing (503 on the events route) when the migration has not been applied", async () => {
    const bare = await createTestDb(); // has no add_audit_log.sql
    const org = await seedOrg(bare.db, "X");
    const admin = await seedUser(bare.db, org, ["ADMIN"]);
    const hh = await serveApp((app) => registerAuditRoutes(app, { getPool: () => bare.pool, authenticate }));
    try {
      const st = await call(hh, "GET", "/api/audit/status", { user: admin, org });
      assert.equal(st.json.persistence.state, "table_missing");
      const ev = await call(hh, "GET", "/api/audit/events", { user: admin, org });
      assert.equal(ev.status, 503);
      assert.equal(ev.json.error, "audit_table_missing");
    } finally {
      await hh.close();
      await bare.db.close();
    }
  });
});
