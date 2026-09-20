import "dotenv/config";

// Handle unhandled rejections globally at the very top
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Runtime] Global Unhandled Rejection at:', promise);
  if (reason instanceof Error) {
    console.error('[Runtime] Reason:', reason.message);
    console.error('[Runtime] Stack:', reason.stack);
  } else {
    console.error('[Runtime] Reason:', reason);
  }
});

import express from "express";
import path from "path";
import pg from "pg";
const { Pool } = pg;
import fs from "fs";
import * as aiRouter from "./server/ai/ProviderRouter.js";
import { requireAuth, type AuthedRequest } from "./server/middleware/requireAuth.js";
import { requireServiceAuth, type ServiceAuthedRequest } from "./server/middleware/requireServiceAuth.js";
import { requireCronAuth } from "./server/middleware/requireCronAuth.js";
import { rateLimit } from "./server/middleware/rateLimit.js";
import { emitAuditEvent, newRequestId } from "./server/audit.js";
import { resolveRequestId } from "./server/lib/requestContext.js";
import { sendError } from "./server/lib/errors.js";
import { postgrestFetch, SupabaseRestError } from "./server/lib/supabaseRest.js";
import { QueueManager } from "./server/queue/QueueManager.js";
import { WorkerRegistry } from "./server/workers/WorkerRegistry.js";
import { WorkerSupervisor } from "./server/workers/WorkerSupervisor.js";
import { seoRoutes } from "./server/routes/seoRoutes.js";

