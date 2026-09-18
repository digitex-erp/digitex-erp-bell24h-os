-- ============================================================================
-- BELL24H-OS ENTERPRISE SEO CENTER v3.0
-- Comprehensive PostgreSQL Schema Migration
-- 15 Production Tables with Multi-Tenant Row Level Security (RLS)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. SEO Projects
CREATE TABLE IF NOT EXISTS public.seo_projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    domain TEXT NOT NULL,
    target_country TEXT DEFAULT 'IN',
    target_language TEXT DEFAULT 'en',
    industry_id UUID REFERENCES public.industries(id) ON DELETE SET NULL,
    settings JSONB DEFAULT '{"crawler_depth": 3, "auto_audit_frequency": "weekly", "track_ai_citations": true}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Keyword Clusters
CREATE TABLE IF NOT EXISTS public.keyword_clusters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    cluster_name TEXT NOT NULL,
    parent_topic TEXT NOT NULL,
    intent_primary TEXT DEFAULT 'Commercial',
    total_search_volume INTEGER DEFAULT 0,
    average_difficulty INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. SEO Keywords
CREATE TABLE IF NOT EXISTS public.seo_keywords (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    cluster_id UUID REFERENCES public.keyword_clusters(id) ON DELETE SET NULL,
    keyword TEXT NOT NULL,
    search_volume INTEGER DEFAULT 0,
    difficulty INTEGER DEFAULT 0,
    cpc NUMERIC(8,2) DEFAULT 0.00,
    intent TEXT DEFAULT 'Commercial' CHECK (intent IN ('Informational', 'Commercial', 'Transactional', 'Navigational')),
    cluster_name TEXT,
    parent_topic TEXT,
    is_tracked BOOLEAN DEFAULT TRUE,
    current_position INTEGER,
    previous_position INTEGER,
    opportunity_score NUMERIC(5,2) DEFAULT 0.00,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. SEO Keyword Rankings (Historical Daily SERP tracking)
CREATE TABLE IF NOT EXISTS public.seo_rankings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    keyword_id UUID REFERENCES public.seo_keywords(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    previous_position INTEGER,
    url TEXT,
    search_engine TEXT DEFAULT 'google' CHECK (search_engine IN ('google', 'bing')),
    device TEXT DEFAULT 'desktop' CHECK (device IN ('desktop', 'mobile', 'local')),
    country TEXT DEFAULT 'IN',
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. SEO Technical Audits
CREATE TABLE IF NOT EXISTS public.seo_audits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    audit_type TEXT DEFAULT 'full_crawl',
    health_score INTEGER NOT NULL CHECK (health_score BETWEEN 0 AND 100),
    pages_crawled INTEGER DEFAULT 0,
    issues_critical INTEGER DEFAULT 0,
    issues_warnings INTEGER DEFAULT 0,
    issues_notices INTEGER DEFAULT 0,
    core_web_vitals_status TEXT DEFAULT 'Passed',
    avg_lcp_ms INTEGER DEFAULT 1200,
    avg_fid_ms INTEGER DEFAULT 15,
    avg_cls NUMERIC(4,3) DEFAULT 0.02,
    issues_json JSONB DEFAULT '[]'::jsonb,
    completed_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. SEO Meta Tag Management
CREATE TABLE IF NOT EXISTS public.seo_meta_tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    page_url TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    canonical_url TEXT,
    robots_directive TEXT DEFAULT 'index, follow',
    og_title TEXT,
    og_description TEXT,
    og_image TEXT,
    og_type TEXT DEFAULT 'website',
    twitter_card TEXT DEFAULT 'summary_large_image',
    ai_optimization_status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. SEO Schema Markup Manager
CREATE TABLE IF NOT EXISTS public.seo_schemas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    page_url TEXT NOT NULL,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('Organization', 'LocalBusiness', 'Product', 'FAQPage', 'Article', 'HowTo', 'Event', 'VideoObject', 'BreadcrumbList', 'Review')),
    schema_json JSONB NOT NULL,
    validation_status TEXT DEFAULT 'valid' CHECK (validation_status IN ('valid', 'warning', 'invalid')),
    validation_errors JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. SEO Content Analysis & Inventory
CREATE TABLE IF NOT EXISTS public.seo_content_analysis (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    page_url TEXT NOT NULL,
    title TEXT NOT NULL,
    word_count INTEGER DEFAULT 0,
    topic_cluster TEXT,
    content_score INTEGER DEFAULT 80 CHECK (content_score BETWEEN 0 AND 100),
    topical_coverage_pct NUMERIC(5,2) DEFAULT 85.00,
    entity_coverage_pct NUMERIC(5,2) DEFAULT 90.00,
    nlp_keywords JSONB DEFAULT '[]'::jsonb,
    missing_topics JSONB DEFAULT '[]'::jsonb,
    traffic_potential TEXT DEFAULT 'High',
    last_crawled_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. SEO Content Briefs (AI Generator)
CREATE TABLE IF NOT EXISTS public.seo_content_briefs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    target_topic TEXT NOT NULL,
    target_intent TEXT DEFAULT 'Commercial',
    target_word_count INTEGER DEFAULT 1800,
    target_keywords JSONB DEFAULT '[]'::jsonb,
    heading_outline JSONB DEFAULT '[]'::jsonb,
    suggested_faqs JSONB DEFAULT '[]'::jsonb,
    internal_linking_suggestions JSONB DEFAULT '[]'::jsonb,
    eeat_guidelines TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. SEO Competitor Intelligence
CREATE TABLE IF NOT EXISTS public.seo_competitors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    domain TEXT NOT NULL,
    name TEXT NOT NULL,
    authority_score INTEGER DEFAULT 50,
    organic_traffic_estimate INTEGER DEFAULT 0,
    keywords_count INTEGER DEFAULT 0,
    ranking_overlap_count INTEGER DEFAULT 0,
    content_gaps_count INTEGER DEFAULT 0,
    backlink_gaps_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. SEO Backlink Intelligence
CREATE TABLE IF NOT EXISTS public.seo_backlinks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    source_url TEXT NOT NULL,
    target_url TEXT NOT NULL,
    anchor_text TEXT NOT NULL,
    authority_score INTEGER DEFAULT 45,
    link_type TEXT DEFAULT 'dofollow' CHECK (link_type IN ('dofollow', 'nofollow', 'ugc', 'sponsored')),
    is_toxic BOOLEAN DEFAULT FALSE,
    is_lost BOOLEAN DEFAULT FALSE,
    first_seen TIMESTAMPTZ DEFAULT NOW(),
    last_seen TIMESTAMPTZ DEFAULT NOW()
);

-- 12. Local SEO & Cluster Rankings
CREATE TABLE IF NOT EXISTS public.seo_local_rankings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    location_name TEXT NOT NULL,
    hub_city TEXT NOT NULL,
    google_business_status TEXT DEFAULT 'Verified',
    review_count INTEGER DEFAULT 0,
    average_rating NUMERIC(3,2) DEFAULT 5.00,
    nap_consistency_score INTEGER DEFAULT 95 CHECK (nap_consistency_score BETWEEN 0 AND 100),
    local_rank INTEGER DEFAULT 1,
    map_pack_presence BOOLEAN DEFAULT TRUE,
    citations_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 13. GEO (Generative Engine Optimization) Audits
CREATE TABLE IF NOT EXISTS public.seo_geo_audits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    target_url TEXT NOT NULL,
    geo_score INTEGER NOT NULL CHECK (geo_score BETWEEN 0 AND 100),
    chatgpt_readiness INTEGER DEFAULT 88 CHECK (chatgpt_readiness BETWEEN 0 AND 100),
    claude_readiness INTEGER DEFAULT 92 CHECK (claude_readiness BETWEEN 0 AND 100),
    gemini_readiness INTEGER DEFAULT 85 CHECK (gemini_readiness BETWEEN 0 AND 100),
    perplexity_readiness INTEGER DEFAULT 94 CHECK (perplexity_readiness BETWEEN 0 AND 100),
    citation_probability INTEGER DEFAULT 90 CHECK (citation_probability BETWEEN 0 AND 100),
    authority_score INTEGER DEFAULT 86 CHECK (authority_score BETWEEN 0 AND 100),
    structure_score INTEGER DEFAULT 92 CHECK (structure_score BETWEEN 0 AND 100),
    eeat_score INTEGER DEFAULT 89 CHECK (eeat_score BETWEEN 0 AND 100),
    ai_visibility_score INTEGER DEFAULT 87 CHECK (ai_visibility_score BETWEEN 0 AND 100),
    missing_entities JSONB DEFAULT '[]'::jsonb,
    missing_citations JSONB DEFAULT '[]'::jsonb,
    missing_schema JSONB DEFAULT '[]'::jsonb,
    recommendations JSONB DEFAULT '[]'::jsonb,
    audited_at TIMESTAMPTZ DEFAULT NOW()
);

