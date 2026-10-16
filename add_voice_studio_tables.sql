-- Voice Studio — Batch 1 migration from the Shogo prototype's Voice module.
--
-- Scope note: additive only, mirrors the Communication Hub migration's
-- conventions (add_communication_hub.sql) — RLS + REVOKE from tenant roles,
-- IF NOT EXISTS throughout, no destructive statement anywhere in this file.
--
-- Deliberately does NOT create a `voice_queue_jobs` table: Shogo's own
-- VoiceQueueJob model is replaced here by the existing job_queue
-- (server/queue/QueueManager.ts, job_type: 'voice', already a first-class
-- JobType per QueueTypes.ts) — reusing proven infrastructure rather than
-- duplicating a second queue, per this batch's explicit instruction.
--
-- organization_id is NOT NULL on every table below. Every one of Shogo's own
-- source models declared `orgId String?` (nullable) — a real tenant-isolation
-- weakness in the source that this migration deliberately does not carry
-- over. Bell24h-OS's own convention (Communication Hub) requires it.
--
-- No provider credential values live in voice_providers — only a secret
-- reference name, same convention as communication_providers.

-- 1. Agents: a configured voice-calling persona.
CREATE TABLE IF NOT EXISTS public.voice_agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    agent_key TEXT NOT NULL,
    name TEXT NOT NULL,
    purpose TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'outbound',
    language TEXT NOT NULL DEFAULT 'en-IN',
    voice_name TEXT,
    personality TEXT,
    business_context TEXT,
    system_objective TEXT,
    knowledge_base TEXT,
    allowed_actions TEXT,
    restricted_actions TEXT,
    decision_rules TEXT,
    call_flow TEXT,
    success_criteria TEXT,
    failure_criteria TEXT,
    escalation_rules TEXT,
    working_hours TEXT,
    max_calls_per_day INT NOT NULL DEFAULT 60,
    escalation_threshold REAL NOT NULL DEFAULT 0.55,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
    approval_state TEXT NOT NULL DEFAULT 'approved' CHECK (approval_state IN ('pending', 'approved', 'rejected')),
    total_calls INT NOT NULL DEFAULT 0,
    resolution_rate REAL NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (organization_id, agent_key)
);
CREATE INDEX IF NOT EXISTS idx_voice_agents_org ON public.voice_agents(organization_id);
CREATE INDEX IF NOT EXISTS idx_voice_agents_status ON public.voice_agents(status);

-- 2. Campaigns: outbound campaign definitions referencing an agent.
CREATE TABLE IF NOT EXISTS public.voice_campaigns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    campaign_type TEXT NOT NULL DEFAULT 'outbound',
    target_audience TEXT,
    contact_source TEXT,
    objective TEXT,
    agent_key TEXT,
    script_code TEXT,
    language TEXT NOT NULL DEFAULT 'en-IN',
    voice_name TEXT,
    max_calls_per_day INT NOT NULL DEFAULT 120,
    calling_hours TEXT,
    retry_policy TEXT,
    max_attempts INT NOT NULL DEFAULT 3,
    escalation_rule TEXT,
    success_condition TEXT,
    failure_condition TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'completed', 'cancelled')),
    total_targets INT NOT NULL DEFAULT 0,
    total_called INT NOT NULL DEFAULT 0,
    total_connected INT NOT NULL DEFAULT 0,
    total_success INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (organization_id, code)
);
CREATE INDEX IF NOT EXISTS idx_voice_campaigns_org ON public.voice_campaigns(organization_id);
CREATE INDEX IF NOT EXISTS idx_voice_campaigns_status ON public.voice_campaigns(status);

