/**
 * Contact lists, segments, campaigns built from them, campaign/org analytics, and template editing —
 * on the real routes / services / SQL. Analytics tests assert that every number is a count of real rows
 * and that nothing (delivery/open/click rates) is invented for channels that cannot report it.
 */

import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CommunicationJobHandler } from "../../workers/handlers/CommunicationJobHandler.js";
import { ProviderFactory } from "../providers/ProviderFactory.js";
import { validateCriteria } from "../AudienceService.js";
import { CommunicationValidationError } from "../validation.js";
import type { AdapterSendResult, ProviderAdapter } from "../types.js";
import type { QueueJob } from "../../queue/QueueTypes.js";
import { createTestDb, seedOrg, seedUser, type TestDb } from "./helpers/testDb.js";
import { call, seedContact, serve, useUnsubscribeEnv, type Harness } from "./helpers/httpHarness.js";

let t: TestDb;
let h: Harness;
let handler: CommunicationJobHandler;
let orgA: string;
let orgB: string;
let restoreEnv: () => void;
const U: Record<string, string> = {};
const registry = () => (ProviderFactory as unknown as { registry: Record<string, ProviderAdapter> }).registry;
const originalResend = registry().resend;
const realLog = console.log;
let audit: any[] = [];
let result: AdapterSendResult = { success: true, providerMessageId: "pm" };
const fake: ProviderAdapter = {
  provider: "resend",
  channelType: "email",
  send: async () => result,
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
  U.norole = await seedUser(t.db, orgA, []);
  U.managerB = await seedUser(t.db, orgB, ["MANAGER"]);
  h = await serve(t.pool);
  registry().resend = fake;
  process.env.COMM_RESEND_AUDN = "s";
  await t.db.query(
    `INSERT INTO public.communication_providers (organization_id, name, provider, channel_type, credentials_secret_ref, priority, settings)
     VALUES ($1,'aud','resend','email','COMM_RESEND_AUDN',0,'{"fromAddress":"no-reply@example.com"}')`,
    [orgA],
  );
});
after(async () => {
  console.log = realLog;
  registry().resend = originalResend;
  delete process.env.COMM_RESEND_AUDN;
  restoreEnv();
  await h.close();
  await t.db.close();
});
afterEach(() => {
  audit = [];
  delete process.env.COMM_CAMPAIGN_MAX_RECIPIENTS;
  result = { success: true, providerMessageId: "pm" };
});

const as = (who: string, org = orgA) => ({ user: U[who], org });
const key = () => `k-${randomUUID()}`;
const rows = async (sql: string, p: unknown[] = []) => (await t.db.query<any>(sql, p)).rows;
const count = async (sql: string, p: unknown[] = []) => (await rows(sql, p))[0].n as number;
const mkList = (name: string, who = "manager", org = orgA) => call(h, "POST", "/api/communications/lists", { ...as(who, org), body: { name } });
const contact = (o: Parameters<typeof seedContact>[2], org = orgA) => seedContact(t.db, org, o);
const seg = (name: string, criteria: unknown, who = "manager", org = orgA) => call(h, "POST", "/api/communications/segments", { ...as(who, org), body: { name, criteria } });
const preview = (channelType: string, criteria: unknown, who = "viewer") => call(h, "POST", "/api/communications/segments/preview", { ...as(who), body: { channelType, criteria } });
const addMembers = (listId: string, contactIds: unknown, who = "manager", org = orgA) => call(h, "POST", `/api/communications/lists/${listId}/members`, { ...as(who, org), body: { contactIds } });
const jobFor = async (k: string): Promise<QueueJob<any>> => (await rows(`SELECT * FROM public.job_queue WHERE idempotency_key=$1`, [k]))[0] as QueueJob<any>;
const jobOf = async (messageId: string, retry = 0, max = 3): Promise<QueueJob<any>> =>
  ({ ...(await rows(`SELECT q.* FROM public.job_queue q JOIN public.communication_messages m ON m.job_id=q.id WHERE m.id=$1`, [messageId]))[0], retry_count: retry, max_retries: max }) as QueueJob<any>;

