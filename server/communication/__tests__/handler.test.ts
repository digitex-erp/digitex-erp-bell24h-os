/**
 * CommunicationJobHandler against the real schema: worker-side idempotency (B3), the credential
 * allowlist as it applies when a job actually runs (B1), failover, dead-letter, org boundary.
 */

import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { CommunicationJobHandler } from "../../workers/handlers/CommunicationJobHandler.js";
import { ProviderFactory } from "../providers/ProviderFactory.js";
import type { AdapterSendResult, OutboundMessage, ProviderAdapter, ResolvedProviderConfig } from "../types.js";
import type { QueueJob } from "../../queue/QueueTypes.js";
import { createTestDb, seedOrg, type TestDb } from "./helpers/testDb.js";

let t: TestDb;
let handler: CommunicationJobHandler;
let orgA: string;
let orgB: string;

const registry = () => (ProviderFactory as unknown as { registry: Record<string, ProviderAdapter> }).registry;
const originals: Record<string, ProviderAdapter> = {};

interface Call {
  message: OutboundMessage;
  config: ResolvedProviderConfig;
}
function fakeAdapter(provider: string, results: AdapterSendResult[], calls: Call[]): ProviderAdapter {
  let i = 0;
  return {
    provider,
    channelType: "email",
    send: async (message, config) => {
      calls.push({ message, config });
      return results[Math.min(i++, results.length - 1)];
    },
    status: async () => ({ status: "sent" }),
    validate: async () => ({ valid: true }),
    healthCheck: async () => ({ healthy: true, checkedAt: new Date().toISOString() }),
  };
}

const realLog = console.log;
before(async () => {
  console.log = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith('{"kind":"audit"')) return;
    realLog(...args);
  };
  t = await createTestDb();
  handler = new CommunicationJobHandler(t.pool);
  orgA = await seedOrg(t.db, "A");
  orgB = await seedOrg(t.db, "B");
  for (const k of ["resend", "smtp"]) originals[k] = registry()[k];
});
after(async () => {
  console.log = realLog;
  await t.db.close();
});
beforeEach(async () => {
  await t.db.exec(`DELETE FROM public.communication_deliveries; DELETE FROM public.communication_messages; DELETE FROM public.communication_providers;`);
});
afterEach(() => {
  for (const [k, v] of Object.entries(originals)) registry()[k] = v;
  delete process.env.COMM_RESEND_P1;
  delete process.env.COMM_SMTP_P2;
});

const addMessage = async (org: string, status = "queued") =>
  (
    await t.db.query<{ id: string }>(
      `INSERT INTO public.communication_messages (organization_id, channel_type, recipient, subject, body, status)
       VALUES ($1,'email','buyer@example.com','RFQ','<p>hi</p>',$2) RETURNING id`,
      [org, status],
    )
  ).rows[0].id;

const addProvider = (org: string, provider: string, secretRef: string, priority = 0, settings: object = { fromAddress: "no-reply@example.com" }) =>
  t.db.query(
    `INSERT INTO public.communication_providers (organization_id, name, provider, channel_type, credentials_secret_ref, priority, settings)
     VALUES ($1,$2,$3,'email',$4,$5,$6)`,
    [org, `${provider}-${priority}`, provider, secretRef, priority, JSON.stringify(settings)],
  );

const job = (org: string, messageId: string, retryCount = 0, maxRetries = 3) =>
  ({ id: "job-1", organization_id: org, job_type: "communication", payload: { messageId }, retry_count: retryCount, max_retries: maxRetries }) as unknown as QueueJob<{ messageId: string }>;

const status = async (id: string) => (await t.db.query<{ status: string; error_message: string | null; provider_id: string | null }>(`SELECT status, error_message, provider_id FROM public.communication_messages WHERE id=$1`, [id])).rows[0];
const deliveries = async (id: string) => (await t.db.query<any>(`SELECT * FROM public.communication_deliveries WHERE message_id=$1 ORDER BY attempt_number`, [id])).rows;

describe("worker-side idempotency (B3)", () => {
  it("a job re-run for an already-sent message does not call any provider", async () => {
    const calls: Call[] = [];
    registry().resend = fakeAdapter("resend", [{ success: true, providerMessageId: "x" }], calls);
    process.env.COMM_RESEND_P1 = "k";
    await addProvider(orgA, "resend", "COMM_RESEND_P1");
    const id = await addMessage(orgA, "sent");
    const r = await handler.handle(job(orgA, id));
    assert.deepEqual(r, { skipped: true, reason: "already_sent" });
    assert.equal(calls.length, 0);
    assert.equal((await deliveries(id)).length, 0);
  });

  it("delivered and cancelled messages are skipped too", async () => {
    const calls: Call[] = [];
    registry().resend = fakeAdapter("resend", [{ success: true }], calls);
    process.env.COMM_RESEND_P1 = "k";
    await addProvider(orgA, "resend", "COMM_RESEND_P1");
    for (const s of ["delivered", "cancelled"]) {
      const r = await handler.handle(job(orgA, await addMessage(orgA, s)));
      assert.equal((r as { skipped: boolean }).skipped, true, s);
    }
    assert.equal(calls.length, 0);
  });

  it("running the same job twice sends exactly once", async () => {
    const calls: Call[] = [];
    registry().resend = fakeAdapter("resend", [{ success: true, providerMessageId: "pm-1" }], calls);
    process.env.COMM_RESEND_P1 = "k";
    await addProvider(orgA, "resend", "COMM_RESEND_P1");
    const id = await addMessage(orgA);
    await handler.handle(job(orgA, id));
    const second = await handler.handle(job(orgA, id));
    assert.equal(calls.length, 1);
    assert.equal((second as { reason: string }).reason, "already_sent");
    assert.equal((await status(id)).status, "sent");
  });

  it("passes a stable per-message idempotency key to the provider (retry_count is part of it)", async () => {
    const calls: Call[] = [];
    registry().resend = fakeAdapter("resend", [{ success: true }], calls);
    process.env.COMM_RESEND_P1 = "k";
    await addProvider(orgA, "resend", "COMM_RESEND_P1");
    const id = await addMessage(orgA);
    await handler.handle(job(orgA, id));
    assert.equal(calls[0].message.idempotencyKey, `comm-msg:${id}:0`);
  });
});

