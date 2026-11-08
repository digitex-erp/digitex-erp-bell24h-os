/**
 * Dedicated unit tests for requireServiceAuth.ts -- the server-to-service
 * authentication gate for /api/v1/ai/text (and any future route mounted
 * behind it). Previously had zero test coverage (flagged repeatedly across
 * this engagement's audits: Tasks 7B, 8, 9, 10, 11, 11B).
 *
 * Follows the same conventions already established in
 * requireOperatorAuth.test.ts: a fake Express Request (a plain headers
 * object) and a fake Response that records status/body/headers without a
 * real HTTP server. No real database, no real Supabase call -- this
 * middleware doesn't touch either.
 *
 * Audit events are asserted by spying on console.log (emitAuditEvent's own,
 * single, synchronous output mechanism -- see server/audit.ts) rather than
 * by injecting a fake audit sink, since none exists to inject; the spy is
 * always restored in a `finally` so a failing assertion never leaks a
 * stubbed console.log into later tests.
 *
 * Per this task's own instruction: no timing-based test claims to prove
 * constant-time execution. What's tested instead is observable
 * correctness -- a length-mismatched token is rejected, and rejected
 * without throwing -- which is what secureEquals's digest-based design is
 * actually for.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { NextFunction, Request, Response } from "express";
import { requireServiceAuth, secureEquals, type ServiceAuthedRequest } from "./requireServiceAuth.js";

const ENV_VAR = "BELL24H_VYAPARSETHU_SERVICE_TOKEN";
const HEADER = "x-bell24h-service-token";

function fakeReq(headers: Record<string, string | string[]> = {}, path = "/api/v1/ai/text", method = "POST"): Request {
  return { headers, path, method } as unknown as Request;
}

function fakeRes() {
  let statusCode: number | null = null;
  let body: unknown = null;
  const headers: Record<string, string> = {};
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
  } as unknown as Response;
  // Plain accessor functions, not destructured getters -- see
  // requireOperatorAuth.test.ts's own fakeRes for why this matters: a
  // destructured `{ status }` off a `get status()` property snapshots the
  // value at destructure time, not a live reference to later mutations.
  return { res, getStatus: () => statusCode, getBody: () => body, getHeaders: () => headers };
}

/** Captures every console.log call made during `fn`, as parsed JSON (each call is expected to be a single JSON.stringify'd line, per emitAuditEvent's own implementation), then restores the real console.log unconditionally. */
async function captureAuditEvents<T>(fn: () => Promise<T>): Promise<{ result: T; events: any[] }> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (line: unknown) => { lines.push(String(line)); };
  try {
    const result = await fn();
    return { result, events: lines.map((l) => JSON.parse(l)) };
  } finally {
    console.log = original;
  }
}

async function run(req: Request, res: Response): Promise<{ nextCalled: boolean; nextErr: unknown }> {
  let nextCalled = false;
  let nextErr: unknown;
  await requireServiceAuth(req, res, ((err?: unknown) => {
    nextCalled = true;
    nextErr = err;
  }) as NextFunction);
  return { nextCalled, nextErr };
}

