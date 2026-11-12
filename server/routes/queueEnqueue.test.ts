/**
 * POST /api/v1/queue/enqueue must refuse image, video and publishing jobs
 * unless the matching server flag is exactly "true", and must leave every
 * other job type (e.g. AI text) alone.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createEnqueueHandler } from "./queueEnqueue.js";
import { gatedCapabilityFor, isCapabilityEnabled } from "../lib/capabilityFlags.js";

function harness(env: Record<string, string | undefined>) {
  const enqueued: any[] = [];
  const handler = createEnqueueHandler(
    () => ({ enqueueJob: async (a: any) => { enqueued.push(a); return { id: "job-1", ...a }; } }),
    env,
  );
  async function call(jobType: unknown) {
    const out: { status?: number; body?: any } = {};
    const res = {
      status(s: number) { out.status = s; return this; },
      json(b: any) { out.body = b; return this; },
    } as any;
    const req = { auth: { organizationId: "org-1" }, body: { jobType, payload: { prompt: "p" } }, headers: {} } as any;
    await handler(req, res);
    return out;
  }
  return { enqueued, call };
}

for (const jobType of ["image", "video", "publishing", "social", "Image", " VIDEO "]) {
  test(`flag off: ${JSON.stringify(jobType)} is rejected with NOT_IMPLEMENTED and nothing is enqueued`, async () => {
    const { enqueued, call } = harness({});
    const out = await call(jobType);
    assert.equal(out.status, 501);
    assert.equal(out.body.error_code, "NOT_IMPLEMENTED");
    assert.equal(out.body.retryable, false);
    assert.equal(enqueued.length, 0);
  });
}

test("flag set to anything but exactly 'true' stays off", async () => {
  for (const v of ["", "1", "TRUE", "yes", "false"]) {
    const { enqueued, call } = harness({ ENABLE_IMAGE_STUDIO: v });
    assert.equal((await call("image")).status, 501, `value ${JSON.stringify(v)}`);
    assert.equal(enqueued.length, 0);
  }
});

test("each flag enables only its own job types", async () => {
  const image = harness({ ENABLE_IMAGE_STUDIO: "true" });
  assert.equal((await image.call("image")).status, 201);
  assert.equal((await image.call("video")).status, 501);
  assert.equal((await image.call("publishing")).status, 501);

  const pub = harness({ ENABLE_PUBLISHING: "true" });
  assert.equal((await pub.call("publishing")).status, 201);
  assert.equal((await pub.call("social")).status, 201);
  assert.equal((await pub.call("video")).status, 501);
});

for (const jobType of ["content", "seo", "prompt", "analytics"]) {
  test(`AI/other job type ${jobType} enqueues normally with every flag off`, async () => {
    const { enqueued, call } = harness({});
    const out = await call(jobType);
    assert.equal(out.status, 201);
    assert.equal(enqueued.length, 1);
    assert.equal(enqueued[0].jobType, jobType);
    assert.equal(enqueued[0].organizationId, "org-1");
  });
}

test("non-string jobType is not gated and missing fields still 400", async () => {
  assert.equal(gatedCapabilityFor(undefined), null);
  assert.equal(gatedCapabilityFor(42), null);
  assert.equal(isCapabilityEnabled("image", {}), false);
  const { call } = harness({});
  assert.equal((await call(undefined)).status, 400);
});
