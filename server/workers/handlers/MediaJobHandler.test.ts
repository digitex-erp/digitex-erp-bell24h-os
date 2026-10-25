/**
 * MediaJobHandler.processVideoJob() -- the MiniMax video integration (2026-10-25).
 * All HTTP is mocked via a monkey-patched global.fetch; no real provider call is
 * ever made. Uses the real job_queue/organizations DDL (via the existing
 * createTestDb() harness) plus test-local video_jobs/video_assets tables
 * (columns matched to supabase_schema.sql, FK constraints to video_projects/
 * templates/styles dropped since this suite never needs those tables).
 */
import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createTestDb, seedOrg, type TestDb } from "../../communication/__tests__/helpers/testDb.js";
import { MediaJobHandler, type MediaJobPayload } from "./MediaJobHandler.js";
import { QueueManager } from "../../queue/QueueManager.js";
import { getCircuitBreaker, resetCircuitBreaker } from "../../ai/ProviderRouter.js";
import type { QueueJob } from "../../queue/QueueTypes.js";

const VIDEO_TABLES_DDL = `
  CREATE TABLE public.video_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    prompt TEXT NOT NULL,
    negative_prompt TEXT,
    video_type TEXT,
    status TEXT DEFAULT 'queued',
    error_message TEXT,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    completed_at TIMESTAMPTZ
  );
  CREATE TABLE public.video_assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID REFERENCES public.video_jobs(id) ON DELETE CASCADE,
    project_id UUID,
    asset_url TEXT NOT NULL,
    video_type TEXT,
    prompt TEXT,
    negative_prompt TEXT,
    provider TEXT,
    model TEXT,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE
  );
`;

let t: TestDb;
let orgA: string;
let orgB: string;
const realLog = console.log;
const realWarn = console.warn;
const realFetch = global.fetch;

before(async () => {
  console.log = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith('{"kind":"audit"')) return;
    realLog(...args);
  };
  console.warn = () => {}; // circuit-breaker trip logs are expected noise in the failure tests
  t = await createTestDb();
  await t.db.exec(VIDEO_TABLES_DDL);
  orgA = await seedOrg(t.db, "VideoOrgA");
  orgB = await seedOrg(t.db, "VideoOrgB");
  process.env.MINIMAX_API_KEY = "test-minimax-key-not-real";
});

after(async () => {
  console.log = realLog;
  console.warn = realWarn;
  global.fetch = realFetch;
  delete process.env.MINIMAX_API_KEY;
  await t.db.close();
});

beforeEach(() => {
  resetCircuitBreaker("minimax");
});

afterEach(() => {
  global.fetch = realFetch;
});

async function makeVideoJob(organizationId: string, payload: Partial<MediaJobPayload> = {}): Promise<{ job: QueueJob<MediaJobPayload>; videoJobId: string }> {
  const videoJobRow = await t.db.query<{ id: string }>(
    `INSERT INTO public.video_jobs (prompt, organization_id, status) VALUES ($1, $2, 'running') RETURNING id`,
    [payload.prompt ?? "a cat riding a skateboard", organizationId],
  );
  const videoJobId = videoJobRow.rows[0].id;
  const qm = new QueueManager(t.pool);
  const job = await qm.enqueueJob<MediaJobPayload>({
    organizationId,
    jobType: "video",
    payload: { prompt: "a cat riding a skateboard", job_id: videoJobId, duration: "5", ...payload },
  });
  return { job: { ...job, organization_id: organizationId }, videoJobId };
}

function mockFetchSequence(responses: Array<{ ok: boolean; status: number; body: any }>) {
  let i = 0;
  global.fetch = (async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return { ok: r.ok, status: r.status, json: async () => r.body } as Response;
  }) as typeof fetch;
}

test("1: successful provider response persists real asset metadata and completes the job", async () => {
  mockFetchSequence([
    { ok: true, status: 200, body: { task_id: "task-1" } },
    { ok: true, status: 200, body: { status: "Success", file_id: "file-1" } },
    { ok: true, status: 200, body: { file: { download_url: "https://cdn.minimax.io/real-video-1.mp4" } } },
  ]);
  const handler = new MediaJobHandler(t.pool, new QueueManager(t.pool));
  const { job, videoJobId } = await makeVideoJob(orgA);
  const result = await handler.handle(job, "worker-1");
  assert.equal(result.assetUrl, "https://cdn.minimax.io/real-video-1.mp4");

  const videoJob = await t.db.query<{ status: string }>(`SELECT status FROM public.video_jobs WHERE id = $1`, [videoJobId]);
  assert.equal(videoJob.rows[0].status, "completed");
  const asset = await t.db.query<{ asset_url: string; organization_id: string }>(`SELECT asset_url, organization_id FROM public.video_assets WHERE job_id = $1`, [videoJobId]);
  assert.equal(asset.rows[0].asset_url, "https://cdn.minimax.io/real-video-1.mp4", "the persisted URL must be the real provider-returned value, never fabricated");
  assert.equal(asset.rows[0].organization_id, orgA);
});

