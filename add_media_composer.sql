-- Media Composer Tables

CREATE TABLE IF NOT EXISTS public.media_projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.media_packages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES public.media_projects(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES public.campaigns(id),
    package_type TEXT NOT NULL,
    status TEXT DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS public.media_assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    package_id UUID REFERENCES public.media_packages(id) ON DELETE CASCADE,
    asset_url TEXT NOT NULL,
    asset_type TEXT NOT NULL,
    metadata JSONB
);

CREATE TABLE IF NOT EXISTS public.media_timelines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    package_id UUID REFERENCES public.media_packages(id) ON DELETE CASCADE,
    asset_id UUID REFERENCES public.media_assets(id),
    start_time INTEGER,
    end_time INTEGER
);

CREATE TABLE IF NOT EXISTS public.media_compositions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    package_id UUID REFERENCES public.media_packages(id) ON DELETE CASCADE,
    composition_data JSONB
);

CREATE TABLE IF NOT EXISTS public.media_exports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    composition_id UUID REFERENCES public.media_compositions(id) ON DELETE CASCADE,
    export_format TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    file_url TEXT
);

-- RLS
ALTER TABLE public.media_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_timelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_compositions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_exports ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    t TEXT;
    tables TEXT[] := ARRAY['media_projects', 'media_packages', 'media_assets', 'media_timelines', 'media_compositions', 'media_exports'];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        EXECUTE format('CREATE POLICY "Org isolation select" ON public.%I FOR SELECT USING (organization_id = public.get_current_org_id());', t);
        EXECUTE format('CREATE POLICY "Org isolation insert" ON public.%I FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());', t);
    END LOOP;
END
$$;
