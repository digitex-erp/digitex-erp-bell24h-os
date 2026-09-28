/**
 * Sprint CH-02 — the campaign flow, end to end, on the real routes / services / worker handler / SQL.
 *
 * What is REAL here: routes, RBAC, rate limits, CampaignService, CommunicationService, QueueManager,
 * CommunicationJobHandler, every SQL statement and the two migrations, on a real Postgres engine.
 * What is a TEST DOUBLE: the provider adapter (a fake `resend` registered only inside this test file)
 * and "the worker ran" (the tests call handler.handle() themselves). These tests therefore prove the
 * orchestration logic; they do NOT prove any real provider can deliver.
 */

import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CommunicationJobHandler } from "../../workers/handlers/CommunicationJobHandler.js";
import { ProviderFactory } from "../providers/ProviderFactory.js";
import type { AdapterSendResult, OutboundMessage, ProviderAdapter, ResolvedProviderConfig } from "../types.js";
import type { QueueJob } from "../../queue/QueueTypes.js";
import { createTestDb, seedOrg, seedUser, type TestDb } from "./helpers/testDb.js";
import { call, seedContact, serve, silenceAudit, useUnsubscribeEnv, type Harness } from "./helpers/httpHarness.js";

let t: TestDb;
let h: Harness;
let handler: CommunicationJobHandler;
let orgA: string;
let orgB: string;
let unmute: () => void;
let restoreUnsubEnv: () => void;
const U: Record<string, string> = {};
const registry = () => (ProviderFactory as unknown as { registry: Record<string, ProviderAdapter> }).registry;
const originalResend = registry().resend;

interface Sent {
  message: OutboundMessage;
}
let sends: Sent[] = [];
let nextResult: AdapterSendResult = { success: true, providerMessageId: "pm-x" };
const fakeResend: ProviderAdapter = {
  provider: "resend",
  channelType: "email",
  send: async (message: OutboundMessage, _c: ResolvedProviderConfig) => {
    sends.push({ message });
    return nextResult.success ? { success: true, providerMessageId: `pm-${sends.length}` } : nextResult;
  },
  status: async () => ({ status: "sent" }),
  validate: async () => ({ valid: true }),
  healthCheck: async () => ({ healthy: true, checkedAt: new Date().toISOString() }),
};

before(async () => {
  unmute = silenceAudit();
  restoreUnsubEnv = useUnsubscribeEnv();
  t = await createTestDb();
  handler = new CommunicationJobHandler(t.pool);
  orgA = await seedOrg(t.db, "A");
  orgB = await seedOrg(t.db, "B");
  U.admin = await seedUser(t.db, orgA, ["ADMIN"]);
  U.manager = await seedUser(t.db, orgA, ["MANAGER"]);
  U.editor = await seedUser(t.db, orgA, ["EDITOR"]);
  U.viewer = await seedUser(t.db, orgA, ["VIEWER"]);
  U.norole = await seedUser(t.db, orgA, []);
  U.managerB = await seedUser(t.db, orgB, ["MANAGER"]);
  h = await serve(t.pool);
  registry().resend = fakeResend;
  process.env.COMM_RESEND_FLOW = "flow-secret";
  await t.db.query(
    `INSERT INTO public.communication_providers (organization_id, name, provider, channel_type, credentials_secret_ref, priority, settings)
     VALUES ($1,'flow','resend','email','COMM_RESEND_FLOW',0,'{"fromAddress":"no-reply@example.com"}')`,
    [orgA],
  );
});
after(async () => {
  registry().resend = originalResend;
  delete process.env.COMM_RESEND_FLOW;
  unmute();
  restoreUnsubEnv();
  await h.close();
  await t.db.close();
});
beforeEach(() => {
  sends = [];
  nextResult = { success: true, providerMessageId: "pm-x" };
});
afterEach(() => {
  delete process.env.COMM_QUOTA_EMAIL_PER_DAY;
  delete process.env.COMM_CAMPAIGN_BATCH_SIZE;
});

const as = (who: string, org = orgA) => ({ user: U[who], org });
const key = () => `k-${randomUUID()}`;
const count = async (sql: string, p: unknown[] = []) => (await t.db.query<{ n: number }>(sql, p)).rows[0].n;