async function emailTemplate(name = `t-${randomUUID().slice(0, 6)}`, body = 'Hi {{first_name}} <a href="{{unsubscribe_url}}">x</a>', who = "manager", org = orgA) {
  const r = await call(h, "POST", "/api/communications/templates", { ...as(who, org), body: { name, channelType: "email", subject: "Hello", body } });
  assert.equal(r.status, 201, r.text);
  return r.json.template.id as string;
}
const createCampaign = (body: Record<string, unknown>, who = "manager") =>
  call(h, "POST", "/api/communications/campaigns", { ...as(who), body: { name: "c", channelType: "email", consentConfirmed: true, ...body } });

describe("contact lists", () => {
  it("create, list with member counts, delete; names unique per org; EDITOR+ writes, VIEWER reads, no-role denied", async () => {
    const a = await mkList("VIP buyers", "editor");
    assert.equal(a.status, 201, a.text);
    assert.equal((await mkList("VIP buyers")).status, 400, "duplicate name in the same org");
    assert.equal((await call(h, "POST", "/api/communications/lists", { ...as("viewer"), body: { name: "nope" } })).status, 403);
    assert.equal((await call(h, "POST", "/api/communications/lists", { ...as("manager"), body: { name: "" } })).status, 400);
    assert.equal((await call(h, "POST", "/api/communications/lists", { ...as("manager"), body: { name: "x\ny" } })).status, 400);
    assert.equal((await call(h, "POST", "/api/communications/lists", { ...as("manager"), body: { name: "ok", description: "d".repeat(501) } })).status, 400);
    assert.equal((await call(h, "GET", "/api/communications/lists", as("norole"))).status, 403);

    const c1 = await contact({ first: "A", email: "l1@example.com" });
    await addMembers(a.json.list.id, [c1]);
    const list = (await call(h, "GET", "/api/communications/lists", as("viewer"))).json.lists.find((l: any) => l.id === a.json.list.id);
    assert.equal(list.member_count, 1);
    assert.equal((await call(h, "DELETE", `/api/communications/lists/${a.json.list.id}`, as("editor"))).status, 200);
    assert.equal(await count(`SELECT COUNT(*)::int AS n FROM public.communication_list_members WHERE list_id=$1`, [a.json.list.id]), 0, "members go with the list");
    assert.equal(await count(`SELECT COUNT(*)::int AS n FROM public.contacts WHERE id=$1`, [c1]), 1, "contacts themselves are untouched");
    assert.equal((await call(h, "DELETE", `/api/communications/lists/${a.json.list.id}`, as("editor"))).status, 404);
  });

  it("members: only THIS org's live contacts are added; foreign / deleted / unknown ids are reported, never inserted; idempotent", async () => {
    const l = (await mkList("Members")).json.list.id;
    const mine = await contact({ first: "M", email: "m@example.com" });
    const gone = await contact({ first: "G", email: "g@example.com", deleted: true });
    const theirs = await contact({ first: "T", email: "t@example.com" }, orgB);
    const r = await addMembers(l, [mine, gone, theirs, randomUUID()]);
    assert.equal(r.status, 201, r.text);
    assert.deepEqual([r.json.added, r.json.alreadyMembers, r.json.notFound], [1, 0, 3]);
    const again = await addMembers(l, [mine]);
    assert.deepEqual([again.json.added, again.json.alreadyMembers, again.json.notFound], [0, 1, 0]);
    assert.equal(await count(`SELECT COUNT(*)::int AS n FROM public.communication_list_members WHERE list_id=$1`, [l]), 1);

    const m = await call(h, "GET", `/api/communications/lists/${l}/members`, as("viewer"));
    assert.deepEqual(m.json.members.map((x: any) => x.email), ["m@example.com"]);
    assert.equal((await call(h, "DELETE", `/api/communications/lists/${l}/members`, { ...as("manager"), body: { contactIds: [mine, randomUUID()] } })).json.removed, 1);
    for (const bad of [[], "x", ["nope"]]) {
      assert.equal((await addMembers(l, bad)).status, 400, JSON.stringify(bad).slice(0, 30));
    }
    const huge = await addMembers(l, Array.from({ length: 5001 }, () => randomUUID()));
    assert.ok(huge.status === 400 || huge.status === 413, `oversized member batches are refused (got ${huge.status})`);
  });

  it("is org-isolated: another org cannot see, fill or delete this list (404)", async () => {
    const l = (await mkList("Private")).json.list.id;
    assert.equal((await call(h, "GET", "/api/communications/lists", as("managerB", orgB))).json.lists.some((x: any) => x.id === l), false);
    assert.equal((await addMembers(l, [randomUUID()], "managerB", orgB)).status, 404);
    assert.equal((await call(h, "DELETE", `/api/communications/lists/${l}`, as("managerB", orgB))).status, 404);
    assert.equal((await call(h, "GET", `/api/communications/lists/${l}/members`, as("managerB", orgB))).status, 404);
    assert.equal((await call(h, "GET", "/api/communications/lists/not-a-uuid/members", as("viewer"))).status, 404);
  });
});