-- 3. Calls: one row per dispatched (or simulated) voice task, plus its capture.
CREATE TABLE IF NOT EXISTS public.voice_calls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    ref TEXT NOT NULL,
    campaign_id UUID REFERENCES public.voice_campaigns(id) ON DELETE SET NULL,
    agent_key TEXT,
    contact_name TEXT NOT NULL,
    company TEXT,
    contact_role TEXT,
    phone_masked TEXT NOT NULL, -- last-4-digits-only, never the full number (see server/voice/voiceDriver.ts maskPhone)
    entity_type TEXT NOT NULL DEFAULT 'supplier',
    entity_id TEXT,
    direction TEXT NOT NULL DEFAULT 'outbound',
    driver TEXT NOT NULL CHECK (driver IN ('simulated', 'dograh')), -- which VoiceDriver actually ran this call
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'dispatched', 'in_progress', 'completed', 'failed')),
    outcome TEXT CHECK (outcome IN ('captured', 'no_answer', 'declined', 'failed')),
    interested BOOLEAN,
    price NUMERIC,
    currency TEXT DEFAULT 'INR',
    moq TEXT,
    delivery_days INT,
    remarks TEXT,
    confidence REAL,
    duration_sec INT NOT NULL DEFAULT 0,
    cost_usd NUMERIC NOT NULL DEFAULT 0,
    rfq_number TEXT,
    recording_url TEXT,
    recording_state TEXT NOT NULL DEFAULT 'simulated' CHECK (recording_state IN ('simulated', 'real', 'unavailable')),
    language TEXT NOT NULL DEFAULT 'en-IN',
    driver_job_id TEXT, -- dograh's workflow_run_id, or sim-<ref> for the simulated driver
    error TEXT,
    attempt INT NOT NULL DEFAULT 1,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (organization_id, ref)
);
CREATE INDEX IF NOT EXISTS idx_voice_calls_org ON public.voice_calls(organization_id);
CREATE INDEX IF NOT EXISTS idx_voice_calls_status ON public.voice_calls(status);
CREATE INDEX IF NOT EXISTS idx_voice_calls_created_at ON public.voice_calls(created_at);
-- Idempotency on a Dograh webhook replay: the same driver_job_id, once applied
-- for this org, must not be applied twice. Partial index (dograh calls only —
-- the simulated driver's sim-<ref> ids are already unique per ref via the
-- UNIQUE(organization_id, ref) constraint above and don't need this).
CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_calls_driver_job_dedupe
    ON public.voice_calls(organization_id, driver_job_id)
    WHERE driver = 'dograh' AND driver_job_id IS NOT NULL;

-- 4. Call messages: the transcript, one row per turn.
CREATE TABLE IF NOT EXISTS public.voice_call_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    call_id UUID NOT NULL REFERENCES public.voice_calls(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    seq INT NOT NULL,
    speaker TEXT NOT NULL,
    text TEXT NOT NULL,
    at_sec INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_voice_call_messages_call ON public.voice_call_messages(call_id);
CREATE INDEX IF NOT EXISTS idx_voice_call_messages_org ON public.voice_call_messages(organization_id);

-- 5. Scripts: call-script studio content, referenced by agent/campaign.
CREATE TABLE IF NOT EXISTS public.voice_scripts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    agent_key TEXT,
    language TEXT NOT NULL DEFAULT 'en-IN',
    tone TEXT NOT NULL DEFAULT 'professional',
    opening TEXT,
    verification TEXT,
    purpose TEXT,
    questions TEXT,
    objections TEXT,
    negotiation TEXT,
    closing TEXT,
    escalation TEXT,
    fallback TEXT,
    variables TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (organization_id, code)
);
CREATE INDEX IF NOT EXISTS idx_voice_scripts_org ON public.voice_scripts(organization_id);

-- 6. Providers: telephony / STT / TTS / LLM provider configuration. Secret
--    reference only, never a credential value — same convention as
--    communication_providers.credentials_secret_ref.
CREATE TABLE IF NOT EXISTS public.voice_providers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    provider_key TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('telephony', 'sip', 'stt', 'tts', 'llm', 'voice', 'recording')),
    vendor TEXT,
    credentials_secret_ref TEXT, -- name of a server-side secret, never the value
    status TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled')),
    latency_ms INT NOT NULL DEFAULT 0,
    cost_per_unit NUMERIC NOT NULL DEFAULT 0,
    cost_unit TEXT NOT NULL DEFAULT 'per minute',
    health_status TEXT DEFAULT 'unknown' CHECK (health_status IN ('unknown', 'healthy', 'degraded', 'down')),
    is_default BOOLEAN NOT NULL DEFAULT false,
    is_fallback BOOLEAN NOT NULL DEFAULT false,
    region TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (organization_id, provider_key)
);
CREATE INDEX IF NOT EXISTS idx_voice_providers_org ON public.voice_providers(organization_id);
CREATE INDEX IF NOT EXISTS idx_voice_providers_category ON public.voice_providers(category);

-- 7. Voice profiles: TTS voice library entries.
CREATE TABLE IF NOT EXISTS public.voice_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    profile_key TEXT NOT NULL,
    name TEXT NOT NULL,
    language TEXT NOT NULL,
    gender TEXT NOT NULL,
    style TEXT NOT NULL DEFAULT 'neutral',
    speed REAL NOT NULL DEFAULT 1,
    pitch REAL NOT NULL DEFAULT 1,
    provider_key TEXT,
    accent TEXT,
    status TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled')),
    is_default BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (organization_id, profile_key)
);
CREATE INDEX IF NOT EXISTS idx_voice_profiles_org ON public.voice_profiles(organization_id);
CREATE INDEX IF NOT EXISTS idx_voice_profiles_language ON public.voice_profiles(language);

