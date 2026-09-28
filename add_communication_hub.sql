-- Communication Hub — Foundation (schema + provider abstraction slice)
--
-- Scope note: additive extension under the "Queue job types and worker
-- handlers" and "Supabase migrations/schema scripts with review evidence"
-- approved extension points in ARCHITECTURE_DECISIONS.md. Communication Hub as
-- a first-class module boundary is NOT yet listed there as approved — see
-- "Proposed module (unratified)" in that document. Get review-gate sign-off
-- before adding a second real (non-stub) SMS/WhatsApp/voice provider.
--
-- Revision note: supersedes the first version of this file (never committed).
-- That version had a separate `communication_channels` table; this revision
-- drops it — a provider row now carries `channel_type` directly, which is
-- simpler and matches the shape actually requested. Nothing external
-- depended on the old shape (uncommitted, no live DB has run either version).
--
-- Deliberately reuses the existing job_queue (server/queue/QueueManager.ts) for
-- scheduling, retry, and dead-lettering instead of a new queue table.
--
-- Sprint C0 (hardening): tenant write access to communication_providers / messages /
-- campaigns / deliveries / webhooks is removed (see the RLS section); idempotency_key added.
--
-- No provider credential values live in these tables. communication_providers
-- stores only `credentials_secret_ref` — the NAME of a server-side secret
-- (e.g. an env var), never the value — per SECURITY_BASELINE.md ("Never store
-- provider keys in ordinary tenant-readable records").

-- 1. Providers: a configured provider instance per organization. Several rows
--    may share a channel_type, ordered by priority, to support failover.
CREATE TABLE IF NOT EXISTS public.communication_providers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL, -- human label, e.g. "Primary transactional email"
    provider TEXT NOT NULL, -- ProviderFactory registry key: 'resend', 'smtp', 'msg91', 'meta_whatsapp'
    channel_type TEXT NOT NULL CHECK (channel_type IN ('email', 'sms', 'whatsapp', 'voice', 'push')),
    credentials_secret_ref TEXT NOT NULL, -- name of a server-side secret (env var / secrets store key), never the value
    priority INT DEFAULT 0, -- lower = tried first; enables failover across providers of the same channel_type
    settings JSONB DEFAULT '{}'::jsonb, -- non-secret settings (from-address, SMTP host/port, rate limits, ...)
    is_active BOOLEAN DEFAULT true,
    health_status TEXT DEFAULT 'unknown', -- unknown, healthy, degraded, down — set only by a real healthCheck() call
    last_health_check_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Templates: reusable content per channel type.
CREATE TABLE IF NOT EXISTS public.communication_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    channel_type TEXT NOT NULL CHECK (channel_type IN ('email', 'sms', 'whatsapp', 'voice', 'push')),
    subject TEXT, -- used by email; ignored by other channel types
    body TEXT NOT NULL,
    variables JSONB DEFAULT '[]'::jsonb, -- declared variable names the caller must supply
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Campaigns: optional bulk-send grouping. Not in this request's table list,
--    kept because sendBulkMessages() and communication_messages.campaign_id
--    already depend on it and nothing asked for its removal — dropping a
--    harmless, working table would be pure churn, not simplification.
CREATE TABLE IF NOT EXISTS public.communication_campaigns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    channel_type TEXT CHECK (channel_type IN ('email', 'sms', 'whatsapp', 'voice', 'push')),
    template_id UUID REFERENCES public.communication_templates(id),
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'running', 'completed', 'failed', 'cancelled')),
    total_recipients INT DEFAULT 0,
    sent_count INT DEFAULT 0,
    failed_count INT DEFAULT 0,
    scheduled_at TIMESTAMPTZ,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Messages: one row per message instance (single send or one campaign member).
