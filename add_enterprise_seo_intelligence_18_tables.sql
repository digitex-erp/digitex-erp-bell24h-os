-- ============================================================================
-- BELL24H-OS ENTERPRISE SEO INTELLIGENCE PLATFORM
-- PostgreSQL Migration Script: 18 Production Tables
-- Multi-Tenant Row Level Security (RLS) with public.get_current_org_id()
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Helper function for organization context if not defined
CREATE OR REPLACE FUNCTION public.get_current_org_id()
RETURNS UUID AS $$
BEGIN
    RETURN NULLIF(current_setting('request.jwt.claim.organization_id', true), '')::UUID;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- Drop empty legacy skeleton tables if present to ensure clean schema rebuild
DROP TABLE IF EXISTS 
    public.seo_competitor_keywords,
    public.seo_competitors, 
    public.seo_content_opportunities, 
    public.seo_keyword_clusters, 
    public.seo_keyword_groups,
    public.seo_keyword_rankings,
    public.seo_keywords, 
    public.seo_site_audits,
    public.seo_audit_issues,
    public.seo_meta_tags,
    public.seo_backlinks,
    public.seo_content_scores,
    public.seo_schema_templates,
    public.seo_broken_links,
    public.seo_local_profiles,
    public.seo_geo_audits,
    public.seo_geo_citations,
    public.seo_reports,
    public.seo_alerts,
    public.seo_projects, 
    public.seo_search_intents, 
    public.seo_topics CASCADE;

-- 1. seo_projects
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

-- 2. seo_keywords
CREATE TABLE IF NOT EXISTS public.seo_keywords (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
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

-- 3. seo_keyword_groups
CREATE TABLE IF NOT EXISTS public.seo_keyword_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    parent_topic TEXT NOT NULL,
    primary_intent TEXT DEFAULT 'Commercial',
    total_search_volume INTEGER DEFAULT 0,
    average_difficulty INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. seo_keyword_rankings
CREATE TABLE IF NOT EXISTS public.seo_keyword_rankings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    keyword_id UUID REFERENCES public.seo_keywords(id) ON DELETE CASCADE,
    keyword_text TEXT,
    position INTEGER NOT NULL,
    previous_position INTEGER,
    url TEXT,
    search_engine TEXT DEFAULT 'google' CHECK (search_engine IN ('google', 'bing')),
    device TEXT DEFAULT 'desktop' CHECK (device IN ('desktop', 'mobile', 'local')),
    cadence TEXT DEFAULT 'daily' CHECK (cadence IN ('daily', 'weekly', 'monthly')),
    country TEXT DEFAULT 'IN',
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. seo_site_audits
CREATE TABLE IF NOT EXISTS public.seo_site_audits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    audit_type TEXT DEFAULT 'deep_crawl',
    health_score INTEGER DEFAULT 100,
    pages_crawled INTEGER DEFAULT 0,
    issues_critical INTEGER DEFAULT 0,
    issues_warnings INTEGER DEFAULT 0,
    issues_notices INTEGER DEFAULT 0,
    core_web_vitals_status TEXT DEFAULT 'PASS',
    avg_lcp_ms INTEGER DEFAULT 0,
    avg_fid_ms INTEGER DEFAULT 0,
    avg_cls NUMERIC(6,4) DEFAULT 0.0000,
    crawl_depth INTEGER DEFAULT 3,
    status TEXT DEFAULT 'completed',
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. seo_audit_issues
CREATE TABLE IF NOT EXISTS public.seo_audit_issues (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    audit_id UUID REFERENCES public.seo_site_audits(id) ON DELETE CASCADE,
    issue_type TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'notice')),
    category TEXT NOT NULL,
    message TEXT NOT NULL,
    page_url TEXT NOT NULL,
    how_to_fix TEXT,
    is_resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. seo_meta_tags
CREATE TABLE IF NOT EXISTS public.seo_meta_tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    page_url TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    canonical_url TEXT,
    robots_directive TEXT DEFAULT 'index, follow',
    og_title TEXT,
    og_description TEXT,
    og_image TEXT,
    og_type TEXT DEFAULT 'website',
    twitter_card TEXT DEFAULT 'summary_large_image',
    ai_optimization_status TEXT DEFAULT 'pending',
    ctr_score NUMERIC(5,2) DEFAULT 0.00,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. seo_backlinks
CREATE TABLE IF NOT EXISTS public.seo_backlinks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    source_url TEXT NOT NULL,
    target_url TEXT NOT NULL,
    anchor_text TEXT NOT NULL,
    authority_score INTEGER DEFAULT 0,
    link_type TEXT DEFAULT 'dofollow' CHECK (link_type IN ('dofollow', 'nofollow', 'sponsored', 'ugc')),
    is_toxic BOOLEAN DEFAULT FALSE,
    toxicity_score INTEGER DEFAULT 0,
    is_lost BOOLEAN DEFAULT FALSE,
    first_seen TIMESTAMPTZ DEFAULT NOW(),
    last_seen TIMESTAMPTZ DEFAULT NOW()
);

