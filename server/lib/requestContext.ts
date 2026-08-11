/**
 * Request/correlation ID resolution.
 *
 * Wraps `newRequestId()` (server/audit.ts) rather than duplicating it — see
 * docs/architecture/BELL24H_OS_VYAPARSETHU_SDK_API_CONTRACT_V1.md Section 04.
 *
 * Accepts an inbound `X-Request-Id` header so a calling system (e.g. a future
 * VyaparSethu integration) can propagate its own trace ID through Bell24h-OS and
 * correlate logs across systems. Falls back to generating a fresh ID — via the
 * existing `newRequestId()` — when the header is absent, empty, or malformed. This
 * preserves prior behavior for every caller that does not send the header, including
 * `requireAuth.ts`'s own callers today.
 */

import type { Request, Response } from "express";
import { newRequestId } from "../audit";

const REQUEST_ID_HEADER = "x-request-id";

// Conservative allow-list matching newRequestId()'s own generated shape
// (`req_<base36>_<base36>`). Anything outside this pattern is treated as absent rather
// than sanitized, so an inbound value never reaches logs or responses unvalidated.
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;

/**
 * Resolves the request ID for the current request: reuses a valid inbound
 * `X-Request-Id` header if present, otherwise generates one. Echoes the resolved value
 * back on the response so the caller can correlate even when it didn't supply one.
 */
export function resolveRequestId(req: Request, res: Response): string {
  const inbound = req.headers[REQUEST_ID_HEADER];
  const candidate = Array.isArray(inbound) ? inbound[0] : inbound;
  const requestId = candidate && REQUEST_ID_PATTERN.test(candidate) ? candidate : newRequestId();

  res.setHeader("X-Request-Id", requestId);
  return requestId;
}
