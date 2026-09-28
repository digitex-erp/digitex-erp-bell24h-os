-- Communication Hub — Sprint CH-02: campaigns, recipients, execution logs
--
-- REQUIRES add_communication_hub.sql to have been applied first (it creates
-- communication_campaigns / communication_messages / communication_deliveries).
-- Safe to re-run. NOT applied to any database by this change.
--
-- Also (section 6): suppression lists, contact lists and segments.
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
        CHECK (status IN ('pending', 'queued', 'sent', 'failed', 'cancelled', 'suppressed')),
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

-- 6. Suppression lists, contact lists, segments (CH-02 audience management) --------------------------------
-- Suppression: an address that must NEVER be sent to on a channel (unsubscribed, bounced, complained, or
-- blocked by an operator). Enforced at THREE points: campaign creation (excluded from the audience), the
-- send API (refused), and the worker immediately before the provider call (so an unsubscribe is honoured
-- even for messages that were already queued).
CREATE TABLE IF NOT EXISTS public.communication_suppressions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    channel_type TEXT NOT NULL CHECK (channel_type IN ('email', 'sms', 'whatsapp')),
    address TEXT NOT NULL, -- normalized: email lower-cased, phone E.164
    reason TEXT NOT NULL CHECK (reason IN ('unsubscribed', 'bounced', 'complained', 'manual', 'invalid')),
    source TEXT,           -- e.g. 'operator', 'unsubscribe_link'
    note TEXT,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (organization_id, channel_type, address)
);
CREATE INDEX IF NOT EXISTS idx_communication_suppressions_org_channel ON public.communication_suppressions (organization_id, channel_type);

-- Contact lists: named, org-scoped groups of existing contacts (membership rows only; contacts are not copied).
CREATE TABLE IF NOT EXISTS public.communication_lists (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (organization_id, name)
);
CREATE TABLE IF NOT EXISTS public.communication_list_members (
    list_id UUID NOT NULL REFERENCES public.communication_lists(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (list_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_communication_list_members_contact ON public.communication_list_members (contact_id);

-- Segments: SAVED criteria (validated JSON: list ids, company/name text, created-date range) that are
-- re-evaluated against contacts when a campaign is created. Criteria never become SQL text.
CREATE TABLE IF NOT EXISTS public.communication_segments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    criteria JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (organization_id, name)
);

-- Campaign audit of how the audience was chosen and what was left out.
ALTER TABLE public.communication_campaigns
    ADD COLUMN IF NOT EXISTS audience JSONB,          -- { type: 'contacts' | 'list' | 'segment', id?: uuid }
    ADD COLUMN IF NOT EXISTS audience_summary JSONB;  -- { requested, resolved, notFound, invalidAddress, duplicate, suppressed }

-- Recipients can also be skipped at send time because they were suppressed AFTER the campaign was created.
ALTER TABLE public.communication_campaign_recipients DROP CONSTRAINT IF EXISTS communication_campaign_recipients_status_check;
ALTER TABLE public.communication_campaign_recipients ADD CONSTRAINT communication_campaign_recipients_status_check
    CHECK (status IN ('pending', 'queued', 'sent', 'failed', 'cancelled', 'suppressed'));

-- Same write model as everything else here: tenants READ their own rows, only the server writes.
ALTER TABLE public.communication_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_list_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_segments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org isolation select" ON public.communication_suppressions;
DROP POLICY IF EXISTS "Org isolation select" ON public.communication_lists;
DROP POLICY IF EXISTS "Org isolation select" ON public.communication_list_members;
DROP POLICY IF EXISTS "Org isolation select" ON public.communication_segments;
CREATE POLICY "Org isolation select" ON public.communication_suppressions FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation select" ON public.communication_lists FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation select" ON public.communication_list_members FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation select" ON public.communication_segments FOR SELECT USING (organization_id = public.get_current_org_id());

DO $$
DECLARE
    r TEXT;
    t TEXT;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            FOREACH t IN ARRAY ARRAY['communication_suppressions', 'communication_lists', 'communication_list_members', 'communication_segments'] LOOP
                EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM %I', t, r);
            END LOOP;
        END IF;
    END LOOP;
END
$$;
