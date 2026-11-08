-- Harden public.ai_providers against column-level credential exposure.
--
-- Finding A (AI Router security remediation): ai_providers.api_key is a
-- plaintext TEXT column (supabase_schema.sql / add_ai_tables.sql). The
-- table's only access control is row-level RLS keyed on organization_id
-- ("Org isolation select/insert/update/delete") -- RLS is row-level, not
-- column-level, so any authenticated member of the owning organization
-- could still retrieve api_key directly via `select('api_key')` or
-- `select('*')` against PostgREST, even though both first-party code paths
-- that read/write this table have already been fixed to use an explicit
-- column list excluding api_key (src/pages/AiProvidersPage.tsx's
-- fetchProviders()/handleSaveProvider(), BR-01 P0 / ticket AA-01-002 /
-- AA-01-004; src/modules/ai-providers/AiProviderService.ts's
-- getProviders()). This migration closes the underlying database-level gap
-- neither of those application-level fixes touched.
--
-- Additive and reversible: only column-level privilege grants change.
-- No table is created or dropped, no column is added or removed, no row
-- is read, written, or deleted. DELETE has no column granularity in
-- Postgres, so it is granted at the table level and remains governed
-- entirely by the existing "Org isolation delete" RLS policy, unchanged.
--
-- api_key itself is granted to NEITHER anon NOR authenticated, in either
-- direction (read or write) -- the browser must never be able to read a
-- stored key back, and must never be able to set one via a raw PostgREST
-- call either, consistent with the already-shipped BR-01 P0 fix's intent
-- (the UI's key input is hard-disabled with "Provider keys can no longer
-- be set from the browser").
--
-- server/ai/ProviderManager.ts (the authoritative router's own credential
-- resolution) is unaffected: it reads credentials exclusively from
-- process.env via the server-side service-role connection, never through
-- this RLS/grant path at all.
--
-- Why REVOKE at all, when no explicit GRANT to anon/authenticated for this
-- table appears anywhere in this repo's own tracked SQL: Supabase applies
-- its own platform-level default privileges (ALTER DEFAULT PRIVILEGES ...
-- GRANT ALL ON TABLES TO anon, authenticated, service_role) to every new
-- table in the public schema automatically, outside of any file in this
-- repo -- confirmed by this task's own repo-wide search finding zero
-- `ALTER DEFAULT PRIVILEGES`/`GRANT ... TO PUBLIC` statements anywhere.
-- That platform default is exactly what currently exposes api_key; this
-- migration's REVOKE undoes it for this one table without touching the
-- platform-level default itself (which other, non-secret-bearing tables
-- may still rely on).

DO $$
DECLARE
    r TEXT;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
        EXECUTE format('REVOKE ALL ON public.ai_providers FROM %I', r);
    END LOOP;
END $$;

-- anon gets nothing at all -- this table is never meant to be reachable
-- without an authenticated session; the existing RLS policies already
-- assume one (via get_current_org_id()).
GRANT SELECT (
    id, name, provider_id, status, priority, default_model, temperature,
    max_tokens, timeout_ms, retry_count, last_request_at, last_error,
    organization_id, created_at, updated_at
), INSERT (
    name, provider_id, status, priority, default_model, temperature,
    max_tokens, timeout_ms, retry_count, organization_id
), UPDATE (
    name, provider_id, status, priority, default_model, temperature,
    max_tokens, timeout_ms, retry_count, last_request_at, last_error
), DELETE
ON public.ai_providers TO authenticated;