CREATE TABLE IF NOT EXISTS public.communication_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    channel_type TEXT NOT NULL CHECK (channel_type IN ('email', 'sms', 'whatsapp', 'voice', 'push')),
    provider_id UUID REFERENCES public.communication_providers(id), -- the provider that actually sent it (set on success; NULL until then)
    template_id UUID REFERENCES public.communication_templates(id),
    campaign_id UUID REFERENCES public.communication_campaigns(id) ON DELETE CASCADE,
    job_id UUID REFERENCES public.job_queue(id), -- the job_queue row that executes/executed this send
    recipient TEXT NOT NULL,
    subject TEXT,
    body TEXT,
    variables_used JSONB DEFAULT '{}'::jsonb,
    status TEXT DEFAULT 'queued' CHECK (
        status IN ('queued', 'scheduled', 'sending', 'sent', 'delivered', 'failed', 'cancelled', 'dead_letter')
    ),
    provider_message_id TEXT, -- id returned by the winning provider adapter's send()
    error_message TEXT,
    idempotency_key TEXT, -- caller-supplied (Idempotency-Key header); one (organization_id, idempotency_key) -> one message
    retry_count INT DEFAULT 0,
    max_retries INT DEFAULT 3,
    scheduled_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Deliveries: one row per provider send ATTEMPT for a message (append-only).
--    This is the persisted form of the failover chain — if a channel has 3
--    providers by priority and the first 2 fail, this table has 3 rows for
--    one message. communication_messages holds only the final outcome.
CREATE TABLE IF NOT EXISTS public.communication_deliveries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    message_id UUID REFERENCES public.communication_messages(id) ON DELETE CASCADE,
    provider_id UUID REFERENCES public.communication_providers(id),
    provider TEXT NOT NULL, -- denormalized provider registry key at attempt time (survives provider row edits/deletes)
    attempt_number INT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('attempted', 'success', 'failed')),
    provider_message_id TEXT,
    error_message TEXT,
    raw_response JSONB,
    attempted_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(), -- present only to satisfy "every table has updated_at"; never updated in practice
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Webhooks: inbound delivery/bounce/status callbacks from providers
--    (append-only). SCHEMA ONLY in this pass — no receiver route exists yet
--    (that is an API endpoint, explicitly deferred per this request's own
--    "only foundation" instruction). message_id is nullable because a webhook
--    may arrive referencing a provider_message_id this table has to resolve
--    after the fact; a real receiver would look it up before inserting.
CREATE TABLE IF NOT EXISTS public.communication_webhooks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    event_type TEXT NOT NULL, -- delivered, bounced, complained, opened, clicked, failed, ... (provider-specific, not constrained by CHECK — providers vary too much)
    provider_message_id TEXT,
    message_id UUID REFERENCES public.communication_messages(id),
    payload JSONB NOT NULL,
    signature_verified BOOLEAN DEFAULT false,
    received_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(), -- present only to satisfy "every table has updated_at"; never updated in practice
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for the hot paths.
CREATE INDEX IF NOT EXISTS idx_communication_messages_org_status
    ON public.communication_messages (organization_id, status);
