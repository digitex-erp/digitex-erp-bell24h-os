-- =============================================================================
-- Industry Intelligence: signals + fixes (Phase 2, item 3).  NOT APPLIED to any database by this change.
-- Requires add_industry_intelligence.sql (industries, industry_categories, ...).  Re-runnable.
--
-- 1. industry_signals — a register of market signals an operator RECORDS, each with its provenance.
--    Nothing here fetches data from anywhere: source_type says where the operator got it
--    ('user_provided' typed in, 'public_api' from a public API they queried, 'web_search' from a web search),
--    and non-user sources must carry a source_url so the claim can be checked. No prediction is stored or made.
-- 2. Fix: industries.name was UNIQUE across ALL organizations, so one organization's "Steel" blocked every other
--    organization's. Uniqueness is now per organization (case-insensitive).
-- 3. Server-only writes for the new table (same model as communication_*): tenants may read their own rows, only the
--    server writes. (The older industry_* tables keep their pre-existing client-write policies; this file does not
--    change them.)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.industry_signals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    industry_id UUID REFERENCES public.industries(id) ON DELETE SET NULL,
    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
    summary TEXT CHECK (summary IS NULL OR char_length(summary) <= 2000),
    signal_type TEXT NOT NULL CHECK (signal_type IN ('demand', 'supply', 'price', 'regulation', 'trend', 'other')),
    source_type TEXT NOT NULL CHECK (source_type IN ('user_provided', 'public_api', 'web_search')),
    source_name TEXT CHECK (source_name IS NULL OR char_length(source_name) <= 100),
    source_url TEXT CHECK (source_url IS NULL OR (char_length(source_url) <= 500 AND source_url ~* '^https?://')),
    observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_rfq_opportunity BOOLEAN NOT NULL DEFAULT FALSE,
    opportunity_note TEXT CHECK (opportunity_note IS NULL OR char_length(opportunity_note) <= 500),
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- provenance rule: anything that did not come from the operator's own knowledge must be checkable
    CONSTRAINT industry_signals_source_url_required CHECK (source_type = 'user_provided' OR source_url IS NOT NULL),
    CONSTRAINT industry_signals_opportunity_note CHECK (is_rfq_opportunity OR opportunity_note IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_industry_signals_org_observed ON public.industry_signals (organization_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_industry_signals_org_industry ON public.industry_signals (organization_id, industry_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_industry_signals_org_opportunity ON public.industry_signals (organization_id) WHERE is_rfq_opportunity;

ALTER TABLE public.industry_signals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org isolation select" ON public.industry_signals;
CREATE POLICY "Org isolation select" ON public.industry_signals FOR SELECT USING (organization_id = public.get_current_org_id());
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.industry_signals FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.industry_signals FROM authenticated';
    END IF;
END $$;

-- Per-organization industry names (replaces the global UNIQUE on name).
ALTER TABLE public.industries DROP CONSTRAINT IF EXISTS industries_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_industries_org_name ON public.industries (organization_id, lower(name));