describe("B1 — allowlist enforced when the worker actually resolves a secret", () => {
  it("a provider row pointing at DATABASE_URL never reaches an adapter and never leaks the value", async () => {
    const SENTINEL = "postgres://svc:SENTINEL_MUST_NOT_LEAK@db.internal/x";
    const saved = process.env.DATABASE_URL;
    process.env.DATABASE_URL = SENTINEL;
    try {
      const calls: Call[] = [];
      registry().smtp = fakeAdapter("smtp", [{ success: true }], calls);
      await addProvider(orgA, "smtp", "DATABASE_URL", 0, { host: "evil.example.com", fromAddress: "a@b.co" });
      const id = await addMessage(orgA);

      await assert.rejects(handler.handle(job(orgA, id)), /All 1 provider\(s\) failed/);
      assert.equal(calls.length, 0, "adapter must not be invoked with the secret");

      const d = await deliveries(id);
      assert.equal(d.length, 1);
      assert.equal(d[0].status, "failed");
      assert.match(d[0].error_message, /not an allowed secret name/);
      const everything = JSON.stringify([d, await status(id)]);
      assert.ok(!everything.includes("SENTINEL_MUST_NOT_LEAK"));
      assert.ok(!everything.includes("DATABASE_URL"), "the attacker-chosen name is not echoed either");
      assert.equal((await status(id)).status, "failed");
    } finally {
      if (saved === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = saved;
    }
  });

  it("an allowed secret is resolved and handed to the adapter; a cross-provider name is refused", async () => {
    const calls: Call[] = [];
    registry().resend = fakeAdapter("resend", [{ success: true }], calls);
    process.env.COMM_RESEND_P1 = "resend-secret";
    process.env.SMTP_PASSWORD = "smtp-secret";
    try {
      await addProvider(orgA, "resend", "COMM_RESEND_P1", 0);
      await handler.handle(job(orgA, await addMessage(orgA)));
      assert.equal(calls[0].config.secretValue, "resend-secret");

      // Re-point the same resend row at SMTP's credential.
      await t.db.exec(`UPDATE public.communication_providers SET credentials_secret_ref = 'SMTP_PASSWORD'`);
      const id = await addMessage(orgA);
      await assert.rejects(handler.handle(job(orgA, id)), /failed/);
      assert.equal(calls.length, 1, "the cross-provider secret must not have been used");
    } finally {
      delete process.env.SMTP_PASSWORD;
    }
  });
});

describe("failover, failure and dead-letter", () => {
  it("falls over to the next provider by priority and records every attempt", async () => {
    const c1: Call[] = [];
    const c2: Call[] = [];
    registry().resend = fakeAdapter("resend", [{ success: false, errorMessage: "resend down" }], c1);
    registry().smtp = fakeAdapter("smtp", [{ success: true, providerMessageId: "smtp-1" }], c2);
    process.env.COMM_RESEND_P1 = "a";
    process.env.COMM_SMTP_P2 = "b";
    await addProvider(orgA, "smtp", "COMM_SMTP_P2", 1, { host: "smtp.example.com", fromAddress: "a@b.co" });
    await addProvider(orgA, "resend", "COMM_RESEND_P1", 0);
    const id = await addMessage(orgA);

    const r = (await handler.handle(job(orgA, id))) as { provider: string };
    assert.equal(r.provider, "smtp");
    assert.equal(c1.length, 1);
    assert.equal(c2.length, 1);
    const d = await deliveries(id);
    assert.deepEqual(d.map((x) => [x.provider, x.status]), [["resend", "failed"], ["smtp", "success"]]);
    const m = await status(id);
    assert.equal(m.status, "sent");
    assert.ok(m.provider_id);
  });

  it("no configured provider -> PROVIDER_NOT_CONFIGURED, message failed", async () => {
    const id = await addMessage(orgA);
    await assert.rejects(handler.handle(job(orgA, id)), /PROVIDER_NOT_CONFIGURED/);
    assert.equal((await status(id)).status, "failed");
  });

  it("all providers failing on the LAST allowed attempt marks the message dead_letter", async () => {
    registry().resend = fakeAdapter("resend", [{ success: false, errorMessage: "nope" }], []);
    process.env.COMM_RESEND_P1 = "a";
    await addProvider(orgA, "resend", "COMM_RESEND_P1");
    const id = await addMessage(orgA);
    await assert.rejects(handler.handle(job(orgA, id, 2, 3)), /failed/);
    assert.equal((await status(id)).status, "dead_letter");
  });
});

describe("organization boundary in the worker", () => {
  it("a job cannot act on another organization's message", async () => {
    const id = await addMessage(orgA);
    await assert.rejects(handler.handle(job(orgB, id)), /not found/);
  });

  it("another organization's provider rows are never used", async () => {
    const calls: Call[] = [];
    registry().resend = fakeAdapter("resend", [{ success: true }], calls);
    process.env.COMM_RESEND_P1 = "a";
    await addProvider(orgB, "resend", "COMM_RESEND_P1");
    const id = await addMessage(orgA);
    await assert.rejects(handler.handle(job(orgA, id)), /PROVIDER_NOT_CONFIGURED/);
    assert.equal(calls.length, 0);
  });
});