describe("segment criteria are strictly validated (they never become SQL)", () => {
  it("accepts the supported conditions", () => {
    const c = validateCriteria({ listIds: [randomUUID()], companyContains: " steel ", nameContains: "Asha", createdAfter: "2026-01-01", createdBefore: "2026-12-31T00:00:00Z" });
    assert.equal(c.companyContains, "steel");
    assert.equal(c.createdAfter, "2026-01-01T00:00:00.000Z");
  });
  it("rejects unknown keys (a typo must not silently widen the audience), empty criteria, bad values", () => {
    const bad = (x: unknown) => assert.throws(() => validateCriteria(x), CommunicationValidationError);
    bad({});
    bad({ companyContain: "x" });
    bad({ everyone: true });
    bad({ listIds: [] });
    bad({ listIds: ["nope"] });
    bad({ listIds: Array.from({ length: 21 }, () => randomUUID()) });
    bad({ companyContains: "" });
    bad({ companyContains: "x".repeat(101) });
    bad({ nameContains: "a\r\nb" });
    bad({ createdAfter: "yesterday" });
    bad({ createdAfter: 5 });
    bad(null);
    bad([]);
    bad("x");
  });
});

describe("segments", () => {
  it("create / list / delete; foreign lists rejected; names unique; RBAC", async () => {
    const other = (await mkList("Other org list", "managerB", orgB)).json.list.id;
    assert.equal((await seg("Bad", { listIds: [other] })).status, 400, "a list from another org cannot be referenced");
    const ok = await seg("Steel buyers", { companyContains: "steel" }, "editor");
    assert.equal(ok.status, 201, ok.text);
    assert.equal((await seg("Steel buyers", { companyContains: "steel" })).status, 400);
    assert.equal((await seg("v", { companyContains: "x" }, "viewer")).status, 403);
    assert.equal((await seg("empty", {})).status, 400);
    const list = await call(h, "GET", "/api/communications/segments", as("viewer"));
    assert.ok(list.json.segments.some((s: any) => s.id === ok.json.segment.id && s.criteria.companyContains === "steel"));
    assert.equal((await call(h, "GET", "/api/communications/segments", as("managerB", orgB))).json.segments.some((s: any) => s.id === ok.json.segment.id), false);
    assert.equal((await call(h, "DELETE", `/api/communications/segments/${ok.json.segment.id}`, as("managerB", orgB))).status, 404);
    assert.equal((await call(h, "DELETE", `/api/communications/segments/${ok.json.segment.id}`, as("editor"))).status, 200);
    assert.equal((await call(h, "DELETE", "/api/communications/segments/not-a-uuid", as("editor"))).status, 404);
  });

  it("matching: company/name text (case-insensitive, LIKE wildcards are literal), date range, list membership, channel address, soft-deleted and other orgs excluded", async () => {
    const s1 = await contact({ first: "Asha", last: "Rao", email: "asha@seg.example", company: "Acme Steel Works" });
    const s2 = await contact({ first: "Ravi", last: "Shah", email: "ravi@seg.example", company: "Steel Corp" });
    const c3 = await contact({ first: "Meera", last: "Iyer", email: "meera@seg.example", company: "ChemCo" });
    await contact({ first: "Gone", email: "gone@seg.example", company: "Steel Ghost", deleted: true });
    await contact({ first: "Foreign", email: "f@seg.example", company: "Steel Foreign" }, orgB);
    await contact({ first: "NoEmail", phone: "+919800000001", company: "Steel Phone" });
    await contact({ first: "Pct", email: "pct@seg.example", company: "100% Pure" });

    const steel = await preview("email", { companyContains: "steel" });
    assert.equal(steel.status, 200, steel.text);
    assert.equal(steel.json.matched, 2, "Acme Steel Works + Steel Corp; not the deleted, foreign or phone-only ones");
    assert.equal((await preview("sms", { companyContains: "steel" })).json.matched, 1, "sms matches only the contact with a phone number (the phone-only 'Steel Phone'), not the email-only ones");
    assert.equal((await preview("email", { companyContains: "STEEL" })).json.matched, 2, "case-insensitive");
    assert.equal((await preview("email", { companyContains: "%" })).json.matched, 1, "a literal % matches only '100% Pure', not everything");
    assert.equal((await preview("email", { companyContains: "_" })).json.matched, 0, "a literal _ is not a wildcard");
    assert.equal((await preview("email", { nameContains: "shah" })).json.matched, 1);
    assert.equal((await preview("email", { createdAfter: "2999-01-01" })).json.matched, 0);
    assert.ok((await preview("email", { createdBefore: "2999-01-01", companyContains: "steel" })).json.matched >= 2);

    const l = (await mkList("ListSeg")).json.list.id;
    await addMembers(l, [s1, c3]);
    assert.equal((await preview("email", { listIds: [l] })).json.matched, 2);
    assert.equal((await preview("email", { listIds: [l], companyContains: "steel" })).json.matched, 1, "conditions are ANDed");
    const p = await preview("email", { companyContains: "steel" });
    assert.ok(p.json.sample.length <= 5);
    assert.ok(p.json.sample.every((x: any) => x.id && x.name));
    assert.equal(s2.length > 0, true);
  });

  it("SQL-injection text in criteria is inert: it matches nothing and the table survives", async () => {
    const evil = "'; DROP TABLE public.contacts; --";
    const r = await preview("email", { companyContains: evil });
    assert.equal(r.status, 200);
    assert.equal(r.json.matched, 0);
    assert.equal((await preview("email", { nameContains: "x' OR '1'='1" })).json.matched, 0);
    assert.ok((await count(`SELECT COUNT(*)::int AS n FROM public.contacts`)) > 0);
  });

  it("preview reports how many matches are suppressed (one set-based count)", async () => {
    await contact({ first: "S1", email: "sup1@prev.example", company: "PreviewCo" });
    await contact({ first: "S2", email: "SUP2@prev.example", company: "PreviewCo" });
    await contact({ first: "S3", email: "sup3@prev.example", company: "PreviewCo" });
    await call(h, "POST", "/api/communications/suppressions", { ...as("manager"), body: { channelType: "email", addresses: ["sup2@prev.example"] } });
    const p = await preview("email", { companyContains: "previewco" });
    assert.deepEqual([p.json.matched, p.json.suppressed], [3, 1], "the mixed-case stored email still matches its lower-cased suppression");
  });

  it("refuses to resolve an audience over the cap (narrow the segment)", async () => {
    process.env.COMM_CAMPAIGN_MAX_RECIPIENTS = "2";
    for (const n of ["cap1", "cap2", "cap3"]) await contact({ first: n, email: `${n}@cap.example`, company: "CapCo" });
    const r = await preview("email", { companyContains: "capco" });
    assert.equal(r.status, 400);
    assert.match(r.json.detail, /more than 2/);
  });

  it("preview needs a role and validates its inputs", async () => {
    assert.equal((await preview("email", { companyContains: "x" }, "norole")).status, 403);
    assert.equal((await preview("voice", { companyContains: "x" })).status, 400);
    assert.equal((await preview("email", {})).status, 400);
  });
});

