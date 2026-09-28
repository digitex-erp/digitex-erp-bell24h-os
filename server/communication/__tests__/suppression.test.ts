/**
 * Suppression lists and the unsubscribe flow, on the real routes / handler / SQL.
 * The properties that matter: a suppressed address is NEVER sent to (API, campaign audience, and the
 * worker's last-chance check), an unsubscribe link works and cannot be forged, and email campaigns cannot
 * run without one.
 */

import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CommunicationJobHandler } from "../../workers/handlers/CommunicationJobHandler.js";
import { ProviderFactory } from "../providers/ProviderFactory.js";
import { signUnsubscribeToken, verifyUnsubscribeToken } from "../unsubscribe.js";
import type { AdapterSendResult, OutboundMessage, ProviderAdapter } from "../types.js";
import type { QueueJob } from "../../queue/QueueTypes.js";
import { createTestDb, seedOrg, seedUser, type TestDb } from "./helpers/testDb.js";
import { call, seedContact, serve, UNSUBSCRIBE_TEST_SECRET, useUnsubscribeEnv, type Harness } from "./helpers/httpHarness.js";

let t: TestDb;
let h: Harness;
let handler: CommunicationJobHandler;
let orgA: string;
let orgB: string;
const U: Record<string, string> = {};
const registry = () => (ProviderFactory as unknown as { registry: Record<string, ProviderAdapter> }).registry;
const originalResend = registry().resend;
const realLog = console.log;
let audit: any[] = [];
let sent: OutboundMessage[] = [];
let restoreEnv: () => void;
const fake: ProviderAdapter = {
  provider: "resend",
  channelType: "email",
  send: async (m: OutboundMessage): Promise<AdapterSendResult> => {
    sent.push(m);
    return { success: true, providerMessageId: `pm-${sent.length}` };
  },
  status: async () => ({ status: "sent" }),
  validate: async () => ({ valid: true }),
  healthCheck: async () => ({ healthy: true, checkedAt: new Date().toISOString() }),
};

before(async () => {
  console.log = (...a: unknown[]) => {
    if (typeof a[0] === "string" && a[0].startsWith('{"kind":"audit"')) audit.push(JSON.parse(a[0]));
    else realLog(...a);
  };
  restoreEnv = useUnsubscribeEnv();
  t = await createTestDb();
  handler = new CommunicationJobHandler(t.pool);
  orgA = await seedOrg(t.db, "A");
  orgB = await seedOrg(t.db, "B");
  U.admin = await seedUser(t.db, orgA, ["ADMIN"]);
  U.manager = await seedUser(t.db, orgA, ["MANAGER"]);
  U.editor = await seedUser(t.db, orgA, ["EDITOR"]);
  U.viewer = await seedUser(t.db, orgA, ["VIEWER"]);
  U.adminB = await seedUser(t.db, orgB, ["ADMIN"]);
  h = await serve(t.pool);
  registry().resend = fake;
  process.env.COMM_RESEND_SUP = "sup-secret";
  await t.db.query(
    `INSERT INTO public.communication_providers (organization_id, name, provider, channel_type, credentials_secret_ref, priority, settings)
     VALUES ($1,'sup','resend','email','COMM_RESEND_SUP',0,'{"fromAddress":"no-reply@example.com"}')`,
    [orgA],
  );
});
after(async () => {
  console.log = realLog;
  restoreEnv();
  registry().resend = originalResend;
  delete process.env.COMM_RESEND_SUP;
  await h.close();
  await t.db.close();
});
beforeEach(() => {
  audit = [];
  sent = [];
});
afterEach(() => undefined);

const as = (who: string, org = orgA) => ({ user: U[who], org });
const key = () => `k-${randomUUID()}`;
const suppress = (who: string, body: unknown, org = orgA) => call(h, "POST", "/api/communications/suppressions", { ...as(who, org), body });
const rows = async (sql: string, p: unknown[] = []) => (await t.db.query<any>(sql, p)).rows;
const count = async (sql: string, p: unknown[] = []) => (await rows(sql, p))[0].n as number;
const sendEmail = (to: string, who = "manager") =>
  call(h, "POST", "/api/communications/send", { ...as(who), key: key(), body: { channelType: "email", recipient: to, subject: "s", body: "b" } });
