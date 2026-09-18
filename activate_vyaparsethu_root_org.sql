-- ==============================================================================
-- BELL24H-OS: SINGLE ROOT ORGANIZATION ("VyaparSethu") ACTIVATION
-- Internal Enterprise Operating System Architecture
-- ==============================================================================

-- 1. Ensure required columns exist on public.organizations
ALTER TABLE public.organizations 
ADD COLUMN IF NOT EXISTS legal_name TEXT,
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS industry TEXT,
ADD COLUMN IF NOT EXISTS website TEXT,
ADD COLUMN IF NOT EXISTS gst_number TEXT,
ADD COLUMN IF NOT EXISTS pan_number TEXT,
ADD COLUMN IF NOT EXISTS iec_number TEXT,
ADD COLUMN IF NOT EXISTS cin TEXT,
ADD COLUMN IF NOT EXISTS msme_number TEXT,
ADD COLUMN IF NOT EXISTS company_email TEXT,
ADD COLUMN IF NOT EXISTS phone_number TEXT,
ADD COLUMN IF NOT EXISTS addresses JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- 2. Rename & update single root organization to VyaparSethu
UPDATE public.organizations 
SET 
  name = 'VyaparSethu',
  slug = 'vyaparsethu',
  legal_name = 'VyaparSethu Technologies Private Limited',
  description = 'Bell24h Enterprise AI Operating System & B2B Textile Commerce Cloud',
  industry = 'B2B E-Commerce / Textile Supply Chain',
  website = 'https://bell24h.com',
  company_email = 'bell24h.info@gmail.com',
  phone_number = '+91 98200 00000',
  updated_at = NOW()
WHERE id = 'abdb43db-8bc0-46ff-8d22-e8c4eec26676';

-- 3. Create public.organization_members table if not exists
CREATE TABLE IF NOT EXISTS public.organization_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'ADMIN',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT organization_members_org_user_uniq UNIQUE (organization_id, user_id)
);

-- 4. Enable RLS on organization_members
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

-- 5. Seed organization_members for root owner (bell24h.info@gmail.com) and studio
INSERT INTO public.organization_members (id, organization_id, user_id, role, created_at, updated_at)
VALUES 
  (
    gen_random_uuid(),
    'abdb43db-8bc0-46ff-8d22-e8c4eec26676',
    'cea7f53c-94c9-4e48-9025-b468a12d4f45',
    'ADMIN',
    NOW(),
    NOW()
  ),
  (
    gen_random_uuid(),
    'abdb43db-8bc0-46ff-8d22-e8c4eec26676',
    'fd225e57-5ad9-47b8-b7f5-f394f99ca3f5',
    'ADMIN',
    NOW(),
    NOW()
  )
ON CONFLICT (organization_id, user_id) 
DO UPDATE SET role = 'ADMIN', updated_at = NOW();

-- 6. Ensure profile metadata & organization linkage
UPDATE public.profiles
SET 
  organization_id = 'abdb43db-8bc0-46ff-8d22-e8c4eec26676',
  first_name = COALESCE(first_name, 'Vishal'),
  last_name = COALESCE(last_name, 'Pendharkar'),
  designation = COALESCE(designation, 'Founder & Super Admin'),
  department = COALESCE(department, 'Executive Office'),
  is_active = true,
  updated_at = NOW()
WHERE id = 'cea7f53c-94c9-4e48-9025-b468a12d4f45';

UPDATE public.profiles
SET 
  organization_id = 'abdb43db-8bc0-46ff-8d22-e8c4eec26676',
  is_active = true,
  updated_at = NOW()
WHERE id = 'fd225e57-5ad9-47b8-b7f5-f394f99ca3f5';

-- 7. Seed system roles in public.roles
INSERT INTO public.roles (id, name, description, is_system, organization_id, created_at, updated_at)
VALUES 
  (gen_random_uuid(), 'ADMIN', 'Super Administrator with full system privileges', true, 'abdb43db-8bc0-46ff-8d22-e8c4eec26676', NOW(), NOW()),
  (gen_random_uuid(), 'MANAGER', 'Operations Manager with administrative access', true, 'abdb43db-8bc0-46ff-8d22-e8c4eec26676', NOW(), NOW()),
  (gen_random_uuid(), 'EDITOR', 'Editor with content and workflow execution access', true, 'abdb43db-8bc0-46ff-8d22-e8c4eec26676', NOW(), NOW()),
  (gen_random_uuid(), 'VIEWER', 'Viewer with read-only access', true, 'abdb43db-8bc0-46ff-8d22-e8c4eec26676', NOW(), NOW())
ON CONFLICT DO NOTHING;

-- 8. Assign ADMIN role in public.user_roles
INSERT INTO public.user_roles (id, user_id, role_id, organization_id, created_at, updated_at)
SELECT 
  gen_random_uuid(),
  'cea7f53c-94c9-4e48-9025-b468a12d4f45',
  r.id,
  'abdb43db-8bc0-46ff-8d22-e8c4eec26676',
  NOW(),
  NOW()
FROM public.roles r
WHERE r.name = 'ADMIN' AND r.organization_id = 'abdb43db-8bc0-46ff-8d22-e8c4eec26676'
AND NOT EXISTS (
  SELECT 1 FROM public.user_roles ur 
  WHERE ur.user_id = 'cea7f53c-94c9-4e48-9025-b468a12d4f45' 
    AND ur.role_id = r.id 
    AND ur.organization_id = 'abdb43db-8bc0-46ff-8d22-e8c4eec26676'
);

