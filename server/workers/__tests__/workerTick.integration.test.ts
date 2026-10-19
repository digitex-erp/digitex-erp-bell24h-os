/**
 * Regression tests for the orphaned-job recovery fix wired into
 * GET /api/v1/workers/tick (server.ts).
 *
 * Boots the REAL server.ts createApp() -- not a hand-built Express app
 * wrapping the handler in isolation -- because the whole point of this
 * fix is that the recovery path is reachable through the actual deployed
 * route, not just through WorkerSupervisor.runReaperTick() called directly.
 * Mirrors the dynamic-import pattern already used elsewhere in this exact
 * repository to boot server.ts under a test runner (VERCEL/NODE_ENV set
 * before the module's own top-level code runs, via a *dynamic* import --
 * a static import resolves too early for that to work).
 *
 * Uses the same real-Postgres-via-PGlite harness as the Communication Hub
 * suite (server/communication/__tests__/helpers/testDb.ts): the real
 * job_queue DDL (including the reaper's own lock_expires_at index), loaded
 * from supabase_schema.sql, not a hand-written stand-in. job_workers is not
 * part of that existing helper's slice, so it is added here the same way
 * (sliced from the same source file) rather than hand-typed.
 *
 * QueueManager/WorkerRegistry/WorkerSupervisor are process-wide singletons.
 * createTestDb() already rebinds QueueManager's singleton to the test pool;
 * this file does the same for WorkerRegistry and WorkerSupervisor BEFORE
 * createApp() is ever imported, so the route's own getWorkerRegistry()/
 * getWorkerSupervisor() closures -- which call .getInstance(getPool(), ...)
 * -- return these pre-bound test instances. getPool() itself still needs a
 * syntactically valid DATABASE_URL to not throw when evaluated as an
 * argument; a bogus, never-actually-connected-to value is set for exactly
 * that reason and no query is ever run through it.
 *
 * No live database, no live Meta/WhatsApp call, no production credential --
 * confirmed by this file never setting a Meta credential and the Meta
 * adapter never being exercised by any test here (job_type is scoped to
 * generic queue mechanics, not provider sends).
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  createTestDb,
  type TestDb,
} from "../../communication/__tests__/helpers/testDb.js";
import { QueueManager } from "../../queue/QueueManager.js";
import { WorkerRegistry } from "../WorkerRegistry.js";
import { WorkerSupervisor } from "../WorkerSupervisor.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const CRON_SECRET = "test-cron-secret-not-real";

/** job_workers DDL, sliced from the same source file testDb.ts already uses for job_queue -- not hand-typed. */
function jobWorkersDdl(): string {
  const sql = fs.readFileSync(path.join(REPO_ROOT, "supabase_schema.sql"), "utf8");
  const start = sql.indexOf("-- Job Workers");
  const end = sql.indexOf("-- Job Schedules", start);
  if (start < 0 || end < 0) throw new Error("Could not locate the job_workers DDL in supabase_schema.sql");
  return sql.slice(start, end);
}

let t: TestDb;
let app: { url: string; close: () => Promise<void> };
let server: Server;

type JobRow = {
  id: string;
  status: string;
  retry_count: number;
  max_retries: number;
  locked_by: string | null;
  lock_expires_at: string | null;
};

async function insertJob(opts: {
  organizationId: string;
  jobType?: string;
  status: string;
  retryCount?: number;
  maxRetries?: number;
  lockedBy?: string | null;
  lockExpiresAt?: Date | null;
}): Promise<string> {
  const res = await t.db.query<{ id: string }>(
    `INSERT INTO public.job_queue
       (organization_id, job_type, payload, status, retry_count, max_retries, locked_by, lock_expires_at, locked_at, heartbeat_at)
     VALUES ($1, $2, '{}'::jsonb, $3, $4, $5, $6, $7, NOW(), NOW())
     RETURNING id`,
    [
      opts.organizationId,
      opts.jobType ?? "communication",
      opts.status,
      opts.retryCount ?? 0,
      opts.maxRetries ?? 3,
      opts.lockedBy ?? null,
      opts.lockExpiresAt ?? null,
    ],
  );
  return res.rows[0].id;
}

