/**
 * (1) Dashboard / Schedules API: counts of real rows, honest worker evidence, org isolation.
 * (2) "Every send creates audit logs": the REAL audit events are captured off stdout (the repo's audit
 *     sink, see server/audit.ts) and checked for every path a send can take — accepted, refused, sent by
 *     the worker, failed, dead-lettered, campaign test / execute / batch / completion.
 *
 * Note on durability: server/audit.ts emits structured JSON to stdout only (documented limitation of this
 * repository; there is no durable audit table). The DURABLE per-send record is communication_messages +
 * communication_deliveries; these tests assert that both exist for every send that reached a provider.
 */

import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CommunicationJobHandler } from "../../workers/handlers/CommunicationJobHandler.js";
import { ProviderFactory } from "../providers/ProviderFactory.js";
import type { AdapterSendResult, OutboundMessage, ProviderAdapter } from "../types.js";
import type { QueueJob } from "../../queue/QueueTypes.js";
import { createTestDb, seedOrg, seedUser, type TestDb } from "./helpers/testDb.js";
import { call, seedContact, serve, useUnsubscribeEnv, type Harness } from "./helpers/httpHarness.js";

let t: TestDb;
let h: Harness;
let handler: CommunicationJobHandler;
let orgA: string;
let orgB: string;
const U: Record<string, string> = {};
const registry = () => (ProviderFactory as unknown as { registry: Record<string, ProviderAdapter> }).registry;
const originalResend = registry().resend;

interface AuditLine {
  kind: string;
  action: string;
  actor: string | null;
  organizationId: string | null;
  targetType: string;
  targetId: string;
  outcome: string;
  requestId: string;
  metadata?: Record<string, unknown>;
  raw: string;
}
let audit: AuditLine[] = [];
const realLog = console.log;
let restoreUnsubEnv: () => void;
let result: AdapterSendResult = { success: true, providerMessageId: "pm" };
const fake: ProviderAdapter = {
  provider: "resend",
  channelType: "email",
  send: async (_m: OutboundMessage) => result,
  status: async () => ({ status: "sent" }),
  validate: async () => ({ valid: true }),
  healthCheck: async () => ({ healthy: true, checkedAt: new Date().toISOString() }),
};

before(async () => {
  console.log = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith('{"kind":"audit"')) {
      audit.push({ ...JSON.parse(args[0]), raw: args[0] });
      return;
    }
    realLog(...args);
  };
  restoreUnsubEnv = useUnsubscribeEnv();
  t = await createTestDb();
  handler = new CommunicationJobHandler(t.pool);
  orgA = await seedOrg(t.db, "A");
  orgB = await seedOrg(t.db, "B");
  U.manager = await seedUser(t.db, orgA, ["MANAGER"]);
  U.viewer = await seedUser(t.db, orgA, ["VIEWER"]);
  U.norole = await seedUser(t.db, orgA, []);
  U.managerB = await seedUser(t.db, orgB, ["MANAGER"]);
  h = await serve(t.pool);
  registry().resend = fake;
  process.env.COMM_RESEND_AUD = "aud-secret";
});
after(async () => {
  console.log = realLog;
  restoreUnsubEnv();
  registry().resend = originalResend;
  delete process.env.COMM_RESEND_AUD;
  await h.close();
  await t.db.close();
});
beforeEach(() => {
  audit = [];
  result = { success: true, providerMessageId: "pm" };
});
afterEach(() => {
  delete process.env.COMM_QUOTA_EMAIL_PER_DAY;
});

const as = (who: string, org = orgA) => ({ user: U[who], org });
const key = () => `k-${randomUUID()}`;
const actions = () => audit.map((a) => a.action);
const one = (action: string) => {
  const m = audit.filter((a) => a.action === action);
  assert.equal(m.length, 1, `expected exactly one "${action}", got ${m.length}: ${actions().join(", ")}`);
  return m[0];
};
const addProvider = async (org = orgA) =>
  t.db.query(
    `INSERT INTO public.communication_providers (organization_id, name, provider, channel_type, credentials_secret_ref, priority, settings)
     VALUES ($1,'aud','resend','email','COMM_RESEND_AUD',0,'{"fromAddress":"no-reply@example.com"}')`,
    [org],
  );
