# Bell24h-OS — Master Data Ownership

**Part of PS-02.** Which entities live where, who may read and write them, and where
tenant boundaries must be enforced.

**States the *intended* model and records where reality differs. No schema was inspected
live, altered, or migrated.** RLS claims are read from `supabase_schema.sql` (the file),
**not** the live database — that distinction is carried on every row.

---

## The tenancy rule

**`organization_id` is the shard key of the entire platform.** Every tenant entity carries
it, every query filters on it, and enforcement happens in **two independent places**:

1. **Application scope** — L1's `SecurityContext` injects `organization_id` via a scoped
   repository. A module must not be able to *express* an unscoped query.
2. **Postgres RLS** — an independent policy rejects cross-tenant rows.

Both, not either. Each alone has a failure mode: application scope is defeated by a raw
connection; RLS is defeated by a pooled connection. **The current system relies on neither
reliably.**

### Three access paths

| Path | Used by | RLS | Rule |
|---|---|---|---|
| Browser Supabase client (anon key + user JWT) | SPA | **Enforced** | Explicit column projections only — never `select('*')` on a table holding secrets |
| Server Supabase client (caller's JWT) | Server acting as user | **Enforced** | Preferred server path; `requireAuth` already uses it |
| Direct pool (`DATABASE_URL`) | Migrations, admin jobs | **BYPASSED** | Set `organization_id` explicitly; **forbidden in request handlers** |

**Confidence: VERIFIED.** The third path is the system's largest hole — **9 request
handlers use it**, so for those routes RLS is not a control at all, whatever policies exist.

---

## Critical findings — read before trusting any RLS claim below

### 1. Cross-tenant isolation has never been demonstrated — UNVERIFIED

The strongest available evidence (owner-reported `V1.0 STABLE`) proves **an organization
can read its own row**. It does **not** prove a *different* organization is denied. Those
are different claims; only the first has evidence.

Required artifact: authenticate as a user in org B, query a table containing org A rows,
observe **zero rows**. Never run.

Until then, treat every "Org" scope below as **INFERRED from the schema file**, not
verified behaviour. This is the single most consequential unverified claim in the
architecture (ADR-008) and the highest-value test available to the project.

### 2. Knowledge Vault has no tenant boundary — KNOWN ISSUE, not a design choice

`vault_documents`, `rd_library`, `timeline_milestones`, `phases`, `decision_records`
(`supabase_schema.sql:1892-1970`):

- **No `organization_id` on any of them** — nothing to scope by.
- RLS enabled, but policy is `CREATE POLICY "Public Read Access" ... USING (true)` — read
  granted to everyone. **No write policy exists at all.**
- All 7 handlers use the **pooled connection**, so RLS is bypassed regardless.
- RG-C added `requireAuth`, closing anonymous access. **Authenticated cross-tenant access
  remains open.**

Recorded as a **KNOWN ISSUE**. Resolution is ADR-010 and is explicitly *not* decided here.

### 3. Provider credentials still live in a tenant-readable column

`ai_providers.api_key` still exists and is selectable at the grant level. The browser no
longer *asks* for it (RG-C verified), but nothing prevents a future query from doing so.
**Treat every key it has held as compromised** until `REVOKE` + rotation.

---

## Entity ownership by layer

**Scope legend:** `Org` = members of the owning organization · `Self` = the row's own user ·
`Platform` = shared across all tenants (`organization_id IS NULL`) · `Server` = server-side
only · `None` = no path exists.

### Layer 1 — Identity, Tenancy & Security

| Entity | Owner | Read | Write | `organization_id`? | Evidence |
|---|---|---|---|---|---|
| `auth.users` | L1 (Supabase Auth) | Server | Supabase Auth only | N/A — global | **System of record for identity.** Supabase-managed |
| `profiles` | L1 | Org + self | Self | ✅ | Hand-written policy `:507-515`. INFERRED. **System of record for application user data** |
| `organizations` | L1 | Own org | Admin (intended) | is the tenant root | Policy `:497-503`. INFERRED |
| `roles` | L1 | Org | Admin | ✅ | Generic loop. INFERRED |
| `permissions` | L1 | — | — | ❌ | ⚠️ **NO RLS, NO POLICY.** VERIFIED gap. Ownership open (ADR-003): likely a **Platform** catalogue, not tenant data |
| `user_roles` | L1 | Org | Admin | ✅ | Generic loop. INFERRED |
| `audit_logs` | L1 | Org | **Server only, append-only** | ✅ | Table exists but is **never written**. VERIFIED |
| `api_keys` | L1 | **Server only** | Server | ✅ | Generic loop. No client code queries it — VERIFIED |

### Layer 2 — Platform Core Services

| Entity | Owner | Read | Write | `organization_id`? | Evidence |
|---|---|---|---|---|---|
| `job_queue` | L2 | Org | Org | ✅ | SELECT/INSERT/UPDATE policies. INFERRED |
| `job_dependencies`, `job_logs` | L2 | Org via parent (`EXISTS`) | Org | via parent | **No UPDATE/DELETE policy.** INFERRED |
| `job_workers`, `job_schedules` | L2 | Org | — | ✅ | SELECT only. INFERRED |
| `job_priorities` | L2 | **None** | **None** | ✅ | ⚠️ **RLS on, NO policy** → denies everything. VERIFIED gap |
| `workflows`, `workflow_runs` | L2 | Org | Org | ✅ | Generic loop. INFERRED |
| `automation_*`, `workflow_*` (11 tables) | L2 | Org | Org | ✅ | Generic loop. INFERRED |
| `workflow_templates` | L2 | Org | Org | ✅ | ⚠️ **RLS never enabled.** VERIFIED gap |
| `notifications` | L2 | Org | Server | ✅ | Generic loop. Schema-only |
| `activities` | L2 | Org | Org | ✅ | Generic loop. INFERRED |
| **`integration_connectors`** | L2 Integration Hub | **Platform** | Platform team | ❌ by design | **FUTURE.** Connector definitions are platform assets, not tenant data (ADR-006) |
| **`integration_bindings`** | L2 Integration Hub | Org | Org admin | ✅ required | **FUTURE.** Which connectors an org has enabled |
| **`integration_credentials`** | L2 Integration Hub | ⚠️ **Server only — never client-readable** | Server | ✅ required | **FUTURE.** Envelope-encrypted, KMS-wrapped DEK. Same rule as provider keys (ADR-006) |

### Layer 3 — Knowledge & Memory Substrate

| Entity | Owner | Read | Write | `organization_id`? | Evidence |
|---|---|---|---|---|---|
| `context_profiles`, `brand_profiles`, `campaign_profiles`, `audience_profiles`, `context_variables` | L3 | Org | Org | ✅ | Generic loop. INFERRED |
| **`vault_documents`** | L3 (contested) | ⚠️ **Public** | Server (no policy) | ❌ **NO** | ⚠️ `USING (true)`. **VERIFIED — no tenant boundary** |
| **`rd_library`** | L3 (contested) | ⚠️ **Public** | Server | ❌ **NO** | ⚠️ same |
| **`timeline_milestones`** | L3 (contested) | ⚠️ **Public** | Server | ❌ **NO** | ⚠️ same |
| **`phases`** | L3 (contested) | ⚠️ **Public** | Server | ❌ **NO** | ⚠️ same |
| **`decision_records`** | L3 (contested) | ⚠️ **Public** | Server | ❌ **NO** | ⚠️ same |
| **`knowledge_packs`** | L3 registry | **Platform** (published) + Org (private) | Platform team / org admin | ✅ **nullable** | **FUTURE.** `NULL` = platform-published pack; non-null = org's private pack or override (ADR-003) |
| **`knowledge_pack_versions`** | L3 registry | same as parent | Platform / org admin | via parent | **FUTURE.** Packs are versioned and immutable once published |
| **`knowledge_pack_assets`** | L3 registry | same as parent | same | via parent | **FUTURE.** Taxonomy, rules, compliance, prompts, KB documents |
| **`memory_records`** | L3 | Org | Org | ✅ **required** | **FUTURE.** Must filter by tenant *before* ranking |
| **`graph_nodes` / `graph_edges`** | L3 | Org | Org | ✅ required | **FUTURE** |

**The nullable-`organization_id` pattern for knowledge packs is deliberate**, and the
schema already contains a precedent: `prompt_categories` uses
`USING (organization_id = current OR organization_id IS NULL)`. Platform-published packs
are shared; an org may add private packs or override a platform pack. **Resolution
precedence: org override → org private → platform published** (ADR-003).

### Layer 4 — Enterprise AI Runtime

| Entity | Owner | Read | Write | `organization_id`? | Evidence |
|---|---|---|---|---|---|
| `ai_providers` | L4 | Org — **minus `api_key`** | Org admin | ✅ | Explicit policies `:610-613`. Client projection excludes `api_key` — VERIFIED |
| `ai_providers.api_key` (column) | L4 | ⚠️ **should be Server only** | Server | — | ⚠️ **No column `REVOKE`.** VERIFIED gap |
| `ai_request_logs` | L4 | Org | Server (append) | ✅ | Policies `:616-619`. Client `select('*')` pulls `prompt`/`response` — data-minimisation concern |
| `prompt_categories` | L4 | Org **or Platform** (`NULL`) | Org | ✅ nullable | Shared-catalogue pattern — the precedent for knowledge packs. INFERRED |
| `prompt_templates` | L4 | Org | Org | ✅ | Explicit. INFERRED |
| `prompt_versions`, `prompt_variables` | L4 | Org via parent | Org | via parent | Parent-scoped. INFERRED |
| `prompt_executions` | L4 | Org | Org | ✅ | Explicit. INFERRED |
| `prompt_favorites` | L4 | **Self** (`auth.uid()`) | Self | ❌ user-scoped | Correct per-user pattern `:726-728`. INFERRED |
| `ai_agents`, `ai_jobs` | L4 | Org | Org | ✅ | Generic loop. Schema-only |
| **`agent_profiles`** | L4 Agent Runtime | **Platform** + Org override | Platform / org admin | ✅ nullable | **FUTURE.** The 6 assistants are rows here, not modules (ADR-004) |
| **`model_registry`** | L4 | **Platform** | Platform team | ❌ by design | **FUTURE.** Available foundation models + routing metadata |
| **`fine_tuned_models`** | L4 Transformer Runtime | Org (owner) or Platform | Server | ✅ **required** | **FUTURE.** A model fine-tuned on tenant data **is tenant data** (ADR-002) |

**Binding rule:** provider credentials are **L4-server-only**, never selectable by `anon`
or `authenticated`, in any table, ever.

### Layer 5 — Applied AI Capabilities

| Entity group | Owner | Read | Write | `organization_id`? | Evidence |
|---|---|---|---|---|---|
| `content_*` (5) | L5 Content Factory | Org | Org | ✅ | Explicit `:801-824`. INFERRED |
| `image_*` (5) | L5 Image Factory | Org | Org | ✅ | Explicit `:919-942` + bucket. INFERRED |
| `video_*` (7) | L5 Video Factory | Org | Org | ✅ | Explicit `:1067-1100`. INFERRED |
| `media_*` (6) | L5 Media Composer | Org | Org | ✅ | Generic loop. INFERRED |
| `publishing_*` (9) + `social_accounts` | L5 Publishing | Org | Org | ✅ | Generic loop. `social_accounts` defined **twice** |
| `seo_*` (7) | L5 SEO | Org | Org | ✅ | Generic loop. `seo_projects` defined **twice** |
| `campaigns`, `campaign_assets` | L5 Campaign | Org | Org | ✅ | Generic loop. `campaigns` defined **twice** |
| Performance (9 tables) | L5 Performance | Org | Org | ✅ | Explicit `:1863-1884`. INFERRED |
| `industries`, `industry_categories`, `industry_subcategories`, `industry_products` | L5 / L3 | Org today — **should be Platform** | — | ✅ today | Generic loop. **Ownership open (ADR-003)** — taxonomy is reference data, not tenant data |
| `buyer_personas`, `supplier_personas` | L5 | Org | Org | ✅ | Correctly tenant-specific |
| `tags`, `tag_relations`, `attachments`, `notes`, `tasks` | L5 | Org | Org | ✅ | Generic loop. INFERRED |
| **`factory_jobs`, `factory_assets`** | L5 Factory Platform | Org | Org | ✅ required | **FUTURE.** Unified pipeline replacing per-modality duplication (ADR-005) |
| **Commerce: Payment · Wallet · Ledger · Escrow** | L5 Commerce | Org | Org | ✅ required | **No tables exist.** FUTURE |

### Layer 6 — Applications (VyaparSethu domain)

| Entity | Owner | Read | Write | `organization_id`? | Evidence |
|---|---|---|---|---|---|
| `companies`, `contacts` | L6 | Org | Org | ✅ | Generic loop. Schema-only |
| `buyers`, `suppliers` | L6 VyaparSethu | Org | Org | ✅ | Generic loop. Schema-only |
| `products`, `categories` | L6 VyaparSethu | Org | Org | ✅ | Generic loop. Schema-only |
| `rfqs`, `rfq_items` | L6 VyaparSethu | Org | Org | ✅ | Generic loop. Schema-only |
| `quotations`, `quotation_items` | L6 VyaparSethu | Org | Org | ✅ | Generic loop. Schema-only |
| `orders`, `order_items` | L6 VyaparSethu | Org | Org | ✅ | Generic loop. Schema-only |

**These 12 table groups are the marketplace domain and belong to the application, not the
platform** — correcting `ARCHITECTURE_DECISIONS.md:26` (ADR-001). They carry org isolation
but have **no service, page, or CRUD path anywhere in `src/`** (VERIFIED).

---

## Ownership answers for the eight elements

| Question | Answer | ADR |
|---|---|---|
| **Industry Knowledge Packs — org-specific or shared?** | **Both, by precedence.** Platform-published packs (`organization_id IS NULL`) are readable by all tenants; an org may hold private packs and overrides. Resolution: org override → org private → platform. | ADR-003 |
| **Category configurations — shared or org-customised?** | Shared baseline, org-customisable. A category is a pack; customisation is an override row, never a code branch. | ADR-003, ADR-009 |
| **AI Factory outputs — who owns generated assets?** | **The requesting organization**, always. `factory_assets.organization_id` is non-null, set from the `SecurityContext` at creation. Provenance (model, prompt, pack version, cost) is recorded on the asset. Platform never claims ownership of tenant-generated output. | ADR-005 |
| **Integration credentials — per org or centralised?** | **Per org, server-only, envelope-encrypted.** Connector *definitions* are platform assets; *credentials* and *bindings* are org-scoped and never client-readable. | ADR-006 |
| **Assistant reasoning — org-specific context or shared?** | **Shared reasoning, org-scoped context.** One Agent Runtime and six shared profiles; every invocation is bound to the caller's `SecurityContext`, memory scope, and pack scope. Reasoning logic is platform; everything it reasons *over* is tenant data. | ADR-004 |
| **Fine-tuned models — platform or tenant?** | **A model fine-tuned on tenant data is tenant data.** `organization_id` required; must never serve another tenant. | ADR-002 |

---

## Tables requiring `organization_id` that lack it

| Table | Current | Required | Consequence today |
|---|---|---|---|
| `vault_documents` | ❌ | ✅ if platform-owned | No tenant boundary; every authenticated user reads all rows |
| `rd_library` | ❌ | ✅ if platform-owned | Same |
| `timeline_milestones` | ❌ | ✅ if platform-owned | Same |
| `phases` | ❌ | ✅ if platform-owned | Same |
| `decision_records` | ❌ | ✅ if platform-owned | Same |
| `permissions` | ❌ | ⚠️ **decide** — likely a Platform catalogue | No RLS at all either way |

**Backfill hazard (ADR-010):** the five vault tables hold existing rows with **no owner**,
seeded with ICECRAFT founder content. Backfilling to "the first organization" would
silently grant one tenant ownership of another's data. A backfill target must be named
explicitly by the Council, or the data declared disposable.

---

## Data ownership principles (binding)

1. **One system of record per entity.** `auth.users` for identity; `profiles` for
   application user data. Analytics never becomes a second system of record.
2. **`organization_id` on every tenant entity** — non-null, FK to `organizations(id)`.
3. **Platform-shared reference data uses `organization_id IS NULL`**, never a duplicated
   per-tenant copy.
4. **Modules own their tables.** Cross-module reads go through the owning module's query
   contract or a projection — never a direct join into another module's internals.
5. **A module never opens its own database connection.** It receives a scoped repository
   constructed *from* a `SecurityContext`.
6. **Credentials never live in tenant-readable rows** — server secret storage only. Applies
   equally to provider keys and integration credentials.
7. **Filter by tenant *before* ranking or aggregating**, never after. Filtering after
   ranking leaks cross-tenant result counts even when rows are hidden.
8. **Audit is append-only and server-written.**
9. **Generated assets belong to the requesting organization**, with full provenance.
