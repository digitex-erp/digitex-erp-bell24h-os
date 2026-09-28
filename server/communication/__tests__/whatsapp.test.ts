/**
 * Meta WhatsApp Cloud API: the adapter (against a stubbed fetch — no network) and the webhook
 * (verification unit tests + the real route ingesting into the real schema).
 *
 * These prove the code's behavior against Meta's documented request/response shapes. They do NOT
 * prove that Meta accepts this project's credentials, phone number or templates: none exist, and
 * no real request has ever been made. The adapter is therefore UNVERIFIED by design.
 */

import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import { MetaWhatsAppCloudProvider } from "../providers/MetaWhatsAppCloudProvider.js";
import { ProviderFactory } from "../providers/ProviderFactory.js";
import { extractStatuses, verifyHandshake, verifySignature } from "../whatsappWebhook.js";
import { createTestDb, seedOrg, type TestDb } from "./helpers/testDb.js";
import { call, serve, silenceAudit, type Harness } from "./helpers/httpHarness.js";

const TOKEN = "EAAB-SENTINEL-ACCESS-TOKEN-must-never-leak";
const cfg = (settings: Record<string, unknown> = { phoneNumberId: "123456789012345" }, secretValue = TOKEN) => ({ provider: "meta_whatsapp", secretValue, settings });

