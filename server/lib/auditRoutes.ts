/**
 * Audit log API (Phase 2, item 9). ADMIN only, organization-scoped; the caller's organization comes from their
 * verified session, never from the request.
 *
 *   GET /api/audit/events   filters: action (prefix), outcome, targetType, targetId, actor, since, until, limit, offset
 *   GET /api/audit/status   is durable persistence working? (sink counters, database reachability, 24h summary)
 *
 * The status endpoint is deliberately blunt: `persistence.state` is "healthy" ONLY when the table is reachable AND the
 * sink has written at least one row without failure since start; otherwise "table_missing" / "failing" /
 * "no_events_yet" / "not_configured". It never reports healthy on the absence of errors.
 */

import type { Express, Request, RequestHandler, Response } from "express";
import type pg from "pg";
import { emitAuditEvent } from "../audit.js";
import type { AuthedRequest } from "../middleware/requireAuth.js";
import { requireAnyRole } from "../communication/rbac.js";
import { AuditQueryError, auditSummary, getAuditSinkStats, parseAuditQuery, queryAuditEvents } from "./auditStore.js";

export interface AuditRouteDeps {
  getPool: () => pg.Pool;
  authenticate: RequestHandler;
}

const isMissingRelation = (err: unknown) => (err as { code?: string })?.code === "42P01" || /relation .*audit_events.* does not exist/i.test(String((err as Error)?.message));

export function registerAuditRoutes(app: Express, deps: AuditRouteDeps): void {
  const admin = requireAnyRole(deps.getPool, ["ADMIN"], "audit.read");

  app.get("/api/audit/events", deps.authenticate, admin, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    let q;
    try {
      q = parseAuditQuery(req.query as Record<string, unknown>);
    } catch (err) {
      if (err instanceof AuditQueryError) return void res.status(400).json({ error: "validation_error", field: err.field, detail: err.message, requestId });
      throw err;
    }
    try {
      const result = await queryAuditEvents(deps.getPool(), auth!.organizationId, q);
      emitAuditEvent({
        actor: auth!.userId,
        organizationId: auth!.organizationId,
        action: "audit.events.read",
        targetType: "audit_events",
        targetId: "query",
        outcome: "success",
        requestId: requestId ?? "unknown",
        metadata: { filters: Object.keys(q).filter((k) => (q as Record<string, unknown>)[k] !== undefined && k !== "limit" && k !== "offset"), returned: result.events.length },
      });
      res.json(result);
    } catch (err) {
      if (isMissingRelation(err)) {
        return void res.status(503).json({ error: "audit_table_missing", detail: "public.audit_events does not exist. Apply add_audit_log.sql.", requestId });
      }
      console.error("[Audit] query failed:", (err as Error)?.message);
      res.status(500).json({ error: "internal_error", requestId });
    }
  });

  app.get("/api/audit/status", deps.authenticate, admin, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    const sink = getAuditSinkStats();
    const configured = Boolean(process.env.DATABASE_URL);
    let table: "present" | "missing" | "unreachable" = "present";
    let summary: Awaited<ReturnType<typeof auditSummary>> | null = null;
    try {
      summary = await auditSummary(deps.getPool(), auth!.organizationId);
    } catch (err) {
      table = isMissingRelation(err) ? "missing" : "unreachable";
    }
    let state: "healthy" | "not_configured" | "table_missing" | "database_unreachable" | "failing" | "no_events_yet";
    if (!configured) state = "not_configured";
    else if (table === "missing") state = "table_missing";
    else if (table === "unreachable") state = "database_unreachable";
    else if (sink.failed > 0 && sink.written === 0) state = "failing";
    else if (sink.written === 0) state = "no_events_yet";
    else state = "healthy";
    res.json({
      persistence: { state, sink, table, databaseConfigured: configured },
      summary,
      note: "stdout JSON is always emitted as well; the durable sink is best-effort and its failures are counted, not hidden.",
      requestId,
    });
  });
}
