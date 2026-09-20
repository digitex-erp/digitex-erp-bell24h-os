# BELL24H-OS Sprint 1 — Knowledge & Memory Substrate (Layer 3) Implementation Plan

**Repository:** `digitex-erp/digitex-erp-bell24h-os` — confirmed Bell24h-OS, confirmed
**not** VyaparSethu. RFQ, CRM, WhatsApp, Supplier Journey, Revenue, and Marketplace
modules are out of scope and untouched by this document; the one existing `job_type`
value named `communication` and `match_rfq` in `server/queue/QueueTypes.ts` are noted
only because they already exist in the type union — nothing about them is analyzed or
designed here.

**Date:** 2026-09-20. **Type:** Design only. No code, schema, or migration was executed
to produce this document — every table, service, and route below is a proposal.

**Sources used:** `BELL24H_OS_MASTER_ARCHITECTURE_RECONCILIATION.md`,
`BELL24H_OS_RUNTIME_REALITY_CERTIFICATION.md`, `BELL24H_OS_REMEDIATION_MASTER_PLAN.md`,
ADR-005, ADR-011 — plus fresh direct reads performed for this document (listed inline)
of `add_context_engine.sql`, `add_knowledge_vault.sql`, `add_storage_bucket.sql`,
`add_video_storage.sql`, `ContextEngineService.ts`, `KnowledgeBaseService.ts`,
`server.ts`'s `/api/vault/*` routes, and `server/queue/QueueTypes.ts`.

---

## The one thing to flag before the design

**Knowledge Packs (Section 4) need a platform-wide-vs-org-scoped read/write
distinction that only a real RBAC primitive can enforce correctly — and that primitive
does not exist yet.** This is the same missing piece Gate C.2C (ADR-011, reviewed in
`GATE_C2_RATIFICATION.md`) already names as the most widely-blocking single item in the
architecture. This design does not build a workaround for it; it names the dependency
explicitly in Section 9 and defers the enforcement question rather than inventing an ad
hoc substitute.

---

## 1. Current-State Analysis

### 1.1 What already exists, verified by direct read this session

