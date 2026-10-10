/**
 * Bell24h-OS Enterprise Intelligence Infrastructure
 * Multi-Provider Resilient AI Router & Circuit Breaker Engine
 *
 * Capabilities:
 * - Dynamic policy-based routing (balanced, cost_optimized, latency_optimized, reasoning)
 * - Provider-level circuit breaker state machine (CLOSED, OPEN, HALF_OPEN)
 * - Automated multi-tier fallback chains with zero cascade failure
 * - Token-level and latency telemetry recording
 * - Per-organization spend cap enforcement
 * - Fail-closed credential validation across canonical and alias env vars
 *
 * This module must never be imported from `src/` (client code).
 */

import { emitAuditEvent } from "../audit.js";
import {
  ServerProviderName,
  RoutingPolicy,
  CircuitBreakerState,
  ProviderCircuitBreaker,
  RouterContext,
  RouterOptions,
  RouterJsonOptions,
  ProviderResult,
  TelemetryRecord,
  TokenUsage,
} from "./ProviderTypes.js";
import * as manager from "./ProviderManager.js";
import * as gemini from "./GeminiProvider.js";
import * as nvidia from "./NvidiaProvider.js";
import * as deepseek from "./DeepSeekProvider.js";
import * as qwen from "./QwenProvider.js";
import * as glm from "./GLMProvider.js";
import * as minimax from "./MiniMaxProvider.js";

export { SchemaType } from "./GeminiProvider.js";
export type {
  ServerProviderName,
  RoutingPolicy,
  RouterContext,
  RouterOptions,
  RouterJsonOptions,
};

// ============================================================================
// 1. SPEND CAP & BUDGET
// ============================================================================
const DAILY_BUDGET = Number(process.env.AI_REQUEST_DAILY_BUDGET ?? 200);
const DAY_MS = 24 * 60 * 60 * 1000;

interface BudgetEntry {
  count: number;
  windowStartedAt: number;
}

const budgetByOrg = new Map<string, BudgetEntry>();

// ============================================================================
// 1B. REQUEST DEADLINE (D4.3-A)
// ============================================================================
// 12,000ms is derived from VyaparSethu's current 15,000ms SDK timeout
// (its own AbortSignal.timeout(15000), see client.ts) — leaving ~3s margin
// for S2S auth, body validation, and the response trip back to the caller.
// This is a stopgap default until callers send their own deadline via the
// x-bell24h-deadline-ms header (see server.ts's resolution of that header
// for the /api/v1/ai/text route); RouterContext.deadlineMs, when supplied,
// always takes precedence over this constant.
const DEFAULT_ROUTER_DEADLINE_MS = Number(process.env.AI_ROUTER_DEADLINE_MS ?? 12000);

// Below this much remaining budget, no further candidate is attempted —
// matches the floor used by server.ts's own header validation reasoning.
const MIN_REMAINING_BUDGET_MS = 50;

// The first attempted candidate gets a larger, explicit share of the budget
// rather than an equal split with however many candidates remain: an equal
// split (e.g. 1/5 of 12s = 2,400ms) would be shorter than the one real
// observed production success (NVIDIA, 3,176ms per D2), which would make
// the only proven-healthy path unreachable under its own deadline. Every
// candidate after the first falls back to an even split of whatever budget
// is left at that point, recomputed fresh each iteration.
const FIRST_ATTEMPT_BUDGET_SHARE = 0.6;

export class BudgetExceededError extends Error {
  readonly code = "ai_budget_exceeded";
  constructor(public readonly limit: number) {
    super(`Organization AI request budget exceeded (${limit} requests per 24h).`);
    this.name = "BudgetExceededError";
  }
}

function consumeBudget(organizationId: string): void {
  const now = Date.now();
  const entry = budgetByOrg.get(organizationId);

  if (!entry || now - entry.windowStartedAt >= DAY_MS) {
    budgetByOrg.set(organizationId, { count: 1, windowStartedAt: now });
    return;
  }

  if (entry.count >= DAILY_BUDGET) {
    throw new BudgetExceededError(DAILY_BUDGET);
  }

  entry.count += 1;
}

// ============================================================================
// 2. CIRCUIT BREAKER STATE MACHINE
// ============================================================================
const FAILURE_THRESHOLD = 3; // Consecutive failures before tripping
const COOLDOWN_DURATION_MS = 60000; // 60s cooldown

const circuitBreakers: Map<ServerProviderName, ProviderCircuitBreaker> = new Map();