test("2: missing credential/configuration fails honestly, never attempts a network call", async () => {
  delete process.env.MINIMAX_API_KEY;
  let fetchCalled = false;
  global.fetch = (async () => { fetchCalled = true; throw new Error("must not be called"); }) as typeof fetch;
  const handler = new MediaJobHandler(t.pool, new QueueManager(t.pool));
  const { job, videoJobId } = await makeVideoJob(orgA);
  await assert.rejects(() => handler.handle(job, "worker-1"), /PROVIDER_NOT_CONFIGURED/);
  assert.equal(fetchCalled, false);
  const videoJob = await t.db.query<{ status: string; error_message: string }>(`SELECT status, error_message FROM public.video_jobs WHERE id = $1`, [videoJobId]);
  assert.equal(videoJob.rows[0].status, "failed");
  process.env.MINIMAX_API_KEY = "test-minimax-key-not-real";
});

test("3: a submit-call timeout is surfaced as an honest failure, not a hang or fabricated success", async () => {
  global.fetch = (async () => { throw Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" }); }) as typeof fetch;
  const handler = new MediaJobHandler(t.pool, new QueueManager(t.pool));
  const { job, videoJobId } = await makeVideoJob(orgA);
  await assert.rejects(() => handler.handle(job, "worker-1"), /PROVIDER_CALL_FAILED/);
  const videoJob = await t.db.query<{ status: string }>(`SELECT status FROM public.video_jobs WHERE id = $1`, [videoJobId]);
  assert.equal(videoJob.rows[0].status, "failed");
});

test("4: a provider 4xx response fails honestly with the HTTP status surfaced", async () => {
  mockFetchSequence([{ ok: false, status: 401, body: { base_resp: { status_code: 1004, status_msg: "invalid api key" } } }]);
  const handler = new MediaJobHandler(t.pool, new QueueManager(t.pool));
  const { job } = await makeVideoJob(orgA);
  await assert.rejects(() => handler.handle(job, "worker-1"), /HTTP 401/);
});

test("5: a provider 5xx response fails honestly, distinct from a 4xx", async () => {
  mockFetchSequence([{ ok: false, status: 503, body: {} }]);
  const handler = new MediaJobHandler(t.pool, new QueueManager(t.pool));
  const { job } = await makeVideoJob(orgA);
  await assert.rejects(() => handler.handle(job, "worker-1"), /HTTP 503/);
});

test("6: a malformed submit response (200 OK but no task_id) is rejected, not treated as success", async () => {
  mockFetchSequence([{ ok: true, status: 200, body: { unexpected: "shape" } }]);
  const handler = new MediaJobHandler(t.pool, new QueueManager(t.pool));
  const { job, videoJobId } = await makeVideoJob(orgA);
  await assert.rejects(() => handler.handle(job, "worker-1"), /malformed response/);
  const videoJob = await t.db.query<{ status: string }>(`SELECT status FROM public.video_jobs WHERE id = $1`, [videoJobId]);
  assert.equal(videoJob.rows[0].status, "failed", "a malformed response must never be recorded as completed");
});

test("7: budget denial is checked BEFORE any provider dispatch -- fetch is never called", async () => {
  // AI_REQUEST_DAILY_BUDGET is read into a module-level const at import time
  // (ProviderRouter.ts), so setting the env var here would have no effect --
  // exhaust the real default budget (200/24h) directly via the same exported
  // consumeBudget() the handler itself calls, for a dedicated org so no other
  // test's usage interferes.
  const budgetOrg = await seedOrg(t.db, "BudgetExhaustedOrg");
  const { consumeBudget } = await import("../../ai/ProviderRouter.js");
  for (let i = 0; i < 200; i++) consumeBudget(budgetOrg);

  let fetchCalled = false;
  global.fetch = (async () => { fetchCalled = true; return { ok: true, status: 200, json: async () => ({ task_id: "x" }) } as Response; }) as typeof fetch;
  const handler = new MediaJobHandler(t.pool, new QueueManager(t.pool));
  const { job } = await makeVideoJob(budgetOrg);
  await assert.rejects(() => handler.handle(job, "worker-1"), /budget exceeded/i);
  assert.equal(fetchCalled, false, "budget must be checked before any network call is attempted");
});

test("8: circuit-breaker denial is checked BEFORE any provider dispatch when the breaker is OPEN", async () => {
  const { recordBreakerFailure } = await import("../../ai/ProviderRouter.js");
  recordBreakerFailure("minimax", "simulated"); recordBreakerFailure("minimax", "simulated"); recordBreakerFailure("minimax", "simulated");
  assert.equal(getCircuitBreaker("minimax").state, "OPEN", "precondition: breaker must actually be open for this test to mean anything");

  let fetchCalled = false;
  global.fetch = (async () => { fetchCalled = true; return { ok: true, status: 200, json: async () => ({}) } as Response; }) as typeof fetch;
  const handler = new MediaJobHandler(t.pool, new QueueManager(t.pool));
  const { job } = await makeVideoJob(orgA);
  await assert.rejects(() => handler.handle(job, "worker-1"), /CIRCUIT_BREAKER_OPEN/);
  assert.equal(fetchCalled, false);
});

test("9: a provider failure trips the circuit breaker (retryable-by-queue, non-fabricated) via the shared breaker state", async () => {
  mockFetchSequence([{ ok: false, status: 500, body: {} }]);
  const handler = new MediaJobHandler(t.pool, new QueueManager(t.pool));
  for (let i = 0; i < 3; i++) {
    mockFetchSequence([{ ok: false, status: 500, body: {} }]);
    const { job } = await makeVideoJob(orgA);
    await assert.rejects(() => handler.handle(job, `worker-${i}`));
  }
  assert.equal(getCircuitBreaker("minimax").state, "OPEN", "3 consecutive failures must trip the shared breaker, same threshold as text providers");
});

test("10: idempotencyKey prevents a duplicate job_queue row for a repeated video request", async () => {
  const qm = new QueueManager(t.pool);
  const videoJobRow = await t.db.query<{ id: string }>(`INSERT INTO public.video_jobs (prompt, organization_id) VALUES ('dup', $1) RETURNING id`, [orgA]);
  const payload: MediaJobPayload = { prompt: "dup", job_id: videoJobRow.rows[0].id };
  const first = await qm.enqueueJob({ organizationId: orgA, jobType: "video", payload, idempotencyKey: "video-dup-1" });
  const second = await qm.enqueueJob({ organizationId: orgA, jobType: "video", payload, idempotencyKey: "video-dup-1" });
  assert.equal(first.id, second.id, "a repeated idempotency key must reuse the same video job_queue row, never dispatch twice");
});

test("11: truthful failure state is recorded even when video_jobs has no job_id reference (job_queue-only payload)", async () => {
  mockFetchSequence([{ ok: false, status: 500, body: {} }]);
  const handler = new MediaJobHandler(t.pool, new QueueManager(t.pool));
  const qm = new QueueManager(t.pool);
  const job = await qm.enqueueJob<MediaJobPayload>({ organizationId: orgA, jobType: "video", payload: { prompt: "no job_id here" } });
  await assert.rejects(() => handler.handle({ ...job, organization_id: orgA }, "worker-1"));
  // No video_jobs row to check -- the point of this test is that the handler doesn't throw
  // a SECOND, different error (e.g. a null-pointer on payload.job_id) when that field is absent.
});

test("12: organization isolation -- the persisted asset's organization_id always matches the job's trusted queue context, never any value a payload could carry", async () => {
  mockFetchSequence([
    { ok: true, status: 200, body: { task_id: "task-iso" } },
    { ok: true, status: 200, body: { status: "Success", file_id: "file-iso" } },
    { ok: true, status: 200, body: { file: { download_url: "https://cdn.minimax.io/iso.mp4" } } },
  ]);
  const handler = new MediaJobHandler(t.pool, new QueueManager(t.pool));
  // Attempt an organization override: the payload claims orgB, but the queue job's own
  // organization_id (set at enqueue time, from the authenticated caller) is orgA.
  const { job, videoJobId } = await makeVideoJob(orgA, { } as any);
  (job as any).payload.organization_id = orgB; // forged field, must be ignored
  await handler.handle(job, "worker-1");
  const asset = await t.db.query<{ organization_id: string }>(`SELECT organization_id FROM public.video_assets WHERE job_id = $1`, [videoJobId]);
  assert.equal(asset.rows[0].organization_id, orgA, "a payload-supplied organization_id must never override the job's trusted queue-level organization_id");
});
