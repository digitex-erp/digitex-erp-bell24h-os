/**
 * Communication Hub HTTP routes — extracted from server.ts in Sprint C0 so they
 * can be mounted on a bare Express app in tests without booting the whole
 * server. Behavior contract for every route:
 *
 *   requireAuth (identity + org)  ->  requirePermission (role)  ->  rateLimit  ->  handler
 *
 * Role is checked BEFORE the rate limit on purpose: the limiter is keyed per
 * organization, so a low-privilege member must not be able to burn the org's
 * send budget with requests that would be rejected anyway.
 *
 * organizationId always comes from the verified token (req.auth), never from
 * the request. Internal error text is never returned to the caller; it is
 * logged server-side and the caller gets a stable error code + requestId.
 */

import type { Express, Request, RequestHandler, Response } from "express";
import type pg from "pg";
import { rateLimit } from "../middleware/rateLimit.js";
import type { AuthedRequest } from "../middleware/requireAuth.js";
import {
  CommunicationService,
  IdempotencyKeyReuseError,
  InvalidStateTransitionError,
  MessageNotFoundError,
  QuotaExceededError,
} from "./CommunicationService.js";
import { requirePermission } from "./rbac.js";
import {
  CommunicationValidationError,
  SENDABLE_CHANNELS,
  validateBody,
  validateChannel,
  validateIdempotencyKey,
  validateSubject,
} from "./validation.js";

export interface CommunicationRouteDeps {
  getPool: () => pg.Pool;
  /** requireAuth in production; tests inject a stub that sets req.auth. */
  authenticate: RequestHandler;
  /** Per-organization requests/minute. Overridable for tests; defaults come from env. */
  limits?: { send?: number; retry?: number; write?: number };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MESSAGE_STATUSES = ["queued", "scheduled", "sending", "sent", "delivered", "failed", "cancelled", "dead_letter"];

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Maps a thrown error to a response. Only known, caller-actionable errors expose a message. */
function sendError(res: Response, err: unknown, requestId: string | undefined, label: string): void {
  if (err instanceof CommunicationValidationError) {
    res.status(400).json({ error: "validation_failed", detail: err.message, requestId });
    return;
  }
  if (err instanceof QuotaExceededError) {
    res.setHeader("Retry-After", "3600");
    res.status(429).json({ error: "quota_exceeded", detail: err.message, requestId });
    return;
  }
  if (err instanceof IdempotencyKeyReuseError) {
    res.status(422).json({ error: "idempotency_key_reuse", detail: err.message, requestId });
    return;
  }
  if (err instanceof MessageNotFoundError) {
    res.status(404).json({ error: "not_found", requestId });
    return;
  }
  if (err instanceof InvalidStateTransitionError) {
    res.status(409).json({ error: "invalid_state", detail: err.message, requestId });
    return;
  }
  console.error(`[Runtime] Communication ${label} error:`, (err as Error)?.message);
  res.status(500).json({ error: "internal_error", requestId });
}

export function registerCommunicationRoutes(app: Express, deps: CommunicationRouteDeps): void {
  const { getPool, authenticate } = deps;
  const service = () => new CommunicationService(getPool());

  const sendLimiter = rateLimit({
    name: "comm-send",
    limit: deps.limits?.send ?? envInt("COMM_SEND_RATE_LIMIT_PER_MINUTE", 20),
    windowMs: 60_000,
  });
  const retryLimiter = rateLimit({
    name: "comm-retry",
    limit: deps.limits?.retry ?? envInt("COMM_RETRY_RATE_LIMIT_PER_MINUTE", 10),
    windowMs: 60_000,
  });
  const writeLimiter = rateLimit({
    name: "comm-write",
    limit: deps.limits?.write ?? envInt("COMM_WRITE_RATE_LIMIT_PER_MINUTE", 30),
    windowMs: 60_000,
  });

  const canSend = requirePermission(getPool, "send");
  const canWrite = requirePermission(getPool, "write");
  const canRead = requirePermission(getPool, "read");

  // ---- POST /api/communications/send ---------------------------------------------------------
  app.post("/api/communications/send", authenticate, canSend, sendLimiter, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    const body = req.body ?? {};
    try {
      // Required, not optional: without it a client retry (timeout, double click) sends twice.
      const rawKey = req.header("Idempotency-Key");
      if (!rawKey) {
        throw new CommunicationValidationError("Idempotency-Key", "header is required on send");
      }
      const idempotencyKey = validateIdempotencyKey(rawKey);
      const channelType = validateChannel(body.channelType);
      if (typeof body.recipient !== "string") throw new CommunicationValidationError("recipient", "is required");
      if (!body.templateId && !body.body) {
        throw new CommunicationValidationError("body", "either templateId or body is required");
      }
      if (body.templateId !== undefined && (typeof body.templateId !== "string" || !UUID_RE.test(body.templateId))) {
        throw new CommunicationValidationError("templateId", "must be a UUID");
      }
      if (body.campaignId !== undefined && (typeof body.campaignId !== "string" || !UUID_RE.test(body.campaignId))) {
        throw new CommunicationValidationError("campaignId", "must be a UUID");
      }
      if (body.variables !== undefined && !isPlainObject(body.variables)) {
        throw new CommunicationValidationError("variables", "must be an object");
      }

      const message = await service().sendMessage({
        organizationId: auth!.organizationId,
        channelType,
        recipient: body.recipient,
        templateId: body.templateId,
        subject: body.subject,
        body: body.body,
        variables: body.variables,
        campaignId: body.campaignId,
        createdBy: auth!.userId,
        idempotencyKey,
      });

      if (message.deduplicated) {
        res.setHeader("Idempotent-Replay", "true");
        res.status(200).json({ success: true, deduplicated: true, message });
        return;
      }
      res.status(201).json({ success: true, deduplicated: false, message });
    } catch (err) {
      sendError(res, err, requestId, "send");
    }
  });

