-- Additional SEO Intelligence Tables

CREATE TABLE IF NOT EXISTS public.seo_search_intents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE -- Informational, Commercial, Transactional, etc.
);

CREATE TABLE IF NOT EXISTS public.seo_topics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    seo_keyword_cluster_id UUID REFERENCES public.seo_keyword_clusters(id)
);

CREATE TABLE IF NOT EXISTS public.seo_content_opportunities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    seo_keyword_id UUID REFERENCES public.seo_keywords(id),
    opportunity_score INTEGER DEFAULT 0,
    recommended_content_type TEXT
);

CREATE TABLE IF NOT EXISTS public.seo_competitors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    website TEXT NOT NULL,
    domain_authority INTEGER DEFAULT 0
);

-- Apply RLS
ALTER TABLE public.seo_search_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_content_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_competitors ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    t TEXT;
    tables TEXT[] := ARRAY['seo_topics', 'seo_content_opportunities', 'seo_competitors'];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        EXECUTE format('CREATE POLICY "Org isolation select" ON public.%I FOR SELECT USING (organization_id = public.get_current_org_id());', t);
        EXECUTE format('CREATE POLICY "Org isolation insert" ON public.%I FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());', t);
    END LOOP;
END
$$;
