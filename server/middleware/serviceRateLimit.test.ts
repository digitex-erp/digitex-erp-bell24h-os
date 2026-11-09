/**
 * Tests for createServiceRateLimit, using a real Postgres engine (PGlite,
 * the same package and pattern already established by
 * aiProvidersCredentialGrant.live.test.ts) rather than a hand-simulated
 * fake pool -- this exercises the actual SQL in
 * add_service_rate_limit_tables.sql and the middleware's real queries
 * against real Postgres atomic-increment semantics, not a JS
 * approximation of them.
 *
 * The injectable `now` option is used throughout instead of real waiting,
 * per this task's own instruction against flaky timing-based tests --
 * "window recovery" is tested by advancing a fake clock, never by a real
 * setTimeout.
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { NextFunction, Response } from "express";
import { createServiceRateLimit } from "./serviceRateLimit.js";
import type { ServiceAuthedRequest } from "./requireServiceAuth.js";

const MIGRATION_PATH = path.resolve(import.meta.dirname, "..", "..", "add_service_rate_limit_tables.sql");
const migrationSql = fs.readFileSync(MIGRATION_PATH, "utf8");

let db: PGlite;

before(async () => {
  db = new PGlite();
  // The migration now REVOKEs from anon/authenticated (TASK 13C fix for
  // Finding 1) -- those roles must exist before the migration runs, same
  // as the dedicated privDb instance below does for the privilege tests.
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;`);
  await db.exec(migrationSql);
});

after(async () => {
  await db.close();
});

beforeEach(async () => {
  // Isolate each test: clear both tables so counts/windows don't leak
  // between tests sharing the one PGlite instance.
  await db.exec(`TRUNCATE service_rate_limit_windows, service_concurrency_slots;`);
});

function fakeReq(system = "vyaparsethu", requestId = "req_test"): ServiceAuthedRequest {
  return {
    serviceCaller: { system },
    requestId,
    method: "POST",
    path: "/api/v1/ai/text",
  } as unknown as ServiceAuthedRequest;
}

function fakeRes() {
  let statusCode: number | null = null;
  let body: unknown = null;
  const headers: Record<string, string> = {};
  const finishListeners: Array<() => void> = [];
  const closeListeners: Array<() => void> = [];
  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(payload: unknown) {
      body = payload;
      return res;
    },
    setHeader(name: string, value: string) {
      headers[name] = value;
      return res;
    },
    on(event: string, cb: () => void) {
      if (event === "finish") finishListeners.push(cb);
      if (event === "close") closeListeners.push(cb);
      return res;
    },
    // Test helpers, not part of the real Response interface: simulate
    // Express/Node firing "finish" (response fully sent) or "close"
    // (connection ended, with or without a completed response -- e.g. a
    // client disconnect) independently, so a test can exercise either
    // ordering, or both, the way a real socket actually can.
    __simulateFinish() {
      for (const cb of finishListeners) cb();
    },
    __simulateClose() {
      for (const cb of closeListeners) cb();
    },
  } as unknown as Response & { __simulateFinish(): void; __simulateClose(): void };
  return { res, getStatus: () => statusCode, getBody: () => body, getHeaders: () => headers };
}

async function run(
  limiter: ReturnType<typeof createServiceRateLimit>,
  req: ServiceAuthedRequest,
  res: ReturnType<typeof fakeRes>["res"],
): Promise<{ nextCalled: boolean }> {
  let nextCalled = false;
  await limiter(req, res, (() => {
    nextCalled = true;
  }) as NextFunction);
  return { nextCalled };
}

describe("createServiceRateLimit", () => {
  test("requests below the configured limit are all accepted", async () => {
    const limiter = createServiceRateLimit({ name: "t", windowLimit: 5, windowMs: 60_000, maxConcurrent: 10, getPool: () => db as any });
    for (let i = 0; i < 4; i++) {
      const req = fakeReq();
      const { res } = fakeRes();
      const { nextCalled } = await run(limiter, req, res);
      res.__simulateFinish();
      assert.equal(nextCalled, true, `request ${i + 1} of 4 (under the limit of 5) should be accepted`);
    }
  });

  test("a request exactly at the configured limit is accepted; the next one is rejected", async () => {
    const limiter = createServiceRateLimit({ name: "t", windowLimit: 3, windowMs: 60_000, maxConcurrent: 10, getPool: () => db as any });
    for (let i = 0; i < 3; i++) {
      const req = fakeReq();
      const { res } = fakeRes();
      const { nextCalled } = await run(limiter, req, res);
      res.__simulateFinish();
      assert.equal(nextCalled, true, `request ${i + 1} of exactly 3 (the limit) should be accepted`);
    }
    const req4 = fakeReq();
    const { res: res4, getStatus } = fakeRes();
    const { nextCalled: fourthAccepted } = await run(limiter, req4, res4);
    assert.equal(fourthAccepted, false, "the 4th request, exceeding the limit of 3, must be rejected");
    assert.equal(getStatus(), 429);
  });

  test("requests exceeding the limit are rejected with 429 and a correctly-shaped response", async () => {
    const limiter = createServiceRateLimit({ name: "t", windowLimit: 1, windowMs: 60_000, maxConcurrent: 10, getPool: () => db as any });
    const req1 = fakeReq();
    const { res: res1 } = fakeRes();
    await run(limiter, req1, res1);
    res1.__simulateFinish();

    const req2 = fakeReq();
    const { res: res2, getStatus, getBody } = fakeRes();
    const { nextCalled } = await run(limiter, req2, res2);
    assert.equal(nextCalled, false);
    assert.equal(getStatus(), 429);
    const body = getBody() as any;
    assert.equal(body.error_code, "RATE_LIMITED");
    assert.equal(body.retryable, true);
    assert.equal(typeof body.request_id, "string");
    assert.equal(typeof body.details.retryAfterSeconds, "number");
  });

  test("the Retry-After header is set on a window-limit rejection, and is a positive integer number of seconds", async () => {
    const limiter = createServiceRateLimit({ name: "t", windowLimit: 1, windowMs: 60_000, maxConcurrent: 10, getPool: () => db as any });
    const req1 = fakeReq();
    const { res: res1 } = fakeRes();
    await run(limiter, req1, res1);
    res1.__simulateFinish();

    const req2 = fakeReq();
    const { res: res2, getHeaders } = fakeRes();
    await run(limiter, req2, res2);
    const retryAfter = Number(getHeaders()["Retry-After"]);
    assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1, `Retry-After must be a positive integer, got ${getHeaders()["Retry-After"]}`);
    assert.ok(retryAfter <= 60, "Retry-After must not exceed the window length");
  });

  test("different authenticated service identities (identity_key) have fully independent limits -- one exhausting its own limit never affects another", async () => {
    const limiter = createServiceRateLimit({ name: "t", windowLimit: 1, windowMs: 60_000, maxConcurrent: 10, getPool: () => db as any });

    const reqA1 = fakeReq("vyaparsethu");
    const { res: resA1 } = fakeRes();
    const { nextCalled: a1 } = await run(limiter, reqA1, resA1);
    resA1.__simulateFinish();
    assert.equal(a1, true);

    const reqA2 = fakeReq("vyaparsethu");
    const { res: resA2, getStatus: getStatusA2 } = fakeRes();
    const { nextCalled: a2 } = await run(limiter, reqA2, resA2);
    assert.equal(a2, false, "vyaparsethu's own 2nd request must be rejected, having exhausted its limit of 1");
    assert.equal(getStatusA2(), 429);

    // A different service identity must have its own, independent budget --
    // not inherit vyaparsethu's exhausted one.
    const reqB1 = fakeReq("a-future-second-trusted-caller");
    const { res: resB1 } = fakeRes();
    const { nextCalled: b1 } = await run(limiter, reqB1, resB1);
    assert.equal(b1, true, "a different service identity must not be affected by another identity's exhausted limit");
  });

  test("concurrent requests: a burst of requests up to maxConcurrent, all still in flight, are accepted; the next one is rejected", async () => {
    const limiter = createServiceRateLimit({ name: "t", windowLimit: 100, windowMs: 60_000, maxConcurrent: 2, getPool: () => db as any });

    // Two requests start and never finish (simulating two still-in-flight
    // AI calls) -- do NOT call __simulateFinish for either yet.
    const req1 = fakeReq();
    const { res: res1 } = fakeRes();
    const { nextCalled: accepted1 } = await run(limiter, req1, res1);
    assert.equal(accepted1, true);

    const req2 = fakeReq();
    const { res: res2 } = fakeRes();
    const { nextCalled: accepted2 } = await run(limiter, req2, res2);
    assert.equal(accepted2, true);

    // A 3rd, still while the first two are in flight, must be rejected --
    // this is the property a pure request-rate window cannot express on
    // its own: these three requests could all have arrived within the
    // same window and well under windowLimit=100, yet the 3rd must still
    // be rejected because too many are concurrently in flight right now.
    const req3 = fakeReq();
    const { res: res3, getStatus } = fakeRes();
    const { nextCalled: accepted3 } = await run(limiter, req3, res3);
    assert.equal(accepted3, false, "a 3rd concurrent request, exceeding maxConcurrent=2, must be rejected even though the window limit is nowhere near exhausted");
    assert.equal(getStatus(), 429);

    // Once one of the two in-flight requests finishes (releasing its slot),
    // a new request must be accepted again.
    res1.__simulateFinish();
    const req4 = fakeReq();
    const { res: res4 } = fakeRes();
    const { nextCalled: accepted4 } = await run(limiter, req4, res4);
    assert.equal(accepted4, true, "after one in-flight request finishes and releases its slot, a new request must be accepted");
  });

  test("invalid and unauthenticated requests: a request with no serviceCaller (should never reach this middleware, but defensively) fails closed, not open", async () => {
    const limiter = createServiceRateLimit({ name: "t", windowLimit: 5, windowMs: 60_000, maxConcurrent: 10, getPool: () => db as any });
    const req = { requestId: "req_test", method: "POST", path: "/api/v1/ai/text" } as unknown as ServiceAuthedRequest; // no serviceCaller
    const { res, getStatus } = fakeRes();
    const { nextCalled } = await run(limiter, req, res);
    assert.equal(nextCalled, false, "a missing serviceCaller must never be treated as an unlimited caller");
    assert.equal(getStatus(), 500, "this is a middleware-ordering defect, not a rate-limit rejection, and is reported distinctly (500, not 429)");
  });

  test("limiter-storage failures fail OPEN: the request proceeds, and the failure is audited", async () => {
    const brokenPool = { query: async () => { throw new Error("connection reset"); } } as any;
    const limiter = createServiceRateLimit({ name: "t", windowLimit: 5, windowMs: 60_000, maxConcurrent: 10, getPool: () => brokenPool });
    const req = fakeReq();
    const { res, getStatus } = fakeRes();

    const originalLog = console.log;
    const auditLines: string[] = [];
    console.log = (line: unknown) => { auditLines.push(String(line)); };
    let nextCalled: boolean;
    try {
      ({ nextCalled } = await run(limiter, req, res));
    } finally {
      console.log = originalLog;
    }

    assert.equal(nextCalled, true, "a storage failure must not block the request -- fail open, per this module's documented justification");
    assert.equal(getStatus(), null, "no error response should be written on the fail-open path");
    assert.ok(auditLines.length >= 1, "a storage failure must still be audited, even though the request proceeds");
    const event = JSON.parse(auditLines[0]);
    assert.equal(event.action, "ratelimit.storage_error");
    assert.equal(event.outcome, "denied");
  });

  test("configuration with windowLimit=0 behaves predictably: every request is rejected, without crashing", async () => {
    const limiter = createServiceRateLimit({ name: "t", windowLimit: 0, windowMs: 60_000, maxConcurrent: 10, getPool: () => db as any });
    const req = fakeReq();
    const { res, getStatus } = fakeRes();
    const { nextCalled } = await run(limiter, req, res);
    assert.equal(nextCalled, false);
    assert.equal(getStatus(), 429);
  });

  test("invalid configuration (NaN from a malformed env var) fails fast at construction time, rather than silently becoming unlimited", () => {
    // Number("not-a-number") is NaN, and `count > NaN` is always false in
    // JS -- without this guard, a malformed env var would silently disable
    // the limiter entirely instead of failing visibly at startup.
    assert.throws(
      () => createServiceRateLimit({ name: "t", windowLimit: Number("not-a-number"), windowMs: 60_000, maxConcurrent: 10, getPool: () => db as any }),
      /invalid windowLimit/,
    );
    assert.throws(
      () => createServiceRateLimit({ name: "t", windowLimit: 5, windowMs: Number(undefined), maxConcurrent: 10, getPool: () => db as any }),
      /invalid windowMs/,
    );
    assert.throws(
      () => createServiceRateLimit({ name: "t", windowLimit: 5, windowMs: 60_000, maxConcurrent: -1, getPool: () => db as any }),
      /invalid maxConcurrent/,
    );
    assert.throws(
      () => createServiceRateLimit({ name: "t", windowLimit: 5, windowMs: 0, maxConcurrent: 10, getPool: () => db as any }),
      /windowMs must be greater than 0/,
    );
  });

  test("configuration with maxConcurrent=0 behaves predictably: every request is rejected, without crashing", async () => {
    const limiter = createServiceRateLimit({ name: "t", windowLimit: 100, windowMs: 60_000, maxConcurrent: 0, getPool: () => db as any });
    const req = fakeReq();
    const { res, getStatus } = fakeRes();
    const { nextCalled } = await run(limiter, req, res);
    assert.equal(nextCalled, false);
    assert.equal(getStatus(), 429);
  });

  test("recovery after the rate-limit window expires: a caller rejected in one window is accepted again once a new window starts, using an injected clock -- no real waiting", async () => {
    let currentTime = 1_000_000; // arbitrary fixed epoch ms, deterministic
    const limiter = createServiceRateLimit({
      name: "t",
      windowLimit: 1,
      windowMs: 60_000,
      maxConcurrent: 10,
      getPool: () => db as any,
      now: () => currentTime,
    });

    const req1 = fakeReq();
    const { res: res1 } = fakeRes();
    const { nextCalled: first } = await run(limiter, req1, res1);
    res1.__simulateFinish();
    assert.equal(first, true);

    const req2 = fakeReq();
    const { res: res2 } = fakeRes();
    const { nextCalled: secondSameWindow } = await run(limiter, req2, res2);
    assert.equal(secondSameWindow, false, "a 2nd request in the same window, over the limit of 1, must be rejected");

    // Advance the injected clock past the window boundary -- no real delay.
    currentTime += 60_000;

    const req3 = fakeReq();
    const { res: res3 } = fakeRes();
    const { nextCalled: thirdNewWindow } = await run(limiter, req3, res3);
    assert.equal(thirdNewWindow, true, "once the window has genuinely advanced, the same caller must be accepted again");
  });

  test("existing successful AI request behavior is unaffected: an accepted request calls next() with no response written, and releases its concurrency slot on finish", async () => {
    const limiter = createServiceRateLimit({ name: "t", windowLimit: 5, windowMs: 60_000, maxConcurrent: 1, getPool: () => db as any });
    const req = fakeReq();
    const { res, getStatus, getBody } = fakeRes();
    const { nextCalled } = await run(limiter, req, res);
    assert.equal(nextCalled, true);
    assert.equal(getStatus(), null, "this middleware must not write any response on the accept path -- that's the real route handler's job");
    assert.equal(getBody(), null);
    res.__simulateFinish();

    // With maxConcurrent=1, a 2nd request must now be accepted again, proving
    // the first request's slot was genuinely released on "finish", not leaked.
    const req2 = fakeReq();
    const { res: res2 } = fakeRes();
    const { nextCalled: secondAccepted } = await run(limiter, req2, res2);
    assert.equal(secondAccepted, true, "the slot must have been released when the first request finished");
  });

  test("the response body never contains any internal infrastructure detail (table/column names, SQL, stack traces) on a rejection", async () => {
    const limiter = createServiceRateLimit({ name: "t", windowLimit: 0, windowMs: 60_000, maxConcurrent: 10, getPool: () => db as any });
    const req = fakeReq();
    const { res, getBody } = fakeRes();
    await run(limiter, req, res);
    const serialized = JSON.stringify(getBody());
    for (const forbidden of ["service_rate_limit_windows", "service_concurrency_slots", "SELECT", "INSERT", "pg.Pool", "getPool"]) {
      assert.ok(!serialized.includes(forbidden), `response body must not leak internal detail: "${forbidden}"`);
    }
  });

  // ---------------------------------------------------------------------
  // TASK 13C regression tests -- the two blocking findings from the
  // independent review (Task 13B).
  // ---------------------------------------------------------------------

  describe("TASK 13C — concurrency-slot release idempotency (Finding 2)", () => {
    test("normal response completion: only 'finish' fires, the slot is released exactly once", async () => {
      const limiter = createServiceRateLimit({ name: "t", windowLimit: 5, windowMs: 60_000, maxConcurrent: 1, getPool: () => db as any });
      const req = fakeReq();
      const { res } = fakeRes();
      await run(limiter, req, res);
      res.__simulateFinish();

      const row = await db.query<{ active_count: number }>(`SELECT active_count FROM service_concurrency_slots WHERE limiter_name = 't' AND identity_key = 'vyaparsethu'`);
      assert.equal(row.rows[0].active_count, 0, "the slot must be released after finish");
    });

    test("client disconnect before response completion: only 'close' fires (never 'finish'), and the slot is still released", async () => {
      // This is the exact scenario Finding 2 identified: a real client
      // disconnect fires "close" without ever firing "finish". Simulated
      // directly here (the real-socket version of this exact behavior is
      // reproduced below, against a genuine Node http server, not a fake).
      const limiter = createServiceRateLimit({ name: "t", windowLimit: 5, windowMs: 60_000, maxConcurrent: 1, getPool: () => db as any });
      const req = fakeReq();
      const { res } = fakeRes();
      await run(limiter, req, res);
      res.__simulateClose(); // "finish" never fires in this scenario -- not called at all

      const row = await db.query<{ active_count: number }>(`SELECT active_count FROM service_concurrency_slots WHERE limiter_name = 't' AND identity_key = 'vyaparsethu'`);
      assert.equal(row.rows[0].active_count, 0, "the slot must still be released via 'close' when 'finish' never fires");
    });

    test("both 'finish' and 'close' fire (the ordinary case -- a completed response's socket also eventually closes): the slot is decremented exactly once, never twice", async () => {
      const limiter = createServiceRateLimit({ name: "t", windowLimit: 5, windowMs: 60_000, maxConcurrent: 1, getPool: () => db as any });
      const req = fakeReq();
      const { res } = fakeRes();
      await run(limiter, req, res);

      // Seed the slot to a count higher than 1 so a double-decrement would
      // be observable (with maxConcurrent=1 and only one request, a single
      // correct release goes 1 -> 0; a double-release would go to -1,
      // which GREATEST clamps to 0 -- making 0 ambiguous between "released
      // once, correctly" and "released twice, clamped". Bump the real row
      // first so the two cases are distinguishable: correct = 1, buggy = 0.)
      await db.query(`UPDATE service_concurrency_slots SET active_count = 2 WHERE limiter_name = 't' AND identity_key = 'vyaparsethu'`);

      res.__simulateFinish();
      res.__simulateClose(); // fires after finish, as it does on a real socket -- must be a no-op here

      const row = await db.query<{ active_count: number }>(`SELECT active_count FROM service_concurrency_slots WHERE limiter_name = 't' AND identity_key = 'vyaparsethu'`);
      assert.equal(row.rows[0].active_count, 1, "exactly one decrement must have happened (2 -> 1), not two (which would reach 0)");
    });

    test("firing the same event twice is also a no-op (defends the idempotency guard itself, not just the finish/close pairing)", async () => {
      const limiter = createServiceRateLimit({ name: "t", windowLimit: 5, windowMs: 60_000, maxConcurrent: 1, getPool: () => db as any });
      const req = fakeReq();
      const { res } = fakeRes();
      await run(limiter, req, res);
      await db.query(`UPDATE service_concurrency_slots SET active_count = 2 WHERE limiter_name = 't' AND identity_key = 'vyaparsethu'`);

      res.__simulateFinish();
      res.__simulateFinish(); // same event, fired again -- must not double-decrement

      const row = await db.query<{ active_count: number }>(`SELECT active_count FROM service_concurrency_slots WHERE limiter_name = 't' AND identity_key = 'vyaparsethu'`);
      assert.equal(row.rows[0].active_count, 1);
    });

    test("a downstream handler that throws still results in the slot being released -- whichever event Express ends up firing on the error path", async () => {
      // This middleware's own release logic doesn't know or care WHY the
      // response ended (success, an error handler's response, or an
      // abandoned connection) -- it reacts to finish/close, not to the
      // handler's outcome. This test simulates the error path by having
      // `next` immediately throw, then the response still eventually
      // completing (as Express's own error-handling middleware would
      // ensure) -- confirming the release still fires.
      const limiter = createServiceRateLimit({ name: "t", windowLimit: 5, windowMs: 60_000, maxConcurrent: 1, getPool: () => db as any });
      const req = fakeReq();
      const { res } = fakeRes();
      let caught: unknown;
      try {
        await limiter(req, res, (() => { throw new Error("downstream handler failure"); }) as NextFunction);
      } catch (err) {
        caught = err;
      }
      assert.ok(caught instanceof Error, "the middleware itself does not swallow a downstream throw -- Express's own error handling is responsible for it");
      // Express's real behavior: an uncaught synchronous throw from a route
      // handler still results in the response eventually being finished by
      // the framework's own default error handler, which is what actually
      // triggers this middleware's registered "finish" listener.
      res.__simulateFinish();

      const row = await db.query<{ active_count: number }>(`SELECT active_count FROM service_concurrency_slots WHERE limiter_name = 't' AND identity_key = 'vyaparsethu'`);
      assert.equal(row.rows[0].active_count, 0, "the slot must still be released even though the downstream handler threw");
    });

    test("a database error during the release itself is audited and does not throw back to the caller", async () => {
      const brokenAfterAcceptPool = {
        query: async (sql: string, params: unknown[]) => {
          if (sql.includes("UPDATE service_concurrency_slots")) {
            throw new Error("connection lost during release");
          }
          return db.query(sql, params);
        },
      } as any;
      const limiter = createServiceRateLimit({ name: "t", windowLimit: 5, windowMs: 60_000, maxConcurrent: 5, getPool: () => brokenAfterAcceptPool });
      const req = fakeReq();
      const { res } = fakeRes();
      await run(limiter, req, res);

      const originalLog = console.log;
      const auditLines: string[] = [];
      console.log = (line: unknown) => { auditLines.push(String(line)); };
      try {
        res.__simulateFinish(); // the release query inside this throws -- must not propagate
        // releaseSlot() is fire-and-forget by design (matching the other
        // cleanup queries in this file) -- its .catch() handler runs on a
        // later microtask, not synchronously within __simulateFinish()
        // itself. Give it a tick before asserting on the audit output.
        await new Promise((resolve) => setImmediate(resolve));
      } finally {
        console.log = originalLog;
      }
      const releaseFailureEvent = auditLines.map((l) => JSON.parse(l)).find((e) => e.metadata?.check === "concurrency_release");
      assert.ok(releaseFailureEvent, "a release failure must still be audited");
      assert.equal(releaseFailureEvent.outcome, "denied");
    });

    test("release only ever targets the requesting identity's own row -- a second identity's count is untouched", async () => {
      const limiter = createServiceRateLimit({ name: "t", windowLimit: 5, windowMs: 60_000, maxConcurrent: 5, getPool: () => db as any });
      const reqA = fakeReq("vyaparsethu");
      const { res: resA } = fakeRes();
      await run(limiter, reqA, resA);

      const reqB = fakeReq("a-second-caller");
      const { res: resB } = fakeRes();
      await run(limiter, reqB, resB);

      resA.__simulateFinish();

      const rowA = await db.query<{ active_count: number }>(`SELECT active_count FROM service_concurrency_slots WHERE limiter_name = 't' AND identity_key = 'vyaparsethu'`);
      const rowB = await db.query<{ active_count: number }>(`SELECT active_count FROM service_concurrency_slots WHERE limiter_name = 't' AND identity_key = 'a-second-caller'`);
      assert.equal(rowA.rows[0].active_count, 0, "caller A's own slot was released");
      assert.equal(rowB.rows[0].active_count, 1, "caller B's slot must be completely unaffected by caller A's release");
    });

    test("REAL Node.js reproduction: an actual client socket disconnect before the server responds fires only 'close', never 'finish', against a genuine http.ServerResponse wired to the real middleware", async () => {
      // Not a fake -- this starts a real Node http server, runs the actual
      // createServiceRateLimit()-produced middleware against the real
      // `req`/`res` Node hands it, and has a real client abort its
      // connection before the (intentionally never-sent) response
      // completes. This is the same technique used to establish the
      // underlying Node semantics during the Task 13B review, now
      // exercising the real production middleware function itself rather
      // than only confirming the platform behavior in isolation.
      const http = await import("node:http");
      const limiter = createServiceRateLimit({ name: "real-http", windowLimit: 50, windowMs: 60_000, maxConcurrent: 10, getPool: () => db as any });

      const server = http.createServer((req, res) => {
        const serviceReq = req as unknown as ServiceAuthedRequest;
        serviceReq.serviceCaller = { system: "vyaparsethu" };
        serviceReq.requestId = "req_real_http_test";
        // `next` deliberately never responds -- simulates a handler that's
        // still working when the client gives up and disconnects.
        limiter(serviceReq, res as any, (() => {}) as NextFunction);
      });

      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as any).port;

      await new Promise<void>((resolve, reject) => {
        const clientReq = http.request({ port, path: "/", method: "POST" }, () => {});
        clientReq.on("error", () => {}); // the forced abort below always produces a client-side socket error; expected, not a test failure
        clientReq.end();
        setTimeout(() => {
          clientReq.destroy(); // real client-initiated disconnect, before the server ever responds
          setTimeout(resolve, 300); // give the server's own "close" handler time to run and complete its DB release
        }, 200);
      });

      await new Promise<void>((resolve) => server.close(() => resolve()));

      const row = await db.query<{ active_count: number }>(`SELECT active_count FROM service_concurrency_slots WHERE limiter_name = 'real-http' AND identity_key = 'vyaparsethu'`);
      assert.equal(row.rows[0].active_count, 0, "a real client disconnect, against the real middleware and a real http.ServerResponse, must still release the slot");
    });
  });

  describe("TASK 13C — database privilege protection (Finding 1)", () => {
    // Same technique as aiProvidersCredentialGrant.live.test.ts: a real
    // Postgres engine, real anon/authenticated roles, the actual migration
    // SQL applied verbatim, then switch role and attempt real queries --
    // not a mock of what a grant "should" do.
    let privDb: PGlite;

    before(async () => {
      privDb = new PGlite();
      await privDb.exec(`
        CREATE ROLE anon;
        CREATE ROLE authenticated;
      `);
      await privDb.exec(migrationSql);
    });

    after(async () => {
      await privDb.close();
    });

    async function asRole<T>(role: "anon" | "authenticated", fn: () => Promise<T>): Promise<T> {
      await privDb.exec(`SET ROLE ${role};`);
      try {
        return await fn();
      } finally {
        await privDb.exec(`RESET ROLE;`);
      }
    }

    test("anon cannot SELECT from either rate-limit table", async () => {
      await assert.rejects(() => asRole("anon", () => privDb.query(`SELECT * FROM service_rate_limit_windows`)));
      await assert.rejects(() => asRole("anon", () => privDb.query(`SELECT * FROM service_concurrency_slots`)));
    });

    test("anon cannot INSERT, UPDATE, or DELETE on either rate-limit table", async () => {
      await assert.rejects(() => asRole("anon", () => privDb.query(`INSERT INTO service_rate_limit_windows (limiter_name, identity_key, window_start) VALUES ('x','y',0)`)));
      await assert.rejects(() => asRole("anon", () => privDb.query(`UPDATE service_rate_limit_windows SET request_count = 999`)));
      await assert.rejects(() => asRole("anon", () => privDb.query(`DELETE FROM service_rate_limit_windows`)));
      await assert.rejects(() => asRole("anon", () => privDb.query(`INSERT INTO service_concurrency_slots (limiter_name, identity_key) VALUES ('x','y')`)));
      await assert.rejects(() => asRole("anon", () => privDb.query(`UPDATE service_concurrency_slots SET active_count = 999`)));
      await assert.rejects(() => asRole("anon", () => privDb.query(`DELETE FROM service_concurrency_slots`)));
    });

    test("authenticated cannot SELECT, INSERT, UPDATE, or DELETE on either rate-limit table -- an ordinary signed-in end user cannot read or manipulate the rate limiter's own state", async () => {
      await assert.rejects(() => asRole("authenticated", () => privDb.query(`SELECT * FROM service_rate_limit_windows`)));
      await assert.rejects(() => asRole("authenticated", () => privDb.query(`UPDATE service_rate_limit_windows SET request_count = 0`)));
      await assert.rejects(() => asRole("authenticated", () => privDb.query(`DELETE FROM service_rate_limit_windows WHERE identity_key = 'vyaparsethu'`)));
      await assert.rejects(() => asRole("authenticated", () => privDb.query(`SELECT * FROM service_concurrency_slots`)));
      await assert.rejects(() => asRole("authenticated", () => privDb.query(`UPDATE service_concurrency_slots SET active_count = 999999`)));
      await assert.rejects(() => asRole("authenticated", () => privDb.query(`DELETE FROM service_concurrency_slots`)));
    });

    test("the trusted server-side connection (no role switch -- the same access path getPool() uses) retains full access to both tables", async () => {
      // No SET ROLE here -- this is the connection's own default role,
      // equivalent to the real application's getPool() connection, which
      // never authenticates as anon or authenticated in the first place.
      const insertResult = await privDb.query<{ request_count: number }>(
        `INSERT INTO service_rate_limit_windows (limiter_name, identity_key, window_start, request_count) VALUES ('t','server-check',0,1) RETURNING request_count`,
      );
      assert.equal(insertResult.rows[0].request_count, 1);
      const selectResult = await privDb.query(`SELECT * FROM service_rate_limit_windows WHERE identity_key = 'server-check'`);
      assert.equal(selectResult.rows.length, 1);
      await privDb.query(`DELETE FROM service_rate_limit_windows WHERE identity_key = 'server-check'`);
    });

    test("PR #6's existing ai_providers permission controls are not affected by this migration (different tables, no overlapping grant/revoke target)", async () => {
      // This migration's own explanatory comments legitimately MENTION
      // ai_providers (citing PR #6's precedent) -- what must be true is
      // that no actual SQL *statement* (as opposed to a comment) ever
      // names it. Strip comments first, same technique
      // aiProvidersCredentialGrant.test.ts itself uses for exactly this
      // class of check.
      const withoutComments = migrationSql.replace(/--[^\r\n]*/g, "");
      assert.ok(!withoutComments.includes("ai_providers"), "no actual SQL statement in this migration must reference the unrelated ai_providers table");
    });
  });
});