-- Sprint C0 / B3: idempotency. ADD COLUMN IF NOT EXISTS keeps this file safe to re-run
-- against a database that already has the earlier version of the table.
ALTER TABLE public.communication_messages ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_communication_messages_org_idempotency
    ON public.communication_messages (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
-- Supports the rolling-24h quota count.
CREATE INDEX IF NOT EXISTS idx_communication_messages_org_channel_created
    ON public.communication_messages (organization_id, channel_type, created_at);
CREATE INDEX IF NOT EXISTS idx_communication_messages_campaign
    ON public.communication_messages (campaign_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_communication_providers_channel
    ON public.communication_providers (organization_id, channel_type, priority);
CREATE INDEX IF NOT EXISTS idx_communication_deliveries_message
    ON public.communication_deliveries (message_id);
CREATE INDEX IF NOT EXISTS idx_communication_webhooks_provider_message_id
    ON public.communication_webhooks (provider_message_id) WHERE provider_message_id IS NOT NULL;

-- RLS. Sprint C0 (B1/B3) changed the model from "org isolation on everything" to
-- "tenants READ their own rows; the SERVER writes".
--
-- Why: the API enforces role checks, rate limits, per-organization quotas,
-- idempotency and input validation. Every one of those is bypassed if a tenant can
-- INSERT straight into communication_providers / communication_messages through the
-- Supabase client. In particular a tenant-writable communication_providers row let a
-- tenant name a shared server secret and an attacker-controlled SMTP host, so the
-- worker would send the real credential to that host (ProviderFactory's secret-name
-- allowlist blocks arbitrary env vars, but cannot stop that replay on its own).
--
-- The server connects with a role that bypasses RLS (pooled DATABASE_URL), so it is
-- unaffected. Tenants (anon / authenticated) keep org-scoped SELECT where the data is
-- theirs to see, and lose all writes except on templates (no outbound effect on their
-- own; content is re-validated at send time and role-checked in the API).
ALTER TABLE public.communication_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_webhooks ENABLE ROW LEVEL SECURITY;

-- Drop every policy an earlier revision of this file may have created, so re-running is safe
-- and the tightened set below is the whole truth.
DROP POLICY IF EXISTS "Org isolation select" ON public.communication_providers;
DROP POLICY IF EXISTS "Org isolation insert" ON public.communication_providers;
DROP POLICY IF EXISTS "Org isolation update" ON public.communication_providers;
DROP POLICY IF EXISTS "Org isolation delete" ON public.communication_providers;
DROP POLICY IF EXISTS "Org isolation select" ON public.communication_templates;
DROP POLICY IF EXISTS "Org isolation insert" ON public.communication_templates;
DROP POLICY IF EXISTS "Org isolation update" ON public.communication_templates;
DROP POLICY IF EXISTS "Org isolation delete" ON public.communication_templates;
DROP POLICY IF EXISTS "Org isolation select" ON public.communication_campaigns;
DROP POLICY IF EXISTS "Org isolation insert" ON public.communication_campaigns;
DROP POLICY IF EXISTS "Org isolation update" ON public.communication_campaigns;
DROP POLICY IF EXISTS "Org isolation delete" ON public.communication_campaigns;
DROP POLICY IF EXISTS "Org isolation select" ON public.communication_messages;
DROP POLICY IF EXISTS "Org isolation insert" ON public.communication_messages;
DROP POLICY IF EXISTS "Org isolation update" ON public.communication_messages;
DROP POLICY IF EXISTS "Org isolation delete" ON public.communication_messages;
DROP POLICY IF EXISTS "Org isolation select" ON public.communication_deliveries;
DROP POLICY IF EXISTS "Org isolation insert" ON public.communication_deliveries;
DROP POLICY IF EXISTS "Org isolation select" ON public.communication_webhooks;
DROP POLICY IF EXISTS "Org isolation insert" ON public.communication_webhooks;

-- providers: NO tenant policy at all (RLS default-deny) and no table privileges.
-- Provider rows are operator-managed: created with service-role SQL, never by a tenant.
-- (credentials_secret_ref names a server secret; hiding the row also hides that name.)

-- templates: tenants may read and manage their own org's templates.
CREATE POLICY "Org isolation select" ON public.communication_templates FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.communication_templates FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.communication_templates FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.communication_templates FOR DELETE USING (organization_id = public.get_current_org_id());

-- campaigns / messages / deliveries / webhooks: tenants READ their own org's rows only.
-- All writes go through the server (API + worker), which is what makes quotas, idempotency,
-- validation and role checks unbypassable. deliveries and webhooks stay append-only.
CREATE POLICY "Org isolation select" ON public.communication_campaigns FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation select" ON public.communication_messages FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation select" ON public.communication_deliveries FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation select" ON public.communication_webhooks FOR SELECT USING (organization_id = public.get_current_org_id());

-- Defense in depth: policies are one layer, table privileges another. Supabase grants broad
-- default privileges to anon/authenticated on public tables; strip the ones tenants must not have.
-- Guarded so the file also runs on a plain Postgres that has no such roles.
DO $$
DECLARE
    r TEXT;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON public.communication_providers FROM %I', r);
            EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.communication_campaigns FROM %I', r);
            EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.communication_messages FROM %I', r);
            EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.communication_deliveries FROM %I', r);
            EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.communication_webhooks FROM %I', r);
        END IF;
    END LOOP;
END
$$;
