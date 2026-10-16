/**
 * Voice Studio HTTP routes. Mirrors server/communication/routes.ts's
 * contract: requireAuth (identity + org) -> requireVoicePermission (role) ->
 * handler. organizationId/userId always come from the verified token
 * (req.auth), never from the request body or query string.
 *
 * The Dograh webhook is the one unauthenticated-by-session route here (the
 * caller is an external voice server, not a logged-in user) -- it is gated
 * instead by a constant-time secret comparison (see verifyWebhookSecret),
 * and fails closed if that secret is not configured server-side.
 */
import { timingSafeEqual, createHash } from "crypto";
import type { Express, Request, RequestHandler, Response } from "express";
import type pg from "pg";
import type { AuthedRequest } from "../middleware/requireAuth.js";
import { requireVoicePermission } from "./rbac.js";
import {
  VoiceService,
  VoiceNotFoundError,
  VoiceDuplicateDispatchError,
  VoiceScriptNotFoundError,
  VoiceScriptConflictError,
} from "./VoiceService.js";
import { VoiceValidationError } from "./validation.js";
import { isDograhPayload, fromDograhPayload, dograhCaptureContract } from "./voiceDriver.js";

export interface VoiceRouteDeps {
  getPool: () => pg.Pool;
  /** requireAuth in production; tests inject a stub that sets req.auth. */
  authenticate: RequestHandler;
}

