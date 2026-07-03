-- Job Queue
CREATE TABLE IF NOT EXISTS public.job_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'queued', -- queued, scheduled, preparing, running, paused, retrying, completed, cancelled, failed
    job_type TEXT NOT NULL, -- content, image, video, voice, publishing, seo, automation, analytics
    payload JSONB NOT NULL, -- Job parameters (prompt, model, category, etc.)
    priority TEXT DEFAULT 'medium', -- critical, high, medium, low
    retry_count INT DEFAULT 0,
    max_retries INT DEFAULT 3,
    scheduled_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Job Dependencies
CREATE TABLE IF NOT EXISTS public.job_dependencies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID REFERENCES public.job_queue(id) ON DELETE CASCADE,
    depends_on_job_id UUID REFERENCES public.job_queue(id) ON DELETE CASCADE
);

-- Job Logs
CREATE TABLE IF NOT EXISTS public.job_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID REFERENCES public.job_queue(id) ON DELETE CASCADE,
    level TEXT NOT NULL, -- info, warn, error
    message TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS Policies
ALTER TABLE public.job_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org isolation select" ON public.job_queue FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.job_queue FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.job_queue FOR UPDATE USING (organization_id = public.get_current_org_id());

CREATE POLICY "Org isolation select" ON public.job_dependencies FOR SELECT USING (EXISTS (SELECT 1 FROM public.job_queue WHERE id = job_id AND organization_id = public.get_current_org_id()));
CREATE POLICY "Org isolation insert" ON public.job_dependencies FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.job_queue WHERE id = job_id AND organization_id = public.get_current_org_id()));

CREATE POLICY "Org isolation select" ON public.job_logs FOR SELECT USING (EXISTS (SELECT 1 FROM public.job_queue WHERE id = job_id AND organization_id = public.get_current_org_id()));