const ALL_PROVIDERS: ServerProviderName[] = [
  "nvidia",
  "deepseek",
  "qwen",
  "glm",
  "minimax",
  "gemini",
];

// Initialize circuit breakers for all registered providers
for (const p of ALL_PROVIDERS) {
  circuitBreakers.set(p, {
    provider: p,
    state: "CLOSED",
    consecutiveFailures: 0,
    lastFailureAt: null,
    lastSuccessAt: null,
    cooldownUntil: null,
  });
}

export function getCircuitBreaker(provider: ServerProviderName): ProviderCircuitBreaker {
  let cb = circuitBreakers.get(provider);
  if (!cb) {
    cb = {
      provider,
      state: "CLOSED",
      consecutiveFailures: 0,
      lastFailureAt: null,
      lastSuccessAt: null,
      cooldownUntil: null,
    };
    circuitBreakers.set(provider, cb);
  }

  // Check if cooldown has expired in OPEN state -> transition to HALF_OPEN
  if (cb.state === "OPEN" && cb.cooldownUntil && Date.now() >= cb.cooldownUntil) {
    cb.state = "HALF_OPEN";
  }

  return cb;
}

export function recordBreakerSuccess(provider: ServerProviderName): void {
  const cb = getCircuitBreaker(provider);
  cb.state = "CLOSED";
  cb.consecutiveFailures = 0;
  cb.cooldownUntil = null;
  cb.lastSuccessAt = Date.now();
  cb.tripReason = undefined;
}

export function recordBreakerFailure(provider: ServerProviderName, errorMsg: string): void {
  const cb = getCircuitBreaker(provider);
  cb.consecutiveFailures += 1;
  cb.lastFailureAt = Date.now();

  if (cb.consecutiveFailures >= FAILURE_THRESHOLD || cb.state === "HALF_OPEN") {
    cb.state = "OPEN";
    cb.cooldownUntil = Date.now() + COOLDOWN_DURATION_MS;
    cb.tripReason = errorMsg;
    console.warn(
      `[AIRouter] Circuit breaker tripped to OPEN for "${provider}". Cooldown: ${COOLDOWN_DURATION_MS / 1000}s. Reason: ${errorMsg}`
    );
  }
}

export function resetCircuitBreaker(provider: ServerProviderName): ProviderCircuitBreaker {
  const cb = getCircuitBreaker(provider);
  cb.state = "CLOSED";
  cb.consecutiveFailures = 0;
  cb.cooldownUntil = null;
  cb.tripReason = undefined;
  console.log(`[AIRouter] Operator manually reset circuit breaker for "${provider}".`);
  return cb;
}

export function getAllCircuitBreakers(): ProviderCircuitBreaker[] {
  return ALL_PROVIDERS.map((p) => getCircuitBreaker(p));
}

// ============================================================================
// 3. ROUTING POLICIES & PROVIDER SELECTION
// ============================================================================

/**
 * Priority lists per routing policy.
 * Configured so providers verified present in production (NVIDIA, DeepSeek, Qwen, GLM, MiniMax)
 * are prioritized appropriately.
 */
const POLICY_CHAINS: Record<RoutingPolicy, ServerProviderName[]> = {
  // Balanced: NVIDIA NIM speed + DeepSeek intelligence + Qwen stability
  balanced: ["nvidia", "deepseek", "qwen", "glm", "gemini", "minimax"],
  // Lowest cost: GLM/GLN + DeepSeek + Qwen
  cost_optimized: ["glm", "deepseek", "qwen", "nvidia", "minimax", "gemini"],
  // Latency optimized: NVIDIA NIM local inference + GLM + Gemini
  latency_optimized: ["nvidia", "glm", "gemini", "deepseek", "qwen", "minimax"],
  // Reasoning: DeepSeek + Qwen + NVIDIA
  reasoning: ["deepseek", "qwen", "nvidia", "gemini", "glm", "minimax"],
};

/**
 * Selects an ordered list of viable candidate providers based on:
 * 1. Policy preference
 * 2. Active configuration in environment
 * 3. Circuit breaker availability (skips OPEN breakers)
 * 4. Preferred provider override (if supplied)
 */