const jobOf = async (messageId: string, retry = 0): Promise<QueueJob<any>> =>
  ({ ...(await rows(`SELECT q.* FROM public.job_queue q JOIN public.communication_messages m ON m.job_id=q.id WHERE m.id=$1`, [messageId]))[0], retry_count: retry, max_retries: 3 }) as QueueJob<any>;
const jobFor = async (k: string): Promise<QueueJob<any>> => (await rows(`SELECT * FROM public.job_queue WHERE idempotency_key=$1`, [k]))[0] as QueueJob<any>;

async function template(body = 'Hi {{first_name}} <a href="{{unsubscribe_url}}">Unsubscribe</a>') {
  const r = await call(h, "POST", "/api/communications/templates", { ...as("manager"), body: { name: `t-${randomUUID().slice(0, 6)}`, channelType: "email", subject: "Hello", body } });
  assert.equal(r.status, 201, r.text);
  return r.json.template.id as string;
}
async function campaign(emails: string[], extra: Record<string, unknown> = {}) {
  const templateId = await template();
  const contactIds: string[] = [];
  for (const e of emails) contactIds.push(await seedContact(t.db, orgA, { first: e.split("@")[0], email: e, company: "Co" }));
  const r = await call(h, "POST", "/api/communications/campaigns", { ...as("manager"), body: { name: "c", channelType: "email", templateId, contactIds, consentConfirmed: true, ...extra } });
  return { r, contactIds, templateId, id: r.json?.campaign?.id as string };
}
async function verifyTest(id: string) {
  const r = await call(h, "POST", `/api/communications/campaigns/${id}/test`, { ...as("manager"), key: key(), body: { testRecipient: "owner@example.com" } });
  assert.equal(r.status, 202, r.text);
  await t.db.query(`UPDATE public.communication_messages SET status='sent' WHERE id=$1`, [r.json.message.id]);
  return r;
}

