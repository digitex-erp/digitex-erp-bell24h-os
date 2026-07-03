-- Performance Intelligence & Learning Engine Tables

CREATE TABLE IF NOT EXISTS public.performance_projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.campaign_performance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE,
    metrics JSONB NOT NULL, -- views, reach, conversions, roi
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.asset_performance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id UUID NOT NULL, -- Dynamic reference to media_assets
    asset_type TEXT NOT NULL,
    engagement_rate DECIMAL(5,2),
    completion_rate DECIMAL(5,2),
    metrics JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.channel_performance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel_id UUID REFERENCES public.publishing_channels(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    best_time_to_post TEXT,
    avg_engagement DECIMAL(10,2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.keyword_performance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    keyword TEXT NOT NULL,
    rank INTEGER,
    ctr DECIMAL(5,2),
    conversions INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.learning_models (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    model_name TEXT NOT NULL,
    model_type TEXT NOT NULL, -- 'best_time', 'persona_affinity', 'creative_style'
    insights JSONB,
    last_trained_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.recommendations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    category TEXT NOT NULL, -- 'campaign', 'creative', 'seo', 'publishing'
    title TEXT NOT NULL,
    description TEXT,
    action_payload JSONB,
    status TEXT DEFAULT 'pending', -- pending, applied, dismissed
    confidence_score DECIMAL(3,2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ab_tests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    test_type TEXT NOT NULL, -- 'headline', 'thumbnail', 'cta'
    variant_a_id UUID NOT NULL,
    variant_b_id UUID NOT NULL,
    winner_id UUID,
    status TEXT DEFAULT 'running',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.conversion_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL, -- 'rfq', 'click', 'lead'
    source_campaign_id UUID REFERENCES public.campaigns(id),
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE public.performance_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.keyword_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ab_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversion_events ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    t TEXT;
    tables TEXT[] := ARRAY[
        'performance_projects', 'campaign_performance', 'asset_performance', 
        'channel_performance', 'keyword_performance', 'learning_models', 
        'recommendations', 'ab_tests', 'conversion_events'
    ];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        EXECUTE format('CREATE POLICY "Org isolation select" ON public.%I FOR SELECT USING (organization_id = public.get_current_org_id());', t);
        EXECUTE format('CREATE POLICY "Org isolation insert" ON public.%I FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());', t);
    END LOOP;
END
$$;
