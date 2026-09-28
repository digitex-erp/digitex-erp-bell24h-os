/**
 * Industry Intelligence (Phase 2, item 3): real migrations on a real Postgres engine, real service, real routes.
 * The data model is a register of recorded signals with provenance; nothing here predicts or collects.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { classifyTrend, validateSignal, validateSourceUrl } from "../../industry/IndustryService.js";
import { registerIndustryRoutes } from "../../industry/routes.js";
import { CommunicationValidationError } from "../validation.js";
import { applyMigration, createTestDb, seedOrg, seedUser, type TestDb } from "./helpers/testDb.js";
import { authenticate, call, serveApp, type Harness } from "./helpers/httpHarness.js";

let t: TestDb;
let h: Harness;
let orgA: string;
let orgB: string;
const U: Record<string, string> = {};
const realLog = console.log;
let audit: any[] = [];

const as = (who: string, org = orgA) => ({ user: U[who], org });
const rows = async (sql: string, p: unknown[] = []) => (await t.db.query<any>(sql, p)).rows;
const signal = (over: Record<string, unknown> = {}) => ({ title: "Steel demand up", signalType: "demand", sourceType: "user_provided", ...over });
const post = (path: string, body: unknown, who = "editor", org = orgA) => call(h, "POST", path, { ...as(who, org), body });

before(async () => {
  console.log = (...a: unknown[]) => {
    if (typeof a[0] === "string" && a[0].startsWith('{"kind":"audit"')) audit.push(JSON.parse(a[0]));
    else realLog(...a);
  };
  t = await createTestDb();
  await applyMigration(t.db, "add_industry_intelligence.sql");
  await applyMigration(t.db, "add_industry_signals.sql");
  orgA = await seedOrg(t.db, "A");
  orgB = await seedOrg(t.db, "B");
  U.admin = await seedUser(t.db, orgA, ["ADMIN"]);
  U.manager = await seedUser(t.db, orgA, ["MANAGER"]);
  U.editor = await seedUser(t.db, orgA, ["EDITOR"]);
  U.viewer = await seedUser(t.db, orgA, ["VIEWER"]);
  U.norole = await seedUser(t.db, orgA, []);
  U.editorB = await seedUser(t.db, orgB, ["EDITOR"]);
  h = await serveApp((app) => registerIndustryRoutes(app, { getPool: () => t.pool, authenticate, limits: { write: 1000 } }));
});
after(async () => {
  console.log = realLog;
  await h.close();
  await t.db.close();
});

describe("migrations", () => {
  it("both are re-runnable", async () => {
    await applyMigration(t.db, "add_industry_intelligence.sql");
    await applyMigration(t.db, "add_industry_signals.sql");
    await applyMigration(t.db, "add_industry_signals.sql");
  });

  it("industry names are unique PER organization, not globally (the old global UNIQUE is gone)", async () => {
    assert.equal((await post("/api/industry/industries", { name: "Steel" })).status, 201);
    assert.equal((await post("/api/industry/industries", { name: "Steel" }, "editorB", orgB)).status, 201, "another org may use the same name");
    const dup = await post("/api/industry/industries", { name: "STEEL" });
    assert.equal(dup.status, 400, "case-insensitive duplicate inside one org");
    assert.match(dup.json.detail, /already exists/);
  });

  it("the signals table enforces provenance and RLS/privileges in the database itself", async () => {
    const ind = (await rows(`INSERT INTO public.industries (name, organization_id) VALUES ('Direct', $1) RETURNING id`, [orgA]))[0].id;
    const ins = (over: string) => t.db.query(`INSERT INTO public.industry_signals (organization_id, industry_id, title, signal_type, source_type ${over.split("|")[0]}) VALUES ($1, $2, 't', 'demand', $3 ${over.split("|")[1]})`, [orgA, ind, over.split("|")[2] ?? "web_search"]);
    await assert.rejects(() => ins("|"), /industry_signals_source_url_required/, "web_search needs a URL");
    await assert.rejects(() => t.db.query(`INSERT INTO public.industry_signals (organization_id, title, signal_type, source_type, source_url) VALUES ($1,'t','demand','web_search','ftp://x')`, [orgA]), /check/i);
    await assert.rejects(() => t.db.query(`INSERT INTO public.industry_signals (organization_id, title, signal_type, source_type) VALUES ($1,'t','demand','scraped')`, [orgA]), /check/i);
    await assert.rejects(() => t.db.query(`INSERT INTO public.industry_signals (organization_id, title, signal_type, source_type, opportunity_note) VALUES ($1,'t','demand','user_provided','note')`, [orgA]), /industry_signals_opportunity_note/);
    const p = (await rows(`SELECT has_table_privilege('authenticated','public.industry_signals','SELECT') s, has_table_privilege('authenticated','public.industry_signals','INSERT') i, has_table_privilege('authenticated','public.industry_signals','DELETE') d`))[0];
    assert.deepEqual([p.s, p.i, p.d], [true, false, false], "tenants read, only the server writes");
  });
});

describe("validation rejects, never strips", () => {
  it("signal fields", () => {
    const bad = (o: Record<string, unknown>) => assert.throws(() => validateSignal({ title: "t", signalType: "demand", sourceType: "user_provided", ...o } as any), CommunicationValidationError, JSON.stringify(o).slice(0, 60));
    bad({ title: "" });
    bad({ title: "x".repeat(201) });
    bad({ title: "a\r\nb" });
    bad({ summary: "x".repeat(2001) });
    bad({ summary: "bad\u0000char" });
    bad({ signalType: "forecast" });
    bad({ sourceType: "scraper" });
    bad({ sourceType: "web_search" });
    bad({ sourceType: "public_api", sourceUrl: "" });
    bad({ sourceUrl: "javascript:alert(1)" });
    bad({ sourceUrl: "https://user:pw@example.com/x" });
    bad({ sourceUrl: "not a url" });
    bad({ observedAt: "next tuesday" });
    bad({ observedAt: "2999-01-01" });
    bad({ observedAt: "1990-01-01" });
    bad({ industryId: "nope" });
    bad({ isRfqOpportunity: "yes" });
    bad({ opportunityNote: "n" });
    const ok = validateSignal({ title: " ok ", signalType: "price", sourceType: "public_api", sourceUrl: "https://data.example.gov/x?a=1", summary: "line one\nline two", isRfqOpportunity: true, opportunityNote: "buyers asking" });
    assert.equal(ok.title, "ok");
    assert.equal(ok.summary, "line one\nline two");
    assert.equal(validateSourceUrl(undefined), null);
  });
});

describe("trend classification is descriptive arithmetic", () => {
  it("needs enough data; rising/falling need a real change; otherwise flat", () => {
    assert.equal(classifyTrend([0, 0, 1]), "insufficient_data");
    assert.equal(classifyTrend([1, 1]), "insufficient_data");
    assert.equal(classifyTrend([1, 1, 1, 1, 5]), "rising");
    assert.equal(classifyTrend([4, 4, 4, 4, 1]), "falling");
    assert.equal(classifyTrend([2, 2, 2, 2, 2]), "flat");
    assert.equal(classifyTrend([1, 1, 1, 1, 2]), "flat", "a change of 1 signal is noise, not a trend");
    assert.equal(classifyTrend([0, 0, 0, 0, 6]), "rising");
  });
});

describe("routes: RBAC, isolation, provenance", () => {
  it("read = any role; write = EDITOR+; delete = ADMIN/MANAGER; no role / no session refused", async () => {
    assert.equal((await call(h, "GET", "/api/industry/overview", as("viewer"))).status, 200);
    assert.equal((await call(h, "GET", "/api/industry/overview", as("norole"))).status, 403);
    assert.equal((await call(h, "GET", "/api/industry/overview")).status, 401);
    assert.equal((await post("/api/industry/signals", signal(), "viewer")).status, 403);
    assert.equal((await post("/api/industry/signals", signal(), "editor")).status, 201);
    const id = (await post("/api/industry/signals", signal({ title: "to delete" }), "manager")).json.signal.id;
    assert.equal((await call(h, "DELETE", `/api/industry/signals/${id}`, as("editor"))).status, 403);
    assert.equal((await call(h, "DELETE", `/api/industry/signals/${id}`, as("manager"))).status, 200);
    assert.equal((await call(h, "DELETE", `/api/industry/signals/${id}`, as("manager"))).status, 404);
    assert.equal((await call(h, "DELETE", "/api/industry/signals/not-a-uuid", as("manager"))).status, 400);
  });

  it("organizations are isolated: no cross-org reads, writes, links or deletes", async () => {
    const steel = (await call(h, "GET", "/api/industry/overview", as("viewer"))).json.industries.find((i: any) => i.name === "Steel");
    const foreign = await post("/api/industry/signals", signal({ industryId: steel.id }), "editorB", orgB);
    assert.equal(foreign.status, 404, "org B cannot attach a signal to org A's industry");
    const own = (await post("/api/industry/signals", signal({ title: "A-only signal", industryId: steel.id }))).json.signal;
    assert.deepEqual((await call(h, "GET", "/api/industry/signals?limit=200", as("editorB", orgB))).json.signals.map((s: any) => s.title), [], "org B sees none of A's signals");
    assert.equal((await call(h, "DELETE", `/api/industry/signals/${own.id}`, { user: U.editorB, org: orgB })).status, 403, "org B editor may not delete");
    assert.equal((await call(h, "GET", `/api/industry/industries/${steel.id}/categories`, as("editorB", orgB))).status, 404);
    assert.equal((await post(`/api/industry/industries/${steel.id}/categories`, { name: "Bars" }, "editorB", orgB)).status, 404);
    assert.equal((await call(h, "PATCH", `/api/industry/signals/${own.id}`, { ...as("editorB", orgB), body: { isRfqOpportunity: true } })).status, 404);
  });

  it("categories: create, list, unique per industry", async () => {
    const steel = (await call(h, "GET", "/api/industry/overview", as("viewer"))).json.industries.find((i: any) => i.name === "Steel");
    assert.equal((await post(`/api/industry/industries/${steel.id}/categories`, { name: "TMT Bars" })).status, 201);
    assert.equal((await post(`/api/industry/industries/${steel.id}/categories`, { name: "TMT Bars" })).status, 400);
    assert.deepEqual((await call(h, "GET", `/api/industry/industries/${steel.id}/categories`, as("viewer"))).json.categories.map((c: any) => c.name), ["TMT Bars"]);
    const ov = (await call(h, "GET", "/api/industry/overview", as("viewer"))).json;
    assert.equal(ov.industries.find((i: any) => i.name === "Steel").categories, 1);
  });

  it("provenance is enforced at the API: web_search / public_api need a URL; bad input is a 400 that stores nothing", async () => {
    const before = (await rows(`SELECT COUNT(*)::int n FROM public.industry_signals`))[0].n;
    for (const bad of [signal({ sourceType: "web_search" }), signal({ sourceType: "scraper" }), signal({ signalType: "forecast" }), signal({ title: "" }), signal({ sourceUrl: "ftp://x" })]) {
      assert.equal((await post("/api/industry/signals", bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await rows(`SELECT COUNT(*)::int n FROM public.industry_signals`))[0].n, before);
    const ok = await post("/api/industry/signals", signal({ title: "Copper price note", signalType: "price", sourceType: "web_search", sourceName: "Example News", sourceUrl: "https://news.example.com/copper" }));
    assert.equal(ok.status, 201);
    assert.equal(ok.json.signal.source_url, "https://news.example.com/copper");
  });

  it("opportunities: flag / unflag a signal; the list shows only flagged ones; a note needs the flag", async () => {
    const s = (await post("/api/industry/signals", signal({ title: "Buyers asking for HR coil" }))).json.signal;
    assert.equal((await call(h, "PATCH", `/api/industry/signals/${s.id}`, { ...as("editor"), body: { isRfqOpportunity: false, opportunityNote: "x" } })).status, 400);
    const on = await call(h, "PATCH", `/api/industry/signals/${s.id}`, { ...as("editor"), body: { isRfqOpportunity: true, opportunityNote: "Post an RFQ for HR coil" } });
    assert.equal(on.status, 200);
    const list = (await call(h, "GET", "/api/industry/opportunities", as("viewer"))).json;
    assert.deepEqual(list.signals.map((x: any) => x.title), ["Buyers asking for HR coil"]);
    const off = await call(h, "PATCH", `/api/industry/signals/${s.id}`, { ...as("editor"), body: { isRfqOpportunity: false } });
    assert.equal(off.json.signal.opportunity_note, null);
    assert.equal((await call(h, "GET", "/api/industry/opportunities", as("viewer"))).json.total, 0);
  });

  it("filters and paging on signals; unknown enum filters are rejected", async () => {
    const q = (s: string) => call(h, "GET", `/api/industry/signals${s}`, as("viewer"));
    assert.ok((await q("?signalType=price")).json.signals.every((x: any) => x.signal_type === "price"));
    assert.ok((await q("?sourceType=web_search")).json.signals.every((x: any) => x.source_type === "web_search"));
    assert.equal((await q("?signalType=forecast")).status, 400);
    assert.equal((await q("?industryId=nope")).status, 400);
    const p1 = (await q("?limit=2&offset=0")).json;
    assert.equal(p1.signals.length, 2);
    assert.ok(p1.total > 2);
  });

  it("every write is audited with enum values only (never titles or URLs)", async () => {
    audit = [];
    await post("/api/industry/signals", signal({ title: "SECRET-TITLE-XYZ", signalType: "trend", sourceType: "public_api", sourceUrl: "https://api.example.org/private-path" }));
    const e = audit.find((a) => a.action === "industry.signal.created");
    assert.ok(e);
    assert.deepEqual([e.metadata.signalType, e.metadata.sourceType], ["trend", "public_api"]);
    assert.ok(!JSON.stringify(audit).includes("SECRET-TITLE-XYZ") && !JSON.stringify(audit).includes("private-path"));
  });
});

describe("trends endpoint", () => {
  it("weekly counts per industry over complete weeks; descriptive note; validated window", async () => {
    const ind = (await call(h, "GET", "/api/industry/overview", as("viewer"))).json.industries.find((i: any) => i.name === "Steel");
    // 5 signals in each of the last 4 complete weeks-ago positions, then 1 in the most recent complete week
    const weekStart = (await rows(`SELECT date_trunc('week', NOW() AT TIME ZONE 'UTC') AS w`))[0].w as Date;
    const at = (weeksAgo: number) => new Date(new Date(weekStart).getTime() - weeksAgo * 7 * 86400_000 + 86400_000).toISOString();
    for (const [weeksAgo, n] of [[5, 1], [4, 1], [3, 1], [2, 1], [1, 6]] as const) {
      for (let i = 0; i < n; i++) await post("/api/industry/signals", signal({ title: `w${weeksAgo}-${i}`, industryId: ind.id, observedAt: at(weeksAgo) }));
    }
    const r = await call(h, "GET", "/api/industry/trends?weeks=6", as("viewer"));
    assert.equal(r.status, 200, r.text);
    const steel = r.json.trends.find((x: any) => x.name === "Steel");
    assert.equal(steel.weekly.length, 6);
    assert.deepEqual(steel.weekly.slice(-5).map((w: any) => w.count), [1, 1, 1, 1, 6]);
    assert.equal(steel.direction, "rising");
    assert.match(r.json.note, /Not a forecast/);
    for (const bad of ["?weeks=2", "?weeks=27", "?weeks=abc", "?weeks=1.5"]) assert.equal((await call(h, "GET", `/api/industry/trends${bad}`, as("viewer"))).status, 400, bad);
    const otherOrg = await call(h, "GET", "/api/industry/trends?weeks=6", as("editorB", orgB));
    assert.ok(!otherOrg.json.trends.some((x: any) => x.name === "Steel" && x.total > 0 && x.industryId === ind.id));
  });
});

describe("missing tables are reported, not hidden", () => {
  it("503 industry_tables_missing (with the remedy) when the migrations were never applied", async () => {
    const bare = await createTestDb();
    const org = await seedOrg(bare.db, "X");
    const viewer = await seedUser(bare.db, org, ["VIEWER"]);
    const hh = await serveApp((app) => registerIndustryRoutes(app, { getPool: () => bare.pool, authenticate }));
    try {
      const r = await call(hh, "GET", "/api/industry/overview", { user: viewer, org });
      assert.equal(r.status, 503);
      assert.equal(r.json.error, "industry_tables_missing");
      assert.match(r.json.detail, /add_industry_intelligence\.sql/);
      assert.equal((await call(hh, "GET", "/api/industry/signals", { user: viewer, org })).status, 503);
    } finally {
      await hh.close();
      await bare.db.close();
    }
  });

  it("an empty organization returns real zeros (an empty state), never a fabricated sample", async () => {
    const org = await seedOrg(t.db, "Empty");
    const viewer = await seedUser(t.db, org, ["VIEWER"]);
    const r = await call(h, "GET", "/api/industry/overview", { user: viewer, org });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.industries, []);
    assert.deepEqual(r.json.summary, { signals: 0, signals_30d: 0, opportunities: 0, user_provided: 0, public_api: 0, web_search: 0, unassigned: 0 });
    void randomUUID;
  });
});