-- 14. SEO Recommendations & Action Plan
CREATE TABLE IF NOT EXISTS public.seo_recommendations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT DEFAULT 'Keywords' CHECK (category IN ('Keywords', 'Technical', 'Content', 'Backlinks', 'GEO', 'Schema', 'Local')),
    priority TEXT DEFAULT 'Medium' CHECK (priority IN ('Critical', 'High', 'Medium', 'Low')),
    effort TEXT DEFAULT 'Quick Win' CHECK (effort IN ('Quick Win', 'Medium', 'High')),
    impact TEXT DEFAULT 'High' CHECK (impact IN ('High', 'Medium', 'Low')),
    estimated_traffic_lift TEXT,
    is_completed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 15. SEO Automation Tasks & Rules
CREATE TABLE IF NOT EXISTS public.seo_tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    trigger_type TEXT NOT NULL CHECK (trigger_type IN ('ranking_drop', 'new_competitor', 'broken_link', 'missing_meta', 'geo_score_drop')),
    action_type TEXT NOT NULL CHECK (action_type IN ('notify_admin', 'create_task', 'generate_content', 'auto_fix')),
    threshold_value TEXT,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed')),
    last_triggered_at TIMESTAMPTZ,
    execution_payload JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- PERFORMANCE INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_seo_projects_org ON public.seo_projects(organization_id);
