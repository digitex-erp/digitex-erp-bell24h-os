-- =============================================================================
-- Durable audit log (Phase 2, item 9).  NOT APPLIED to any database by this change.
--
-- Until now audit events were emitted to stdout only (server/audit.ts). This adds the durable, queryable,
-- append-only store the sink in server/lib/auditStore.ts writes to.
--
-- Design decisions:
--   * APPEND-ONLY: row triggers reject UPDATE / DELETE and a statement trigger rejects TRUNCATE. Retention (purging
--     old rows) must be a deliberate, privileged operation that first disables the triggers; nothing in the app does it.
--   * organization_id is NOT a foreign key: an audit row must outlive its organization and must be writable for
--     events that happen before an organization is known (failed authentication).
--   * SERVER-ONLY ACCESS: RLS is enabled with NO policies and all client privileges are revoked. Tenants cannot read
--     or write it through PostgREST; ADMINs read it through GET /api/audit/events, which is role-gated and org-scoped.
--     (Contrast with communication_* tables, which tenants may read: audit content — denied requests, actor ids — is
--     more sensitive.)
--   * metadata is size-capped in the database as well as redacted in the application.
--   Re-runnable.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.audit_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor TEXT,
    organization_id UUID,
    action TEXT NOT NULL CHECK (char_length(action) BETWEEN 1 AND 200),
    target_type TEXT NOT NULL CHECK (char_length(target_type) BETWEEN 1 AND 100),
    target_id TEXT NOT NULL CHECK (char_length(target_id) BETWEEN 1 AND 300),
    outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'denied')),
    request_id TEXT NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 100),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(metadata) < 16384)
);

CREATE INDEX IF NOT EXISTS idx_audit_events_org_time ON public.audit_events (organization_id, occurred_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_audit_events_org_action ON public.audit_events (organization_id, action, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_request ON public.audit_events (request_id);

CREATE OR REPLACE FUNCTION public.audit_events_reject_change() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_events is append-only (% is not allowed)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_events_no_update_delete ON public.audit_events;
CREATE TRIGGER audit_events_no_update_delete
    BEFORE UPDATE OR DELETE ON public.audit_events
    FOR EACH ROW EXECUTE FUNCTION public.audit_events_reject_change();

DROP TRIGGER IF EXISTS audit_events_no_truncate ON public.audit_events;
CREATE TRIGGER audit_events_no_truncate
    BEFORE TRUNCATE ON public.audit_events
    FOR EACH STATEMENT EXECUTE FUNCTION public.audit_events_reject_change();

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies: with RLS on and no policy, tenant roles see and change nothing.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON public.audit_events FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'REVOKE ALL ON public.audit_events FROM authenticated';
    END IF;
END $$;
