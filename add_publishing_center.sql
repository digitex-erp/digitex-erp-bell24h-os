-- Publishing Center Tables

CREATE TABLE IF NOT EXISTS public.publishing_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    account_name TEXT NOT NULL,
    credentials JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.publishing_channels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    account_id UUID REFERENCES public.publishing_accounts(id) ON DELETE CASCADE,
    channel_name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.publishing_campaigns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.publishing_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    media_package_id UUID REFERENCES public.media_packages(id) ON DELETE CASCADE,
    channel_id UUID REFERENCES public.publishing_channels(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'queued',
    scheduled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.publishing_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    queue_id UUID REFERENCES public.publishing_queue(id) ON DELETE CASCADE,
    published_at TIMESTAMPTZ DEFAULT NOW(),
    result JSONB
);

CREATE TABLE IF NOT EXISTS public.publishing_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    queue_id UUID REFERENCES public.publishing_queue(id) ON DELETE CASCADE,
    log TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.publishing_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE,
    schedule_config JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.publishing_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    template_config JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.publishing_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    queue_id UUID REFERENCES public.publishing_queue(id) ON DELETE CASCADE,
    metrics JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.social_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    account_handle TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE public.publishing_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publishing_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publishing_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publishing_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publishing_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publishing_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publishing_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publishing_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publishing_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_accounts ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    t TEXT;
    tables TEXT[] := ARRAY['publishing_accounts', 'publishing_channels', 'publishing_campaigns', 'publishing_queue', 'publishing_history', 'publishing_logs', 'publishing_schedules', 'publishing_templates', 'publishing_results', 'social_accounts'];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        EXECUTE format('CREATE POLICY "Org isolation select" ON public.%I FOR SELECT USING (organization_id = public.get_current_org_id());', t);
        EXECUTE format('CREATE POLICY "Org isolation insert" ON public.%I FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());', t);
    END LOOP;
END
$$;
