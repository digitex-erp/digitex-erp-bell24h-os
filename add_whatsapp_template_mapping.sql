-- =============================================================================
-- WhatsApp template mapping.  NOT APPLIED to any database by this change.
-- Requires add_communication_hub.sql. Re-runnable. Apply AFTER add_communication_campaigns.sql.
--
-- A communication_templates row for WhatsApp can now be MAPPED to a Meta-approved template so campaigns can message
-- contacts outside the 24-hour window. See server/communication/whatsappTemplate.ts for the rules.
--   provider_template_name       Meta's template name (NULL = not mapped: free text, 24-hour window only)
--   provider_template_language   Meta language code
--   provider_template_variables  ordered variable names: entry 1 fills {{1}}, entry 2 fills {{2}} ...
-- communication_messages.provider_template records what was actually handed to the provider for that message
-- ({name, language, parameters}) so the log shows exactly what was sent even if the template is edited later.
--
-- Note: Postgres caps a regex repetition count at 255, so the 512-character name limit is a separate char_length check.
-- =============================================================================

ALTER TABLE public.communication_templates
    ADD COLUMN IF NOT EXISTS provider_template_name TEXT,
    ADD COLUMN IF NOT EXISTS provider_template_language TEXT NOT NULL DEFAULT 'en',
    ADD COLUMN IF NOT EXISTS provider_template_variables JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.communication_templates DROP CONSTRAINT IF EXISTS communication_templates_provider_template_check;
ALTER TABLE public.communication_templates ADD CONSTRAINT communication_templates_provider_template_check CHECK (
    provider_template_name IS NULL
    OR (channel_type = 'whatsapp'
        AND char_length(provider_template_name) BETWEEN 1 AND 512
        AND provider_template_name ~ '^[a-z0-9_]+$'
        AND provider_template_language ~ '^[a-z]{2,3}(_[A-Za-z]{2,4})?$'
        AND jsonb_typeof(provider_template_variables) = 'array'
        AND jsonb_array_length(provider_template_variables) <= 10)
);

ALTER TABLE public.communication_messages ADD COLUMN IF NOT EXISTS provider_template JSONB;