async function template(subject = "Hello {{first_name}}", body = "<p>Hi {{first_name}} from {{company}} <a href=\"{{unsubscribe_url}}\">Unsubscribe</a></p>") {
  const r = await call(h, "POST", "/api/communications/templates", { ...as("manager"), body: { name: `t-${randomUUID().slice(0, 6)}`, channelType: "email", subject, body } });
  assert.equal(r.status, 201, r.text);
  return r.json.template.id as string;
}
async function contacts(n: number, prefix = "lead") {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    ids.push(await seedContact(t.db, orgA, { first: `F${i}`, last: `L${i}`, email: `${prefix}${i}-${randomUUID().slice(0, 4)}@example.com`, company: `Co${i}` }));
  }
  return ids;
}
async function newCampaign(n = 3, extra: Record<string, unknown> = {}) {
  const templateId = await template();
  const contactIds = await contacts(n);
  const r = await call(h, "POST", "/api/communications/campaigns", {
    ...as("manager"),
    body: { name: "Camp", channelType: "email", templateId, contactIds, consentConfirmed: true, ...extra },
  });
  assert.equal(r.status, 201, r.text);
  return { id: r.json.campaign.id as string, contactIds, templateId, audience: r.json.audience };
}
/** Simulates the worker having sent the test message (test-only stand-in for a real provider success). */
async function markTestSent(campaignId: string) {
  await t.db.query(
    `UPDATE public.communication_messages SET status='sent', sent_at=NOW() WHERE id = (SELECT last_test_message_id FROM public.communication_campaigns WHERE id=$1)`,
    [campaignId],
  );
}
async function testAndVerify(id: string) {
  const r = await call(h, "POST", `/api/communications/campaigns/${id}/test`, { ...as("manager"), key: key(), body: { testRecipient: "owner@example.com" } });
  assert.equal(r.status, 202, r.text);
  await markTestSent(id);
  return r;
}
const jobFor = async (idemKey: string): Promise<QueueJob<any>> => {
  const r = await t.db.query<any>(`SELECT * FROM public.job_queue WHERE idempotency_key=$1`, [idemKey]);
  assert.equal(r.rows.length, 1, `job ${idemKey}`);
  return r.rows[0] as QueueJob<any>;
};
/** Runs every queued communication MESSAGE job of a campaign through the real handler (the "worker"). */
async function runMessageJobs(campaignId: string) {
  const rows = await t.db.query<any>(
    `SELECT q.* FROM public.job_queue q JOIN public.communication_messages m ON m.job_id = q.id
      WHERE m.campaign_id = $1 AND NOT m.is_test AND q.status = 'queued' ORDER BY q.created_at`,
    [campaignId],
  );
  for (const row of rows.rows) await handler.handle(row as QueueJob<any>);
  return rows.rows.length;
}
const detail = async (id: string) => (await call(h, "GET", `/api/communications/campaigns/${id}`, as("viewer"))).json;

describe("select leads", () => {
  it("lists the org's contacts that have an address for the channel, flags unusable addresses, hides deleted ones", async () => {
    const org = await seedOrg(t.db, "leads-org");
    const mgr = await seedUser(t.db, org, ["MANAGER"]);
    const good = await seedContact(t.db, org, { first: "Asha", email: "asha@example.com", company: "Acme" });
    await seedContact(t.db, org, { first: "Bad", email: "not-an-email" });
    await seedContact(t.db, org, { first: "NoEmail", phone: "+919876543210" });
    await seedContact(t.db, org, { first: "Gone", email: "gone@example.com", deleted: true });
    await seedContact(t.db, orgB, { first: "Other", email: "other@example.com" });

    const r = await call(h, "GET", "/api/communications/leads?channelType=email", { user: mgr, org });
    assert.equal(r.status, 200, r.text);
    const byName = Object.fromEntries(r.json.leads.map((l: any) => [l.first_name, l]));
    assert.equal(byName.Asha.usable, true);
    assert.equal(byName.Asha.company, "Acme");
    assert.equal(byName.Bad.usable, false);
    assert.ok(!byName.NoEmail, "no email -> not listed for the email channel");
    assert.ok(!byName.Gone, "soft-deleted contacts are never listed");
    assert.ok(!byName.Other, "another organization's contacts are never listed");
    assert.equal(byName.Asha.id, good);

    const wa = await call(h, "GET", "/api/communications/leads?channelType=whatsapp", { user: mgr, org });
    assert.deepEqual(wa.json.leads.map((l: any) => l.first_name), ["NoEmail"]);
  });

  it("search filters, LIKE wildcards are escaped, channel is required and validated, reads need a role", async () => {
    const org = await seedOrg(t.db, "leads-org-2");
    const mgr = await seedUser(t.db, org, ["VIEWER"]);
    await seedContact(t.db, org, { first: "Asha", email: "asha@example.com" });
    await seedContact(t.db, org, { first: "Ravi", email: "ravi@example.com" });
    const q = (s: string) => call(h, "GET", `/api/communications/leads?channelType=email&q=${encodeURIComponent(s)}`, { user: mgr, org });
    assert.deepEqual((await q("ash")).json.leads.map((l: any) => l.first_name), ["Asha"]);
    assert.equal((await q("%")).json.leads.length, 0, "a literal % must not match everything");
    assert.equal((await call(h, "GET", "/api/communications/leads", { user: mgr, org })).status, 400);
    assert.equal((await call(h, "GET", "/api/communications/leads?channelType=twilio", { user: mgr, org })).status, 400);
    assert.equal((await call(h, "GET", "/api/communications/leads?channelType=email", as("norole"))).status, 403);
  });
});

