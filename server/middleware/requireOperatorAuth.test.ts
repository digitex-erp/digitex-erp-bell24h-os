/**
 * Unit tests for createRequireOperatorAuth -- the fix for the AI Router
 * operator-auth gap (any authenticated user of any organization could
 * previously reach every /api/v1/ai-router/* operator endpoint).
 *
 * No real database or real Supabase call: `getPool` is a fake pg.Pool-shaped
 * object whose `query()` returns canned role rows (the same contract
 * getUserRoleNames() expects), and `authenticate` is a stub standing in for
 * requireAuth -- the same convention server/voice/routes.ts's own tests and
 * server/communication's own integration tests already use.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { createRequireOperatorAuth } from "./requireOperatorAuth.js";
import type { AuthedRequest } from "./requireAuth.js";

function fakeRes() {
  let statusCode: number | null = null;
  let body: unknown = null;
  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(payload: unknown) {
      body = payload;
      return res;
    },
    setHeader() {
      return res;
    },
  } as unknown as Response;
  // Plain accessor functions, not destructured getters -- destructuring
  // `{ status }` off an object with a `get status()` property snapshots the
  // value at destructure time, not a live reference to later mutations.
  return { res, getStatus: () => statusCode, getBody: () => body };
}

function fakeReq(headers: Record<string, string> = {}): Request {
  return { headers, path: "/api/v1/ai-router/telemetry", method: "GET" } as unknown as Request;
}

/** Mirrors requireAuth's real contract: on failure, sends a response and never calls next; on success, sets req.auth and calls next(). */
function stubAuthenticate(outcome: { userId: string; organizationId: string } | "unauthenticated"): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (outcome === "unauthenticated") {
      (res.status(401) as any).json({ error: "unauthenticated" });
      return;
    }
    (req as AuthedRequest).auth = { ...outcome, token: "test" };
    // `return` (not a bare call) so the async requireAnyRole chain triggered
    // by this `next` propagates all the way back up to the test's own
    // `await guard(...)` -- otherwise the test's assertions run before the
    // inner role-check's `await pool.query(...)` has actually resolved.
    return next();
  };
}

/** Fake pg.Pool-shaped object: query() returns the role rows getUserRoleNames() expects. */
function fakePool(rolesByUserOrg: Record<string, string[]>) {
  return {
    query: async (_sql: string, params: unknown[]) => {
      const [userId, organizationId] = params as [string, string];
      const key = `${userId}:${organizationId}`;
      const roles = rolesByUserOrg[key] ?? [];
      return { rows: roles.map((name) => ({ name })) };
    },
  } as any;
}

