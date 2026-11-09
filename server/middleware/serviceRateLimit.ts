/**
 * Shared-state (Postgres-backed) rate limiting and concurrency control for
 * server-to-service callers -- initially /api/v1/ai/text only.
 *
 * Why not the existing server/middleware/rateLimit.ts: that middleware is
 * in-memory and keyed by req.auth.organizationId. Two reasons it can't be
 * reused here, both structural, not oversights:
 *   1. It is per-process. Bell24h-OS runs as a Vercel serverless function
 *      (api/index.ts) that caches one Express app per warm instance, not
 *      per request -- but Vercel runs MULTIPLE concurrent warm instances
 *      under load, each with isolated memory. An in-memory counter only
 *      limits requests landing on the same instance; under scale-out a
 *      caller could receive up to N times the intended limit. The existing
 *      middleware's own header comment already documents this limitation.
 *   2. requireServiceAuth.ts deliberately never sets req.auth.organizationId
 *      -- it sets req.serviceCaller instead, a different identity shape
 *      entirely (see that file's own Decision B: no organization_id is
 *      ever derived from a service credential).
 *
 * This middleware uses the existing shared Postgres connection (getPool(),
 * already used by QueueManager/WorkerRegistry) as its shared store, rather
 * than introducing Redis or another paid service -- see
 * add_service_rate_limit_tables.sql for the schema and the full rationale.
 *
 * Two independent checks, both scoped to the authenticated SERVICE
 * caller's own identity (serviceCaller.system) -- never a client-supplied
 * header, and never a per-VyaparSethu-customer organization_id, because no
 * such identity exists at this authentication layer (see
 * requireServiceAuth.ts). This isolates different SERVICE callers from each
 * other; it does not and cannot isolate individual end customers behind a
 * single service caller.
 *
 *   1. A fixed-window request-count limit ("how many requests in the last
 *      N ms"), via service_rate_limit_windows.
 *   2. A concurrency limit ("how many requests from this caller are being
 *      processed right now"), via service_concurrency_slots. A caller can
 *      be under its window limit while still having too many requests
 *      genuinely in flight at once.
 *
 * Fail-open on limiter-storage failure, by design: a rate limiter's job is
 * to bound abuse/cost, not to establish identity (requireServiceAuth.ts
 * already did that, upstream, and remains fail-closed). Failing closed here
 * would mean a transient database hiccup turns into a full outage of the
 * one legitimate capability this endpoint provides, for a mechanism whose
 * entire purpose is to be a soft brake, not a hard dependency. Every
 * storage failure is logged via an audit event so a systemic outage (vs. a
 * transient blip) is still visible operationally.
 */

import type { NextFunction, Response } from "express";
import type pg from "pg";
import { emitAuditEvent } from "../audit.js";
import type { ServiceAuthedRequest } from "./requireServiceAuth.js";

export interface ServiceRateLimitOptions {
  /** Requests permitted per window, per identity_key. */
  windowLimit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Maximum requests from the same identity_key processed concurrently. */
  maxConcurrent: number;
  /** Label used as limiter_name in storage and audit events. */
  name: string;
  getPool: () => pg.Pool;
  /** Injectable for deterministic tests; defaults to Date.now. */
  now?: () => number;
}

function denyMissingCaller(res: Response, requestId: string) {
  // Defensive: this middleware must be mounted AFTER requireServiceAuth, so
  // req.serviceCaller is always set on any request that reaches here. If it
  // isn't, that's a middleware-ordering bug, not a caller error -- fail
  // closed rather than silently skip the limit (mirrors rateLimit.ts's own
  // existing precedent for this exact defensive case).
  res.status(500).json({ error_code: "INTERNAL_ERROR", message: "Rate limiter misconfigured.", request_id: requestId });
}

/**
 * Validates configuration at construction time (server startup), not at
 * request time. A malformed env var (e.g. a non-numeric
 * AI_TEXT_RATE_LIMIT_PER_WINDOW) would otherwise produce `NaN`, and
 * `count > NaN` is always `false` in JavaScript -- every window/concurrency
 * check would silently pass, turning a misconfiguration into an
 * accidentally-unlimited limiter rather than a visible startup failure.
 * Failing fast here, at the one place configuration is assembled, is far
 * safer than that silent failure mode.
 */
function assertValidConfig(opts: ServiceRateLimitOptions): void {
  for (const [field, value] of [
    ["windowLimit", opts.windowLimit],
    ["windowMs", opts.windowMs],
    ["maxConcurrent", opts.maxConcurrent],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(
        `createServiceRateLimit("${opts.name}"): invalid ${field} (${value}) -- must be a finite number >= 0. Check the corresponding environment variable for a non-numeric value.`,
      );
    }
  }
  if (opts.windowMs === 0) {
    throw new Error(`createServiceRateLimit("${opts.name}"): windowMs must be greater than 0.`);
  }
}