-- 8. Numbers: phone numbers / SIP lines assigned to agents or campaigns.
CREATE TABLE IF NOT EXISTS public.voice_numbers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    number_key TEXT NOT NULL,
    label TEXT NOT NULL,
    masked TEXT NOT NULL, -- last-4-digits-only display form; never a full number
    channel TEXT NOT NULL DEFAULT 'sip',
    provider_key TEXT,
    region TEXT,
    assigned_to TEXT,
    capacity INT NOT NULL DEFAULT 10,
    status TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (organization_id, number_key)
);
CREATE INDEX IF NOT EXISTS idx_voice_numbers_org ON public.voice_numbers(organization_id);

-- 9. Escalations: human escalation center.
CREATE TABLE IF NOT EXISTS public.voice_escalations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    ref TEXT NOT NULL,
    call_ref TEXT,
    contact_name TEXT NOT NULL,
    company TEXT,
    reason TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    transcript TEXT,
    recommendation TEXT,
    summary TEXT,
    rfq_number TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'resolved', 'dismissed')),
    assigned_to UUID REFERENCES public.profiles(id),
    raised_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (organization_id, ref)
);
CREATE INDEX IF NOT EXISTS idx_voice_escalations_org ON public.voice_escalations(organization_id);
CREATE INDEX IF NOT EXISTS idx_voice_escalations_status ON public.voice_escalations(status);

-- 10. Automation rules: TRIGGER -> CONDITION -> AI DECISION -> ACTION.
CREATE TABLE IF NOT EXISTS public.voice_automation_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    trigger_event TEXT NOT NULL,
    conditions TEXT,
    ai_decision TEXT,
    action TEXT NOT NULL,
    agent_key TEXT,
    channel TEXT NOT NULL DEFAULT 'voice',
    status TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled')),
    run_count INT NOT NULL DEFAULT 0,
    last_run_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (organization_id, code)
);
CREATE INDEX IF NOT EXISTS idx_voice_automation_rules_org ON public.voice_automation_rules(organization_id);
CREATE INDEX IF NOT EXISTS idx_voice_automation_rules_status ON public.voice_automation_rules(status);

-- 11. Policies: the AI-calling safety/policy layer.
CREATE TABLE IF NOT EXISTS public.voice_policies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    policy_key TEXT NOT NULL,
    label TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'safety',
    value TEXT NOT NULL,
    value_type TEXT NOT NULL DEFAULT 'string' CHECK (value_type IN ('string', 'number', 'boolean')),
    unit TEXT,
    description TEXT,
    enforced BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (organization_id, policy_key)
);
CREATE INDEX IF NOT EXISTS idx_voice_policies_org ON public.voice_policies(organization_id);

-- 12. CRM timeline writeback — Bell24h-OS owns this write; the voice driver
--     (simulated or dograh) never writes here directly, only VoiceJobHandler
--     does, after a call concludes (see server/workers/handlers/VoiceJobHandler.ts).
CREATE TABLE IF NOT EXISTS public.comm_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    ref TEXT NOT NULL,
    channel TEXT NOT NULL,
    direction TEXT NOT NULL DEFAULT 'outbound',
    contact_name TEXT NOT NULL,
    company TEXT,
    subject TEXT,
    body TEXT,
    outcome TEXT,
    call_ref TEXT,
    entity_type TEXT,
    rfq_number TEXT,
    occurred_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (organization_id, ref)
);
CREATE INDEX IF NOT EXISTS idx_comm_events_org ON public.comm_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_comm_events_channel ON public.comm_events(channel);
CREATE INDEX IF NOT EXISTS idx_comm_events_occurred_at ON public.comm_events(occurred_at);

-- ─── Row Level Security ─────────────────────────────────────────────────────

