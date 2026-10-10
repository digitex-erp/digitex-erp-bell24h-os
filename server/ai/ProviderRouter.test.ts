/**
 * D4.3-A — Router deadline & cancellation tests.
 *
 * Uses Node's built-in test runner (no new dependency). `fetch` is stubbed
 * per-test so these never make a real network call for the five providers
 * whose adapters use it (NVIDIA/DeepSeek/Qwen/GLM/MiniMax). Gemini's adapter
 * uses the @google/genai SDK's own internal HTTP transport, not global
 * `fetch` — stubbing `fetch` does NOT intercept it. If a real GEMINI_API_KEY
 * (or a real MINIMAX_API_KEY/NINIMAX_API_KEY/GLN_API_KEY alias) happens to be
 * present in the ambient environment this suite runs in, `isProviderConfigured`
 * would include that provider as a real, unmocked candidate — risking a
 * genuine live API call during what must stay an isolated unit test. To
 * close that gap, every provider env var this router knows about (not just
 * the four this suite actually exercises) is explicitly saved and forced to
 * a known state for the duration of the run, then restored exactly.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  routeText,
  routeJson,
  computePerAttemptCapMs,
  parseValidDeadlineMs,
  resetCircuitBreaker,
  DEFAULT_ROUTER_DEADLINE_MS,
  MIN_DEADLINE_MS,
  MAX_DEADLINE_MS,
} from "./ProviderRouter.js";
import type { RouterContext } from "./ProviderTypes.js";

// Every env var name any adapter reads (ProviderManager.ts's ENV_VARS_BY_PROVIDER),
// not only the ones this suite deliberately configures.
const ALL_PROVIDER_ENV_VARS = [
  "NVIDIA_API_KEY",
  "DEEPSEEK_API_KEY",
  "QWEN_API_KEY",
  "GLM_API_KEY",
  "GLN_API_KEY",
  "MINIMAX_API_KEY",
  "NINIMAX_API_KEY",
  "GEMINI_API_KEY",
] as const;

const ORIGINAL_ENV: Record<string, string | undefined> = {};
for (const name of ALL_PROVIDER_ENV_VARS) {
  ORIGINAL_ENV[name] = process.env[name];
}

// Providers this suite's mocked `fetch` can safely stand in for.
const CONFIGURED_FOR_TEST = ["NVIDIA_API_KEY", "DEEPSEEK_API_KEY", "QWEN_API_KEY", "GLM_API_KEY"] as const;

before(() => {
  for (const name of ALL_PROVIDER_ENV_VARS) {
    delete process.env[name];
  }
  for (const name of CONFIGURED_FOR_TEST) {
    process.env[name] = "test-placeholder-not-real";
  }
});

after(() => {
  for (const name of ALL_PROVIDER_ENV_VARS) {
    const original = ORIGINAL_ENV[name];
    if (original === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = original;
    }
  }
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
// Deadline parsing/validation — header, env var, and RouterContext all funnel
// through parseValidDeadlineMs, so testing it once covers every source.
// ---------------------------------------------------------------------------

test("parseValidDeadlineMs: accepts a valid in-range value", () => {
  assert.equal(parseValidDeadlineMs(5000), 5000);
  assert.equal(parseValidDeadlineMs("5000"), 5000);
});

test("parseValidDeadlineMs: accepts the inclusive boundary values", () => {
  assert.equal(parseValidDeadlineMs(MIN_DEADLINE_MS), MIN_DEADLINE_MS);
  assert.equal(parseValidDeadlineMs(MAX_DEADLINE_MS), MAX_DEADLINE_MS);
});

test("parseValidDeadlineMs: rejects absent/empty values", () => {
  assert.equal(parseValidDeadlineMs(undefined), undefined);
  assert.equal(parseValidDeadlineMs(null), undefined);
  assert.equal(parseValidDeadlineMs(""), undefined);
});

test("parseValidDeadlineMs: rejects non-numeric, NaN, and infinite values", () => {
  assert.equal(parseValidDeadlineMs("abc"), undefined);
  assert.equal(parseValidDeadlineMs(NaN), undefined);
  assert.equal(parseValidDeadlineMs(Infinity), undefined);
  assert.equal(parseValidDeadlineMs("Infinity"), undefined);
  assert.equal(parseValidDeadlineMs(-Infinity), undefined);
});

test("parseValidDeadlineMs: rejects zero, negative, and out-of-range values", () => {
  assert.equal(parseValidDeadlineMs(0), undefined);
  assert.equal(parseValidDeadlineMs(-100), undefined);
  assert.equal(parseValidDeadlineMs(MIN_DEADLINE_MS - 1), undefined);
  assert.equal(parseValidDeadlineMs(MAX_DEADLINE_MS + 1), undefined);
});

test("DEFAULT_ROUTER_DEADLINE_MS: is the documented 12,000ms literal when AI_ROUTER_DEADLINE_MS is unset in this process", () => {
  // This process never sets AI_ROUTER_DEADLINE_MS, so the module-level
  // constant must have resolved to the hardcoded fallback.
  assert.equal(DEFAULT_ROUTER_DEADLINE_MS, 12000);
});

test("routeText: an invalid ctx.deadlineMs (e.g. NaN from a careless internal caller) falls through to the default rather than reaching deadlineAt unchecked", async () => {
  resetAllBreakers();
  const originalFetch = global.fetch;
  global.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
      status: 200,
    })) as any;

  try {
    // deadlineMs: NaN must not propagate into AbortSignal.timeout(NaN), which
    // throws synchronously — if it did, this call would reject instead of
    // succeeding. Success here proves the NaN was replaced by the default.
    const result = await routeText(freshCtx({ deadlineMs: NaN }), {
      prompt: "hi",
      preferredProvider: "nvidia",
    });
    assert.equal(result.data, "ok");
  } finally {
    global.fetch = originalFetch;
  }
});

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

// ---------------------------------------------------------------------------
// routeJson: the second router execution path shares the identical deadline
// logic (D4.3-A applied it to both). These two tests confirm that sharing
// is real, not just read from the source — a gap the first version of this
// suite left uncovered.
// ---------------------------------------------------------------------------

test("routeJson: deadline already exhausted at router entry — clean error, zero provider calls", async () => {
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
        routeJson(freshCtx({ deadlineMs: 10 }), {
          prompt: "hi",
          preferredProvider: "nvidia",
          responseSchema: { type: "object" },
        }),
      /Request deadline exceeded before any provider could be attempted\./
    );
    assert.equal(calls, 0, "no provider fetch should happen once the deadline is already exhausted");
  } finally {
    global.fetch = originalFetch;
  }
});

test("routeJson: success on the first candidate is unaffected by the deadline machinery", async () => {
  resetAllBreakers();
  const originalFetch = global.fetch;
  global.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), {
      status: 200,
    })) as any;

  try {
    const result = await routeJson<{ ok: boolean }>(freshCtx({ deadlineMs: 12000 }), {
      prompt: "hi",
      preferredProvider: "nvidia",
      responseSchema: { type: "object" },
    });
    assert.deepEqual(result.data, { ok: true });
    assert.equal(result.provider, "nvidia");
  } finally {
    global.fetch = originalFetch;
  }
});