describe("suppression list API", () => {
  it("adds addresses: normalizes (email lower-cased, dedupes), reports invalid ones without aborting the valid ones", async () => {
    const r = await suppress("manager", { channelType: "email", addresses: ["A@Example.com", "a@example.com", "b@example.com", "not-an-email", "x\r\ny@z.com"], reason: "unsubscribed", note: "asked by phone" });
    assert.equal(r.status, 201, r.text);
    assert.deepEqual([r.json.added, r.json.alreadySuppressed, r.json.invalid.length], [2, 0, 2]);
    assert.ok(!r.json.invalid.some((x: string) => /[\r\n]/.test(x)), "control characters are not echoed back");
    const stored = await rows(`SELECT address, reason, source FROM public.communication_suppressions WHERE organization_id=$1 ORDER BY address`, [orgA]);
    assert.deepEqual(stored.map((s) => s.address).sort(), ["a@example.com", "b@example.com"]);
    assert.ok(stored.every((s) => s.reason === "unsubscribed" && s.source === "operator"));
  });

  it("phone numbers must be E.164; a single `address` is accepted; an unsupported channel is refused", async () => {
    const ok = await suppress("editor", { channelType: "whatsapp", address: "+919876543210", reason: "complained" });
    assert.equal(ok.status, 201);
    assert.equal(ok.json.added, 1);
    const bad = await suppress("editor", { channelType: "sms", addresses: ["9876543210"] });
    assert.deepEqual([bad.status, bad.json.added, bad.json.invalid], [201, 0, ["9876543210"]]);
    assert.equal((await suppress("editor", { channelType: "voice", addresses: ["+919876543210"] })).status, 400);
    assert.equal((await suppress("editor", { channelType: "email", addresses: [] })).status, 400);
    assert.equal((await suppress("editor", { channelType: "email", addresses: "a@b.co" })).status, 400);
    assert.equal((await suppress("editor", { channelType: "email", addresses: ["a@b.co"], reason: "because" })).status, 400);
    assert.equal((await suppress("editor", { channelType: "email", addresses: ["a@b.co"], note: "x".repeat(501) })).status, 400);
    assert.equal((await suppress("editor", { channelType: "email", addresses: Array.from({ length: 1001 }, (_, i) => `u${i}@example.com`) })).status, 400);
  });

  it("is idempotent and NEVER overwrites the original reason", async () => {
    await suppress("manager", { channelType: "email", addresses: ["keep@example.com"], reason: "unsubscribed" });
    const again = await suppress("manager", { channelType: "email", addresses: ["KEEP@example.com"], reason: "manual" });
    assert.deepEqual([again.json.added, again.json.alreadySuppressed], [0, 1]);
    assert.equal((await rows(`SELECT reason FROM public.communication_suppressions WHERE address='keep@example.com'`))[0].reason, "unsubscribed");
  });

  it("role gates: add = EDITOR and above (it can only prevent sends); VIEWER reads only; REMOVE = ADMIN only", async () => {
    assert.equal((await suppress("viewer", { channelType: "email", addresses: ["v@example.com"] })).status, 403);
    assert.equal((await call(h, "GET", "/api/communications/suppressions", as("viewer"))).status, 200);
    await suppress("editor", { channelType: "email", addresses: ["gate@example.com"] });
    const id = (await rows(`SELECT id FROM public.communication_suppressions WHERE address='gate@example.com'`))[0].id;
    for (const who of ["manager", "editor", "viewer"]) {
      assert.equal((await call(h, "DELETE", `/api/communications/suppressions/${id}`, as(who))).status, 403, who);
    }
    assert.equal((await count(`SELECT COUNT(*)::int AS n FROM public.communication_suppressions WHERE id=$1`, [id])), 1);
    audit = [];
    assert.equal((await call(h, "DELETE", `/api/communications/suppressions/${id}`, as("admin"))).status, 200);
    assert.equal((await count(`SELECT COUNT(*)::int AS n FROM public.communication_suppressions WHERE id=$1`, [id])), 0);
    const e = audit.find((a) => a.action === "communication.suppression.removed");
    assert.deepEqual([e.actor, e.outcome, e.metadata.previousReason], [U.admin, "success", "manual"]);
    assert.ok(!JSON.stringify(e).includes("gate@example.com"), "the address is personal data and stays out of audit events");
  });

  it("lists with filters and pagination; org-isolated; removal cannot cross organizations", async () => {
    await suppress("manager", { channelType: "email", addresses: ["p1@example.com", "p2@example.com", "p3@example.com"], reason: "bounced" });
    await suppress("adminB", { channelType: "email", addresses: ["theirs@example.com"] }, orgB);
    const all = await call(h, "GET", "/api/communications/suppressions?channelType=email&reason=bounced&limit=2", as("viewer"));
    assert.equal(all.json.suppressions.length, 2);
    assert.ok(all.json.total >= 3);
    assert.ok(all.json.suppressions.every((s: any) => s.reason === "bounced" && s.channel_type === "email"));
    const q = await call(h, "GET", "/api/communications/suppressions?q=p2%40", as("viewer"));
    assert.deepEqual(q.json.suppressions.map((s: any) => s.address), ["p2@example.com"]);
    assert.equal((await call(h, "GET", "/api/communications/suppressions?q=%25", as("viewer"))).json.suppressions.length, 0, "a literal % does not match everything");
    const mine = (await call(h, "GET", "/api/communications/suppressions?limit=200", as("viewer"))).json.suppressions;
    assert.ok(!mine.some((s: any) => s.address === "theirs@example.com"));
    const theirId = (await rows(`SELECT id FROM public.communication_suppressions WHERE address='theirs@example.com'`))[0].id;
    assert.equal((await call(h, "DELETE", `/api/communications/suppressions/${theirId}`, as("admin"))).status, 404);
    for (const bad of ["channelType=voice", "reason=hacked"]) assert.equal((await call(h, "GET", `/api/communications/suppressions?${bad}`, as("viewer"))).status, 400, bad);
    assert.equal((await call(h, "DELETE", "/api/communications/suppressions/not-a-uuid", as("admin"))).status, 404);
  });
});

