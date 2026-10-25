# Proposed Tender Ingestion Schema — NOT APPLIED

**This is a design proposal only. No migration was written or run. `supabase_schema.sql` was not modified. This document exists so a future phase has a starting point, not an instruction to execute.**

## Why this shape

Modeled directly on an existing, already-proven VyaparSethu pattern — `model ExternalLead` (read-only, verified against `prisma/schema.prisma` in the related repository this engagement): a free-text `source` field (not an enum — new sources don't need a schema migration), a raw-capture field, nullable extracted fields, a `status` string, and — critically — a **nullable** foreign key toward the eventual promoted record, set only by an explicit later step. The proposal below is the same shape, adapted to Bell24h-OS's own conventions (UUID PKs, `organization_id` scoping, RLS).

## Proposed table

```sql
-- PROPOSED, NOT APPLIED. Do not run this against any database.
CREATE TABLE IF NOT EXISTS public.ingested_tenders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,

    -- Matches computeDedupKey()'s output shape (server/ingestion/tenderValidation.ts).
    dedup_key TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_notice_id TEXT,
    source_url TEXT,

    title TEXT,
    description TEXT,
    procuring_authority TEXT,
    department TEXT,
    category TEXT,

    publication_date TIMESTAMPTZ,
    submission_deadline TIMESTAMPTZ,
    submission_deadline_timezone TEXT,

    source_status TEXT NOT NULL DEFAULT 'unknown',
    application_status TEXT NOT NULL DEFAULT 'new',

    location TEXT,
    currency TEXT,
    estimated_value NUMERIC,

    source_document_refs TEXT[] DEFAULT '{}',

    retrieved_at TIMESTAMPTZ NOT NULL,
    source_updated_at TIMESTAMPTZ,
    raw_provenance_ref TEXT NOT NULL,

    validation_warnings JSONB DEFAULT '[]',
    extraction_confidence NUMERIC,
    manual_review_required BOOLEAN NOT NULL DEFAULT false,

    -- The promotion link -- NULL until an explicit, separate, human/business
    -- reviewed decision creates a real RFQ. Mirrors ExternalLead.rfqId
    -- exactly. No code path in server/ingestion/ may ever set this column.
    promoted_rfq_id UUID,
    promoted_at TIMESTAMPTZ,
    promoted_by TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (organization_id, dedup_key)
);

-- RLS: enabled, with the full idempotent 4-op pattern already established as
-- the CORRECT reference template elsewhere in this schema (the 547-block
-- pattern, DROP IF EXISTS before each CREATE -- NOT the non-idempotent
-- standalone-statement pattern already found and flagged as a defect
-- elsewhere in this engagement's RLS audit).
ALTER TABLE public.ingested_tenders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org isolation select" ON public.ingested_tenders;
DROP POLICY IF EXISTS "Org isolation insert" ON public.ingested_tenders;
DROP POLICY IF EXISTS "Org isolation update" ON public.ingested_tenders;
DROP POLICY IF EXISTS "Org isolation delete" ON public.ingested_tenders;
CREATE POLICY "Org isolation select" ON public.ingested_tenders FOR SELECT USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation insert" ON public.ingested_tenders FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation update" ON public.ingested_tenders FOR UPDATE USING (organization_id = public.get_current_org_id());
CREATE POLICY "Org isolation delete" ON public.ingested_tenders FOR DELETE USING (organization_id = public.get_current_org_id());
```

## Explicit prerequisite, not optional

**Before this (or any) new `organization_id`-scoped table is created, the still-unresolved findings in `BELL24H_OS_DATABASE_ROLE_RLS_VERIFICATION.md` must be re-checked**: whether `get_current_org_id()` itself is affected by the documented `profiles`/`organizations` recursion bug, and whether the application's actual database connection bypasses RLS entirely regardless of policy correctness. Applying the policy above without resolving those questions first would repeat the exact mistake that investigation already found elsewhere in this schema — a table whose RLS looks correct on paper but is bypassed in practice, or whose dependency (`get_current_org_id()`) doesn't work at all for a genuinely RLS-respecting caller.

## Retention consideration

`raw_provenance_ref` is a content hash, not the raw payload — the full raw payload is deliberately NOT proposed to be stored in this table (consistent with `NormalizedTenderRecord`'s own design, see `server/ingestion/TenderTypes.ts`). If a future phase needs the raw payload retained for audit/dispute purposes, it should go in a separate, more tightly-access-controlled table or object store, not inline here, so that a wider set of ordinary application code paths reading `ingested_tenders` are never incidentally exposed to unredacted external content.

## What must never be true of this table, even after it's created

- No code path outside an explicit, separately-reviewed promotion workflow may write `promoted_rfq_id`.
- `organization_id` must never be derived from `source_document_refs`, `raw_payload`, or any other externally-sourced field — only from the trusted job/request context that triggered ingestion, exactly as `server/ingestion/TenderIngestionPipeline.ts`'s `IngestOptions.organizationId` already enforces in the mock-first code.