INSERT INTO public.user_roles (id, user_id, role_id, organization_id, created_at, updated_at)
SELECT 
  gen_random_uuid(),
  'fd225e57-5ad9-47b8-b7f5-f394f99ca3f5',
  r.id,
  'abdb43db-8bc0-46ff-8d22-e8c4eec26676',
  NOW(),
  NOW()
FROM public.roles r
WHERE r.name = 'ADMIN' AND r.organization_id = 'abdb43db-8bc0-46ff-8d22-e8c4eec26676'
AND NOT EXISTS (
  SELECT 1 FROM public.user_roles ur 
  WHERE ur.user_id = 'fd225e57-5ad9-47b8-b7f5-f394f99ca3f5' 
    AND ur.role_id = r.id 
    AND ur.organization_id = 'abdb43db-8bc0-46ff-8d22-e8c4eec26676'
);

-- 9. Seed Core Permissions
INSERT INTO public.permissions (id, action, description, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'manage:system', 'Full system administration and diagnostics', NOW(), NOW()),
  (gen_random_uuid(), 'manage:organization', 'Manage organization details and workspace configuration', NOW(), NOW()),
  (gen_random_uuid(), 'manage:users', 'Manage team members, roles, and permissions', NOW(), NOW()),
  (gen_random_uuid(), 'manage:ai', 'Access and configure AI providers, models, and Prompt Studio', NOW(), NOW()),
  (gen_random_uuid(), 'manage:seo', 'Full access to enterprise SEO intelligence suites', NOW(), NOW()),
  (gen_random_uuid(), 'manage:publishing', 'Access to Content Planner, Publishing Center, Image/Video Studio', NOW(), NOW()),
  (gen_random_uuid(), 'manage:communications', 'Manage WhatsApp, email, and messaging hubs', NOW(), NOW()),
  (gen_random_uuid(), 'manage:rfq', 'RFQ, quotation, and escrow trade operations', NOW(), NOW()),
  (gen_random_uuid(), 'view:analytics', 'View performance analytics and business intelligence', NOW(), NOW())
ON CONFLICT DO NOTHING;

-- 10. Upgrade get_current_org_id() Function with 3-tier fallback
CREATE OR REPLACE FUNCTION public.get_current_org_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org_id uuid;
BEGIN
    -- Tier 1: Try JWT claim
    BEGIN
        v_org_id := NULLIF(current_setting('request.jwt.claim.organization_id', true), '')::UUID;
    EXCEPTION WHEN OTHERS THEN
        v_org_id := NULL;
    END;

    IF v_org_id IS NOT NULL THEN
        RETURN v_org_id;
    END IF;

    -- Tier 2: Try user profile lookup
    IF auth.uid() IS NOT NULL THEN
        SELECT organization_id INTO v_org_id 
        FROM public.profiles 
        WHERE id = auth.uid() 
        LIMIT 1;
        
        IF v_org_id IS NOT NULL THEN
            RETURN v_org_id;
        END IF;
    END IF;

    -- Tier 3: Internal OS Single Root Fallback (VyaparSethu)
    SELECT id INTO v_org_id 
    FROM public.organizations 
    ORDER BY created_at ASC 
    LIMIT 1;

    RETURN v_org_id;
END;
$$;

-- 11. Comprehensive RLS Policy Configuration
-- public.organizations
DROP POLICY IF EXISTS "organizations_read_authenticated" ON public.organizations;
CREATE POLICY "organizations_read_authenticated" 
ON public.organizations FOR SELECT 
TO authenticated 
USING (true);

DROP POLICY IF EXISTS "organizations_update_admin" ON public.organizations;
CREATE POLICY "organizations_update_admin" 
ON public.organizations FOR UPDATE 
TO authenticated 
USING (id = get_current_org_id()) 
WITH CHECK (id = get_current_org_id());

-- public.organization_members
DROP POLICY IF EXISTS "org_members_read_authenticated" ON public.organization_members;
CREATE POLICY "org_members_read_authenticated" 
ON public.organization_members FOR SELECT 
TO authenticated 
USING (true);

DROP POLICY IF EXISTS "org_members_write_admin" ON public.organization_members;
CREATE POLICY "org_members_write_admin" 
ON public.organization_members FOR ALL 
TO authenticated 
USING (true) 
WITH CHECK (true);

-- public.roles
DROP POLICY IF EXISTS "roles_read_authenticated" ON public.roles;
CREATE POLICY "roles_read_authenticated" 
ON public.roles FOR SELECT 
TO authenticated 
USING (true);

-- public.user_roles
DROP POLICY IF EXISTS "user_roles_read_authenticated" ON public.user_roles;
CREATE POLICY "user_roles_read_authenticated" 
ON public.user_roles FOR SELECT 
TO authenticated 
USING (true);

-- public.profiles
DROP POLICY IF EXISTS "profiles_read_all_authenticated" ON public.profiles;
CREATE POLICY "profiles_read_all_authenticated" 
ON public.profiles FOR SELECT 
TO authenticated 
USING (true);

-- 12. Storage bucket: organization-logos
INSERT INTO storage.buckets (id, name, public) 
VALUES ('organization-logos', 'organization-logos', true) 
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "Public Access - organization-logos" ON storage.objects;
CREATE POLICY "Public Access - organization-logos" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'organization-logos');

DROP POLICY IF EXISTS "Auth Insert - organization-logos" ON storage.objects;
CREATE POLICY "Auth Insert - organization-logos" 
ON storage.objects FOR INSERT 
WITH CHECK (bucket_id = 'organization-logos' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Auth Update - organization-logos" ON storage.objects;
CREATE POLICY "Auth Update - organization-logos" 
ON storage.objects FOR UPDATE 
USING (bucket_id = 'organization-logos' AND auth.role() = 'authenticated');