async function getJob(jobId: string): Promise<JobRow> {
  const res = await t.db.query<JobRow>(
    `SELECT id, status, retry_count, max_retries, locked_by, lock_expires_at FROM public.job_queue WHERE id = $1`,
    [jobId],
  );
  return res.rows[0];
}

/**
 * reapOrphanedJobs() has no organization_id filter (it reclaims cluster-wide
 * by design), so any job left behind by one test is visible to every later
 * test's reaper pass in the same file. Tests that must insert a job the
 * tick is never expected to touch (e.g. the auth-rejection tests below) must
 * delete it themselves -- via this helper, called from a finally block so
 * cleanup still happens if an assertion throws -- rather than relying on a
 * fresh organization_id per test, which does not isolate reaper-level
 * queries the way it isolates organization-scoped ones.
 */
async function deleteJob(jobId: string): Promise<void> {
  await t.db.query(`DELETE FROM public.job_queue WHERE id = $1`, [jobId]);
}

async function callTick(headers: Record<string, string> = {}): Promise<{ status: number; json: any }> {
  const res = await fetch(`${app.url}/api/v1/workers/tick`, { headers });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON response */
  }
  return { status: res.status, json };
}

before(async () => {
  process.env.CRON_SECRET = CRON_SECRET;
  // Never dialed: QueueManager/WorkerRegistry/WorkerSupervisor singletons are
  // pre-bound to the PGlite-backed test pool below before any route can call
  // getPool() itself; this value only needs to be syntactically acceptable
  // to node-postgres's lazy Pool constructor, never actually connected to.
  process.env.DATABASE_URL = "postgres://test:test@127.0.0.1:1/test_never_connected";
  process.env.VERCEL = "1";
  process.env.NODE_ENV = "production";

  t = await createTestDb();
  await t.db.exec(jobWorkersDdl());

  // Rebind the other two singletons to this same test pool/QueueManager
  // instance, the same technique createTestDb() already uses for
  // QueueManager -- not a new mechanism.
  const qm = QueueManager.getInstance(t.pool);
  (WorkerRegistry as unknown as { instance: WorkerRegistry | null }).instance = null;
  (WorkerSupervisor as unknown as { instance: WorkerSupervisor | null }).instance = null;
  WorkerRegistry.getInstance(t.pool, qm, { supportedTypes: ["communication"] });
  WorkerSupervisor.getInstance(t.pool, qm, { heartbeatTimeoutMs: 120000 });

  const { createApp } = await import("../../../server.js");
  const expressApp = await createApp();
  server = await new Promise<Server>((resolve) => {
    const s = expressApp.listen(0, "127.0.0.1", () => resolve(s));
  });
  app = {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
});

after(async () => {
  await app.close();
  await t.db.close();
});

let orgId: string;
beforeEach(async () => {
  const res = await t.db.query<{ id: string }>(`INSERT INTO public.organizations (name) VALUES ('Org') RETURNING id`);
  orgId = res.rows[0].id;
});

describe("GET /api/v1/workers/tick -- auth", () => {
  test("4: missing Authorization header is rejected (401), no recovery or batch work performed", async () => {
    const before = await insertJob({
      organizationId: orgId,
      jobType: "test_orphan_probe",
      status: "running",
      lockedBy: "dead-worker-1",
      lockExpiresAt: new Date(Date.now() - 10 * 60 * 1000),
    });
    try {
      const res = await callTick();
      assert.equal(res.status, 401);
      const row = await getJob(before);
      assert.equal(row.status, "running", "an unauthenticated request must not trigger recovery");
    } finally {
      // Reviewed finding: reapOrphanedJobs() has no org filter, so this
      // fixture would otherwise be reclaimed by every later test's reaper
      // pass in this file. Cleaned up here, in a finally block, so it is
      // removed even if the assertions above fail -- not just on the happy
      // path.
      await deleteJob(before);
    }
  });

  test("4b: wrong secret is rejected (401)", async () => {
    const res = await callTick({ Authorization: "Bearer wrong-secret" });
    assert.equal(res.status, 401);
  });
});

describe("GET /api/v1/workers/tick -- orphaned-job recovery", () => {
  test("1: an expired running job is recovered (flipped to retrying) when the authenticated tick executes", async () => {
    // job_type deliberately NOT "communication" -- the reaper reclaims by
    // any job_type, but the worker in this suite only supports
    // "communication" (see before()), so this job is reclaimed and then
    // left at 'retrying' rather than immediately re-claimed and re-failed
    // by the same tick's batch step. That keeps this assertion isolated to
    // the reaper step alone; test 7a below exercises the reclaim-then-
    // immediately-reprocessed interaction on purpose.
    const jobId = await insertJob({
      organizationId: orgId,
      jobType: "test_orphan_probe",
      status: "running",
      retryCount: 0,
      maxRetries: 3,
      lockedBy: "dead-worker-1",
      lockExpiresAt: new Date(Date.now() - 10 * 60 * 1000), // expired 10 minutes ago
    });

    const res = await callTick({ Authorization: `Bearer ${CRON_SECRET}` });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.ok(res.json.reaper, "response must surface the real reaper result, not just a boolean");
    assert.ok(res.json.reaper.reapedJobsCount >= 1, "the expired job must be counted as reaped");

    const row = await getJob(jobId);
    assert.equal(row.status, "retrying");
    assert.equal(row.locked_by, null, "the stale lock must be cleared");
    assert.equal(row.retry_count, 1);
  });

  test("2: recovery follows the existing retry/dead-letter policy -- a job already at its retry limit is dead-lettered, not retried again", async () => {
    const jobId = await insertJob({
      organizationId: orgId,
      jobType: "test_orphan_probe", // see test 1's comment: isolates the reaper step from the batch-claim step
      status: "running",
      retryCount: 2,
      maxRetries: 3, // retry_count + 1 >= max_retries -> dead_letter, same formula QueueManager.failJob uses
      lockedBy: "dead-worker-2",
      lockExpiresAt: new Date(Date.now() - 10 * 60 * 1000),
    });

    const res = await callTick({ Authorization: `Bearer ${CRON_SECRET}` });
    assert.equal(res.status, 200);

    const row = await getJob(jobId);
    assert.equal(row.status, "dead_letter");
    assert.equal(row.locked_by, null);
  });

  test("3: a job with a valid, unexpired lease is NOT reclaimed", async () => {
    const jobId = await insertJob({
      organizationId: orgId,
      status: "running",
      lockedBy: "live-worker-1",
      lockExpiresAt: new Date(Date.now() + 10 * 60 * 1000), // still 10 minutes in the future
    });

    const res = await callTick({ Authorization: `Bearer ${CRON_SECRET}` });
    assert.equal(res.status, 200);

    const row = await getJob(jobId);
    assert.equal(row.status, "running", "a job with a live lease must not be touched by the reaper");
    assert.equal(row.locked_by, "live-worker-1");
  });

  test("6: normal batch processing still runs in the same tick (queued jobs are still claimed)", async () => {
    const jobId = await insertJob({ organizationId: orgId, jobType: "communication", status: "queued" });

    const res = await callTick({ Authorization: `Bearer ${CRON_SECRET}` });
    assert.equal(res.status, 200);
    assert.ok(typeof res.json.claimedCount === "number", "the existing processBatch() response shape must be preserved");
    assert.ok(res.json.claimedCount >= 1, "the queued job must still be claimed by the batch step");
  });

  test("7a: a reclaimed job is immediately eligible for claimJobs() in the SAME tick (reaper runs before the batch claim)", async () => {
    const jobId = await insertJob({
      organizationId: orgId,
      jobType: "communication",
      status: "running",
      retryCount: 0,
      maxRetries: 3,
      lockedBy: "dead-worker-3",
      lockExpiresAt: new Date(Date.now() - 10 * 60 * 1000),
    });

    const res = await callTick({ Authorization: `Bearer ${CRON_SECRET}` });
    assert.equal(res.status, 200);
    assert.ok(res.json.reaper.reapedJobsCount >= 1);

    const row = await getJob(jobId);
    // Reclaimed to 'retrying' with next_run_at = NOW(), then immediately
    // claimed by the same tick's processBatch() -- CommunicationJobHandler
    // then runs it; with no communication_messages row to find for this
    // payload, it throws, and QueueManager.failJob advances it again. The
    // load-bearing assertion is simply that it did NOT stay stuck at
    // 'running' under the dead worker's lock -- the lock_expires_at index
    // and reclaim path is what this task fixes, not message-handler
    // behavior for a synthetic payload.
    assert.notEqual(row.locked_by, "dead-worker-3");
  });

  test("7b: repeated ticks are idempotent -- a second tick with nothing new to reap does not re-touch an already-recovered job or create duplicate job_queue rows", async () => {
    const jobId = await insertJob({
      organizationId: orgId,
      status: "running",
      lockedBy: "dead-worker-4",
      lockExpiresAt: new Date(Date.now() - 10 * 60 * 1000),
    });

    const first = await callTick({ Authorization: `Bearer ${CRON_SECRET}` });
    assert.ok(first.json.reaper.reapedJobsCount >= 1, "first tick must reclaim the orphaned job");
    const afterFirst = await getJob(jobId);
    assert.notEqual(afterFirst.status, "running", "the job must no longer be stuck 'running' under the dead lock after the first tick");

    const countBefore = (await t.db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM public.job_queue WHERE id = $1`, [jobId])).rows[0].n;

    const second = await callTick({ Authorization: `Bearer ${CRON_SECRET}` });
    assert.equal(second.status, 200);
    const countAfter = (await t.db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM public.job_queue WHERE id = $1`, [jobId])).rows[0].n;

    assert.equal(countBefore, 1);
    assert.equal(countAfter, 1, "no duplicate job_queue row must be created by a second tick");
  });
});

