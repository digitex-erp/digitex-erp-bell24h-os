/**
 * The admin "Providers" tab API: it must report readiness HONESTLY — stubs are stubs, configuration is
 * not verification, health is only ever written after a real check, and no secret value or name of an
 * unallowed env var ever appears in a response.
 */

import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ProviderFactory } from "../providers/ProviderFactory.js";
import type { ProviderAdapter } from "../types.js";
import { createTestDb, seedOrg, seedUser, type TestDb } from "./helpers/testDb.js";
import { call, serve, silenceAudit, type Harness } from "./helpers/httpHarness.js";

let t: TestDb;
let h: Harness;
let orgA: string;
let orgB: string;
let unmute: () => void;
const U: Record<string, string> = {};
const registry = () => (ProviderFactory as unknown as { registry: Record<string, ProviderAdapter> }).registry;
const originalResend = registry().resend;
const SECRET_VALUE = "SENTINEL-provider-secret-value-9f3a";
let healthy = true;
let healthCalls = 0;
const fakeResend: ProviderAdapter = {
  provider: "resend",
  channelType: "email",
  send: async () => ({ success: true, providerMessageId: "x" }),
  status: async () => ({ status: "sent" }),
  validate: async () => ({ valid: true }),
  healthCheck: async () => {
    healthCalls++;
    return healthy ? { healthy: true, checkedAt: new Date().toISOString() } : { healthy: false, detail: "API returned 401", checkedAt: new Date().toISOString() };
  },
};