describe("create campaign", () => {
  it("creates a draft, snapshots the audience, and reports what was skipped", async () => {
    const templateId = await template();
    const a = await seedContact(t.db, orgA, { first: "A", email: "dup@example.com" });
    const dupe = await seedContact(t.db, orgA, { first: "A2", email: "DUP@example.com" });
    const bad = await seedContact(t.db, orgA, { first: "B", email: "nope" });
    const fine = await seedContact(t.db, orgA, { first: "C", email: "c@example.com" });
    const foreign = await seedContact(t.db, orgB, { first: "X", email: "x@example.com" });
    const r = await call(h, "POST", "/api/communications/campaigns", {
      ...as("manager"),
      body: { name: "  Launch  ", channelType: "email", templateId, contactIds: [a, dupe, bad, fine, foreign, randomUUID()], consentConfirmed: true },
    });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.campaign.status, "draft");
    assert.equal(r.json.campaign.name, "Launch");
    assert.equal(r.json.campaign.total_recipients, 2);
    assert.deepEqual(r.json.audience, { requested: 6, resolved: 2, notFound: 2, invalidAddress: 1, duplicate: 1, suppressed: 0 });
    assert.equal(await count(`SELECT COUNT(*)::int AS n FROM public.communication_campaign_recipients WHERE campaign_id=$1`, [r.json.campaign.id]), 2);
    assert.ok(r.json.campaign.consent_confirmed_at);
    assert.equal(r.json.campaign.consent_confirmed_by, U.manager);
  });

  it("requires explicit consent attestation and rejects unusable input (400, nothing stored)", async () => {
    const templateId = await template();
    const ids = await contacts(1);
    const before = await count(`SELECT COUNT(*)::int AS n FROM public.communication_campaigns`);
    const post = (b: Record<string, unknown>) =>
      call(h, "POST", "/api/communications/campaigns", { ...as("manager"), body: { name: "c", channelType: "email", templateId, contactIds: ids, consentConfirmed: true, ...b } });
    for (const b of [
      { consentConfirmed: false },
      { consentConfirmed: "true" },
      { consentConfirmed: undefined },
      { name: "" },
      { name: "x\r\ny" },
      { name: "x".repeat(201) },
      { channelType: "twilio" },
      { channelType: "voice" },
      { templateId: "nope" },
      { templateId: randomUUID() },
      { contactIds: [] },
      { contactIds: "abc" },
      { contactIds: ["nope"] },
      { contactIds: [await seedContact(t.db, orgA, { email: "bad address" })] },
      { variables: [] },
      { variables: { "bad key": "x" } },
      { variables: { a: { nested: 1 } } },
    ]) {
      const r = await post(b as Record<string, unknown>);
      assert.equal(r.status, 400, JSON.stringify(b));
    }
    assert.equal(await count(`SELECT COUNT(*)::int AS n FROM public.communication_campaigns`), before);
  });

  it("a template for a different channel or another org's template is refused", async () => {
    const ids = await contacts(1);
    const sms = await call(h, "POST", "/api/communications/templates", { ...as("manager"), body: { name: "sms", channelType: "sms", body: "hi" } });
    const r1 = await call(h, "POST", "/api/communications/campaigns", {
      ...as("manager"),
      body: { name: "c", channelType: "email", templateId: sms.json.template.id, contactIds: ids, consentConfirmed: true },
    });
    assert.equal(r1.status, 400);
    const foreign = await call(h, "POST", "/api/communications/templates", { ...as("managerB", orgB), body: { name: "b", channelType: "email", body: "x" } });
    const r2 = await call(h, "POST", "/api/communications/campaigns", {
      ...as("manager"),
      body: { name: "c", channelType: "email", templateId: foreign.json.template.id, contactIds: ids, consentConfirmed: true },
    });
    assert.equal(r2.status, 400);
  });

  it("role gates: EDITOR may create a draft but not test/schedule/execute/cancel; VIEWER may only read", async () => {
    const templateId = await template();
    const ids = await contacts(1);
    const body = { name: "c", channelType: "email", templateId, contactIds: ids, consentConfirmed: true };
    assert.equal((await call(h, "POST", "/api/communications/campaigns", { ...as("editor"), body })).status, 201);
    assert.equal((await call(h, "POST", "/api/communications/campaigns", { ...as("viewer"), body })).status, 403);
    assert.equal((await call(h, "POST", "/api/communications/campaigns", { ...as("norole"), body })).status, 403);

    const { id } = await newCampaign(1);
    for (const [path, b] of [
      [`/${id}/test`, { testRecipient: "a@example.com" }],
      [`/${id}/schedule`, { scheduledAt: new Date(Date.now() + 3600_000).toISOString() }],
      [`/${id}/execute`, {}],
      [`/${id}/cancel`, {}],
    ] as const) {
      assert.equal((await call(h, "POST", `/api/communications/campaigns${path}`, { ...as("editor"), key: key(), body: b })).status, 403, path);
      assert.equal((await call(h, "POST", `/api/communications/campaigns${path}`, { ...as("viewer"), key: key(), body: b })).status, 403, path);
    }
    for (const p of ["", `/${id}`, `/${id}/recipients`]) {
      assert.equal((await call(h, "GET", `/api/communications/campaigns${p}`, as("viewer"))).status, 200, p || "list");
    }
  });

  it("organization isolation: another org cannot read, test, or execute this campaign (404)", async () => {
    const { id } = await newCampaign(1);
    assert.equal((await call(h, "GET", `/api/communications/campaigns/${id}`, as("managerB", orgB))).status, 404);
    assert.equal((await call(h, "GET", `/api/communications/campaigns/${id}/recipients`, as("managerB", orgB))).status, 404);
    assert.equal((await call(h, "POST", `/api/communications/campaigns/${id}/execute`, as("managerB", orgB))).status, 404);
    assert.equal((await call(h, "GET", "/api/communications/campaigns/not-a-uuid", as("manager"))).status, 404);
    const list = await call(h, "GET", "/api/communications/campaigns?limit=200", as("managerB", orgB));
    assert.ok(!list.json.campaigns.some((c: any) => c.id === id));
  });

  it("recipient list paginates and validates its status filter; /send refuses a campaignId", async () => {
    const { id } = await newCampaign(5);
    const p1 = await call(h, "GET", `/api/communications/campaigns/${id}/recipients?limit=2`, as("viewer"));
    assert.equal(p1.json.recipients.length, 2);
    const p3 = await call(h, "GET", `/api/communications/campaigns/${id}/recipients?limit=2&offset=4`, as("viewer"));
    assert.equal(p3.json.recipients.length, 1);
    assert.equal((await call(h, "GET", `/api/communications/campaigns/${id}/recipients?status=hacked`, as("viewer"))).status, 400);
    assert.equal((await call(h, "GET", `/api/communications/campaigns?status=hacked`, as("viewer"))).status, 400);
    const send = await call(h, "POST", "/api/communications/send", { ...as("manager"), key: key(), body: { channelType: "email", recipient: "a@example.com", body: "x", campaignId: id } });
    assert.equal(send.status, 400);
  });
});

