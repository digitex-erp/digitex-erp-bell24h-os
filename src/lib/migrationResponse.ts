/**
 * Pure interpretation of the /api/migrate response into the shape
 * SystemDiagnosticsPage renders. Extracted so the three outcomes below can be
 * unit-tested without a DOM/React harness (none exists in this repo).
 *
 * devOnly() (server.ts) responds 404 with an empty body outside development
 * -- the intentional production safeguard, not an error worth parsing.
 */
export interface MigrationResult {
  success?: boolean;
  message?: string;
  error?: string;
  disabled?: boolean;
}

export function interpretMigrationResponse(
  status: number,
  ok: boolean,
  data: MigrationResult | null,
): MigrationResult {
  if (status === 404) {
    return {
      error: "Schema synchronization is disabled in this environment (development-only route).",
      disabled: true,
    };
  }
  if (!ok || !data) {
    return { error: data?.error || `Migration request failed (HTTP ${status}).` };
  }
  return data;
}
