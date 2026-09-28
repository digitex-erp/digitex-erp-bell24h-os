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
import { emitAuditEvent } from "../audit.js";
import {
  CommunicationService,
  IdempotencyKeyReuseError,
  InvalidStateTransitionError,
  MessageNotFoundError,
  QuotaExceededError,
} from "./CommunicationService.js";
import { AnalyticsService } from "./AnalyticsService.js";
import { AudienceNotFoundError, AudienceService } from "./AudienceService.js";
import { CampaignNotFoundError, CampaignService, CampaignStateError } from "./CampaignService.js";
import { SuppressedRecipientError, SuppressionNotFoundError, SuppressionService } from "./SuppressionService.js";
import { TemplateInUseError, TemplateNotFoundError, TemplateService } from "./TemplateService.js";
import { getUnsubscribeConfig, verifyUnsubscribeToken } from "./unsubscribe.js";
import { DashboardService } from "./DashboardService.js";
import { ProviderAdminService, ProviderNotFoundError } from "./ProviderAdminService.js";
import { requirePermission } from "./rbac.js";
import { extractStatuses, ingestWhatsAppStatuses, verifyHandshake, verifySignature } from "./whatsappWebhook.js";
import {
  CommunicationValidationError,
  SENDABLE_CHANNELS,
  validateBody,
  validateChannel,
  validateIdempotencyKey,
  validateSubject,
  validateUuid,
} from "./validation.js";

export interface CommunicationRouteDeps {
  getPool: () => pg.Pool;
  /** requireAuth in production; tests inject a stub that sets req.auth. */
  authenticate: RequestHandler;
  /** Per-organization requests/minute. Overridable for tests; defaults come from env. */
  limits?: { send?: number; retry?: number; write?: number; campaign?: number; health?: number };
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
  if (err instanceof SuppressedRecipientError) {
    res.status(422).json({ error: "recipient_suppressed", detail: err.message, requestId });
    return;
  }
  if (err instanceof TemplateInUseError) {
    res.status(409).json({ error: "template_in_use", detail: err.message, requestId });
    return;
  }
  if (err instanceof CampaignNotFoundError || err instanceof ProviderNotFoundError || err instanceof AudienceNotFoundError || err instanceof SuppressionNotFoundError || err instanceof TemplateNotFoundError) {
    res.status(404).json({ error: "not_found", requestId });
    return;
  }
  if (err instanceof CampaignStateError) {
    res.status(409).json({ error: err.code, detail: err.message, requestId });
    return;
  }
  if (err instanceof InvalidStateTransitionError) {
    res.status(409).json({ error: "invalid_state", detail: err.message, requestId });
    return;
  }
  console.error(`[Runtime] Communication ${label} error:`, (err as Error)?.message);
  res.status(500).json({ error: "internal_error", requestId });
}

/**
 * Every send attempt leaves an audit event: accepted ones are emitted by CommunicationService / the worker,
 * REFUSED ones (validation, quota, key reuse, state) here. Metadata carries the reason code only — never the
 * recipient, subject or body.
 */