describe("send test / gate (fails closed)", () => {
  it("scheduling or executing with NO test message is refused (409 test_not_verified)", async () => {
    const { id } = await newCampaign(2);
    const s = await call(h, "POST", `/api/communications/campaigns/${id}/schedule`, { ...as("manager"), body: { scheduledAt: new Date(Date.now() + 3600_000).toISOString() } });
    assert.equal(s.status, 409);
    assert.equal(s.json.error, "test_not_verified");
    const e = await call(h, "POST", `/api/communications/campaigns/${id}/execute`, as("manager"));
    assert.equal(e.status, 409);
    assert.equal(e.json.error, "test_not_verified");
    assert.equal((await detail(id)).campaign.status, "draft");
    assert.equal(await count(`SELECT COUNT(*)::int AS n FROM public.communication_messages WHERE campaign_id=$1`, [id]), 0);
  });

  it("a test send is a real, queued, quota-counted message flagged is_test; it is NOT verified until it reaches 'sent'", async () => {
    const { id } = await newCampaign(2);
    const r = await call(h, "POST", `/api/communications/campaigns/${id}/test`, { ...as("manager"), key: key(), body: { testRecipient: "owner@example.com" } });
    assert.equal(r.status, 202, r.text);
    assert.equal(r.json.message.is_test, true);
    assert.equal(r.json.message.status, "queued");
    assert.equal(r.json.message.campaign_id, id);
    assert.ok(r.json.message.job_id, "goes through the real job queue");
    const d = await detail(id);
    assert.equal(d.lastTest.recipient, "owner@example.com");
    assert.equal(d.testVerified, false);
    const s = await call(h, "POST", `/api/communications/campaigns/${id}/execute`, as("manager"));
    assert.equal(s.status, 409);
  });

  it("a test that FAILED (e.g. no working provider) keeps the gate closed and says why", async () => {
    const { id } = await newCampaign(2);
    const r = await call(h, "POST", `/api/communications/campaigns/${id}/test`, { ...as("manager"), key: key(), body: { testRecipient: "owner@example.com" } });
    await t.db.query(`UPDATE public.communication_messages SET status='failed', error_message='PROVIDER_NOT_CONFIGURED: no active provider' WHERE id=$1`, [r.json.message.id]);
    const d = await detail(id);
    assert.equal(d.testVerified, false);
    assert.equal(d.lastTest.status, "failed");
    const e = await call(h, "POST", `/api/communications/campaigns/${id}/execute`, as("manager"));
    assert.equal(e.status, 409);
    assert.match(e.json.detail, /failed/);
  });

  it("test sends are idempotent per key, validate the recipient by channel, and require the header", async () => {
    const { id } = await newCampaign(1);
    const k = key();
    const a = await call(h, "POST", `/api/communications/campaigns/${id}/test`, { ...as("manager"), key: k, body: { testRecipient: "owner@example.com" } });
    const b = await call(h, "POST", `/api/communications/campaigns/${id}/test`, { ...as("manager"), key: k, body: { testRecipient: "owner@example.com" } });
    assert.equal(a.status, 202);
    assert.equal(b.status, 200);
    assert.equal(b.json.message.id, a.json.message.id);
    assert.equal(await count(`SELECT COUNT(*)::int AS n FROM public.communication_messages WHERE campaign_id=$1 AND is_test`, [id]), 1);
    for (const bad of ["not-an-email", "a@example.com\r\nBcc: x@y.co", undefined, 5]) {
      const r = await call(h, "POST", `/api/communications/campaigns/${id}/test`, { ...as("manager"), key: key(), body: { testRecipient: bad } });
      assert.equal(r.status, 400, String(bad));
    }
    assert.equal((await call(h, "POST", `/api/communications/campaigns/${id}/test`, { ...as("manager"), body: { testRecipient: "a@example.com" } })).status, 400);
  });

  it("test messages never count toward campaign totals", async () => {
    const { id } = await newCampaign(2);
    await testAndVerify(id);
    const d = await detail(id);
    assert.equal(d.campaign.sent_count, 0);
    assert.equal(d.recipientCounts.sent, 0);
  });
});