  // ---- GET /api/communications/templates -----------------------------------------------------
  app.get("/api/communications/templates", authenticate, canRead, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      const channelType = req.query.channelType;
      if (channelType !== undefined) validateChannel(channelType);
      const result = channelType
        ? await getPool().query(
            `SELECT * FROM public.communication_templates WHERE organization_id = $1 AND channel_type = $2 ORDER BY created_at DESC`,
            [auth!.organizationId, channelType],
          )
        : await getPool().query(
            `SELECT * FROM public.communication_templates WHERE organization_id = $1 ORDER BY created_at DESC`,
            [auth!.organizationId],
          );
      res.json({ templates: result.rows });
    } catch (err) {
      sendError(res, err, requestId, "templates list");
    }
  });

  // ---- POST /api/communications/templates ----------------------------------------------------
  app.post("/api/communications/templates", authenticate, canWrite, writeLimiter, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    const b = req.body ?? {};
    try {
      if (typeof b.name !== "string" || b.name.trim() === "" || b.name.length > 200) {
        throw new CommunicationValidationError("name", "is required (max 200 characters)");
      }
      const channelType = validateChannel(b.channelType);
      const subject = validateSubject(b.subject);
      const templateBody = validateBody(b.body);
      const variables = b.variables ?? [];
      if (!Array.isArray(variables) || variables.some((v) => typeof v !== "string" || !/^\w{1,64}$/.test(v))) {
        throw new CommunicationValidationError("variables", "must be an array of variable names ([A-Za-z0-9_])");
      }

      const result = await getPool().query(
        `INSERT INTO public.communication_templates (organization_id, name, channel_type, subject, body, variables, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [auth!.organizationId, b.name, channelType, subject, templateBody, JSON.stringify(variables), auth!.userId],
      );
      res.status(201).json({ success: true, template: result.rows[0] });
    } catch (err) {
      sendError(res, err, requestId, "template create");
    }
  });

  // ---- GET /api/communications/history -------------------------------------------------------
  app.get("/api/communications/history", authenticate, canRead, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      const { status, channelType } = req.query;
      const lim = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);
      const off = Math.max(parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);

      const conditions = ["organization_id = $1"];
      const params: unknown[] = [auth!.organizationId];
      if (status !== undefined) {
        if (typeof status !== "string" || !MESSAGE_STATUSES.includes(status)) {
          throw new CommunicationValidationError("status", `must be one of: ${MESSAGE_STATUSES.join(", ")}`);
        }
        params.push(status);
        conditions.push(`status = $${params.length}`);
      }
      if (channelType !== undefined) {
        params.push(validateChannel(channelType));
        conditions.push(`channel_type = $${params.length}`);
      }
      params.push(lim, off);
      const result = await getPool().query(
        `SELECT * FROM public.communication_messages WHERE ${conditions.join(" AND ")}
         ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      res.json({ messages: result.rows, limit: lim, offset: off });
    } catch (err) {
      sendError(res, err, requestId, "history");
    }
  });

  // ---- GET /api/communications/status/:id ----------------------------------------------------
  app.get("/api/communications/status/:id", authenticate, canRead, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      if (!UUID_RE.test(req.params.id)) throw new MessageNotFoundError(req.params.id);
      const message = await service().getMessageStatus(auth!.organizationId, req.params.id);
      if (!message) throw new MessageNotFoundError(req.params.id);
      res.json({ message });
    } catch (err) {
      sendError(res, err, requestId, "status");
    }
  });

  // ---- POST /api/communications/retry/:id ----------------------------------------------------
  app.post("/api/communications/retry/:id", authenticate, canSend, retryLimiter, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      if (!UUID_RE.test(req.params.id)) throw new MessageNotFoundError(req.params.id);
      const message = await service().retryFailedMessage(auth!.organizationId, req.params.id, auth!.userId);
      res.json({ success: true, message });
    } catch (err) {
      sendError(res, err, requestId, "retry");
    }
  });
}

/** Exposed for the report / tests. */
export const APPROVED_CHANNELS = SENDABLE_CHANNELS;
