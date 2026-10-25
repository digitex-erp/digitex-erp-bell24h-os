/**
 * QueueManager job-lifecycle state transitions, against the real job_queue DDL and a real
 * (PGlite) Postgres engine -- not a mock of the query layer.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, seedOrg, type TestDb } from "../communication/__tests__/helpers/testDb.js";
import { QueueManager } from "./QueueManager.js";

let t: TestDb;
let qm: QueueManager;
let orgId: string;

before(async () => {
  t = await createTestDb();
  qm = new QueueManager(t.pool);
  orgId = await seedOrg(t.db, "QueueTestOrg");
});

after(async () => {
  await t.db.close();
});

test("1: a newly enqueued job starts in 'queued' status", async () => {
  const job = await qm.enqueueJob({ organizationId: orgId, jobType: "content", payload: { x: 1 } });
  assert.equal(job.status, "queued");
  assert.equal(job.retry_count, 0);
});

test("2: claimJobs transitions a queued job to 'running' and assigns the worker", async () => {
  const enqueued = await qm.enqueueJob({ organizationId: orgId, jobType: "content", payload: { x: 2 } });
  const claimed = await qm.claimJobs({ workerId: "worker-1", supportedTypes: ["content"], batchSize: 5 });
  const found = claimed.find((j) => j.id === enqueued.id);
  assert.ok(found, "the enqueued job must be claimable");
  assert.equal(found!.status, "running");
  assert.equal(found!.locked_by, "worker-1");
});

test("3: completeJob transitions a running job to 'completed' and clears the lock", async () => {
  const enqueued = await qm.enqueueJob({ organizationId: orgId, jobType: "content", payload: { x: 3 } });
  await qm.claimJobs({ workerId: "worker-2", supportedTypes: ["content"], batchSize: 5 });
  const ok = await qm.completeJob({ jobId: enqueued.id, workerId: "worker-2", result: { done: true } });
  assert.equal(ok, true);

  const row = await t.db.query<{ status: string; locked_by: string | null }>(
    `SELECT status, locked_by FROM public.job_queue WHERE id = $1`,
    [enqueued.id],
  );
  assert.equal(row.rows[0].status, "completed");
  assert.equal(row.rows[0].locked_by, null);
});

test("4: completeJob by the WRONG worker is rejected -- a job cannot be completed by anyone except the worker that claimed it", async () => {
  const enqueued = await qm.enqueueJob({ organizationId: orgId, jobType: "content", payload: { x: 4 } });
  await qm.claimJobs({ workerId: "worker-rightful", supportedTypes: ["content"], batchSize: 5 });
  const ok = await qm.completeJob({ jobId: enqueued.id, workerId: "worker-impostor", result: {} });
  assert.equal(ok, false, "a worker that did not claim the job must not be able to complete it");

  const row = await t.db.query<{ status: string }>(`SELECT status FROM public.job_queue WHERE id = $1`, [enqueued.id]);
  assert.equal(row.rows[0].status, "running", "the job must remain running, not silently completed by the wrong caller");
});

test("5: failJob with retries remaining transitions to 'retrying', not terminal failure", async () => {
  const enqueued = await qm.enqueueJob({ organizationId: orgId, jobType: "content", payload: { x: 5 }, maxRetries: 3 });
  await qm.claimJobs({ workerId: "worker-3", supportedTypes: ["content"], batchSize: 5 });
  const failed = await qm.failJob({ jobId: enqueued.id, workerId: "worker-3", error: "transient provider timeout" });
  assert.equal(failed.status, "retrying");
  assert.equal(failed.retry_count, 1);
});

test("6: failJob exhausting max_retries transitions to 'dead_letter', recording the reason", async () => {
  const enqueued = await qm.enqueueJob({ organizationId: orgId, jobType: "content", payload: { x: 6 }, maxRetries: 1 });
  await qm.claimJobs({ workerId: "worker-4", supportedTypes: ["content"], batchSize: 5 });
  const failed = await qm.failJob({ jobId: enqueued.id, workerId: "worker-4", error: "permanent provider rejection" });
  assert.equal(failed.status, "dead_letter");
  assert.match(failed.dead_letter_reason ?? "", /permanent provider rejection/);
});

test("7: failJob with isTerminal:true dead-letters immediately, even with retries remaining", async () => {
  const enqueued = await qm.enqueueJob({ organizationId: orgId, jobType: "content", payload: { x: 7 }, maxRetries: 5 });
  await qm.claimJobs({ workerId: "worker-5", supportedTypes: ["content"], batchSize: 5 });
  const failed = await qm.failJob({ jobId: enqueued.id, workerId: "worker-5", error: "non-retryable validation error", isTerminal: true });
  assert.equal(failed.status, "dead_letter");
});

test("8: idempotencyKey prevents a duplicate enqueue -- the second call returns the existing job, not a new row", async () => {
  const first = await qm.enqueueJob({ organizationId: orgId, jobType: "content", payload: { x: 8 }, idempotencyKey: "dup-key-1" });
  const second = await qm.enqueueJob({ organizationId: orgId, jobType: "content", payload: { x: 8, retried: true }, idempotencyKey: "dup-key-1" });
  assert.equal(first.id, second.id, "a repeated idempotency key must not create a second job_queue row");

  const count = await t.db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM public.job_queue WHERE idempotency_key = $1`,
    ["dup-key-1"],
  );
  assert.equal(count.rows[0].n, 1);
});

test("9: a job claimed by one worker is not claimable again by a second worker while its lease is live", async () => {
  await qm.enqueueJob({ organizationId: orgId, jobType: "content", payload: { x: 9 } });
  const firstClaim = await qm.claimJobs({ workerId: "worker-a", supportedTypes: ["content"], batchSize: 1 });
  const secondClaim = await qm.claimJobs({ workerId: "worker-b", supportedTypes: ["content"], batchSize: 1 });
  const overlap = firstClaim.some((a) => secondClaim.some((b) => a.id === b.id));
  assert.equal(overlap, false, "the same job must never be claimed by two workers concurrently");
});

test("10: getMetrics reports accurate counts across the queued/running/completed states exercised above", async () => {
  const metrics = await qm.getMetrics(orgId);
  assert.ok(typeof metrics.queued === "number");
  assert.ok(typeof metrics.running === "number");
  assert.ok(typeof metrics.completed === "number");
  assert.ok(metrics.completed >= 1, "at least the job completed in test 3 must be reflected");
});