describe("schedule and execute", () => {
  it("schedule validates the time, enqueues a run job at that time, and replaces it on reschedule", async () => {
    const { id } = await newCampaign(2);
    await testAndVerify(id);
    const post = (scheduledAt: unknown) => call(h, "POST", `/api/communications/campaigns/${id}/schedule`, { ...as("manager"), body: { scheduledAt } });
    for (const bad of [undefined, "tomorrow", new Date(Date.now() - 1000).toISOString(), new Date(Date.now() + 10_000).toISOString(), new Date(Date.now() + 200 * 86400_000).toISOString()]) {
      assert.equal((await post(bad)).status, 400, String(bad));
    }
    const when = new Date(Date.now() + 2 * 3600_000);
    const r = await post(when.toISOString());
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.campaign.status, "scheduled");
    assert.equal(r.json.campaign.run_count, 1);
    const job1 = await jobFor(`camp-run:${id}:1`);
    assert.equal((job1 as any).status, "queued");
    assert.ok(Math.abs(new Date((job1 as any).scheduled_at).getTime() - when.getTime()) < 1000);
    assert.deepEqual((job1 as any).payload, { campaignId: id, run: 1 });

    const later = new Date(Date.now() + 5 * 3600_000);
    assert.equal((await post(later.toISOString())).json.campaign.run_count, 2);
    assert.equal(((await jobFor(`camp-run:${id}:1`)) as any).status, "cancelled", "the old scheduled run is cancelled");
    assert.equal(((await jobFor(`camp-run:${id}:2`)) as any).status, "queued");
  });

  it("a stale (superseded) run job does nothing when the worker picks it up", async () => {
    const { id } = await newCampaign(2);
    await testAndVerify(id);
    await call(h, "POST", `/api/communications/campaigns/${id}/schedule`, { ...as("manager"), body: { scheduledAt: new Date(Date.now() + 3600_000).toISOString() } });
    const stale = { ...(await jobFor(`camp-run:${id}:1`)), payload: { campaignId: id, run: 0 } } as QueueJob<any>;
    const out = (await handler.handle(stale)) as any;
    assert.equal(out.skipped, true);
    assert.equal(out.reason, "superseded_run");
    assert.equal(await count(`SELECT COUNT(*)::int AS n FROM public.communication_messages WHERE campaign_id=$1 AND NOT is_test`, [id]), 0);
  });

  it("execute queues a high-priority run job, cancels a pending scheduled run, and the worker expands the audience into normal messages", async () => {
    const { id, contactIds } = await newCampaign(3);
    await testAndVerify(id);
    await call(h, "POST", `/api/communications/campaigns/${id}/schedule`, { ...as("manager"), body: { scheduledAt: new Date(Date.now() + 3600_000).toISOString() } });
    const ex = await call(h, "POST", `/api/communications/campaigns/${id}/execute`, as("manager"));
    assert.equal(ex.status, 202, ex.text);
    assert.equal(ex.json.campaign.status, "running");
    assert.equal(((await jobFor(`camp-run:${id}:1`)) as any).status, "cancelled");
    const run = (await jobFor(`camp-run:${id}:2`)) as any;
    assert.equal(run.priority, "high");

    const out = (await handler.handle(run)) as any;
    assert.equal(out.queued, 3);
    const msgs = await t.db.query<any>(`SELECT * FROM public.communication_messages WHERE campaign_id=$1 AND NOT is_test ORDER BY created_at`, [id]);
    assert.equal(msgs.rows.length, 3);
    for (const m of msgs.rows) {
      assert.equal(m.status, "queued");
      assert.ok(m.job_id, "each message has its own job");
      assert.match(m.idempotency_key, /^camp:/);
    }
    assert.ok(msgs.rows[0].subject.startsWith("Hello F"), "template variables are filled from each lead");
    assert.equal(contactIds.length, 3);
    const d = await detail(id);
    assert.equal(d.recipientCounts.queued, 3);
    assert.equal(d.campaign.status, "running", "not completed until the messages actually finish");
  });

  it("full run with a (fake) provider: messages are sent through the real worker path, the campaign completes with real counts", async () => {
    const { id } = await newCampaign(3);
    await testAndVerify(id);
    await call(h, "POST", `/api/communications/campaigns/${id}/execute`, as("manager"));
    await handler.handle(await jobFor(`camp-run:${id}:1`));
    assert.equal(await runMessageJobs(id), 3);
    assert.equal(sends.length, 3, "one provider call per recipient");
    const d = await detail(id);
    assert.equal(d.campaign.status, "completed");
    assert.equal(d.campaign.sent_count, 3);
    assert.equal(d.campaign.failed_count, 0);
    assert.equal(d.recipientCounts.sent, 3);
    assert.ok(d.campaign.completed_at);
  });

  it("every message failing all its attempts ends the campaign as 'failed' with real error text - never 'completed'", async () => {
    const { id } = await newCampaign(2);
    await testAndVerify(id);
    await call(h, "POST", `/api/communications/campaigns/${id}/execute`, as("manager"));
    await handler.handle(await jobFor(`camp-run:${id}:1`));
    nextResult = { success: false, errorMessage: "resend down" };
    const rows = await t.db.query<any>(
      `SELECT q.* FROM public.job_queue q JOIN public.communication_messages m ON m.job_id=q.id WHERE m.campaign_id=$1 AND NOT m.is_test`, [id]);
    for (const row of rows.rows) {
      // First attempt: the message is 'failed' but retryable, so the campaign must NOT be closed yet.
      await assert.rejects(handler.handle({ ...row, retry_count: 0, max_retries: 3 } as QueueJob<any>), /failed/);
    }
    assert.equal((await detail(id)).campaign.status, "running", "a retryable failure is not terminal");
    for (const row of rows.rows) await assert.rejects(handler.handle({ ...row, retry_count: 2, max_retries: 3 } as QueueJob<any>), /failed/);
    const d = await detail(id);
    assert.equal(d.campaign.status, "failed");
    assert.equal(d.campaign.failed_count, 2);
    assert.equal(d.campaign.sent_count, 0);
    const rec = await call(h, "GET", `/api/communications/campaigns/${id}/recipients?status=failed`, as("viewer"));
    assert.equal(rec.json.recipients.length, 2);
    assert.match(rec.json.recipients[0].error_message, /resend down/);
  });

  it("execute twice does not duplicate anything: per-recipient idempotency keys make a replay a no-op", async () => {
    const { id } = await newCampaign(2);
    await testAndVerify(id);
    await call(h, "POST", `/api/communications/campaigns/${id}/execute`, as("manager"));
    await handler.handle(await jobFor(`camp-run:${id}:1`));
    const before = await count(`SELECT COUNT(*)::int AS n FROM public.communication_messages WHERE campaign_id=$1 AND NOT is_test`, [id]);
    // Simulate a crash-and-replay of the same job.
    await handler.handle(await jobFor(`camp-run:${id}:1`));
    assert.equal(await count(`SELECT COUNT(*)::int AS n FROM public.communication_messages WHERE campaign_id=$1 AND NOT is_test`, [id]), before);
    assert.equal(before, 2);
  });

  it("large audiences run in bounded batches, each chained as a new run", async () => {
    process.env.COMM_CAMPAIGN_BATCH_SIZE = "2";
    const { id } = await newCampaign(5);
    await testAndVerify(id);
    await call(h, "POST", `/api/communications/campaigns/${id}/execute`, as("manager"));
    const b1 = (await handler.handle(await jobFor(`camp-run:${id}:1`))) as any;
    assert.deepEqual([b1.queued, b1.remaining], [2, 3]);
    const b2 = (await handler.handle(await jobFor(`camp-run:${id}:2`))) as any;
    assert.deepEqual([b2.queued, b2.remaining], [2, 1]);
    const b3 = (await handler.handle(await jobFor(`camp-run:${id}:3`))) as any;
    assert.deepEqual([b3.queued, b3.remaining], [1, 0]);
    assert.equal(await count(`SELECT COUNT(*)::int AS n FROM public.job_queue WHERE idempotency_key=$1`, [`camp-run:${id}:4`]), 0, "no further batch");
    assert.equal(await runMessageJobs(id), 5);
    assert.equal((await detail(id)).campaign.status, "completed");
  });

  it("hitting the org's quota PAUSES the campaign (nothing is dropped); execute resumes exactly where it stopped", async () => {
    const org = await seedOrg(t.db, "quota-camp-org");
    const mgr = await seedUser(t.db, org, ["MANAGER"]);
    U.qm = mgr;
    const tpl = (await call(h, "POST", "/api/communications/templates", { user: mgr, org, body: { name: "t", channelType: "email", subject: "s", body: "b {{unsubscribe_url}}" } })).json.template.id;
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push(await seedContact(t.db, org, { first: `Q${i}`, email: `q${i}@example.com` }));
    const c = await call(h, "POST", "/api/communications/campaigns", { user: mgr, org, body: { name: "q", channelType: "email", templateId: tpl, contactIds: ids, consentConfirmed: true } });
    const id = c.json.campaign.id;
    process.env.COMM_QUOTA_EMAIL_PER_DAY = "3"; // 1 test + 2 campaign messages fit
    const tr = await call(h, "POST", `/api/communications/campaigns/${id}/test`, { user: mgr, org, key: key(), body: { testRecipient: "owner@example.com" } });
    assert.equal(tr.status, 202);
    await markTestSent(id);
    await call(h, "POST", `/api/communications/campaigns/${id}/execute`, { user: mgr, org });
    const out = (await handler.handle(await jobFor(`camp-run:${id}:1`))) as any;
    assert.equal(out.paused, "quota");
    assert.equal(out.queued, 2);
    const d1 = (await call(h, "GET", `/api/communications/campaigns/${id}`, { user: mgr, org })).json;
    assert.equal(d1.campaign.status, "paused");
    assert.equal(d1.campaign.paused_reason, "quota");
    assert.deepEqual([d1.recipientCounts.queued, d1.recipientCounts.pending], [2, 2]);

    process.env.COMM_QUOTA_EMAIL_PER_DAY = "100";
    const ex = await call(h, "POST", `/api/communications/campaigns/${id}/execute`, { user: mgr, org });
    assert.equal(ex.status, 202);
    const resume = (await handler.handle(await jobFor(`camp-run:${id}:2`))) as any;
    assert.equal(resume.queued, 2);
    const total = await t.db.query<any>(`SELECT COUNT(*)::int AS n, COUNT(DISTINCT recipient)::int AS d FROM public.communication_messages WHERE campaign_id=$1 AND NOT is_test`, [id]);
    assert.deepEqual([total.rows[0].n, total.rows[0].d], [4, 4], "each lead has exactly one message");
  });

  it("execute is refused for completed / cancelled / running-again states and for a missing consent record", async () => {
    const { id } = await newCampaign(1);
    await testAndVerify(id);
    await t.db.query(`UPDATE public.communication_campaigns SET consent_confirmed_at = NULL WHERE id=$1`, [id]);
    const e = await call(h, "POST", `/api/communications/campaigns/${id}/execute`, as("manager"));
    assert.equal(e.status, 409);
    assert.equal(e.json.error, "consent_missing");
    await t.db.query(`UPDATE public.communication_campaigns SET consent_confirmed_at = NOW(), status='completed' WHERE id=$1`, [id]);
    assert.equal((await call(h, "POST", `/api/communications/campaigns/${id}/execute`, as("manager"))).status, 409);
    assert.equal((await call(h, "POST", `/api/communications/campaigns/${id}/schedule`, { ...as("manager"), body: { scheduledAt: new Date(Date.now() + 3600_000).toISOString() } })).status, 409);
  });
});

