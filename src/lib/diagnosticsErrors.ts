/**
 * Error text for the admin diagnostics page's DB checks (Direct DB Connection / auth.users
 * count / information_schema.tables).
 *
 * Defect this replaces: diagnostics used a plain fetch() with no Authorization header, so the
 * server's requireAuth answered 401 "unauthenticated" and the page printed "Error:
 * unauthenticated" as if the database were unhealthy.
 *
 * Pure, so it is unit-tested.
 *
 * MINIMAL EXTRACTION NOTE: the full version of this file on sprint/ch-02-campaigns (commit
 * 361a0f6) also exports `vaultLoadError()`, used only by the Knowledge Vault UI components —
 * a related but separate fix, not part of this patch. Only `diagnosticError()`, the function
 * the diagnostics page's DB checks actually use, is reproduced here, per
 * ADMIN_DB_MINIMAL_PATCH_EXTRACTION_REPORT.md.
 */

/**
 * Structural check for AuthedFetchError (src/lib/authedFetch.ts): an Error carrying a numeric HTTP `status`.
 * Not `instanceof`, so this module has no runtime dependency on the Supabase client and stays unit-testable.
 */
interface HttpLikeError extends Error {
  status: number;
}
const isHttpError = (e: unknown): e is HttpLikeError => e instanceof Error && typeof (e as { status?: unknown }).status === "number";

export interface DiagnosticOutcome {
  /** "warn" = cannot tell (e.g. not signed in); "fail" = a real failure. Never "pass". */
  status: "warn" | "fail";
  message: string;
}

export function diagnosticError(err: unknown): DiagnosticOutcome {
  if (isHttpError(err)) {
    if (err.status === 401) {
      return { status: "warn", message: "Not signed in — this check runs with your session. Sign in, then run diagnostics again." };
    }
    if (err.status === 403) {
      return { status: "fail", message: "Requires the ADMIN role in this organization (your account is signed in but not authorized)." };
    }
    if (err.status === 503) {
      return { status: "fail", message: `Authorization service unavailable: ${err.message}` };
    }
    return { status: "fail", message: err.message };
  }
  return { status: "fail", message: err instanceof Error ? err.message : "Unexpected error." };
}
