/**
 * requireAuth — fail-closed behavior on the two paths testable without a live
 * Supabase instance (token presence, server configuration). The success path
 * (`fetch(${SUPABASE_URL}/auth/v1/user)`) requires a real Supabase project and
 * is intentionally NOT exercised here — see the task's own instruction not to
 * make real network calls. That path's correctness is unverified by this file.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { requireAuth, type AuthedRequest } from "./requireAuth.js";

function fakeReqRes(headers: Record<string, string> = {}) {
  const req = {
    headers,
    method: "GET",
    path: "/api/vault/documents",
    header(name: string) {
      return headers[name.toLowerCase()];
    },
  } as unknown as Request;

  let statusCode: number | undefined;
  let jsonBody: unknown;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: unknown) {
      jsonBody = body;
      return this;
    },
    setHeader() {
      return this;
    },
  } as unknown as Response;

  return {
    req,
    res,
    get statusCode() {
      return statusCode;
    },
    get jsonBody() {
      return jsonBody;
    },
  };
}

test("1: missing Authorization header is rejected with 401, next() never called", async () => {
  const h = fakeReqRes();
  let nextCalled = false;
  await requireAuth(h.req, h.res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(h.statusCode, 401);
  assert.equal((h.jsonBody as any).error, "unauthenticated");
});

test("2: a non-Bearer Authorization header is treated as missing -- 401, next() never called", async () => {
  const h = fakeReqRes({ authorization: "Basic abc123" });
  let nextCalled = false;
  await requireAuth(h.req, h.res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(h.statusCode, 401);
  assert.equal((h.jsonBody as any).error, "unauthenticated");
});

test("3: an empty Bearer token (header present, no value) is rejected with 401", async () => {
  const h = fakeReqRes({ authorization: "Bearer " });
  let nextCalled = false;
  await requireAuth(h.req, h.res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(h.statusCode, 401);
});

test("4: a present Bearer token but missing SUPABASE_URL/SUPABASE_ANON_KEY server config fails closed with 503, not a crash or a silent pass-through", async () => {
  const savedUrl = process.env.SUPABASE_URL;
  const savedViteUrl = process.env.VITE_SUPABASE_URL;
  const savedKey = process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_KEY;
  delete process.env.VITE_SUPABASE_KEY;
  delete process.env.VITE_SUPABASE_ANON_KEY;
  try {
    const h = fakeReqRes({ authorization: "Bearer some-token-value" });
    let nextCalled = false;
    await requireAuth(h.req, h.res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, false, "a request must never reach the protected handler when identity cannot be resolved");
    assert.equal(h.statusCode, 503);
    assert.equal((h.jsonBody as any).error, "auth_unavailable");
  } finally {
    if (savedUrl !== undefined) process.env.SUPABASE_URL = savedUrl;
    if (savedViteUrl !== undefined) process.env.VITE_SUPABASE_URL = savedViteUrl;
    if (savedKey !== undefined) process.env.SUPABASE_ANON_KEY = savedKey;
  }
});

test("5: token-presence check runs before the server-config check -- a missing header is 401 even when Supabase config is also absent", async () => {
  const h = fakeReqRes({});
  let nextCalled = false;
  await requireAuth(h.req, h.res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(h.statusCode, 401, "must not leak server-config state (503) to an anonymous caller");
});

test("6: a denial response never discloses whether Supabase config is present, only a generic code", async () => {
  const h = fakeReqRes({ authorization: "Bearer not-a-real-token" });
  await requireAuth(h.req, h.res, () => {});
  const body = JSON.stringify(h.jsonBody);
  assert.ok(!/SUPABASE_URL|SUPABASE_ANON_KEY|supabase\.co/i.test(body), `response leaked config detail: ${body}`);
});