ALTER TABLE public.voice_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_call_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_scripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comm_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org isolation select" ON public.voice_agents;
CREATE POLICY "Org isolation select" ON public.voice_agents FOR SELECT USING (organization_id = public.get_current_org_id());
DROP POLICY IF EXISTS "Org isolation select" ON public.voice_campaigns;
CREATE POLICY "Org isolation select" ON public.voice_campaigns FOR SELECT USING (organization_id = public.get_current_org_id());
DROP POLICY IF EXISTS "Org isolation select" ON public.voice_calls;
CREATE POLICY "Org isolation select" ON public.voice_calls FOR SELECT USING (organization_id = public.get_current_org_id());
DROP POLICY IF EXISTS "Org isolation select" ON public.voice_call_messages;
CREATE POLICY "Org isolation select" ON public.voice_call_messages FOR SELECT USING (organization_id = public.get_current_org_id());
DROP POLICY IF EXISTS "Org isolation select" ON public.voice_scripts;
CREATE POLICY "Org isolation select" ON public.voice_scripts FOR SELECT USING (organization_id = public.get_current_org_id());
DROP POLICY IF EXISTS "Org isolation select" ON public.voice_providers;
CREATE POLICY "Org isolation select" ON public.voice_providers FOR SELECT USING (organization_id = public.get_current_org_id());
DROP POLICY IF EXISTS "Org isolation select" ON public.voice_profiles;
CREATE POLICY "Org isolation select" ON public.voice_profiles FOR SELECT USING (organization_id = public.get_current_org_id());
DROP POLICY IF EXISTS "Org isolation select" ON public.voice_numbers;
CREATE POLICY "Org isolation select" ON public.voice_numbers FOR SELECT USING (organization_id = public.get_current_org_id());
DROP POLICY IF EXISTS "Org isolation select" ON public.voice_escalations;
CREATE POLICY "Org isolation select" ON public.voice_escalations FOR SELECT USING (organization_id = public.get_current_org_id());
DROP POLICY IF EXISTS "Org isolation select" ON public.voice_automation_rules;
CREATE POLICY "Org isolation select" ON public.voice_automation_rules FOR SELECT USING (organization_id = public.get_current_org_id());
DROP POLICY IF EXISTS "Org isolation select" ON public.voice_policies;
CREATE POLICY "Org isolation select" ON public.voice_policies FOR SELECT USING (organization_id = public.get_current_org_id());
DROP POLICY IF EXISTS "Org isolation select" ON public.comm_events;
CREATE POLICY "Org isolation select" ON public.comm_events FOR SELECT USING (organization_id = public.get_current_org_id());

-- Writes are primarily enforced by the service layer's explicit
-- organization_id parameters (every query filters WHERE organization_id = $n,
-- resolved server-side from the authenticated caller — never from the
-- request body), with RLS SELECT isolation + the REVOKE block below as a
-- backstop against a client bypassing that layer — the same defense-in-depth
-- pattern already documented for communication_* tables.
DO $$
DECLARE
    r TEXT;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
        EXECUTE format('REVOKE ALL ON public.voice_providers FROM %I', r);
        EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.voice_agents FROM %I', r);
        EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.voice_campaigns FROM %I', r);
        EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.voice_calls FROM %I', r);
        EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.voice_call_messages FROM %I', r);
        EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.voice_scripts FROM %I', r);
        EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.voice_profiles FROM %I', r);
        EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.voice_numbers FROM %I', r);
        EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.voice_escalations FROM %I', r);
        EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.voice_automation_rules FROM %I', r);
        EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.voice_policies FROM %I', r);
        EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.comm_events FROM %I', r);
    END LOOP;
END $$;

-- ─── Call Scripts versioning (added: provider-architecture-decision +
--     Call Scripts implementation batch) ───────────────────────────────────
--
-- voice_scripts (table 5, above) is the mutable current/draft row. Publishing
-- a script snapshots its content into voice_script_versions, which is never
-- updated or deleted after insert -- this is what gives "explicit separation
-- between draft editing and published versions": the live row can keep
-- being edited (and flips back to status='draft' when it diverges from the
-- latest snapshot), while every past published snapshot stays retrievable
-- and unchanged. Purely additive; does not alter voice_scripts.
CREATE TABLE IF NOT EXISTS public.voice_script_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    script_id UUID NOT NULL REFERENCES public.voice_scripts(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    version INT NOT NULL,
    name TEXT NOT NULL,
    agent_key TEXT,
    language TEXT NOT NULL,
    tone TEXT NOT NULL,
    opening TEXT,
    verification TEXT,
    purpose TEXT,
    questions TEXT,
    objections TEXT,
    negotiation TEXT,
    closing TEXT,
    escalation TEXT,
    fallback TEXT,
    variables TEXT,
    published_by UUID REFERENCES public.profiles(id),
    published_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (script_id, version)
);
CREATE INDEX IF NOT EXISTS idx_voice_script_versions_script ON public.voice_script_versions(script_id);
CREATE INDEX IF NOT EXISTS idx_voice_script_versions_org ON public.voice_script_versions(organization_id);

ALTER TABLE public.voice_script_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org isolation select" ON public.voice_script_versions;
CREATE POLICY "Org isolation select" ON public.voice_script_versions FOR SELECT USING (organization_id = public.get_current_org_id());

DO $$
DECLARE
    r TEXT;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
        -- Immutable history: no role gets UPDATE or DELETE, even via the
        -- service layer convention used elsewhere -- only INSERT (append) is
        -- revoked here from direct tenant access same as other tables;
        -- UPDATE/DELETE are revoked unconditionally since nothing should
        -- ever modify a published snapshot.
        EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.voice_script_versions FROM %I', r);
    END LOOP;
END $$;
