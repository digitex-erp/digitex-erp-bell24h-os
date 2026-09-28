/**
 * Explainability framework: contracts, validation, registry and storage. There is NO model and NO real explainer in
 * this repository, so the "explainer" used below is a hand-written TEST DOUBLE that returns numbers chosen by the test;
 * these tests prove the framework rejects bad explanations and fails closed — not that any explanation is meaningful.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { ExplainerMismatchError, ExplainerNotRegisteredError, ExplainerRegistry, explainerRegistry } from "../../explainability/registry.js";
import { registerExplainabilityRoutes } from "../../explainability/routes.js";
import { listExplanations, recordExplanation } from "../../explainability/store.js";
import { EXPLAIN_METHODS, EXPLAIN_SUBJECTS, type ExplainerAdapter, type Explanation } from "../../explainability/types.js";
import { additivityTolerance, validateExplanation } from "../../explainability/validate.js";
import { CommunicationValidationError } from "../validation.js";
import { applyMigration, createTestDb, seedOrg, seedUser, type TestDb } from "./helpers/testDb.js";
import { authenticate, call, serveApp, type Harness } from "./helpers/httpHarness.js";

const shap = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  subject: "rfq_matching",
  subjectId: "match-1",
  method: "shap",
  modelId: "test-double",
  modelVersion: "0.0.1",
  prediction: 0.8,
  baseValue: 0.5,
  attributions: [
    { feature: "category_match", value: 1, contribution: 0.25 },
    { feature: "distance_km", value: 40, contribution: -0.05 },
    { feature: "on_time_rate", value: 0.9, contribution: 0.1 },
  ],
  ...over,
});
const lime = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ ...shap({ method: "lime", localFit: 0.83 }), ...over });
const bad = (x: unknown, re?: RegExp) => assert.throws(() => validateExplanation(x), (e: Error) => e instanceof CommunicationValidationError && (!re || re.test(e.message)));

describe("SHAP explanations must be additive", () => {
  it("accepts base + Σ contributions = prediction", () => {
    const e = validateExplanation(shap());
    assert.equal(e.attributions.length, 3);
    assert.equal(e.localFit, undefined);
  });
  it("rejects explanations that do not add up, with the numbers in the message", () => {
    bad(shap({ prediction: 0.9 }), /must add up.*0\.8.*0\.9/);
    bad(shap({ baseValue: 0.1 }), /must add up/);
  });
  it("tolerates float rounding but not real gaps", () => {
    assert.doesNotThrow(() => validateExplanation(shap({ prediction: 0.8 + 1e-9 })));
    assert.ok(additivityTolerance(1000) > additivityTolerance(1));
    bad(shap({ prediction: 0.8 + 0.01 }));
  });
  it("rejects localFit on SHAP", () => bad(shap({ localFit: 0.5 }), /only valid for LIME/));
});

describe("LIME explanations need a fit, and need not be additive", () => {
  it("accepts a surrogate with a fit in [0,1] even when weights do not sum to the prediction", () => {
    const e = validateExplanation(lime({ prediction: 0.3 }));
    assert.equal(e.localFit, 0.83);
  });
  it("rejects a missing, out-of-range or non-numeric fit", () => {
    bad(lime({ localFit: undefined }), /finite number/);
    bad(lime({ localFit: 1.2 }), /between 0 and 1/);
    bad(lime({ localFit: -0.1 }), /between 0 and 1/);
    bad(lime({ localFit: "0.5" }), /finite number/);
  });
});

describe("shape and safety rules (reject, never repair)", () => {
  it("subject, method, ids and model fields", () => {
    bad(shap({ subject: "credit_score" }), /subject/);
    bad(shap({ method: "anchors" }), /method/);
    bad(shap({ subjectId: "" }), /subjectId/);
    bad(shap({ subjectId: "a\nb" }), /subjectId/);
    bad(shap({ modelId: "Model One" }), /modelId/);
    bad(shap({ modelVersion: "" }), /modelVersion/);
    bad(null, /object/);
    bad([], /object/);
  });
  it("numbers must be finite and bounded", () => {
    for (const v of [NaN, Infinity, -Infinity, "1", null, 1e12]) {
      bad(shap({ prediction: v }), /prediction/);
    }
    bad(shap({ baseValue: NaN }), /baseValue/);
    bad(shap({ attributions: [{ feature: "a", value: 1, contribution: NaN }] }), /contribution/);
  });
  it("attributions: non-empty, unique, well-named, bounded, de-identified values", () => {
    bad(shap({ attributions: [] }), /non-empty/);
    bad(shap({ attributions: "x" }), /non-empty/);
    bad(shap({ attributions: [{ feature: "a", value: 1, contribution: 0.3 }, { feature: "a", value: 2, contribution: 0 }] }), /duplicate/);
    bad(shap({ attributions: [{ feature: "1bad name", value: 1, contribution: 0.3 }] }), /feature name/);
    bad(shap({ attributions: [{ feature: "a", value: { nested: 1 }, contribution: 0.3 }] }), /number, string, boolean or null/);
    bad(shap({ attributions: [{ feature: "a", value: "x".repeat(101), contribution: 0.3 }] }), /at most 100/);
    bad(shap({ attributions: [{ feature: "a", value: "line\nbreak", contribution: 0.3 }] }), /control characters/);
    const many = Array.from({ length: 201 }, (_, i) => ({ feature: `f${i}`, value: 1, contribution: 0 }));
    bad(shap({ attributions: many, prediction: 0.5 }), /at most 200/);
    bad(shap({ attributions: [null] }), /object/);
  });
  it("returns a normalised copy: unknown extra fields are dropped, never stored", () => {
    const e = validateExplanation({ ...shap(), secret: "leak", attributions: [{ feature: "category_match", value: 1, contribution: 0.3, note: "leak" }] });
    assert.ok(!("secret" in e));
    assert.deepEqual(Object.keys(e.attributions[0]).sort(), ["contribution", "feature", "value"]);
  });
});

describe("registry fails closed", () => {
  const double = (over: Partial<ExplainerAdapter> & { returns?: () => Explanation }): ExplainerAdapter => ({
    subject: "rfq_matching",
    method: "shap",
    description: "test double that returns fixed numbers",
    explain: async (req) => (over.returns ? over.returns() : (shap({ subjectId: req.subjectId }) as unknown as Explanation)),
    ...over,
  });
  const req = { organizationId: "o", subject: "rfq_matching" as const, subjectId: "match-1", method: "shap" as const, features: {} };

  it("the default registry is EMPTY and reports framework_only", () => {
    const s = explainerRegistry.status();
    assert.equal(s.state, "framework_only");
    assert.equal(s.registered, 0);
    assert.equal(s.matrix.length, EXPLAIN_SUBJECTS.length);
    assert.ok(s.matrix.every((m) => m.methods.length === EXPLAIN_METHODS.length && m.methods.every((x) => x.state === "not_implemented")));
  });

  it("asking for an explanation with nothing registered throws a typed 'not implemented' — never a made-up result", async () => {
    const r = new ExplainerRegistry();
    await assert.rejects(() => r.explain(req), (e: Error) => e instanceof ExplainerNotRegisteredError && (e as ExplainerNotRegisteredError).code === "explainer_not_implemented" && /no scorer or explainer exists yet/.test(e.message));
  });

  it("a registered explainer works, and status reflects it (derived, not asserted)", async () => {
    const r = new ExplainerRegistry();
    r.register(double({}));
    assert.equal((await r.explain(req)).method, "shap");
    const s = r.status();
    assert.equal(s.state, "partial");
    assert.equal(s.registered, 1);
    assert.equal(s.matrix.find((m) => m.subject === "rfq_matching")!.methods.find((x) => x.method === "shap")!.state, "registered");
    assert.equal(s.matrix.find((m) => m.subject === "supplier_ranking")!.methods.every((x) => x.state === "not_implemented"), true);
    r.unregister("rfq_matching", "shap");
    assert.equal(r.status().state, "framework_only");
  });

  it("refuses a misdescribed or duplicate registration", () => {
    const r = new ExplainerRegistry();
    assert.throws(() => r.register(double({ description: "x" })), /describe honestly/);
    r.register(double({}));
    assert.throws(() => r.register(double({})), /already registered/);
    assert.throws(() => r.register({ ...double({}), subject: "nope" as any }), /Unknown/);
  });

  it("an explainer's OUTPUT is validated too: a non-additive or mismatched explanation is refused", async () => {
    const r = new ExplainerRegistry();
    r.register(double({ returns: () => shap({ prediction: 0.99 }) as unknown as Explanation }));
    await assert.rejects(() => r.explain(req), /must add up/);
    r.unregister("rfq_matching", "shap");
    r.register(double({ returns: () => shap({ subjectId: "someone-else" }) as unknown as Explanation }));
    await assert.rejects(() => r.explain(req), ExplainerMismatchError);
  });
});

describe("storage and routes", () => {
  let t: TestDb;
  let h: Harness;
  let orgA: string;
  let orgB: string;
  const U: Record<string, string> = {};
  const registry = new ExplainerRegistry();

  before(async () => {
    t = await createTestDb();
    await applyMigration(t.db, "add_explanations.sql");
    orgA = await seedOrg(t.db, "A");
    orgB = await seedOrg(t.db, "B");
    U.viewer = await seedUser(t.db, orgA, ["VIEWER"]);
    U.norole = await seedUser(t.db, orgA, []);
    U.viewerB = await seedUser(t.db, orgB, ["VIEWER"]);
    h = await serveApp((app) => registerExplainabilityRoutes(app, { getPool: () => t.pool, authenticate, registry }));
  });
  after(async () => {
    await h.close();
    await t.db.close();
  });
  const as = (who: string, org = orgA) => ({ user: U[who], org });

  it("the migration is re-runnable and append-only; tenants can read but never write", async () => {
    await applyMigration(t.db, "add_explanations.sql");
    const { id } = await recordExplanation(t.pool, orgA, null, shap());
    await assert.rejects(() => t.db.query(`UPDATE public.explanation_records SET prediction = 1 WHERE id = $1`, [id]), /append-only/);
    await assert.rejects(() => t.db.query(`DELETE FROM public.explanation_records WHERE id = $1`, [id]), /append-only/);
    await assert.rejects(() => t.db.query(`TRUNCATE public.explanation_records`), /append-only/);
    const p = (await t.db.query<any>(`SELECT has_table_privilege('authenticated','public.explanation_records','SELECT') s, has_table_privilege('authenticated','public.explanation_records','INSERT') i`)).rows[0];
    assert.deepEqual([p.s, p.i], [true, false]);
  });

  it("stores only VALID explanations; the database also refuses a SHAP row with a fit / a LIME row without one", async () => {
    await assert.rejects(() => recordExplanation(t.pool, orgA, null, shap({ prediction: 5 })), CommunicationValidationError);
    await assert.rejects(
      () => t.db.query(`INSERT INTO public.explanation_records (organization_id, subject_type, subject_id, method, model_id, model_version, prediction, base_value, attributions) VALUES ($1,'rfq_matching','x','lime','m','1',1,1,'[{"a":1}]')`, [orgA]),
      /explanation_records_lime_fit/,
    );
    assert.equal((await recordExplanation(t.pool, orgA, null, lime())).id.length > 10, true);
  });

  it("GET /records is organization-scoped, filterable and validated", async () => {
    await recordExplanation(t.pool, orgB, null, shap({ subjectId: "org-b-only" }));
    const a = await call(h, "GET", "/api/explainability/records?limit=200", as("viewer"));
    assert.equal(a.status, 200);
    assert.ok(a.json.records.length >= 2);
    assert.ok(!a.json.records.some((r: any) => r.subject_id === "org-b-only"));
    assert.deepEqual((await call(h, "GET", "/api/explainability/records", as("viewerB", orgB))).json.records.map((r: any) => r.subject_id), ["org-b-only"]);
    assert.ok((await call(h, "GET", "/api/explainability/records?method=lime", as("viewer"))).json.records.every((r: any) => r.method === "lime"));
    for (const badq of ["?subject=credit", "?method=anchors", "?limit=0", "?limit=201", `?subjectId=${"x".repeat(201)}`]) {
      assert.equal((await call(h, "GET", `/api/explainability/records${badq}`, as("viewer"))).status, 400, badq);
    }
  });

  it("needs a role; no role or no session is refused", async () => {
    assert.equal((await call(h, "GET", "/api/explainability/status", as("norole"))).status, 403);
    assert.equal((await call(h, "GET", "/api/explainability/records", as("norole"))).status, 403);
    assert.equal((await call(h, "GET", "/api/explainability/status")).status, 401);
  });

  it("GET /status reports framework_only while nothing is registered, and there is no endpoint that produces an explanation", async () => {
    const s = await call(h, "GET", "/api/explainability/status", as("viewer"));
    assert.equal(s.json.state, "framework_only");
    assert.equal(s.json.registered, 0);
    for (const path of ["/api/explainability/explain", "/api/explainability/records"]) {
      assert.equal((await call(h, "POST", path, { ...as("viewer"), body: shap() })).status, 404, path);
    }
  });

  it("503 with the remedy when the migration was never applied", async () => {
    const bare = await createTestDb();
    const org = await seedOrg(bare.db, "X");
    const viewer = await seedUser(bare.db, org, ["VIEWER"]);
    const hh = await serveApp((app) => registerExplainabilityRoutes(app, { getPool: () => bare.pool, authenticate, registry }));
    try {
      const r = await call(hh, "GET", "/api/explainability/records", { user: viewer, org });
      assert.equal(r.status, 503);
      assert.match(r.json.detail, /add_explanations\.sql/);
    } finally {
      await hh.close();
      await bare.db.close();
    }
  });
});

describe("listExplanations without a route", () => {
  it("rejects a bad limit type", async () => {
    await assert.rejects(() => listExplanations({} as any, "o", { limit: "abc" }), CommunicationValidationError);
  });
});
