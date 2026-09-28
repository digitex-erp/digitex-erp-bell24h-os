# RFQ Matching Engine — Master Gap Analysis

**Date:** 2026-09-28. Read-only classification only — no code changed, nothing built. Evidence-based per the repo's evidence standard: every "Already Built"/"Partial" claim below carries a file:line citation; every "Not Started" is either a direct negative search result or an explicit "verified absent" finding already on record elsewhere in this repo.

## 1. Existing RFQ infrastructure — **Partial (schema only)**

`supabase_schema.sql` defines a complete RFQ data model: `buyers` (line 135), `suppliers` (147), `contacts` (159), `categories` (174), `products` (186), `rfqs` (200), `rfq_items` (213), `quotations` (226) — every table carries `organization_id` for tenant scoping. This was confirmed in this same audit pass.

**No application layer exists.** A repo-wide search across every `.ts` and `.tsx` file for `/api/rfq`, `/api/quotations`, and any `.from('rfqs')`/`.from('quotations')`-style client call returned **zero matches anywhere** — no backend route, no frontend page, no Supabase client call touches these tables. This matches the repo's own prior finding in `docs/architecture/REALITY_TO_TARGET_GAP_MAP.md:54`: *"**Matching** — No table, service, or code anywhere (verified by direct schema search)... Not built in Bell24h-OS at all. VERIFIED ABSENT (Bell24h-OS)."*

**Classification: Partial** — schema exists, everything above the schema layer (routes, UI, matching logic) is absent.

## 2. Missing matching engine components — **Not Started**

No file, class, or function named anything matching-related was found (`matching engine`, `MatchingEngine`, `matching_engine` — zero hits repo-wide). There is no candidate-generation, ranking, or scoring code of any kind for RFQ-to-supplier matching. This is a from-scratch build: candidate retrieval, ranking/scoring, and a persistence layer for match results all need to be designed and built.

## 3. Vector search requirements — **Not Started (planned in docs, not built)**

`docs/architecture/CANONICAL_ARCHITECTURE.md` places a vector store at **L3 Knowledge & Memory Substrate** (lines 99-101, 120-121: "Postgres + pgvector, object storage, cache/queue..."). But the same document's reality-check section states plainly (line 249): *"L3 does not exist — no pgvector, no graph, no search, no pack registry."* No `pgvector` extension reference, no vector column, and no vector-search query exists anywhere in `supabase_schema.sql` or the codebase.

**Classification: Not Started** — architecturally planned (L3 substrate), zero implementation.

## 4. Embedding requirements — **Not Started (stubbed, non-functional)**

`src/modules/knowledge/KnowledgeBaseService.ts` (entire file, 9 lines) is the only embedding/vector-adjacent code in the repo:
```ts
export class KnowledgeBaseService {
  static async search(query: string) {
    console.log("Vector search for:", query);
    return [];
  }
  static async ingestDocument(doc: File) {
    console.log("Ingesting document into vector store:", doc.name);
  }
}
```
`search()` unconditionally returns an empty array; `ingestDocument()` only logs. No embedding model is called, no vector is computed or stored, anywhere. This is a named stub, not partial functionality — classified as Not Started rather than Partial because there is no working code path to build on, only a signature.

## 5. Supplier scoring engine — **Not Started**

No file, table, or code reference to supplier scoring exists. `docs/architecture/MASTER_MODULES.md:143` lists Trust Score/Ratings under Commerce as **"VERIFIED ABSENT"** (see §7 below) — supplier scoring would depend on that same absent substrate.

## 6. Buyer scoring engine — **Not Started**

Same result as §5 — no buyer-scoring code, table, or reference found anywhere.

## 7. Trust score integration — **Not Started (verified absent, on record)**

`docs/architecture/MASTER_MODULES.md:143`: *"Commerce: Payment · Wallet · Ledger · Escrow — FUTURE — VERIFIED ABSENT — Wallet/Ledger/Trust Score/Ratings → no source matches; Escrow → planning docs only."* This audit's own repo-wide search for `trust_score`/`trust score`/`trustscore` corroborates it: no matches outside that one documentation line.

## 8. SHAP explainability layer — **Not Started**

