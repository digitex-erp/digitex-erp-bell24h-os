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
    // D4.4: this is now a distinct RouterDeadlineExceededError (code
    // "router_deadline_exceeded"), not the generic "All available AI
    // providers failed" message — the cascade stopped because the shared
    // deadline ran out, not because every candidate was actually tried.
    await assert.rejects(
      () =>
        routeText(freshCtx({ deadlineMs: 100 }), {
          prompt: "hi",
          preferredProvider: "nvidia",
        }),
      (err: any) => {
        assert.equal(err.code, "router_deadline_exceeded");
        assert.match(err.message, /Request deadline exceeded after 1 provider attempt\(s\).*NVIDIA request timed out/);
        return true;
      }
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
    // D4.4: distinct RouterDeadlineExceededError, same reasoning as above.
    await assert.rejects(
      () =>
        routeText(freshCtx({ deadlineMs: 220 }), {
          prompt: "hi",
          preferredProvider: "nvidia",
        }),
      (err: any) => {
        assert.equal(err.code, "router_deadline_exceeded");
        assert.match(err.message, /Request deadline exceeded after \d+ provider attempt\(s\)/);
        return true;
      }
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

// ---------------------------------------------------------------------------
// D4.4 — distinguishing router deadline exhaustion from genuine provider
// failure, and rejecting empty/malformed "successful" provider responses.
// ---------------------------------------------------------------------------

test("routeText: a provider timeout followed by a successful fallback still returns success (genuine timeout, not router deadline exhaustion)", async () => {
  resetAllBreakers();
  const originalFetch = global.fetch;
  let call = 0;
  global.fetch = ((_url: string, init: any) =>
    new Promise((resolve, reject) => {
      call += 1;
      if (call === 1) {
        // nvidia: never resolves on its own, aborted by its per-attempt cap
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "TimeoutError";
          reject(err);
        });
      } else {
        // deepseek: succeeds immediately
        resolve(new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }));
      }
    })) as any;

  try {
    // deadlineMs=1000 keeps this test fast (nvidia's cap = 600ms, still
    // large relative to the 50ms floor) without changing what's proven:
    // a genuine per-attempt timeout, with budget left over, falls through
    // to a successful next candidate — this is not deadline exhaustion.
    const result = await routeText(freshCtx({ deadlineMs: 1000 }), {
      prompt: "hi",
      preferredProvider: "nvidia",
    });
    assert.equal(result.data, "ok");
    assert.equal(result.provider, "deepseek");
    assert.equal(result.fallbackFrom, "nvidia");
  } finally {
    global.fetch = originalFetch;
  }
});