function auditRejectedSend(actor: string, organizationId: string, requestId: string | undefined, err: unknown, via: string): void {
  const code =
    err instanceof CommunicationValidationError
      ? "validation_failed"
      : err instanceof QuotaExceededError
        ? "quota_exceeded"
        : err instanceof SuppressedRecipientError
          ? "recipient_suppressed"
          : err instanceof IdempotencyKeyReuseError
          ? "idempotency_key_reuse"
          : err instanceof CampaignStateError
            ? err.code
            : err instanceof CampaignNotFoundError
              ? "not_found"
              : "internal_error";
  emitAuditEvent({
    actor,
    organizationId,
    action: "communication.message.rejected",
    targetType: "communication_message",
    targetId: "none",
    outcome: code === "internal_error" ? "failure" : "denied",
    requestId: requestId ?? "unknown",
    metadata: { code, via },
  });
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
      // Campaign messages are created only by the campaign flow (which owns counters and consent).
      if (body.campaignId !== undefined) {
        throw new CommunicationValidationError("campaignId", "is not accepted here; use the campaign flow");
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
      auditRejectedSend(auth!.userId, auth!.organizationId, requestId, err, "send");
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

  // =============================================================================================
  // Sprint CH-02: leads, campaigns, logs, providers, WhatsApp webhook
  // Permission map: read = view; write = create a DRAFT campaign; send = anything that can cause an
  // outbound message (test, schedule, execute, cancel) or exposes provider operations; manage = ADMIN only.
  // =============================================================================================
  const campaigns = () => new CampaignService(getPool());
  const campaignLimiter = rateLimit({
    name: "comm-campaign",
    limit: deps.limits?.campaign ?? envInt("COMM_CAMPAIGN_RATE_LIMIT_PER_MINUTE", 10),
    windowMs: 60_000,
  });
  const healthLimiter = rateLimit({
    name: "comm-health",
    limit: deps.limits?.health ?? envInt("COMM_HEALTH_RATE_LIMIT_PER_MINUTE", 6),
    windowMs: 60_000,
  });
  const canManage = requirePermission(getPool, "manage");
  const pageParams = (req: Request) => ({
    limit: Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200),
    offset: Math.max(parseInt(String(req.query.offset ?? "0"), 10) || 0, 0),
  });

  // ---- GET /api/communications/leads ---------------------------------------------------------
  app.get("/api/communications/leads", authenticate, canRead, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      const q = req.query.q;
      if (q !== undefined && typeof q !== "string") throw new CommunicationValidationError("q", "must be a string");
      res.json(await campaigns().listLeads(auth!.organizationId, { channelType: req.query.channelType, q, ...pageParams(req) }));
    } catch (err) {
      sendError(res, err, requestId, "leads");
    }
  });

  // ---- campaigns -----------------------------------------------------------------------------
  app.post("/api/communications/campaigns", authenticate, canWrite, writeLimiter, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    const b = req.body ?? {};
    try {
      const result = await campaigns().createCampaign({
        organizationId: auth!.organizationId,
        createdBy: auth!.userId,
        name: b.name,
        channelType: b.channelType,
        templateId: b.templateId,
        contactIds: b.contactIds,
        listId: b.listId,
        segmentId: b.segmentId,
        variables: b.variables,
        consentConfirmed: b.consentConfirmed,
      });
      res.status(201).json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, requestId, "campaign create");
    }
  });

  app.get("/api/communications/campaigns", authenticate, canRead, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      res.json(await campaigns().listCampaigns(auth!.organizationId, { status: req.query.status, ...pageParams(req) }));
    } catch (err) {
      sendError(res, err, requestId, "campaign list");
    }
  });

  app.get("/api/communications/campaigns/:id", authenticate, canRead, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      if (!UUID_RE.test(req.params.id)) throw new CampaignNotFoundError();
      res.json(await campaigns().getCampaign(auth!.organizationId, req.params.id));
    } catch (err) {
      sendError(res, err, requestId, "campaign get");
    }
  });

  app.get("/api/communications/campaigns/:id/recipients", authenticate, canRead, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      if (!UUID_RE.test(req.params.id)) throw new CampaignNotFoundError();
      res.json(await campaigns().listRecipients(auth!.organizationId, req.params.id, { status: req.query.status, ...pageParams(req) }));
    } catch (err) {
      sendError(res, err, requestId, "campaign recipients");
    }
  });

  app.post("/api/communications/campaigns/:id/test", authenticate, canSend, campaignLimiter, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      if (!UUID_RE.test(req.params.id)) throw new CampaignNotFoundError();
      const rawKey = req.header("Idempotency-Key");
      if (!rawKey) throw new CommunicationValidationError("Idempotency-Key", "header is required on test send");
      const key = validateIdempotencyKey(rawKey);
      const message = await campaigns().sendTest(auth!.organizationId, auth!.userId, req.params.id, req.body?.testRecipient, key);
      if (message.deduplicated) res.setHeader("Idempotent-Replay", "true");
      res.status(message.deduplicated ? 200 : 202).json({ success: true, deduplicated: message.deduplicated, message });
    } catch (err) {
      auditRejectedSend(auth!.userId, auth!.organizationId, requestId, err, "campaign_test");
      sendError(res, err, requestId, "campaign test");
    }
  });

  app.post("/api/communications/campaigns/:id/schedule", authenticate, canSend, campaignLimiter, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      if (!UUID_RE.test(req.params.id)) throw new CampaignNotFoundError();
      res.json({ success: true, campaign: await campaigns().schedule(auth!.organizationId, auth!.userId, req.params.id, req.body?.scheduledAt) });
    } catch (err) {
      sendError(res, err, requestId, "campaign schedule");
    }
  });

  app.post("/api/communications/campaigns/:id/execute", authenticate, canSend, campaignLimiter, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      if (!UUID_RE.test(req.params.id)) throw new CampaignNotFoundError();
      res.status(202).json({ success: true, campaign: await campaigns().execute(auth!.organizationId, auth!.userId, req.params.id) });
    } catch (err) {
      sendError(res, err, requestId, "campaign execute");
    }
  });

  app.post("/api/communications/campaigns/:id/cancel", authenticate, canSend, campaignLimiter, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      if (!UUID_RE.test(req.params.id)) throw new CampaignNotFoundError();
      res.json({ success: true, campaign: await campaigns().cancel(auth!.organizationId, auth!.userId, req.params.id) });
    } catch (err) {
      sendError(res, err, requestId, "campaign cancel");
    }
  });

  // ---- dashboard / schedules (counts of real rows only) ---------------------------------------------
  app.get("/api/communications/dashboard", authenticate, canRead, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      res.json(await new DashboardService(getPool()).getDashboard(auth!.organizationId));
    } catch (err) {
      sendError(res, err, requestId, "dashboard");
    }
  });

  app.get("/api/communications/schedules", authenticate, canRead, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      res.json(await new DashboardService(getPool()).getSchedules(auth!.organizationId));
    } catch (err) {
      sendError(res, err, requestId, "schedules");
    }
  });

  // ---- logs (read-only view over messages + delivery attempts) ------------------------------------
  app.get("/api/communications/logs", authenticate, canRead, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      const { campaignId, status, channelType, includeTests } = req.query;
      const { limit, offset } = pageParams(req);
      const conditions = ["organization_id = $1"];
      const params: unknown[] = [auth!.organizationId];
      if (campaignId !== undefined) {
        params.push(validateUuid(campaignId, "campaignId"));
        conditions.push(`campaign_id = $${params.length}`);
      }
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
      if (includeTests !== "true") conditions.push("NOT is_test");
      params.push(limit, offset);
      const result = await getPool().query(
        `SELECT * FROM public.communication_logs WHERE ${conditions.join(" AND ")}
          ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      res.json({ logs: result.rows, limit, offset });
    } catch (err) {
      sendError(res, err, requestId, "logs");
    }
  });

  app.get("/api/communications/logs/:messageId/attempts", authenticate, canRead, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      if (!UUID_RE.test(req.params.messageId)) throw new MessageNotFoundError(req.params.messageId);
      const msg = await getPool().query(`SELECT id FROM public.communication_messages WHERE id = $1 AND organization_id = $2`, [
        req.params.messageId,
        auth!.organizationId,
      ]);
      if (msg.rows.length === 0) throw new MessageNotFoundError(req.params.messageId);
      // raw_response is deliberately not returned: provider payloads can echo request details.
      const attempts = await getPool().query(
        `SELECT attempt_number, provider, status, error_message, attempted_at
           FROM public.communication_deliveries WHERE message_id = $1 AND organization_id = $2 ORDER BY attempt_number`,
        [req.params.messageId, auth!.organizationId],
      );
      res.json({ attempts: attempts.rows });
    } catch (err) {
      sendError(res, err, requestId, "log attempts");
    }
  });

  // ---- providers (read-only + health check) -----------------------------------------------------------
  app.get("/api/communications/providers", authenticate, canSend, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      res.json({ providers: await new ProviderAdminService(getPool()).list(auth!.organizationId) });
    } catch (err) {
      sendError(res, err, requestId, "providers");
    }
  });

  app.post("/api/communications/providers/:id/health-check", authenticate, canManage, healthLimiter, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      if (!UUID_RE.test(req.params.id)) throw new ProviderNotFoundError();
      res.json(await new ProviderAdminService(getPool()).runHealthCheck(auth!.organizationId, auth!.userId, req.params.id));
    } catch (err) {
      sendError(res, err, requestId, "provider health-check");
    }
  });

  // ---- Meta WhatsApp webhook (NOT user-authenticated: authenticated by Meta's HMAC signature) --------------
  app.get("/api/communications/webhooks/meta-whatsapp", (req: Request, res: Response) => {
    const echoed = verifyHandshake(req.query["hub.mode"], req.query["hub.verify_token"], req.query["hub.challenge"]);
    if (echoed === null) {
      res.status(403).send("Forbidden");
      return;
    }
    res.status(200).type("text/plain").send(echoed);
  });

  app.post("/api/communications/webhooks/meta-whatsapp", async (req: Request, res: Response) => {
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    // Fail closed: not configured, missing raw body, or bad signature => nothing is processed.
    if (!verifySignature(raw, req.header("x-hub-signature-256"))) {
      res.status(401).json({ error: "signature_verification_failed" });
      return;
    }
    try {
      const outcome = await ingestWhatsAppStatuses(getPool(), extractStatuses(req.body));
      res.json({ received: true, ...outcome });
    } catch (err) {
      // 5xx so Meta retries; details stay in the server log.
      console.error("[Runtime] WhatsApp webhook ingest error:", (err as Error)?.message);
      res.status(500).json({ error: "internal_error" });
    }
  });

  // =============================================================================================
  // CH-02 audience management: templates (edit), suppressions, unsubscribe, lists, segments, analytics
  // Permissions: read = view; write = create/edit lists, segments, templates and ADD suppressions (all can
  // only reduce or prepare sends); manage (ADMIN) = REMOVE a suppression (re-enables contacting someone).
  // =============================================================================================
  const audience = () => new AudienceService(getPool());
  const suppressions = () => new SuppressionService(getPool());

  // ---- templates: edit / deactivate ------------------------------------------------------------
  app.patch("/api/communications/templates/:id", authenticate, canWrite, writeLimiter, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      if (!UUID_RE.test(req.params.id)) throw new TemplateNotFoundError();
      if (!isPlainObject(req.body)) throw new CommunicationValidationError("body", "must be a JSON object");
      res.json({ success: true, template: await new TemplateService(getPool()).update(auth!.organizationId, auth!.userId, req.params.id, req.body) });
    } catch (err) {
      sendError(res, err, requestId, "template update");
    }
  });

  // ---- suppression list -------------------------------------------------------------------------
  app.get("/api/communications/suppressions", authenticate, canRead, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      res.json(await suppressions().list(auth!.organizationId, { channelType: req.query.channelType, q: req.query.q, reason: req.query.reason, ...pageParams(req) }));
    } catch (err) {
      sendError(res, err, requestId, "suppression list");
    }
  });

  app.post("/api/communications/suppressions", authenticate, canWrite, writeLimiter, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    const b = req.body ?? {};
    try {
      const addresses = b.addresses !== undefined ? b.addresses : b.address !== undefined ? [b.address] : undefined;
      res.status(201).json({ success: true, ...(await suppressions().add(auth!.organizationId, auth!.userId, { channelType: b.channelType, addresses, reason: b.reason, note: b.note })) });
    } catch (err) {
      sendError(res, err, requestId, "suppression add");
    }
  });

  app.delete("/api/communications/suppressions/:id", authenticate, canManage, writeLimiter, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      if (!UUID_RE.test(req.params.id)) throw new SuppressionNotFoundError();
      await suppressions().remove(auth!.organizationId, auth!.userId, req.params.id);
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, requestId, "suppression remove");
    }
  });

  // ---- public one-click unsubscribe (NOT user-authenticated: authorized by a signed token) ----------------
  // GET only renders a confirmation page (mail scanners prefetch links; a GET must never unsubscribe).
  // POST performs it (form button, or RFC 8058 one-click from the mail client).
  const unsubscribePage = (res: Response, status: number, title: string, message: string, form?: { action: string }) => {
    res.status(status);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex");
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'");
    const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
    res.send(
      "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"robots\" content=\"noindex\"><title>" +
        esc(title) +
        "</title><style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5}button{font-size:1rem;padding:.6rem 1.2rem}</style></head><body><h1>" +
        esc(title) +
        "</h1><p>" +
        esc(message) +
        "</p>" +
        (form ? `<form method="post" action="${esc(form.action)}"><button type="submit">Unsubscribe</button></form>` : "") +
        "</body></html>",
    );
  };
  const maskAddress = (a: string) => (a.includes("@") ? `${a.split("@")[0].slice(0, 1)}***@${a.split("@")[1]}` : `${a.slice(0, 3)}***${a.slice(-2)}`);

  app.get("/api/communications/unsubscribe", (req: Request, res: Response) => {
    const cfg = getUnsubscribeConfig();
    if (!cfg) return unsubscribePage(res, 503, "Unavailable", "Unsubscribe is not configured on this server. Please reply to the email instead.");
    const claims = verifyUnsubscribeToken(req.query.t, cfg.secret);
    if (!claims) return unsubscribePage(res, 400, "Invalid link", "This unsubscribe link is not valid.");
    unsubscribePage(res, 200, "Unsubscribe", `Stop receiving ${claims.channel} messages at ${maskAddress(claims.address)}?`, {
      action: `/api/communications/unsubscribe?t=${encodeURIComponent(String(req.query.t))}`,
    });
  });

  app.post("/api/communications/unsubscribe", async (req: Request, res: Response) => {
    const cfg = getUnsubscribeConfig();
    if (!cfg) return unsubscribePage(res, 503, "Unavailable", "Unsubscribe is not configured on this server. Please reply to the email instead.");
    const claims = verifyUnsubscribeToken(req.query.t, cfg.secret);
    if (!claims) return unsubscribePage(res, 400, "Invalid link", "This unsubscribe link is not valid.");
    try {
      await suppressions().addFromUnsubscribe(claims.organizationId, claims.channel, claims.address);
      unsubscribePage(res, 200, "You are unsubscribed", `${maskAddress(claims.address)} will no longer receive these messages.`);
    } catch (err) {
      console.error("[Runtime] Unsubscribe error:", (err as Error)?.message);
      unsubscribePage(res, 500, "Something went wrong", "We could not process your request. Please try again later.");
    }
  });

  // ---- contact lists -----------------------------------------------------------------------------
  app.get("/api/communications/lists", authenticate, canRead, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      res.json(await audience().listLists(auth!.organizationId));
    } catch (err) {
      sendError(res, err, requestId, "lists");
    }
  });
  app.post("/api/communications/lists", authenticate, canWrite, writeLimiter, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      res.status(201).json({ success: true, list: await audience().createList(auth!.organizationId, auth!.userId, { name: req.body?.name, description: req.body?.description }) });
    } catch (err) {
      sendError(res, err, requestId, "list create");
    }
  });
  app.delete("/api/communications/lists/:id", authenticate, canWrite, writeLimiter, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      if (!UUID_RE.test(req.params.id)) throw new AudienceNotFoundError("list");
      await audience().deleteList(auth!.organizationId, req.params.id);
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, requestId, "list delete");
    }
  });
  app.get("/api/communications/lists/:id/members", authenticate, canRead, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      if (!UUID_RE.test(req.params.id)) throw new AudienceNotFoundError("list");
      res.json(await audience().listMembers(auth!.organizationId, req.params.id, pageParams(req)));
    } catch (err) {
      sendError(res, err, requestId, "list members");
    }
  });
  app.post("/api/communications/lists/:id/members", authenticate, canWrite, writeLimiter, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      if (!UUID_RE.test(req.params.id)) throw new AudienceNotFoundError("list");
      res.status(201).json({ success: true, ...(await audience().addMembers(auth!.organizationId, req.params.id, req.body?.contactIds)) });
    } catch (err) {
      sendError(res, err, requestId, "list add members");
    }
  });
  app.delete("/api/communications/lists/:id/members", authenticate, canWrite, writeLimiter, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      if (!UUID_RE.test(req.params.id)) throw new AudienceNotFoundError("list");
      res.json({ success: true, ...(await audience().removeMembers(auth!.organizationId, req.params.id, req.body?.contactIds)) });
    } catch (err) {
      sendError(res, err, requestId, "list remove members");
    }
  });

  // ---- segments ------------------------------------------------------------------------------------
  app.get("/api/communications/segments", authenticate, canRead, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      res.json(await audience().listSegments(auth!.organizationId));
    } catch (err) {
      sendError(res, err, requestId, "segments");
    }
  });
  app.post("/api/communications/segments", authenticate, canWrite, writeLimiter, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      res.status(201).json({ success: true, segment: await audience().createSegment(auth!.organizationId, auth!.userId, { name: req.body?.name, criteria: req.body?.criteria }) });
    } catch (err) {
      sendError(res, err, requestId, "segment create");
    }
  });
  app.post("/api/communications/segments/preview", authenticate, canRead, writeLimiter, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      res.json(await audience().previewSegment(auth!.organizationId, req.body?.channelType, req.body?.criteria));
    } catch (err) {
      sendError(res, err, requestId, "segment preview");
    }
  });
  app.delete("/api/communications/segments/:id", authenticate, canWrite, writeLimiter, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      if (!UUID_RE.test(req.params.id)) throw new AudienceNotFoundError("segment");
      await audience().deleteSegment(auth!.organizationId, req.params.id);
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, requestId, "segment delete");
    }
  });

  // ---- analytics (real rows only) ---------------------------------------------------------------------
  app.get("/api/communications/analytics", authenticate, canRead, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      const days = req.query.days === undefined ? undefined : Number(req.query.days);
      if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 90)) throw new CommunicationValidationError("days", "must be an integer between 1 and 90");
      res.json(await new AnalyticsService(getPool()).getOrganizationAnalytics(auth!.organizationId, days));
    } catch (err) {
      sendError(res, err, requestId, "analytics");
    }
  });
  app.get("/api/communications/campaigns/:id/analytics", authenticate, canRead, async (req: Request, res: Response) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      if (!UUID_RE.test(req.params.id)) throw new CampaignNotFoundError();
      res.json(await new AnalyticsService(getPool()).getCampaignAnalytics(auth!.organizationId, req.params.id));
    } catch (err) {
      sendError(res, err, requestId, "campaign analytics");
    }
  });
}

/** Exposed for the report / tests. */
export const APPROVED_CHANNELS = SENDABLE_CHANNELS;