describe("a suppressed address is never sent to", () => {
  it("SEND API: refused with 422 recipient_suppressed before anything is stored; case-insensitive; other channels unaffected; audited", async () => {
    await suppress("manager", { channelType: "email", addresses: ["blocked@example.com"], reason: "unsubscribed" });
    const before = await count(`SELECT COUNT(*)::int AS n FROM public.communication_messages`);
    audit = [];
    const r = await sendEmail("Blocked@Example.COM");
    assert.equal(r.status, 422);
    assert.equal(r.json.error, "recipient_suppressed");
    assert.equal(await count(`SELECT COUNT(*)::int AS n FROM public.communication_messages`), before, "nothing stored or queued");
    assert.equal(audit.find((a) => a.action === "communication.message.rejected").metadata.code, "recipient_suppressed");
    assert.ok(!JSON.stringify(audit).includes("blocked@example.com"));
    assert.equal((await sendEmail("fine@example.com")).status, 201, "other addresses are unaffected");
    // same identifier on a different channel is a different suppression
    await suppress("manager", { channelType: "sms", addresses: ["+919811111111"] });
    const wa = await call(h, "POST", "/api/communications/send", { ...as("manager"), key: key(), body: { channelType: "whatsapp", recipient: "+919811111111", body: "hi" } });
    assert.equal(wa.status, 201);
  });

  it("removing the suppression re-enables sending", async () => {
    await suppress("manager", { channelType: "email", addresses: ["temp@example.com"] });
    assert.equal((await sendEmail("temp@example.com")).status, 422);
    const id = (await rows(`SELECT id FROM public.communication_suppressions WHERE address='temp@example.com'`))[0].id;
    await call(h, "DELETE", `/api/communications/suppressions/${id}`, as("admin"));
    assert.equal((await sendEmail("temp@example.com")).status, 201);
  });

  it("WORKER last-chance: a message queued BEFORE the address was suppressed is cancelled, not sent, and audited", async () => {
    const r = await sendEmail("late@example.com");
    assert.equal(r.status, 201);
    await suppress("manager", { channelType: "email", addresses: ["late@example.com"], reason: "unsubscribed" });
    audit = [];
    const out = (await handler.handle(await jobOf(r.json.message.id))) as any;
    assert.deepEqual([out.skipped, out.reason], [true, "suppressed"]);
    assert.equal(sent.length, 0, "no provider call");
    const m = (await rows(`SELECT status, error_message FROM public.communication_messages WHERE id=$1`, [r.json.message.id]))[0];
    assert.deepEqual([m.status, m.error_message], ["cancelled", "suppressed: unsubscribed"]);
    assert.equal(await count(`SELECT COUNT(*)::int AS n FROM public.communication_deliveries WHERE message_id=$1`, [r.json.message.id]), 0);
    assert.equal(audit.find((a) => a.action === "job.communication.suppressed").outcome, "denied");
  });

  it("CAMPAIGN audience excludes suppressed addresses and reports the count; an all-suppressed audience is refused", async () => {
    await suppress("manager", { channelType: "email", addresses: ["camp-blocked@example.com"] });
    const { r, id } = await campaign(["camp-ok1@example.com", "Camp-Blocked@example.com", "camp-ok2@example.com"]);
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.campaign.total_recipients, 2);
    assert.deepEqual(r.json.audience, { requested: 3, resolved: 2, notFound: 0, invalidAddress: 0, duplicate: 0, suppressed: 1 });
    assert.equal(await count(`SELECT COUNT(*)::int AS n FROM public.communication_campaign_recipients WHERE campaign_id=$1 AND lower(recipient)='camp-blocked@example.com'`, [id]), 0);

    await suppress("manager", { channelType: "email", addresses: ["only-blocked@example.com"] });
    const all = await campaign(["only-blocked@example.com"]);
    assert.equal(all.r.status, 400);
    assert.match(all.r.json.detail, /suppressed/);
  });

  it("CAMPAIGN expansion: an address suppressed AFTER creation is skipped (recipient 'suppressed', no message); the rest send", async () => {
    const { id } = await campaign(["exp-a@example.com", "exp-b@example.com", "exp-c@example.com"]);
    await verifyTest(id);
    await suppress("manager", { channelType: "email", addresses: ["exp-b@example.com"], reason: "unsubscribed" });
    await call(h, "POST", `/api/communications/campaigns/${id}/execute`, as("manager"));
    const out = (await handler.handle(await jobFor(`camp-run:${id}:1`))) as any;
    assert.deepEqual([out.queued, out.suppressed], [2, 1]);
    const rec = await rows(`SELECT recipient, status, message_id FROM public.communication_campaign_recipients WHERE campaign_id=$1 ORDER BY recipient`, [id]);
    assert.deepEqual(rec.map((x) => [x.recipient, x.status]), [["exp-a@example.com", "queued"], ["exp-b@example.com", "suppressed"], ["exp-c@example.com", "queued"]]);
    assert.equal(rec[1].message_id, null);
    for (const m of await rows(`SELECT id FROM public.communication_messages WHERE campaign_id=$1 AND NOT is_test`, [id])) await handler.handle(await jobOf(m.id));
    assert.equal(sent.filter((s) => s.recipient === "exp-b@example.com").length, 0);
    const d = (await call(h, "GET", `/api/communications/campaigns/${id}`, as("viewer"))).json;
    assert.deepEqual([d.campaign.status, d.campaign.sent_count, d.recipientCounts.suppressed], ["completed", 2, 1]);
  });

  it("CAMPAIGN worker: a queued campaign message is cancelled at send time and the recipient becomes 'suppressed'", async () => {
    const { id } = await campaign(["q-a@example.com", "q-b@example.com"]);
    await verifyTest(id);
    await call(h, "POST", `/api/communications/campaigns/${id}/execute`, as("manager"));
    await handler.handle(await jobFor(`camp-run:${id}:1`));
    await suppress("manager", { channelType: "email", addresses: ["q-a@example.com"] }); // unsubscribes after queueing
    for (const m of await rows(`SELECT id FROM public.communication_messages WHERE campaign_id=$1 AND NOT is_test ORDER BY recipient`, [id])) await handler.handle(await jobOf(m.id));
    assert.deepEqual(sent.map((s) => s.recipient), ["q-b@example.com"]);
    const d = (await call(h, "GET", `/api/communications/campaigns/${id}`, as("viewer"))).json;
    assert.deepEqual([d.campaign.status, d.recipientCounts.sent, d.recipientCounts.suppressed], ["completed", 1, 1]);
  });

  it("TEST SEND to a suppressed address is refused too", async () => {
    const { id } = await campaign(["t-a@example.com"]);
    await suppress("manager", { channelType: "email", addresses: ["owner-suppressed@example.com"] });
    const r = await call(h, "POST", `/api/communications/campaigns/${id}/test`, { ...as("manager"), key: key(), body: { testRecipient: "owner-suppressed@example.com" } });
    assert.equal(r.status, 422);
  });
});