| Component | File(s) | Reality |
|---|---|---|
| Context Engine schema | `add_context_engine.sql` | 5 tables (`context_profiles`, `brand_profiles`, `campaign_profiles`, `audience_profiles`, `context_variables`), real org-scoped RLS using `get_current_org_id()` — **the one RLS pattern in this repo to reuse verbatim, not reinvent** |
| Context Engine service | `ContextEngineService.ts` | 35 lines, one method (`generateContext`), browser-side, flattens key/value pairs to a map. No retrieval, no ranking, no memory — a static profile lookup, not a knowledge system |
| Knowledge Vault schema | `add_knowledge_vault.sql` | 5 tables (`vault_documents`, `rd_library`, `timeline_milestones`, `phases`, `decision_records`). **Confirmed by direct read: seeded content is "ICECRAFT"** — a wine-cooler/diamond-ice retail venture's founder timeline ("Wine Shop Survey," "Luxury Diamond Ice," "VyaparSethu Funding" as a *milestone name*, not a real integration). **No `organization_id` on any of these 5 tables.** RLS enabled, `USING (true)` public-read policy, no INSERT policy at all |
| Knowledge Vault API | `server.ts:502-650`, 7 `requireAuth`-gated routes | **Partially migrated since the last audit of this specific file** (a fact not previously surfaced in this session's other reports): the 5 `GET /api/vault/*` routes now use `postgrestFetch()` (RLS-respecting, caller's own token) per an inline comment citing "TASK-09's exit criterion." The `POST /api/vault/documents` route remains on the pooled `DATABASE_URL` connection — deliberately, because the underlying RLS policy has no INSERT rule, so migrating it as-is would silently break document creation. This is real, recent, positive progress this document had not previously credited |
| Knowledge Base service | `KnowledgeBaseService.ts` | **9 lines total.** `search()` logs `"Vector search for:"` and returns `[]`. `ingestDocument()` logs and does nothing. Zero consumers repo-wide. This is not a degraded version of a knowledge system — there is no knowledge system here at all |
| Storage buckets | `add_storage_bucket.sql`, `add_video_storage.sql` | Exactly 2 buckets exist: `image_assets`, `video_assets`. **Both public-read**, scoped only by `bucket_id`, no organization boundary in the storage policy itself (RLS-equivalent scoping happens at the database-row level, not the object level) |
| Vector/graph/search infrastructure | repo-wide grep, all `*.sql` files | **Confirmed absent, fresh this pass.** No `CREATE EXTENSION vector`, no `vector(...)` column type, no `tsvector`, no `graph_nodes`/`graph_edges` table anywhere. Only extension installed anywhere in the schema is `uuid-ossp` |
| AI Provider Manager | `server/ai/ProviderManager.ts`, `ProviderRouter.ts` | 6 real, server-side, credentialed, auth-gated providers (`gemini`, `nvidia`, `deepseek`, `qwen`, `glm`, `minimax`) — text/JSON generation only. **No embedding endpoint is wired for any provider today** |
| Prompt Studio | `prompt_*` (6 tables) | Real CRUD, org-scoped. Zero integration with any retrieval/context system today — prompts are authored and executed with no memory or knowledge injection |
| Image Studio | `image_*` (5 tables) | Real schema; generation is honest-failure as of this session's Phase 2 fix (unmerged). No integration point with L3 exists or is proposed in this sprint |
| Queue Runtime | `server/queue/QueueTypes.ts`, `QueueManager.ts`, `WorkerRegistry.ts` | Real, atomic (`FOR UPDATE SKIP LOCKED`), now reachable in production via the cron-triggered `processBatch()` (this session's Phase 3, unmerged). **`JobType` is a `string`-extensible union** — a new job type can be added with zero type-system changes, and `WorkerRegistry`'s handler-dispatch pattern (one class per modality, registered in its constructor) is a clean, already-proven extension point |

### 1.2 What this means

Layer 3 is not "partially built." It is **two disconnected, non-L3 things** (a
5-column context lookup, and a single-tenant founder-memory feature for an unrelated
product) sitting where L3 should be, plus one honest stub. Nothing here needs to be
salvaged into the new design except the RLS policy pattern and, cautiously, the
`context_profiles` shape as a precedent for "structured context" rows — not as
infrastructure to build on top of.

---

## 2. Gap Analysis

| # | Item | Finding |
|---|---|---|
| 1 | Reusable components | `get_current_org_id()` RLS pattern; Supabase Storage + bucket-policy mechanism; `requireAuth`/`AuthedRequest`; `audit.ts` event emission; `ProviderManager.ts`'s credential-resolution pattern (env-var-backed, fails closed); `WorkerRegistry`'s handler-dispatch extension point; `JobType`'s open string union; `QueueManager`'s claim/complete/fail lifecycle, unchanged |
| 2 | Missing database tables | No vector-capable table exists at all; no knowledge-source/document metadata table; no chunk table; no Knowledge Pack registry (named and reserved by ADR-003/ADR-009 but never created); no memory-entry table; no graph node/edge tables (also reserved, generically, per `MASTER_DATA_OWNERSHIP.md`, never created) |
| 3 | Missing services | No `KnowledgeSubstrateService` (a real implementation behind the current 9-line stub); no `EmbeddingService`; no `IngestionService` (chunking); no `MemoryRuntime`/`KnowledgeRuntime` at L4 (out of this sprint's scope per the L3/L4 split, but their calling contract needs to exist so Sprint 2 isn't blocked — Section 5) |
| 4 | Missing APIs | No `/api/v1/knowledge/*`, no `/api/v1/memory/*` of any kind |
| 5 | Missing queues | No `job_type` value for ingestion/embedding work; no handler class registered for one. Trivial to add — the extension point already exists (Section 1.1) |
| 6 | Missing storage buckets | No private bucket for raw source documents (PDF/DOCX/TXT) prior to chunking. The 2 existing buckets are public-read by design (fine for generated media, wrong default for potentially sensitive knowledge sources) |
| 7 | Missing vector search | `pgvector` extension not installed; no ANN index type (`ivfflat`/`hnsw`) exists anywhere; no similarity-search function |
| 8 | Missing GraphRAG | No entity/relationship extraction, no graph tables, no graph traversal capability, no hybrid vector+graph retrieval — all absent, not merely incomplete |
| 9 | Missing memory graph | No distinction anywhere in the schema between working/episodic/semantic memory; no write/recall API; no decay or consolidation logic |
| 10 | Missing embedding pipelines | No chunking strategy defined; no embedding model wired to any of the 6 existing providers; no batch/queue-driven embedding job; no re-embedding trigger on source update |

---

## 3. Target Architecture

Per `CANONICAL_ARCHITECTURE.md`'s explicit, deliberate L3/L4 split (ADR-002): **L3
stores and retrieves. It does not reason.** This sprint builds L3 only — the substrate —
and defines (but does not implement) the L4 calling contract that will consume it, so
that Sprint 2 (Memory Runtime / Knowledge Runtime, the reasoning layer) can begin
immediately against a stable interface rather than having to also design the storage
layer it depends on.

```
┌──────────────────────────────────────────────────────────────────┐
│ L4 — KNOWLEDGE & MEMORY RUNTIME (Sprint 2, interface defined here,│
│      not implemented this sprint)                                 │
│   KnowledgeRuntime.resolvePacksFor(request) → calls L3 search      │
│   MemoryRuntime.recall(query, scope)        → calls L3 search      │
│   MemoryRuntime.remember(entry)             → calls L3 write       │
├──────────────────────────────────────────────────────────────────┤
│ L3 — KNOWLEDGE & MEMORY SUBSTRATE (this sprint)                    │
│                                                                     │
│  KnowledgeSubstrateService                                         │
│    ingestSource() → enqueues job_type='knowledge_ingest'           │
│    similaritySearch(embedding, filters, topK)                      │
│    getChunksBySource() / getPack() / listPacks()                   │
│    upsertGraphNode() / upsertGraphEdge() / traverseGraph()          │
│    writeMemory() / recallMemory()                                   │
│                                                                     │
│  EmbeddingService (L4-adjacent, model call — see Section 5 note)   │
│    embed(text) → ProviderManager (new: embedding-capable provider) │
│                                                                     │
│  IngestionService                                                   │
│    chunk(sourceText) → KnowledgeJobHandler (new Worker Fleet class) │
├──────────────────────────────────────────────────────────────────┤
│ L2 — existing Worker Fleet / QueueManager, unchanged, reused        │
├──────────────────────────────────────────────────────────────────┤
│ L1 — existing requireAuth + get_current_org_id() RLS, reused        │
├──────────────────────────────────────────────────────────────────┤
│ L0 — Postgres + pgvector (new extension) + Supabase Storage         │
└──────────────────────────────────────────────────────────────────┘
```

**Note on `EmbeddingService`'s layer:** generating an embedding is a model call, which
by the L4 credential rule ("no module in any other layer holds a provider SDK or
credential") belongs at L4, not L3. It is included in this sprint's scope anyway
because L3's ingestion pipeline cannot function without it — it is designed and built
here as a **thin, single-purpose L4 component with no reasoning logic of its own** (it
does not decide *what* to embed or *when*, only *how* — the same narrow scope
`ProviderRouter.ts` already occupies relative to the six text providers), not as an
expansion of L3's boundary.

---

## 4. Database Schema

New migration file (proposed): `add_knowledge_memory_substrate.sql`. **Purely
additive** — no existing table is altered.

```sql
-- Requires pgvector. On Supabase this may need enabling via the dashboard's
-- Database > Extensions panel rather than this SQL alone, depending on plan —
-- flagged as a possible owner-required step, not assumed to succeed silently.
CREATE EXTENSION IF NOT EXISTS vector;

-- ── Knowledge sources: raw ingested material before chunking ──
CREATE TABLE IF NOT EXISTS public.knowledge_sources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL CHECK (source_type IN ('document', 'url', 'manual_text', 'conversation')),
    title TEXT NOT NULL,
    original_uri TEXT,
    storage_bucket_path TEXT,
    mime_type TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
    error_message TEXT,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Chunks: the retrievable unit ──
CREATE TABLE IF NOT EXISTS public.knowledge_chunks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id UUID REFERENCES public.knowledge_sources(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    chunk_index INT NOT NULL,
    content TEXT NOT NULL,
    token_count INT,
    embedding vector(768),           -- dimension matches the chosen embedding model (Section 5)
    embedding_model TEXT,
    embedded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Knowledge Packs: the registry ADR-003/ADR-009 already named and reserved ──
CREATE TABLE IF NOT EXISTS public.knowledge_packs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE, -- NULL = platform-wide pack
    industry_id UUID,                -- optional FK to industry_intelligence's industries table; not enforced here to avoid a cross-module FK this sprint doesn't own
    name TEXT NOT NULL,
    version INT NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'deprecated')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.knowledge_pack_chunks (
    pack_id UUID REFERENCES public.knowledge_packs(id) ON DELETE CASCADE,
    chunk_id UUID REFERENCES public.knowledge_chunks(id) ON DELETE CASCADE,
    PRIMARY KEY (pack_id, chunk_id)
);

-- ── Memory: working / episodic / semantic, per ADR-002's L4 Memory Runtime split ──
CREATE TABLE IF NOT EXISTS public.memory_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    memory_type TEXT NOT NULL CHECK (memory_type IN ('working', 'episodic', 'semantic')),
    scope TEXT NOT NULL CHECK (scope IN ('user', 'agent', 'conversation')),
    subject_id UUID NOT NULL,        -- the user/agent/conversation this memory belongs to
    content TEXT NOT NULL,
    embedding vector(768),
    importance_score REAL DEFAULT 0.5,
    expires_at TIMESTAMPTZ,           -- set for 'working' memory only; NULL = durable
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_accessed_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Graph: the generic reservation named in MASTER_DATA_OWNERSHIP.md, built for real here ──
CREATE TABLE IF NOT EXISTS public.graph_nodes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    node_type TEXT NOT NULL,
    label TEXT NOT NULL,
    properties JSONB DEFAULT '{}',
    embedding vector(768),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.graph_edges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    source_node_id UUID REFERENCES public.graph_nodes(id) ON DELETE CASCADE,
    target_node_id UUID REFERENCES public.graph_nodes(id) ON DELETE CASCADE,
    edge_type TEXT NOT NULL,
    properties JSONB DEFAULT '{}',
    weight REAL DEFAULT 1.0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── RLS: the exact pattern already in production use (add_context_engine.sql) ──
ALTER TABLE public.knowledge_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_pack_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.graph_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.graph_edges ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    t TEXT;
    org_scoped_tables TEXT[] := ARRAY['knowledge_sources', 'knowledge_chunks', 'memory_entries', 'graph_nodes', 'graph_edges'];
BEGIN
    FOREACH t IN ARRAY org_scoped_tables LOOP
        EXECUTE format('CREATE POLICY "Org isolation select" ON public.%I FOR SELECT USING (organization_id = public.get_current_org_id());', t);
        EXECUTE format('CREATE POLICY "Org isolation insert" ON public.%I FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());', t);
    END LOOP;
END
$$;

-- knowledge_packs: platform-wide (organization_id IS NULL) rows are readable by
-- everyone; write access to platform-wide packs is NOT modeled here — it requires
-- the RBAC primitive named in Section 9, not a permissive stand-in.
CREATE POLICY "Org or platform pack read" ON public.knowledge_packs
    FOR SELECT USING (organization_id = public.get_current_org_id() OR organization_id IS NULL);
CREATE POLICY "Org pack insert" ON public.knowledge_packs
    FOR INSERT WITH CHECK (organization_id = public.get_current_org_id());

-- knowledge_pack_chunks: scoped transitively via its pack's organization_id.
CREATE POLICY "Pack chunk read" ON public.knowledge_pack_chunks
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.knowledge_packs p WHERE p.id = pack_id
                AND (p.organization_id = public.get_current_org_id() OR p.organization_id IS NULL))
    );

-- ── Vector indexes (HNSW — no training/ANALYZE step required, unlike IVFFlat) ──
CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx ON public.knowledge_chunks
    USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS memory_entries_embedding_idx ON public.memory_entries
    USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS graph_nodes_embedding_idx ON public.graph_nodes
    USING hnsw (embedding vector_cosine_ops);

-- ── Supporting btree indexes ──
CREATE INDEX IF NOT EXISTS knowledge_chunks_source_idx ON public.knowledge_chunks(source_id);
CREATE INDEX IF NOT EXISTS memory_entries_subject_idx ON public.memory_entries(organization_id, subject_id, memory_type);
CREATE INDEX IF NOT EXISTS graph_edges_source_idx ON public.graph_edges(source_node_id);
CREATE INDEX IF NOT EXISTS graph_edges_target_idx ON public.graph_edges(target_node_id);
```

**Explicitly not touched:** `vault_documents`/`rd_library`/`timeline_milestones`/`phases`/
`decision_records`. ADR-010's Council decision remains open and unresolved by this
sprint. This design builds new, correctly-tenant-scoped L3 infrastructure alongside the
old, contested Vault feature — it does not migrate the Vault into it, and does not
attempt to.

---

## 5. Service Architecture

| Service | Layer | Responsibility | New/Replaces |
|---|---|---|---|
| `KnowledgeSubstrateService` | L3 | `ingestSource()`, `similaritySearch(embedding, filters, topK)`, `getChunksBySource()`, `listPacks()`, `upsertGraphNode()`, `upsertGraphEdge()`, `traverseGraph(nodeId, depth)`, `writeMemory()`, `recallMemory(embedding, scope, subjectId)` — pure storage/retrieval, no decision logic | **Replaces** the 9-line `KnowledgeBaseService.ts` stub |
| `EmbeddingService` | L4-adjacent (model call, see Section 3 note) | `embed(text): number[]` — wraps a chosen embedding-capable provider, following `ProviderManager.ts`'s exact credential/fail-closed pattern. **Recommend Gemini's `text-embedding-004`** as the first real path (Gemini is already the default, most-integrated provider in this repo) — one provider proven first, exactly as this session's AI Router work and the Video Factory plan both already established as the right sequencing | New |
| `IngestionService` | L3 | `chunk(sourceText, strategy)` — simple fixed-size-with-overlap chunking for this sprint (paragraph-aware chunking is a reasonable Sprint 2+ refinement, not required to make the pipeline real) | New |
| `KnowledgeJobHandler` | L2 (Worker Fleet) | New handler class, sibling to `AIJobHandler`/`MediaJobHandler`/`PublishingJobHandler`, registered in `WorkerRegistry`'s constructor and `executeJob()`'s switch statement. Dispatches `job_type: 'knowledge_ingest'` to `IngestionService.chunk()` → `EmbeddingService.embed()` per chunk → `KnowledgeSubstrateService` writes | New |
| `MemoryRuntime`, `KnowledgeRuntime` | L4 | **Not implemented this sprint.** Interface contract only (Section 3) — `resolvePacksFor(request)`, `recall(query, scope)`, `remember(entry)` — so Sprint 2 has a stable substrate to build reasoning logic against | Deferred, contract defined |

**Consistency with the already-proven pattern:** every new piece above is a direct
structural sibling of something this session already verified working — `EmbeddingService`
mirrors `ProviderManager.ts`; `KnowledgeJobHandler` mirrors the 3 existing handler
classes; the ingestion job reuses `QueueManager`'s claim/complete/fail lifecycle
unchanged. No new architecture is introduced — this is the same "reuse the existing
precedent" discipline this session's Worker Fleet activation and Video Factory plan both
already applied.

---

## 6. API Architecture

All routes `requireAuth`-gated, following the existing `AuthedRequest` pattern; embedding-
triggering routes additionally gated by the existing `aiRateLimit` middleware (already
applied to `/api/vault/ai-summary`) since embedding calls, like text generation, cost
money per call.

| Route | Method | Purpose |
|---|---|---|
| `/api/v1/knowledge/sources` | POST | Register a new source (text, URL, or a reference to an already-uploaded document); enqueues `job_type: 'knowledge_ingest'` |
| `/api/v1/knowledge/sources` | GET | List sources for the caller's org, with `status` |
| `/api/v1/knowledge/sources/:id` | GET | Single source detail + its chunks |
| `/api/v1/knowledge/search` | POST | Body: `{ query: string, packIds?: string[], topK?: number }`. Embeds the query via `EmbeddingService`, calls `KnowledgeSubstrateService.similaritySearch()` |
| `/api/v1/knowledge/packs` | GET | List Knowledge Packs visible to the caller (org-owned + platform-wide) |
| `/api/v1/memory/write` | POST | Thin pass-through to `KnowledgeSubstrateService.writeMemory()` — **interface defined now, intended primary caller (an Agent Runtime) does not exist yet**, so this route is real but will have no real caller until Sprint 2+ |
| `/api/v1/memory/recall` | POST | Same caveat — real, callable, but its natural consumer doesn't exist yet |

---

## 7. Queue Architecture

- New `job_type` value: `'knowledge_ingest'` — no type-system change required
  (`JobType` already includes `| string`).
- New handler: `KnowledgeJobHandler`, registered in `WorkerRegistry`'s `supportedTypes`
  default array and its `executeJob()` switch statement, exactly like the three existing
  handlers.
- Failure handling: unchanged — `QueueManager.failJob()`'s existing retry/backoff/
  dead-letter logic applies automatically; no new failure-handling code is needed.
- Execution path: reuses this session's Phase 3 `processBatch()` — a cron-triggered
  ingestion job is claimed, chunked, embedded, and written within one bounded,
  serverless-safe invocation, the same shape already proven for image/video/publishing
  jobs.

---

## 8. Storage Architecture

| Bucket | Visibility | Purpose |
|---|---|---|
| `knowledge_sources` (new) | **Private** — signed URLs only, not public-read | Raw uploaded documents (PDF/DOCX/TXT) prior to chunking. Deliberately **not** copying the existing `image_assets`/`video_assets` buckets' public-read pattern — those buckets hold generated media meant to be shared; this one may hold sensitive organizational documents, and the security default should differ accordingly |
| `image_assets`, `video_assets` (existing) | Unchanged | Out of scope for this sprint |

**Flagged, not fixed:** the two existing buckets scope access only by `bucket_id`, with
no organization boundary at the storage-policy level (row-level org scoping happens in
the database tables that reference the objects, not in Storage itself). This sprint does
not retrofit that — it is a pre-existing pattern this sprint chooses not to replicate for
the new, more sensitive bucket, not a claim that the old buckets are being fixed.

---

## 9. Security Model

- **RLS on every new table**, using the exact `get_current_org_id()` function already in
  production use — no new policy mechanism invented (Section 4).
- **Knowledge Packs' platform-wide rows are the first concrete point in this schema
  where real RBAC is required, not optional.** Read access for `organization_id IS NULL`
  rows is safe to grant broadly (Section 4's policy). **Write access to platform-wide
  packs is deliberately left unenforced by any policy in this design** — granting it to
  "any authenticated user" would be wrong, and there is no `authorize()` primitive yet to
  scope it to platform admins correctly (the same gap Gate C.2C names, `GATE_C2_RATIFICATION.md`).
  Recommendation: platform-wide pack writes should go through a server-side route
  gated by a manual, temporary allow-list check (an explicit array of admin user IDs in
  an env var) **until** the real RBAC primitive lands — an honest, temporary,
  clearly-labeled stopgap, not a silent gap and not a permissive RLS policy standing in
  for authorization.
- **Embedding endpoints rate-limited** via the existing `aiRateLimit` middleware — same
  cost-control reasoning already applied to text generation.
- **New storage bucket is private by default** (Section 8) — a deliberate improvement
  over the existing buckets' pattern, not a retrofit of it.
- **Explicitly avoiding the Knowledge Vault's mistake:** every table in this design has
  `organization_id` and a real policy from the migration that creates it — unlike the
  Vault, which has neither, six weeks after that gap was first documented (ADR-010).

---

## 10. Migration Plan

1. **Owner/DBA step, possibly required first:** confirm `pgvector` is enabled for the
   Supabase project (Database → Extensions in the dashboard) — `CREATE EXTENSION`
   may fail silently or require elevated privilege depending on plan tier. Flagged
   explicitly rather than assumed.
2. Run `add_knowledge_memory_substrate.sql` (Section 4) — creates all 7 new tables, all
   RLS policies, all indexes. Purely additive; no existing table is touched, no data
   migration is required because nothing existing maps onto this schema.
3. Register the new `knowledge_sources` storage bucket (private, signed-URL policy).
4. Implement `KnowledgeSubstrateService`, `EmbeddingService`, `IngestionService`,
   `KnowledgeJobHandler` (Section 5) — code work, not covered by this design-only
   document per the mission's constraint.
5. Wire the 6 new API routes (Section 6).
6. **Do not** touch `vault_documents`/`rd_library`/etc. — ADR-010 remains open,
   unresolved, and outside this sprint's scope.
7. Verification, before declaring this sprint done: one real source ingested, chunked,
   embedded via the one real `EmbeddingService` path, and retrieved via
   `/api/v1/knowledge/search` with a non-trivial similarity result — the same
   "one real thing proven end-to-end" bar this session has already applied to the AI
   Router (one provider, live-probed) and is recommending for Video Factory (one
   provider, real asset).

---

## What Sprint 2 inherits, ready to begin immediately

A stable L3 storage/retrieval substrate (`KnowledgeSubstrateService`) and a named,
interface-defined L4 contract (`MemoryRuntime`/`KnowledgeRuntime`) to build reasoning
logic against — without Sprint 2 needing to also design the storage layer underneath
it. The one open dependency Sprint 2 (or an earlier sprint) must still resolve before
Knowledge Packs can be safely multi-tenant in the way ADR-003/ADR-009 intend: the RBAC
primitive named in Section 9 and, separately, in Gate C.2C.

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GyjerP42mTVzzK2ZkSeRCf
