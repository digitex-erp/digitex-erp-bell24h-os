/**
 * Error text for the admin diagnostics page and the Knowledge Vault components.
 *
 * Two defects this replaces:
 *  - Diagnostics used a plain fetch() with no Authorization header, so the server's requireAuth answered
 *    401 "unauthenticated" and the page printed "Error: unauthenticated" as if the database were unhealthy.
 *  - Every vault component collapsed ALL non-401 failures into one generic sentence, hiding the real cause
 *    (missing table, RLS, server config).
 *
 * Pure, so it is unit-tested (src/lib/__tests__/diagnosticsErrors.test.ts).
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

/** What a vault component shows when its data request fails. `what` is e.g. "documents". */
export function vaultLoadError(err: unknown, what: string): string {
  if (isHttpError(err)) {
    if (err.status === 401) return "Your session could not be verified — try signing in again.";
    const cause = err.message && err.message !== `Request failed (${err.status})` ? `: ${err.message}` : "";
    return `Could not load ${what} (HTTP ${err.status}${cause}). Open System Diagnostics → Knowledge Vault tables for the cause.`;
  }
  return `Could not load ${what}: ${err instanceof Error ? err.message : "unexpected error"}.`;
}