describe("cancel", () => {
  it("stops pending recipients, queued messages and their jobs; the campaign ends 'cancelled' and cannot be run again", async () => {
    process.env.COMM_CAMPAIGN_BATCH_SIZE = "2";
    const { id } = await newCampaign(4);
    await testAndVerify(id);
    await call(h, "POST", `/api/communications/campaigns/${id}/execute`, as("manager"));
    await handler.handle(await jobFor(`camp-run:${id}:1`)); // 2 queued, 2 pending, next batch job exists
    const r = await call(h, "POST", `/api/communications/campaigns/${id}/cancel`, as("manager"));
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.campaign.status, "cancelled");
    const d = await detail(id);
    assert.equal(d.recipientCounts.pending, 0);
    assert.equal(d.recipientCounts.cancelled, 4);
    assert.equal(await count(`SELECT COUNT(*)::int AS n FROM public.communication_messages WHERE campaign_id=$1 AND NOT is_test AND status='cancelled'`, [id]), 2);
    assert.equal(((await jobFor(`camp-run:${id}:2`)) as any).status, "cancelled", "the chained next-batch job is cancelled");
    // the worker must not send cancelled messages
    assert.equal(await runMessageJobs(id), 0);
    assert.equal(sends.length, 0);
    assert.equal((await call(h, "POST", `/api/communications/campaigns/${id}/execute`, as("manager"))).status, 409);
    assert.equal((await call(h, "POST", `/api/communications/campaigns/${id}/cancel`, as("manager"))).status, 409);
  });

  it("cancelling a scheduled campaign cancels its run job", async () => {
    const { id } = await newCampaign(1);
    await testAndVerify(id);
    await call(h, "POST", `/api/communications/campaigns/${id}/schedule`, { ...as("manager"), body: { scheduledAt: new Date(Date.now() + 3600_000).toISOString() } });
    assert.equal((await call(h, "POST", `/api/communications/campaigns/${id}/cancel`, as("manager"))).status, 200);
    assert.equal(((await jobFor(`camp-run:${id}:1`)) as any).status, "cancelled");
    const out = (await handler.handle({ ...(await jobFor(`camp-run:${id}:1`)), status: "queued" } as QueueJob<any>)) as any;
    assert.equal(out.skipped, true);
  });
});