const jobOf = async (messageId: string, retry = 0, max = 3): Promise<QueueJob<any>> => {
  const r = await t.db.query<any>(`SELECT q.* FROM public.job_queue q JOIN public.communication_messages m ON m.job_id=q.id WHERE m.id=$1`, [messageId]);
  return { ...r.rows[0], retry_count: retry, max_retries: max } as QueueJob<any>;
};
const send = (extra: Record<string, unknown> = {}, who = "manager") =>
  call(h, "POST", "/api/communications/send", { ...as(who), key: key(), body: { channelType: "email", recipient: "buyer@example.com", subject: "Quote 42", body: "<p>secret-body-text</p>", ...extra } });

describe("audit: every send attempt creates an audit event (and never carries content)", () => {
  it("an ACCEPTED send is audited with actor, org, message id and request id", async () => {
    const r = await send();
    assert.equal(r.status, 201);
    const e = one("communication.message.enqueued");
    assert.deepEqual([e.actor, e.organizationId, e.targetType, e.targetId, e.outcome], [U.manager, orgA, "communication_message", r.json.message.id, "success"]);
    assert.ok(e.requestId);
  });

  it("audit events never contain the recipient, subject or body", async () => {
    await addProvider();
    const r = await send();
    await handler.handle(await jobOf(r.json.message.id));
    assert.ok(audit.length >= 2);
    for (const a of audit) {
      for (const secret of ["buyer@example.com", "Quote 42", "secret-body-text", "aud-secret"]) {
        assert.ok(!a.raw.includes(secret), `${a.action} leaked "${secret}"`);
      }
    }
  });

  it("REFUSED sends are audited too, with only a reason code: validation, quota, key reuse", async () => {
    await send({ recipient: "bad\r\naddress" });
    let e = one("communication.message.rejected");
    assert.deepEqual([e.outcome, e.metadata?.code, e.metadata?.via], ["denied", "validation_failed", "send"]);
    assert.ok(!e.raw.includes("bad"), "rejected recipient text is not logged");

    audit = [];
    process.env.COMM_QUOTA_EMAIL_PER_DAY = "0";
    await send();
    assert.equal(one("communication.message.rejected").metadata?.code, "quota_exceeded");
    delete process.env.COMM_QUOTA_EMAIL_PER_DAY;

    audit = [];
    const k = key();
    await call(h, "POST", "/api/communications/send", { ...as("manager"), key: k, body: { channelType: "email", recipient: "a@example.com", body: "x" } });
    audit = [];
    await call(h, "POST", "/api/communications/send", { ...as("manager"), key: k, body: { channelType: "email", recipient: "different@example.com", body: "x" } });
    assert.equal(one("communication.message.rejected").metadata?.code, "idempotency_key_reuse");
  });

  it("an authorization denial and a rate-limit rejection are audited", async () => {
    await send({}, "viewer");
    const denied = one("communication.authorize");
    assert.deepEqual([denied.outcome, denied.actor, denied.organizationId], ["denied", U.viewer, orgA]);

    audit = [];
    const hr = await serve(t.pool, { send: 1 });
    try {
      const go = () => call(hr, "POST", "/api/communications/send", { ...as("manager"), key: key(), body: { channelType: "email", recipient: "a@example.com", body: "x" } });
      await go();
      audit = [];
      assert.equal((await go()).status, 429);
      assert.equal(one("ratelimit.reject").outcome, "denied");
    } finally {
      await hr.close();
    }
  });
});

