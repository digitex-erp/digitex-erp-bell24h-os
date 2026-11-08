/**
 * AI Router operator/diagnostic auth guard.
 *
 * Gates the five /api/v1/ai-router/* operator endpoints (dashboard,
 * circuit-breaker read/reset, live route-test, telemetry). Two paths:
 *
 *   1. A trusted service-to-service caller (e.g. VyaparSethu), via a shared
 *      bearer token, compared in constant time (see `secureEquals` below) --
 *      not a user identity, so the ADMIN-role check below does not apply
 *      to it.
 *   2. A real authenticated user: verify identity via `authenticate`
 *      (requireAuth in production), THEN require the ADMIN role before
 *      granting operator access.
 *
 * There is no third, unauthenticated path. An earlier version of this guard
 * had a dev/test convenience path that granted access to any request with
 * no Authorization header at all, gated only on NODE_ENV !== "production".
 * That bypass is intentionally removed: it was the only branch in this
 * middleware (or any auth middleware in this codebase) that granted access
 * with zero credential of any kind, and gating it on an environment
 * variable the server's own process reads -- rather than on anything the
 * caller must prove -- made it exactly as strong as that one variable
 * being set correctly everywhere this middleware might run. Local/dev
 * testing that needs operator access should authenticate through the same
 * `authenticate` + ADMIN-role path as production, using a real (test)
 * identity, or through the service-token path -- not an unauthenticated
 * shortcut.
 *
 * Previously (before the ADMIN-role fix landed in PR #6), path 2 called
 * next() right after authentication alone -- any authenticated user of any
 * organization could reach every AI Router operator endpoint. This reuses
 * the same requireAnyRole gate already used for the admin DB diagnostics
 * routes (server.ts /api/check-table, /api/check-users-count) -- no second
 * role-resolution mechanism.
 *
 * Extracted into its own module (mirroring requireAnyRole's own
 * getPool-factory shape) so it is unit-testable without spinning up the
 * full server.ts createApp() / a real database connection.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type pg from "pg";
import { requireAuth } from "./requireAuth.js";
import { requireAnyRole } from "../communication/rbac.js";
import { resolveRequestId } from "../lib/requestContext.js";
import { secureEquals } from "./requireServiceAuth.js";

export interface RequireOperatorAuthDeps {
  getPool: () => pg.Pool;
  /** requireAuth in production; tests inject a stub that sets req.auth. */
  authenticate?: RequestHandler;
}

export function createRequireOperatorAuth(deps: RequireOperatorAuthDeps): RequestHandler {
  const authenticate = deps.authenticate ?? requireAuth;

  return async function requireOperatorAuth(req: Request, res: Response, next: NextFunction) {
    // Express can hand back a string[] for a repeated header; normalize to
    // the first value, same convention requireServiceAuth.ts uses for its
    // own header. A missing header is left as undefined, not "" -- an
    // empty expected-vs-provided comparison must never accidentally match.
    const headerValue = req.headers.authorization;
    const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    const serviceToken = process.env.BELL24H_VYAPARSETHU_SERVICE_TOKEN;

    // Constant-time comparison via the same secureEquals requireServiceAuth.ts
    // uses -- compares fixed-length SHA-256 digests, so this never throws or
    // leaks timing information regardless of how the provided header's
    // length compares to the expected token's length.
    if (serviceToken && header && secureEquals(header, `Bearer ${serviceToken}`)) {
      (req as any).requestId = resolveRequestId(req, res);
      return next();
    }

    return authenticate(req, res, ((err?: unknown) => {
      if (err) return next(err);
      return requireAnyRole(deps.getPool, ["ADMIN"], "ai_router")(req, res, next);
    }) as NextFunction);
  };
}