interface Captured {
  url: string;
  init: RequestInit;
  body: any;
}
const realFetch = globalThis.fetch;
let calls: Captured[] = [];
function stubFetch(respond: (c: Captured) => Response | Promise<Response> | never) {
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const c: Captured = { url: String(url), init: init ?? {}, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    return respond(c);
  }) as typeof fetch;
}
beforeEach(() => {
  calls = [];
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const meta = new MetaWhatsAppCloudProvider();
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe("Meta adapter — identity", () => {
  it("is a real (non-stub) whatsapp adapter registered as meta_whatsapp", () => {
    const a = ProviderFactory.getAdapter("meta_whatsapp");
    assert.equal(a.channelType, "whatsapp");
    assert.ok(!a.isStub);
    assert.equal(ProviderFactory.getAdapter("msg91").isStub, true, "MSG91 remains a stub");
  });
});

describe("Meta adapter — validate()", () => {
  it("accepts valid settings and rejects bad ones without throwing", async () => {
    assert.equal((await meta.validate(cfg())).valid, true);
    assert.equal((await meta.validate(cfg({ phoneNumberId: "123456789012345", apiVersion: "v22.0", templateName: "rfq_alert", templateLanguage: "en_US" }))).valid, true);
    for (const bad of [
      {},
      { phoneNumberId: "abc" },
      { phoneNumberId: "123456789012345/../../x" },
      { phoneNumberId: "123456789012345", apiVersion: "21" },
      { phoneNumberId: "123456789012345", apiVersion: "v21.0/../x" },
      { phoneNumberId: "123456789012345", templateName: "Bad Name!" },
      { phoneNumberId: "123456789012345", templateLanguage: "english" },
    ]) {
      assert.equal((await meta.validate(cfg(bad))).valid, false, JSON.stringify(bad));
    }
    assert.equal((await meta.validate(cfg({ phoneNumberId: "123456789012345" }, ""))).valid, false);
  });
});

describe("Meta adapter — send()", () => {
  it("sends a text message to the Graph API with the token in the Authorization header only", async () => {
    stubFetch(() => json(200, { messages: [{ id: "wamid.ABC" }] }));
    const r = await meta.send({ recipient: "+919876543210", body: "Hello" }, cfg());
    assert.deepEqual([r.success, r.providerMessageId], [true, "wamid.ABC"]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://graph.facebook.com/v21.0/123456789012345/messages");
    assert.equal((calls[0].init.headers as Record<string, string>).Authorization, `Bearer ${TOKEN}`);
    assert.equal(calls[0].body.to, "919876543210", "Meta wants the number without '+'");
    assert.equal(calls[0].body.messaging_product, "whatsapp");
    assert.deepEqual(calls[0].body.text, { body: "Hello" });
    assert.ok(!calls[0].url.includes(TOKEN) && !JSON.stringify(calls[0].body).includes(TOKEN));
  });

  it("sends an approved TEMPLATE (single {{1}} body parameter) when templateName is configured", async () => {
    stubFetch(() => json(200, { messages: [{ id: "wamid.T" }] }));
    const r = await meta.send({ recipient: "+919876543210", body: "RFQ 42: 10t steel" }, cfg({ phoneNumberId: "123456789012345", templateName: "rfq_alert", templateLanguage: "en" }));
    assert.equal(r.success, true);
    assert.equal(calls[0].body.type, "template");
    assert.deepEqual(calls[0].body.template, {
      name: "rfq_alert",
      language: { code: "en" },
      components: [{ type: "body", parameters: [{ type: "text", text: "RFQ 42: 10t steel" }] }],
    });
  });

  it("rejects, before any network call: bad recipient, bad settings, missing token, Meta-illegal template parameters", async () => {
    stubFetch(() => json(200, { messages: [{ id: "x" }] }));
    const ok = { phoneNumberId: "123456789012345" };
    assert.equal((await meta.send({ recipient: "9876543210", body: "x" }, cfg(ok))).success, false);
    assert.equal((await meta.send({ recipient: "+919876543210\r\n+1555", body: "x" }, cfg(ok))).success, false);
    assert.equal((await meta.send({ recipient: "+919876543210", body: "x" }, cfg({}))).success, false);
    assert.equal((await meta.send({ recipient: "+919876543210", body: "x" }, cfg(ok, ""))).success, false);
    const tpl = { phoneNumberId: "123456789012345", templateName: "rfq_alert" };
    assert.equal((await meta.send({ recipient: "+919876543210", body: "line1\nline2" }, cfg(tpl))).success, false);
    assert.equal((await meta.send({ recipient: "+919876543210", body: "a    b" }, cfg(tpl))).success, false);
    assert.equal((await meta.send({ recipient: "+919876543210", body: "x".repeat(1025) }, cfg(tpl))).success, false);
    assert.equal((await meta.send({ recipient: "+919876543210", body: "x".repeat(4097) }, cfg(ok))).success, false);
    assert.equal(calls.length, 0, "nothing may reach the network for invalid input");
  });

  it("a Meta rejection (e.g. outside the 24-hour window) is a FAILURE carrying Meta's code, never a success", async () => {
    stubFetch(() => json(400, { error: { code: 131047, message: "Re-engagement message" } }));
    const r = await meta.send({ recipient: "+919876543210", body: "x" }, cfg());
    assert.equal(r.success, false);
    assert.match(r.errorMessage!, /400.*131047.*Re-engagement/);
    assert.ok(!JSON.stringify(r).includes(TOKEN));
  });

  it("a 2xx with no message id is NOT treated as a confirmed send", async () => {
    stubFetch(() => json(200, { messages: [] }));
    const r = await meta.send({ recipient: "+919876543210", body: "x" }, cfg());
    assert.equal(r.success, false);
    assert.match(r.errorMessage!, /without a message id/);
  });

  it("network errors and timeouts fail cleanly and never leak the token", async () => {
    stubFetch(() => {
      throw new Error("getaddrinfo ENOTFOUND graph.facebook.com");
    });
    const r = await meta.send({ recipient: "+919876543210", body: "x" }, cfg());
    assert.equal(r.success, false);
    assert.match(r.errorMessage!, /Network error/);
    assert.ok(!JSON.stringify(r).includes(TOKEN));
  });
});

describe("Meta adapter — healthCheck() / status()", () => {
  it("is a read-only GET of the phone number record; 200 -> healthy, 401 -> unhealthy; invalid settings never touch the network", async () => {
    stubFetch(() => json(200, { verified_name: "Acme" }));
    assert.equal((await meta.healthCheck(cfg())).healthy, true);
    assert.equal(calls[0].init.method ?? "GET", "GET");
    assert.match(calls[0].url, /^https:\/\/graph\.facebook\.com\/v21\.0\/123456789012345\?fields=verified_name,quality_rating$/);
    stubFetch(() => json(401, { error: { message: "bad token" } }));
    const bad = await meta.healthCheck(cfg());
    assert.equal(bad.healthy, false);
    assert.ok(!JSON.stringify(bad).includes(TOKEN));
    calls = [];
    assert.equal((await meta.healthCheck(cfg({}))).healthy, false);
    assert.equal((await meta.healthCheck(cfg({ phoneNumberId: "123456789012345" }, ""))).healthy, false);
    assert.equal(calls.length, 0);
  });

  it("status() does not pretend to poll: delivery arrives via webhook", async () => {
    const s = await meta.status("wamid.X", cfg());
    assert.equal(s.status, "sent");
  });
});

// ------------------------------------------------------------------------------------------------
describe("webhook — handshake verification", () => {
  const env = { META_WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify-me" };
  it("echoes the challenge only for mode=subscribe with the exact token", () => {
    assert.equal(verifyHandshake("subscribe", "verify-me", "12345", env), "12345");
    for (const [m, t, c] of [
      ["subscribe", "wrong", "1"],
      ["unsubscribe", "verify-me", "1"],
      [undefined, "verify-me", "1"],
      ["subscribe", undefined, "1"],
      ["subscribe", "verify-me", undefined],
      ["subscribe", ["verify-me"], "1"],
    ] as const) {
      assert.equal(verifyHandshake(m, t, c, env), null);
    }
  });
  it("fails CLOSED when no verify token is configured", () => {
    assert.equal(verifyHandshake("subscribe", "", "1", {}), null);
    assert.equal(verifyHandshake("subscribe", "undefined", "1", {}), null);
  });
});

describe("webhook — signature verification", () => {
  const secret = "app-secret-123";
  const body = Buffer.from(JSON.stringify({ hello: "world" }));
  const sign = (b: Buffer, s = secret) => `sha256=${crypto.createHmac("sha256", s).update(b).digest("hex")}`;
  it("accepts only a correct HMAC-SHA256 of the raw bytes", () => {
    assert.equal(verifySignature(body, sign(body), { META_WHATSAPP_APP_SECRET: secret }), true);
    assert.equal(verifySignature(body, sign(Buffer.from('{"hello":"world "}')), { META_WHATSAPP_APP_SECRET: secret }), false, "tampered body");
    assert.equal(verifySignature(body, sign(body, "other"), { META_WHATSAPP_APP_SECRET: secret }), false, "wrong secret");
  });
  it("rejects malformed headers and missing pieces", () => {
    const env = { META_WHATSAPP_APP_SECRET: secret };
    for (const h of [undefined, "", "sha256=", "sha1=abcd", "sha256=zz", "sha256=abcd", sign(body).replace("sha256=", ""), ["sha256=x"]]) {
      assert.equal(verifySignature(body, h, env), false, String(h));
    }
    assert.equal(verifySignature(undefined, sign(body), env), false, "no raw body");
  });
  it("fails CLOSED when the app secret is not configured — even for a 'valid-looking' signature", () => {
    assert.equal(verifySignature(body, sign(body, ""), {}), false);
    assert.equal(verifySignature(body, sign(body, "undefined"), {}), false);
  });
});

describe("webhook — payload parsing", () => {
  it("extracts statuses and errors; ignores unknown statuses; never throws on malformed input", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  { id: "wamid.1", status: "delivered", timestamp: "1700000000", recipient_id: "919876543210" },
                  { id: "wamid.2", status: "failed", errors: [{ code: 131047, title: "Re-engagement", error_data: { details: "24h window" } }] },
                  { id: "wamid.3", status: "weird" },
                  { status: "sent" },
                ],
              },
            },
          ],
        },
      ],
    };
    const out = extractStatuses(payload);
    assert.deepEqual(out.map((s) => [s.messageId, s.status]), [["wamid.1", "delivered"], ["wamid.2", "failed"]]);
    assert.equal(out[0].timestamp, new Date(1700000000 * 1000).toISOString());
    assert.deepEqual(out[1].errors, [{ code: "131047", title: "Re-engagement", message: undefined, details: "24h window" }]);
    assert.ok(!JSON.stringify(out).includes("919876543210"), "the recipient's number is not carried forward");
    for (const junk of [null, undefined, 5, "x", [], { entry: "x" }, { entry: [null] }, { entry: [{ changes: [{ value: null }] }] }]) {
      assert.deepEqual(extractStatuses(junk), []);
    }
  });
});