const ids: Record<string, string> = {};
const provider = async (org: string, name: string, prov: string, channel: string, ref: string, settings: object = {}, priority = 0) =>
  (
    await t.db.query<{ id: string }>(
      `INSERT INTO public.communication_providers (organization_id, name, provider, channel_type, credentials_secret_ref, priority, settings)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [org, name, prov, channel, ref, priority, JSON.stringify(settings)],
    )
  ).rows[0].id;
const as = (who: string, org = orgA) => ({ user: U[who], org });
const dbProvider = async (id: string) => (await t.db.query<any>(`SELECT health_status, last_health_check_at FROM public.communication_providers WHERE id=$1`, [id])).rows[0];

before(async () => {
  unmute = silenceAudit();
  t = await createTestDb();
  orgA = await seedOrg(t.db, "A");
  orgB = await seedOrg(t.db, "B");
  U.admin = await seedUser(t.db, orgA, ["ADMIN"]);
  U.manager = await seedUser(t.db, orgA, ["MANAGER"]);
  U.viewer = await seedUser(t.db, orgA, ["VIEWER"]);
  U.norole = await seedUser(t.db, orgA, []);
  U.adminB = await seedUser(t.db, orgB, ["ADMIN"]);
  h = await serve(t.pool);
  registry().resend = fakeResend;
  process.env.COMM_RESEND_ADMIN = SECRET_VALUE;
  process.env.DATABASE_URL = "postgres://svc:SENTINEL-db-password@db.internal/x";
  ids.resend = await provider(orgA, "Primary email", "resend", "email", "COMM_RESEND_ADMIN", { fromAddress: "no-reply@example.com", apiKey: "should-not-be-returned" }, 0);
  ids.resendNoSecret = await provider(orgA, "Backup email", "resend", "email", "COMM_RESEND_MISSING", { fromAddress: "b@example.com" }, 1);
  ids.evil = await provider(orgA, "Evil", "smtp", "email", "DATABASE_URL", { host: "evil.example.com", fromAddress: "a@b.co" }, 2);
  ids.msg91 = await provider(orgA, "SMS", "msg91", "sms", "MSG91_AUTH_KEY", {}, 0);
  ids.meta = await provider(orgA, "WhatsApp", "meta_whatsapp", "whatsapp", "META_WHATSAPP_ACCESS_TOKEN", { phoneNumberId: "123456789012345", templateName: "rfq_alert" }, 0);
  ids.twilio = await provider(orgA, "Removed", "twilio", "sms", "TWILIO_AUTH_TOKEN", {}, 5);
  ids.other = await provider(orgB, "Other org", "resend", "email", "COMM_RESEND_ADMIN", {}, 0);
});
after(async () => {
  registry().resend = originalResend;
  delete process.env.COMM_RESEND_ADMIN;
  delete process.env.DATABASE_URL;
  unmute();
  await h.close();
  await t.db.close();
});
afterEach(() => {
  healthy = true;
});

describe("GET /providers — honest readiness", () => {
  it("reports implementation, credential presence, verification and health without overstating anything", async () => {
    const r = await call(h, "GET", "/api/communications/providers", as("manager"));
    assert.equal(r.status, 200, r.text);
    const by = Object.fromEntries(r.json.providers.map((p: any) => [p.name, p]));
    assert.equal(by["Primary email"].implementation, "live-capable");
    assert.equal(by["Primary email"].credentialsConfigured, true);
    assert.equal(by["Primary email"].verified, false, "configured is NOT verified");
    assert.equal(by["Primary email"].healthStatus, "unknown");
    assert.equal(by["Backup email"].credentialsConfigured, false, "secret name is allowed but not set on the server");
    assert.equal(by.Evil.credentialsConfigured, false, "DATABASE_URL is not an allowed secret for smtp even though it is set");
    assert.equal(by.SMS.implementation, "stub");
    assert.equal(by.WhatsApp.implementation, "live-capable");
    assert.equal(by.WhatsApp.credentialsConfigured, false);
    assert.equal(by.WhatsApp.verified, false);
    assert.equal(by.Removed.implementation, "unknown", "a row for a removed provider (twilio) has no adapter");
    assert.equal(r.json.providers.length, 6, "only this organization's providers");
  });

  it("never returns a secret value, an unallowed env var's value, or unlisted settings keys", async () => {
    const r = await call(h, "GET", "/api/communications/providers", as("admin"));
    assert.ok(!r.text.includes(SECRET_VALUE));
    assert.ok(!r.text.includes("SENTINEL-db-password"));
    assert.ok(!r.text.includes("should-not-be-returned"), "settings are returned through an allowlist of non-secret keys");
    const primary = r.json.providers.find((p: any) => p.name === "Primary email");
    assert.deepEqual(primary.settingsSummary, { fromAddress: "no-reply@example.com" });
  });

  it("'verified' becomes true only after a real successful delivery attempt through that provider row", async () => {
    const msg = (await t.db.query<any>(`INSERT INTO public.communication_messages (organization_id, channel_type, recipient, body, status) VALUES ($1,'email','a@example.com','x','failed') RETURNING id`, [orgA])).rows[0].id;
    await t.db.query(`INSERT INTO public.communication_deliveries (organization_id, message_id, provider_id, provider, attempt_number, status, error_message) VALUES ($1,$2,$3,'resend',1,'failed','boom')`, [orgA, msg, ids.resend]);
    let p = (await call(h, "GET", "/api/communications/providers", as("manager"))).json.providers.find((x: any) => x.name === "Primary email");
    assert.equal(p.verified, false);
    assert.ok(p.lastFailureAt);
    await t.db.query(`INSERT INTO public.communication_deliveries (organization_id, message_id, provider_id, provider, attempt_number, status, provider_message_id) VALUES ($1,$2,$3,'resend',2,'success','pm-1')`, [orgA, msg, ids.resend]);
    p = (await call(h, "GET", "/api/communications/providers", as("manager"))).json.providers.find((x: any) => x.name === "Primary email");
    assert.equal(p.verified, true);
    assert.ok(p.lastSuccessAt);
  });

  it("requires the send permission: VIEWER / role-less / another org's admin see nothing", async () => {
    assert.equal((await call(h, "GET", "/api/communications/providers", as("viewer"))).status, 403);
    assert.equal((await call(h, "GET", "/api/communications/providers", as("norole"))).status, 403);
    assert.equal((await call(h, "GET", "/api/communications/providers")).status, 401);
    const b = await call(h, "GET", "/api/communications/providers", as("adminB", orgB));
    assert.equal(b.json.providers.length, 1);
    assert.equal(b.json.providers[0].name, "Other org");
  });
});

describe("POST /providers/:id/health-check — real checks only", () => {
  const check = (who: string, id: string, org = orgA) => call(h, "POST", `/api/communications/providers/${id}/health-check`, as(who, org));

  it("is ADMIN-only (it makes a real call with a server credential)", async () => {
    healthCalls = 0;
    assert.equal((await check("manager", ids.resend)).status, 403);
    assert.equal((await check("viewer", ids.resend)).status, 403);
    assert.equal(healthCalls, 0);
  });

  it("a STUB provider reports not_implemented and nothing is written", async () => {
    const r = await check("admin", ids.msg91);
    assert.equal(r.json.status, "not_implemented");
    assert.deepEqual(await dbProvider(ids.msg91), { health_status: "unknown", last_health_check_at: null });
  });

  it("missing credentials report not_configured, make NO adapter call, and write nothing", async () => {
    healthCalls = 0;
    const r = await check("admin", ids.resendNoSecret);
    assert.equal(r.json.status, "not_configured");
    assert.equal(healthCalls, 0);
    assert.deepEqual(await dbProvider(ids.resendNoSecret), { health_status: "unknown", last_health_check_at: null });
    // an un-allowlisted secret name is refused the same way: the env var is never read for it
    healthCalls = 0;
    assert.equal((await check("admin", ids.evil)).json.status, "not_configured");
    assert.equal(healthCalls, 0);
  });

  it("a removed provider (no adapter) reports not_implemented", async () => {
    assert.equal((await check("admin", ids.twilio)).json.status, "not_implemented");
  });

  it("a configured provider runs the adapter's real check and persists the outcome", async () => {
    healthCalls = 0;
    const ok = await check("admin", ids.resend);
    assert.equal(ok.json.status, "healthy");
    assert.equal(healthCalls, 1);
    const row = await dbProvider(ids.resend);
    assert.equal(row.health_status, "healthy");
    assert.ok(row.last_health_check_at);

    healthy = false;
    const bad = await check("admin", ids.resend);
    assert.equal(bad.json.status, "down");
    assert.equal(bad.json.detail, "API returned 401");
    assert.equal((await dbProvider(ids.resend)).health_status, "down");
    assert.ok(!bad.text.includes(SECRET_VALUE));
  });

  it("cannot check another organization's provider (404) or a malformed id (404)", async () => {
    assert.equal((await check("admin", ids.other)).status, 404);
    assert.equal((await check("admin", "not-a-uuid")).status, 404);
    assert.equal((await check("admin", randomUUID())).status, 404);
  });

  it("is rate limited", async () => {
    const hr = await serve(t.pool, { health: 1 });
    try {
      const go = () => call(hr, "POST", `/api/communications/providers/${ids.resend}/health-check`, as("admin"));
      assert.equal((await go()).status, 200);
      assert.equal((await go()).status, 429);
    } finally {
      await hr.close();
    }
  });
});
