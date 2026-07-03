-- AI Providers Configuration
CREATE TABLE IF NOT EXISTS public.ai_providers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    provider_id TEXT NOT NULL, -- e.g., 'gemini', 'openai', 'anthropic'
    status TEXT DEFAULT 'ACTIVE', -- ACTIVE, INACTIVE, ERROR
    priority INTEGER DEFAULT 0,
    api_key TEXT, -- Encrypted or stored securely in practice
    default_model TEXT,
    temperature NUMERIC DEFAULT 0.7,
    max_tokens INTEGER DEFAULT 2048,
    timeout_ms INTEGER DEFAULT 30000,
    retry_count INTEGER DEFAULT 3,
    last_request_at TIMESTAMPTZ,
    last_error TEXT,
    organization_id UUID REFERENCES public.organizations(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, provider_id)
);

-- AI Request Logs
CREATE TABLE IF NOT EXISTS public.ai_request_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_id UUID REFERENCES public.ai_providers(id) ON DELETE CASCADE,
    model TEXT NOT NULL,
    prompt TEXT,
    response TEXT,
    tokens_used INTEGER,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    latency_ms INTEGER,
    cost NUMERIC DEFAULT 0,
    status TEXT, -- SUCCESS, ERROR
    error_message TEXT,
    organization_id UUID REFERENCES public.organizations(id),
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.ai_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_request_logs ENABLE ROW LEVEL SECURITY;

-- Add RLS policies for ai_providers
CREATE POLICY "Org isolation select" ON public.ai_providers FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.ai_providers FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.ai_providers FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.ai_providers FOR DELETE USING (organization_id = public.get_current_org_id());

-- Add RLS policies for ai_request_logs
CREATE POLICY "Org isolation select" ON public.ai_request_logs FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.ai_request_logs FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.ai_request_logs FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.ai_request_logs FOR DELETE USING (organization_id = public.get_current_org_id());