describe("email campaigns require a working unsubscribe link (fail closed)", () => {
  it("creating one whose template lacks {{unsubscribe_url}} is refused", async () => {
    const templateId = await template("No link here");
    const c = await seedContact(t.db, orgA, { first: "N", email: "nolink@example.com" });
    const r = await call(h, "POST", "/api/communications/campaigns", { ...as("manager"), body: { name: "c", channelType: "email", templateId, contactIds: [c], consentConfirmed: true } });
    assert.equal(r.status, 400);
    assert.match(r.json.detail, /unsubscribe_url/);
  });

  it("the test message and every campaign message carry the RECIPIENT'S own verifiable link, in the body AND the provider headers", async () => {
    const { id } = await campaign(["link-a@example.com"]);
    const test = await verifyTest(id);
    const tm = (await rows(`SELECT body FROM public.communication_messages WHERE id=$1`, [test.json.message.id]))[0];
    const bodyUrl = /href="([^"]+)"/.exec(tm.body)![1];
    assert.equal(verifyUnsubscribeToken(new URL(bodyUrl).searchParams.get("t"), UNSUBSCRIBE_TEST_SECRET)?.address, "owner@example.com");

    await call(h, "POST", `/api/communications/campaigns/${id}/execute`, as("manager"));
    await handler.handle(await jobFor(`camp-run:${id}:1`));
    for (const m of await rows(`SELECT id FROM public.communication_messages WHERE campaign_id=$1 AND NOT is_test`, [id])) await handler.handle(await jobOf(m.id));
    assert.equal(sent.length, 1);
    const claims = verifyUnsubscribeToken(new URL(sent[0].unsubscribeUrl!).searchParams.get("t"), UNSUBSCRIBE_TEST_SECRET);
    assert.deepEqual([claims?.organizationId, claims?.channel, claims?.address], [orgA, "email", "link-a@example.com"]);
    assert.ok(sent[0].body.includes(sent[0].unsubscribeUrl!), "the same link is in the visible body");
  });

  it("without COMM_UNSUBSCRIBE_SECRET / COMM_PUBLIC_BASE_URL: test and campaign are usable to create, but schedule/execute are refused (409) and the API says why", async () => {
    const { id } = await campaign(["cfg-a@example.com"]);
    await verifyTest(id);
    restoreEnv();
    try {
      const d = (await call(h, "GET", `/api/communications/campaigns/${id}`, as("viewer"))).json;
      assert.equal(d.unsubscribeReady, false);
      const e = await call(h, "POST", `/api/communications/campaigns/${id}/execute`, as("manager"));
      assert.deepEqual([e.status, e.json.error], [409, "unsubscribe_not_configured"]);
      const s = await call(h, "POST", `/api/communications/campaigns/${id}/schedule`, { ...as("manager"), body: { scheduledAt: new Date(Date.now() + 3600_000).toISOString() } });
      assert.deepEqual([s.status, s.json.error], [409, "unsubscribe_not_configured"]);
      const t2 = await call(h, "POST", `/api/communications/campaigns/${id}/test`, { ...as("manager"), key: key(), body: { testRecipient: "owner@example.com" } });
      assert.equal(t2.status, 409, "even a test cannot omit the link");
    } finally {
      restoreEnv = useUnsubscribeEnv();
    }
  });

  it("if the configuration disappears AFTER a campaign started, the worker PAUSES it instead of sending without an opt-out", async () => {
    const { id } = await campaign(["gone-a@example.com"]);
    await verifyTest(id);
    await call(h, "POST", `/api/communications/campaigns/${id}/execute`, as("manager"));
    restoreEnv();
    try {
      const out = (await handler.handle(await jobFor(`camp-run:${id}:1`))) as any;
      assert.equal(out.paused, "unsubscribe_not_configured");
      const c = (await rows(`SELECT status, paused_reason FROM public.communication_campaigns WHERE id=$1`, [id]))[0];
      assert.deepEqual([c.status, c.paused_reason], ["paused", "unsubscribe_not_configured"]);
      assert.equal(sent.length, 0);
    } finally {
      restoreEnv = useUnsubscribeEnv();
    }
  });

  it("a campaign email already queued when the configuration disappears FAILS closed (UNSUBSCRIBE_NOT_CONFIGURED), no provider call", async () => {
    const { id } = await campaign(["fc-a@example.com"]);
    await verifyTest(id);
    await call(h, "POST", `/api/communications/campaigns/${id}/execute`, as("manager"));
    await handler.handle(await jobFor(`camp-run:${id}:1`));
    restoreEnv();
    try {
      const m = (await rows(`SELECT id FROM public.communication_messages WHERE campaign_id=$1 AND NOT is_test`, [id]))[0];
      await assert.rejects(handler.handle(await jobOf(m.id)), /UNSUBSCRIBE_NOT_CONFIGURED/);
      assert.equal(sent.length, 0);
    } finally {
      restoreEnv = useUnsubscribeEnv();
    }
  });

  it("plain (non-campaign) sends and non-email channels are not forced to carry a link", async () => {
    const r = await sendEmail("plain@example.com");
    assert.equal(r.status, 201);
    await handler.handle(await jobOf(r.json.message.id));
    assert.equal(sent[0].unsubscribeUrl, undefined);
  });
});

