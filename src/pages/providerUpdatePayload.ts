/**
 * Shapes the payload for updating an existing AI provider row. The migration
 * harden_ai_providers_credentials.sql grants UPDATE only on the editable
 * fields (name, provider_id, status, priority, default_model, temperature,
 * max_tokens, timeout_ms, retry_count, last_request_at, last_error) --
 * api_key, id, organization_id, created_at, and updated_at are excluded.
 * Postgres rejects an UPDATE outright if any ungranted column appears in its
 * SET clause, even when the value is unchanged, so this strips all five
 * before the payload reaches supabase.from('ai_providers').update(...).
 *
 * Deliberately has no imports of its own (no React, no Supabase client) so
 * its regression test can import it directly under this repo's plain
 * node:test runner without pulling in AiProvidersPage.tsx's transitive
 * dependency on src/lib/supabase.ts, which reads Vite-only import.meta.env
 * and throws when loaded outside a Vite build.
 */
export function buildProviderUpdatePayload(formData: Record<string, unknown>): Record<string, unknown> {
  const { api_key, id, organization_id, created_at, updated_at, ...updatePayload } = formData;
  return updatePayload;
}