-- 9. seo_competitors
CREATE TABLE IF NOT EXISTS public.seo_competitors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    domain TEXT NOT NULL,
    name TEXT,
    authority_score INTEGER DEFAULT 0,
    organic_traffic_estimate INTEGER DEFAULT 0,
    keywords_count INTEGER DEFAULT 0,
    ranking_overlap_count INTEGER DEFAULT 0,
    content_gaps_count INTEGER DEFAULT 0,
    backlink_gaps_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. seo_competitor_keywords
CREATE TABLE IF NOT EXISTS public.seo_competitor_keywords (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    competitor_id UUID REFERENCES public.seo_competitors(id) ON DELETE CASCADE,
    keyword TEXT NOT NULL,
    position INTEGER NOT NULL,
    search_volume INTEGER DEFAULT 0,
    url TEXT,
    overlap_status TEXT DEFAULT 'competitor_only' CHECK (overlap_status IN ('shared', 'competitor_only', 'we_outrank', 'they_outrank')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. seo_content_scores
CREATE TABLE IF NOT EXISTS public.seo_content_scores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    page_url TEXT NOT NULL,
    title TEXT NOT NULL,
    word_count INTEGER DEFAULT 0,
    overall_content_score INTEGER DEFAULT 0,
    readability_score NUMERIC(5,2) DEFAULT 0.00,
    semantic_coverage_pct NUMERIC(5,2) DEFAULT 0.00,
    entity_coverage_pct NUMERIC(5,2) DEFAULT 0.00,
    keyword_density_pct NUMERIC(4,2) DEFAULT 0.00,
    topic_authority_score INTEGER DEFAULT 0,
    eeat_signals_score INTEGER DEFAULT 0,
    nlp_entities JSONB DEFAULT '[]'::jsonb,
    missing_topics JSONB DEFAULT '[]'::jsonb,
    recommendations JSONB DEFAULT '[]'::jsonb,
    last_analyzed_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. seo_schema_templates
CREATE TABLE IF NOT EXISTS public.seo_schema_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    page_url TEXT NOT NULL,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('Organization', 'LocalBusiness', 'Product', 'Article', 'FAQ', 'HowTo', 'Breadcrumb', 'Review', 'Event', 'VideoObject')),
    schema_json JSONB NOT NULL,
    validation_status TEXT DEFAULT 'valid' CHECK (validation_status IN ('valid', 'warning', 'invalid')),
    validation_errors JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 13. seo_broken_links
CREATE TABLE IF NOT EXISTS public.seo_broken_links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    page_url TEXT NOT NULL,
    target_url TEXT NOT NULL,
    link_type TEXT DEFAULT 'internal' CHECK (link_type IN ('internal', 'external', 'asset')),
    status_code INTEGER NOT NULL,
    error_type TEXT NOT NULL CHECK (error_type IN ('404', '500', 'redirect_loop', 'missing_asset', 'timeout')),
    is_resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    detected_at TIMESTAMPTZ DEFAULT NOW()
);

-- 14. seo_local_profiles
CREATE TABLE IF NOT EXISTS public.seo_local_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    location_name TEXT NOT NULL,
    hub_city TEXT NOT NULL,
    google_business_status TEXT DEFAULT 'Verified',
    address TEXT,
    phone TEXT,
    review_count INTEGER DEFAULT 0,
    average_rating NUMERIC(3,2) DEFAULT 5.00,
    nap_consistency_score INTEGER DEFAULT 100,
    local_rank INTEGER DEFAULT 1,
    map_pack_presence BOOLEAN DEFAULT TRUE,
    citations_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 15. seo_geo_audits
CREATE TABLE IF NOT EXISTS public.seo_geo_audits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    target_url TEXT NOT NULL,
    geo_score INTEGER DEFAULT 0,
    citation_score INTEGER DEFAULT 0,
    authority_score INTEGER DEFAULT 0,
    structure_score INTEGER DEFAULT 0,
    answerability_score INTEGER DEFAULT 0,
    chatgpt_readiness INTEGER DEFAULT 0,
    claude_readiness INTEGER DEFAULT 0,
    gemini_readiness INTEGER DEFAULT 0,
    perplexity_readiness INTEGER DEFAULT 0,
    google_aio_readiness INTEGER DEFAULT 0,
    missing_entities JSONB DEFAULT '[]'::jsonb,
    missing_citations JSONB DEFAULT '[]'::jsonb,
    recommendations JSONB DEFAULT '[]'::jsonb,
    audited_at TIMESTAMPTZ DEFAULT NOW()
);