Zero SHAP-related code anywhere. The only reference in the entire repository is a **branch name**, not code: `SSH_KEY_EXPOSURE_REPORT.md:15` lists `feature/shap-lime-integration` among branches checked during a prior security audit, noting the audited item was "absent" from it. That branch does not exist in this local repo's branch list (`git branch -a`) and no commit message anywhere mentions SHAP. There is no evidence this branch ever contained real SHAP code — its name suggests intent, not delivery.

## 9. LIME explainability layer — **Not Started**

Identical situation to §8 — same branch-name-only reference, zero code.

## 10. Qdrant integration — **Not Started**

Zero references to "qdrant" anywhere in the repository (docs, code, config, `package.json`). No vector database of any kind is configured or referenced. This would be a fully new infrastructure dependency, not a gap in existing wiring.

## 11. Supabase integration — **Partial (present, but not for matching)**

Supabase is the repo's live backend (`@supabase/supabase-js` in `package.json`, `server/lib/supabaseRest.ts`, `SUPABASE_URL`/`SUPABASE_ANON_KEY` in `.env`) and does host the RFQ schema (§1). But Supabase's role today is generic Postgres + REST access — it has no vector extension enabled or referenced (§3), and nothing in the Supabase layer currently serves matching. **Note:** an untracked, uncommitted `AGENTS.md` was added to this repo root this session claiming the project runs on an InsForge backend instead — that claim does not match the code (see `COMMUNICATION_HUB_CERTIFICATION_REPORT.md` §8 for the full finding). Any future matching-engine work should confirm which backend is authoritative before building against either.

## 12. AI Provider Manager integration — **Not Started**

`server/ai/ProviderManager.ts` and `server/ai/ProviderRouter.ts` exist and are real, used elsewhere in this codebase (text-generation routing across `DeepSeekProvider.ts`, `GLMProvider.ts`, `GeminiProvider.ts`, `MiniMaxProvider.ts`, `NvidiaProvider.ts`, `QwenProvider.ts`). A direct search of both files for `rfq`, `RFQ`, or `matching` returned **zero matches** — neither file has any awareness of RFQ matching. If a matching engine needs an LLM call (for embeddings, re-ranking, or explanation generation), it does not currently hook into this router at all and would need new integration work.

## Summary table

| # | Component | Status |
|---|---|---|
| 1 | RFQ infrastructure | Partial (schema only) |
| 2 | Matching engine components | Not Started |
| 3 | Vector search | Not Started (planned, unbuilt) |
| 4 | Embeddings | Not Started (stubbed) |
| 5 | Supplier scoring | Not Started |
| 6 | Buyer scoring | Not Started |
| 7 | Trust score | Not Started (verified absent) |
| 8 | SHAP | Not Started |
| 9 | LIME | Not Started |
| 10 | Qdrant | Not Started |
| 11 | Supabase integration | Partial (generic only) |
| 12 | AI Provider Manager hook | Not Started |

## Prioritized recommendation

Given nothing above the schema layer exists, a matching engine cannot be sequenced as one sprint — it is a multi-phase build. Suggested order:

- **P0 — RFQ application layer.** Build the basic CRUD routes/UI for `rfqs`/`rfq_items`/`quotations` first (see `C4_EXECUTION_READINESS_REPORT.md` — this is also what blocks any buyer/supplier account testing). Nothing else in this document is testable without it.
- **P1 — Decide and provision the vector substrate.** Resolve the Supabase-vs-InsForge question first (§11), then decide `pgvector`-on-Postgres vs. a dedicated Qdrant instance before writing embedding code against either.
- **P1 — Real embeddings.** Replace `KnowledgeBaseService`'s stub with an actual embedding call (likely via the existing `ProviderRouter`, once §12's integration gap is closed) and real vector storage.
- **P2 — Supplier/buyer scoring + trust score integration.** These depend on §7's trust-score substrate existing first (currently verified absent) — sequencing scoring before trust score would mean building on a placeholder.
- **P3 — SHAP/LIME explainability.** Lowest priority — explainability layers are only meaningful once there's a working, non-trivial scoring model to explain. Building them earlier would have nothing real to explain.
