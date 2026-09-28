/**
 * Shared HTTP harness for the CH-02 integration tests: the REAL routes (RBAC, rate limiting, services,
 * SQL) on a bare Express app. Only authentication is stubbed — the stub sets req.auth exactly as
 * requireAuth does. The JSON parser captures the raw body as server.ts does, so webhook signature
 * verification is exercised on real bytes.
 */

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express, { type RequestHandler } from "express";
import type pg from "pg";
import type { AuthedRequest } from "../../../middleware/requireAuth.js";
import { registerCommunicationRoutes } from "../../routes.js";
import type { PGlite } from "@electric-sql/pglite";

export interface Harness {
  url: string;
  close: () => Promise<void>;
}

export const authenticate: RequestHandler = (req, res, next) => {
  const userId = req.header("x-test-user");
  const organizationId = req.header("x-test-org");
  if (!userId || !organizationId) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  (req as AuthedRequest).auth = { userId, organizationId, token: "test" };
  (req as AuthedRequest).requestId = "req-test";
  next();
};

export async function serve(
  pool: pg.Pool,
  limits: { send?: number; retry?: number; write?: number; campaign?: number; health?: number } = {},
): Promise<Harness> {
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => ((req as { rawBody?: Buffer }).rawBody = buf) }));
  registerCommunicationRoutes(app, {
    getPool: () => pool,
    authenticate,
    limits: { send: 1000, retry: 1000, write: 1000, campaign: 1000, health: 1000, ...limits },
  });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export interface CallOpts {
  user?: string | null;
  org?: string;
  key?: string | null;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
}

export async function call(h: Harness, method: string, path: string, o: CallOpts = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", ...o.headers };
  if (o.user && o.org) {
    headers["x-test-user"] = o.user;
    headers["x-test-org"] = o.org;
  }
  if (o.key) headers["Idempotency-Key"] = o.key;
  const body = o.rawBody !== undefined ? o.rawBody : o.body === undefined || method === "GET" ? undefined : JSON.stringify(o.body);
  const res = await fetch(`${h.url}${path}`, { method, headers, body });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, text, headers: res.headers };
}

/** Email campaigns need a signed unsubscribe link; tests configure it the way a deployment would. */
export const UNSUBSCRIBE_TEST_SECRET = "test-unsubscribe-secret-0123456789abcdef";
export const UNSUBSCRIBE_TEST_BASE = "https://os.example.test";
export function useUnsubscribeEnv(): () => void {
  const prev = { s: process.env.COMM_UNSUBSCRIBE_SECRET, b: process.env.COMM_PUBLIC_BASE_URL };
  process.env.COMM_UNSUBSCRIBE_SECRET = UNSUBSCRIBE_TEST_SECRET;
  process.env.COMM_PUBLIC_BASE_URL = UNSUBSCRIBE_TEST_BASE;
  return () => {
    if (prev.s === undefined) delete process.env.COMM_UNSUBSCRIBE_SECRET;
    else process.env.COMM_UNSUBSCRIBE_SECRET = prev.s;
    if (prev.b === undefined) delete process.env.COMM_PUBLIC_BASE_URL;
    else process.env.COMM_PUBLIC_BASE_URL = prev.b;
  };
}

export const silenceAudit = () => {
  const real = console.log;
  console.log = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith('{"kind":"audit"')) return;
    real(...args);
  };
  return () => {
    console.log = real;
  };
};

export async function seedContact(
  db: PGlite,
  orgId: string,
  c: { first?: string | null; last?: string | null; email?: string | null; phone?: string | null; company?: string; deleted?: boolean },
): Promise<string> {
  let companyId: string | null = null;
  if (c.company) {
    companyId = (await db.query<{ id: string }>(`INSERT INTO public.companies (name, organization_id) VALUES ($1,$2) RETURNING id`, [c.company, orgId])).rows[0].id;
  }
  const r = await db.query<{ id: string }>(
    `INSERT INTO public.contacts (first_name, last_name, email, phone, organization_id, company_id, deleted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [c.first ?? null, c.last ?? null, c.email ?? null, c.phone ?? null, orgId, companyId, c.deleted ? new Date() : null],
  );
  return r.rows[0].id;
}

/** Serves ANY route registrar on a bare Express app (JSON body + raw-body capture, auth stubbed by the caller). */
export async function serveApp(register: (app: express.Express) => void): Promise<Harness> {
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => ((req as { rawBody?: Buffer }).rawBody = buf) }));
  register(app);
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