export function getCandidateProviders(
  policy: RoutingPolicy = "balanced",
  preferredProvider?: ServerProviderName
): ServerProviderName[] {
  const baseChain = POLICY_CHAINS[policy] || POLICY_CHAINS.balanced;

  // Filter providers that have configured credentials
  const configured = baseChain.filter((p) => manager.isProviderConfigured(p));

  // Filter out providers whose circuit breakers are OPEN and still in cooldown
  const available = configured.filter((p) => {
    const cb = getCircuitBreaker(p);
    return cb.state !== "OPEN";
  });

  // If all configured providers are OPEN (cascade event), fall back to configured list to attempt recovery probe
  const pool = available.length > 0 ? available : configured;

  if (preferredProvider && manager.isProviderConfigured(preferredProvider)) {
    const withoutPreferred = pool.filter((p) => p !== preferredProvider);
    return [preferredProvider, ...withoutPreferred];
  }

  return pool;
}

// ============================================================================
// 4. TELEMETRY BUFFER
// ============================================================================
const TELEMETRY_BUFFER_SIZE = 100;
const telemetryStore: TelemetryRecord[] = [];

export function recordTelemetry(record: TelemetryRecord): void {
  telemetryStore.unshift(record);
  if (telemetryStore.length > TELEMETRY_BUFFER_SIZE) {
    telemetryStore.pop();
  }
}

export function getRecentTelemetry(limit = 50): TelemetryRecord[] {
  return telemetryStore.slice(0, limit);
}

export function getTelemetrySummary(): {
  totalRequests: number;
  successRate: number;
  averageLatencyMs: number;
  totalTokens: number;
  fallbackCount: number;
  providerBreakdown: Record<string, number>;
} {
  const total = telemetryStore.length;
  if (total === 0) {
    return {
      totalRequests: 0,
      successRate: 100,
      averageLatencyMs: 0,
      totalTokens: 0,
      fallbackCount: 0,
      providerBreakdown: {},
    };
  }

  let successCount = 0;
  let totalLatency = 0;
  let totalTokens = 0;
  let fallbackCount = 0;
  const providerBreakdown: Record<string, number> = {};

  for (const t of telemetryStore) {
    if (t.status === "SUCCESS") successCount++;
    totalLatency += t.latencyMs || 0;
    if (t.tokens) totalTokens += t.tokens.totalTokens || 0;
    if (t.fallbackFrom) fallbackCount++;
    providerBreakdown[t.provider] = (providerBreakdown[t.provider] || 0) + 1;
  }

  return {
    totalRequests: total,
    successRate: Math.round((successCount / total) * 100),
    averageLatencyMs: Math.round(totalLatency / total),
    totalTokens,
    fallbackCount,
    providerBreakdown,
  };
}

// ============================================================================
// 4B. PER-ATTEMPT BUDGET (D4.3-A)
// ============================================================================

/**
 * Computes this attempt's own timeout cap: the first attempt gets
 * FIRST_ATTEMPT_BUDGET_SHARE of whatever remains; every later attempt gets
 * an even split across however many candidates are still untried. Always
 * bounded above by the provider's own configured timeout. Returns null when
 * the remaining budget is already at or below the floor, signaling that no
 * further candidate should be attempted.
 */
export function computePerAttemptCapMs(
  provider: ServerProviderName,
  attemptIndex: number,
  remainingCandidateCount: number,
  remainingBudgetMs: number
): number | null {
  if (remainingBudgetMs <= MIN_REMAINING_BUDGET_MS) {
    return null;
  }
  const providerTimeoutMs = manager.PROVIDER_REGISTRY[provider].timeoutMs;
  const share =
    attemptIndex === 0
      ? remainingBudgetMs * FIRST_ATTEMPT_BUDGET_SHARE
      : remainingBudgetMs / remainingCandidateCount;
  return Math.max(1, Math.min(providerTimeoutMs, Math.round(share)));
}

// ============================================================================
// 5. DISPATCH EXECUTION ENGINE
// ============================================================================

