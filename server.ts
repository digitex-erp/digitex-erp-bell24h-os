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
import { GoogleGenAI, Type } from "@google/genai";

async function startServer() {
  const app = express();
  const PORT = 3000;

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

  const getAi = () => {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not defined in environment variables.");
    }
    return new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  };

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

  app.post("/api/vault/ai-summary", async (req, res) => {
    const { content, type } = req.body;
    try {
      const ai = getAi();
      const prompt = `You are the AI Founder Mentor for ICECRAFT. 
        Analyze the following ${type} content and provide a concise summary (max 3 sentences) and 3 strategic recommendations.
        
        Content: ${content}`;

      const result = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              recommendations: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              }
            },
            required: ["summary", "recommendations"]
          }
        }
      });

      const text = result.text || "{}";
      try {
        res.json(JSON.parse(text));
      } catch (parseErr: any) {
        console.error("[Runtime] AI Summary parse error:", text);
        res.status(500).json({ error: "Failed to parse AI response", raw: text });
      }
    } catch (err: any) {
      console.error("[Runtime] AI Summary error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/vault/mentor-advice", async (req, res) => {
    const { currentPhase, focus } = req.body;
    try {
      const ai = getAi();
      const prompt = `You are the AI Founder Mentor for ICECRAFT. 
        Current Business Phase: ${currentPhase}
        Founder's Current Focus: ${focus}
        
        Provide one short, high-impact strategic advice for today. Keep it under 40 words.`;

      const result = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: prompt,
      });

      res.json({ advice: result.text });
    } catch (err: any) {
      console.error("[Runtime] Mentor advice error:", err.message);
      res.status(500).json({ error: err.message });
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
