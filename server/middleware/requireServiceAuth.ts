/**
 * Service-to-service authentication for calls from a trusted external system —
 * initially VyaparSethu only — as distinct from `requireAuth.ts`'s end-user Supabase
 * JWT path. This is a parallel, additive check: it does not read, modify, or replace
 * anything in `requireAuth.ts`, and it is not a second organization resolver — it
 * establishes a *caller-system* identity, never an `organization_id`.
 *
 * OS_INTEGRATION_DECISION_RECORD_V1.md:
 *   Decision A — dedicated service-to-service credential, smallest initial
 *   implementation (a single shared secret, compared in constant time).
 *   Decision B — caller identity is fixed ("vyaparsethu") for this first
 *   integration. No tenant-mapping table, no per-VyaparSethu-company registry, and
 *   no `organization_id` is ever derived from this credential or from client input.
 *
 * Fails closed in every branch: missing server configuration, a missing credential,
 * and a credential that doesn't match are all denied via the same canonical error
 * shape — the caller learns nothing about *why* beyond "authentication failed."
 */

import type { NextFunction, Request, Response } from "express";
import { createHash, timingSafeEqual } from "crypto";
import { emitAuditEvent } from "../audit.js";
import { resolveRequestId } from "../lib/requestContext.js";
import { sendError, type CanonicalErrorCode } from "../lib/errors.js";

/** The one recognized caller for this first integration. Intentionally not a registry. */
export interface ServiceCallerContext {
  system: "vyaparsethu";
}

export interface ServiceAuthedRequest extends Request {
  serviceCaller?: ServiceCallerContext;
  requestId?: string;
}

const SERVICE_TOKEN_HEADER = "x-bell24h-service-token";
const SERVICE_TOKEN_ENV_VAR = "BELL24H_VYAPARSETHU_SERVICE_TOKEN";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Constant-time comparison. Compares fixed-length SHA-256 digests rather than the raw
 * strings, so this is safe even when the provided and expected values differ in
 * length (`timingSafeEqual` throws on unequal-length buffers otherwise).
 */
function secureEquals(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

/**
 * Express middleware. On success attaches `req.serviceCaller` and calls next().
 * On any failure it terminates the request — it never calls next().
 */
export async function requireServiceAuth(req: Request, res: Response, next: NextFunction) {
  const serviceReq = req as ServiceAuthedRequest;
  const requestId = resolveRequestId(req, res);
  serviceReq.requestId = requestId;

  const deny = (status: number, code: CanonicalErrorCode, message: string) => {
    emitAuditEvent({
      actor: null,
      organizationId: null,
      action: "s2s.verify",
      targetType: "http_request",
      targetId: `${req.method} ${req.path}`,
      outcome: "denied",
      requestId,
      metadata: { code },
    });
    sendError(res, status, code, requestId, message);
  };

  // Token presence is checked before server configuration so a caller with no
  // credential always receives the same 401 regardless of server config state —
  // mirroring requireAuth.ts's own ordering rationale.
  const header = req.headers[SERVICE_TOKEN_HEADER];
  const provided = Array.isArray(header) ? header[0] : header;
  if (!provided || provided.trim().length === 0) {
    return deny(401, "AUTHENTICATION_FAILED", `Missing ${SERVICE_TOKEN_HEADER} header.`);
  }

  const expected = process.env[SERVICE_TOKEN_ENV_VAR];
  if (!expected || expected.trim().length === 0) {
    // Fail closed: without a configured secret there is nothing to verify against.
    return deny(
      503,
      "PROVIDER_UNAVAILABLE",
      `Service authentication is not configured on the server (missing ${SERVICE_TOKEN_ENV_VAR}).`,
    );
  }

  if (!secureEquals(provided, expected)) {
    return deny(401, "AUTHENTICATION_FAILED", "Service credential rejected.");
  }

  serviceReq.serviceCaller = { system: "vyaparsethu" };

  emitAuditEvent({
    actor: "service:vyaparsethu",
    organizationId: null,
    action: "s2s.verify",
    targetType: "http_request",
    targetId: `${req.method} ${req.path}`,
    outcome: "success",
    requestId,
  });

  next();
}