// OS-INTEGRATION-IMPLEMENTATION-01: extracted so a Vercel serverless entry point
// (api/index.ts) can obtain the fully-configured Express app without also calling
// app.listen(), which has no meaning in a serverless invocation. This is a pure
// extraction — every route, every middleware, and the dev-vs-production static/Vite
// branch below are unchanged; only the trailing app.listen() call moved out into
// startServer() below. Traditional hosting (`npm run dev`, `node dist/server.cjs`)
// is unaffected.
export async function createApp() {
  const app = express();

  app.use(express.json());

  /**
   * Development-only route guard.
   *
   * Responds 404 (not 403) in production so the route's existence is not disclosed.
   * Uses the same NODE_ENV convention as the Vite middleware branch below rather
   * than introducing a second environment-detection pattern.
   */
  const devOnly = (routeName: string) =>
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (process.env.NODE_ENV === "production") {
        emitAuditEvent({
          actor: null,
          organizationId: null,
          action: "route.blocked",
          targetType: "http_request",
          targetId: `${req.method} ${req.path}`,
          outcome: "denied",
          requestId: newRequestId(),
          metadata: { route: routeName, reason: "development_only_route" },
        });
        res.status(404).end();
        return;
      }
      next();
    };

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Enterprise SEO Intelligence Platform REST API surface
  app.use("/api/seo", seoRoutes);

  // /api/v1/* — new versioned SDK surface. Additive only: no existing route below is
  // renamed or moved into this namespace. See
  // docs/architecture/BELL24H_OS_VYAPARSETHU_SDK_API_CONTRACT_V1.md Section 05.
  // Unauthenticated by design, mirroring /api/health above (Section 18) — this route
  // demonstrates the request-ID propagation and response-envelope conventions the new
  // surface uses; it is not a capability route.
  app.get("/api/v1/health", (req, res) => {
    const requestId = resolveRequestId(req, res);
    res.json({ status: "ok", apiVersion: "v1", requestId });
  });

  // OS-INTEGRATION-IMPLEMENTATION-01: the first real capability route on the /api/v1
  // surface. Gated by requireServiceAuth (system-to-system), never requireAuth
  // (end-user) — there is no browser session in this call path. Execution goes
  // through the existing server/ai/ProviderRouter, unchanged and unwidened: no new
  // provider, no new provider manager, no credential exposed in the response.
  //
  // organizationId/userId passed to the router are fixed, non-client-supplied
  // constants identifying "VyaparSethu as a system" for budget/audit purposes only —
  // not a tenant mapping. See OS_INTEGRATION_DECISION_RECORD_V1.md Decisions A/B.
  app.post("/api/v1/ai/text", requireServiceAuth, async (req, res) => {
    const { serviceCaller, requestId } = req as ServiceAuthedRequest;
    const { prompt, provider, policy, workflowType, temperature, maxTokens } = req.body ?? {};

    if (typeof prompt !== "string" || prompt.trim().length === 0) {
      return sendError(res, 400, "VALIDATION_FAILED", requestId!, "prompt is required");
    }

    const validProviders: aiRouter.ServerProviderName[] = [
      "gemini",
      "nvidia",
      "deepseek",
      "qwen",
      "glm",
      "minimax",
    ];
    if (provider !== undefined && !validProviders.includes(provider)) {
      return sendError(
        res,
        400,
        "VALIDATION_FAILED",
        requestId!,
        `Unknown provider "${provider}". Supported: ${validProviders.join(", ")}`
      );
    }

    const ctx = {
      userId: `service:${serviceCaller!.system}`,
      organizationId: serviceCaller!.system,
      requestId: requestId!,
      action: "ai.s2s.generateText",
    };

    try {
      const result = await aiRouter.routeText(ctx, {
        prompt,
        preferredProvider: provider,
        policy: policy || "balanced",
        workflowType,
        temperature,
        maxTokens,
      });
      res.json({
        text: result.data,
        provider: result.provider,
        model: result.model,
        latencyMs: result.latencyMs,
        tokens: result.tokens,
        requestId,
      });
    } catch (err: any) {
      console.error("[Runtime] S2S AI text generation error:", err.message);
      if (err?.code === "provider_credentials_unavailable") {
        return sendError(res, 503, "PROVIDER_UNAVAILABLE", requestId!, err.message);
      }
      if (err?.code === "ai_budget_exceeded") {
        return sendError(res, 429, "RATE_LIMITED", requestId!, err.message);
      }
      return sendError(res, 500, "INTERNAL_ERROR", requestId!, err.message || "AI request failed");
    }
  });

  // Operator auth guard: accepts valid Supabase JWT or service token
  const requireOperatorAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const header = req.headers.authorization;
    const serviceToken = process.env.BELL24H_VYAPARSETHU_SERVICE_TOKEN;
    if (serviceToken && header === `Bearer ${serviceToken}`) {
      (req as any).requestId = resolveRequestId(req, res);
      return next();
    }
    // Allow in development mode if no authorization header is passed
    if (process.env.NODE_ENV !== "production" && !header) {
      (req as any).requestId = resolveRequestId(req, res);
      return next();
    }
    return requireAuth(req, res, next);
  };

  // AI Router Operator & Diagnostic REST Endpoints
  app.get("/api/v1/ai-router/dashboard", requireOperatorAuth, (req, res) => {
    try {
      const data = aiRouter.getRouterDashboardData();
      res.json({ success: true, data });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/api/v1/ai-router/circuit-breakers", requireOperatorAuth, (req, res) => {
    try {
      const breakers = aiRouter.getAllCircuitBreakers();
      res.json({ success: true, breakers });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/v1/ai-router/circuit-breakers/:provider/reset", requireOperatorAuth, (req, res) => {
    const { provider } = req.params;
    try {
      const updated = aiRouter.resetCircuitBreaker(provider as aiRouter.ServerProviderName);
      res.json({ success: true, breaker: updated });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.post("/api/v1/ai-router/route", requireOperatorAuth, async (req, res) => {
    const { policy, workflowType, preferredProvider, prompt, temperature, maxTokens } = req.body ?? {};
    try {
      const simulation = aiRouter.testRouteSimulation(policy, workflowType, preferredProvider);
      let execution = null;
      if (prompt && typeof prompt === "string" && prompt.trim().length > 0) {
        const authedReq = req as AuthedRequest;
        const ctx: aiRouter.RouterContext = {
          userId: authedReq.auth?.userId || "ai-router-operator",
          organizationId: authedReq.auth?.organizationId || "system",
          action: "ai.route.execute",
          requestId: authedReq.requestId || newRequestId(),
        };
        const execResult = await aiRouter.routeText(ctx, {
          prompt,
          policy: policy || "balanced",
          preferredProvider,
          workflowType,
          temperature,
          maxTokens,
        });
        execution = {
          provider: execResult.provider,
          model: execResult.model,
          latencyMs: execResult.latencyMs,
          tokens: execResult.tokens,
          text: execResult.data,
          fallbackFrom: execResult.fallbackFrom,
        };
      }
      res.json({ success: true, simulation, execution });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.get("/api/v1/ai-router/telemetry", requireOperatorAuth, (req, res) => {
    const limit = Number(req.query.limit ?? 50);
    try {
      const telemetry = aiRouter.getRecentTelemetry(limit);
      const summary = aiRouter.getTelemetrySummary();
      res.json({ success: true, summary, telemetry });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Discloses which secrets are configured and the last 8 characters of each.
  // Its only caller is the (publicly routable) /system/diagnostics page, so there
  // is no legitimate production need — disabled outright rather than gated, to
  // keep the attack surface smaller.
  app.get("/api/env/diagnostic", devOnly("env-diagnostic"), (req, res) => {
    const keysToCheck = [
      'VITE_SUPABASE_URL', 
      'VITE_SUPABASE_KEY', 
      'VITE_SUPABASE_ANON_KEY',
      'SUPABASE_URL', 
      'SUPABASE_KEY', 
      'SUPABASE_ANON_KEY',
      'DATABASE_URL',
      'GEMINI_API_KEY',
      'OPENAI_API_KEY',
      'STRIPE_SECRET_KEY'
    ];
    
    const diagnostics = keysToCheck.reduce((acc: any, key) => {
      const val = process.env[key];
      acc[key] = {
        loaded: !!val,
        length: val ? val.length : 0,
        suffix: val ? (val.length > 8 ? `...${val.slice(-8)}` : val) : null
      };
      return acc;
    }, {});

    res.json({
      environment: process.env.NODE_ENV || 'development',
      variables: diagnostics,
      timestamp: new Date().toISOString()
    });
  });

  // Database pool for better connection management
  let pool: pg.Pool | null = null;

  const getPool = () => {
    if (!pool) {
      if (!process.env.DATABASE_URL) {
        throw new Error("DATABASE_URL is not defined in environment variables.");
      }
      pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      });
      pool.on('error', (err) => {
        console.error('[Runtime] Unexpected Pool Error:', err);
      });
    }
    return pool;
  };

  const getQueueManager = () => QueueManager.getInstance(getPool());

  // Queue Core Engine endpoints (Phase B.5B.1)
  app.get("/api/v1/queue/metrics", requireAuth, async (req, res) => {
    const { auth } = req as AuthedRequest;
    try {
      const qm = getQueueManager();
      const metrics = await qm.getMetrics(auth!.organizationId);
      res.json({ success: true, metrics });
    } catch (err: any) {
      console.error("[Runtime] Queue metrics error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/v1/queue/enqueue", requireAuth, async (req, res) => {
    const { auth } = req as AuthedRequest;
    const { jobType, payload, priority, idempotencyKey, scheduledAt, timeoutMs, maxRetries, dependencies } = req.body;

    if (!jobType || !payload) {
      res.status(400).json({ error: "jobType and payload are required" });
      return;
    }

    try {
      const qm = getQueueManager();
      const job = await qm.enqueueJob({
        organizationId: auth!.organizationId,
        jobType,
        payload,
        priority,
        idempotencyKey,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
        timeoutMs,
        maxRetries,
        dependencies,
      });

      res.status(201).json({ success: true, job });
    } catch (err: any) {
      console.error("[Runtime] Enqueue error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  const getWorkerRegistry = () => WorkerRegistry.getInstance(getPool(), getQueueManager());
  const getWorkerSupervisor = () => WorkerSupervisor.getInstance(getPool(), getQueueManager());

  // Worker Fleet Status endpoint (Phase B.5B.2)
  app.get("/api/v1/workers/status", requireAuth, async (req, res) => {
    try {
      const registry = getWorkerRegistry();
      const supervisor = getWorkerSupervisor();
      const cluster = await supervisor.getClusterStatus();
      res.json({
        success: true,
        worker: registry.getStatus(),
        cluster,
      });
    } catch (err: any) {
      console.error("[Runtime] Worker status error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Serverless worker activation (P0 remediation Phase 3). api/index.ts never
  // calls startServer(), so WorkerRegistry.start()'s persistent poll loop never
  // runs in production — this route is the reachable substitute: a bounded,
  // single-batch tick, triggered by vercel.json's cron entry (or an equivalent
  // external scheduler hitting this same route), gated by requireCronAuth so
  // only a caller holding CRON_SECRET can trigger job processing. See
  // docs/project/BELL24H_OS_P0_REMEDIATION_IMPLEMENTATION_PLAN.md Phase 3 and
  // docs/project/BELL24H_OS_RUNTIME_REALITY_CERTIFICATION.md §2.
  app.get("/api/v1/workers/tick", requireCronAuth, async (req, res) => {
    try {
      const registry = getWorkerRegistry();
      const summary = await registry.processBatch();
      res.json({ success: true, ...summary });
    } catch (err: any) {
      console.error("[Runtime] Worker tick error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // AI provider access is owned by server/ai/* — see ProviderManager for the
  // credential contract. Route handlers must not construct provider clients.

  // BELL24H_OS_EXECUTION_BACKLOG.md TASK-09 (SEC-2) scope note: this route and
  // /api/check-users-count query information_schema/auth.users — system
  // catalogs, not tenant-scoped application data, and not reachable through
  // Supabase's PostgREST API at all. They are diagnostic-only routes (not
  // named as vault handlers needing tenant isolation) and are intentionally
  // NOT migrated to postgrestFetch() below; they remain on the pooled
  // connection because there is no RLS-respecting equivalent for them.
  app.get("/api/check-table", requireAuth, async (req, res) => {
    try {
      const dbPool = getPool();
      console.log("[Runtime] DB Connection attempt starting...");
      const result = await dbPool.query("SELECT table_schema, table_name FROM information_schema.tables WHERE table_name='organizations' AND table_schema='public';");
      res.json({ success: true, rows: result.rows });
    } catch (err: any) {
      console.error("[Runtime] Check table error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/check-users-count", requireAuth, async (req, res) => {
    try {
      const dbPool = getPool();
      const result = await dbPool.query("SELECT count(*) FROM auth.users;");
      res.json({ success: true, count: result.rows[0].count });
    } catch (err: any) {
      console.error("[Runtime] Check users count error:", err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * Executes the entire schema file — including the RLS-generation DO block —
   * against the database. Step 1 intent check (Sprint C.2A) found no production
   * caller: the only consumer is the /system/diagnostics page, and `run_migration.cjs`
   * already provides a standalone migration path. Disabled outside development.
   *
   * Retained as GET only because it is now unreachable in production; if this route
   * is ever re-enabled for production use it must become a POST behind requireAuth
   * plus an admin-role check, since a schema-mutating GET is CSRF-triggerable.
   *
   * TASK-09 (SEC-2) scope note: not migrated to postgrestFetch() — it runs an
   * entire schema file as a transaction, which is a DDL operation PostgREST
   * cannot perform regardless of RLS. devOnly() already keeps it out of
   * production.
   */
  app.get("/api/migrate", devOnly("migrate"), async (req, res) => {
    const migrationRequestId = newRequestId();
    try {
      const dbPool = getPool();
      emitAuditEvent({
        actor: null,
        organizationId: null,
        action: "db.migrate",
        targetType: "database_schema",
        targetId: "supabase_schema.sql",
        outcome: "success",
        requestId: migrationRequestId,
        metadata: { stage: "started", environment: process.env.NODE_ENV || "development" },
      });
      console.log("[Runtime] Starting database migration...");
      
      const schemaPath = path.join(process.cwd(), 'supabase_schema.sql');
      if (!fs.existsSync(schemaPath)) {
        throw new Error(`Schema file not found at ${schemaPath}`);
      }
      const sql = fs.readFileSync(schemaPath, 'utf8');
      
      const client = await dbPool.connect();
      try {
        await client.query("BEGIN;");
        await client.query(sql);
        await client.query("COMMIT;");
        res.json({ success: true, message: "Database schema synchronized successfully!" });
      } catch (queryErr: any) {
        await client.query("ROLLBACK;");
        throw queryErr;
      } finally {
        client.release();
      }
    } catch (err: any) {
      console.error("[Runtime] Migration error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Knowledge Vault Endpoints
  //
  // Gate C: `requireAuth` closes anonymous access to these routes. It does NOT
  // make the data tenant-safe — these tables carry no organization_id column, so
  // there is no tenant boundary to scope by. Adding a tenant column is a
  // data-model change and therefore a Council decision (TASK-03), not an
  // engineering-only change; see the Knowledge Vault tenancy memo in
  // docs/project/GATE_C_REMEDIATION_REPORT.md.
  //
  // BELL24H_OS_EXECUTION_BACKLOG.md TASK-09 (SEC-2): the 5 GET handlers below
  // previously queried through the pooled DATABASE_URL connection, which
  // bypasses RLS entirely regardless of policy correctness — this was true
  // even for the "Public Read Access" (`USING (true)`) policy already defined
  // on these tables in supabase_schema.sql. They now call Supabase's REST API
  // with the caller's own bearer token via postgrestFetch(), so RLS is the
  // only isolation mechanism in the path, satisfying TASK-09's exit criterion
  // for these 5 routes. This does not by itself make the data tenant-safe —
  // that is TASK-04/GC-3, gated on the Council's TASK-03 decision — it only
  // ensures that whatever RLS policy exists (today: fully permissive) is what
  // actually governs access, not a bypass.
  app.get("/api/vault/documents", requireAuth, async (req, res) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      const rows = await postgrestFetch(auth!.token, "vault_documents?select=*&order=last_updated.desc");
      res.json(rows);
    } catch (err: any) {
      console.error("[Runtime] Fetch documents error:", err.message);
      res.status(err instanceof SupabaseRestError ? err.status : 500).json({ error: err.message, requestId });
    }
  });

  // NOT migrated in TASK-09, deliberately: supabase_schema.sql defines only a
  // SELECT policy ("Public Read Access", USING (true)) on vault_documents —
  // there is no INSERT policy. Because RLS is enabled with no INSERT policy,
  // Postgres denies all inserts by default; switching this route to
  // postgrestFetch() as written would silently break document creation
  // (currently only "works" because the pooled connection bypasses RLS
  // entirely). Closing that requires a schema change only the project owner
  // can apply (see the manual-SQL workflow) — an INSERT policy mirroring the
  // existing SELECT policy's permissiveness, not a new tenancy decision. This
  // route stays on the pooled connection until that policy exists; see the
  // Sprint 1 report for the exact SQL.
  app.post("/api/vault/documents", requireAuth, async (req, res) => {
    const { title, category, content, tags } = req.body;
    try {
      const dbPool = getPool();
      const result = await dbPool.query(
        "INSERT INTO vault_documents (title, category, content, tags) VALUES ($1, $2, $3, $4) RETURNING *",
        [title, category, content, tags || []]
      );
      res.json(result.rows[0]);
    } catch (err: any) {
      console.error("[Runtime] Create document error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/vault/rd", requireAuth, async (req, res) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      const rows = await postgrestFetch(auth!.token, "rd_library?select=*&order=last_updated.desc");
      res.json(rows);
    } catch (err: any) {
      console.error("[Runtime] Fetch RD error:", err.message);
      res.status(err instanceof SupabaseRestError ? err.status : 500).json({ error: err.message, requestId });
    }
  });

  app.get("/api/vault/timeline", requireAuth, async (req, res) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      const rows = await postgrestFetch(auth!.token, "timeline_milestones?select=*&order=sort_order.asc");
      res.json(rows);
    } catch (err: any) {
      console.error("[Runtime] Fetch timeline error:", err.message);
      res.status(err instanceof SupabaseRestError ? err.status : 500).json({ error: err.message, requestId });
    }
  });

  app.get("/api/vault/phases", requireAuth, async (req, res) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      const rows = await postgrestFetch(auth!.token, "phases?select=*&order=id.asc");
      res.json(rows);
    } catch (err: any) {
      console.error("[Runtime] Fetch phases error:", err.message);
      res.status(err instanceof SupabaseRestError ? err.status : 500).json({ error: err.message, requestId });
    }
  });

  app.get("/api/vault/decisions", requireAuth, async (req, res) => {
    const { auth, requestId } = req as AuthedRequest;
    try {
      const rows = await postgrestFetch(auth!.token, "decision_records?select=*&order=created_at.desc");
      res.json(rows);
    } catch (err: any) {
      console.error("[Runtime] Fetch decisions error:", err.message);
      res.status(err instanceof SupabaseRestError ? err.status : 500).json({ error: err.message, requestId });
    }
  });

  // AI endpoints: authenticated + organization-scoped + rate limited + budgeted.
  // Provider execution goes through server/ai/*, never the browser AiProviderService.
  const aiRateLimit = rateLimit({
    name: "vault-ai",
    limit: Number(process.env.AI_RATE_LIMIT_PER_MINUTE ?? 10),
    windowMs: 60_000,
  });

  const aiErrorStatus = (code: string | undefined) => {
    if (code === "ai_budget_exceeded") return 429;
    if (code === "provider_credentials_unavailable") return 503;
    return 500;
  };

  app.post("/api/vault/ai-summary", requireAuth, aiRateLimit, async (req, res) => {
    const { auth, requestId } = req as AuthedRequest;
    const { content, type } = req.body ?? {};

    if (typeof content !== "string" || content.trim().length === 0) {
      return res.status(400).json({ error: "invalid_input", detail: "content is required" });
    }
    if (typeof type !== "string" || type.trim().length === 0) {
      return res.status(400).json({ error: "invalid_input", detail: "type is required" });
    }

    try {
      const data = await aiRouter.generateJson<{ summary: string; recommendations: string[] }>(
        {
          userId: auth!.userId,
          organizationId: auth!.organizationId,
          requestId: requestId!,
          action: "ai.vault.summary",
        },
        {
          prompt: `You are the AI Founder Mentor for ICECRAFT.
        Analyze the following ${type} content and provide a concise summary (max 3 sentences) and 3 strategic recommendations.

        Content: ${content}`,
          responseSchema: {
            type: aiRouter.SchemaType.OBJECT,
            properties: {
              summary: { type: aiRouter.SchemaType.STRING },
              recommendations: {
                type: aiRouter.SchemaType.ARRAY,
                items: { type: aiRouter.SchemaType.STRING },
              },
            },
            required: ["summary", "recommendations"],
          },
        },
      );
      res.json(data);
    } catch (err: any) {
      console.error("[Runtime] AI Summary error:", err.message);
      res.status(aiErrorStatus(err?.code)).json({ error: err?.code ?? "ai_request_failed", requestId });
    }
  });

  app.post("/api/vault/mentor-advice", requireAuth, aiRateLimit, async (req, res) => {
    const { auth, requestId } = req as AuthedRequest;
    const { currentPhase, focus } = req.body ?? {};

    if (typeof currentPhase !== "string" || typeof focus !== "string") {
      return res
        .status(400)
        .json({ error: "invalid_input", detail: "currentPhase and focus are required" });
    }

    try {
      const advice = await aiRouter.generateText(
        {
          userId: auth!.userId,
          organizationId: auth!.organizationId,
          requestId: requestId!,
          action: "ai.vault.mentorAdvice",
        },
        {
          prompt: `You are the AI Founder Mentor for ICECRAFT.
        Current Business Phase: ${currentPhase}
        Founder's Current Focus: ${focus}

        Provide one short, high-impact strategic advice for today. Keep it under 40 words.`,
        },
      );
      res.json({ advice });
    } catch (err: any) {
      console.error("[Runtime] Mentor advice error:", err.message);
      res.status(aiErrorStatus(err?.code)).json({ error: err?.code ?? "ai_request_failed", requestId });
    }
  });

  // Vite middleware for development.
  //
  // OS-INTEGRATION-IMPLEMENTATION-01: `vite` is imported dynamically, inside this
  // branch, rather than as a static top-level import. Vite (and its `rollup`
  // dependency, which ships platform-specific native binaries as optional
  // dependencies) is never needed in production/serverless — the previous static
  // import loaded vite's full dependency graph on every module load regardless of
  // which branch ran, which crashed Vercel's serverless runtime outright
  // (`Cannot find module '@rollup/rollup-linux-x64-gnu'`, a known npm optional-
  // dependency resolution bug) even though createViteServer was never called there.
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return app;
}

async function startServer() {
  const app = await createApp();
  const PORT = Number(process.env.PORT ?? 3000);
  app.listen(PORT, "0.0.0.0", async () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);

    // Auto-start Worker Fleet and Supervisor in persistent server mode
    if (process.env.DATABASE_URL) {
      try {
        const pool = new Pool({
          connectionString: process.env.DATABASE_URL,
          ssl: { rejectUnauthorized: false },
          max: 20,
        });
        const qm = QueueManager.getInstance(pool);
        const registry = WorkerRegistry.getInstance(pool, qm);
        const supervisor = WorkerSupervisor.getInstance(pool, qm);

        await registry.start();
        supervisor.start();
        console.log("[Runtime] Worker Fleet and Supervisor successfully booted.");
      } catch (err: any) {
        console.warn("[Runtime] Worker Fleet startup warning:", err.message);
      }
    } else {
      console.log("[Runtime] Worker Fleet deferred: DATABASE_URL not yet defined in environment.");
    }
  });
}

// Only auto-start a listening server outside the Vercel serverless runtime. Vercel
// sets VERCEL=1 for every invocation; api/index.ts imports createApp() directly and
// never wants a second process trying to bind a port.
if (!process.env.VERCEL) {
  startServer().catch(err => {
    console.error("[Runtime] Critical server startup error:", err);
  });
}

// Rejection handler is already at the top