function sendError(res: Response, err: unknown, requestId: string | undefined, label: string): void {
  if (err instanceof VoiceValidationError) {
    res.status(400).json({ error: "validation_failed", field: err.field, detail: err.message, requestId });
    return;
  }
  if (err instanceof VoiceDuplicateDispatchError) {
    res.status(409).json({ error: "duplicate_dispatch", detail: err.message, requestId });
    return;
  }
  if (err instanceof VoiceNotFoundError || err instanceof VoiceScriptNotFoundError) {
    res.status(404).json({ error: "not_found", requestId });
    return;
  }
  if (err instanceof VoiceScriptConflictError) {
    res.status(409).json({ error: "conflict", detail: err.message, requestId });
    return;
  }
  // Internal error text is never returned to the caller -- logged
  // server-side, caller gets a stable code + requestId only.
  console.error(`[Runtime] Voice ${label} error:`, (err as Error)?.message);
  res.status(500).json({ error: "internal_error", requestId });
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function secureEquals(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

export function registerVoiceRoutes(app: Express, deps: VoiceRouteDeps): void {
  const { getPool, authenticate } = deps;
  const service = () => new VoiceService(getPool());

  // ── Dograh contract (unauthenticated -- documentation, no data) ─────────
  app.get("/api/voice/dograh/contract", (_req, res) => {
    res.json(dograhCaptureContract());
  });

  // ── Dispatch ─────────────────────────────────────────────────────────────
  app.post(
    "/api/voice/calls/dispatch",
    authenticate,
    requireVoicePermission(getPool, "dispatch"),
    async (req, res) => {
      const { auth, requestId } = req as AuthedRequest;
      try {
        const result = await service().dispatchCall(auth!.organizationId, auth!.userId, requestId ?? "unknown", req.body ?? {});
        res.status(result.created ? 201 : 200).json({ ...result.call, requestId, created: result.created });
      } catch (err) {
        sendError(res, err, (req as AuthedRequest).requestId, "dispatch");
      }
    },
  );

  // ── Calls / history ──────────────────────────────────────────────────────
  app.get("/api/voice/calls", authenticate, requireVoicePermission(getPool, "read"), async (req, res) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      const limit = Number(req.query.limit) || 50;
      const calls = await service().listCalls(auth!.organizationId, limit);
      res.json({ calls, requestId });
    } catch (err) {
      sendError(res, err, (req as AuthedRequest).requestId, "list calls");
    }
  });

  app.get("/api/voice/calls/:ref", authenticate, requireVoicePermission(getPool, "read"), async (req, res) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      const call = await service().getCall(auth!.organizationId, req.params.ref);
      res.json({ ...call, requestId });
    } catch (err) {
      sendError(res, err, (req as AuthedRequest).requestId, "get call");
    }
  });

  // ── Agents (representative builder CRUD) ────────────────────────────────
  app.get("/api/voice/agents", authenticate, requireVoicePermission(getPool, "read"), async (req, res) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      const agents = await service().listAgents(auth!.organizationId);
      res.json({ agents, requestId });
    } catch (err) {
      sendError(res, err, (req as AuthedRequest).requestId, "list agents");
    }
  });

  app.post("/api/voice/agents", authenticate, requireVoicePermission(getPool, "write"), async (req, res) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      const agent = await service().createAgent(auth!.organizationId, auth!.userId, requestId ?? "unknown", req.body ?? {});
      res.status(201).json({ ...agent, requestId });
    } catch (err) {
      sendError(res, err, (req as AuthedRequest).requestId, "create agent");
    }
  });

  // ── Campaigns (representative builder CRUD) ─────────────────────────────
  app.get("/api/voice/campaigns", authenticate, requireVoicePermission(getPool, "read"), async (req, res) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      const campaigns = await service().listCampaigns(auth!.organizationId);
      res.json({ campaigns, requestId });
    } catch (err) {
      sendError(res, err, (req as AuthedRequest).requestId, "list campaigns");
    }
  });

  app.post("/api/voice/campaigns", authenticate, requireVoicePermission(getPool, "write"), async (req, res) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      const campaign = await service().createCampaign(auth!.organizationId, auth!.userId, requestId ?? "unknown", req.body ?? {});
      res.status(201).json({ ...campaign, requestId });
    } catch (err) {
      sendError(res, err, (req as AuthedRequest).requestId, "create campaign");
    }
  });

  // ── Call Scripts ─────────────────────────────────────────────────────────
  //
  // Pure CRUD + draft/publish state machine over voice_scripts /
  // voice_script_versions. No job_queue involvement (nothing async here),
  // no driver involvement (preview never places a call).
  app.get("/api/voice/scripts", authenticate, requireVoicePermission(getPool, "read"), async (req, res) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      const scripts = await service().listScripts(auth!.organizationId);
      res.json({ scripts, requestId });
    } catch (err) {
      sendError(res, err, (req as AuthedRequest).requestId, "list scripts");
    }
  });

  app.get("/api/voice/scripts/:code", authenticate, requireVoicePermission(getPool, "read"), async (req, res) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      const script = await service().getScript(auth!.organizationId, req.params.code);
      res.json({ ...script, requestId });
    } catch (err) {
      sendError(res, err, (req as AuthedRequest).requestId, "get script");
    }
  });

  app.post("/api/voice/scripts", authenticate, requireVoicePermission(getPool, "write"), async (req, res) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      const script = await service().createScript(auth!.organizationId, auth!.userId, requestId ?? "unknown", req.body ?? {});
      res.status(201).json({ ...script, requestId });
    } catch (err) {
      sendError(res, err, (req as AuthedRequest).requestId, "create script");
    }
  });

  app.patch("/api/voice/scripts/:code", authenticate, requireVoicePermission(getPool, "write"), async (req, res) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      const script = await service().updateScript(
        auth!.organizationId,
        auth!.userId,
        requestId ?? "unknown",
        req.params.code,
        req.body ?? {},
      );
      res.json({ ...script, requestId });
    } catch (err) {
      sendError(res, err, (req as AuthedRequest).requestId, "update script");
    }
  });

  app.post("/api/voice/scripts/:code/duplicate", authenticate, requireVoicePermission(getPool, "write"), async (req, res) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      const script = await service().duplicateScript(
        auth!.organizationId,
        auth!.userId,
        requestId ?? "unknown",
        req.params.code,
        req.body ?? {},
      );
      res.status(201).json({ ...script, requestId });
    } catch (err) {
      sendError(res, err, (req as AuthedRequest).requestId, "duplicate script");
    }
  });

  app.post("/api/voice/scripts/:code/publish", authenticate, requireVoicePermission(getPool, "write"), async (req, res) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      const result = await service().publishScript(auth!.organizationId, auth!.userId, requestId ?? "unknown", req.params.code);
      res.json({ ...result.script, published: result.published, requestId });
    } catch (err) {
      sendError(res, err, (req as AuthedRequest).requestId, "publish script");
    }
  });

  // Read-tier, not write-tier: reveals nothing beyond what GET /:code already
  // exposes (the same fields, rendered with substitutions) and has zero
  // side effects -- it never touches voice_calls, job_queue, or any driver.
  app.post("/api/voice/scripts/:code/preview", authenticate, requireVoicePermission(getPool, "read"), async (req, res) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      const preview = await service().previewScript(auth!.organizationId, req.params.code, req.body?.sampleValues ?? {});
      res.json({ ...preview, requestId });
    } catch (err) {
      sendError(res, err, (req as AuthedRequest).requestId, "preview script");
    }
  });

  // ── Dograh webhook ────────────────────────────────────────────────────────
  //
  // Not gated by requireAuth/requireVoicePermission -- the caller is Dograh,
  // not a logged-in user. Gated instead by a constant-time comparison
  // against DOGRAH_WEBHOOK_SECRET. Unlike the Shogo source (which allowed an
  // unset-secret fallback that accepted unverified calls), this route fails
  // closed: if the secret is not configured server-side, every request is
  // rejected, not silently accepted.
  //
  // organizationId for a webhook call cannot come from a verified session --
  // there is none -- so it is resolved from the call row the payload's
  // driver_job_id/taskRef points to, which was itself created under a real
  // authenticated dispatch. The webhook payload's own organizationId (if it
  // sent one) is never trusted.
  app.post("/api/voice/webhooks/dograh", async (req, res) => {
    const secret = process.env.DOGRAH_WEBHOOK_SECRET;
    if (!secret) {
      res.status(503).json({ ok: false, error: "webhook_not_configured" });
      return;
    }

    const provided = req.headers["x-bell24h-voice-webhook-secret"];
    const providedStr = Array.isArray(provided) ? provided[0] : provided;
    if (!providedStr || !secureEquals(providedStr, secret)) {
      res.status(401).json({ ok: false, error: "invalid_webhook_secret" });
      return;
    }

    const body = req.body ?? {};
    if (!isDograhPayload(body)) {
      res.status(400).json({ ok: false, error: "unrecognized_payload" });
      return;
    }

    const result = fromDograhPayload(body);

    try {
      // Webhook has no org context of its own -- find it via the call the
      // driverJobId/taskRef points to, across every org this instance knows
      // (findCallForWebhook is called per-org by the service; here we need
      // a lookup that is itself org-scoped by the call row, not the
      // request). Delegated entirely to VoiceService, which never trusts
      // an organizationId supplied by the payload.
      const pool = getPool();
      const svc = new VoiceService(pool);
      const lookup = await pool.query(
        `SELECT organization_id, id FROM public.voice_calls WHERE driver_job_id = $1 OR ref = $2 LIMIT 1`,
        [result.driverJobId, result.taskRef],
      );
      if (lookup.rows.length === 0) {
        res.status(404).json({ ok: false, error: "call_not_found" });
        return;
      }
      const { organization_id: organizationId, id: callId } = lookup.rows[0];

      const applied = await svc.applyCapture(organizationId, callId, result.capture, {
        driverJobId: result.driverJobId,
        durationSec: result.durationSec,
        recordingUrl: result.recordingUrl,
      });

      res.json({
        ok: true,
        duplicate: !applied.applied,
        applied: applied.applied
          ? { callRef: applied.call.ref, outcome: applied.call.outcome }
          : undefined,
      });
    } catch (err) {
      console.error("[Runtime] Voice webhook error:", (err as Error)?.message);
      res.status(500).json({ ok: false, error: "internal_error" });
    }
  });
}
