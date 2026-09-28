/**
 * CH-02 UI harness (dev/verification tool, not part of the app or its build). Serves the built admin page and the REAL /api/communications
 * routes on a REAL Postgres engine (PGlite) with the REAL migrations. Stubbed: login (always the seeded
 * ADMIN) and, when switched on, the provider adapter (a labelled test double — no network, no real delivery).
 * /__tick stands in for the cron/worker by running queued communication jobs through the REAL handler.
 */
import express from "express";
import path from "node:path";
import type { RequestHandler } from "express";
import { createTestDb, seedOrg, seedUser } from "../../server/communication/__tests__/helpers/testDb.js";
import { seedContact } from "../../server/communication/__tests__/helpers/httpHarness.js";
import { registerCommunicationRoutes } from "../../server/communication/routes.js";
import { CommunicationJobHandler } from "../../server/workers/handlers/CommunicationJobHandler.js";
import { ProviderFactory } from "../../server/communication/providers/ProviderFactory.js";
import type { ProviderAdapter } from "../../server/communication/types.js";
import type { AuthedRequest } from "../../server/middleware/requireAuth.js";

const PORT = Number(process.env.PORT || 4179);
const t = await createTestDb();
const org = await seedOrg(t.db, "Acme Demo Org");
const admin = await seedUser(t.db, org, ["ADMIN"]);
const registry = (ProviderFactory as unknown as { registry: Record<string, ProviderAdapter> }).registry;

let mode: "none" | "ok" | "fail" = "none";
const fake: ProviderAdapter = {
  provider: "resend",
  channelType: "email",
  send: async () => (mode === "fail" ? { success: false, errorMessage: "Resend API 401: invalid API key (test double)" } : { success: true, providerMessageId: `double-${Date.now()}` }),
  status: async () => ({ status: "sent" }),
  validate: async () => ({ valid: true }),
  healthCheck: async () => ({ healthy: mode !== "fail", detail: mode === "fail" ? "test double: down" : undefined, checkedAt: new Date().toISOString() }),
};
registry.resend = fake;

// data an operator would already have
const good = [
  ["Asha", "Rao", "asha@acme-buyers.example", "Acme Buyers"],
  ["Ravi", "Shah", "ravi@steelworks.example", "Steelworks"],
  ["Meera", "Iyer", "meera@chemco.example", "ChemCo"],
  ["Sanjay", "Patil", "sanjay@packwell.example", "Packwell"],
  ["Divya", "Nair", "divya@textilehub.example", "Textile Hub"],
];
for (const [f, l, e, c] of good) await seedContact(t.db, org, { first: f, last: l, email: e, company: c });
await seedContact(t.db, org, { first: "Broken", last: "Address", email: "not-an-email", company: "Bad Data Ltd" });
await seedContact(t.db, org, { first: "Phone", last: "Only", phone: "+919876543210", company: "Phone Co" });

const authenticate: RequestHandler = (req, _res, next) => {
  (req as AuthedRequest).auth = { userId: admin, organizationId: org, token: "harness" };
  (req as AuthedRequest).requestId = "harness";
  next();
};

const app = express();
app.use(express.json({ verify: (req, _res, buf) => ((req as { rawBody?: Buffer }).rawBody = buf) }));
registerCommunicationRoutes(app, { getPool: () => t.pool, authenticate, limits: { send: 1000, retry: 1000, write: 1000, campaign: 1000, health: 1000 } });

const handler = new CommunicationJobHandler(t.pool);
app.get("/__provider", async (req, res) => {
  const m = String(req.query.mode) as typeof mode;
  if (!["none", "ok", "fail"].includes(m)) return void res.status(400).send("mode=none|ok|fail");
  mode = m;
  await t.db.exec(`DELETE FROM public.communication_deliveries; UPDATE public.communication_messages SET provider_id = NULL; DELETE FROM public.communication_providers;`);
  if (m !== "none") {
    process.env.COMM_RESEND_HARNESS = "harness-not-a-real-key";
    await t.db.query(
      `INSERT INTO public.communication_providers (organization_id, name, provider, channel_type, credentials_secret_ref, priority, settings)
       VALUES ($1,'Resend (TEST DOUBLE)','resend','email','COMM_RESEND_HARNESS',0,'{"fromAddress":"no-reply@example.com"}')`,
      [org],
    );
  }
  res.send(`provider mode = ${m}`);
});
app.get("/__tick", async (_req, res) => {
  const jobs = await t.db.query<any>(
    `SELECT * FROM public.job_queue WHERE job_type='communication' AND status='queued' AND COALESCE(next_run_at, scheduled_at) <= NOW() ORDER BY created_at`,
  );
  const out: string[] = [];
  for (const job of jobs.rows) {
    try {
      const r = await handler.handle(job);
      await t.db.query(`UPDATE public.job_queue SET status='completed', completed_at=NOW() WHERE id=$1`, [job.id]);
      out.push(`ok ${JSON.stringify(r).slice(0, 80)}`);
    } catch (e) {
      const dead = job.retry_count + 1 >= job.max_retries;
      await t.db.query(`UPDATE public.job_queue SET status=$2, retry_count=retry_count+1 WHERE id=$1`, [job.id, dead ? "dead_letter" : "queued"]);
      out.push(`${dead ? "dead" : "retry"} ${(e as Error).message.slice(0, 80)}`);
    }
  }
  res.send(`ran ${jobs.rows.length} job(s)\n${out.join("\n")}`);
});

const dist = path.resolve(import.meta.dirname, "dist");
app.use(express.static(dist));
app.get("*", (_req, res) => res.sendFile(path.join(dist, "scripts", "ch02-ui-harness", "index.html")));
app.listen(PORT, "127.0.0.1", () => console.log(`HARNESS_READY http://127.0.0.1:${PORT}`));
