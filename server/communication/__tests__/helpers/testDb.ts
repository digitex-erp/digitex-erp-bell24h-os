/**
 * Test database for the Communication Hub: a real Postgres engine (PGlite, in-process WASM),
 * loaded with the REAL migration file and the REAL job_queue DDL, not hand-written stand-ins.
 * That is what lets the tests exercise the actual unique index, ON CONFLICT clause, RLS
 * policies and REVOKEs rather than a mock that agrees with whatever the code assumes.
 *
 * Limitations (stated so nobody over-reads a green run):
 *  - It is one Postgres connection. The pool adapter below serializes "connections" with a mutex,
 *    so concurrent requests are tested for logical correctness, NOT for true parallel races.
 *    The advisory lock in CommunicationService is therefore not exercised under real contention.
 *  - Supabase-specific pieces (auth.users, JWTs, PostgREST) are stubbed minimally.
 */

import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import type pg from "pg";
import { QueueManager } from "../../../queue/QueueManager.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");

const BOOTSTRAP = `
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

  -- Supabase's tenant roles, plus its default grants: without these the migration's REVOKEs
  -- would have nothing to revoke and the privilege assertions would be vacuous.
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  GRANT USAGE ON SCHEMA public TO anon, authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;

  CREATE TABLE public.organizations (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), name TEXT);
  CREATE TABLE public.profiles (
    id UUID PRIMARY KEY, email TEXT, organization_id UUID REFERENCES public.organizations(id)
  );
  CREATE TABLE public.companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), name TEXT NOT NULL,
    organization_id UUID REFERENCES public.organizations(id), deleted_at TIMESTAMPTZ
  );
  CREATE TABLE public.contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES public.companies(id),
    first_name TEXT, last_name TEXT, email TEXT, phone TEXT,
    organization_id UUID REFERENCES public.organizations(id),
    created_at TIMESTAMPTZ DEFAULT NOW(), deleted_at TIMESTAMPTZ
  );
  CREATE TABLE public.roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), name TEXT NOT NULL,
    organization_id UUID REFERENCES public.organizations(id), deleted_at TIMESTAMPTZ
  );
  CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    role_id UUID REFERENCES public.roles(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES public.organizations(id),
    UNIQUE(user_id, role_id)
  );
  -- Same shape as supabase_schema.sql: SECURITY DEFINER so tenants need no direct access to profiles.
  CREATE OR REPLACE FUNCTION public.get_current_org_id() RETURNS UUID AS $$
  DECLARE org_id UUID;
  BEGIN
    SELECT organization_id INTO org_id FROM public.profiles WHERE id = auth.uid();
    RETURN org_id;
  END;
  $$ LANGUAGE plpgsql SECURITY DEFINER;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated;
  GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
`;

/** The real job_queue DDL, sliced out of supabase_schema.sql (through its idempotency unique index). */
function jobQueueDdl(): string {
  const sql = fs.readFileSync(path.join(REPO_ROOT, "supabase_schema.sql"), "utf8");
  const start = sql.indexOf("-- Job Queue\r\nCREATE TABLE IF NOT EXISTS public.job_queue");
  const start2 = start >= 0 ? start : sql.indexOf("-- Job Queue\nCREATE TABLE IF NOT EXISTS public.job_queue");
  const endMarker = "-- Job Workers";
  const end = sql.indexOf(endMarker, start2);
  if (start2 < 0 || end < 0) throw new Error("Could not locate the job_queue DDL in supabase_schema.sql");
  return sql.slice(start2, end);
}

export function communicationMigrationSql(): string {
  return fs.readFileSync(path.join(REPO_ROOT, "add_communication_hub.sql"), "utf8");
}

export function campaignsMigrationSql(): string {
  return fs.readFileSync(path.join(REPO_ROOT, "add_communication_campaigns.sql"), "utf8");
}

/** pg.Pool-shaped adapter over one PGlite connection. Each connect() holds a mutex until release(). */
export function toPool(db: PGlite): pg.Pool {
  let tail: Promise<void> = Promise.resolve();
  const acquire = (): Promise<() => void> => {
    const prev = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => (release = resolve));
    return prev.then(() => release);
  };
  const run = async (text: string, params?: unknown[]) => {
    const r = await db.query(text, params as any[]);
    // Same as node-postgres: SELECT / RETURNING report the number of rows returned; plain DML the number affected.
    return { rows: r.rows as any[], rowCount: r.rows.length > 0 ? r.rows.length : (r.affectedRows ?? 0) };
  };
  const pool = {
    query: async (text: string, params?: unknown[]) => {
      const release = await acquire();
      try {
        return await run(text, params);
      } finally {
        release();
      }
    },
    connect: async () => {
      const release = await acquire();
      return { query: run, release };
    },
  };
  return pool as unknown as pg.Pool;
}

export interface TestDb {
  db: PGlite;
  pool: pg.Pool;
}

export async function createTestDb(): Promise<TestDb> {
  const db = new PGlite({ extensions: { uuid_ossp } });
  await db.exec(BOOTSTRAP);
  await db.exec(jobQueueDdl());
  await db.exec(communicationMigrationSql());
  await db.exec(campaignsMigrationSql());
  await db.exec(fs.readFileSync(path.join(REPO_ROOT, "add_whatsapp_template_mapping.sql"), "utf8"));
  const pool = toPool(db);
  // QueueManager is a process-wide singleton bound to its first pool; rebind it to this test DB.
  (QueueManager as unknown as { instance: QueueManager | null }).instance = null;
  QueueManager.getInstance(pool);
  return { db, pool };
}

export async function seedOrg(db: PGlite, name = "Org"): Promise<string> {
  const r = await db.query<{ id: string }>(`INSERT INTO public.organizations (name) VALUES ($1) RETURNING id`, [name]);
  return r.rows[0].id;
}

/** Creates a user in `orgId` holding the given role names (roles are created per-org on demand). */
export async function seedUser(db: PGlite, orgId: string, roleNames: string[]): Promise<string> {
  const id = (await db.query<{ id: string }>(`SELECT uuid_generate_v4() AS id`)).rows[0].id;
  await db.query(`INSERT INTO public.profiles (id, email, organization_id) VALUES ($1, $2, $3)`, [
    id,
    `${id}@example.test`,
    orgId,
  ]);
  for (const name of roleNames) {
    const existing = await db.query<{ id: string }>(`SELECT id FROM public.roles WHERE name = $1 AND organization_id = $2`, [
      name,
      orgId,
    ]);
    const roleId =
      existing.rows[0]?.id ??
      (await db.query<{ id: string }>(`INSERT INTO public.roles (name, organization_id) VALUES ($1, $2) RETURNING id`, [name, orgId]))
        .rows[0].id;
    await db.query(`INSERT INTO public.user_roles (user_id, role_id, organization_id) VALUES ($1, $2, $3)`, [id, roleId, orgId]);
  }
  return id;
}

/** Applies an additional REAL migration file from the repo root to a test database. */
export async function applyMigration(db: PGlite, fileName: string): Promise<void> {
  await db.exec(fs.readFileSync(path.join(REPO_ROOT, fileName), "utf8"));
}
