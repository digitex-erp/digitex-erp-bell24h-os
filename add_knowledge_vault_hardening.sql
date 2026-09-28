-- =============================================================================
-- Knowledge Vault hardening.  NOT APPLIED to any database by this change; apply deliberately, in staging first.
-- Requires the vault tables (add_knowledge_vault.sql or supabase_schema.sql). Re-runnable.
--
-- PROBLEM: add_knowledge_vault.sql / supabase_schema.sql create the policy "Public Read Access" ... FOR SELECT USING (true)
-- with no role list, so it applies to EVERY role including `anon`. Supabase grants `anon` SELECT on new public tables by
-- default, so the founder's vault (vision, R&D notes, decisions, timeline) is readable by anyone holding the project's
-- public anon key — no sign-in needed.
--
-- FIX: readable by signed-in users only. The app always calls the vault as a signed-in user (server/lib/postgrestFetch
-- with the caller's own token, role `authenticated`), so the vault screens keep working; anonymous readers lose access.
--
-- STILL TRUE AFTER THIS FILE: the vault tables have no organization_id, so EVERY signed-in user of EVERY organization can
-- read the same rows. Real per-organization isolation needs an organization_id column and per-org policies — a schema
-- decision that has not been made (BELL24H_OS_EXECUTION_BACKLOG.md TASK-04). This file does not pretend to provide it.
-- =============================================================================

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['vault_documents', 'rd_library', 'timeline_milestones', 'phases', 'decision_records'] LOOP
        IF to_regclass('public.' || t) IS NOT NULL THEN
            EXECUTE format('DROP POLICY IF EXISTS "Public Read Access" ON public.%I', t);
            EXECUTE format('DROP POLICY IF EXISTS "Authenticated read" ON public.%I', t);
            EXECUTE format('CREATE POLICY "Authenticated read" ON public.%I FOR SELECT TO authenticated USING (true)', t);
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
                EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
            END IF;
        END IF;
    END LOOP;
END $$;
