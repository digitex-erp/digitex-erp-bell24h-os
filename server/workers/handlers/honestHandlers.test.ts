/**
 * Handlers with no real implementation must fail without writing anything.
 * They previously slept, invented a URL or post ID, and reported success.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MediaJobHandler } from "./MediaJobHandler.js";
import { PublishingJobHandler } from "./PublishingJobHandler.js";
import { WorkerRegistry } from "../WorkerRegistry.js";
import { CapabilityNotImplementedError, sendError } from "../../lib/errors.js";

function recordingPool() {
  const queries: string[] = [];
  return {
    queries,
    pool: {
      query: async (sql: string) => {
        queries.push(sql);
        return { rows: [], rowCount: 0 };
      },
    } as any,
  };
}

function recordingQueueManager() {
  const calls = { complete: [] as any[], fail: [] as any[] };
  return {
    calls,
    qm: {
      heartbeat: async () => {},
      completeJob: async (o: any) => { calls.complete.push(o); },
      failJob: async (o: any) => { calls.fail.push(o); },
    } as any,
  };
}

function job(job_type: string, payload: Record<string, unknown>) {
  return { id: "job-1", organization_id: "org-1", job_type, payload } as any;
}

const mediaPayload = { prompt: "p", job_id: "domain-job-1", project_id: "project-1" };

for (const kind of ["image", "video"] as const) {
  test(`${kind} job fails NOT_IMPLEMENTED, writes nothing, returns no URL`, async () => {
    const { pool, queries } = recordingPool();
    const handler = new MediaJobHandler(pool, recordingQueueManager().qm);

    let returned: unknown = "not-called";
    await assert.rejects(
      async () => { returned = await handler.handle(job(kind, mediaPayload), "wrk-1"); },
      (err: any) => {
        assert.ok(err instanceof CapabilityNotImplementedError);
        assert.equal(err.code, "NOT_IMPLEMENTED");
        assert.equal(err.retryable, false);
        assert.doesNotMatch(err.message, /https?:\/\//);
        return true;
      },
    );
    assert.equal(returned, "not-called");
    assert.deepEqual(queries, [], "no job, asset or other row may be written");
  });
}

test("publishing job fails NOT_IMPLEMENTED, writes nothing, returns no post ID", async () => {
  const { pool, queries } = recordingPool();
  const handler = new PublishingJobHandler(pool);

  let returned: unknown = "not-called";
  await assert.rejects(
    async () => { returned = await handler.handle(job("publishing", { queue_id: "q-1", channel_type: "linkedin" })); },
    (err: any) => err instanceof CapabilityNotImplementedError && err.code === "NOT_IMPLEMENTED",
  );
  assert.equal(returned, "not-called");
  assert.deepEqual(queries, []);
});

for (const jobType of ["image", "video", "publishing", "social"]) {
  test(`registry never completes a ${jobType} job and fails it as terminal`, async () => {
    const { qm, calls } = recordingQueueManager();
    const registry = new WorkerRegistry(recordingPool().pool, qm);

    await (registry as any).executeJob(job(jobType, mediaPayload));

    assert.equal(calls.complete.length, 0);
    assert.equal(calls.fail.length, 1);
    assert.equal(calls.fail[0].isTerminal, true);
    assert.equal(calls.fail[0].error.code, "NOT_IMPLEMENTED");
  });
}

test("AI text jobs still complete with the handler's result", async () => {
  const { qm, calls } = recordingQueueManager();
  const registry = new WorkerRegistry(recordingPool().pool, qm);
  const result = { output: "generated text", provider: "gemini" };
  (registry as any).aiHandler = { handle: async () => result };

  await (registry as any).executeJob(job("content", { prompt: "p" }));

  assert.equal(calls.fail.length, 0);
  assert.deepEqual(calls.complete, [{ jobId: "job-1", workerId: registry.workerId, result }]);
});

test("ordinary handler errors keep the existing retry behaviour", async () => {
  const { qm, calls } = recordingQueueManager();
  const registry = new WorkerRegistry(recordingPool().pool, qm);
  (registry as any).aiHandler = { handle: async () => { throw new Error("provider timeout"); } };

  await (registry as any).executeJob(job("content", { prompt: "p" }));

  assert.equal(calls.complete.length, 0);
  assert.equal(calls.fail[0].isTerminal, false);
});

test("NOT_IMPLEMENTED is reported as non-retryable in the error envelope", () => {
  let body: any;
  const res = { status: () => ({ json: (b: any) => { body = b; } }) } as any;
  sendError(res, 501, "NOT_IMPLEMENTED", "req-1", "not implemented");
  assert.equal(body.error_code, "NOT_IMPLEMENTED");
  assert.equal(body.retryable, false);
});
