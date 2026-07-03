-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Drop existing tables if necessary to avoid conflicts during testing
-- We will only create tables IF NOT EXISTS for safety.

-- 1. Organizations
CREATE TABLE IF NOT EXISTS public.organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    legal_name TEXT,
    description TEXT,
    industry TEXT,
    slug TEXT UNIQUE,
    domain TEXT,
    website TEXT,
    gst_number TEXT,
    pan_number TEXT,
    iec_number TEXT,
    cin TEXT,
    msme_number TEXT,
    company_email TEXT,
    phone_number TEXT,
    addresses JSONB DEFAULT '{}',
    settings JSONB DEFAULT '{}',
    logo_url TEXT,
    plan TEXT DEFAULT 'FREE',
    billing_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 2. Profiles (extend auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    first_name TEXT,
    last_name TEXT,
    avatar_url TEXT,
    organization_id UUID REFERENCES public.organizations(id),
    is_active BOOLEAN DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- Function to get current user's organization
CREATE OR REPLACE FUNCTION public.get_current_org_id()
RETURNS UUID AS $$
DECLARE
    org_id UUID;
BEGIN
    SELECT organization_id INTO org_id
    FROM public.profiles
    WHERE id = auth.uid();
    RETURN org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Roles
CREATE TABLE IF NOT EXISTS public.roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    is_system BOOLEAN DEFAULT FALSE,
    organization_id UUID REFERENCES public.organizations(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 4. Permissions
CREATE TABLE IF NOT EXISTS public.permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    action TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. User Roles (Mapping)
CREATE TABLE IF NOT EXISTS public.user_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    role_id UUID REFERENCES public.roles(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES public.organizations(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, role_id)
);

-- 6. Companies
CREATE TABLE IF NOT EXISTS public.companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    industry TEXT,
    website TEXT,
    organization_id UUID REFERENCES public.organizations(id),
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 7. Buyers
CREATE TABLE IF NOT EXISTS public.buyers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES public.companies(id),
    name TEXT NOT NULL,
    organization_id UUID REFERENCES public.organizations(id),
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 8. Suppliers
CREATE TABLE IF NOT EXISTS public.suppliers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES public.companies(id),
    name TEXT NOT NULL,
    organization_id UUID REFERENCES public.organizations(id),
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 9. Contacts
CREATE TABLE IF NOT EXISTS public.contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES public.companies(id),
    first_name TEXT,
    last_name TEXT,
    email TEXT,
    phone TEXT,
    organization_id UUID REFERENCES public.organizations(id),
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 10. Categories
CREATE TABLE IF NOT EXISTS public.categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    parent_id UUID REFERENCES public.categories(id),
    organization_id UUID REFERENCES public.organizations(id),
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 11. Products
CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    sku TEXT,
    category_id UUID REFERENCES public.categories(id),
    price NUMERIC(10, 2),
    organization_id UUID REFERENCES public.organizations(id),
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 12. RFQs
CREATE TABLE IF NOT EXISTS public.rfqs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    status TEXT DEFAULT 'DRAFT',
    due_date TIMESTAMPTZ,
    organization_id UUID REFERENCES public.organizations(id),
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 13. RFQ Items
CREATE TABLE IF NOT EXISTS public.rfq_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rfq_id UUID REFERENCES public.rfqs(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id),
    quantity NUMERIC NOT NULL,
    organization_id UUID REFERENCES public.organizations(id),
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 14. Quotations
CREATE TABLE IF NOT EXISTS public.quotations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rfq_id UUID REFERENCES public.rfqs(id),
    supplier_id UUID REFERENCES public.suppliers(id),
    status TEXT DEFAULT 'PENDING',
    total_amount NUMERIC(15, 2),
    organization_id UUID REFERENCES public.organizations(id),
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 15. Quotation Items
CREATE TABLE IF NOT EXISTS public.quotation_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    quotation_id UUID REFERENCES public.quotations(id) ON DELETE CASCADE,
    rfq_item_id UUID REFERENCES public.rfq_items(id),
    unit_price NUMERIC(15, 2),
    organization_id UUID REFERENCES public.organizations(id),
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 16. Orders
CREATE TABLE IF NOT EXISTS public.orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    quotation_id UUID REFERENCES public.quotations(id),
    buyer_id UUID REFERENCES public.buyers(id),
    supplier_id UUID REFERENCES public.suppliers(id),
    status TEXT DEFAULT 'CREATED',
    total_amount NUMERIC(15, 2),
    organization_id UUID REFERENCES public.organizations(id),
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 17. Order Items
CREATE TABLE IF NOT EXISTS public.order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id),
    quantity NUMERIC NOT NULL,
    unit_price NUMERIC(15, 2),
    organization_id UUID REFERENCES public.organizations(id),
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 18. Tasks
CREATE TABLE IF NOT EXISTS public.tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'TODO',
    assignee_id UUID REFERENCES public.profiles(id),
    organization_id UUID REFERENCES public.organizations(id),
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 19. Notes
CREATE TABLE IF NOT EXISTS public.notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    content TEXT NOT NULL,
    entity_type TEXT NOT NULL, -- e.g. 'COMPANY', 'CONTACT', 'ORDER'
    entity_id UUID NOT NULL,
    organization_id UUID REFERENCES public.organizations(id),
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 20. Attachments
CREATE TABLE IF NOT EXISTS public.attachments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    file_name TEXT NOT NULL,
    file_url TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    organization_id UUID REFERENCES public.organizations(id),
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 21. Notifications
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    organization_id UUID REFERENCES public.organizations(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 22. Activities
CREATE TABLE IF NOT EXISTS public.activities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id UUID,
    organization_id UUID REFERENCES public.organizations(id),
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 23. Audit Logs
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    action TEXT NOT NULL,
    details JSONB,
    ip_address TEXT,
    organization_id UUID REFERENCES public.organizations(id),
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 24. API Keys
CREATE TABLE IF NOT EXISTS public.api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    organization_id UUID REFERENCES public.organizations(id),
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 25. AI Agents
CREATE TABLE IF NOT EXISTS public.ai_agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    model TEXT NOT NULL,
    system_prompt TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    organization_id UUID REFERENCES public.organizations(id),
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 26. AI Jobs
CREATE TABLE IF NOT EXISTS public.ai_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID REFERENCES public.ai_agents(id),
    status TEXT DEFAULT 'PENDING',
    result JSONB,
    organization_id UUID REFERENCES public.organizations(id),
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 27. SEO Projects
CREATE TABLE IF NOT EXISTS public.seo_projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    domain TEXT NOT NULL,
    organization_id UUID REFERENCES public.organizations(id),
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 28. Social Accounts
CREATE TABLE IF NOT EXISTS public.social_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    platform TEXT NOT NULL,
    account_name TEXT,
    organization_id UUID REFERENCES public.organizations(id),
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 29. Social Posts
CREATE TABLE IF NOT EXISTS public.social_posts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID REFERENCES public.social_accounts(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    status TEXT DEFAULT 'DRAFT',
    scheduled_for TIMESTAMPTZ,
    organization_id UUID REFERENCES public.organizations(id),
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 30. Campaigns
CREATE TABLE IF NOT EXISTS public.campaigns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    status TEXT DEFAULT 'PLANNING',
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ,
    organization_id UUID REFERENCES public.organizations(id),
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 31. Workflows
CREATE TABLE IF NOT EXISTS public.workflows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    trigger TEXT NOT NULL,
    is_active BOOLEAN DEFAULT FALSE,
    organization_id UUID REFERENCES public.organizations(id),
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 32. Workflow Runs
CREATE TABLE IF NOT EXISTS public.workflow_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_id UUID REFERENCES public.workflows(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'RUNNING',
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    organization_id UUID REFERENCES public.organizations(id),
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 33. Tags
CREATE TABLE IF NOT EXISTS public.tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    color TEXT,
    organization_id UUID REFERENCES public.organizations(id),
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 34. Tag Relations
CREATE TABLE IF NOT EXISTS public.tag_relations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tag_id UUID REFERENCES public.tags(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    organization_id UUID REFERENCES public.organizations(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- Trigger for auth.users to create public.profiles
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (new.id, new.email);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Enable RLS and create policies
-- For organizations, a user can see their own org.
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own organization" ON public.organizations;
CREATE POLICY "Users can view their own organization" ON public.organizations
FOR SELECT USING (
  id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
);

-- Base policy for all other tables:
-- Users can read/write data in their organization.
-- For profiles, users can see members of their own organization or themselves.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own profile or org members" ON public.profiles;
CREATE POLICY "Users can view own profile or org members" ON public.profiles
FOR SELECT USING (
  id = auth.uid() OR (organization_id IS NOT NULL AND organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid()))
);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
FOR UPDATE USING (
  id = auth.uid()
);

-- Generate policies for all org_id dependent tables
DO $$
DECLARE
    t TEXT;
    tables TEXT[] := ARRAY[
        'roles', 'user_roles', 'companies', 'buyers', 'suppliers', 'contacts', 
        'categories', 'products', 'rfqs', 'rfq_items', 'quotations', 'quotation_items', 
        'orders', 'order_items', 'tasks', 'notes', 'attachments', 'notifications', 
        'activities', 'audit_logs', 'api_keys', 'ai_agents', 'ai_jobs', 'seo_projects', 
        'social_accounts', 'social_posts', 'campaigns', 'workflows', 'workflow_runs', 
        'tags', 'tag_relations'
    ];
BEGIN
    FOREACH t IN ARRAY tables
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
        
        -- Drop if exists
        EXECUTE format('DROP POLICY IF EXISTS "Org isolation select" ON public.%I;', t);
        EXECUTE format('DROP POLICY IF EXISTS "Org isolation insert" ON public.%I;', t);
        EXECUTE format('DROP POLICY IF EXISTS "Org isolation update" ON public.%I;', t);
        EXECUTE format('DROP POLICY IF EXISTS "Org isolation delete" ON public.%I;', t);
        
        -- Create policies
        EXECUTE format('CREATE POLICY "Org isolation select" ON public.%I FOR SELECT USING (organization_id = public.get_current_org_id());', t);
        EXECUTE format('CREATE POLICY "Org isolation insert" ON public.%I FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());', t);
        EXECUTE format('CREATE POLICY "Org isolation update" ON public.%I FOR UPDATE USING (organization_id = public.get_current_org_id());', t);
        EXECUTE format('CREATE POLICY "Org isolation delete" ON public.%I FOR DELETE USING (organization_id = public.get_current_org_id());', t);
    END LOOP;
END
$$;

-- Enable storage
INSERT INTO storage.buckets (id, name, public) VALUES ('organization-logos', 'organization-logos', true) ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Public Access" ON storage.objects FOR SELECT USING (bucket_id = 'organization-logos');
CREATE POLICY "Auth Upload" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'organization-logos' AND auth.role() = 'authenticated');
CREATE POLICY "Auth Update" ON storage.objects FOR UPDATE USING (bucket_id = 'organization-logos' AND auth.role() = 'authenticated');
CREATE POLICY "Auth Delete" ON storage.objects FOR DELETE USING (bucket_id = 'organization-logos' AND auth.role() = 'authenticated');
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS designation TEXT,
ADD COLUMN IF NOT EXISTS department TEXT,
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS timezone TEXT,
ADD COLUMN IF NOT EXISTS language TEXT,
ADD COLUMN IF NOT EXISTS preferences JSONB;
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

-- Content Projects
CREATE TABLE IF NOT EXISTS public.content_projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    brand TEXT,
    language TEXT,
    industry TEXT,
    target_audience TEXT,
    country TEXT,
    tone TEXT,
    content_goal TEXT,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Content Topics
CREATE TABLE IF NOT EXISTS public.content_topics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES public.content_projects(id) ON DELETE CASCADE,
    topic TEXT NOT NULL,
    source TEXT DEFAULT 'manual', -- manual, csv, keyword, search_console
    status TEXT DEFAULT 'pending', -- pending, generating, completed, failed
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Content Jobs
CREATE TABLE IF NOT EXISTS public.content_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    topic_id UUID REFERENCES public.content_topics(id) ON DELETE CASCADE,
    content_type TEXT NOT NULL,
    status TEXT DEFAULT 'queued', -- queued, running, completed, failed
    error_message TEXT,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Content Outputs
CREATE TABLE IF NOT EXISTS public.content_outputs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID REFERENCES public.content_jobs(id) ON DELETE CASCADE,
    topic_id UUID REFERENCES public.content_topics(id) ON DELETE CASCADE,
    content_type TEXT NOT NULL,
    content TEXT NOT NULL,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Content Assets
CREATE TABLE IF NOT EXISTS public.content_assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    output_id UUID REFERENCES public.content_outputs(id) ON DELETE CASCADE,
    asset_url TEXT NOT NULL,
    asset_type TEXT NOT NULL,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS Policies
ALTER TABLE public.content_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org isolation select" ON public.content_projects FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.content_projects FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.content_projects FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.content_projects FOR DELETE USING (organization_id = public.get_current_org_id());

CREATE POLICY "Org isolation select" ON public.content_topics FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.content_topics FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.content_topics FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.content_topics FOR DELETE USING (organization_id = public.get_current_org_id());

CREATE POLICY "Org isolation select" ON public.content_jobs FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.content_jobs FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.content_jobs FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.content_jobs FOR DELETE USING (organization_id = public.get_current_org_id());

CREATE POLICY "Org isolation select" ON public.content_outputs FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.content_outputs FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.content_outputs FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.content_outputs FOR DELETE USING (organization_id = public.get_current_org_id());

CREATE POLICY "Org isolation select" ON public.content_assets FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.content_assets FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.content_assets FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.content_assets FOR DELETE USING (organization_id = public.get_current_org_id());
-- Image Projects
CREATE TABLE IF NOT EXISTS public.image_projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    brand TEXT,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Image Templates
CREATE TABLE IF NOT EXISTS public.image_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    brand_colors JSONB,
    fonts JSONB,
    logo_placement TEXT,
    qr_code_placement TEXT,
    cta_position TEXT,
    watermark TEXT,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Image Styles
CREATE TABLE IF NOT EXISTS public.image_styles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    prompt_prefix TEXT,
    negative_prompt TEXT,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Image Jobs
CREATE TABLE IF NOT EXISTS public.image_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES public.image_projects(id) ON DELETE CASCADE,
    template_id UUID REFERENCES public.image_templates(id),
    style_id UUID REFERENCES public.image_styles(id),
    prompt TEXT NOT NULL,
    negative_prompt TEXT,
    category TEXT NOT NULL,
    aspect_ratio TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    batch_size INT DEFAULT 1,
    auto_upscale BOOLEAN DEFAULT false,
    status TEXT DEFAULT 'queued', -- queued, running, completed, failed
    error_message TEXT,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_by UUID REFERENCES public.profiles(id),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Image Assets
CREATE TABLE IF NOT EXISTS public.image_assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID REFERENCES public.image_jobs(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.image_projects(id) ON DELETE CASCADE,
    asset_url TEXT NOT NULL,
    category TEXT,
    prompt TEXT,
    negative_prompt TEXT,
    provider TEXT,
    model TEXT,
    seed BIGINT,
    resolution TEXT,
    generation_time_ms INT,
    cost DECIMAL,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_by UUID REFERENCES public.profiles(id),
    is_favorite BOOLEAN DEFAULT false,
    tags JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Image Variants (Linking multiple variants if needed, though they can just be image_assets tied to same job)
-- Using image_assets for variants as well.

-- RLS Policies
ALTER TABLE public.image_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image_styles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org isolation select" ON public.image_projects FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.image_projects FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.image_projects FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.image_projects FOR DELETE USING (organization_id = public.get_current_org_id());

CREATE POLICY "Org isolation select" ON public.image_templates FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.image_templates FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.image_templates FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.image_templates FOR DELETE USING (organization_id = public.get_current_org_id());

CREATE POLICY "Org isolation select" ON public.image_styles FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.image_styles FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.image_styles FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.image_styles FOR DELETE USING (organization_id = public.get_current_org_id());

CREATE POLICY "Org isolation select" ON public.image_jobs FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.image_jobs FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.image_jobs FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.image_jobs FOR DELETE USING (organization_id = public.get_current_org_id());

CREATE POLICY "Org isolation select" ON public.image_assets FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.image_assets FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.image_assets FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.image_assets FOR DELETE USING (organization_id = public.get_current_org_id());
insert into storage.buckets (id, name, public) values ('image_assets', 'image_assets', true) on conflict do nothing;
create policy "Public Access" on storage.objects for select using ( bucket_id = 'image_assets' );
create policy "Auth Insert" on storage.objects for insert with check ( bucket_id = 'image_assets' and auth.role() = 'authenticated' );
-- Video Projects
CREATE TABLE IF NOT EXISTS public.video_projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    brand TEXT,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Video Templates
CREATE TABLE IF NOT EXISTS public.video_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    brand_colors JSONB,
    fonts JSONB,
    logo_placement TEXT,
    qr_code_placement TEXT,
    cta_position TEXT,
    watermark TEXT,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Video Styles
CREATE TABLE IF NOT EXISTS public.video_styles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    prompt_prefix TEXT,
    negative_prompt TEXT,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Video Jobs
CREATE TABLE IF NOT EXISTS public.video_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES public.video_projects(id) ON DELETE CASCADE,
    template_id UUID REFERENCES public.video_templates(id),
    style_id UUID REFERENCES public.video_styles(id),
    prompt TEXT NOT NULL,
    negative_prompt TEXT,
    video_type TEXT NOT NULL,
    aspect_ratio TEXT NOT NULL,
    duration TEXT,
    frame_rate TEXT,
    quality TEXT,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    camera_motion TEXT,
    transitions TEXT,
    status TEXT DEFAULT 'queued', -- queued, preparing, generating, rendering, uploading, completed, failed, cancelled
    error_message TEXT,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_by UUID REFERENCES public.profiles(id),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Video Assets
CREATE TABLE IF NOT EXISTS public.video_assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID REFERENCES public.video_jobs(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.video_projects(id) ON DELETE CASCADE,
    asset_url TEXT NOT NULL,
    thumbnail_url TEXT,
    video_type TEXT,
    prompt TEXT,
    negative_prompt TEXT,
    provider TEXT,
    model TEXT,
    seed BIGINT,
    resolution TEXT,
    duration TEXT,
    generation_time_ms INT,
    file_size_bytes BIGINT,
    cost DECIMAL,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_by UUID REFERENCES public.profiles(id),
    is_favorite BOOLEAN DEFAULT false,
    tags JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Video Timelines
CREATE TABLE IF NOT EXISTS public.video_timelines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES public.video_projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    data JSONB,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Video Variants
CREATE TABLE IF NOT EXISTS public.video_variants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id UUID REFERENCES public.video_assets(id) ON DELETE CASCADE,
    variant_url TEXT NOT NULL,
    description TEXT,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS Policies
ALTER TABLE public.video_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_styles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_timelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org isolation select" ON public.video_projects FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.video_projects FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.video_projects FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.video_projects FOR DELETE USING (organization_id = public.get_current_org_id());

CREATE POLICY "Org isolation select" ON public.video_templates FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.video_templates FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.video_templates FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.video_templates FOR DELETE USING (organization_id = public.get_current_org_id());

CREATE POLICY "Org isolation select" ON public.video_styles FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.video_styles FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.video_styles FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.video_styles FOR DELETE USING (organization_id = public.get_current_org_id());

CREATE POLICY "Org isolation select" ON public.video_jobs FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.video_jobs FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.video_jobs FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.video_jobs FOR DELETE USING (organization_id = public.get_current_org_id());

CREATE POLICY "Org isolation select" ON public.video_assets FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.video_assets FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.video_assets FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.video_assets FOR DELETE USING (organization_id = public.get_current_org_id());

CREATE POLICY "Org isolation select" ON public.video_timelines FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.video_timelines FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.video_timelines FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.video_timelines FOR DELETE USING (organization_id = public.get_current_org_id());

CREATE POLICY "Org isolation select" ON public.video_variants FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.video_variants FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.video_variants FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.video_variants FOR DELETE USING (organization_id = public.get_current_org_id());
insert into storage.buckets (id, name, public) values ('video_assets', 'video_assets', true) on conflict do nothing;
create policy "Public Access" on storage.objects for select using ( bucket_id = 'video_assets' );
create policy "Auth Insert" on storage.objects for insert with check ( bucket_id = 'video_assets' and auth.role() = 'authenticated' );
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
        EXECUTE format('CREATE POLICY "Org isolation select" ON public.%I FOR SELECT USING (organization_id = public.get_current_org_id());', t);
        EXECUTE format('CREATE POLICY "Org isolation insert" ON public.%I FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());', t);
        EXECUTE format('CREATE POLICY "Org isolation update" ON public.%I FOR UPDATE USING (organization_id = public.get_current_org_id());', t);
        EXECUTE format('CREATE POLICY "Org isolation delete" ON public.%I FOR DELETE USING (organization_id = public.get_current_org_id());', t);
    END LOOP;
END
$$;
-- Context Engine Tables

CREATE TABLE IF NOT EXISTS public.context_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.brand_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    details JSONB
);

CREATE TABLE IF NOT EXISTS public.campaign_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    details JSONB
);

CREATE TABLE IF NOT EXISTS public.audience_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    details JSONB
);

CREATE TABLE IF NOT EXISTS public.context_variables (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    context_profile_id UUID REFERENCES public.context_profiles(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL
);

-- RLS
ALTER TABLE public.context_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audience_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.context_variables ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    t TEXT;
    tables TEXT[] := ARRAY['context_profiles', 'brand_profiles', 'campaign_profiles', 'audience_profiles', 'context_variables'];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        EXECUTE format('CREATE POLICY "Org isolation select" ON public.%I FOR SELECT USING (organization_id = public.get_current_org_id());', t);
        EXECUTE format('CREATE POLICY "Org isolation insert" ON public.%I FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());', t);
    END LOOP;
END
$$;
EOF
-- SEO Intelligence Tables

CREATE TABLE IF NOT EXISTS public.seo_projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    industry_id UUID REFERENCES public.industries(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.seo_keywords (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    keyword TEXT NOT NULL,
    search_volume INTEGER DEFAULT 0,
    difficulty INTEGER DEFAULT 0,
    intent TEXT,
    industry_id UUID REFERENCES public.industries(id)
);

CREATE TABLE IF NOT EXISTS public.seo_keyword_clusters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    industry_id UUID REFERENCES public.industries(id)
);

-- (Adding a few core tables for initial implementation, will expand as needed to avoid overwhelming schema)

-- RLS
ALTER TABLE public.seo_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_keyword_clusters ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    t TEXT;
    tables TEXT[] := ARRAY['seo_projects', 'seo_keywords', 'seo_keyword_clusters'];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        EXECUTE format('CREATE POLICY "Org isolation select" ON public.%I FOR SELECT USING (organization_id = public.get_current_org_id());', t);
        EXECUTE format('CREATE POLICY "Org isolation insert" ON public.%I FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());', t);
    END LOOP;
END
$$;
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
-- Campaign Management Tables

CREATE TABLE IF NOT EXISTS public.campaigns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    industry_id UUID REFERENCES public.industries(id),
    name TEXT NOT NULL,
    objective TEXT,
    status TEXT DEFAULT 'planned', -- planned, active, completed
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.campaign_assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE,
    asset_type TEXT NOT NULL, -- blog, linkedin, video, etc.
    status TEXT DEFAULT 'pending', -- pending, generating, ready, published
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_assets ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    t TEXT;
    tables TEXT[] := ARRAY['campaigns', 'campaign_assets'];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        EXECUTE format('CREATE POLICY "Org isolation select" ON public.%I FOR SELECT USING (organization_id = public.get_current_org_id());', t);
        EXECUTE format('CREATE POLICY "Org isolation insert" ON public.%I FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());', t);
    END LOOP;
END
$$;
-- Media Composer Tables

CREATE TABLE IF NOT EXISTS public.media_projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.media_packages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES public.media_projects(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES public.campaigns(id),
    package_type TEXT NOT NULL,
    status TEXT DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS public.media_assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    package_id UUID REFERENCES public.media_packages(id) ON DELETE CASCADE,
    asset_url TEXT NOT NULL,
    asset_type TEXT NOT NULL,
    metadata JSONB
);

CREATE TABLE IF NOT EXISTS public.media_timelines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    package_id UUID REFERENCES public.media_packages(id) ON DELETE CASCADE,
    asset_id UUID REFERENCES public.media_assets(id),
    start_time INTEGER,
    end_time INTEGER
);

CREATE TABLE IF NOT EXISTS public.media_compositions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    package_id UUID REFERENCES public.media_packages(id) ON DELETE CASCADE,
    composition_data JSONB
);

CREATE TABLE IF NOT EXISTS public.media_exports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    composition_id UUID REFERENCES public.media_compositions(id) ON DELETE CASCADE,
    export_format TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    file_url TEXT
);

-- RLS
ALTER TABLE public.media_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_timelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_compositions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_exports ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    t TEXT;
    tables TEXT[] := ARRAY['media_projects', 'media_packages', 'media_assets', 'media_timelines', 'media_compositions', 'media_exports'];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        EXECUTE format('CREATE POLICY "Org isolation select" ON public.%I FOR SELECT USING (organization_id = public.get_current_org_id());', t);
        EXECUTE format('CREATE POLICY "Org isolation insert" ON public.%I FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());', t);
    END LOOP;
END
$$;
