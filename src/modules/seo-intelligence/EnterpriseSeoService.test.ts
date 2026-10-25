/**
 * EnterpriseSeoService -- regression tests for the P0 fabrication fix (2026-10-25):
 * addKeyword() must never fabricate search_volume/difficulty/cpc/position/
 * opportunity_score via Math.random(); getKeywords() must never fall back to
 * hardcoded seed data; generateContentBrief() must never return a fully-formed
 * brief implying real AI generation when none occurred.
 *
 * Requires --experimental-test-module-mocks (see package.json's test script)
 * to mock "@/lib/supabase" and "@/lib/currentOrganization" before import --
 * the real supabase.ts module reads import.meta.env, which is undefined under
 * plain tsx/node (not Vite), and would crash on load otherwise.
 */
import { test, mock, before, after } from "node:test";
import assert from "node:assert/strict";

const inserted: Record<string, unknown>[] = [];
let queryResult: { data: unknown[] | null; error: { message: string } | null } = { data: [], error: null };

function fakeQueryBuilder() {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    order: () => Promise.resolve(queryResult),
    insert: (rows: Record<string, unknown>[]) => {
      inserted.push(...rows);
      return builder;
    },
    single: () =>
      Promise.resolve({
        data: inserted.length > 0 ? { id: "kw-test-1", ...inserted[inserted.length - 1], created_at: "now", updated_at: "now" } : null,
        error: null,
      }),
  };
  return builder;
}

const fakeSupabase = {
  from: (_table: string) => fakeQueryBuilder(),
};

before(() => {
  mock.module("@/lib/supabase", { namedExports: { supabase: fakeSupabase } });
  mock.module("@/lib/currentOrganization", { namedExports: { getCurrentOrganizationId: async () => "org-test-1" } });
});

after(() => {
  mock.reset();
});

test("1: addKeyword no longer fabricates metrics -- all previously-random fields are null", async () => {
  const { EnterpriseSeoService } = await import("./EnterpriseSeoService.js");
  const service = EnterpriseSeoService.getInstance();
  const kw = await service.addKeyword("proj-1", "test keyword");

  assert.equal(kw.search_volume, null, "search_volume must be null (not yet measured), never a random number");
  assert.equal(kw.difficulty, null);
  assert.equal(kw.cpc, null);
  assert.equal(kw.opportunity_score, null);
  assert.equal(kw.current_position, null);
  assert.equal(kw.previous_position, null);

  const persisted = inserted[inserted.length - 1];
  assert.equal(persisted.search_volume, null, "the persisted row itself must carry null, not a fabricated value written to the real table");
});

test("2: getKeywords returns an honest empty array on an empty table, never hardcoded seed data", async () => {
  queryResult = { data: [], error: null };
  const { EnterpriseSeoService } = await import("./EnterpriseSeoService.js");
  const service = EnterpriseSeoService.getInstance();
  const keywords = await service.getKeywords("proj-1");

  assert.deepEqual(keywords, [], "an empty real table must return an empty array, not fabricated seed rows (e.g. the previously-hardcoded 'cotton yarn wholesale price Surat' example)");
});

test("3: getKeywords returns an honest empty array on a query error too, not seed data", async () => {
  queryResult = { data: null, error: { message: "simulated transient read failure" } };
  const { EnterpriseSeoService } = await import("./EnterpriseSeoService.js");
  const service = EnterpriseSeoService.getInstance();
  const keywords = await service.getKeywords("proj-1");

  assert.deepEqual(keywords, []);
});

test("4: getKeywords returns real data unmodified when the table genuinely has rows", async () => {
  const realRow = { id: "kw-real-1", organization_id: "org-test-1", project_id: "proj-1", keyword: "real measured keyword", search_volume: 1234, difficulty: 42, cpc: 3.5, intent: "Commercial", is_tracked: true, opportunity_score: 29.4, created_at: "now", updated_at: "now" };
  queryResult = { data: [realRow], error: null };
  const { EnterpriseSeoService } = await import("./EnterpriseSeoService.js");
  const service = EnterpriseSeoService.getInstance();
  const keywords = await service.getKeywords("proj-1");

  assert.deepEqual(keywords, [realRow], "genuine data from the real table must pass through unmodified -- this fix must not break legitimate functionality");
});

test("5: generateContentBrief throws an explicit not-implemented error instead of returning a fabricated brief", async () => {
  const { EnterpriseSeoService } = await import("./EnterpriseSeoService.js");
  const service = EnterpriseSeoService.getInstance();

  await assert.rejects(
    () => service.generateContentBrief("proj-1", "cotton yarn", "Commercial" as any),
    /SEO_CONTENT_BRIEF_NOT_IMPLEMENTED/,
    "must fail honestly rather than return a templated brief indistinguishable from real AI output",
  );
});