describe("audit: the worker records what actually happened to each message", () => {
  it("SENT: audit 'job.communication.sent' AND a durable message + delivery row", async () => {
    await addProvider();
    const r = await send();
    audit = [];
    await handler.handle(await jobOf(r.json.message.id));
    const e = one("job.communication.sent");
    assert.deepEqual([e.actor, e.outcome, e.targetId], ["service:worker", "success", r.json.message.id]);
    const d = await t.db.query<any>(`SELECT status FROM public.communication_deliveries WHERE message_id=$1`, [r.json.message.id]);
    assert.deepEqual(d.rows.map((x) => x.status), ["success"]);
  });

  it("FAILED (retryable), DEAD-LETTERED and PROVIDER_NOT_CONFIGURED are each audited as failures", async () => {
    await addProvider();
    result = { success: false, errorMessage: "provider down" };
    const r = await send();
    audit = [];
    await assert.rejects(handler.handle(await jobOf(r.json.message.id, 0)));
    assert.equal(one("job.communication.failed").outcome, "failure");
    audit = [];
    await assert.rejects(handler.handle(await jobOf(r.json.message.id, 2)));
    assert.equal(one("job.communication.dead_lettered").outcome, "failure");

    // no provider row at all for this org -> fails closed AND is audited
    const r2 = await call(h, "POST", "/api/communications/send", { ...as("managerB", orgB), key: key(), body: { channelType: "email", recipient: "b@example.com", body: "x" } });
    audit = [];
    await assert.rejects(handler.handle(await jobOf(r2.json.message.id)), /PROVIDER_NOT_CONFIGURED/);
    const e = one("job.communication.failed");
    assert.equal(e.organizationId, orgB);
    assert.match(String(e.metadata?.errorMessage), /PROVIDER_NOT_CONFIGURED/);
  });

  it("a re-run of an already-sent message sends nothing and adds no second 'sent' event", async () => {
    await addProvider();
    const r = await send();
    const job = await jobOf(r.json.message.id);
    await handler.handle(job);
    audit = [];
    await handler.handle(job);
    assert.ok(!actions().includes("job.communication.sent"));
  });
});

describe("audit: the campaign flow", () => {
  it("test send, execute, batch, per-message sends and completion are all audited; #enqueued == #messages", async () => {
    await addProvider();
    const tpl = (await call(h, "POST", "/api/communications/templates", { ...as("manager"), body: { name: "t", channelType: "email", subject: "s", body: "b {{unsubscribe_url}}" } })).json.template.id;
    const ids = [await seedContact(t.db, orgA, { first: "A", email: "a1@example.com" }), await seedContact(t.db, orgA, { first: "B", email: "b1@example.com" })];
    const c = await call(h, "POST", "/api/communications/campaigns", { ...as("manager"), body: { name: "c", channelType: "email", templateId: tpl, contactIds: ids, consentConfirmed: true } });
    const id = c.json.campaign.id;
    assert.equal(one("communication.campaign.created").metadata?.consentAttested, true);

    audit = [];
    const tr = await call(h, "POST", `/api/communications/campaigns/${id}/test`, { ...as("manager"), key: key(), body: { testRecipient: "owner@example.com" } });
    assert.deepEqual(actions().sort(), ["communication.campaign.test_sent", "communication.message.enqueued"]);
    await handler.handle(await jobOf(tr.json.message.id));
    assert.ok(actions().includes("job.communication.sent"), "the test message's own send is audited");

    audit = [];
    await call(h, "POST", `/api/communications/campaigns/${id}/execute`, as("manager"));
    one("communication.campaign.execute_requested");
    const run = (await t.db.query<any>(`SELECT * FROM public.job_queue WHERE idempotency_key=$1`, [`camp-run:${id}:1`])).rows[0];
    await handler.handle(run);
    one("communication.campaign.batch_completed");
    const msgs = (await t.db.query<any>(`SELECT id FROM public.communication_messages WHERE campaign_id=$1 AND NOT is_test`, [id])).rows;
    assert.equal(audit.filter((a) => a.action === "communication.message.enqueued").length, msgs.length, "one 'enqueued' event per campaign message");
    for (const m of msgs) await handler.handle(await jobOf(m.id));
    assert.equal(audit.filter((a) => a.action === "job.communication.sent").length, msgs.length, "one 'sent' event per campaign message");
    const done = one("communication.campaign.completed");
    assert.deepEqual(done.metadata, { sent: 2, failed: 0 });
    // durable rows for every provider call
    const del = await t.db.query<any>(`SELECT COUNT(*)::int AS n FROM public.communication_deliveries d JOIN public.communication_messages m ON m.id=d.message_id WHERE m.campaign_id=$1 AND NOT m.is_test`, [id]);
    assert.equal(del.rows[0].n, 2);
  });

  it("cancel and quota pause are audited", async () => {
    await addProvider();
    const tpl = (await call(h, "POST", "/api/communications/templates", { ...as("manager"), body: { name: "t2", channelType: "email", subject: "s", body: "b {{unsubscribe_url}}" } })).json.template.id;
    const cids = [await seedContact(t.db, orgA, { first: "Q", email: "q1@example.com" }), await seedContact(t.db, orgA, { first: "R", email: "r1@example.com" })];
    const c = await call(h, "POST", "/api/communications/campaigns", { ...as("manager"), body: { name: "q", channelType: "email", templateId: tpl, contactIds: cids, consentConfirmed: true } });
    const id = c.json.campaign.id;
    await call(h, "POST", `/api/communications/campaigns/${id}/test`, { ...as("manager"), key: key(), body: { testRecipient: "owner@example.com" } });
    await t.db.query(`UPDATE public.communication_messages SET status='sent' WHERE id=(SELECT last_test_message_id FROM public.communication_campaigns WHERE id=$1)`, [id]);
    process.env.COMM_QUOTA_EMAIL_PER_DAY = "1"; // the test message already used the only slot
    await call(h, "POST", `/api/communications/campaigns/${id}/execute`, as("manager"));
    audit = [];
    const run = (await t.db.query<any>(`SELECT * FROM public.job_queue WHERE idempotency_key=$1`, [`camp-run:${id}:1`])).rows[0];
    await handler.handle(run);
    const p = one("communication.campaign.paused");
    assert.deepEqual([p.outcome, p.metadata?.reason], ["failure", "quota"]);
    audit = [];
    await call(h, "POST", `/api/communications/campaigns/${id}/cancel`, as("manager"));
    one("communication.campaign.cancelled");
  });
});