describe("createRequireOperatorAuth", () => {
  test("unauthenticated caller is rejected (production mode, no header)", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.BELL24H_VYAPARSETHU_SERVICE_TOKEN;
    const guard = createRequireOperatorAuth({ getPool: () => fakePool({}), authenticate: stubAuthenticate("unauthenticated") });
    const req = fakeReq();
    const { res, getStatus } = fakeRes();
    let nextCalled = false;
    await guard(req, res, (() => { nextCalled = true; }) as NextFunction);
    assert.equal(nextCalled, false, "next() must not be called for an unauthenticated caller");
    assert.equal(getStatus(), 401);
  });

  test("ordinary authenticated user (no ADMIN role) is rejected -- the actual vulnerability this fix closes", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.BELL24H_VYAPARSETHU_SERVICE_TOKEN;
    const userId = "user-1";
    const organizationId = "org-a";
    const guard = createRequireOperatorAuth({
      getPool: () => fakePool({ [`${userId}:${organizationId}`]: ["VIEWER"] }),
      authenticate: stubAuthenticate({ userId, organizationId }),
    });
    const req = fakeReq({ authorization: "Bearer real-session-token" });
    const { res, getStatus } = fakeRes();
    let nextCalled = false;
    await guard(req, res, (() => { nextCalled = true; }) as NextFunction);
    assert.equal(nextCalled, false, "an authenticated non-ADMIN user must not reach the operator endpoint");
    assert.equal(getStatus(), 403);
  });

  test("a user from another tenant with no role in THIS organization is rejected", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.BELL24H_VYAPARSETHU_SERVICE_TOKEN;
    const userId = "user-2";
    const guard = createRequireOperatorAuth({
      // The user is ADMIN in org-b, but the request claims org-a -- the role
      // lookup is scoped to (userId, organizationId) together, so no row matches.
      getPool: () => fakePool({ "user-2:org-b": ["ADMIN"] }),
      authenticate: stubAuthenticate({ userId, organizationId: "org-a" }),
    });
    const req = fakeReq({ authorization: "Bearer real-session-token" });
    const { res, getStatus } = fakeRes();
    let nextCalled = false;
    await guard(req, res, (() => { nextCalled = true; }) as NextFunction);
    assert.equal(nextCalled, false);
    assert.equal(getStatus(), 403);
  });

  test("missing or invalid role (empty role set) fails closed", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.BELL24H_VYAPARSETHU_SERVICE_TOKEN;
    const guard = createRequireOperatorAuth({
      getPool: () => fakePool({}), // no role rows at all
      authenticate: stubAuthenticate({ userId: "user-3", organizationId: "org-a" }),
    });
    const req = fakeReq({ authorization: "Bearer real-session-token" });
    const { res, getStatus } = fakeRes();
    let nextCalled = false;
    await guard(req, res, (() => { nextCalled = true; }) as NextFunction);
    assert.equal(nextCalled, false);
    assert.equal(getStatus(), 403);
  });

  test("a role-lookup failure (e.g. DB error) fails closed, not open", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.BELL24H_VYAPARSETHU_SERVICE_TOKEN;
    const brokenPool = { query: async () => { throw new Error("connection reset"); } } as any;
    const guard = createRequireOperatorAuth({
      getPool: () => brokenPool,
      authenticate: stubAuthenticate({ userId: "user-4", organizationId: "org-a" }),
    });
    const req = fakeReq({ authorization: "Bearer real-session-token" });
    const { res, getStatus } = fakeRes();
    let nextCalled = false;
    await guard(req, res, (() => { nextCalled = true; }) as NextFunction);
    assert.equal(nextCalled, false, "a role-lookup error must deny, never silently grant access");
    assert.equal(getStatus(), 503);
  });

  test("an authorized ADMIN operator is granted access", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.BELL24H_VYAPARSETHU_SERVICE_TOKEN;
    const userId = "admin-1";
    const organizationId = "org-a";
    const guard = createRequireOperatorAuth({
      getPool: () => fakePool({ [`${userId}:${organizationId}`]: ["ADMIN"] }),
      authenticate: stubAuthenticate({ userId, organizationId }),
    });
    const req = fakeReq({ authorization: "Bearer real-session-token" });
    const { res } = fakeRes();
    let nextCalled = false;
    await guard(req, res, (() => { nextCalled = true; }) as NextFunction);
    assert.equal(nextCalled, true, "an ADMIN must be allowed through");
  });

  test("the development-mode no-auth-header bypass is NEVER reachable when NODE_ENV=production", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.BELL24H_VYAPARSETHU_SERVICE_TOKEN;
    // No Authorization header at all -- in dev mode this would bypass
    // straight through; in production it must still require real auth.
    const guard = createRequireOperatorAuth({
      getPool: () => fakePool({}),
      authenticate: stubAuthenticate("unauthenticated"),
    });
    const req = fakeReq(); // no headers
    const { res, getStatus } = fakeRes();
    let nextCalled = false;
    await guard(req, res, (() => { nextCalled = true; }) as NextFunction);
    assert.equal(nextCalled, false, "production mode must never grant the dev-mode bypass");
    assert.equal(getStatus(), 401);
  });

  test("the development-mode bypass DOES work outside production, as intended (existing behavior preserved)", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.BELL24H_VYAPARSETHU_SERVICE_TOKEN;
    const guard = createRequireOperatorAuth({
      getPool: () => fakePool({}),
      // authenticate must never even be consulted on this path.
      authenticate: () => { throw new Error("authenticate should not be called on the dev-mode bypass path"); },
    });
    const req = fakeReq(); // no headers
    const { res } = fakeRes();
    let nextCalled = false;
    await guard(req, res, (() => { nextCalled = true; }) as NextFunction);
    assert.equal(nextCalled, true);
    process.env.NODE_ENV = "production"; // restore for subsequent tests
  });

  test("the service-token path grants access without a per-user role check, and legitimate operator access via it is unaffected", async () => {
    process.env.NODE_ENV = "production";
    process.env.BELL24H_VYAPARSETHU_SERVICE_TOKEN = "test-service-token-not-real";
    try {
      const guard = createRequireOperatorAuth({
        getPool: () => fakePool({}),
        authenticate: () => { throw new Error("authenticate should not be called on the service-token path"); },
      });
      const req = fakeReq({ authorization: "Bearer test-service-token-not-real" });
      const { res } = fakeRes();
      let nextCalled = false;
      await guard(req, res, (() => { nextCalled = true; }) as NextFunction);
      assert.equal(nextCalled, true);
    } finally {
      delete process.env.BELL24H_VYAPARSETHU_SERVICE_TOKEN;
    }
  });

  test("a wrong service token in production, with no further auth, is rejected (not silently treated as the dev bypass)", async () => {
    process.env.NODE_ENV = "production";
    process.env.BELL24H_VYAPARSETHU_SERVICE_TOKEN = "correct-token-not-real";
    try {
      const guard = createRequireOperatorAuth({
        getPool: () => fakePool({}),
        authenticate: stubAuthenticate("unauthenticated"),
      });
      const req = fakeReq({ authorization: "Bearer wrong-token" });
      const { res, getStatus } = fakeRes();
      let nextCalled = false;
      await guard(req, res, (() => { nextCalled = true; }) as NextFunction);
      assert.equal(nextCalled, false);
      assert.equal(getStatus(), 401);
    } finally {
      delete process.env.BELL24H_VYAPARSETHU_SERVICE_TOKEN;
    }
  });
});
