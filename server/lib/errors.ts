/**
 * Standardized error envelope for the /api/v1 SDK surface.
 * See docs/architecture/BELL24H_OS_VYAPARSETHU_SDK_API_CONTRACT_V1.md Section 15
 * (Error Contract).
 *
 * This generalizes, rather than replaces, `requireAuth.ts`'s existing
 * `{ error: <code>, requestId }` response shape. That shape is unchanged and untouched —
 * per Section 20 (Code Quality) / mission-brief rule "do not unnecessarily replace
 * existing error handling." New /api/v1 routes use `sendError` below instead, which
 * emits the canonical envelope defined by the contract.
 *
 * Mapping from requireAuth.ts's existing (unchanged) lowercase codes to the canonical
 * codes below, for future routes that need to represent the same failure in the new
 * shape:
 *   unauthenticated        -> AUTHENTICATION_FAILED
 *   invalid_token           -> AUTHENTICATION_FAILED
 *   auth_unavailable        -> PROVIDER_UNAVAILABLE
 *   organization_unresolved -> TENANT_NOT_FOUND
 *   no_organization         -> TENANT_NOT_FOUND
 * This mapping is documentation only — requireAuth.ts itself is not modified to use it.
 */

import type { Response } from "express";

export type CanonicalErrorCode =
  | "AUTHENTICATION_FAILED"
  | "AUTHORIZATION_DENIED"
  | "TENANT_NOT_FOUND"
  | "VALIDATION_FAILED"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "TIMEOUT"
  | "DUPLICATE_REQUEST"
  | "POLICY_DENIED"
  | "HUMAN_APPROVAL_REQUIRED"
  | "RESOURCE_NOT_FOUND"
  | "INTERNAL_ERROR";

export interface CanonicalErrorEnvelope {
  error_code: CanonicalErrorCode;
  message: string;
  request_id: string;
  /**
   * Currently always equal to request_id. This repo has no multi-hop call chain today
   * (single Express process, no downstream service calls this ID through), so a
   * distinct correlation_id has no consumer yet — see contract doc Section 15 for the
   * documented reason this is not split into two independently-tracked values in P0.
   */
  correlation_id: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

// Codes considered safe to retry (transient/infrastructure failures) vs. codes that
// represent a request the caller must change before retrying.
const RETRYABLE_CODES: ReadonlySet<CanonicalErrorCode> = new Set([
  "RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "TIMEOUT",
]);

export function sendError(
  res: Response,
  status: number,
  code: CanonicalErrorCode,
  requestId: string,
  message: string,
  details?: Record<string, unknown>,
): void {
  const envelope: CanonicalErrorEnvelope = {
    error_code: code,
    message,
    request_id: requestId,
    correlation_id: requestId,
    retryable: RETRYABLE_CODES.has(code),
    ...(details ? { details } : {}),
  };
  res.status(status).json(envelope);
}
