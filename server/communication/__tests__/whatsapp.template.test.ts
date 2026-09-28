/**
 * WhatsApp template mapping: validation rules, the real Meta adapter's payloads (fetch mocked — nothing leaves the
 * process), and the campaign flow through the real routes / services / worker / SQL with a test-double provider.
 *
 * What this proves: the orchestration hands the RIGHT template name and ORDERED parameters to the provider, refuses
 * what would fail at Meta, and reports a mapping as verified only after a provider accepted a message. What it cannot
 * prove: that Meta has approved any template or that any real message is delivered.
 */
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CommunicationJobHandler } from "../../workers/handlers/CommunicationJobHandler.js";
import { MetaWhatsAppCloudProvider } from "../providers/MetaWhatsAppCloudProvider.js";
import { ProviderFactory } from "../providers/ProviderFactory.js";
import type { AdapterSendResult, OutboundMessage, ProviderAdapter } from "../types.js";
import type { QueueJob } from "../../queue/QueueTypes.js";
import { CommunicationValidationError } from "../validation.js";
import {
  MAX_TEMPLATE_PARAMS,
  META_PARAM_MAX,
  buildTemplateParameters,
  providerTemplateStatus,
  unresolvableVariables,
  validateMapping,
} from "../whatsappTemplate.js";
import { createTestDb, seedOrg, seedUser, type TestDb } from "./helpers/testDb.js";
import { call, seedContact, serve, silenceAudit, type Harness } from "./helpers/httpHarness.js";

// ---------------------------------------------------------------------------------------------------------------
// pure rules
// ---------------------------------------------------------------------------------------------------------------
describe("mapping validation", () => {
  const bad = (input: Record<string, unknown>, channel = "whatsapp") => assert.throws(() => validateMapping(input, channel), CommunicationValidationError, JSON.stringify(input).slice(0, 70));

  it("no name = not mapped (and variables without a name are refused)", () => {
    assert.deepEqual(validateMapping({}, "whatsapp"), { name: null, language: "en", variables: [] });
    assert.deepEqual(validateMapping({ providerTemplateName: "" }, "email"), { name: null, language: "en", variables: [] });
    bad({ providerTemplateVariables: ["a"] });
  });

  it("accepts a well-formed mapping", () => {
    assert.deepEqual(validateMapping({ providerTemplateName: "claim_invite_v2", providerTemplateLanguage: "en_US", providerTemplateVariables: ["first_name", "company"] }, "whatsapp"), {
      name: "claim_invite_v2",
      language: "en_US",
      variables: ["first_name", "company"],
    });
    assert.equal(validateMapping({ providerTemplateName: "hello_world" }, "whatsapp").language, "en", "language defaults to en");
  });

  it("rejects: non-WhatsApp channel, bad names/languages, non-arrays, bad/duplicate/too many variables", () => {
    bad({ providerTemplateName: "hello" }, "email");
    bad({ providerTemplateName: "hello" }, "sms");
    for (const name of ["Hello", "hello world", "hello-world", "x".repeat(513), 5, "hello\n"]) bad({ providerTemplateName: name });
    for (const lang of ["english", "E", "en-US", "en_", 5]) bad({ providerTemplateName: "ok", providerTemplateLanguage: lang });
    bad({ providerTemplateName: "ok", providerTemplateVariables: "first_name" });
    bad({ providerTemplateName: "ok", providerTemplateVariables: [1] });
    bad({ providerTemplateName: "ok", providerTemplateVariables: ["a b"] });
    bad({ providerTemplateName: "ok", providerTemplateVariables: ["a", "a"] });
    bad({ providerTemplateName: "ok", providerTemplateVariables: Array.from({ length: MAX_TEMPLATE_PARAMS + 1 }, (_, i) => `v${i}`) });
  });
});

