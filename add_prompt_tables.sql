-- Prompt Categories
CREATE TABLE IF NOT EXISTS public.prompt_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    organization_id UUID REFERENCES public.organizations(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Prompt Templates
CREATE TABLE IF NOT EXISTS public.prompt_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    description TEXT,
    category_id UUID REFERENCES public.prompt_categories(id),
    category TEXT, -- Also keeping text category for easy fallback
    provider TEXT, -- Preferred provider
    default_model TEXT,
    temperature NUMERIC DEFAULT 0.7,
    max_tokens INTEGER DEFAULT 2048,
    system_prompt TEXT,
    user_prompt TEXT NOT NULL,
    tags TEXT[],
    version INTEGER DEFAULT 1,
    organization_id UUID REFERENCES public.organizations(id),
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Prompt Versions
CREATE TABLE IF NOT EXISTS public.prompt_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_id UUID REFERENCES public.prompt_templates(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    system_prompt TEXT,
    user_prompt TEXT NOT NULL,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Prompt Variables
CREATE TABLE IF NOT EXISTS public.prompt_variables (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_id UUID REFERENCES public.prompt_templates(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    default_value TEXT,
    is_required BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Prompt Executions
CREATE TABLE IF NOT EXISTS public.prompt_executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_id UUID REFERENCES public.prompt_templates(id) ON DELETE SET NULL,
    variables_json JSONB,
    response_text TEXT,
    ai_log_id UUID REFERENCES public.ai_request_logs(id) ON DELETE SET NULL,
    organization_id UUID REFERENCES public.organizations(id),
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Prompt Favorites
CREATE TABLE IF NOT EXISTS public.prompt_favorites (
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    template_id UUID REFERENCES public.prompt_templates(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, template_id)
);

-- RLS
ALTER TABLE public.prompt_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_variables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org isolation select" ON public.prompt_categories FOR SELECT USING (organization_id = public.get_current_org_id() OR organization_id IS NULL);
CREATE POLICY "Org isolation insert" ON public.prompt_categories FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.prompt_categories FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.prompt_categories FOR DELETE USING (organization_id = public.get_current_org_id());

CREATE POLICY "Org isolation select" ON public.prompt_templates FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.prompt_templates FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.prompt_templates FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.prompt_templates FOR DELETE USING (organization_id = public.get_current_org_id());

CREATE POLICY "Org isolation select" ON public.prompt_versions FOR SELECT USING (EXISTS (SELECT 1 FROM public.prompt_templates WHERE id = template_id AND organization_id = public.get_current_org_id()));
CREATE POLICY "Org isolation insert" ON public.prompt_versions FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.prompt_templates WHERE id = template_id AND organization_id = public.get_current_org_id()));
CREATE POLICY "Org isolation update" ON public.prompt_versions FOR UPDATE USING (EXISTS (SELECT 1 FROM public.prompt_templates WHERE id = template_id AND organization_id = public.get_current_org_id()));
CREATE POLICY "Org isolation delete" ON public.prompt_versions FOR DELETE USING (EXISTS (SELECT 1 FROM public.prompt_templates WHERE id = template_id AND organization_id = public.get_current_org_id()));

CREATE POLICY "Org isolation select" ON public.prompt_variables FOR SELECT USING (EXISTS (SELECT 1 FROM public.prompt_templates WHERE id = template_id AND organization_id = public.get_current_org_id()));
CREATE POLICY "Org isolation insert" ON public.prompt_variables FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.prompt_templates WHERE id = template_id AND organization_id = public.get_current_org_id()));
CREATE POLICY "Org isolation update" ON public.prompt_variables FOR UPDATE USING (EXISTS (SELECT 1 FROM public.prompt_templates WHERE id = template_id AND organization_id = public.get_current_org_id()));
CREATE POLICY "Org isolation delete" ON public.prompt_variables FOR DELETE USING (EXISTS (SELECT 1 FROM public.prompt_templates WHERE id = template_id AND organization_id = public.get_current_org_id()));

CREATE POLICY "Org isolation select" ON public.prompt_executions FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.prompt_executions FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.prompt_executions FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.prompt_executions FOR DELETE USING (organization_id = public.get_current_org_id());

CREATE POLICY "User isolation select" ON public.prompt_favorites FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "User isolation insert" ON public.prompt_favorites FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "User isolation delete" ON public.prompt_favorites FOR DELETE USING (user_id = auth.uid());

