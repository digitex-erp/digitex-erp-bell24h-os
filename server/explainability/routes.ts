/**
 * Explainability API — read-only (Phase 2, priority 5). There is deliberately NO endpoint that produces an
 * explanation: no scorer or explainer exists yet, so anything that "explained" a decision would be invented.
 *
 *   GET /api/explainability/status    which (subject, method) pairs have a registered explainer (today: none)
 *   GET /api/explainability/records   stored explanations for the caller's organization (today: none)
 * Both need a role in the organization (read = ADMIN | MANAGER | EDITOR | VIEWER).
 */

import type { Express, Request, RequestHandler, Response } from "express";
import type pg from "pg";
import type { AuthedRequest } from "../middleware/requireAuth.js";
import { CommunicationValidationError } from "../communication/validation.js";
import { requirePermission } from "../communication/rbac.js";
import { explainerRegistry, type ExplainerRegistry } from "./registry.js";
import { ExplanationTableMissingError, listExplanations } from "./store.js";

export interface ExplainabilityRouteDeps {
  getPool: () => pg.Pool;
  authenticate: RequestHandler;
  registry?: ExplainerRegistry;
}

export function registerExplainabilityRoutes(app: Express, deps: ExplainabilityRouteDeps): void {
  const canRead = requirePermission(deps.getPool, "read");
  const registry = deps.registry ?? explainerRegistry;

  app.get("/api/explainability/status", deps.authenticate, canRead, (req: Request, res: Response) => {
    res.json({ ...registry.status(), requestId: (req as AuthedRequest).requestId });
  });

  app.get("/api/explainability/records", deps.authenticate, canRead, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      res.json(await listExplanations(deps.getPool(), auth!.organizationId, req.query));
    } catch (err) {
      if (err instanceof CommunicationValidationError) return void res.status(400).json({ error: "validation_failed", detail: err.message, requestId });
      if (err instanceof ExplanationTableMissingError) return void res.status(503).json({ error: err.code, detail: err.message, requestId });
      console.error("[Explainability] list failed:", (err as Error)?.message);
      res.status(500).json({ error: "internal_error", requestId });
    }
  });
}