describe("dashboard API", () => {
  it("a new organization shows real zeros, real quota limits and NO invented health", async () => {
    const org = await seedOrg(t.db, "empty");
    const u = await seedUser(t.db, org, ["VIEWER"]);
    const r = await call(h, "GET", "/api/communications/dashboard", { user: u, org });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.messages, { last24h: {}, last7d: {} });
    assert.deepEqual(r.json.quota.map((q: any) => [q.channel, q.used, q.limit]), [["email", 0, 1000], ["sms", 0, 200], ["whatsapp", 0, 500]]);
    assert.deepEqual(r.json.campaigns, {});
    assert.deepEqual(r.json.scheduled, { count: 0, nextAt: null });
    assert.deepEqual(r.json.providers, { total: 0, canSend: 0, credentialsConfigured: 0, verified: 0 });
    assert.deepEqual(r.json.worker, { queuedJobs: 0, oldestQueuedAt: null, runningJobs: 0, deadLetterJobs: 0, lastJobCompletedAt: null });
  });

  it("counts real messages (tests excluded from send counts but included in quota), campaigns, queue depth and provider readiness", async () => {
    const org = await seedOrg(t.db, "counted");
    const m = await seedUser(t.db, org, ["MANAGER"]);
    process.env.COMM_RESEND_AUD = "aud-secret";
    await addProvider(org);
    const post = (recipient: string) => call(h, "POST", "/api/communications/send", { user: m, org, key: key(), body: { channelType: "email", recipient, body: "x" } });
    const a = await post("one@example.com");
    await post("two@example.com");
    await t.db.query(`UPDATE public.communication_messages SET status='sent' WHERE id=$1`, [a.json.message.id]);
    await t.db.query(`INSERT INTO public.communication_messages (organization_id, channel_type, recipient, body, status, is_test) VALUES ($1,'email','t@example.com','x','sent',true)`, [org]);
    await t.db.query(`INSERT INTO public.communication_campaigns (organization_id, name, channel_type, status, total_recipients, scheduled_at) VALUES ($1,'c','email','scheduled',1,NOW() + INTERVAL '1 day')`, [org]);

    const d = (await call(h, "GET", "/api/communications/dashboard", { user: m, org })).json;
    assert.deepEqual(d.messages.last24h, { queued: 1, sent: 1 });
    assert.equal(d.quota.find((q: any) => q.channel === "email").used, 3, "quota counts every non-cancelled message incl. the test");
    assert.deepEqual(d.campaigns, { scheduled: 1 });
    assert.equal(d.scheduled.count, 1);
    assert.ok(d.scheduled.nextAt);
    assert.equal(d.worker.queuedJobs, 2);
    assert.ok(d.worker.oldestQueuedAt);
    assert.equal(d.worker.lastJobCompletedAt, null, "no job has completed: no evidence the worker runs");
    assert.deepEqual(d.providers, { total: 1, canSend: 1, credentialsConfigured: 1, verified: 0 });

    await t.db.query(`UPDATE public.job_queue SET status='completed', completed_at=NOW() WHERE organization_id=$1 AND id=(SELECT job_id FROM public.communication_messages WHERE id=$2)`, [org, a.json.message.id]);
    const d2 = (await call(h, "GET", "/api/communications/dashboard", { user: m, org })).json;
    assert.ok(d2.worker.lastJobCompletedAt, "worker evidence appears only once a job actually completed");
    assert.equal(d2.worker.queuedJobs, 1);
  });

  it("is org-isolated and needs a role", async () => {
    const a = (await call(h, "GET", "/api/communications/dashboard", as("viewer"))).json;
    const b = (await call(h, "GET", "/api/communications/dashboard", as("managerB", orgB))).json;
    assert.notDeepEqual(a.messages, b.messages);
    assert.equal((await call(h, "GET", "/api/communications/dashboard", as("norole"))).status, 403);
    assert.equal((await call(h, "GET", "/api/communications/dashboard")).status, 401);
  });
});