export function createServiceRateLimit(opts: ServiceRateLimitOptions) {
  assertValidConfig(opts);
  const now = opts.now ?? Date.now;

  return async function serviceRateLimitMiddleware(req: ServiceAuthedRequest, res: Response, next: NextFunction) {
    const identityKey = req.serviceCaller?.system;
    const requestId = req.requestId ?? "unknown";

    if (!identityKey) {
      return denyMissingCaller(res, requestId);
    }

    const pool = opts.getPool();
    const nowMs = now();
    const windowStart = Math.floor(nowMs / opts.windowMs) * opts.windowMs;

    let windowCount: number;
    try {
      // Atomic increment-and-read in one round trip: the row either doesn't
      // exist yet for this window (created at count=1) or does (incremented).
      const result = await pool.query(
        `INSERT INTO service_rate_limit_windows (limiter_name, identity_key, window_start, request_count, updated_at)
         VALUES ($1, $2, $3, 1, now())
         ON CONFLICT (limiter_name, identity_key, window_start)
         DO UPDATE SET request_count = service_rate_limit_windows.request_count + 1, updated_at = now()
         RETURNING request_count`,
        [opts.name, identityKey, windowStart],
      );
      windowCount = result.rows[0].request_count;

      // Opportunistic cleanup of this same caller's own expired windows --
      // cheap (scoped to one identity_key via the primary key's leading
      // columns) and keeps the table from growing unboundedly without a
      // separate scheduled job. Never allowed to fail the request if it
      // itself errors.
      pool
        .query(
          `DELETE FROM service_rate_limit_windows WHERE limiter_name = $1 AND identity_key = $2 AND window_start < $3`,
          [opts.name, identityKey, windowStart - opts.windowMs * 4],
        )
        .catch(() => {
          // Best-effort only; a failed cleanup never affects correctness, only table size.
        });
    } catch (err) {
      emitAuditEvent({
        actor: `service:${identityKey}`,
        organizationId: null,
        action: "ratelimit.storage_error",
        targetType: "http_request",
        targetId: `${req.method} ${req.path}`,
        outcome: "denied",
        requestId,
        metadata: { limiter: opts.name, check: "window", error: err instanceof Error ? err.message : "unknown" },
      });
      // Fail open -- see module header comment for the justification.
      return next();
    }

    if (windowCount > opts.windowLimit) {
      const retryAfterSec = Math.max(Math.ceil((windowStart + opts.windowMs - nowMs) / 1000), 1);
      emitAuditEvent({
        actor: `service:${identityKey}`,
        organizationId: null,
        action: "ratelimit.reject",
        targetType: "http_request",
        targetId: `${req.method} ${req.path}`,
        outcome: "denied",
        requestId,
        metadata: { limiter: opts.name, reason: "window_exceeded", limit: opts.windowLimit, windowMs: opts.windowMs },
      });
      res.setHeader("Retry-After", String(retryAfterSec));
      return res.status(429).json({
        error_code: "RATE_LIMITED",
        message: "Too many requests. Please retry later.",
        request_id: requestId,
        correlation_id: requestId,
        retryable: true,
        details: { retryAfterSeconds: retryAfterSec },
      });
    }

    // Concurrency check: increment first, then verify; decrement back
    // immediately on rejection so a rejected request never permanently
    // occupies a slot.
    let concurrentCount: number;
    try {
      const result = await pool.query(
        `INSERT INTO service_concurrency_slots (limiter_name, identity_key, active_count, updated_at)
         VALUES ($1, $2, 1, now())
         ON CONFLICT (limiter_name, identity_key)
         DO UPDATE SET active_count = service_concurrency_slots.active_count + 1, updated_at = now()
         RETURNING active_count`,
        [opts.name, identityKey],
      );
      concurrentCount = result.rows[0].active_count;
    } catch (err) {
      emitAuditEvent({
        actor: `service:${identityKey}`,
        organizationId: null,
        action: "ratelimit.storage_error",
        targetType: "http_request",
        targetId: `${req.method} ${req.path}`,
        outcome: "denied",
        requestId,
        metadata: { limiter: opts.name, check: "concurrency", error: err instanceof Error ? err.message : "unknown" },
      });
      // Fail open -- same justification as the window check above.
      return next();
    }

    if (concurrentCount > opts.maxConcurrent) {
      // Release the slot we just took -- this request is being rejected,
      // it must not hold a permanent place in the concurrency count.
      pool
        .query(
          `UPDATE service_concurrency_slots SET active_count = GREATEST(active_count - 1, 0), updated_at = now()
           WHERE limiter_name = $1 AND identity_key = $2`,
          [opts.name, identityKey],
        )
        .catch(() => {
          // Best-effort release; a leaked slot self-heals once another
          // request's own release (below) or a future restart clears it,
          // and is bounded by maxConcurrent, not unbounded.
        });
      emitAuditEvent({
        actor: `service:${identityKey}`,
        organizationId: null,
        action: "ratelimit.reject",
        targetType: "http_request",
        targetId: `${req.method} ${req.path}`,
        outcome: "denied",
        requestId,
        metadata: { limiter: opts.name, reason: "concurrency_exceeded", maxConcurrent: opts.maxConcurrent },
      });
      res.setHeader("Retry-After", "1");
      return res.status(429).json({
        error_code: "RATE_LIMITED",
        message: "Too many concurrent requests. Please retry shortly.",
        request_id: requestId,
        correlation_id: requestId,
        retryable: true,
        details: { retryAfterSeconds: 1 },
      });
    }

    // Release this request's concurrency slot once it finishes, regardless
    // of success or failure, so the slot doesn't leak for the lifetime of
    // the process. res.on("finish") fires once the response has actually
    // been sent, covering both the success path and any error path the
    // downstream route handler takes.
    res.on("finish", () => {
      pool
        .query(
          `UPDATE service_concurrency_slots SET active_count = GREATEST(active_count - 1, 0), updated_at = now()
           WHERE limiter_name = $1 AND identity_key = $2`,
          [opts.name, identityKey],
        )
        .catch((err) => {
          emitAuditEvent({
            actor: `service:${identityKey}`,
            organizationId: null,
            action: "ratelimit.storage_error",
            targetType: "http_request",
            targetId: `${req.method} ${req.path}`,
            outcome: "denied",
            requestId,
            metadata: { limiter: opts.name, check: "concurrency_release", error: err instanceof Error ? err.message : "unknown" },
          });
        });
    });

    next();
  };
}
