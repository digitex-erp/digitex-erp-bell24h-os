-- Image Projects
CREATE TABLE IF NOT EXISTS public.image_projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    brand TEXT,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Image Templates
CREATE TABLE IF NOT EXISTS public.image_templates (
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

-- Image Styles
CREATE TABLE IF NOT EXISTS public.image_styles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    prompt_prefix TEXT,
    negative_prompt TEXT,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Image Jobs
CREATE TABLE IF NOT EXISTS public.image_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES public.image_projects(id) ON DELETE CASCADE,
    template_id UUID REFERENCES public.image_templates(id),
    style_id UUID REFERENCES public.image_styles(id),
    prompt TEXT NOT NULL,
    negative_prompt TEXT,
    category TEXT NOT NULL,
    aspect_ratio TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    batch_size INT DEFAULT 1,
    auto_upscale BOOLEAN DEFAULT false,
    status TEXT DEFAULT 'queued', -- queued, running, completed, failed
    error_message TEXT,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_by UUID REFERENCES public.profiles(id),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Image Assets
CREATE TABLE IF NOT EXISTS public.image_assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID REFERENCES public.image_jobs(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.image_projects(id) ON DELETE CASCADE,
    asset_url TEXT NOT NULL,
    category TEXT,
    prompt TEXT,
    negative_prompt TEXT,
    provider TEXT,
    model TEXT,
    seed BIGINT,
    resolution TEXT,
    generation_time_ms INT,
    cost DECIMAL,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_by UUID REFERENCES public.profiles(id),
    is_favorite BOOLEAN DEFAULT false,
    tags JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Image Variants (Linking multiple variants if needed, though they can just be image_assets tied to same job)
-- Using image_assets for variants as well.

-- RLS Policies
ALTER TABLE public.image_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image_styles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org isolation select" ON public.image_projects FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.image_projects FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.image_projects FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.image_projects FOR DELETE USING (organization_id = public.get_current_org_id());

CREATE POLICY "Org isolation select" ON public.image_templates FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.image_templates FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.image_templates FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.image_templates FOR DELETE USING (organization_id = public.get_current_org_id());

CREATE POLICY "Org isolation select" ON public.image_styles FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.image_styles FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.image_styles FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.image_styles FOR DELETE USING (organization_id = public.get_current_org_id());

CREATE POLICY "Org isolation select" ON public.image_jobs FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.image_jobs FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.image_jobs FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.image_jobs FOR DELETE USING (organization_id = public.get_current_org_id());

CREATE POLICY "Org isolation select" ON public.image_assets FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.image_assets FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.image_assets FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.image_assets FOR DELETE USING (organization_id = public.get_current_org_id());