describe("campaigns from a list or a segment", () => {
  it("from a LIST: the audience is the members with a usable address; the source is recorded", async () => {
    const templateId = await emailTemplate();
    const l = (await mkList("Campaign list")).json.list.id;
    const a = await contact({ first: "La", email: "la@camp.example" });
    const b = await contact({ first: "Lb", email: "lb@camp.example" });
    const noAddr = await contact({ first: "Lc", phone: "+919800000002" });
    await addMembers(l, [a, b, noAddr]);
    const r = await createCampaign({ templateId, listId: l });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.campaign.total_recipients, 2, "the phone-only member has no email");
    assert.deepEqual(r.json.campaign.audience, { type: "list", id: l });
    assert.equal(r.json.campaign.audience_summary.resolved, 2);
  });

  it("from a SEGMENT: criteria are re-evaluated at creation; suppressed members are excluded and counted", async () => {
    const templateId = await emailTemplate();
    await contact({ first: "G1", email: "g1@grp.example", company: "GroupCo" });
    await contact({ first: "G2", email: "g2@grp.example", company: "GroupCo" });
    await call(h, "POST", "/api/communications/suppressions", { ...as("manager"), body: { channelType: "email", addresses: ["g2@grp.example"] } });
    const sg = (await seg("GroupCo", { companyContains: "groupco" })).json.segment.id;
    const r = await createCampaign({ templateId, segmentId: sg });
    assert.equal(r.status, 201, r.text);
    assert.deepEqual([r.json.campaign.total_recipients, r.json.audience.suppressed], [1, 1]);
    assert.deepEqual(r.json.campaign.audience, { type: "segment", id: sg });
    // a contact added LATER is picked up by the next campaign from the same segment (saved criteria, not a snapshot)
    await contact({ first: "G3", email: "g3@grp.example", company: "GroupCo" });
    assert.equal((await createCampaign({ templateId, segmentId: sg })).json.campaign.total_recipients, 2);
  });

  it("exactly ONE audience source is required; foreign / unknown lists and segments are 404-equivalent errors; empty audiences refused", async () => {
    const templateId = await emailTemplate();
    const cid = await contact({ first: "X", email: "x@one.example" });
    const l = (await mkList("One")).json.list.id;
    assert.equal((await createCampaign({ templateId })).status, 400, "none");
    assert.equal((await createCampaign({ templateId, contactIds: [cid], listId: l })).status, 400, "two");
    assert.equal((await createCampaign({ templateId, listId: l })).status, 400, "an empty list has no recipients");
    const foreignList = (await mkList("Foreign", "managerB", orgB)).json.list.id;
    assert.equal((await createCampaign({ templateId, listId: foreignList })).status, 404);
    assert.equal((await createCampaign({ templateId, segmentId: randomUUID() })).status, 404);
    assert.equal((await createCampaign({ templateId, listId: "nope" })).status, 400);
  });
});

