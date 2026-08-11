/**
 * Fixed-window rate limiting, keyed by organization.
 *
 * Must be mounted AFTER requireAuth so `req.auth.organizationId` is available.
 * Anonymous callers never reach this middleware — they are rejected by requireAuth.
 *
 * LIMITATION: in-memory and therefore per-process. It does not coordinate across
 * instances and resets on restart. Adequate as an abuse brake for a single server;
 * a shared store (Redis / Postgres) is required before horizontal scaling. Tracked
 * as follow-up rather than presented as production-grade.
 */

import type { NextFunction, Response } from "express";
import { emitAuditEvent } from "../audit.js";
import type { AuthedRequest } from "./requireAuth.js";

export interface RateLimitOptions {
  /** Requests permitted per window, per organization. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Label used in audit events. */
  name: string;
}

interface WindowEntry {
  count: number;
  startedAt: number;
}

export function rateLimit(opts: RateLimitOptions) {
  const windows = new Map<string, WindowEntry>();

  return function rateLimitMiddleware(req: AuthedRequest, res: Response, next: NextFunction) {
    const organizationId = req.auth?.organizationId;

    if (!organizationId) {
      // Defensive: middleware order is wrong. Fail closed rather than skip the limit.
      res.status(500).json({ error: "rate_limit_misconfigured" });
      return;
    }

    const key = `${opts.name}:${organizationId}`;
    const now = Date.now();
    const entry = windows.get(key);

    if (!entry || now - entry.startedAt >= opts.windowMs) {
      windows.set(key, { count: 1, startedAt: now });
      next();
      return;
    }

    if (entry.count >= opts.limit) {
      const retryAfterSec = Math.ceil((entry.startedAt + opts.windowMs - now) / 1000);
      emitAuditEvent({
        actor: req.auth?.userId ?? null,
        organizationId,
        action: "ratelimit.reject",
        targetType: "http_request",
        targetId: `${req.method} ${req.path}`,
        outcome: "denied",
        requestId: req.requestId ?? "unknown",
        metadata: { limiter: opts.name, limit: opts.limit, windowMs: opts.windowMs },
      });
      res.setHeader("Retry-After", String(Math.max(retryAfterSec, 1)));
      res.status(429).json({ error: "rate_limited", retryAfterSeconds: retryAfterSec });
      return;
    }

    entry.count += 1;
    next();
  };
}