describe("parameter building", () => {
  it("is ordered and normalises whitespace (Meta forbids newlines, tabs and 4+ spaces)", () => {
    assert.deepEqual(buildTemplateParameters(["b", "a"], { a: "  A   line\nbreak\t tab ", b: 7 }), ["7", "A line break tab"]);
    assert.deepEqual(buildTemplateParameters([], {}), []);
  });
  it("refuses missing, empty, non-scalar and oversized values (fail closed, never a partly filled template)", () => {
    const err = (vars: string[], values: Record<string, unknown>, re: RegExp) => assert.throws(() => buildTemplateParameters(vars, values), (e: Error) => e instanceof CommunicationValidationError && re.test(e.message));
    err(["first_name"], {}, /variables\.first_name.*\{\{1\}\}/);
    err(["a", "b"], { a: "x", b: "   " }, /variables\.b.*empty.*\{\{2\}\}/);
    err(["a"], { a: null }, /required/);
    err(["a"], { a: { nested: 1 } }, /required/);
    err(["a"], { a: "x".repeat(META_PARAM_MAX + 1) }, /longer than/);
    assert.equal(buildTemplateParameters(["a"], { a: "x".repeat(META_PARAM_MAX) })[0].length, META_PARAM_MAX);
  });
  it("unresolvableVariables knows what a campaign can supply", () => {
    assert.deepEqual(unresolvableVariables(["first_name", "company", "order_no"], undefined), ["order_no"]);
    assert.deepEqual(unresolvableVariables(["first_name", "order_no"], { order_no: "1" }), []);
  });
  it("status is derived from accepted sends only", () => {
    assert.equal(providerTemplateStatus(null, 5), "not_mapped");
    assert.equal(providerTemplateStatus("t", 0), "unverified");
    assert.equal(providerTemplateStatus("t", 1), "verified_by_send");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// the real Meta adapter, fetch mocked
// ---------------------------------------------------------------------------------------------------------------
describe("Meta adapter payloads", () => {
  const meta = new MetaWhatsAppCloudProvider();
  const realFetch = globalThis.fetch;
  let bodies: any[] = [];
  const cfg = (settings: Record<string, unknown> = {}) => ({ provider: "meta_whatsapp", secretValue: "tok-not-real", settings: { phoneNumberId: "1234567890", ...settings } });
  beforeEach(() => {
    bodies = [];
    globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ messages: [{ id: "wamid.X" }] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("a per-message template sends every parameter, in order, in the mapped language", async () => {
    const r = await meta.send({ recipient: "+919876543210", body: "preview", template: { name: "claim_invite", language: "hi", parameters: ["Asha", "Acme"] } }, cfg());
    assert.equal(r.success, true);
    assert.equal(bodies[0].to, "919876543210");
    assert.deepEqual(bodies[0].template, { name: "claim_invite", language: { code: "hi" }, components: [{ type: "body", parameters: [{ type: "text", text: "Asha" }, { type: "text", text: "Acme" }] }] });
    assert.equal(bodies[0].type, "template");
  });

  it("a template with no variables sends no components", async () => {
    await meta.send({ recipient: "+919876543210", body: "x", template: { name: "hello_world", language: "en", parameters: [] } }, cfg());
    assert.equal("components" in bodies[0].template, false);
  });

  it("the per-message template overrides the provider default; the legacy default still sends the whole body as {{1}}", async () => {
    await meta.send({ recipient: "+919876543210", body: "B", template: { name: "mapped", language: "en", parameters: ["p"] } }, cfg({ templateName: "provider_default" }));
    assert.equal(bodies[0].template.name, "mapped");
    await meta.send({ recipient: "+919876543210", body: "whole body" }, cfg({ templateName: "provider_default" }));
    assert.equal(bodies[1].template.name, "provider_default");
    assert.deepEqual(bodies[1].template.components[0].parameters, [{ type: "text", text: "whole body" }]);
    await meta.send({ recipient: "+919876543210", body: "free text" }, cfg());
    assert.deepEqual(bodies[2].text, { body: "free text" });
  });

  it("refuses what Meta would refuse, without making a request", async () => {
    const send = (template: any) => meta.send({ recipient: "+919876543210", body: "x", template }, cfg());
    for (const template of [
      { name: "Bad Name", language: "en", parameters: [] },
      { name: "ok", language: "english", parameters: [] },
      { name: "ok", language: "en", parameters: Array.from({ length: 11 }, () => "p") },
      { name: "ok", language: "en", parameters: [""] },
      { name: "ok", language: "en", parameters: ["line\nbreak"] },
      { name: "ok", language: "en", parameters: ["a    b"] },
      { name: "ok", language: "en", parameters: ["x".repeat(1025)] },
    ]) {
      const r = await send(template);
      assert.equal(r.success, false, JSON.stringify(template).slice(0, 60));
    }
    assert.equal(bodies.length, 0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// end to end
// ---------------------------------------------------------------------------------------------------------------
let t: TestDb;
let h: Harness;
let handler: CommunicationJobHandler;
let orgA: string;
let unmute: () => void;
const U: Record<string, string> = {};
const registry = () => (ProviderFactory as unknown as { registry: Record<string, ProviderAdapter> }).registry;
const originalMeta = registry().meta_whatsapp;
let sends: OutboundMessage[] = [];
let nextResult: AdapterSendResult | null = null;
const fakeMeta: ProviderAdapter = {
  provider: "meta_whatsapp",
  channelType: "whatsapp",
  send: async (m) => {
    sends.push(m);
    return nextResult ?? { success: true, providerMessageId: `wamid.${sends.length}` };
  },
  status: async () => ({ status: "sent" }),
  validate: async () => ({ valid: true }),
  healthCheck: async () => ({ healthy: true, checkedAt: new Date().toISOString() }),
};

before(async () => {
  unmute = silenceAudit();
  t = await createTestDb();
  handler = new CommunicationJobHandler(t.pool);
  orgA = await seedOrg(t.db, "A");
  U.manager = await seedUser(t.db, orgA, ["MANAGER"]);
  U.editor = await seedUser(t.db, orgA, ["EDITOR"]);
  U.viewer = await seedUser(t.db, orgA, ["VIEWER"]);
  h = await serve(t.pool);
  registry().meta_whatsapp = fakeMeta;
  process.env.COMM_META_TPL = "not-a-real-token";
  await t.db.query(
    `INSERT INTO public.communication_providers (organization_id, name, provider, channel_type, credentials_secret_ref, priority, settings)
     VALUES ($1,'meta','meta_whatsapp','whatsapp','COMM_META_TPL',0,'{"phoneNumberId":"1234567890"}')`,
    [orgA],
  );
});
after(async () => {
  registry().meta_whatsapp = originalMeta;
  delete process.env.COMM_META_TPL;
  unmute();
  await h.close();
  await t.db.close();
});
beforeEach(() => {
  sends = [];
  nextResult = null;
});

const as = (who: string) => ({ user: U[who], org: orgA });
const key = () => `k-${randomUUID()}`;
const rows = async (sql: string, p: unknown[] = []) => (await t.db.query<any>(sql, p)).rows;
const mkTemplate = (over: Record<string, unknown> = {}, who = "manager") =>
  call(h, "POST", "/api/communications/templates", {
    ...as(who),
    body: { name: `wa-${randomUUID().slice(0, 6)}`, channelType: "whatsapp", body: "Hi {{first_name}} from {{company}}", providerTemplateName: "claim_invite", providerTemplateLanguage: "en", providerTemplateVariables: ["first_name", "company"], ...over },
  });
const jobOf = async (messageId: string): Promise<QueueJob<any>> => (await rows(`SELECT q.* FROM public.job_queue q JOIN public.communication_messages m ON m.job_id = q.id WHERE m.id = $1`, [messageId]))[0] as QueueJob<any>;
let phoneSeq = 10;
async function contacts(n: number, over: { company?: string } = {}) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(await seedContact(t.db, orgA, { first: `F${i}`, last: `L${i}`, phone: `+9198000000${phoneSeq++}`, company: over.company === undefined ? `Co${i}` : over.company }));
  return ids;
}
const campaign = (templateId: string, contactIds: string[], extra: Record<string, unknown> = {}) =>
  call(h, "POST", "/api/communications/campaigns", { ...as("manager"), body: { name: "WA camp", channelType: "whatsapp", templateId, contactIds, consentConfirmed: true, ...extra } });

describe("template routes", () => {
  it("creates a mapped template as UNVERIFIED and an unmapped one as not_mapped; stores the ordered mapping", async () => {
    const r = await mkTemplate();
    assert.equal(r.status, 201, r.text);
    assert.deepEqual([r.json.template.provider_template_name, r.json.template.provider_template_language, r.json.template.provider_template_variables, r.json.template.provider_template_status], ["claim_invite", "en", ["first_name", "company"], "unverified"]);
    const un = await mkTemplate({ providerTemplateName: undefined, providerTemplateVariables: undefined });
    assert.equal(un.status, 201, un.text);
    assert.equal(un.json.template.provider_template_status, "not_mapped");
    const list = (await call(h, "GET", "/api/communications/templates?channelType=whatsapp", as("viewer"))).json.templates;
    assert.equal(list.find((x: any) => x.id === r.json.template.id).provider_template_status, "unverified");
    assert.equal(list.find((x: any) => x.id === un.json.template.id).provider_template_status, "not_mapped");
  });

  it("rejects an invalid mapping with 400 and stores nothing; viewers cannot create", async () => {
    const before = (await rows(`SELECT COUNT(*)::int n FROM public.communication_templates`))[0].n;
    for (const over of [
      { channelType: "email", subject: "s", providerTemplateName: "claim_invite" },
      { providerTemplateName: "Bad Name" },
      { providerTemplateLanguage: "english" },
      { providerTemplateVariables: ["a", "a"] },
      { providerTemplateVariables: "first_name" },
      { providerTemplateName: "", providerTemplateVariables: ["a"] },
    ]) {
      assert.equal((await mkTemplate(over)).status, 400, JSON.stringify(over));
    }
    assert.equal((await mkTemplate({}, "viewer")).status, 403);
    assert.equal((await rows(`SELECT COUNT(*)::int n FROM public.communication_templates`))[0].n, before);
  });

  it("the database refuses a mapping on a non-WhatsApp template even if the API were bypassed", async () => {
    await assert.rejects(
      () => t.db.query(`INSERT INTO public.communication_templates (organization_id, name, channel_type, body, provider_template_name) VALUES ($1,'x','email','b','claim_invite')`, [orgA]),
      /communication_templates_provider_template_check/,
    );
  });
});

describe("campaign guards (fail closed before anything is created)", () => {
  it("a WhatsApp campaign needs a MAPPED template", async () => {
    const un = (await mkTemplate({ providerTemplateName: undefined, providerTemplateVariables: undefined })).json.template.id;
    const r = await campaign(un, await contacts(1));
    assert.equal(r.status, 400);
    assert.match(r.json.detail, /mapped to a Meta-approved template/);
  });

  it("the mapped variables must be suppliable: recipients give first_name / last_name / company, the campaign may give more", async () => {
    const tpl = (await mkTemplate({ providerTemplateVariables: ["first_name", "order_no"] })).json.template.id;
    const c = await contacts(1);
    const refused = await campaign(tpl, c);
    assert.equal(refused.status, 400);
    assert.match(refused.json.detail, /order_no/);
    const ok = await campaign(tpl, c, { variables: { order_no: "PO-7" } });
    assert.equal(ok.status, 201, ok.text);
  });
});

describe("end to end: template + ordered parameters reach the provider, and verification is earned", () => {
  it("test send -> real worker -> provider receives the mapped template; the template turns verified_by_send only after acceptance", async () => {
    const tpl = (await mkTemplate()).json.template.id;
    const camp = (await campaign(tpl, await contacts(2))).json.campaign.id as string;
    assert.equal((await call(h, "GET", "/api/communications/templates?channelType=whatsapp", as("viewer"))).json.templates.find((x: any) => x.id === tpl).provider_template_status, "unverified");

    const test = await call(h, "POST", `/api/communications/campaigns/${camp}/test`, { ...as("manager"), key: key(), body: { testRecipient: "+919999999999" } });
    assert.equal(test.status, 202, test.text);
    await handler.handle(await jobOf(test.json.message.id));

    assert.equal(sends.length, 1);
    assert.deepEqual(sends[0].template, { name: "claim_invite", language: "en", parameters: ["Test", "Test Company"] });
    const stored = (await rows(`SELECT provider_template, status FROM public.communication_messages WHERE id = $1`, [test.json.message.id]))[0];
    assert.equal(stored.status, "sent");
    assert.deepEqual(stored.provider_template, { name: "claim_invite", language: "en", parameters: ["Test", "Test Company"] }, "the log records exactly what was handed to the provider");
    assert.equal((await call(h, "GET", "/api/communications/templates?channelType=whatsapp", as("viewer"))).json.templates.find((x: any) => x.id === tpl).provider_template_status, "verified_by_send");
  });

  it("a provider failure (e.g. Meta rejects an unapproved template) keeps the template UNVERIFIED and surfaces Meta's own error", async () => {
    const tpl = (await mkTemplate({ providerTemplateName: "not_approved_yet" })).json.template.id;
    const camp = (await campaign(tpl, await contacts(1))).json.campaign.id as string;
    nextResult = { success: false, errorMessage: "Meta API 400 (code 132001): Template name does not exist in the translation" };
    const test = await call(h, "POST", `/api/communications/campaigns/${camp}/test`, { ...as("manager"), key: key(), body: { testRecipient: "+919999999998" } });
    const failingJob = { ...(await jobOf(test.json.message.id)), retry_count: 5, max_retries: 3 } as QueueJob<any>;
    await assert.rejects(() => handler.handle(failingJob));
    const m = (await rows(`SELECT status, error_message FROM public.communication_messages WHERE id = $1`, [test.json.message.id]))[0];
    assert.equal(m.status, "dead_letter");
    assert.match(m.error_message, /132001/);
    assert.equal((await call(h, "GET", "/api/communications/templates?channelType=whatsapp", as("viewer"))).json.templates.find((x: any) => x.id === tpl).provider_template_status, "unverified");
  });

  it("a full campaign: each recipient gets ITS OWN ordered parameters; a recipient with a missing value fails alone, with the reason", async () => {
    const tpl = (await mkTemplate()).json.template.id;
    const good = await contacts(2);
    const noCompany = await contacts(1, { company: "" });
    const camp = (await campaign(tpl, [...good, ...noCompany])).json.campaign.id as string;
    const test = await call(h, "POST", `/api/communications/campaigns/${camp}/test`, { ...as("manager"), key: key(), body: { testRecipient: "+919999999997" } });
    await handler.handle(await jobOf(test.json.message.id));
    sends = [];

    assert.equal((await call(h, "POST", `/api/communications/campaigns/${camp}/execute`, as("manager"))).status, 202);
    const runJob = (await rows(`SELECT * FROM public.job_queue WHERE idempotency_key = $1`, [`camp-run:${camp}:1`]))[0];
    await handler.handle(runJob as QueueJob<any>);
    const msgJobs = await rows(`SELECT q.* FROM public.job_queue q JOIN public.communication_messages m ON m.job_id = q.id WHERE m.campaign_id = $1 AND NOT m.is_test AND q.status = 'queued'`, [camp]);
    for (const j of msgJobs) await handler.handle(j as QueueJob<any>);

    assert.deepEqual(sends.map((s) => s.template!.parameters).sort(), [["F0", "Co0"], ["F1", "Co1"]]);
    assert.ok(sends.every((s) => s.template!.name === "claim_invite"));
    const rec = await rows(`SELECT status, error_message, recipient FROM public.communication_campaign_recipients WHERE campaign_id = $1 ORDER BY status`, [camp]);
    const failed = rec.filter((r) => r.status === "failed");
    assert.equal(failed.length, 1, "only the recipient with no company fails");
    assert.match(failed[0].error_message, /variables\.company.*empty/);
    assert.equal(sends.length, 2, "nothing was sent for the failed recipient");
  });

  it("a single send with a mapped template refuses missing variables and records the template when they are given", async () => {
    const tpl = (await mkTemplate()).json.template.id;
    const send = (variables: Record<string, unknown>) => call(h, "POST", "/api/communications/send", { ...as("manager"), key: key(), body: { channelType: "whatsapp", recipient: "+919888888888", templateId: tpl, variables } });
    const refused = await send({ first_name: "Asha" });
    assert.equal(refused.status, 400);
    assert.match(refused.json.detail, /variables\.company/);
    const ok = await send({ first_name: "Asha", company: "Acme" });
    assert.equal(ok.status, 201, ok.text);
    assert.deepEqual((await rows(`SELECT provider_template FROM public.communication_messages WHERE id = $1`, [ok.json.message.id]))[0].provider_template.parameters, ["Asha", "Acme"]);
  });

  it("free-text WhatsApp (no template) still works and carries no template reference", async () => {
    const r = await call(h, "POST", "/api/communications/send", { ...as("manager"), key: key(), body: { channelType: "whatsapp", recipient: "+919777777777", body: "hello inside the 24h window" } });
    assert.equal(r.status, 201, r.text);
    await handler.handle(await jobOf(r.json.message.id));
    assert.equal(sends.at(-1)!.template, undefined);
    assert.equal((await rows(`SELECT provider_template FROM public.communication_messages WHERE id = $1`, [r.json.message.id]))[0].provider_template, null);
  });
});

describe("editing the mapping", () => {
  const patch = (id: string, body: unknown, who = "manager") => call(h, "PATCH", `/api/communications/templates/${id}`, { ...as(who), body });

  it("is validated as a whole, applied on top of the stored mapping, and audited by field names only", async () => {
    const id = (await mkTemplate()).json.template.id;
    assert.equal((await patch(id, { providerTemplateVariables: ["company", "first_name"] })).status, 200);
    let row = (await rows(`SELECT provider_template_name, provider_template_variables FROM public.communication_templates WHERE id = $1`, [id]))[0];
    assert.deepEqual([row.provider_template_name, row.provider_template_variables], ["claim_invite", ["company", "first_name"]], "the name is kept when only the variables change");
    assert.equal((await patch(id, { providerTemplateName: "Bad" })).status, 400);
    assert.equal((await patch(id, { providerTemplateVariables: ["a", "a"] })).status, 400);
    assert.equal((await patch(id, { providerTemplateName: "" })).status, 200, "clearing the name unmaps it");
    row = (await rows(`SELECT provider_template_name, provider_template_variables FROM public.communication_templates WHERE id = $1`, [id]))[0];
    assert.deepEqual([row.provider_template_name, row.provider_template_variables], [null, []]);
    assert.equal((await patch(id, { providerTemplateName: "again_ok" }, "viewer")).status, 403);
  });

  it("is LOCKED (409) while an unfinished campaign uses the template", async () => {
    const id = (await mkTemplate()).json.template.id;
    const camp = (await campaign(id, await contacts(1))).json.campaign.id as string;
    const r = await patch(id, { providerTemplateName: "swapped_template" });
    assert.equal(r.status, 409);
    assert.equal(r.json.error, "template_in_use");
    await call(h, "POST", `/api/communications/campaigns/${camp}/cancel`, as("manager"));
    assert.equal((await patch(id, { providerTemplateName: "swapped_template" })).status, 200);
  });

  it("an email template cannot be given a mapping", async () => {
    const email = await call(h, "POST", "/api/communications/templates", { ...as("manager"), body: { name: "mail", channelType: "email", subject: "s", body: "b" } });
    assert.equal((await patch(email.json.template.id, { providerTemplateName: "claim_invite" })).status, 400);
  });
});
