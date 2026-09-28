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
    provider TEXT NOT NULL, -- ProviderFactory registry key: 'resend', 'smtp', 'msg91', 'meta_whatsapp', 'twilio'
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
CREATE INDEX IF NOT EXISTS idx_communication_messages_campaign
    ON public.communication_messages (campaign_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_communication_providers_channel
    ON public.communication_providers (organization_id, channel_type, priority);
CREATE INDEX IF NOT EXISTS idx_communication_deliveries_message
    ON public.communication_deliveries (message_id);
CREATE INDEX IF NOT EXISTS idx_communication_webhooks_provider_message_id
    ON public.communication_webhooks (provider_message_id) WHERE provider_message_id IS NOT NULL;

-- RLS: org isolation on every table, matching the house convention
-- (public.get_current_org_id()).
ALTER TABLE public.communication_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_webhooks ENABLE ROW LEVEL SECURITY;

-- providers: no client-side SELECT of credentials_secret_ref is prevented by
-- RLS alone (RLS is row-level, not column-level) — the server API layer (not
-- built in this slice) must never project credentials_secret_ref to the
-- browser. RLS here only enforces org isolation, same as every other table.
CREATE POLICY "Org isolation select" ON public.communication_providers FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.communication_providers FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.communication_providers FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.communication_providers FOR DELETE USING (organization_id = public.get_current_org_id());

CREATE POLICY "Org isolation select" ON public.communication_templates FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.communication_templates FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.communication_templates FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.communication_templates FOR DELETE USING (organization_id = public.get_current_org_id());

CREATE POLICY "Org isolation select" ON public.communication_campaigns FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.communication_campaigns FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.communication_campaigns FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.communication_campaigns FOR DELETE USING (organization_id = public.get_current_org_id());

CREATE POLICY "Org isolation select" ON public.communication_messages FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.communication_messages FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.communication_messages FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.communication_messages FOR DELETE USING (organization_id = public.get_current_org_id());

-- deliveries / webhooks: append-only. Deliberately no UPDATE/DELETE policy —
-- RLS defaults to deny, enforcing immutability at the database level.
CREATE POLICY "Org isolation select" ON public.communication_deliveries FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.communication_deliveries FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());

CREATE POLICY "Org isolation select" ON public.communication_webhooks FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.communication_webhooks FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
