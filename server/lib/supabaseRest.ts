/**
 * Minimal PostgREST client for server routes that must respect Supabase RLS.
 *
 * BELL24H_OS_EXECUTION_BACKLOG.md TASK-09 (SEC-2): several server.ts handlers
 * queried Postgres directly through a pooled DATABASE_URL connection, which
 * bypasses RLS regardless of policy correctness. This helper instead calls
 * Supabase's REST (PostgREST) API using the caller's own bearer token — the
 * same approach server/middleware/requireAuth.ts already uses for its profile
 * lookup — so Postgres RLS, not application code, is the isolation mechanism
 * in the path.
 *
 * Scope note: this only covers tables PostgREST actually exposes (the
 * `public` schema, under an existing RLS policy). It does not apply to
 * information_schema/auth.users diagnostic queries or the schema-migration
 * route — those are not tenant-scoped data and are unreachable through
 * PostgREST regardless; they are intentionally left on the pooled connection
 * (see server.ts inline comments at those routes).
 */

function config(): { url: string; anonKey: string } | null {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey =
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.VITE_SUPABASE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url: url.replace(/\/+$/, ""), anonKey };
}

export class SupabaseRestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Issues a request against Supabase's PostgREST API as the caller (their own
 * bearer token forwarded, never a service-role key), so RLS applies exactly
 * as it would for a client-side supabase-js call. `pathAndQuery` is appended
 * to `/rest/v1/`, e.g. `"vault_documents?select=*&order=last_updated.desc"`.
 */
export async function postgrestFetch(
  token: string,
  pathAndQuery: string,
  init: { method?: string; body?: unknown; prefer?: string } = {},
): Promise<any> {
  const cfg = config();
  if (!cfg) {
    throw new SupabaseRestError(
      503,
      "Supabase server configuration missing (SUPABASE_URL / SUPABASE_ANON_KEY).",
    );
  }

  const headers: Record<string, string> = {
    apikey: cfg.anonKey,
    Authorization: `Bearer ${token}`,
  };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.prefer) headers["Prefer"] = init.prefer;

  const res = await fetch(`${cfg.url}/rest/v1/${pathAndQuery}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new SupabaseRestError(res.status, `PostgREST request failed (${res.status}): ${detail}`);
  }

  // PostgREST returns 204 with no body for some request/Prefer combinations.
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