-- 16. seo_geo_citations
CREATE TABLE IF NOT EXISTS public.seo_geo_citations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    engine TEXT NOT NULL CHECK (engine IN ('chatgpt', 'claude', 'gemini', 'perplexity', 'google_aio')),
    query TEXT NOT NULL,
    quotation_text TEXT NOT NULL,
    cited_url TEXT NOT NULL,
    is_verified BOOLEAN DEFAULT TRUE,
    evidence_score NUMERIC(5,2) DEFAULT 0.00,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 17. seo_reports
CREATE TABLE IF NOT EXISTS public.seo_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    report_type TEXT NOT NULL CHECK (report_type IN ('executive_summary', 'technical_audit', 'keyword_universe', 'geo_readiness', 'backlink_profile')),
    title TEXT NOT NULL,
    format TEXT DEFAULT 'csv' CHECK (format IN ('csv', 'pdf', 'json')),
    file_url TEXT,
    payload JSONB,
    generated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 18. seo_alerts
CREATE TABLE IF NOT EXISTS public.seo_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    alert_type TEXT NOT NULL CHECK (alert_type IN ('ranking_drop', 'geo_score_drop', 'broken_link', 'toxic_backlink', 'competitor_spike')),
    severity TEXT DEFAULT 'warning' CHECK (severity IN ('critical', 'warning', 'info')),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'acknowledged', 'resolved')),
    triggered_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES ON ALL 18 TABLES
-- ============================================================================

ALTER TABLE public.seo_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_keyword_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_keyword_rankings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_site_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_audit_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_meta_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_backlinks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_competitor_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_content_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_schema_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_broken_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_local_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_geo_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_geo_citations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_alerts ENABLE ROW LEVEL SECURITY;

-- Macro to assign multi-tenant RLS to all 18 tables
DO $$
DECLARE
    tbl text;
    tables text[] := ARRAY[
        'seo_projects', 'seo_keywords', 'seo_keyword_groups', 'seo_keyword_rankings',
        'seo_site_audits', 'seo_audit_issues', 'seo_meta_tags', 'seo_backlinks',
        'seo_competitors', 'seo_competitor_keywords', 'seo_content_scores', 'seo_schema_templates',
        'seo_broken_links', 'seo_local_profiles', 'seo_geo_audits', 'seo_geo_citations',
        'seo_reports', 'seo_alerts'
    ];
BEGIN
    FOREACH tbl IN ARRAY tables LOOP
        EXECUTE format('DROP POLICY IF EXISTS "tenant_isolation_select" ON public.%I', tbl);
        EXECUTE format('DROP POLICY IF EXISTS "tenant_isolation_insert" ON public.%I', tbl);
        EXECUTE format('DROP POLICY IF EXISTS "tenant_isolation_update" ON public.%I', tbl);
        EXECUTE format('DROP POLICY IF EXISTS "tenant_isolation_delete" ON public.%I', tbl);

        EXECUTE format('CREATE POLICY "tenant_isolation_select" ON public.%I FOR SELECT USING (organization_id = public.get_current_org_id() OR public.get_current_org_id() IS NULL)', tbl);
        EXECUTE format('CREATE POLICY "tenant_isolation_insert" ON public.%I FOR INSERT WITH CHECK (organization_id = public.get_current_org_id() OR public.get_current_org_id() IS NULL)', tbl);
        EXECUTE format('CREATE POLICY "tenant_isolation_update" ON public.%I FOR UPDATE USING (organization_id = public.get_current_org_id() OR public.get_current_org_id() IS NULL)', tbl);
        EXECUTE format('CREATE POLICY "tenant_isolation_delete" ON public.%I FOR DELETE USING (organization_id = public.get_current_org_id() OR public.get_current_org_id() IS NULL)', tbl);
    END LOOP;
END $$;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_seo_keywords_org_proj ON public.seo_keywords(organization_id, project_id);
CREATE INDEX IF NOT EXISTS idx_seo_rankings_org_kw ON public.seo_keyword_rankings(organization_id, keyword_id);
CREATE INDEX IF NOT EXISTS idx_seo_audits_org_proj ON public.seo_site_audits(organization_id, project_id);
CREATE INDEX IF NOT EXISTS idx_seo_broken_links_org ON public.seo_broken_links(organization_id, project_id);
CREATE INDEX IF NOT EXISTS idx_seo_content_scores_url ON public.seo_content_scores(organization_id, page_url);
CREATE INDEX IF NOT EXISTS idx_seo_geo_audits_org ON public.seo_geo_audits(organization_id, project_id);