describe("public unsubscribe endpoint", () => {
  const tokenFor = (address: string, org = orgA, channel: "email" | "sms" | "whatsapp" = "email", secret = UNSUBSCRIBE_TEST_SECRET) =>
    signUnsubscribeToken({ organizationId: org, channel, address }, secret);
  const url = (tok: string) => `/api/communications/unsubscribe?t=${encodeURIComponent(tok)}`;
  const raw = async (method: string, path: string, body?: string, contentType?: string) => {
    const res = await fetch(h.url + path, { method, headers: contentType ? { "content-type": contentType } : {}, body });
    return { status: res.status, text: await res.text(), headers: res.headers };
  };

  it("GET renders a confirmation page and changes NOTHING (mail scanners prefetch links)", async () => {
    const r = await raw("GET", url(tokenFor("scan@example.com")));
    assert.equal(r.status, 200);
    assert.match(r.text, /<form method="post"/);
    assert.equal(await count(`SELECT COUNT(*)::int AS n FROM public.communication_suppressions WHERE address='scan@example.com'`), 0);
  });

  it("POST unsubscribes exactly that address in that organization, idempotently; the page masks the address", async () => {
    const tok = tokenFor("Person@Example.com");
    const r = await raw("POST", url(tok));
    assert.equal(r.status, 200);
    assert.match(r.text, /unsubscribed/i);
    assert.ok(!r.text.includes("Person@Example.com") && !r.text.includes("person@example.com"), "full address is not shown");
    const s = (await rows(`SELECT organization_id, channel_type, address, reason, source FROM public.communication_suppressions WHERE address='person@example.com'`))[0];
    assert.deepEqual([s.organization_id, s.channel_type, s.reason, s.source], [orgA, "email", "unsubscribed", "unsubscribe_link"]);
    assert.equal((await raw("POST", url(tok))).status, 200);
    assert.equal(await count(`SELECT COUNT(*)::int AS n FROM public.communication_suppressions WHERE address='person@example.com'`), 1);
    assert.equal((await sendEmail("person@example.com")).status, 422, "and from now on nothing is sent to them");
  });

  it("supports RFC 8058 one-click (form-encoded body from the mail client) and does not need a login", async () => {
    const r = await raw("POST", url(tokenFor("oneclick@example.com")), "List-Unsubscribe=One-Click", "application/x-www-form-urlencoded");
    assert.equal(r.status, 200);
    assert.equal(await count(`SELECT COUNT(*)::int AS n FROM public.communication_suppressions WHERE address='oneclick@example.com'`), 1);
  });

  it("a token for organization A cannot suppress anything in organization B", async () => {
    await raw("POST", url(tokenFor("scoped@example.com", orgA)));
    assert.equal(await count(`SELECT COUNT(*)::int AS n FROM public.communication_suppressions WHERE address='scoped@example.com' AND organization_id=$1`, [orgB]), 0);
    assert.equal(await count(`SELECT COUNT(*)::int AS n FROM public.communication_suppressions WHERE address='scoped@example.com' AND organization_id=$1`, [orgA]), 1);
  });

  it("forged / altered / missing tokens are rejected (400) and change nothing", async () => {
    const before = await count(`SELECT COUNT(*)::int AS n FROM public.communication_suppressions`);
    const good = tokenFor("forge@example.com");
    for (const bad of [tokenFor("forge@example.com", orgA, "email", "another-secret-0123456789abcdef"), good.slice(0, -3) + "AAA", "garbage", ""]) {
      const r = await raw("POST", `/api/communications/unsubscribe?t=${encodeURIComponent(bad)}`);
      assert.equal(r.status, 400, bad.slice(0, 20));
      assert.ok(!r.text.includes("forge@example.com"));
    }
    assert.equal((await raw("POST", "/api/communications/unsubscribe")).status, 400);
    assert.equal((await raw("GET", "/api/communications/unsubscribe")).status, 400);
    assert.equal(await count(`SELECT COUNT(*)::int AS n FROM public.communication_suppressions`), before);
  });

  it("is hardened: no-store, noindex, a locked-down CSP, no script, and no cookies", async () => {
    const r = await raw("GET", url(tokenFor("h@example.com")));
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal(r.headers.get("x-robots-tag"), "noindex");
    assert.match(r.headers.get("content-security-policy")!, /default-src 'none'/);
    assert.ok(!/<script/i.test(r.text));
    assert.equal(r.headers.get("set-cookie"), null);
  });

  it("without configuration it says so (503) rather than pretending to work", async () => {
    restoreEnv();
    try {
      const r = await raw("POST", url(tokenFor("nocfg@example.com")));
      assert.equal(r.status, 503);
      assert.equal(await count(`SELECT COUNT(*)::int AS n FROM public.communication_suppressions WHERE address='nocfg@example.com'`), 0);
    } finally {
      restoreEnv = useUnsubscribeEnv();
    }
  });

  it("an unsubscribe is audited without the address", async () => {
    audit = [];
    await raw("POST", url(tokenFor("audited@example.com")));
    const e = audit.find((a) => a.action === "communication.suppression.added" && a.actor === "public:unsubscribe_link");
    assert.ok(e);
    assert.ok(!JSON.stringify(e).includes("audited@example.com"));
  });
});
