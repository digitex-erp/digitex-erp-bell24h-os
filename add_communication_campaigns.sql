-- Communication Hub — Sprint CH-02: campaigns, recipients, execution logs
--
-- REQUIRES add_communication_hub.sql to have been applied first (it creates
-- communication_campaigns / communication_messages / communication_deliveries).
-- Safe to re-run. NOT applied to any database by this change.
--
-- What this adds (and deliberately does NOT add):
--   * communication_campaign_recipients — the audience SNAPSHOT for a campaign
--     (one row per resolved recipient). New table: nothing existing models this.
--   * columns on communication_campaigns for the Create -> Test -> Schedule -> Execute flow.
--   * communication_messages.is_test — test sends must never count toward campaign totals.
--   * communication_logs — a READ-ONLY VIEW, not a table. The per-attempt log already
--     exists as communication_deliveries (append-only, written by the worker); a second
--     log table would duplicate it (ARCHITECTURE_DECISIONS.md forbids duplicate domain
--     tables). The view joins messages to their attempts so the admin "Logs" tab has one
--     row per message with attempt count / last provider / last attempt time.
--
-- Same write model as add_communication_hub.sql: tenants READ their own org's rows; only the
-- server (API + worker) writes, so role checks, quotas, idempotency and validation cannot be
-- bypassed through the Supabase client.

-- 1. Campaign flow columns -------------------------------------------------------------------
ALTER TABLE public.communication_campaigns
    ADD COLUMN IF NOT EXISTS variables JSONB DEFAULT '{}'::jsonb,           -- campaign-wide template variables
    ADD COLUMN IF NOT EXISTS consent_confirmed_by UUID REFERENCES public.profiles(id), -- operator attestation of lawful basis / opt-in
    ADD COLUMN IF NOT EXISTS consent_confirmed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_test_message_id UUID REFERENCES public.communication_messages(id),
    ADD COLUMN IF NOT EXISTS run_count INT NOT NULL DEFAULT 0,               -- number of execution batches enqueued (job idempotency key part)
    ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS paused_reason TEXT;

-- 'paused' = execution stopped part-way (e.g. the organization's daily quota was reached); resumable.
ALTER TABLE public.communication_campaigns DROP CONSTRAINT IF EXISTS communication_campaigns_status_check;
ALTER TABLE public.communication_campaigns ADD CONSTRAINT communication_campaigns_status_check
    CHECK (status IN ('draft', 'scheduled', 'running', 'paused', 'completed', 'failed', 'cancelled'));

-- 2. Test-send marker --------------------------------------------------------------------------
ALTER TABLE public.communication_messages ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;

-- 3. Audience snapshot ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.communication_campaign_recipients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES public.communication_campaigns(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL, -- the lead this row was resolved from
    recipient TEXT NOT NULL,          -- validated email address or E.164 number, snapshotted at campaign creation
    display_name TEXT,
    variables JSONB DEFAULT '{}'::jsonb, -- per-recipient template variables (first_name, last_name, company)
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'queued', 'sent', 'failed', 'cancelled')),
    message_id UUID REFERENCES public.communication_messages(id),
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (campaign_id, recipient)   -- one send per address per campaign
);
CREATE INDEX IF NOT EXISTS idx_communication_campaign_recipients_campaign_status
    ON public.communication_campaign_recipients (campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_communication_campaign_recipients_org
    ON public.communication_campaign_recipients (organization_id);
CREATE INDEX IF NOT EXISTS idx_communication_messages_org_created
    ON public.communication_messages (organization_id, created_at DESC);

ALTER TABLE public.communication_campaign_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org isolation select" ON public.communication_campaign_recipients;
CREATE POLICY "Org isolation select" ON public.communication_campaign_recipients
    FOR SELECT USING (organization_id = public.get_current_org_id());

-- 4. communication_logs (read-only view) ------------------------------------------------------------
-- security_invoker: the CALLER's privileges and RLS apply to the underlying tables, so a tenant
-- sees only its own organization's rows. (Without it a view runs with its owner's rights and
-- would bypass RLS.) Message BODY is intentionally not exposed here.
CREATE OR REPLACE VIEW public.communication_logs WITH (security_invoker = true) AS
SELECT
    m.id AS message_id,
    m.organization_id,
    m.campaign_id,
    m.channel_type,
    m.recipient,
    m.status,
    m.is_test,
    m.error_message,
    m.retry_count,
    m.provider_message_id,
    m.created_at,
    m.sent_at,
    m.updated_at,
    COALESCE(d.attempts, 0) AS attempts,
    d.last_provider,
    d.last_attempt_at
FROM public.communication_messages m
LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS attempts,
           (ARRAY_AGG(x.provider ORDER BY x.attempt_number DESC, x.attempted_at DESC))[1] AS last_provider,
           MAX(x.attempted_at) AS last_attempt_at
    FROM public.communication_deliveries x
    WHERE x.message_id = m.id
) d ON true;

-- 5. Privileges (defense in depth; guarded so the file runs on a plain Postgres too) ------------------
DO $$
DECLARE
    r TEXT;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.communication_campaign_recipients FROM %I', r);
            EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.communication_logs FROM %I', r);
        END IF;
    END LOOP;
END
$$;
