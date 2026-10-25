/**
 * Unit tests for requireServiceAuth (server-to-service auth boundary for
 * POST /api/v1/ai/text). Uses Node's built-in test runner with hand-rolled
 * Express req/res/next mocks -- no real HTTP server, no network call, no
 * database access. Matches the mocked-only style already used by
 * server/ai/ProviderRouter.test.ts and server/communication/__tests__/*.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { requireServiceAuth } from "./requireServiceAuth.js";

const TOKEN_ENV_VAR = "BELL24H_VYAPARSETHU_SERVICE_TOKEN";
const REAL_TOKEN = "test-only-secret-value-never-a-real-credential";
const ORIGINAL_TOKEN = process.env[TOKEN_ENV_VAR];

beforeEach(() => {
  process.env[TOKEN_ENV_VAR] = REAL_TOKEN;
});

afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) delete process.env[TOKEN_ENV_VAR];
  else process.env[TOKEN_ENV_VAR] = ORIGINAL_TOKEN;
});

interface MockRes {
  statusCode?: number;
  body?: any;
  headers: Record<string, string>;
  status(code: number): MockRes;
  json(body: any): MockRes;
  setHeader(name: string, value: string): void;
}

function mockReq(headers: Record<string, string> = {}) {
  return {
    headers,
    method: "POST",
    path: "/api/v1/ai/text",
  } as any;
}

function mockRes(): MockRes {
  const res: MockRes = {
    headers: {},
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: any) {
      res.body = body;
      return res;
    },
    setHeader(name: string, value: string) {
      res.headers[name] = value;
    },
  };
  return res;
}

function mockNext() {
  let called = false;
  const next = () => { called = true; };
  return { next, wasCalled: () => called };
}

test("1: missing service token header is rejected with 401, next() never called", async () => {
  const req = mockReq({});
  const res = mockRes();
  const { next, wasCalled } = mockNext();

  await requireServiceAuth(req, res as any, next);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error_code, "AUTHENTICATION_FAILED");
  assert.equal(wasCalled(), false);
});

test("2: an invalid service token is rejected with 401, next() never called", async () => {
  const req = mockReq({ "x-bell24h-service-token": "wrong-value-entirely" });
  const res = mockRes();
  const { next, wasCalled } = mockNext();

  await requireServiceAuth(req, res as any, next);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error_code, "AUTHENTICATION_FAILED");
  assert.equal(wasCalled(), false);
});

test("3: the correct service token is accepted, next() is called, serviceCaller is attached", async () => {
  const req = mockReq({ "x-bell24h-service-token": REAL_TOKEN });
  const res = mockRes();
  const { next, wasCalled } = mockNext();

  await requireServiceAuth(req, res as any, next);

  assert.equal(wasCalled(), true);
  assert.equal(res.statusCode, undefined, "no error response should have been sent on success");
  assert.deepEqual(req.serviceCaller, { system: "vyaparsethu" });
});

test("4: a rejected request never reaches the protected handler (next() not called) for every denial path", async () => {
  // Missing header
  {
    const req = mockReq({});
    const res = mockRes();
    const { next, wasCalled } = mockNext();
    await requireServiceAuth(req, res as any, next);
    assert.equal(wasCalled(), false);
  }
  // Wrong token
  {
    const req = mockReq({ "x-bell24h-service-token": "nope" });
    const res = mockRes();
    const { next, wasCalled } = mockNext();
    await requireServiceAuth(req, res as any, next);
    assert.equal(wasCalled(), false);
  }
  // Missing server config
  {
    delete process.env[TOKEN_ENV_VAR];
    const req = mockReq({ "x-bell24h-service-token": "anything" });
    const res = mockRes();
    const { next, wasCalled } = mockNext();
    await requireServiceAuth(req, res as any, next);
    assert.equal(wasCalled(), false);
  }
});

test("5: a denial response never discloses the expected token value or any hint of its shape", async () => {
  const req = mockReq({ "x-bell24h-service-token": "wrong-value-entirely" });
  const res = mockRes();
  const { next } = mockNext();

  await requireServiceAuth(req, res as any, next);

  const serialized = JSON.stringify(res.body);
  assert.ok(!serialized.includes(REAL_TOKEN), "the real configured token must never appear in the response body");
  assert.equal(res.body.message, "Service credential rejected.", "the message must be generic, not revealing why or how it differs");
});

test("6: missing server-side configuration fails closed with 503 PROVIDER_UNAVAILABLE, not a 401 or a crash", async () => {
  delete process.env[TOKEN_ENV_VAR];
  const req = mockReq({ "x-bell24h-service-token": "anything-at-all" });
  const res = mockRes();
  const { next, wasCalled } = mockNext();

  await requireServiceAuth(req, res as any, next);

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error_code, "PROVIDER_UNAVAILABLE");
  assert.equal(wasCalled(), false);
  assert.ok(!JSON.stringify(res.body).includes("anything-at-all"), "the provided (irrelevant) credential must not be echoed either");
});

test("token-presence check runs before the server-config check: a missing header is 401 even when the server has no token configured", async () => {
  delete process.env[TOKEN_ENV_VAR];
  const req = mockReq({});
  const res = mockRes();
  const { next } = mockNext();

  await requireServiceAuth(req, res as any, next);

  // Mirrors the documented ordering rationale in requireServiceAuth.ts itself:
  // a caller with no credential always gets the same 401, regardless of
  // server config state.
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error_code, "AUTHENTICATION_FAILED");
});
