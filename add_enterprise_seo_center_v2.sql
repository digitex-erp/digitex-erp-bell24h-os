-- ============================================================================
-- BELL24H-OS ENTERPRISE SEO CENTER v2.0
-- Comprehensive PostgreSQL Schema Migration
-- 19 Production Tables with Multi-Tenant Row Level Security (RLS)
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

-- 2. SEO Keywords
CREATE TABLE IF NOT EXISTS public.seo_keywords (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    keyword TEXT NOT NULL,
    search_volume INTEGER DEFAULT 0,
    difficulty INTEGER DEFAULT 0,
    cpc NUMERIC(8,2) DEFAULT 0.00,
    intent TEXT DEFAULT 'Informational' CHECK (intent IN ('Informational', 'Commercial', 'Transactional', 'Navigational')),
    cluster_name TEXT,
    parent_topic TEXT,
    is_tracked BOOLEAN DEFAULT TRUE,
    current_position INTEGER,
    previous_position INTEGER,
    opportunity_score NUMERIC(5,2) DEFAULT 0.00,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. SEO Keyword Rankings (Historical SERP tracking)
CREATE TABLE IF NOT EXISTS public.seo_keyword_rankings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    keyword_id UUID NOT NULL REFERENCES public.seo_keywords(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    previous_position INTEGER,
    url TEXT,
    search_engine TEXT DEFAULT 'google',
    device TEXT DEFAULT 'desktop' CHECK (device IN ('desktop', 'mobile', 'tablet')),
    country TEXT DEFAULT 'IN',
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. SEO Competitors
CREATE TABLE IF NOT EXISTS public.seo_competitors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    domain TEXT NOT NULL,
    name TEXT,
    authority_score INTEGER DEFAULT 0,
    organic_traffic_estimate INTEGER DEFAULT 0,
    keywords_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. SEO Competitor Keywords
CREATE TABLE IF NOT EXISTS public.seo_competitor_keywords (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    competitor_id UUID NOT NULL REFERENCES public.seo_competitors(id) ON DELETE CASCADE,
    keyword TEXT NOT NULL,
    position INTEGER NOT NULL,
    search_volume INTEGER DEFAULT 0,
    url TEXT,
    overlap_status TEXT DEFAULT 'competitor_only' CHECK (overlap_status IN ('shared', 'competitor_only', 'we_outrank', 'they_outrank')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. SEO Content Gaps
CREATE TABLE IF NOT EXISTS public.seo_content_gaps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    competitor_id UUID REFERENCES public.seo_competitors(id) ON DELETE CASCADE,
    keyword TEXT NOT NULL,
    competitor_url TEXT,
    our_url TEXT,
    gap_type TEXT DEFAULT 'missing_keyword' CHECK (gap_type IN ('missing_keyword', 'missing_topic', 'missing_schema', 'missing_backlink', 'striking_distance')),
    opportunity_score NUMERIC(5,2) DEFAULT 0.00,
    search_volume INTEGER DEFAULT 0,
    difficulty INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. SEO Backlinks
CREATE TABLE IF NOT EXISTS public.seo_backlinks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    source_url TEXT NOT NULL,
    target_url TEXT NOT NULL,
    anchor_text TEXT,
    authority_score INTEGER DEFAULT 0,
    link_type TEXT DEFAULT 'dofollow' CHECK (link_type IN ('dofollow', 'nofollow', 'sponsored', 'ugc')),
    is_toxic BOOLEAN DEFAULT FALSE,
    is_lost BOOLEAN DEFAULT FALSE,
    first_seen TIMESTAMPTZ DEFAULT NOW(),
    last_seen TIMESTAMPTZ DEFAULT NOW()
);

-- 8. SEO Site Audits (Overall crawl sessions)
CREATE TABLE IF NOT EXISTS public.seo_site_audits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    audit_type TEXT DEFAULT 'full_crawl' CHECK (audit_type IN ('full_crawl', 'quick_scan', 'technical_only', 'mobile_only')),
    score INTEGER DEFAULT 100,
    total_pages_crawled INTEGER DEFAULT 0,
    critical_errors_count INTEGER DEFAULT 0,
    warnings_count INTEGER DEFAULT 0,
    notices_count INTEGER DEFAULT 0,
    duration_seconds INTEGER DEFAULT 0,
    status TEXT DEFAULT 'completed' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. SEO Page Audits (Per URL results within an audit)
CREATE TABLE IF NOT EXISTS public.seo_page_audits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    audit_id UUID NOT NULL REFERENCES public.seo_site_audits(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    load_time_ms INTEGER DEFAULT 0,
    title TEXT,
    meta_description TEXT,
    h1 TEXT,
    canonical_url TEXT,
    word_count INTEGER DEFAULT 0,
    internal_links_count INTEGER DEFAULT 0,
    external_links_count INTEGER DEFAULT 0,
    is_indexable BOOLEAN DEFAULT TRUE,
    issues_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. SEO Issues (Actionable items detected during audits)
CREATE TABLE IF NOT EXISTS public.seo_issues (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    audit_id UUID REFERENCES public.seo_site_audits(id) ON DELETE CASCADE,
    page_url TEXT NOT NULL,
    issue_type TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'notice')),
    category TEXT NOT NULL CHECK (category IN ('Indexability', 'Metadata', 'Content', 'Performance', 'Links', 'Security', 'Schema', 'Mobile')),
    message TEXT NOT NULL,
    how_to_fix TEXT,
    is_resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. SEO Schema Markup (JSON-LD structured data)
CREATE TABLE IF NOT EXISTS public.seo_schema_markup (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('Product', 'Organization', 'LocalBusiness', 'FAQPage', 'HowTo', 'Article', 'BreadcrumbList', 'WebSite')),
    entity_id TEXT,
    page_url TEXT,
    schema_json JSONB NOT NULL,
    validation_status TEXT DEFAULT 'valid' CHECK (validation_status IN ('valid', 'warnings', 'invalid')),
    validation_errors JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. SEO Sitemaps
CREATE TABLE IF NOT EXISTS public.seo_sitemaps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    sitemap_url TEXT NOT NULL,
    total_urls INTEGER DEFAULT 0,
    valid_urls INTEGER DEFAULT 0,
    error_urls INTEGER DEFAULT 0,
    last_submitted_at TIMESTAMPTZ,
    gsc_status TEXT DEFAULT 'Success' CHECK (gsc_status IN ('Success', 'Pending', 'Errors', 'Not Submitted')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 13. SEO Redirects
CREATE TABLE IF NOT EXISTS public.seo_redirects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    source_path TEXT NOT NULL,
    target_url TEXT NOT NULL,
    status_code INTEGER DEFAULT 301 CHECK (status_code IN (301, 302, 307, 308)),
    is_active BOOLEAN DEFAULT TRUE,
    hits_count INTEGER DEFAULT 0,
    has_loop BOOLEAN DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 14. SEO Meta Tags
CREATE TABLE IF NOT EXISTS public.seo_meta_tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    page_url TEXT NOT NULL,
    title TEXT NOT NULL,
    meta_description TEXT,
    og_title TEXT,
    og_description TEXT,
    og_image TEXT,
    twitter_card TEXT DEFAULT 'summary_large_image',
    ctr_score NUMERIC(5,2) DEFAULT 0.00,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 15. SEO PageSpeed Reports
CREATE TABLE IF NOT EXISTS public.seo_pagespeed_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    device TEXT DEFAULT 'mobile' CHECK (device IN ('mobile', 'desktop')),
    performance_score INTEGER DEFAULT 0,
    accessibility_score INTEGER DEFAULT 0,
    seo_score INTEGER DEFAULT 0,
    best_practices_score INTEGER DEFAULT 0,
    lcp_ms NUMERIC(7,2),
    fid_ms NUMERIC(7,2),
    cls_score NUMERIC(5,3),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 16. SEO Brand Mentions
CREATE TABLE IF NOT EXISTS public.seo_brand_mentions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    brand_name TEXT NOT NULL,
    source_url TEXT NOT NULL,
    snippet TEXT,
    sentiment TEXT DEFAULT 'neutral' CHECK (sentiment IN ('positive', 'neutral', 'negative')),
    is_linked BOOLEAN DEFAULT FALSE,
    link_type TEXT,
    discovered_at TIMESTAMPTZ DEFAULT NOW()
);

-- 17. SEO AI Visibility (Tracking appearances in ChatGPT, Perplexity, etc.)
CREATE TABLE IF NOT EXISTS public.seo_ai_visibility (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    target_query TEXT NOT NULL,
    engine TEXT NOT NULL CHECK (engine IN ('chatgpt', 'perplexity', 'gemini', 'claude', 'google_aio')),
    is_cited BOOLEAN DEFAULT FALSE,
    mention_position INTEGER,
    cited_snippet TEXT,
    source_url TEXT,
    tracked_at TIMESTAMPTZ DEFAULT NOW()
);

-- 18. SEO Citations (Verified citations in AI answers)
CREATE TABLE IF NOT EXISTS public.seo_citations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    engine TEXT NOT NULL CHECK (engine IN ('chatgpt', 'perplexity', 'gemini', 'claude', 'google_aio')),
    query TEXT NOT NULL,
    quotation_text TEXT NOT NULL,
    cited_url TEXT NOT NULL,
    is_verified BOOLEAN DEFAULT TRUE,
    evidence_score NUMERIC(5,2) DEFAULT 0.00,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 19. SEO Recommendations (Actionable prioritized roadmap)
CREATE TABLE IF NOT EXISTS public.seo_recommendations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.seo_projects(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK (category IN ('Technical', 'Content', 'Backlinks', 'GEO', 'Schema', 'Quick Win')),
    title TEXT NOT NULL,
    impact TEXT NOT NULL CHECK (impact IN ('High', 'Medium', 'Low')),
    effort TEXT NOT NULL CHECK (effort IN ('Low', 'Medium', 'High')),
    description TEXT NOT NULL,
    action_plan JSONB DEFAULT '[]'::jsonb,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'dismissed')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- PERFORMANCE INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_seo_projects_org ON public.seo_projects(organization_id);
CREATE INDEX IF NOT EXISTS idx_seo_keywords_org ON public.seo_keywords(organization_id);
CREATE INDEX IF NOT EXISTS idx_seo_keywords_project ON public.seo_keywords(project_id);
CREATE INDEX IF NOT EXISTS idx_seo_keywords_cluster ON public.seo_keywords(cluster_name);
CREATE INDEX IF NOT EXISTS idx_seo_rankings_kw ON public.seo_keyword_rankings(keyword_id);
CREATE INDEX IF NOT EXISTS idx_seo_competitors_org ON public.seo_competitors(organization_id);
CREATE INDEX IF NOT EXISTS idx_seo_content_gaps_org ON public.seo_content_gaps(organization_id);
CREATE INDEX IF NOT EXISTS idx_seo_backlinks_org ON public.seo_backlinks(organization_id);
CREATE INDEX IF NOT EXISTS idx_seo_audits_org ON public.seo_site_audits(organization_id);
CREATE INDEX IF NOT EXISTS idx_seo_issues_org ON public.seo_issues(organization_id);
CREATE INDEX IF NOT EXISTS idx_seo_schema_org ON public.seo_schema_markup(organization_id);
CREATE INDEX IF NOT EXISTS idx_seo_sitemaps_org ON public.seo_sitemaps(organization_id);
CREATE INDEX IF NOT EXISTS idx_seo_redirects_org ON public.seo_redirects(organization_id);
CREATE INDEX IF NOT EXISTS idx_seo_meta_org ON public.seo_meta_tags(organization_id);
CREATE INDEX IF NOT EXISTS idx_seo_ai_vis_org ON public.seo_ai_visibility(organization_id);
CREATE INDEX IF NOT EXISTS idx_seo_citations_org ON public.seo_citations(organization_id);
CREATE INDEX IF NOT EXISTS idx_seo_recs_org ON public.seo_recommendations(organization_id);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- Multi-Tenant Isolation via public.get_current_org_id()
-- ============================================================================
DO $$
DECLARE
    t TEXT;
    tables TEXT[] := ARRAY[
        'seo_projects',
        'seo_keywords',
        'seo_keyword_rankings',
        'seo_competitors',
        'seo_competitor_keywords',
        'seo_content_gaps',
        'seo_backlinks',
        'seo_site_audits',
        'seo_page_audits',
        'seo_issues',
        'seo_schema_markup',
        'seo_sitemaps',
        'seo_redirects',
        'seo_meta_tags',
        'seo_pagespeed_reports',
        'seo_brand_mentions',
        'seo_ai_visibility',
        'seo_citations',
        'seo_recommendations'
    ];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
        EXECUTE format('DROP POLICY IF EXISTS "Org isolation select" ON public.%I;', t);
        EXECUTE format('DROP POLICY IF EXISTS "Org isolation insert" ON public.%I;', t);
        EXECUTE format('DROP POLICY IF EXISTS "Org isolation update" ON public.%I;', t);
        EXECUTE format('DROP POLICY IF EXISTS "Org isolation delete" ON public.%I;', t);
        
        EXECUTE format('CREATE POLICY "Org isolation select" ON public.%I FOR SELECT USING (organization_id = public.get_current_org_id());', t);
        EXECUTE format('CREATE POLICY "Org isolation insert" ON public.%I FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());', t);
        EXECUTE format('CREATE POLICY "Org isolation update" ON public.%I FOR UPDATE USING (organization_id = public.get_current_org_id());', t);
        EXECUTE format('CREATE POLICY "Org isolation delete" ON public.%I FOR DELETE USING (organization_id = public.get_current_org_id());', t);
    END LOOP;
END
$$;
