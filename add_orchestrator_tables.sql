-- Job Workers
CREATE TABLE IF NOT EXISTS public.job_workers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    worker_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'idle', -- idle, processing, offline
    concurrency_limit INT DEFAULT 1,
    last_heartbeat TIMESTAMPTZ DEFAULT NOW(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE
);

-- Job Schedules
CREATE TABLE IF NOT EXISTS public.job_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    job_type TEXT NOT NULL,
    cron_expression TEXT NOT NULL,
    payload JSONB NOT NULL,
    next_run TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Job Priorities (configuration)
CREATE TABLE IF NOT EXISTS public.job_priorities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE, -- critical, high, medium, low
    level INT NOT NULL
);

INSERT INTO public.job_priorities (name, level) VALUES ('critical', 3), ('high', 2), ('medium', 1), ('low', 0) ON CONFLICT DO NOTHING;

-- RLS
ALTER TABLE public.job_workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_priorities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org isolation select" ON public.job_workers FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation select" ON public.job_schedules FOR SELECT USING (organization_id = public.get_current_org_id());