describe("logs", () => {
  it("one row per message with attempts / last provider; bodies are not exposed; tests hidden unless asked; org-isolated", async () => {
    const { id } = await newCampaign(2);
    await testAndVerify(id);
    await call(h, "POST", `/api/communications/campaigns/${id}/execute`, as("manager"));
    await handler.handle(await jobFor(`camp-run:${id}:1`));
    await runMessageJobs(id);

    const r = await call(h, "GET", `/api/communications/logs?campaignId=${id}`, as("viewer"));
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.logs.length, 2, "test message hidden by default");
    for (const row of r.json.logs) {
      assert.equal(row.status, "sent");
      assert.equal(row.attempts, 1);
      assert.equal(row.last_provider, "resend");
      assert.ok(!("body" in row) && !("subject" in row), "message content is not part of the log view");
    }
    const withTests = await call(h, "GET", `/api/communications/logs?campaignId=${id}&includeTests=true`, as("viewer"));
    assert.equal(withTests.json.logs.length, 3);
    assert.equal((await call(h, "GET", `/api/communications/logs?campaignId=${id}`, as("managerB", orgB))).json.logs.length, 0);

    const mid = r.json.logs[0].message_id;
    const at = await call(h, "GET", `/api/communications/logs/${mid}/attempts`, as("viewer"));
    assert.equal(at.status, 200);
    assert.deepEqual(at.json.attempts.map((a: any) => [a.attempt_number, a.provider, a.status]), [[1, "resend", "success"]]);
    assert.ok(!("raw_response" in at.json.attempts[0]));
    assert.equal((await call(h, "GET", `/api/communications/logs/${mid}/attempts`, as("managerB", orgB))).status, 404);
    assert.equal((await call(h, "GET", "/api/communications/logs/not-a-uuid/attempts", as("viewer"))).status, 404);
  });

  it("a failed message shows its real error; filters are validated; a role is required", async () => {
    const { id } = await newCampaign(1);
    await testAndVerify(id);
    await call(h, "POST", `/api/communications/campaigns/${id}/execute`, as("manager"));
    await handler.handle(await jobFor(`camp-run:${id}:1`));
    nextResult = { success: false, errorMessage: "mailbox unavailable" };
    const row = (await t.db.query<any>(`SELECT q.* FROM public.job_queue q JOIN public.communication_messages m ON m.job_id=q.id WHERE m.campaign_id=$1 AND NOT m.is_test`, [id])).rows[0];
    await assert.rejects(handler.handle({ ...row, retry_count: 2, max_retries: 3 } as QueueJob<any>));
    const r = await call(h, "GET", `/api/communications/logs?campaignId=${id}&status=dead_letter`, as("viewer"));
    assert.equal(r.json.logs.length, 1);
    assert.match(r.json.logs[0].error_message, /mailbox unavailable/);
    for (const q of ["status=hacked", "channelType=twilio", "campaignId=nope"]) {
      assert.equal((await call(h, "GET", `/api/communications/logs?${q}`, as("viewer"))).status, 400, q);
    }
    assert.equal((await call(h, "GET", "/api/communications/logs", as("norole"))).status, 403);
  });
});