test("routeText: every candidate genuinely failing (not due to deadline) throws the generic aggregate error, NOT RouterDeadlineExceededError", async () => {
  resetAllBreakers();
  const originalFetch = global.fetch;
  // Rejects immediately with a real-shaped upstream error — not an abort —
  // so the loop exhausts the (single) candidate naturally, never breaking
  // early on the deadline check.
  global.fetch = (async () =>
    new Response(JSON.stringify({ error: { message: "simulated upstream 500" } }), { status: 500 })) as any;

  try {
    await assert.rejects(
      () =>
        routeText(freshCtx({ deadlineMs: 12000 }), {
          prompt: "hi",
          preferredProvider: "nvidia",
          allowFallback: false, // isolates this to exactly one genuinely-exhausted candidate
        }),
      (err: any) => {
        assert.notEqual(err.code, "router_deadline_exceeded");
        assert.match(err.message, /simulated upstream 500/);
        return true;
      }
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("routeText: no configured providers at all maps to the existing provider_credentials_unavailable code", async () => {
  // Temporarily unconfigure everything this suite normally configures, to
  // exercise the genuinely-empty-candidate-list path in isolation.
  const saved: Record<string, string | undefined> = {};
  for (const name of CONFIGURED_FOR_TEST) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
  try {
    await assert.rejects(
      () => routeText(freshCtx(), { prompt: "hi" }),
      (err: any) => {
        assert.equal(err.code, "provider_credentials_unavailable");
        assert.match(err.message, /No operational AI providers available/);
        return true;
      }
    );
  } finally {
    for (const name of CONFIGURED_FOR_TEST) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
});

test("routeText: whitespace-only provider content is rejected, not returned as a false success", async () => {
  resetAllBreakers();
  const originalFetch = global.fetch;
  global.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "   " } }] }), { status: 200 })) as any;

  try {
    await assert.rejects(
      () =>
        routeText(freshCtx({ deadlineMs: 12000 }), {
          prompt: "hi",
          preferredProvider: "nvidia",
          allowFallback: false,
        }),
      /returned empty or invalid text content/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("routeText: a malformed response (missing choices entirely) is rejected the same way as empty content", async () => {
  resetAllBreakers();
  const originalFetch = global.fetch;
  global.fetch = (async () => new Response(JSON.stringify({ unexpected: "shape" }), { status: 200 })) as any;

  try {
    await assert.rejects(
      () =>
        routeText(freshCtx({ deadlineMs: 12000 }), {
          prompt: "hi",
          preferredProvider: "nvidia",
          allowFallback: false,
        }),
      /returned empty or invalid text content/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("routeJson: a valid but textually-unusual JSON object (e.g. {}) is NOT rejected — the text-emptiness check must not apply to the JSON path", async () => {
  resetAllBreakers();
  const originalFetch = global.fetch;
  global.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 })) as any;

  try {
    const result = await routeJson<Record<string, never>>(freshCtx({ deadlineMs: 12000 }), {
      prompt: "hi",
      preferredProvider: "nvidia",
      responseSchema: { type: "object" },
    });
    assert.deepEqual(result.data, {});
  } finally {
    global.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// D4.4.1 — last-candidate deadline classification.
//
// Demonstrated production gap: if the FINAL configured candidate is reached,
// its own attempt is aborted by a signal derived from the shared deadline,
// and the loop then completes naturally (never hits the early `break` that
// sets stoppedDueToDeadline), the result was a generic 500 INTERNAL_ERROR
// even though the shared deadline — not an independent provider failure —
// is what actually prevented completion. These tests prove that gap first
// (red, against the pre-fix code path), then prove the fix (green).
// ---------------------------------------------------------------------------

/**
 * Isolates the candidate list to exactly [nvidia] for the duration of one
 * test, by temporarily unconfiguring the other three providers this suite's
 * shared before() hook normally configures. Needed so "the loop completes
 * naturally" is unambiguous: with only one candidate, there is no second
 * iteration that could either be skipped (early break) or attempted — a
 * single-candidate failure always falls through to natural completion,
 * which is exactly the scenario this defect is about.
 */
async function withOnlyNvidiaConfigured<T>(fn: () => Promise<T>): Promise<T> {
  const others = CONFIGURED_FOR_TEST.filter((n) => n !== "NVIDIA_API_KEY");
  const saved: Record<string, string | undefined> = {};
  for (const name of others) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
  try {
    return await fn();
  } finally {
    for (const name of others) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
}

test("D4.4.1: final (only) candidate times out with ~no shared budget left -> classified as RouterDeadlineExceededError, not generic failure", async () =>
  withOnlyNvidiaConfigured(async () => {
    resetAllBreakers();
    let calls = 0;
    const originalFetch = global.fetch;
    // Never resolves on its own — only the propagated AbortSignal ends it,
    // so elapsed time always equals exactly the per-attempt cap, same
    // technique as the existing D4.3-A tests.
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
      // Exactly one candidate (nvidia). deadlineMs=100 -> its cap =
      // 100*0.6=60ms (the "first attempt" share formula applies regardless
      // of also being the last). After it fails, the loop increments i to
      // 1; candidates.length is 1, so the loop condition (i < length) is
      // false and the loop ends by natural completion — there is no second
      // iteration to possibly skip, so stoppedDueToDeadline is guaranteed
      // false here, by construction, not by luck. Remaining budget at the
      // tail is ~40ms, below the 50ms floor.
      const err: any = await routeText(freshCtx({ deadlineMs: 100 }), {
        prompt: "hi",
        preferredProvider: "nvidia",
      }).catch((e) => e);

      assert.equal(calls, 1, "the only configured candidate should have been attempted exactly once");
      assert.equal(
        err?.code,
        "router_deadline_exceeded",
        `expected the deadline-starved final attempt to be classified as router_deadline_exceeded, got code=${err?.code}, message=${err?.message}`
      );
    } finally {
      global.fetch = originalFetch;
    }
  }));

test("D4.4.1: final candidate's own provider-side timeout with plenty of shared budget left stays a generic failure, not a false 504", async () => {
  resetAllBreakers();
  // All 4 of this suite's normally-configured providers are left
  // configured here deliberately: every one rejects near-instantly (not via
  // the abort signal) with a timeout-shaped error, simulating providers
  // that are themselves slow/unresponsive -- NOT a case where the shared
  // deadline ran out. The loop exhausts all 4 naturally in well under a
  // millisecond of real elapsed time, so ~12000ms of the 12000ms budget is
  // still left when the tail classification runs. The adapter still tags
  // the last failure "provider_timeout" (it can't distinguish the two
  // causes on its own); the router must use the remaining budget, not just
  // the code, to avoid a false positive here.
  const originalFetch = global.fetch;
  global.fetch = (async () => {
    const err: any = new Error("simulated provider-side hang");
    err.name = "TimeoutError";
    throw err;
  }) as any;

  try {
    const err: any = await routeText(freshCtx({ deadlineMs: 12000 }), {
      prompt: "hi",
      preferredProvider: "nvidia",
    }).catch((e) => e);

    assert.notEqual(
      err?.code,
      "router_deadline_exceeded",
      "a provider's own timeout with ample shared budget remaining must not be misclassified as router deadline exhaustion"
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("D4.4.1 (JSON path): final (only) candidate times out with ~no shared budget left -> same classification as routeText", async () =>
  withOnlyNvidiaConfigured(async () => {
    resetAllBreakers();
    const originalFetch = global.fetch;
    global.fetch = ((_url: string, init: any) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("The operation was aborted");
          err.name = "TimeoutError";
          reject(err);
        });
      })) as any;

    try {
      const err: any = await routeJson(freshCtx({ deadlineMs: 100 }), {
        prompt: "hi",
        preferredProvider: "nvidia",
        responseSchema: { type: "object" },
      }).catch((e) => e);

      assert.equal(err?.code, "router_deadline_exceeded");
    } finally {
      global.fetch = originalFetch;
    }
  }));