describe("schedules API", () => {
  it("lists scheduled / running / paused campaigns with their run job; flags OVERDUE when the trigger has not run", async () => {
    const org = await seedOrg(t.db, "sched");
    const m = await seedUser(t.db, org, ["MANAGER"]);
    const mk = async (status: string, runCount: number, when: string | null) =>
      (await t.db.query<any>(
        `INSERT INTO public.communication_campaigns (organization_id, name, channel_type, status, total_recipients, scheduled_at, run_count)
         VALUES ($1,$2,'email',$3,2,$4,$5) RETURNING id`, [org, `c-${status}`, status, when, runCount])).rows[0].id;
    const future = await mk("scheduled", 1, new Date(Date.now() + 3600_000).toISOString());
    const late = await mk("scheduled", 1, new Date(Date.now() - 900_000).toISOString());
    await mk("running", 0, null);
    await mk("paused", 0, null);
    await mk("completed", 0, null);
    await mk("draft", 0, null);
    const job = (id: string, due: Date) =>
      t.db.query(
        `INSERT INTO public.job_queue (organization_id, job_type, payload, status, scheduled_at, next_run_at, idempotency_key)
         VALUES ($1,'communication','{}','queued',$2,$2,$3)`, [org, due, `camp-run:${id}:1`]);
    await job(future, new Date(Date.now() + 3600_000));
    await job(late, new Date(Date.now() - 900_000));

    const r = await call(h, "GET", "/api/communications/schedules", { user: m, org });
    assert.equal(r.status, 200, r.text);
    const by = Object.fromEntries(r.json.schedules.map((s: any) => [s.name, s]));
    assert.deepEqual(r.json.schedules.map((s: any) => s.status).sort(), ["paused", "running", "scheduled", "scheduled"]);
    assert.ok(!by["c-completed"] && !by["c-draft"], "finished and draft campaigns are not schedules");
    const scheduled = r.json.schedules.filter((s: any) => s.status === "scheduled");
    assert.equal(scheduled.length, 2);
    const fut = scheduled.find((s: any) => s.id === future);
    const lat = scheduled.find((s: any) => s.id === late);
    assert.deepEqual([fut.job_status, fut.overdue], ["queued", false]);
    assert.deepEqual([lat.job_status, lat.overdue], ["queued", true]);
    assert.deepEqual(r.json.worker.queuedJobs, 2);
  });

  it("is org-isolated and needs a role", async () => {
    const r = await call(h, "GET", "/api/communications/schedules", as("managerB", orgB));
    assert.ok(r.json.schedules.every((s: any) => s.id));
    assert.equal((await call(h, "GET", "/api/communications/schedules", as("norole"))).status, 403);
  });
});