// ------------------------------------------------------------------------------------------------
describe("webhook — the real route against the real schema", () => {
  let t: TestDb;
  let h: Harness;
  let org: string;
  let unmute: () => void;
  const SECRET = "route-app-secret";
  const VERIFY = "route-verify-token";
  const signed = (payload: unknown, secret = SECRET) => {
    const raw = JSON.stringify(payload);
    return { rawBody: raw, headers: { "x-hub-signature-256": `sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}` } };
  };
  const status = (id: string, s: string, extra: Record<string, unknown> = {}) => ({
    entry: [{ changes: [{ value: { statuses: [{ id, status: s, timestamp: "1700000000", recipient_id: "919876543210", ...extra }] } }] }],
  });
  const addMessage = async (st: string, providerMessageId: string, campaignId: string | null = null) =>
    (
      await t.db.query<{ id: string }>(
        `INSERT INTO public.communication_messages (organization_id, channel_type, recipient, body, status, provider_message_id, campaign_id)
         VALUES ($1,'whatsapp','+919876543210','hi',$2,$3,$4) RETURNING id`,
        [org, st, providerMessageId, campaignId],
      )
    ).rows[0].id;
  const msg = async (id: string) => (await t.db.query<any>(`SELECT status, error_message FROM public.communication_messages WHERE id=$1`, [id])).rows[0];

  before(async () => {
    unmute = silenceAudit();
    t = await createTestDb();
    org = await seedOrg(t.db, "wa");
    h = await serve(t.pool);
  });
  after(async () => {
    unmute();
    await h.close();
    await t.db.close();
  });
  afterEach(() => {
    delete process.env.META_WHATSAPP_APP_SECRET;
    delete process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  });

  it("GET handshake: echoes with the right token; 403 with a wrong token or when unconfigured", async () => {
    process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN = VERIFY;
    const ok = await call(h, "GET", `/api/communications/webhooks/meta-whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=abc123`);
    assert.equal(ok.status, 200);
    assert.equal(ok.text, "abc123");
    assert.equal((await call(h, "GET", "/api/communications/webhooks/meta-whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=abc123")).status, 403);
    delete process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    assert.equal((await call(h, "GET", "/api/communications/webhooks/meta-whatsapp?hub.mode=subscribe&hub.verify_token=&hub.challenge=abc123")).status, 403);
  });

  it("POST is rejected (401) without a valid signature, or when the app secret is not configured — and changes nothing", async () => {
    const id = await addMessage("sent", "wamid.REJ");
    const payload = status("wamid.REJ", "delivered");
    process.env.META_WHATSAPP_APP_SECRET = SECRET;
    assert.equal((await call(h, "POST", "/api/communications/webhooks/meta-whatsapp", { rawBody: JSON.stringify(payload) })).status, 401);
    assert.equal((await call(h, "POST", "/api/communications/webhooks/meta-whatsapp", signed(payload, "wrong-secret"))).status, 401);
    delete process.env.META_WHATSAPP_APP_SECRET;
    assert.equal((await call(h, "POST", "/api/communications/webhooks/meta-whatsapp", signed(payload))).status, 401);
    assert.equal((await msg(id)).status, "sent");
    assert.equal((await t.db.query<any>(`SELECT COUNT(*)::int AS n FROM public.communication_webhooks WHERE provider_message_id='wamid.REJ'`)).rows[0].n, 0);
  });

  it("a verified 'delivered' status updates the matching message and is stored WITHOUT the recipient's phone number", async () => {
    process.env.META_WHATSAPP_APP_SECRET = SECRET;
    const id = await addMessage("sent", "wamid.OK1");
    const r = await call(h, "POST", "/api/communications/webhooks/meta-whatsapp", signed(status("wamid.OK1", "delivered")));
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.json.matched, r.json.unmatched], [1, 0]);
    assert.equal((await msg(id)).status, "delivered");
    const w = (await t.db.query<any>(`SELECT * FROM public.communication_webhooks WHERE provider_message_id='wamid.OK1'`)).rows;
    assert.equal(w.length, 1);
    assert.equal(w[0].organization_id, org);
    assert.equal(w[0].signature_verified, true);
    assert.equal(w[0].event_type, "whatsapp.delivered");
    assert.ok(!JSON.stringify(w[0].payload).includes("919876543210"));
  });

  it("statuses are applied monotonically: a late 'sent' never downgrades 'delivered'; 'read' counts as delivered", async () => {
    process.env.META_WHATSAPP_APP_SECRET = SECRET;
    const id = await addMessage("sent", "wamid.MONO");
    await call(h, "POST", "/api/communications/webhooks/meta-whatsapp", signed(status("wamid.MONO", "read")));
    assert.equal((await msg(id)).status, "delivered");
    await call(h, "POST", "/api/communications/webhooks/meta-whatsapp", signed(status("wamid.MONO", "sent")));
    assert.equal((await msg(id)).status, "delivered");
    await call(h, "POST", "/api/communications/webhooks/meta-whatsapp", signed(status("wamid.MONO", "failed")));
    assert.equal((await msg(id)).status, "delivered", "a delivered message is not turned into failed by an out-of-order event");
  });

  it("a verified 'failed' status marks a sent message failed with Meta's error code", async () => {
    process.env.META_WHATSAPP_APP_SECRET = SECRET;
    const id = await addMessage("sent", "wamid.FAIL");
    await call(h, "POST", "/api/communications/webhooks/meta-whatsapp", signed(status("wamid.FAIL", "failed", { errors: [{ code: 131026, title: "Undeliverable" }] })));
    const m = await msg(id);
    assert.equal(m.status, "failed");
    assert.match(m.error_message, /131026 Undeliverable/);
  });

  it("an event for an unknown message is recorded (organization NULL) and reported unmatched - not applied, not an error", async () => {
    process.env.META_WHATSAPP_APP_SECRET = SECRET;
    const r = await call(h, "POST", "/api/communications/webhooks/meta-whatsapp", signed(status("wamid.UNKNOWN", "delivered")));
    assert.equal(r.status, 200);
    assert.deepEqual([r.json.matched, r.json.unmatched], [0, 1]);
    const w = (await t.db.query<any>(`SELECT organization_id, message_id FROM public.communication_webhooks WHERE provider_message_id='wamid.UNKNOWN'`)).rows;
    assert.deepEqual([w.length, w[0].organization_id, w[0].message_id], [1, null, null]);
  });

  it("a verified but empty / status-less payload is acknowledged without side effects", async () => {
    process.env.META_WHATSAPP_APP_SECRET = SECRET;
    const before = (await t.db.query<any>(`SELECT COUNT(*)::int AS n FROM public.communication_webhooks`)).rows[0].n;
    const r = await call(h, "POST", "/api/communications/webhooks/meta-whatsapp", signed({ entry: [{ changes: [{ value: { messages: [{ id: "inbound" }] } }] }] }));
    assert.equal(r.status, 200);
    assert.equal((await t.db.query<any>(`SELECT COUNT(*)::int AS n FROM public.communication_webhooks`)).rows[0].n, before);
  });

  it("delivery updates on a campaign message reconcile the campaign", async () => {
    process.env.META_WHATSAPP_APP_SECRET = SECRET;
    const tpl = (await t.db.query<any>(`INSERT INTO public.communication_templates (organization_id, name, channel_type, body) VALUES ($1,'t','whatsapp','hi') RETURNING id`, [org])).rows[0].id;
    const camp = (await t.db.query<any>(
      `INSERT INTO public.communication_campaigns (organization_id, name, channel_type, template_id, status, total_recipients, consent_confirmed_at)
       VALUES ($1,'wa','whatsapp',$2,'running',1,NOW()) RETURNING id`, [org, tpl])).rows[0].id;
    const mid = await addMessage("sent", "wamid.CAMP", camp);
    await t.db.query(
      `INSERT INTO public.communication_campaign_recipients (organization_id, campaign_id, recipient, status, message_id) VALUES ($1,$2,'+919876543210','queued',$3)`, [org, camp, mid]);
    await call(h, "POST", "/api/communications/webhooks/meta-whatsapp", signed(status("wamid.CAMP", "delivered")));
    const c = (await t.db.query<any>(`SELECT status, sent_count FROM public.communication_campaigns WHERE id=$1`, [camp])).rows[0];
    assert.deepEqual([c.status, c.sent_count], ["completed", 1]);
  });

  it("the endpoints need no user login (Meta cannot log in) but the user-authenticated API is untouched", async () => {
    const r = await call(h, "GET", "/api/communications/campaigns");
    assert.equal(r.status, 401);
  });
});

void randomUUID;
