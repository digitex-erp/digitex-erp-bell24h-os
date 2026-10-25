/**
 * resolveRequestId -- the allow-list regex gate that decides whether an inbound
 * X-Request-Id is trusted as-is or discarded in favor of a freshly generated one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { resolveRequestId } from "./requestContext.js";

function fakeReqRes(headerValue?: string | string[]) {
  const headers: Record<string, string | string[]> = {};
  if (headerValue !== undefined) headers["x-request-id"] = headerValue;
  const req = { headers } as unknown as Request;
  let sentHeaderValue: string | undefined;
  const res = {
    setHeader(name: string, value: string) {
      if (name.toLowerCase() === "x-request-id") sentHeaderValue = value;
      return this;
    },
  } as unknown as Response;
  return { req, res, get sentHeaderValue() { return sentHeaderValue; } };
}

test("1: a well-formed inbound X-Request-Id is reused verbatim", () => {
  const h = fakeReqRes("vyaparsethu_abc123-def.456_XYZ");
  const id = resolveRequestId(h.req, h.res);
  assert.equal(id, "vyaparsethu_abc123-def.456_XYZ");
  assert.equal(h.sentHeaderValue, id, "the resolved ID must be echoed back on the response");
});

test("2: no inbound header generates a fresh ID matching newRequestId()'s own shape", () => {
  const h = fakeReqRes(undefined);
  const id = resolveRequestId(h.req, h.res);
  assert.match(id, /^req_[a-z0-9]+_[a-z0-9]+$/i);
});

test("3: an empty string header is treated as absent, not as a malformed value to sanitize", () => {
  const h = fakeReqRes("");
  const id = resolveRequestId(h.req, h.res);
  assert.notEqual(id, "");
  assert.match(id, /^req_/);
});

test("4: a header containing a newline (header-injection shape) is rejected, never echoed", () => {
  const h = fakeReqRes("evil\nX-Injected: true");
  const id = resolveRequestId(h.req, h.res);
  assert.doesNotMatch(id, /\n/);
  assert.match(id, /^req_/, "must fall back to a generated ID, not pass the malformed value through");
});

test("5: an oversized header (over 128 chars) is rejected, not truncated and accepted", () => {
  const h = fakeReqRes("a".repeat(500));
  const id = resolveRequestId(h.req, h.res);
  assert.ok(id.length < 500);
  assert.match(id, /^req_/);
});

test("6: a header containing disallowed characters (e.g. spaces, quotes) is rejected", () => {
  const h = fakeReqRes('not a valid id "with quotes"');
  const id = resolveRequestId(h.req, h.res);
  assert.match(id, /^req_/);
});

test("7: when the header is sent as an array (duplicate headers), only the first value is considered, and still validated", () => {
  const h = fakeReqRes(["valid-id-123", "second-value"]);
  const id = resolveRequestId(h.req, h.res);
  assert.equal(id, "valid-id-123");
});

test("8: the resolved ID is always set on the response, even when a fresh one was generated", () => {
  const h = fakeReqRes("bad id with spaces");
  const id = resolveRequestId(h.req, h.res);
  assert.equal(h.sentHeaderValue, id);
});
