-- Campaign Management Tables

CREATE TABLE IF NOT EXISTS public.campaigns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    industry_id UUID REFERENCES public.industries(id),
    name TEXT NOT NULL,
    objective TEXT,
    status TEXT DEFAULT 'planned', -- planned, active, completed
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.campaign_assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE,
    asset_type TEXT NOT NULL, -- blog, linkedin, video, etc.
    status TEXT DEFAULT 'pending', -- pending, generating, ready, published
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_assets ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    t TEXT;
    tables TEXT[] := ARRAY['campaigns', 'campaign_assets'];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        EXECUTE format('CREATE POLICY "Org isolation select" ON public.%I FOR SELECT USING (organization_id = public.get_current_org_id());', t);
        EXECUTE format('CREATE POLICY "Org isolation insert" ON public.%I FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());', t);
    END LOOP;
END
$$;
