/**
 * AI Router operator/diagnostic auth guard.
 *
 * Gates the five /api/v1/ai-router/* operator endpoints (dashboard,
 * circuit-breaker read/reset, live route-test, telemetry). Three paths:
 *
 *   1. A trusted service-to-service caller (e.g. VyaparSethu), via a shared
 *      bearer token -- not a user identity, so the ADMIN-role check below
 *      does not apply to it.
 *   2. Dev/test convenience: no Authorization header at all, strictly gated
 *      to NODE_ENV !== "production". Never reachable in production.
 *   3. A real authenticated user: verify identity via `authenticate`
 *      (requireAuth in production), THEN require the ADMIN role before
 *      granting operator access.
 *
 * Previously, path 3 called next() right after authentication alone -- any
 * authenticated user of any organization could reach every AI Router
 * operator endpoint. This reuses the same requireAnyRole gate already used
 * for the admin DB diagnostics routes (server.ts /api/check-table,
 * /api/check-users-count) -- no second role-resolution mechanism.
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

export interface RequireOperatorAuthDeps {
  getPool: () => pg.Pool;
  /** requireAuth in production; tests inject a stub that sets req.auth. */
  authenticate?: RequestHandler;
}

export function createRequireOperatorAuth(deps: RequireOperatorAuthDeps): RequestHandler {
  const authenticate = deps.authenticate ?? requireAuth;

  return async function requireOperatorAuth(req: Request, res: Response, next: NextFunction) {
    const header = req.headers.authorization;
    const serviceToken = process.env.BELL24H_VYAPARSETHU_SERVICE_TOKEN;
    if (serviceToken && header === `Bearer ${serviceToken}`) {
      (req as any).requestId = resolveRequestId(req, res);
      return next();
    }

    if (process.env.NODE_ENV !== "production" && !header) {
      (req as any).requestId = resolveRequestId(req, res);
      return next();
    }

    return authenticate(req, res, ((err?: unknown) => {
      if (err) return next(err);
      return requireAnyRole(deps.getPool, ["ADMIN"], "ai_router")(req, res, next);
    }) as NextFunction);
  };
}
