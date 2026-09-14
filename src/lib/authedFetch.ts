import { supabase } from "@/lib/supabase";

/**
 * Fetch wrapper for requireAuth-gated server routes (e.g. /api/vault/*).
 *
 * PHASE 4A blocker remediation: the Knowledge Vault components were calling
 * these routes with no Authorization header at all, so every request failed
 * with 401 before reaching the server's real logic — and the failure was
 * then silently mishandled (components rendered/filtered against the
 * resulting `{error, requestId}` object as if it were the expected array).
 * This wrapper attaches the caller's own Supabase session token, matching
 * what server/middleware/requireAuth.ts expects, and surfaces a typed error
 * on failure instead of a value that looks like success.
 */
export class AuthedFetchError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function authedFetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const headers = new Headers(init.headers);
  if (session?.access_token) {
    headers.set("Authorization", `Bearer ${session.access_token}`);
  }
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(path, { ...init, headers });

  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = typeof body?.error === "string" ? body.error : "";
    } catch {
      // response body wasn't JSON — leave detail empty, status still reported
    }
    throw new AuthedFetchError(res.status, detail || `Request failed (${res.status})`);
  }

  return res.json();
}