async function executeProviderText(
  provider: ServerProviderName,
  opts: RouterOptions
): Promise<ProviderResult<string>> {
  switch (provider) {
    case "nvidia":
      return nvidia.generateText(opts);
    case "deepseek":
      return deepseek.generateText(opts);
    case "qwen":
      return qwen.generateText(opts);
    case "glm":
      return glm.generateText(opts);
    case "minimax":
      return minimax.generateText(opts);
    case "gemini":
      return gemini.generateText(opts);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

async function executeProviderJson<T>(
  provider: ServerProviderName,
  opts: RouterJsonOptions<T>
): Promise<ProviderResult<T>> {
  switch (provider) {
    case "nvidia":
      return nvidia.generateJson<T>(opts);
    case "deepseek":
      return deepseek.generateJson<T>(opts);
    case "qwen":
      return qwen.generateJson<T>(opts);
    case "glm":
      return glm.generateJson<T>(opts);
    case "minimax":
      return minimax.generateJson<T>(opts);
    case "gemini":
      return gemini.generateJson<T>(opts);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

/**
 * Executes a text or JSON completion through the multi-provider routing policy.
 * Seamlessly handles failover to secondary providers on upstream failure.
 */
export async function routeText(
  ctx: RouterContext,
  opts: RouterOptions
): Promise<ProviderResult<string>> {
  consumeBudget(ctx.organizationId);

  const policy = opts.policy || "balanced";
  const candidates = getCandidateProviders(policy, opts.preferredProvider);

  if (candidates.length === 0) {
    throw new Error("No operational AI providers available in current environment.");
  }

  const deadlineMs = ctx.deadlineMs ?? DEFAULT_ROUTER_DEADLINE_MS;
  const deadlineAt = Date.now() + deadlineMs;

  let lastError: any = null;
  let fallbackFrom: ServerProviderName | undefined;
  let attemptsMade = 0;

  for (let i = 0; i < candidates.length; i++) {
    const provider = candidates[i];
    const perAttemptCapMs = computePerAttemptCapMs(
      provider,
      i,
      candidates.length - i,
      deadlineAt - Date.now()
    );
    if (perAttemptCapMs === null) {
      break; // deadline exceeded; no further candidates attempted
    }
    const signal = AbortSignal.timeout(perAttemptCapMs);

    const startedAt = Date.now();
    attemptsMade++;
    try {
      const result = await executeProviderText(provider, { ...opts, signal });
      recordBreakerSuccess(provider);

      const record: TelemetryRecord = {
        requestId: ctx.requestId,
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        provider,
        model: result.model,
        policy,
        workflowType: opts.workflowType,
        latencyMs: result.latencyMs,
        tokens: result.tokens,
        status: "SUCCESS",
        fallbackFrom,
        createdAt: new Date().toISOString(),
      };
      recordTelemetry(record);

      emitAuditEvent({
        actor: ctx.userId,
        organizationId: ctx.organizationId,
        action: ctx.action,
        targetType: "ai_request",
        targetId: ctx.requestId,
        outcome: "success",
        requestId: ctx.requestId,
        metadata: {
          provider,
          model: result.model,
          latencyMs: result.latencyMs,
          policy,
          fallbackFrom,
          tokens: result.tokens,
        },
      });

      return { ...result, fallbackFrom };
    } catch (err: any) {
      lastError = err;
      const errorMsg = err.message || "Provider error";
      recordBreakerFailure(provider, errorMsg);

      const record: TelemetryRecord = {
        requestId: ctx.requestId,
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        provider,
        model: opts.model || "default",
        policy,
        workflowType: opts.workflowType,
        latencyMs: Date.now() - startedAt,
        status: "ERROR",
        errorMessage: errorMsg,
        fallbackFrom,
        createdAt: new Date().toISOString(),
      };
      recordTelemetry(record);

      emitAuditEvent({
        actor: ctx.userId,
        organizationId: ctx.organizationId,
        action: ctx.action,
        targetType: "ai_request",
        targetId: ctx.requestId,
        outcome: "failure",
        requestId: ctx.requestId,
        metadata: {
          provider,
          policy,
          latencyMs: Date.now() - startedAt,
          errorCode: err?.code ?? "provider_error",
          errorMessage: errorMsg,
        },
      });

      // Mark that subsequent provider is running as a fallback
      fallbackFrom = provider;

      // If caller explicitly disallowed fallback, stop immediately
      if (opts.allowFallback === false) {
        throw err;
      }
    }
  }

  if (attemptsMade === 0) {
    throw new Error("Request deadline exceeded before any provider could be attempted.");
  }

  throw new Error(
    `All available AI providers failed for policy "${policy}". Last error: ${lastError?.message}`
  );
}

export async function routeJson<T>(
  ctx: RouterContext,
  opts: RouterJsonOptions<T>
): Promise<ProviderResult<T>> {
  consumeBudget(ctx.organizationId);

  const policy = opts.policy || "balanced";
  const candidates = getCandidateProviders(policy, opts.preferredProvider);

  if (candidates.length === 0) {
    throw new Error("No operational AI providers available in current environment.");
  }

  const deadlineMs = ctx.deadlineMs ?? DEFAULT_ROUTER_DEADLINE_MS;
  const deadlineAt = Date.now() + deadlineMs;

  let lastError: any = null;
  let fallbackFrom: ServerProviderName | undefined;
  let attemptsMade = 0;

  for (let i = 0; i < candidates.length; i++) {
    const provider = candidates[i];
    const perAttemptCapMs = computePerAttemptCapMs(
      provider,
      i,
      candidates.length - i,
      deadlineAt - Date.now()
    );
    if (perAttemptCapMs === null) {
      break; // deadline exceeded; no further candidates attempted
    }
    const signal = AbortSignal.timeout(perAttemptCapMs);

    const startedAt = Date.now();
    attemptsMade++;
    try {
      const result = await executeProviderJson<T>(provider, { ...opts, signal });
      recordBreakerSuccess(provider);

      const record: TelemetryRecord = {
        requestId: ctx.requestId,
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        provider,
        model: result.model,
        policy,
        workflowType: opts.workflowType,
        latencyMs: result.latencyMs,
        tokens: result.tokens,
        status: "SUCCESS",
        fallbackFrom,
        createdAt: new Date().toISOString(),
      };
      recordTelemetry(record);

      emitAuditEvent({
        actor: ctx.userId,
        organizationId: ctx.organizationId,
        action: ctx.action,
        targetType: "ai_request",
        targetId: ctx.requestId,
        outcome: "success",
        requestId: ctx.requestId,
        metadata: {
          provider,
          model: result.model,
          latencyMs: result.latencyMs,
          policy,
          fallbackFrom,
          tokens: result.tokens,
        },
      });

      return { ...result, fallbackFrom };
    } catch (err: any) {
      lastError = err;
      const errorMsg = err.message || "Provider error";
      recordBreakerFailure(provider, errorMsg);

      const record: TelemetryRecord = {
        requestId: ctx.requestId,
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        provider,
        model: opts.model || "default",
        policy,
        workflowType: opts.workflowType,
        latencyMs: Date.now() - startedAt,
        status: "ERROR",
        errorMessage: errorMsg,
        fallbackFrom,
        createdAt: new Date().toISOString(),
      };
      recordTelemetry(record);

      fallbackFrom = provider;

      if (opts.allowFallback === false) {
        throw err;
      }
    }
  }

  if (attemptsMade === 0) {
    throw new Error("Request deadline exceeded before any provider could be attempted.");
  }

  throw new Error(
    `All available AI providers failed for JSON request. Last error: ${lastError?.message}`
  );
}

// ============================================================================
// 6. BACKWARD COMPATIBLE EXPORTS
// (Guarantees zero breaking changes for server.ts and AIJobHandler.ts)
// ============================================================================

export async function generateText(ctx: RouterContext, opts: { prompt: string; model?: string }): Promise<string> {
  const result = await routeText(ctx, {
    ...opts,
    policy: "balanced",
  });
  return result.data;
}

export async function generateJson<T>(
  ctx: RouterContext,
  opts: { prompt: string; responseSchema: unknown; model?: string }
): Promise<T> {
  const result = await routeJson<T>(ctx, {
    ...opts,
    policy: "balanced",
  });
  return result.data;
}

export async function generateNvidiaText(ctx: RouterContext, opts: { prompt: string; model?: string }): Promise<string> {
  const result = await routeText(ctx, {
    ...opts,
    preferredProvider: "nvidia",
    allowFallback: false,
  });
  return result.data;
}

// ============================================================================
// 7. ROUTER OPERATOR & DIAGNOSTIC QUERIES
// ============================================================================

export function getRouterDashboardData() {
  const registry = manager.getRegistryStatus();
  const breakerList = getAllCircuitBreakers();
  const breakerMap: Record<ServerProviderName, ProviderCircuitBreaker> = {} as any;
  for (const b of breakerList) {
    breakerMap[b.provider] = b;
  }
  const telemetrySummary = getTelemetrySummary();
  const configuredProviders = manager.getConfiguredProviders();

  return {
    overview: {
      totalConfigured: configuredProviders.length,
      configuredProviders,
      dailyBudget: DAILY_BUDGET,
      activePolicies: Object.keys(POLICY_CHAINS),
    },
    registry,
    circuitBreakers: breakerMap,
    telemetry: telemetrySummary,
    policies: POLICY_CHAINS,
  };
}

export function testRouteSimulation(
  policy: RoutingPolicy = "balanced",
  workflowType = "general",
  preferredProvider?: ServerProviderName
) {
  const candidates = getCandidateProviders(policy, preferredProvider);
  const primary = candidates[0] || null;
  const fallbacks = candidates.slice(1);

  return {
    policy,
    workflowType,
    preferredProvider,
    selectedProvider: primary,
    fallbackChain: fallbacks,
    totalViableProviders: candidates.length,
  };
}