describe("GET /api/v1/workers/tick -- failure reporting", () => {
  test("5a: the response always carries numeric reaper counts, not a bare boolean", async () => {
    // Renamed from its original title ("a reaper-layer failure is not
    // reported as a false success") -- that claim was not actually tested
    // here; no failure was ever injected. This test's real job is simply to
    // confirm the response shape the route depends on. See 5b below for the
    // genuine, injected-failure version of the original claim.
    const res = await callTick({ Authorization: `Bearer ${CRON_SECRET}` });
    assert.equal(res.status, 200);
    assert.ok(typeof res.json.reaper?.reapedJobsCount === "number");
    assert.ok(typeof res.json.reaper?.deadWorkersCount === "number");
  });

  test("5b: a genuine, injected reaper database failure is surfaced via reaper.reapError, not reported as a successful empty recovery", async () => {
    // Deterministic, surgical failure injection: wraps pool.connect() so
    // that ONLY the reaper's own query (identified by a text fragment
    // unique to reapOrphanedJobs()'s SQL -- "expired_jobs", which appears
    // nowhere else in this codebase's queries) throws; every other query on
    // the same connection (BEGIN/COMMIT/ROLLBACK, and any other code's own
    // transactions in the same tick) passes through to the real client
    // unmodified. Restored in `finally` so this never leaks into a later
    // test even if an assertion below fails.
    const realConnect = t.pool.connect.bind(t.pool);
    const INJECTED_MESSAGE = "INJECTED_TEST_FAILURE: simulated reaper database failure";
    (t.pool as unknown as { connect: typeof t.pool.connect }).connect = async () => {
      const realClient = await realConnect();
      const realQuery = realClient.query.bind(realClient);
      return {
        ...realClient,
        query: async (text: unknown, params?: unknown[]) => {
          if (typeof text === "string" && text.includes("expired_jobs")) {
            throw new Error(INJECTED_MESSAGE);
          }
          return realQuery(text as string, params);
        },
      } as typeof realClient;
    };

    try {
      const res = await callTick({ Authorization: `Bearer ${CRON_SECRET}` });
      // The route itself did not throw -- QueueManager.reapOrphanedJobs()
      // rethrows on failure (verified by reading it), but
      // WorkerSupervisor.runReaperTick()'s own catch deliberately still
      // swallows that rethrow rather than letting it propagate further
      // (preserved, not redesigned, by this task's fix to that method) --
      // so the tick still returns 200 and batch processing still runs. What
      // changed is that the failure is no longer invisible: it is now
      // carried in reaper.reapError instead of being indistinguishable from
      // "nothing to reap".
      assert.equal(res.status, 200);
      assert.equal(res.json.reaper.reapedJobsCount, 0, "a failed reclamation attempt must not report a nonzero count");
      assert.equal(res.json.reaper.reapError, INJECTED_MESSAGE, "the real failure must be surfaced, not swallowed into silence");
    } finally {
      (t.pool as unknown as { connect: typeof t.pool.connect }).connect = realConnect;
    }
  });
});
