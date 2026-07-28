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
import { createServer as createViteServer } from "vite";
import pg from "pg";
const { Pool } = pg;
import fs from "fs";
import * as aiRouter from "./server/ai/ProviderRouter";
import { requireAuth, type AuthedRequest } from "./server/middleware/requireAuth";
import { rateLimit } from "./server/middleware/rateLimit";

async function startServer() {
  const app = express();
  // Configurable so the server can be run alongside other local services and so
  // Review Gate verification can bind a free port. Default is unchanged.
  const PORT = Number(process.env.PORT ?? 3000);

  app.use(express.json());

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/env/diagnostic", (req, res) => {
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

  // AI provider access is owned by server/ai/* — see ProviderManager for the
  // credential contract. Route handlers must not construct provider clients.

  app.get("/api/check-table", async (req, res) => {
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

  app.get("/api/check-users-count", async (req, res) => {
    try {
      const dbPool = getPool();
      const result = await dbPool.query("SELECT count(*) FROM auth.users;");
      res.json({ success: true, count: result.rows[0].count });
    } catch (err: any) {
      console.error("[Runtime] Check users count error:", err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/api/migrate", async (req, res) => {
    try {
      const dbPool = getPool();
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
  app.get("/api/vault/documents", async (req, res) => {
    try {
      const dbPool = getPool();
      const result = await dbPool.query("SELECT * FROM vault_documents ORDER BY last_updated DESC");
      res.json(result.rows);
    } catch (err: any) {
      console.error("[Runtime] Fetch documents error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/vault/documents", async (req, res) => {
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

  app.get("/api/vault/rd", async (req, res) => {
    try {
      const dbPool = getPool();
      const result = await dbPool.query("SELECT * FROM rd_library ORDER BY last_updated DESC");
      res.json(result.rows);
    } catch (err: any) {
      console.error("[Runtime] Fetch RD error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/vault/timeline", async (req, res) => {
    try {
      const dbPool = getPool();
      const result = await dbPool.query("SELECT * FROM timeline_milestones ORDER BY sort_order ASC");
      res.json(result.rows);
    } catch (err: any) {
      console.error("[Runtime] Fetch timeline error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/vault/phases", async (req, res) => {
    try {
      const dbPool = getPool();
      const result = await dbPool.query("SELECT * FROM phases ORDER BY id ASC");
      res.json(result.rows);
    } catch (err: any) {
      console.error("[Runtime] Fetch phases error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/vault/decisions", async (req, res) => {
    try {
      const dbPool = getPool();
      const result = await dbPool.query("SELECT * FROM decision_records ORDER BY created_at DESC");
      res.json(result.rows);
    } catch (err: any) {
      console.error("[Runtime] Fetch decisions error:", err.message);
      res.status(500).json({ error: err.message });
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

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error("[Runtime] Critical server startup error:", err);
});

// Rejection handler is already at the top