CREATE INDEX IF NOT EXISTS idx_seo_keywords_org ON public.seo_keywords(organization_id);
CREATE INDEX IF NOT EXISTS idx_seo_keywords_proj ON public.seo_keywords(project_id);
CREATE INDEX IF NOT EXISTS idx_seo_rankings_kw ON public.seo_rankings(keyword_id);
CREATE INDEX IF NOT EXISTS idx_seo_rankings_org ON public.seo_rankings(organization_id);
CREATE INDEX IF NOT EXISTS idx_seo_audits_proj ON public.seo_audits(project_id);
CREATE INDEX IF NOT EXISTS idx_seo_meta_tags_proj ON public.seo_meta_tags(project_id);
CREATE INDEX IF NOT EXISTS idx_seo_schemas_proj ON public.seo_schemas(project_id);
CREATE INDEX IF NOT EXISTS idx_seo_content_proj ON public.seo_content_analysis(project_id);
CREATE INDEX IF NOT EXISTS idx_seo_competitors_proj ON public.seo_competitors(project_id);
CREATE INDEX IF NOT EXISTS idx_seo_backlinks_proj ON public.seo_backlinks(project_id);
CREATE INDEX IF NOT EXISTS idx_seo_geo_audits_proj ON public.seo_geo_audits(project_id);
CREATE INDEX IF NOT EXISTS idx_seo_tasks_proj ON public.seo_tasks(project_id);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================
ALTER TABLE public.seo_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.keyword_clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_rankings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_meta_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_schemas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_content_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_content_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_backlinks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_local_rankings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_geo_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_tasks ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'seo_projects_tenant_isolation') THEN
        CREATE POLICY seo_projects_tenant_isolation ON public.seo_projects FOR ALL USING (organization_id = public.get_current_org_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'keyword_clusters_tenant_isolation') THEN
        CREATE POLICY keyword_clusters_tenant_isolation ON public.keyword_clusters FOR ALL USING (organization_id = public.get_current_org_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'seo_keywords_tenant_isolation') THEN
        CREATE POLICY seo_keywords_tenant_isolation ON public.seo_keywords FOR ALL USING (organization_id = public.get_current_org_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'seo_rankings_tenant_isolation') THEN
        CREATE POLICY seo_rankings_tenant_isolation ON public.seo_rankings FOR ALL USING (organization_id = public.get_current_org_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'seo_audits_tenant_isolation') THEN
        CREATE POLICY seo_audits_tenant_isolation ON public.seo_audits FOR ALL USING (organization_id = public.get_current_org_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'seo_meta_tags_tenant_isolation') THEN
        CREATE POLICY seo_meta_tags_tenant_isolation ON public.seo_meta_tags FOR ALL USING (organization_id = public.get_current_org_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'seo_schemas_tenant_isolation') THEN
        CREATE POLICY seo_schemas_tenant_isolation ON public.seo_schemas FOR ALL USING (organization_id = public.get_current_org_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'seo_content_analysis_tenant_isolation') THEN
        CREATE POLICY seo_content_analysis_tenant_isolation ON public.seo_content_analysis FOR ALL USING (organization_id = public.get_current_org_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'seo_content_briefs_tenant_isolation') THEN
        CREATE POLICY seo_content_briefs_tenant_isolation ON public.seo_content_briefs FOR ALL USING (organization_id = public.get_current_org_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'seo_competitors_tenant_isolation') THEN
        CREATE POLICY seo_competitors_tenant_isolation ON public.seo_competitors FOR ALL USING (organization_id = public.get_current_org_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'seo_backlinks_tenant_isolation') THEN
        CREATE POLICY seo_backlinks_tenant_isolation ON public.seo_backlinks FOR ALL USING (organization_id = public.get_current_org_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'seo_local_rankings_tenant_isolation') THEN
        CREATE POLICY seo_local_rankings_tenant_isolation ON public.seo_local_rankings FOR ALL USING (organization_id = public.get_current_org_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'seo_geo_audits_tenant_isolation') THEN
        CREATE POLICY seo_geo_audits_tenant_isolation ON public.seo_geo_audits FOR ALL USING (organization_id = public.get_current_org_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'seo_recommendations_tenant_isolation') THEN
        CREATE POLICY seo_recommendations_tenant_isolation ON public.seo_recommendations FOR ALL USING (organization_id = public.get_current_org_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'seo_tasks_tenant_isolation') THEN
        CREATE POLICY seo_tasks_tenant_isolation ON public.seo_tasks FOR ALL USING (organization_id = public.get_current_org_id());
    END IF;
END $$;
