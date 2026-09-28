-- Industries
CREATE TABLE IF NOT EXISTS public.industries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Industry Categories
CREATE TABLE IF NOT EXISTS public.industry_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    industry_id UUID REFERENCES public.industries(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(industry_id, name)
);

-- Industry Subcategories
CREATE TABLE IF NOT EXISTS public.industry_subcategories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category_id UUID REFERENCES public.industry_categories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(category_id, name)
);

-- Industry Products
CREATE TABLE IF NOT EXISTS public.industry_products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subcategory_id UUID REFERENCES public.industry_subcategories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Buyer Personas
CREATE TABLE IF NOT EXISTS public.buyer_personas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    industry_id UUID REFERENCES public.industries(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Supplier Personas
CREATE TABLE IF NOT EXISTS public.supplier_personas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    industry_id UUID REFERENCES public.industries(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Apply RLS to all
ALTER TABLE public.industries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.industry_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.industry_subcategories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.industry_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buyer_personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_personas ENABLE ROW LEVEL SECURITY;

-- Policies (Simplified for brevity, following established pattern)
DO $$
DECLARE
    t TEXT;
    tables TEXT[] := ARRAY['industries', 'industry_categories', 'industry_subcategories', 'industry_products', 'buyer_personas', 'supplier_personas'];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        -- Re-runnable: drop first (Phase 2 fix; the original CREATE POLICY failed on a second run).
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
