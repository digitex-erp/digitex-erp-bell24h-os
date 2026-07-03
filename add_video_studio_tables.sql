-- Video Projects
CREATE TABLE IF NOT EXISTS public.video_projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    brand TEXT,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Video Templates
CREATE TABLE IF NOT EXISTS public.video_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    brand_colors JSONB,
    fonts JSONB,
    logo_placement TEXT,
    qr_code_placement TEXT,
    cta_position TEXT,
    watermark TEXT,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Video Styles
CREATE TABLE IF NOT EXISTS public.video_styles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    prompt_prefix TEXT,
    negative_prompt TEXT,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Video Jobs
CREATE TABLE IF NOT EXISTS public.video_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES public.video_projects(id) ON DELETE CASCADE,
    template_id UUID REFERENCES public.video_templates(id),
    style_id UUID REFERENCES public.video_styles(id),
    prompt TEXT NOT NULL,
    negative_prompt TEXT,
    video_type TEXT NOT NULL,
    aspect_ratio TEXT NOT NULL,
    duration TEXT,
    frame_rate TEXT,
    quality TEXT,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    camera_motion TEXT,
    transitions TEXT,
    status TEXT DEFAULT 'queued', -- queued, preparing, generating, rendering, uploading, completed, failed, cancelled
    error_message TEXT,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_by UUID REFERENCES public.profiles(id),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Video Assets
CREATE TABLE IF NOT EXISTS public.video_assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID REFERENCES public.video_jobs(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.video_projects(id) ON DELETE CASCADE,
    asset_url TEXT NOT NULL,
    thumbnail_url TEXT,
    video_type TEXT,
    prompt TEXT,
    negative_prompt TEXT,
    provider TEXT,
    model TEXT,
    seed BIGINT,
    resolution TEXT,
    duration TEXT,
    generation_time_ms INT,
    file_size_bytes BIGINT,
    cost DECIMAL,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_by UUID REFERENCES public.profiles(id),
    is_favorite BOOLEAN DEFAULT false,
    tags JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Video Timelines
CREATE TABLE IF NOT EXISTS public.video_timelines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES public.video_projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    data JSONB,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Video Variants
CREATE TABLE IF NOT EXISTS public.video_variants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id UUID REFERENCES public.video_assets(id) ON DELETE CASCADE,
    variant_url TEXT NOT NULL,
    description TEXT,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS Policies
ALTER TABLE public.video_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_styles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_timelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org isolation select" ON public.video_projects FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.video_projects FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.video_projects FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.video_projects FOR DELETE USING (organization_id = public.get_current_org_id());

CREATE POLICY "Org isolation select" ON public.video_templates FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.video_templates FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.video_templates FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.video_templates FOR DELETE USING (organization_id = public.get_current_org_id());

CREATE POLICY "Org isolation select" ON public.video_styles FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.video_styles FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.video_styles FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.video_styles FOR DELETE USING (organization_id = public.get_current_org_id());

CREATE POLICY "Org isolation select" ON public.video_jobs FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.video_jobs FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.video_jobs FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.video_jobs FOR DELETE USING (organization_id = public.get_current_org_id());

CREATE POLICY "Org isolation select" ON public.video_assets FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.video_assets FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.video_assets FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.video_assets FOR DELETE USING (organization_id = public.get_current_org_id());

CREATE POLICY "Org isolation select" ON public.video_timelines FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.video_timelines FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.video_timelines FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.video_timelines FOR DELETE USING (organization_id = public.get_current_org_id());

CREATE POLICY "Org isolation select" ON public.video_variants FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.video_variants FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.video_variants FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.video_variants FOR DELETE USING (organization_id = public.get_current_org_id());
