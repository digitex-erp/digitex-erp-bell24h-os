/**
 * Authentication for the worker-tick cron route — a scheduled system caller
 * (Vercel Cron, or an external scheduler hitting the same route), as distinct
 * from `requireAuth.ts`'s end-user Supabase JWT path and from
 * `requireServiceAuth.ts`'s VyaparSethu-specific service-to-service path.
 * Modeled directly on `requireServiceAuth.ts`'s shape (single shared secret,
 * constant-time comparison, fail closed in every branch) rather than
 * introducing a new authentication pattern — see
 * docs/project/BELL24H_OS_P0_REMEDIATION_IMPLEMENTATION_PLAN.md Phase 3.
 *
 * Uses `Authorization: Bearer <token>` rather than a custom header because
 * that is Vercel's own documented convention for Cron Jobs: when a
 * `CRON_SECRET` environment variable is set, Vercel automatically sends it as
 * `Authorization: Bearer $CRON_SECRET` on requests it triggers from
 * `vercel.json`'s `crons` entries — no extra configuration needed on the
 * Vercel side beyond setting that one environment variable.
 *
 * Fails closed: a missing header, a missing server secret, and a mismatched
 * secret are all denied via the same canonical error shape.
 */

import type { NextFunction, Request, Response } from "express";
import { createHash, timingSafeEqual } from "crypto";
import { emitAuditEvent } from "../audit.js";
import { resolveRequestId } from "../lib/requestContext.js";
import { sendError, type CanonicalErrorCode } from "../lib/errors.js";

export interface CronAuthedRequest extends Request {
  requestId?: string;
}

const CRON_SECRET_ENV_VAR = "CRON_SECRET";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Constant-time comparison via fixed-length digests — see requireServiceAuth.ts. */
function secureEquals(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

/**
 * Express middleware. On success calls next(). On any failure it terminates
 * the request — it never calls next().
 */
export async function requireCronAuth(req: Request, res: Response, next: NextFunction) {
  const cronReq = req as CronAuthedRequest;
  const requestId = resolveRequestId(req, res);
  cronReq.requestId = requestId;

  const deny = (status: number, code: CanonicalErrorCode, message: string) => {
    emitAuditEvent({
      actor: null,
      organizationId: null,
      action: "cron.verify",
      targetType: "http_request",
      targetId: `${req.method} ${req.path}`,
      outcome: "denied",
      requestId,
      metadata: { code },
    });
    sendError(res, status, code, requestId, message);
  };

  const authHeader = req.headers.authorization;
  const provided = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
  if (!provided) {
    return deny(401, "AUTHENTICATION_FAILED", "Missing or malformed Authorization: Bearer <token> header.");
  }

  const expected = process.env[CRON_SECRET_ENV_VAR];
  if (!expected || expected.trim().length === 0) {
    // Fail closed: without a configured secret there is nothing to verify against.
    return deny(
      503,
      "PROVIDER_UNAVAILABLE",
      `Cron authentication is not configured on the server (missing ${CRON_SECRET_ENV_VAR}).`,
    );
  }

  if (!secureEquals(provided, expected)) {
    return deny(401, "AUTHENTICATION_FAILED", "Cron credential rejected.");
  }

  emitAuditEvent({
    actor: "service:cron",
    organizationId: null,
    action: "cron.verify",
    targetType: "http_request",
    targetId: `${req.method} ${req.path}`,
    outcome: "success",
    requestId,
  });

  next();
}