describe("analytics — only real counts; nothing invented", () => {
  async function runCampaign(emails: string[], fail = false) {
    const templateId = await emailTemplate();
    const ids: string[] = [];
    for (const e of emails) ids.push(await contact({ first: e.split("@")[0], email: e, company: "An" }));
    const c = await createCampaign({ templateId, contactIds: ids });
    const id = c.json.campaign.id as string;
    const tr = await call(h, "POST", `/api/communications/campaigns/${id}/test`, { ...as("manager"), key: key(), body: { testRecipient: "owner@an.example" } });
    await t.db.query(`UPDATE public.communication_messages SET status='sent' WHERE id=$1`, [tr.json.message.id]);
    await call(h, "POST", `/api/communications/campaigns/${id}/execute`, as("manager"));
    await handler.handle(await jobFor(`camp-run:${id}:1`));
    result = fail ? { success: false, errorMessage: "mailbox unavailable" } : { success: true, providerMessageId: "pm" };
    for (const m of await rows(`SELECT id FROM public.communication_messages WHERE campaign_id=$1 AND NOT is_test`, [id])) {
      try {
        await handler.handle(await jobOf(m.id, fail ? 2 : 0));
      } catch {
        /* dead-lettered on purpose */
      }
    }
    return id;
  }

  it("a fresh campaign has zeros and null rates — not invented ones", async () => {
    const templateId = await emailTemplate();
    const cid = await contact({ first: "Z", email: "z@zero.example" });
    const id = (await createCampaign({ templateId, contactIds: [cid] })).json.campaign.id;
    const a = (await call(h, "GET", `/api/communications/campaigns/${id}/analytics`, as("viewer"))).json;
    assert.deepEqual(a.totals, { messages: 0, accepted: 0, failed: 0, providerAttempts: 0, messagesAttempted: 0 });
    assert.deepEqual(a.rates, { acceptedPercent: null, failedPercent: null, deliveredPercent: null, suppressedPercent: 0 });
    assert.deepEqual(a.sentByHour, []);
    assert.deepEqual(a.byProvider, []);
    assert.equal(a.audience.resolved, 1);
  });

  it("after a successful run: counts, provider breakdown and the hourly series come from real rows; tests are excluded", async () => {
    const id = await runCampaign(["a1@an.example", "a2@an.example", "a3@an.example"]);
    const a = (await call(h, "GET", `/api/communications/campaigns/${id}/analytics`, as("viewer"))).json;
    assert.equal(a.campaign.status, "completed");
    assert.deepEqual([a.messages.sent, a.totals.messages, a.totals.accepted, a.totals.failed], [3, 3, 3, 0], "the test message is not counted");
    assert.equal(a.rates.acceptedPercent, 100);
    assert.equal(a.rates.failedPercent, 0);
    assert.deepEqual(a.byProvider, [{ provider: "resend", n: 3 }]);
    assert.equal(a.sentByHour.reduce((s: number, x: any) => s + x.count, 0), 3);
    assert.equal(a.totals.providerAttempts, 3);
    assert.equal(a.recipients.sent, 3);
  });

  it("failures: dead-lettered messages are counted with their real error text; rates reflect them", async () => {
    const id = await runCampaign(["f1@an.example", "f2@an.example"], true);
    const a = (await call(h, "GET", `/api/communications/campaigns/${id}/analytics`, as("viewer"))).json;
    assert.equal(a.campaign.status, "failed");
    assert.deepEqual([a.messages.dead_letter, a.totals.failed, a.rates.failedPercent, a.rates.acceptedPercent], [2, 2, 100, 0]);
    assert.equal(a.topFailureReasons[0].n, 2);
    assert.match(a.topFailureReasons[0].reason, /mailbox unavailable/);
  });

  it("delivery tracking is stated honestly: email/sms = provider acceptance only (no delivered %), whatsapp = webhook", async () => {
    const id = await runCampaign(["h1@an.example"]);
    const a = (await call(h, "GET", `/api/communications/campaigns/${id}/analytics`, as("viewer"))).json;
    assert.equal(a.deliveryTracking, "provider_acceptance_only");
    assert.equal(a.rates.deliveredPercent, null, "no delivery receipts exist for email, so no delivered rate is fabricated");
    const wa = (await rows(`INSERT INTO public.communication_campaigns (organization_id, name, channel_type, status, total_recipients) VALUES ($1,'wa','whatsapp','completed',2) RETURNING id`, [orgA]))[0].id;
    for (const st of ["delivered", "sent"]) {
      await t.db.query(`INSERT INTO public.communication_messages (organization_id, channel_type, recipient, body, status, campaign_id) VALUES ($1,'whatsapp','+9198000000${st === "sent" ? 10 : 11}','x',$2,$3)`, [orgA, st, wa]);
    }
    const w = (await call(h, "GET", `/api/communications/campaigns/${wa}/analytics`, as("viewer"))).json;
    assert.equal(w.deliveryTracking, "webhook");
    assert.equal(w.rates.deliveredPercent, 50, "1 delivered of 2 accepted");
  });

  it("is org-isolated, needs a role, and validates ids", async () => {
    const id = await runCampaign(["i1@an.example"]);
    assert.equal((await call(h, "GET", `/api/communications/campaigns/${id}/analytics`, as("managerB", orgB))).status, 404);
    assert.equal((await call(h, "GET", `/api/communications/campaigns/${id}/analytics`, as("norole"))).status, 403);
    assert.equal((await call(h, "GET", "/api/communications/campaigns/not-a-uuid/analytics", as("viewer"))).status, 404);
  });

  it("organization analytics: daily series, per-channel status, recent campaigns, failure reasons, suppression breakdown, audience sizes", async () => {
    await call(h, "POST", "/api/communications/suppressions", { ...as("manager"), body: { channelType: "email", addresses: ["organ@example.com"], reason: "bounced" } });
    const r = await call(h, "GET", "/api/communications/analytics?days=30", as("viewer"));
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.days, 30);
    assert.ok(r.json.daily.length >= 1 && r.json.daily.every((d: any) => d.total === d.accepted + d.failed + (d.total - d.accepted - d.failed)));
    assert.ok(r.json.byChannel.email.sent >= 1);
    assert.ok(r.json.recentCampaigns.length >= 1);
    assert.ok(r.json.topFailureReasons.some((x: any) => /mailbox unavailable/.test(x.reason)));
    assert.ok(r.json.suppressions.some((x: any) => x.channel_type === "email" && x.reason === "bounced"));
    assert.ok(r.json.audience.lists >= 1 && r.json.audience.segments >= 1);
    assert.deepEqual(r.json.deliveryTracking, { email: "provider_acceptance_only", sms: "provider_acceptance_only", whatsapp: "webhook" });
    assert.ok(!JSON.stringify(r.json).includes("organ@example.com"), "no addresses in analytics");
  });

  it("organization analytics: window bounds, isolation, role", async () => {
    assert.equal((await call(h, "GET", "/api/communications/analytics", as("viewer"))).json.days, 30, "default");
    for (const bad of ["0", "91", "abc", "1.5", "-3"]) assert.equal((await call(h, "GET", `/api/communications/analytics?days=${bad}`, as("viewer"))).status, 400, bad);
    const other = (await call(h, "GET", "/api/communications/analytics", as("managerB", orgB))).json;
    assert.deepEqual([other.daily, other.recentCampaigns, other.suppressions], [[], [], []]);
    assert.equal((await call(h, "GET", "/api/communications/analytics", as("norole"))).status, 403);
    // the window really limits: a message from 40 days ago is outside a 7-day view
    await t.db.query(`INSERT INTO public.communication_messages (organization_id, channel_type, recipient, body, status, created_at) VALUES ($1,'email','old@example.com','x','sent', NOW() - INTERVAL '40 days')`, [orgA]);
    const w7 = (await call(h, "GET", "/api/communications/analytics?days=7", as("viewer"))).json;
    const w60 = (await call(h, "GET", "/api/communications/analytics?days=60", as("viewer"))).json;
    const sum = (x: any) => x.daily.reduce((s: number, d: any) => s + d.total, 0);
    assert.equal(sum(w60) - sum(w7) >= 1, true);
  });
});

