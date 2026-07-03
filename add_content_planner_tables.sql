-- Content Projects
CREATE TABLE IF NOT EXISTS public.content_projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    brand TEXT,
    language TEXT,
    industry TEXT,
    target_audience TEXT,
    country TEXT,
    tone TEXT,
    content_goal TEXT,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Content Topics
CREATE TABLE IF NOT EXISTS public.content_topics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES public.content_projects(id) ON DELETE CASCADE,
    topic TEXT NOT NULL,
    source TEXT DEFAULT 'manual', -- manual, csv, keyword, search_console
    status TEXT DEFAULT 'pending', -- pending, generating, completed, failed
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Content Jobs
CREATE TABLE IF NOT EXISTS public.content_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    topic_id UUID REFERENCES public.content_topics(id) ON DELETE CASCADE,
    content_type TEXT NOT NULL,
    status TEXT DEFAULT 'queued', -- queued, running, completed, failed
    error_message TEXT,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Content Outputs
CREATE TABLE IF NOT EXISTS public.content_outputs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID REFERENCES public.content_jobs(id) ON DELETE CASCADE,
    topic_id UUID REFERENCES public.content_topics(id) ON DELETE CASCADE,
    content_type TEXT NOT NULL,
    content TEXT NOT NULL,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Content Assets
CREATE TABLE IF NOT EXISTS public.content_assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    output_id UUID REFERENCES public.content_outputs(id) ON DELETE CASCADE,
    asset_url TEXT NOT NULL,
    asset_type TEXT NOT NULL,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS Policies
ALTER TABLE public.content_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org isolation select" ON public.content_projects FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.content_projects FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.content_projects FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.content_projects FOR DELETE USING (organization_id = public.get_current_org_id());

CREATE POLICY "Org isolation select" ON public.content_topics FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.content_topics FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.content_topics FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.content_topics FOR DELETE USING (organization_id = public.get_current_org_id());

CREATE POLICY "Org isolation select" ON public.content_jobs FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.content_jobs FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.content_jobs FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.content_jobs FOR DELETE USING (organization_id = public.get_current_org_id());

CREATE POLICY "Org isolation select" ON public.content_outputs FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.content_outputs FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.content_outputs FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.content_outputs FOR DELETE USING (organization_id = public.get_current_org_id());

CREATE POLICY "Org isolation select" ON public.content_assets FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.content_assets FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.content_assets FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.content_assets FOR DELETE USING (organization_id = public.get_current_org_id());
