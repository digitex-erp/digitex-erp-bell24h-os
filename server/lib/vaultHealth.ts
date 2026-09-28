/**
 * Knowledge Vault health: for each table the vault UI depends on, ask PostgREST — as the CALLER, so RLS
 * applies exactly as it does for the real vault routes — for one row, and report what actually happened.
 *
 * Why this exists: the vault components used to collapse every non-401 failure into one generic line
 * ("Could not load documents"), which hid the real cause. Typical causes, each recognisable here:
 *   - the table was never created (add_knowledge_vault.sql not applied)        -> 404 / PGRST205
 *   - RLS is on but no SELECT policy / no privilege for the caller's role     -> 401/403 / 42501
 *   - the server has no Supabase URL/key configured                            -> 503
 * Nothing here fabricates a pass: an unreachable table is reported as failed with the upstream reason.
 */

export const VAULT_TABLES = ["vault_documents", "rd_library", "timeline_milestones", "phases", "decision_records"] as const;

export interface VaultTableHealth {
  table: string;
  ok: boolean;
  status?: number;
  /** Stable classification of the failure, for the UI. */
  reason?: "table_missing" | "permission_denied" | "server_unconfigured" | "upstream_error";
  detail?: string;
}

export type PostgrestFetcher = (token: string, pathAndQuery: string) => Promise<unknown>;

function classify(status: number | undefined, message: string): VaultTableHealth["reason"] {
  if (status === 503 && /configuration missing/i.test(message)) return "server_unconfigured";
  if (status === 404 || /PGRST205|PGRST200|does not exist|schema cache/i.test(message)) return "table_missing";
  if (status === 401 || status === 403 || /42501|permission denied|row-level security/i.test(message)) return "permission_denied";
  return "upstream_error";
}

export async function checkVaultTables(token: string, fetcher: PostgrestFetcher): Promise<VaultTableHealth[]> {
  const settled = await Promise.allSettled(VAULT_TABLES.map((t) => fetcher(token, `${t}?select=id&limit=1`)));
  return settled.map((r, i) => {
    const table = VAULT_TABLES[i];
    if (r.status === "fulfilled") return { table, ok: true };
    const err = r.reason as { status?: number; message?: string };
    const message = String(err?.message ?? "unknown error");
    return {
      table,
      ok: false,
      status: err?.status,
      reason: classify(err?.status, message),
      // The upstream body is the diagnostic; it is capped and never contains a credential (the request
      // carries the caller's own token, which PostgREST does not echo).
      detail: message.slice(0, 400),
    };
  });
}

/** One-line guidance for the first failing table, or null when everything is reachable. */
export function vaultRemedy(rows: VaultTableHealth[]): string | null {
  const bad = rows.find((r) => !r.ok);
  if (!bad) return null;
  switch (bad.reason) {
    case "table_missing":
      return "One or more vault tables do not exist in the database. Apply add_knowledge_vault.sql (manual SQL workflow), then reload the schema cache.";
    case "permission_denied":
      return "The tables exist but this user's role cannot read them. Check RLS policies and GRANT SELECT for the authenticated role.";
    case "server_unconfigured":
      return "The server has no Supabase URL/anon key configured (SUPABASE_URL, SUPABASE_KEY).";
    default:
      return "Supabase returned an unexpected error; see the detail per table.";
  }
}
