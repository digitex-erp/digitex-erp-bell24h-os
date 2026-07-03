import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { Client } from "pg";
import fs from "fs";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/env", (req, res) => {
    res.json({ keys: Object.keys(process.env) });
  });

  app.get("/api/migrate", async (req, res) => {
    try {
      const connectionString = process.env.DATABASE_URL;
      if (!connectionString) {
        return res.status(500).json({ error: "Missing DATABASE_URL" });
      }

      const client = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false }
      });

      await client.connect();
      const sql = fs.readFileSync(path.join(process.cwd(), 'supabase_schema.sql'), 'utf8');
      await client.query(sql);
      await client.end();
      
      res.json({ success: true, message: "Migration executed successfully!" });
    } catch (err: any) {
      console.error(err);
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

startServer();
