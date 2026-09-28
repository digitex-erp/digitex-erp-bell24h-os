-- =============================================================================
-- Explanation records (Phase 2, priority 5 — explainability FRAMEWORK).  NOT APPLIED to any database by this change.
-- Requires add_communication_hub.sql's helpers (public.organizations, public.get_current_org_id). Re-runnable.
--
-- Stores explanations of scoring/ranking decisions (SHAP / LIME) once a real scorer and explainer exist. Nothing writes
-- here today: no explainer is registered. The table exists so the storage contract is fixed and reviewed before any
-- model is built.
--   * APPEND-ONLY (an explanation is a record of what was true when a decision was made; corrections are new rows).
--   * Tenants may read their own organization's rows; only the server writes.
--   * Attributions carry de-identified feature values only (validated in server/explainability/validate.ts).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.explanation_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    subject_type TEXT NOT NULL CHECK (subject_type IN ('rfq_matching', 'supplier_ranking', 'trust_infrastructure', 'trade_confidence_score')),
    subject_id TEXT NOT NULL CHECK (char_length(subject_id) BETWEEN 1 AND 200),
    method TEXT NOT NULL CHECK (method IN ('shap', 'lime')),
    model_id TEXT NOT NULL CHECK (char_length(model_id) BETWEEN 1 AND 100),
    model_version TEXT NOT NULL CHECK (char_length(model_version) BETWEEN 1 AND 50),
    prediction DOUBLE PRECISION NOT NULL,
    base_value DOUBLE PRECISION NOT NULL,
    local_fit DOUBLE PRECISION CHECK (local_fit IS NULL OR (local_fit >= 0 AND local_fit <= 1)),
    attributions JSONB NOT NULL CHECK (jsonb_typeof(attributions) = 'array' AND jsonb_array_length(attributions) BETWEEN 1 AND 200 AND pg_column_size(attributions) < 65536),
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT explanation_records_lime_fit CHECK ((method = 'lime') = (local_fit IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_explanation_records_org_subject ON public.explanation_records (organization_id, subject_type, subject_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.explanation_records_reject_change() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'explanation_records is append-only (% is not allowed)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS explanation_records_no_update_delete ON public.explanation_records;
CREATE TRIGGER explanation_records_no_update_delete BEFORE UPDATE OR DELETE ON public.explanation_records
    FOR EACH ROW EXECUTE FUNCTION public.explanation_records_reject_change();
DROP TRIGGER IF EXISTS explanation_records_no_truncate ON public.explanation_records;
CREATE TRIGGER explanation_records_no_truncate BEFORE TRUNCATE ON public.explanation_records
    FOR EACH STATEMENT EXECUTE FUNCTION public.explanation_records_reject_change();

ALTER TABLE public.explanation_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org isolation select" ON public.explanation_records;
CREATE POLICY "Org isolation select" ON public.explanation_records FOR SELECT USING (organization_id = public.get_current_org_id());
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.explanation_records FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.explanation_records FROM authenticated';
    END IF;
END $$;
