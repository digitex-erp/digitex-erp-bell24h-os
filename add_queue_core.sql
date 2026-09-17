-- ====================================================================
-- Bell24h-OS Enterprise Edition
-- Migration: Add Production Queue Core Engine Columns & Indexes
-- Phase: B.5B.1 Queue Core & B.5B.2 Worker Fleet
-- ====================================================================

-- 0. Ensure Dependencies & Supporting Tables Exist
CREATE TABLE IF NOT EXISTS public.job_dependencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES public.job_queue(id) ON DELETE CASCADE,
    depends_on_job_id UUID REFERENCES public.job_queue(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.job_workers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'idle', -- idle, processing, offline, shutting_down
    concurrency_limit INT DEFAULT 1,
    last_heartbeat TIMESTAMPTZ DEFAULT NOW(),
    organization_id UUID
);

CREATE TABLE IF NOT EXISTS public.job_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES public.job_queue(id) ON DELETE CASCADE,
    level TEXT NOT NULL, -- info, warn, error
    message TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1. Add Queue Runtime Columns to public.job_queue
ALTER TABLE public.job_queue
    ADD COLUMN IF NOT EXISTS locked_by TEXT,
    ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS lock_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS timeout_ms INTEGER DEFAULT 300000, -- 5 minutes default
    ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
    ADD COLUMN IF NOT EXISTS dead_letter_reason TEXT,
    ADD COLUMN IF NOT EXISTS error_details JSONB;

-- 2. Add Partial High-Performance Claim Index for FOR UPDATE SKIP LOCKED
-- Ensures index scan only over ready jobs, keeping claim latency < 10ms
CREATE INDEX IF NOT EXISTS idx_job_queue_claim_ready
ON public.job_queue (
    (CASE priority
        WHEN 'critical' THEN 4
        WHEN 'high'     THEN 3
        WHEN 'medium'   THEN 2
        WHEN 'low'      THEN 1
        ELSE 0
    END) DESC,
    COALESCE(next_run_at, scheduled_at, created_at) ASC,
    created_at ASC
)
WHERE status IN ('queued', 'retrying');

-- 3. Add Scoped Idempotency Index (Per Organization)
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_queue_org_idempotency
ON public.job_queue (organization_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;

-- 4. Add Lease Expiration / Reaper Index for Dead Worker Detection
CREATE INDEX IF NOT EXISTS idx_job_queue_lease_reaper
ON public.job_queue (lock_expires_at)
WHERE status = 'running';

-- 5. Add Child Dependency Lookup Index
CREATE INDEX IF NOT EXISTS idx_job_dependencies_parent
ON public.job_dependencies (depends_on_job_id);