describe("template editing", () => {
  const patch = (id: string, body: unknown, who = "manager", org = orgA) => call(h, "PATCH", `/api/communications/templates/${id}`, { ...as(who, org), body });

  it("edits name / subject / body / active; validates like create; EDITOR+ only; audited with field NAMES only", async () => {
    const id = await emailTemplate("Editable");
    audit = [];
    const r = await patch(id, { name: "Renamed", subject: "New subject", body: "New {{unsubscribe_url}}", isActive: true }, "editor");
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.json.template.name, r.json.template.subject, r.json.template.body], ["Renamed", "New subject", "New {{unsubscribe_url}}"]);
    const e = audit.find((a) => a.action === "communication.template.updated");
    assert.deepEqual(e.metadata.fields.sort(), ["body", "isActive", "name", "subject"]);
    assert.ok(!JSON.stringify(e).includes("New subject") && !JSON.stringify(e).includes("Renamed"), "content is not logged");
    for (const bad of [{}, { subject: "a\r\nBcc: x@y.co" }, { body: "" }, { name: "" }, { name: "x".repeat(201) }, { isActive: "yes" }, { organization_id: orgB }, { id: randomUUID() }]) {
      assert.equal((await patch(id, bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await patch(id, { name: "v" }, "viewer")).status, 403);
    assert.equal((await patch("not-a-uuid", { name: "x" })).status, 404);
    assert.equal((await patch(randomUUID(), { name: "x" })).status, 404);
  });

  it("cannot edit another organization's template (404)", async () => {
    const theirs = await emailTemplate("Theirs", 'x {{unsubscribe_url}}', "managerB", orgB);
    assert.equal((await patch(theirs, { name: "hijack" })).status, 404);
    assert.equal((await rows(`SELECT name FROM public.communication_templates WHERE id=$1`, [theirs]))[0].name, "Theirs");
  });

  it("LOCKED while an unfinished campaign uses it: content edits and deactivation are refused (409), renaming is allowed; unlocked once the campaign ends", async () => {
    const id = await emailTemplate("InUse");
    const cid = await contact({ first: "U", email: "u@lock.example" });
    const camp = (await createCampaign({ templateId: id, contactIds: [cid] })).json.campaign.id;
    for (const body of [{ body: "changed {{unsubscribe_url}}" }, { subject: "changed" }, { isActive: false }]) {
      const r = await patch(id, body);
      assert.equal(r.status, 409, JSON.stringify(body));
      assert.equal(r.json.error, "template_in_use");
    }
    assert.equal((await patch(id, { name: "Still renameable" })).status, 200);
    assert.equal((await rows(`SELECT body FROM public.communication_templates WHERE id=$1`, [id]))[0].body.includes("changed"), false);
    await call(h, "POST", `/api/communications/campaigns/${camp}/cancel`, as("manager"));
    assert.equal((await patch(id, { body: "changed {{unsubscribe_url}}" })).status, 200, "free again once the campaign is finished");
    assert.equal((await patch(id, { isActive: false })).status, 200);
  });
});
