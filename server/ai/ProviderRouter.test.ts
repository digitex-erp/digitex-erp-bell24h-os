/**
 * D4.3-A — Router deadline & cancellation tests.
 *
 * Uses Node's built-in test runner (no new dependency). `fetch` is stubbed
 * per-test so these never make a real network call; provider API keys are
 * set to harmless in-process-only placeholder strings purely so
 * `isProviderConfigured()` includes the provider in the candidate list —
 * no real credential is read, sent, or committed anywhere.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { routeText, computePerAttemptCapMs, resetCircuitBreaker } from "./ProviderRouter.js";
import type { RouterContext } from "./ProviderTypes.js";

const ORIGINAL_ENV = {
  NVIDIA_API_KEY: process.env.NVIDIA_API_KEY,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  QWEN_API_KEY: process.env.QWEN_API_KEY,
  GLM_API_KEY: process.env.GLM_API_KEY,
};

before(() => {
  process.env.NVIDIA_API_KEY = "test-placeholder-not-real";
  process.env.DEEPSEEK_API_KEY = "test-placeholder-not-real";
  process.env.QWEN_API_KEY = "test-placeholder-not-real";
  process.env.GLM_API_KEY = "test-placeholder-not-real";
});

after(() => {
  process.env.NVIDIA_API_KEY = ORIGINAL_ENV.NVIDIA_API_KEY;
  process.env.DEEPSEEK_API_KEY = ORIGINAL_ENV.DEEPSEEK_API_KEY;
  process.env.QWEN_API_KEY = ORIGINAL_ENV.QWEN_API_KEY;
  process.env.GLM_API_KEY = ORIGINAL_ENV.GLM_API_KEY;
});

let orgCounter = 0;
function freshCtx(overrides: Partial<RouterContext> = {}): RouterContext {
  orgCounter += 1;
  return {
    userId: "test-user",
    organizationId: `test-org-${Date.now()}-${orgCounter}`,
    requestId: `test-req-${orgCounter}`,
    action: "test.action",
    ...overrides,
  };
}

function resetAllBreakers() {
  for (const p of ["nvidia", "deepseek", "qwen", "glm", "minimax", "gemini"] as const) {
    try {
      resetCircuitBreaker(p);
    } catch {
      // ignore
    }
  }
}

// ---------------------------------------------------------------------------
// Pure budget-math unit tests
// ---------------------------------------------------------------------------

test("computePerAttemptCapMs: first attempt gets the 0.6 share, bounded by the provider's own timeout", () => {
  // nvidia's own timeoutMs is 30000; 0.6 * 12000 = 7200, well under 30000.
  const cap = computePerAttemptCapMs("nvidia", 0, 5, 12000);
  assert.equal(cap, 7200);
});

test("computePerAttemptCapMs: subsequent attempts get an even split of what remains", () => {
  const cap = computePerAttemptCapMs("deepseek", 1, 4, 4800);
  assert.equal(cap, 1200);
});

test("computePerAttemptCapMs: returns null once remaining budget is at/below the floor", () => {
  const cap = computePerAttemptCapMs("glm", 2, 2, 40);
  assert.equal(cap, null);
});

// ---------------------------------------------------------------------------
// Integration tests against the real routeText() loop, with fetch stubbed
// ---------------------------------------------------------------------------

test("routeText: deadline already exhausted at router entry — clean error, zero provider calls", async () => {
  resetAllBreakers();
  let calls = 0;
  const originalFetch = global.fetch;
  global.fetch = (async () => {
    calls += 1;
    throw new Error("fetch should never be called in this test");
  }) as any;

  try {
    await assert.rejects(
      () =>
        routeText(freshCtx({ deadlineMs: 10 }), {
          prompt: "hi",
          preferredProvider: "nvidia",
        }),
      /Request deadline exceeded before any provider could be attempted\./
    );
    assert.equal(calls, 0, "no provider fetch should happen once the deadline is already exhausted");
  } finally {
    global.fetch = originalFetch;
  }
});

test("routeText: success on the first candidate is unaffected by the deadline machinery", async () => {
  resetAllBreakers();
  const originalFetch = global.fetch;
  global.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
      status: 200,
    })) as any;

  try {
    const result = await routeText(freshCtx({ deadlineMs: 12000 }), {
      prompt: "hi",
      preferredProvider: "nvidia",
    });
    assert.equal(result.data, "ok");
    assert.equal(result.provider, "nvidia");
  } finally {
    global.fetch = originalFetch;
  }
});

test("routeText: deadline exceeded on the first provider stops the cascade after exactly one attempt", async () => {
  resetAllBreakers();
  let calls = 0;
  const originalFetch = global.fetch;
  // Never resolves on its own — only the propagated AbortSignal ends it, so
  // elapsed time always equals exactly the per-attempt cap.
  global.fetch = ((_url: string, init: any) =>
    new Promise((_resolve, reject) => {
      calls += 1;
      init?.signal?.addEventListener("abort", () => {
        const err = new Error("The operation was aborted");
        err.name = "TimeoutError";
        reject(err);
      });
    })) as any;

  try {
    // deadlineMs=100 -> first attempt cap = 100*0.6 = 60ms; remaining after
    // that attempt = 40ms, which is below the 50ms floor, so no second
    // candidate is attempted even though more are configured.
    await assert.rejects(
      () =>
        routeText(freshCtx({ deadlineMs: 100 }), {
          prompt: "hi",
          preferredProvider: "nvidia",
        }),
      /All available AI providers failed for policy "balanced"\. Last error: NVIDIA request timed out\./
    );
    assert.equal(calls, 1, "only the first candidate should have been attempted");
  } finally {
    global.fetch = originalFetch;
  }
});

test("routeText: deadline exceeded mid-cascade stops before exhausting every configured candidate", async () => {
  resetAllBreakers();
  let calls = 0;
  const originalFetch = global.fetch;
  global.fetch = ((_url: string, init: any) =>
    new Promise((_resolve, reject) => {
      calls += 1;
      init?.signal?.addEventListener("abort", () => {
        const err = new Error("The operation was aborted");
        err.name = "TimeoutError";
        reject(err);
      });
    })) as any;

  try {
    // deadlineMs=220, nvidia preferred + deepseek/qwen/glm also configured
    // (4 candidates total). The idealized per-attempt formula predicts the
    // deadline is exhausted after 3 attempts (132ms + 29ms + 30ms, leaving
    // ~29ms < the 50ms floor for the 4th); real timer/audit-logging overhead
    // shrinks the budget a little faster than that, so the exact attempt
    // count that triggers the stop is 2 or 3, not always precisely 3 — the
    // invariant this test actually proves is that fewer than all 4
    // configured candidates were attempted, i.e. the deadline cut the
    // cascade short rather than it exhausting naturally.
    await assert.rejects(
      () =>
        routeText(freshCtx({ deadlineMs: 220 }), {
          prompt: "hi",
          preferredProvider: "nvidia",
        }),
      /All available AI providers failed for policy "balanced"\./
    );
    assert.ok(
      calls >= 1 && calls < 4,
      `expected an early stop before all 4 candidates were attempted, got ${calls} calls`
    );
  } finally {
    global.fetch = originalFetch;
  }
});
