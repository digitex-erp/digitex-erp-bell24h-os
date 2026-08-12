/**
 * Minimal server-side provider router.
 *
 * SCOPE: this is deliberately NOT the full Bell24h-OS Enterprise AI Router. It is the
 * smallest correct server-side boundary needed to serve the two vault endpoints
 * without exposing provider credentials to the browser. Broader routing policy
 * (multi-provider selection, health, circuit breakers, cost accounting) remains
 * future work — see ARCHITECTURE_DECISIONS.md.
 *
 * Responsibilities here: enforce a per-organization spend cap, execute the request
 * through a server-side adapter, and emit an audit event for every attempt.
 *
 * This file must never be imported from `src/` (client code).
 */

import { emitAuditEvent } from "../audit.js";
import * as gemini from "./GeminiProvider.js";
import * as nvidia from "./NvidiaProvider.js";

/**
 * Per-organization daily request cap.
 *
 * LIMITATION: in-memory and therefore per-process. It bounds spend for a single
 * server instance only and resets on restart. A durable counter belongs in the
 * database alongside `ai_request_logs`; tracked as follow-up work rather than
 * silently assumed sufficient.
 */
const DAILY_BUDGET = Number(process.env.AI_REQUEST_DAILY_BUDGET ?? 100);
const DAY_MS = 24 * 60 * 60 * 1000;

interface BudgetEntry {
  count: number;
  windowStartedAt: number;
}

const budgetByOrg = new Map<string, BudgetEntry>();

export class BudgetExceededError extends Error {
  readonly code = "ai_budget_exceeded";
  constructor(public readonly limit: number) {
    super(`Organization AI request budget exceeded (${limit} per 24h).`);
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

export interface RouterContext {
  userId: string;
  organizationId: string;
  requestId: string;
  action: string;
}

export interface TextOptions {
  prompt: string;
  model?: string;
}

export interface JsonOptions extends TextOptions {
  responseSchema: unknown;
}

async function run<T>(
  ctx: RouterContext,
  provider: string,
  execute: () => Promise<gemini.ProviderResult<T>>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    consumeBudget(ctx.organizationId);
    const result = await execute();

    emitAuditEvent({
      actor: ctx.userId,
      organizationId: ctx.organizationId,
      action: ctx.action,
      targetType: "ai_request",
      targetId: ctx.requestId,
      outcome: "success",
      requestId: ctx.requestId,
      metadata: { provider, model: result.model, latencyMs: result.latencyMs },
    });

    return result.data;
  } catch (err: any) {
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
        latencyMs: Date.now() - startedAt,
        errorCode: err?.code ?? "provider_error",
      },
    });
    throw err;
  }
}

export function generateText(ctx: RouterContext, opts: TextOptions): Promise<string> {
  return run(ctx, "gemini", () => gemini.generateText(opts));
}

export function generateJson<T>(ctx: RouterContext, opts: JsonOptions): Promise<T> {
  return run<T>(ctx, "gemini", () => gemini.generateJson<T>(opts));
}

// OS-INTEGRATION-IMPLEMENTATION-04D: NVIDIA registered through the existing Provider
// Router, reusing run()'s budget/audit/error-normalization wrapper unchanged. Additive
// only — generateText/generateJson above (used by the existing /api/vault/ai-summary
// and /api/vault/mentor-advice routes) are byte-identical in behavior; this is a new
// export, not a replacement. /api/v1/ai/text does not call this yet — that wiring is
// deferred to OS-INTEGRATION-IMPLEMENTATION-04E, which owns the real-call proof.
export function generateNvidiaText(ctx: RouterContext, opts: TextOptions): Promise<string> {
  return run(ctx, "nvidia", () => nvidia.generateText(opts));
}

export { SchemaType } from "./GeminiProvider.js";
