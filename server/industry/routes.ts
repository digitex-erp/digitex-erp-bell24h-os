/**
 * Industry Intelligence API (Phase 2, item 3). requireAuth -> role check -> (rate limit) -> handler.
 *
 *   read   (ADMIN|MANAGER|EDITOR|VIEWER)  GET  /api/industry/overview, /industries/:id/categories, /signals, /opportunities, /trends
 *   write  (ADMIN|MANAGER|EDITOR)         POST /api/industry/industries, /industries/:id/categories, /signals ; PATCH /signals/:id
 *   delete (ADMIN|MANAGER)                DELETE /api/industry/industries/:id, /signals/:id
 *
 * The organization always comes from the verified session. Every write is audited (counts and enum values only —
 * never titles, summaries or URLs).
 */

import type { Express, Request, RequestHandler, Response } from "express";
import type pg from "pg";
import { emitAuditEvent } from "../audit.js";
import type { AuthedRequest } from "../middleware/requireAuth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { CommunicationValidationError } from "../communication/validation.js";
import { requireAnyRole, requirePermission } from "../communication/rbac.js";
import { IndustryNotFoundError, IndustryService, IndustryTablesMissingError } from "./IndustryService.js";

export interface IndustryRouteDeps {
  getPool: () => pg.Pool;
  authenticate: RequestHandler;
  limits?: { write?: number };
}

function sendError(res: Response, err: unknown, requestId: string | undefined, label: string): void {
  if (err instanceof CommunicationValidationError) return void res.status(400).json({ error: "validation_failed", detail: err.message, requestId });
  if (err instanceof IndustryNotFoundError) return void res.status(404).json({ error: "not_found", requestId });
  if (err instanceof IndustryTablesMissingError) return void res.status(503).json({ error: err.code, detail: err.message, requestId });
  console.error(`[Industry] ${label} failed:`, (err as Error)?.message);
  res.status(500).json({ error: "internal_error", requestId });
}

export function registerIndustryRoutes(app: Express, deps: IndustryRouteDeps): void {
  const svc = () => new IndustryService(deps.getPool());
  const canRead = requirePermission(deps.getPool, "read");
  const canWrite = requirePermission(deps.getPool, "write");
  const canDelete = requireAnyRole(deps.getPool, ["ADMIN", "MANAGER"], "industry.delete");
  const writeLimiter = rateLimit({ name: "industry-write", limit: deps.limits?.write ?? 30, windowMs: 60_000 }) as unknown as RequestHandler;

  const audit = (req: Request, action: string, targetType: string, targetId: string, metadata?: Record<string, unknown>) => {
    const { auth, requestId } = req as AuthedRequest;
    emitAuditEvent({ actor: auth!.userId, organizationId: auth!.organizationId, action, targetType, targetId, outcome: "success", requestId: requestId ?? "unknown", metadata });
  };
  const page = (req: Request) => ({ limit: req.query.limit !== undefined ? Number(req.query.limit) : undefined, offset: req.query.offset !== undefined ? Number(req.query.offset) : undefined });

  app.get("/api/industry/overview", deps.authenticate, canRead, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      res.json(await svc().overview(auth!.organizationId));
    } catch (err) {
      sendError(res, err, requestId, "overview");
    }
  });

  app.post("/api/industry/industries", deps.authenticate, canWrite, writeLimiter, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      const industry = await svc().createIndustry(auth!.organizationId, req.body ?? {});
      audit(req, "industry.created", "industry", industry.id);
      res.status(201).json({ success: true, industry });
    } catch (err) {
      sendError(res, err, requestId, "create industry");
    }
  });

  app.delete("/api/industry/industries/:id", deps.authenticate, canDelete, writeLimiter, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      await svc().deleteIndustry(auth!.organizationId, req.params.id);
      audit(req, "industry.deleted", "industry", req.params.id);
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, requestId, "delete industry");
    }
  });

  app.get("/api/industry/industries/:id/categories", deps.authenticate, canRead, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      res.json(await svc().listCategories(auth!.organizationId, req.params.id));
    } catch (err) {
      sendError(res, err, requestId, "list categories");
    }
  });

  app.post("/api/industry/industries/:id/categories", deps.authenticate, canWrite, writeLimiter, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      const category = await svc().createCategory(auth!.organizationId, req.params.id, req.body ?? {});
      audit(req, "industry.category.created", "industry_category", category.id);
      res.status(201).json({ success: true, category });
    } catch (err) {
      sendError(res, err, requestId, "create category");
    }
  });

  app.get("/api/industry/signals", deps.authenticate, canRead, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      res.json(await svc().listSignals(auth!.organizationId, { industryId: req.query.industryId, signalType: req.query.signalType, sourceType: req.query.sourceType, ...page(req) }));
    } catch (err) {
      sendError(res, err, requestId, "list signals");
    }
  });

  app.get("/api/industry/opportunities", deps.authenticate, canRead, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      res.json(await svc().listSignals(auth!.organizationId, { industryId: req.query.industryId, opportunitiesOnly: true, ...page(req) }));
    } catch (err) {
      sendError(res, err, requestId, "list opportunities");
    }
  });

  app.post("/api/industry/signals", deps.authenticate, canWrite, writeLimiter, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      const signal = await svc().createSignal(auth!.organizationId, auth!.userId, req.body ?? {});
      audit(req, "industry.signal.created", "industry_signal", signal.id, { signalType: signal.signal_type, sourceType: signal.source_type, opportunity: signal.is_rfq_opportunity });
      res.status(201).json({ success: true, signal });
    } catch (err) {
      sendError(res, err, requestId, "create signal");
    }
  });

  app.patch("/api/industry/signals/:id", deps.authenticate, canWrite, writeLimiter, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      const signal = await svc().setOpportunity(auth!.organizationId, req.params.id, req.body ?? {});
      audit(req, "industry.signal.opportunity_updated", "industry_signal", signal.id, { opportunity: signal.is_rfq_opportunity });
      res.json({ success: true, signal });
    } catch (err) {
      sendError(res, err, requestId, "update signal");
    }
  });

  app.delete("/api/industry/signals/:id", deps.authenticate, canDelete, writeLimiter, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      await svc().deleteSignal(auth!.organizationId, req.params.id);
      audit(req, "industry.signal.deleted", "industry_signal", req.params.id);
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, requestId, "delete signal");
    }
  });

  app.get("/api/industry/trends", deps.authenticate, canRead, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      res.json(await svc().trends(auth!.organizationId, req.query.weeks));
    } catch (err) {
      sendError(res, err, requestId, "trends");
    }
  });
}