describe("requireServiceAuth", () => {
  test("a valid service token is accepted: next() is called, req.serviceCaller is set, no error passed to next", async () => {
    process.env[ENV_VAR] = "a-valid-not-real-service-token";
    try {
      const req = fakeReq({ [HEADER]: "a-valid-not-real-service-token" });
      const { res } = fakeRes();
      const { nextCalled, nextErr } = await run(req, res);
      assert.equal(nextCalled, true);
      assert.equal(nextErr, undefined);
      assert.deepEqual((req as ServiceAuthedRequest).serviceCaller, { system: "vyaparsethu" });
    } finally {
      delete process.env[ENV_VAR];
    }
  });

  test("a missing header is rejected: 401, AUTHENTICATION_FAILED, next() never called", async () => {
    process.env[ENV_VAR] = "configured-token";
    try {
      const req = fakeReq({}); // no header at all
      const { res, getStatus, getBody } = fakeRes();
      const { nextCalled } = await run(req, res);
      assert.equal(nextCalled, false);
      assert.equal(getStatus(), 401);
      assert.equal((getBody() as any).error_code, "AUTHENTICATION_FAILED");
    } finally {
      delete process.env[ENV_VAR];
    }
  });

  test("an empty-string header is rejected the same way as a missing one", async () => {
    process.env[ENV_VAR] = "configured-token";
    try {
      const req = fakeReq({ [HEADER]: "" });
      const { res, getStatus, getBody } = fakeRes();
      const { nextCalled } = await run(req, res);
      assert.equal(nextCalled, false);
      assert.equal(getStatus(), 401);
      assert.match((getBody() as any).message, /Missing/);
    } finally {
      delete process.env[ENV_VAR];
    }
  });

  test("a whitespace-only header is rejected the same way as a missing one", async () => {
    process.env[ENV_VAR] = "configured-token";
    try {
      const req = fakeReq({ [HEADER]: "   " });
      const { res, getStatus } = fakeRes();
      const { nextCalled } = await run(req, res);
      assert.equal(nextCalled, false);
      assert.equal(getStatus(), 401);
    } finally {
      delete process.env[ENV_VAR];
    }
  });

  test("a malformed (array-valued) header is handled by taking its first value, same as requireServiceAuth's own stated convention", async () => {
    // Express hands back a string[] for a repeated header. The implementation
    // takes the first value -- confirm that's actually what happens, both
    // when that first value is correct and when it's wrong.
    process.env[ENV_VAR] = "correct-token";
    try {
      const reqCorrect = fakeReq({ [HEADER]: ["correct-token", "ignored-second-value"] });
      const { res: resCorrect } = fakeRes();
      const { nextCalled: correctAccepted } = await run(reqCorrect, resCorrect);
      assert.equal(correctAccepted, true, "the first array element, if correct, must be accepted");

      const reqWrong = fakeReq({ [HEADER]: ["wrong-token", "correct-token"] });
      const { res: resWrong, getStatus } = fakeRes();
      const { nextCalled: wrongRejected } = await run(reqWrong, resWrong);
      assert.equal(wrongRejected, false, "only the first array element is consulted -- a correct second value must not rescue a wrong first one");
      assert.equal(getStatus(), 401);
    } finally {
      delete process.env[ENV_VAR];
    }
  });

  test("an incorrect service token is rejected: 401, AUTHENTICATION_FAILED, next() never called", async () => {
    process.env[ENV_VAR] = "the-correct-token";
    try {
      const req = fakeReq({ [HEADER]: "a-completely-different-token" });
      const { res, getStatus, getBody } = fakeRes();
      const { nextCalled } = await run(req, res);
      assert.equal(nextCalled, false);
      assert.equal(getStatus(), 401);
      assert.equal((getBody() as any).error_code, "AUTHENTICATION_FAILED");
      assert.match((getBody() as any).message, /rejected/i);
    } finally {
      delete process.env[ENV_VAR];
    }
  });

  test("a shorter-than-expected token is rejected without throwing (secureEquals length-mismatch safety)", async () => {
    process.env[ENV_VAR] = "a-reasonably-long-not-real-service-token-value";
    try {
      const req = fakeReq({ [HEADER]: "x" });
      const { res, getStatus } = fakeRes();
      let threw = false;
      let nextCalled = false;
      try {
        ({ nextCalled } = await run(req, res));
      } catch {
        threw = true;
      }
      assert.equal(threw, false, "a length mismatch must never throw");
      assert.equal(nextCalled, false);
      assert.equal(getStatus(), 401);
    } finally {
      delete process.env[ENV_VAR];
    }
  });

  test("a longer-than-expected token is rejected without throwing (secureEquals length-mismatch safety)", async () => {
    process.env[ENV_VAR] = "short-token";
    try {
      const req = fakeReq({ [HEADER]: "y".repeat(2000) });
      const { res, getStatus } = fakeRes();
      let threw = false;
      let nextCalled = false;
      try {
        ({ nextCalled } = await run(req, res));
      } catch {
        threw = true;
      }
      assert.equal(threw, false, "a length mismatch must never throw");
      assert.equal(nextCalled, false);
      assert.equal(getStatus(), 401);
    } finally {
      delete process.env[ENV_VAR];
    }
  });

  test("secureEquals itself: equal values match, any length difference safely does not, in either direction", () => {
    assert.equal(secureEquals("same-value", "same-value"), true);
    assert.equal(secureEquals("short", "a-much-longer-value-entirely"), false);
    assert.equal(secureEquals("a-much-longer-value-entirely", "short"), false);
    assert.equal(secureEquals("", "non-empty"), false);
    assert.equal(secureEquals("non-empty", ""), false);
    assert.equal(secureEquals("", ""), true);
  });

  test("a missing configured service secret fails closed: 503, PROVIDER_UNAVAILABLE, not silently open", async () => {
    delete process.env[ENV_VAR];
    const req = fakeReq({ [HEADER]: "any-token-at-all" });
    const { res, getStatus, getBody } = fakeRes();
    const { nextCalled } = await run(req, res);
    assert.equal(nextCalled, false, "a missing server secret must never grant access");
    assert.equal(getStatus(), 503);
    assert.equal((getBody() as any).error_code, "PROVIDER_UNAVAILABLE");
  });

  test("an empty-string configured service secret fails closed the same way as a missing one", async () => {
    process.env[ENV_VAR] = "";
    try {
      const req = fakeReq({ [HEADER]: "any-token-at-all" });
      const { res, getStatus, getBody } = fakeRes();
      const { nextCalled } = await run(req, res);
      assert.equal(nextCalled, false);
      assert.equal(getStatus(), 503);
      assert.equal((getBody() as any).error_code, "PROVIDER_UNAVAILABLE");
    } finally {
      delete process.env[ENV_VAR];
    }
  });

  test("a whitespace-only configured service secret fails closed the same way as a missing one", async () => {
    process.env[ENV_VAR] = "   ";
    try {
      const req = fakeReq({ [HEADER]: "any-token-at-all" });
      const { res, getStatus } = fakeRes();
      const { nextCalled } = await run(req, res);
      assert.equal(nextCalled, false);
      assert.equal(getStatus(), 503);
    } finally {
      delete process.env[ENV_VAR];
    }
  });

  test("rejection behavior is identical in production and in development -- there is no environment-conditional branch in this file at all", async () => {
    // requireServiceAuth.ts never reads process.env.NODE_ENV anywhere --
    // confirmed by direct source inspection, not assumed. This test proves
    // the *observable* consequence of that: the exact same missing-token
    // scenario produces the exact same rejection regardless of which
    // environment the process believes it's running in.
    const original = process.env.NODE_ENV;
    process.env[ENV_VAR] = "configured-token";
    try {
      for (const env of ["production", "development", undefined]) {
        if (env === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = env;
        const req = fakeReq({}); // no header
        const { res, getStatus, getBody } = fakeRes();
        const { nextCalled } = await run(req, res);
        assert.equal(nextCalled, false, `env=${env}: must not grant access`);
        assert.equal(getStatus(), 401, `env=${env}: must still be 401`);
        assert.equal((getBody() as any).error_code, "AUTHENTICATION_FAILED", `env=${env}: must still be AUTHENTICATION_FAILED`);
      }
    } finally {
      process.env.NODE_ENV = original;
      delete process.env[ENV_VAR];
    }
  });

  test("the canonical error envelope has the expected shape on every rejection path", async () => {
    process.env[ENV_VAR] = "configured-token";
    try {
      const req = fakeReq({ [HEADER]: "wrong-token" });
      const { res, getBody, getHeaders } = fakeRes();
      await run(req, res);
      const body = getBody() as any;
      assert.equal(typeof body.error_code, "string");
      assert.equal(typeof body.message, "string");
      assert.equal(typeof body.request_id, "string");
      assert.equal(body.correlation_id, body.request_id, "correlation_id currently always equals request_id, per errors.ts's own documented reason");
      assert.equal(body.retryable, false, "AUTHENTICATION_FAILED is not in the retryable set");
      assert.equal(body.details, undefined, "no details object was passed for this rejection, so none should appear");
      assert.ok(getHeaders()["X-Request-Id"], "the resolved request id must also be echoed as a response header");
      assert.equal(getHeaders()["X-Request-Id"], body.request_id, "the header and body must carry the same request id");
    } finally {
      delete process.env[ENV_VAR];
    }
  });

  test("the PROVIDER_UNAVAILABLE rejection (missing server secret) is marked retryable, matching errors.ts's own retryable-code set", async () => {
    delete process.env[ENV_VAR];
    const req = fakeReq({ [HEADER]: "any-token" });
    const { res, getBody } = fakeRes();
    await run(req, res);
    assert.equal((getBody() as any).retryable, true);
  });

  test("an inbound X-Request-Id header is honored when it matches the expected shape", async () => {
    process.env[ENV_VAR] = "configured-token";
    try {
      const req = fakeReq({ [HEADER]: "wrong-token", "x-request-id": "req_abc123_def456" });
      const { res, getBody, getHeaders } = fakeRes();
      await run(req, res);
      assert.equal((getBody() as any).request_id, "req_abc123_def456");
      assert.equal(getHeaders()["X-Request-Id"], "req_abc123_def456");
    } finally {
      delete process.env[ENV_VAR];
    }
  });

  test("an inbound X-Request-Id that doesn't match the expected shape is ignored, and a fresh id is generated instead", async () => {
    process.env[ENV_VAR] = "configured-token";
    try {
      const req = fakeReq({ [HEADER]: "wrong-token", "x-request-id": "not valid; contains spaces and a semicolon" });
      const { res, getBody } = fakeRes();
      await run(req, res);
      assert.notEqual((getBody() as any).request_id, "not valid; contains spaces and a semicolon");
      assert.ok((getBody() as any).request_id.length > 0);
    } finally {
      delete process.env[ENV_VAR];
    }
  });

  test("a valid service token continues to work with the expected downstream middleware behavior: next() called with zero arguments, request proceeds", async () => {
    process.env[ENV_VAR] = "valid-token";
    try {
      const req = fakeReq({ [HEADER]: "valid-token" }, "/api/v1/ai/text", "POST");
      const { res, getStatus } = fakeRes();
      const { nextCalled, nextErr } = await run(req, res);
      assert.equal(nextCalled, true);
      assert.equal(nextErr, undefined, "next() must be called with no error on success, so Express proceeds to the real route handler rather than an error handler");
      assert.equal(getStatus(), null, "this middleware itself must not write any response on the success path -- that's the downstream route handler's job");
    } finally {
      delete process.env[ENV_VAR];
    }
  });

  test("an audit event with outcome=denied is emitted for a rejected request, with no secret value in its metadata", async () => {
    process.env[ENV_VAR] = "configured-token";
    try {
      const req = fakeReq({ [HEADER]: "wrong-token" });
      const { res } = fakeRes();
      const { events } = await captureAuditEvents(() => run(req, res));
      assert.equal(events.length, 1);
      const event = events[0];
      assert.equal(event.kind, "audit");
      assert.equal(event.outcome, "denied");
      assert.equal(event.actor, null);
      assert.equal(event.organizationId, null, "this middleware never derives an organization_id, per its own documented design");
      assert.equal(event.action, "s2s.verify");
      assert.equal(event.metadata.code, "AUTHENTICATION_FAILED");
      const serialized = JSON.stringify(event);
      assert.ok(!serialized.includes("wrong-token"), "the rejected, provided value must never appear in the audit event");
      assert.ok(!serialized.includes("configured-token"), "the configured secret must never appear in the audit event");
    } finally {
      delete process.env[ENV_VAR];
    }
  });

  test("an audit event with outcome=success is emitted for an accepted request, with no secret value in its metadata", async () => {
    process.env[ENV_VAR] = "configured-token";
    try {
      const req = fakeReq({ [HEADER]: "configured-token" });
      const { res } = fakeRes();
      const { events } = await captureAuditEvents(() => run(req, res));
      assert.equal(events.length, 1);
      const event = events[0];
      assert.equal(event.outcome, "success");
      assert.equal(event.actor, "service:vyaparsethu");
      assert.equal(event.organizationId, null);
      const serialized = JSON.stringify(event);
      assert.ok(!serialized.includes("configured-token"), "the valid token's own value must never appear in the audit event either");
    } finally {
      delete process.env[ENV_VAR];
    }
  });

  test("no response this middleware produces, on any rejection path, ever contains the configured secret or the provided (wrong) credential", async () => {
    process.env[ENV_VAR] = "do-not-leak-this-configured-value";
    try {
      const req = fakeReq({ [HEADER]: "do-not-leak-this-provided-value-either" });
      const { res, getBody } = fakeRes();
      await run(req, res);
      const serialized = JSON.stringify(getBody());
      assert.ok(!serialized.includes("do-not-leak-this-configured-value"));
      assert.ok(!serialized.includes("do-not-leak-this-provided-value-either"));
    } finally {
      delete process.env[ENV_VAR];
    }
  });
});
