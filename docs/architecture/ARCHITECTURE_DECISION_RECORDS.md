# Bell24h-OS — Architecture Decision Records

**Part of PS-02.** Every architectural choice made in the freeze, and why.

Status: `ACCEPTED` (decided here) · `OPEN` (options recorded, Council decides) · `SUPERSEDED`.

| ADR | Title | Status |
|---|---|---|
| [001](#adr-001) | Platform Layer Model Selection | ACCEPTED |
| [002](#adr-002) | Transformer Runtime Positioning | ACCEPTED |
| [003](#adr-003) | Category Architecture — Configuration vs Implementation | ACCEPTED |
| [004](#adr-004) | Enterprise AI Support Architecture | ACCEPTED |
| [005](#adr-005) | AI Factory Platform Architecture | ACCEPTED |
| [006](#adr-006) | Enterprise Integration Hub Architecture | ACCEPTED |
| [007](#adr-007) | 3DFabrica Product Scope Clarification | ACCEPTED (by Council) |
| [008](#adr-008) | Multi-Tenant Data Ownership Model | ACCEPTED (one premise unverified) |
| [009](#adr-009) | Category Extensibility Model | ACCEPTED |
| [010](#adr-010) | Knowledge Vault Architectural Role | **OPEN — Council decision required** |
| [011](#adr-011) | C.2C Formal Definition for Gate C Closure | **OPEN — proposed, needs ratification** |
| [012](#adr-012) | AI Runtime Consolidation & Extraction Sequence | ACCEPTED |
| [013](#adr-013) | Treatment of Existing Layer-Boundary Violations | ACCEPTED |

> **Numbering note.** The brief's Gate C table cites "ADR-004" for C.2C and "ADR-003" for
> Vault, but its own required-ADR list assigns those numbers to AI Support and Category
> Architecture, placing Vault at 010 and C.2C at 011. The explicit list is followed. Any
> external reference to "ADR-003/004" for Vault/C.2C means **ADR-010/011** here.

---

<a name="adr-001"></a>
## ADR-001 — Platform Layer Model Selection

**Status:** ACCEPTED

### Context

**Finding 1 — only two models exist, not three.** The brief's "THREE COMPETING MODELS"
section is empty in the text supplied, and `bell24h-platform-strategy-v2.md` does not exist:

```
$ find . -iname "*platform-strategy*" -not -path "./node_modules/*"   → (no results)
$ grep -rniE "layer\s*0|layer\s*6" --include="*.md" .                 → (none outside ./docs/)
```

Choosing Layer 0–6 therefore **authors** it. Confidence: **UNKNOWN → decided here.** No
future reader should mistake this for a recovered artifact.

**Finding 2 — attribution is inverted.** The 9-stage pipeline is in
`ARCHITECTURE_DECISIONS.md:9-19`, **tracked and committed** (`5c24483`) — the only committed
architecture model in the repository. The kernel model is untracked and self-labelled
`DESIGN — NOT FROZEN`. Confidence: **VERIFIED.**

**Finding 3 — the identity requirement changed the question.** PS-02 requires the model to
express an *Enterprise AI Operating System* accommodating ten AI runtimes, 450+ knowledge
packs, 6 assistants, 7 factories, and an integration hub. That is a far heavier load than
PS-02 v1 imposed, and it is decisive.

### Options evaluated

| Criterion | 9-Stage | 5-Tier Kernel | Layer 0–6 |
|---|---|---|---|
| AI Operating System identity? | ❌ AI is *one stage of nine* | ✅ kernel is central | ✅ **L4 is the kernel** |
| Transformer Runtime layer? | ❌ no position for it | ⚠️ inside an undifferentiated kernel | ✅ **L4, ten named runtimes** |
| Scales to 450+ categories? | ❌ stages are domain-named; implies per-domain stages | ⚠️ possible, unaddressed | ✅ **packs as L3 data (rule 6)** |
| Supports Knowledge Packs? | ❌ | ⚠️ | ✅ **L3 registry + L4 Knowledge Runtime** |
| Enterprise AI Support layer? | ❌ | ⚠️ "Modules" tier, undifferentiated | ✅ **L5 profiles over L4 Agent Runtime** |
| AI Factory Platform layer? | ⚠️ "Content and Creative Factories" is one stage | ⚠️ | ✅ **L5, one pipeline** |
| Integration Hub layer? | ❌ absent | ⚠️ "Adapters" tier, but AI-only in practice | ✅ **L2** |
| Clear ownership boundaries? | ⚠️ stated, but drawn in the wrong place | ❌ one kernel tier holds 10 runtimes | ✅ **one integer per module** |
| Predictable dependency flow? | ❌ a sequence, not a stack | ✅ | ✅ **mechanically checkable** |
| Evidence in repository | **Tracked, committed** | Untracked, NOT FROZEN | **None — authored here** |

**Option A — 9-Stage Pipeline.** Disqualified on two independent grounds.

*Platform/application inversion:* `ARCHITECTURE_DECISIONS.md:26` — *"Marketplace owns
buyers, suppliers, products, RFQs, matching, quotations, and orders."* PS-00 assigns
exactly those to **VyaparSethu, an application**. The model places an application's domain
inside the platform, the precise inversion the platform exists to prevent. Adopting it
would make "Bell24h-OS never consumes applications" false by construction.

*Cannot express an AI OS:* "Enterprise AI Router" is one stage among nine, positioned
*between* SEO and Content. In an AI operating system the AI runtime is the substrate every
capability sits on, not a station on a conveyor belt. There is no place to put ten runtimes.

**Option B — 5-Tier Kernel.** Structurally sound; its invariants are correct and are
inherited. But a single `KERNEL` tier holding ten runtimes cannot answer "which layer owns
the Prompt Platform?" — the answer is "the kernel," which does not discriminate. With ten
runtimes now formally required and modules needing unambiguous homes, that coarseness
becomes disqualifying rather than merely inconvenient.

**Option C — Layer 0–6.** Numbering delivers both properties simultaneously: unambiguous
per-module ownership, and a mechanically checkable rule
(`layer(importer) > layer(imported)`). Dedicating **L4** to the AI kernel is what makes the
model express an *AI operating system* rather than a web stack with AI attached.

**Option D — invent a new model.** Rejected: Layer 0–6 is already the named baseline in the
governing directive; inventing a fourth name would add confusion for no structural gain.

### Decision

**Adopt Layer 0–6** as authored in [`CANONICAL_ARCHITECTURE.md`](./CANONICAL_ARCHITECTURE.md),
with **L4 as the Enterprise AI Runtime kernel**.

**Nothing is discarded.** Option B's five invariants (fail-closed context, mandatory org
scope, no browser-reachable credentials, events as audit trail, single AI path) are carried
into the L1/L4 binding rules. Option A is **retained as VyaparSethu's L6 domain
value-chain** — an accurate description of that application's flow, re-homed rather than
deleted.

### Consequences

- `ARCHITECTURE_DECISIONS.md` and `ENGINEERING_GOVERNANCE.md:13` now describe a
  **superseded** platform model. Both are tracked; **neither was modified** (PS-02 forbids
  it). A documentation sprint must reconcile them or they will keep contradicting the freeze.
- Every module carries a layer number — see [`MASTER_MODULES.md`](./MASTER_MODULES.md).
- The dependency rule becomes lint-able. That is the durable win: violations caught
  mechanically rather than by review.
- Marketplace tables move conceptually to L6. No schema changed.
- **Risk accepted:** if the real `bell24h-platform-strategy-v2.md` surfaces later, this
  document must be reconciled against it, not assumed to agree.

**Related:** all subsequent ADRs.

---

<a name="adr-002"></a>
## ADR-002 — Transformer Runtime Positioning

**Status:** ACCEPTED (position reserved; deliberately unimplemented)

### Context

Bell24h-OS must consume external models now (Claude, GPT-4, Llama, Mistral, Groq) while
preserving a path to fine-tuned domain models later. Ten runtimes are named.

**Repository evidence: zero.** No hits for transformer, foundation model, reasoning, or
OmniRoute anywhere in `src/`, `server/`, or the schema (Confidence: **VERIFIED ABSENT**).
Only a Gemini-only, two-endpoint server router exists.

**Scope change recorded:** PS-01 explicitly excluded the Transformer Runtime and stated
that layer models introducing it were "not part of the current baseline." PS-02 reverses
this. That is legitimate — PS-01 deferred such decisions here — but it is a reversal, and
is recorded rather than applied silently.

### Options considered

1. **A dedicated layer for the Transformer Runtime.** Rejected — it would sit between L4 and
   L5 doing the same job as L4 (serving inference), splitting one concern across two layers
   and forcing consumers to know which to call.
2. **Inside L4 as one runtime among ten.** Chosen.
3. **Defer entirely; add later.** Rejected — retrofitting a fine-tuned model path into
   consumers that hardcode vendor calls is exactly the migration now required for the legacy
   browser path (ADR-012). Reserving costs nothing now; retrofitting is expensive.

### Decision

**The Transformer Runtime is one of ten runtimes inside L4**, reachable through the *same*
contract as foundation models:

```
generateText(ctx, { capability: "domain.steel.classification", ... })
```

**Callers specify a capability, not a vendor.** Model selection is L4's job (OmniRoute).
This is the entire reason for reserving the layer now: a fine-tuned model can replace an
external one later without touching a single L5 or L6 consumer.

**The L3/L4 split is also decided here.** The brief lists Memory and Knowledge Runtimes
among Transformer Runtime components. This architecture places **runtimes at L4** and their
**substrate at L3**: L3 stores embeddings and pack contents; L4 decides what to recall,
what to retrieve, and how to compress it. This keeps L4 swappable — changing reasoning
strategy must not require re-storing the corpus — and keeps L3 free of model concerns.

**Data ownership:** a model fine-tuned on tenant data **is tenant data**.
`fine_tuned_models.organization_id` is required, and such a model must never serve another
tenant. Stated now because getting it wrong later is a cross-tenant leak of the worst kind.

### Consequences

- L4 grows from 3 files to ten runtimes — the largest build in the platform.
- **Everything here is blocked on L3**, which does not exist (no pgvector). Memory,
  Knowledge, and Reasoning Runtimes cannot start before the substrate.
- Multi-provider support (Claude/GPT/Llama/Mistral/Groq) must precede OmniRoute — routing
  across one provider is meaningless.
- **Deliberately unimplemented.** Reserving space is free; building speculatively is not.
- No training infrastructure is specified. When fine-tuning becomes real it needs its own
  ADR covering data governance, consent, and per-tenant model isolation.

**Related:** ADR-001, ADR-003, ADR-012.

---

<a name="adr-003"></a>
## ADR-003 — Category Architecture: Configuration vs Implementation

**Status:** ACCEPTED

### Context

450+ industrial categories (Steel, Textile, Chemicals, Packaging, Machinery, Agriculture,
Logistics, …), each with its own taxonomy, rules, compliance requirements, knowledge base,
prompts, and integrations.

**Repository evidence: zero.** No knowledge-pack concept, and **zero category seed rows**
(Confidence: **VERIFIED ABSENT**). The naive reading — 450 subsystems — would be roughly
450× the current codebase and is obviously untenable; the question is what replaces it.

### Options considered

1. **A module per category.** Rejected — 450 modules, 450 deployments, unbounded drift.
2. **A `switch (category)` in shared code.** Rejected — violates dependency rule 3 (a lower
   layer branching on higher-layer concepts) and turns every new category into a code change
   in the platform kernel. This is the failure mode the rule exists to prevent.
3. **Categories as versioned data + configuration — Knowledge Packs.** Chosen.

### Decision

**A category is a Knowledge Pack: a versioned, org-scopable bundle of data and
configuration, registered in L3 and resolved at runtime by L4. It is never code.**

A pack contains:

| Component | Nature |
|---|---|
| Domain taxonomy (entities, relations, attributes) | data |
| Business rules & workflows | declarative configuration |
| Compliance requirements | data + validation rules |
| Knowledge base (FAQs, best practice, documents) | data + embeddings |
| AI prompts tuned to the category | versioned prompt templates |
| Integration bindings | references to L2 connectors |

**Ownership and precedence.** Packs use nullable `organization_id`, following the precedent
already in the schema (`prompt_categories` uses
`USING (organization_id = current OR organization_id IS NULL)`):

- `organization_id IS NULL` → **platform-published** pack, readable by all tenants
- non-null → the org's **private pack or override**

**Resolution order: org override → org private → platform published.** The resolved version
is **pinned for the life of a request**, so publishing a pack mid-request cannot change
behaviour halfway through.

**Packs are immutable once published; changes create a new version.** Every AI call records
the resolved pack versions in its telemetry, so any output can be traced to the exact
knowledge that produced it.

### Consequences

- **Adding category #451 is a data operation** — no code, no deployment, no layer change
  (ADR-009).
- Requires L3 registry + L4 Knowledge Runtime, neither of which exists. This is a
  prerequisite for the assistants (ADR-004), which are useless without domain grounding.
- Pack authoring becomes an operational discipline needing its own tooling, review, and
  publishing workflow — a real cost, and it is a content cost rather than an engineering
  one, which is the point.
- **`industries`/`industry_categories`/`industry_subcategories`/`industry_products` are
  currently org-scoped but are reference data.** They should become platform-published packs
  (`organization_id IS NULL`); `buyer_personas`/`supplier_personas` are correctly
  tenant-specific and stay org-scoped. Migrating populated taxonomy later is materially
  harder than choosing correctly now — but the sole consumer is orphaned today, so nothing
  is blocked. **Left as a flagged migration, not executed.**

**Related:** ADR-002, ADR-004, ADR-009.

---

<a name="adr-004"></a>
## ADR-004 — Enterprise AI Support Architecture

**Status:** ACCEPTED

### Context

Six assistants required: Public, Buyer, Supplier, Admin, Developer, Trade.

**Repository evidence: zero occurrences of "assistant"** in `src/`, `server/`, or the schema
(Confidence: **VERIFIED ABSENT**). The closest artifact is the "AI Founder Mentor" in
`KnowledgeVaultPage.tsx` — one hardcoded prompt against one endpoint, not a framework.

### Options considered

1. **Six separate modules/services.** Rejected — six copies of the same loop (context
   assembly, tool dispatch, memory, citation, safety), guaranteed to drift. A safety fix
   would need six applications and would reach five of them.
2. **One Agent Runtime; assistants as configuration profiles.** Chosen.
3. **Hybrid — shared core, per-assistant subclasses.** Rejected — subclassing invites
   per-assistant logic, which reintroduces drift through the back door.

### Decision

**One L4 Agent Runtime. Six L5 profiles. An assistant is a row, not a module.**

A profile declares:

| Field | Purpose |
|---|---|
| System prompt / persona | behaviour |
| Tool grants | which tools it may invoke |
| Knowledge pack scope | which packs it may ground against |
| Memory scope | what it may remember and recall |
| Authorization context | which actions it may take **on behalf of the caller** |
| Rate/budget limits | cost control |

**Shared reasoning, org-scoped context.** The reasoning logic is platform-owned; everything
it reasons *over* is tenant data bound to the caller's `SecurityContext`. **Adding a seventh
assistant is a row, not a module.**

**The Public Assistant is the one genuine exception** and gets hard constraints: anonymous
sessions, **no tenant data access**, no side-effecting tools, platform-published packs only,
and its own rate limit. Called out explicitly because it is the easiest place in the entire
design to accidentally leak tenant data — an assistant that is helpful to anonymous users
and has database access is a breach waiting to happen.

**An assistant may never exceed its caller's authority.** The Admin Assistant is not
privileged; it is an assistant *used by* privileged callers. Authorization is evaluated on
the caller's context at tool-invocation time, never on the profile.

### Consequences

- Blocked on three absent pieces: L4 Agent Runtime (stub), L3 knowledge packs, and **the L1
  authorization primitive** — without which "tool grants" cannot be enforced and every
  assistant would run with whatever access the process has.
- One safety improvement benefits all six immediately.
- Profiles need versioning and review like packs — a persona change is a behaviour change.

**Related:** ADR-002, ADR-003, ADR-011.

---

<a name="adr-005"></a>
## ADR-005 — AI Factory Platform Architecture

**Status:** ACCEPTED

### Context

Seven factories required: Content, Image, Video, Voice, Document, CAD, Digital Asset.

**Repository evidence:** Content, Image, and Video exist as **three separate studios**, each
with its own table family and each calling the legacy browser AI path. Voice is a stub;
Document, CAD, and Digital Asset are absent (Confidence: **VERIFIED**).

**The evidence argues for itself:** `image_projects/templates/styles/jobs/assets` and
`video_projects/templates/styles/jobs/assets` are near-identical shapes duplicated per
modality. The current design has already paid the duplication cost twice; a seven-modality
version of the same pattern would pay it seven times.

### Options considered

1. **A dedicated layer for factories.** Rejected — factories are applied capabilities built
   *from* L4; they are not a substrate anything else builds on.
2. **Seven independent modules** (extending today's pattern). Rejected — the observed
   duplication is the argument against it.
3. **One L5 Factory Platform with seven modality adapters.** Chosen.

### Decision

**One pipeline at L5, seven modality adapters.**

```
request → authorize (L1) → resolve packs (L3) → build context (L4) →
  enqueue job (L2) → model call (L4) → persist asset + provenance → emit event (L2)
```

**Only the adapter differs per modality.** Authorization, pack resolution, job handling,
asset persistence, provenance, and events are shared. Adding an eighth modality is an
adapter plus a row in a modality registry — not a new stack.

**Asset ownership:** generated assets belong to the **requesting organization**, always.
`factory_assets.organization_id` is non-null, set from the `SecurityContext` at creation.
Provenance — model, prompt version, resolved pack versions, cost, latency — is recorded on
the asset, so any output is traceable to what produced it. **The platform never claims
ownership of tenant-generated output.**

### Consequences

- Existing `content_*`/`image_*`/`video_*` families should converge on
  `factory_jobs`/`factory_assets`. **A migration, flagged not executed** — and it is a real
  cost, paid once, versus paying the duplication cost five more times.
- Blocked on L2 job durability: today `JobWorker.start()` is commented out, so **the queue
  never drains**. Long-running modalities (video, CAD) are impossible until that is fixed.
- CAD and Digital Asset factories are prerequisites for 3DFabrica (ADR-007).
- Voice/Document/CAD each need provider support that does not exist — only Gemini is wired.

**Related:** ADR-002, ADR-007, ADR-012.

---

<a name="adr-006"></a>
## ADR-006 — Enterprise Integration Hub Architecture

**Status:** ACCEPTED

### Context

Required integrations: ERP (SAP, Oracle, NetSuite), CRM (Salesforce, HubSpot), messaging
(WhatsApp, email, SMS), payments (Razorpay, Stripe), government APIs (GST, Udyam),
logistics, AI providers, webhooks, MCP tools.

**Repository evidence: zero real integrations.** No ERP, CRM, MCP, Razorpay, or Salesforce
code. The only hits are UI placeholder copy in `SettingsPage.tsx` ("Third-Party
Integrations", "Stripe integration placeholder") and a "Webhook" dropdown option
(Confidence: **VERIFIED ABSENT**).

### Options considered

1. **Each application builds its own integrations.** Rejected — violates the stated
   principle, and guarantees N applications × M integrations of duplicated, separately-broken
   connector code.
2. **A dedicated integration layer.** Rejected — integrations are a core service consumed by
   every layer above; a separate layer would sit awkwardly beside L2 doing L2's job.
3. **Integration Hub as an L2 core service.** Chosen.

### Decision

**The Integration Hub is an L2 core service. Applications consume integrations; they never
build them.** An L6 app must not hold a Salesforce SDK, exactly as it must not hold a
provider SDK.

Three-part separation:

| Concept | Scope | Owner |
|---|---|---|
| **Connector** — how to talk to SAP | **Platform** asset, versioned | Platform team |
| **Binding** — this org uses SAP | **Org-scoped** configuration | Org admin |
| **Credential** — this org's SAP secret | **Org-scoped, server-only, envelope-encrypted** | Never client-readable |

**Credentials follow exactly the rule `ai_providers.api_key` currently violates:**
envelope-encrypted with a KMS-wrapped DEK, never selectable by the `anon` or `authenticated`
role, never returned to a browser. Stated pointedly because the platform has already made
this mistake once and the Integration Hub would multiply it across every enterprise system
a customer connects.

**Inbound is as important as outbound.** Webhooks are signature-verified at the edge and
converted into domain events; they never invoke business logic directly.

**AI providers are NOT Integration Hub connectors.** They belong to L4's Provider Manager,
because AI routing carries budget, model-policy, and telemetry concerns the generic hub does
not model. Stated explicitly because the brief lists AI providers under the Hub — treating
them as generic connectors would fragment the "single AI path" rule.

**MCP tools are connectors** whose invocation surface is exposed to the L4 Agent Runtime as
grantable tools (ADR-004), never as an ambient capability.

### Consequences

- Blocked on the **L1 authorization primitive** — binding management is an admin action and
  there is no way to check that today.
- Blocked on the **L2 event bus** for inbound webhooks.
- Requires secret infrastructure (envelope encryption, KMS) that does not exist at L0.
- Government/compliance connectors (GST, Udyam) carry regulatory obligations — audit
  retention, data residency — needing their own ADR before implementation.

**Related:** ADR-004, ADR-008, ADR-011.

---

<a name="adr-007"></a>
## ADR-007 — 3DFabrica Product Scope Clarification

**Status:** ACCEPTED (decided by the Council in the PS-02 brief)
**Supersedes:** PS-02 v1 ADR-007, which recorded this as an unresolved contradiction

### Context

Two incompatible definitions existed: **A** digital manufacturing (CAD processing,
manufacturing quotes, machine scheduling, job routing) and **B** textile/interior
visualisation. PS-00 instructed that neither be assumed. **The PS-02 brief now decides it.**

**Repository evidence: none.** No 3DFabrica code exists here (Confidence: **VERIFIED
ABSENT**). The decision rests on Council authority, not repository evidence — recorded as
such.

### Decision

**3DFabrica is the digital fabric intelligence platform:** AI Fabric Digitization, AI PBR
Generation, Material Library, Interior Rendering, Digital Fabric Twins, Visualization
Platform.

**It is NOT additive manufacturing, CNC job routing, or industrial manufacturing.**
Definition A is **archived**.

### Architectural placement

3DFabrica is an **L6 application** consuming platform capabilities:

| Capability | Consumes |
|---|---|
| AI Fabric Digitization | L5 Image Factory + L4 vision models |
| AI PBR Generation | L5 Image Factory (material map generation) |
| Material Library | L3 substrate + L5 Digital Asset Factory |
| Interior Rendering | L5 CAD Factory + Image Factory |
| Digital Fabric Twins | L3 knowledge/graph + L5 Digital Asset Factory |
| Visualization Platform | own L6 UI |

### Consequences

- **Every one of these depends on an L5 factory that does not exist.** 3DFabrica cannot
  begin before the Factory Platform (ADR-005) — in particular CAD and Digital Asset, the two
  least-developed modalities.
- It is **asset-heavy, not transaction-heavy**: high-resolution textures, PBR maps, 3D
  models. This shapes L0 (object storage, CDN) and L5 (Digital Asset Factory with
  versioning) more than it shapes commerce primitives. Had Definition A won, the investment
  would have been scheduling and quoting instead — the decision materially redirects L5
  planning, which is why it mattered.
- A fabric/material taxonomy is a natural **Knowledge Pack** (ADR-003) rather than bespoke
  schema.
- Definition A's concepts (machine capacity, job routing) are archived. If industrial
  manufacturing returns later it is a **different product**, not a redefinition of this one.

**Related:** ADR-003, ADR-005.

---

<a name="adr-008"></a>
## ADR-008 — Multi-Tenant Data Ownership Model

**Status:** ACCEPTED — with one premise explicitly unverified

### Context

`organization_id` is the shard key of the platform. The brief states "✅ RLS enforced." That
claim splits into two halves with very different evidence:

- **"RLS permits the owning org to read its own rows"** — supported. The owner-reported
  `V1.0 STABLE` requires the `org` check to pass (`SystemDiagnosticsPage.tsx:212-218`).
  Confidence: **VERIFIED-BY-OWNER**.
- **"RLS denies a different tenant"** — **not supported by anything.** No test has ever
  authenticated as a second organization and observed zero rows. Confidence: **UNVERIFIED**.

**Only the second is tenant isolation.** The first is "the query worked."

This matters more under PS-02 than before: 450 knowledge packs, 6 assistants, 7 factories,
and 10+ integrations all multiply the number of paths along which a tenant boundary can leak.

### Options considered

1. **Application scope only** — defeated by one raw connection, and 9 handlers already use
   raw connections.
2. **RLS only** — defeated by pooled `DATABASE_URL` access, which is exactly what those 9
   handlers do.
3. **Defence in depth — both.** Chosen.

### Decision

**Both layers, independently.** (a) L1's `SecurityContext` injects `organization_id` via a
scoped repository — a module must not be able to *express* an unscoped query. (b) Postgres
RLS independently rejects cross-tenant rows. (c) Direct pooled access is **forbidden in
request handlers**.

Extended for the new elements:

- **Knowledge packs** use nullable `organization_id`: `NULL` = platform-shared,
  non-null = org private/override (ADR-003).
- **Generated assets** belong to the requesting organization, with provenance (ADR-005).
- **Integration credentials** are org-scoped, server-only, envelope-encrypted (ADR-006).
- **Fine-tuned models** trained on tenant data are tenant data and must never serve another
  tenant (ADR-002).
- **Assistants** carry the caller's context; an assistant never exceeds its caller's
  authority (ADR-004).

Full per-entity mapping: [`MASTER_DATA_OWNERSHIP.md`](./MASTER_DATA_OWNERSHIP.md).

### Consequences

- The 9 pooled handlers are violations requiring migration (ADR-013).
- **Isolation must be demonstrated before any tenant-facing launch.** Required artifact:
  authenticate as org B, query a table containing org A rows, observe zero rows. **This is
  the single highest-value test the project can run** and it has never been run.
- Known schema gaps undercutting the model, all recorded and none fixed: `permissions` (no
  RLS/policy), `job_priorities` (RLS on, no policy), `workflow_templates` (RLS never
  enabled), the five vault tables (no `organization_id`).
- Retrieval must filter by tenant **before** ranking — filtering after leaks cross-tenant
  result counts even when rows are hidden. This becomes critical once vector search exists.

**Related:** ADR-002, ADR-003, ADR-006, ADR-010, ADR-011.

---

<a name="adr-009"></a>
## ADR-009 — Category Extensibility Model

**Status:** ACCEPTED

### Context

The test: **does adding category #451 require an architecture change?** It must not.

### Decision

**Adding a category is a data operation.** Registering a Knowledge Pack version requires:
no layer change, no module change, no code change, no deployment.

This is guaranteed structurally by **dependency rule 6** (*no category, assistant, factory
modality, or integration may be added by changing a layer*) and **rule 3** (*no lower layer
may name or branch on a higher-layer concept*). Together these make `switch (category)` in
platform code a rule violation, not a style preference.

**Verification test for any future change** — if adding a category would require any of the
following, the architecture has been violated and the change must be rejected:

- [ ] modifying any file in L0–L4
- [ ] adding a table
- [ ] adding a route
- [ ] a deployment
- [ ] a `switch`/`if` on category identity in platform code

Adding a category should touch **only** pack registry rows and pack assets.

### Consequences

- Pack schema must be genuinely general across Steel, Textile, Chemicals, Agriculture,
  Logistics, and 445 more. **This is the hard part**, and getting it wrong shows up as
  category-specific escape hatches creeping into platform code — the exact failure this ADR
  exists to prevent. The first ten packs should be drawn from deliberately dissimilar
  industries to stress the schema before it ossifies.
- The same extensibility rule applies to assistants (ADR-004), factory modalities (ADR-005),
  and connectors (ADR-006): each is registered configuration.
- Pack authoring needs tooling, review, and a publishing workflow — an operational cost
  traded for an engineering one. That trade is the decision.

**Related:** ADR-003, ADR-004, ADR-005, ADR-006.

---

<a name="adr-010"></a>
## ADR-010 — Knowledge Vault Architectural Role

**Status:** **OPEN — Council decision required. Options only; no fix implemented.**

### Context

Five tables (`supabase_schema.sql:1892-1970`). Verified facts:

- **No `organization_id` on any of them** — no tenant boundary to enforce.
- RLS enabled, policy is `USING (true)` — read granted to everyone. No write policy at all.
- All 7 handlers use the **pooled connection**, bypassing RLS regardless.
- RG-C added `requireAuth`, closing anonymous access. **Authenticated cross-tenant access
  remains open.**
- The client attaches no `Authorization` header, so the Vault UI now 401s.
- **Provenance:** prompts and seed data reference **"ICECRAFT"** — `server.ts:302`
  (*"You are the AI Founder Mentor for ICECRAFT"*), timeline rows describing wine-shop
  surveys and physical prototypes (`:1974-1979`). Schema comments say *"even though user
  said No Auth"* and *"Single Founder Mode."*

This does not look like a Bell24h-OS platform module. It looks like single-tenant founder
tooling that arrived via the `a0b000a` consolidation.

### Options

**A — Retrofit for multi-tenancy (promote to a real L3 module).**
*Migration:* five `ALTER TABLE ADD COLUMN` + FKs; replace five `USING (true)` policies;
add missing write policies; rewrite 8 SQL statements to scope by `ctx.organizationId`;
migrate handlers off the pooled connection.
*RLS:* meaningful **only if** the pooled-connection migration happens too. **Adding the
column alone produces *false* isolation — arguably worse than today's honest gap.**
*Backfill risk:* **high** — existing rows have no owner and hold ICECRAFT content.
*Cost:* Medium–High. Justified only if the Vault is genuinely a platform capability.

**B — Keep single-tenant; restrict to platform admins.**
*Migration:* no schema change; gate behind an admin-role check.
*RLS:* unchanged — but **requires the authorization primitive that does not exist**. True
cost is "build ADR-011's primitive first."
*Backfill risk:* none. *Cost:* Low once authorization exists. Honest about what it is.

**C — Remove or quarantine from the core platform.**
*Migration:* remove routes + UI, or relocate to a separate single-tenant deployment. Export
first. *RLS:* deletes the bypass surface rather than managing it. *Backfill risk:* none.
*Cost:* lowest for the platform, highest in lost functionality.
**Deserves serious consideration** — a feature built for a single founder's wine-cooler
venture may simply not belong in a reusable enterprise AI operating system.

**Note under the new architecture:** if the Vault's real purpose is organizational knowledge
capture, **that job now belongs to L3 + Knowledge Packs** (ADR-003), which are designed
multi-tenant from the start. That materially strengthens Option C — the Vault may be a
worse version of something the architecture now provides properly.

### Decision

**Deferred to the Architecture Council.** A data-model and product-scope decision, outside
PS-02's authority.

**What the Council must supply:**
1. **Is the Vault in scope for Bell24h-OS at all?** A/B assume yes; C assumes no.
2. If in scope — multi-tenant (A) or single-tenant admin tool (B)?
3. If A — **who owns the existing rows?** A backfill target must be named explicitly, or the
   data declared disposable. This will not be guessed.
4. Authorization to migrate handlers off the pooled connection (its own sprint).

### Consequences

- Until decided, the Vault stays **authenticated but not tenant-isolated** — documented, not
  hidden.
- The Vault UI stays broken (401) until the client attaches tokens or the feature is removed.
  Mitigating: **zero deployments**, so no live user is affected.
- Gate C cannot fully close while this is open.

**Related:** ADR-003, ADR-008, ADR-011.

---

<a name="adr-011"></a>
## ADR-011 — C.2C Formal Definition for Gate C Closure

**Status:** **OPEN — definition proposed here; requires explicit ratification**

### Context

RG-C reported C.2C **BLOCKED**: the only defining text is `KERNEL_ARCHITECTURE.md §20`,
which is untracked, self-labelled `DESIGN — NOT FROZEN`, and Source B. An unratified
document has no authority to define a gate item, so RG-C correctly stopped rather than
inventing scope.

PS-02 is the right place to *propose* one, because defining "architecturally secure enough
to proceed" is an architecture decision. **Proposing is not ratifying.**

### Options considered

1. **Adopt §20 as-is** — rejected: it bundles "apply `requireAuth` to 8 routes" (already
   done by RG-C) with "migrate 9 pool handlers off RLS bypass" (a large migration) into one
   unclosable item.
2. **Define C.2C narrowly as tenant-isolation enforcement** — chosen basis.
3. **Abandon C.2C** — rejected: the underlying RLS-bypass risk is real and Critical.

### Proposed definition

> **C.2C — Tenant isolation is enforced on every request path.**
>
> Closed when **all** hold, each with a runtime artifact:
>
> 1. **No request handler uses a pooled `DATABASE_URL` connection.** Every handler obtains a
>    `SecurityContext`-scoped repository. *Artifact:* `getPool()` has zero call-sites inside
>    request handlers.
> 2. **Cross-tenant isolation is demonstrated.** Authenticated as org B, a query against a
>    table containing org A rows returns **zero rows**. *Artifact:* the captured
>    request/response pair. (Shared with ADR-008.)
> 3. **Every tenant table carries `organization_id` with a matching RLS policy** — or is
>    explicitly exempted by a committed ADR. *Artifact:* a policy-coverage query against the
>    **live database**, not the schema file.
> 4. **A server-side authorization primitive exists and is applied** to every route
>    performing a privileged action. *Artifact:* a request with a valid token but
>    insufficient role returns 403.
>
> **Explicitly NOT part of C.2C** (tracked separately): the `ai_providers.api_key` `REVOKE`
> and key rotation (C.2B), the Vault tenancy decision (ADR-010), and the Schema Sync error
> (DevOps).

### Decision

**Proposed, not ratified.** To adopt: commit this text to the repository as an authoritative
Gate C record and re-authorize the work explicitly. Until then C.2C stays **BLOCKED** and no
`IS-xx` sprint may begin.

### Consequences

- Criterion 4 is a prerequisite for **ADR-004 (assistant tool grants), ADR-006 (integration
  binding management), and ADR-010 Option B**. It is the most widely-blocking single missing
  piece in the architecture.
- Criterion 2 is shared with ADR-008 — one test satisfies both.
- Criterion 1 is the largest piece and likely its own sprint.

**Related:** ADR-004, ADR-006, ADR-008, ADR-010.

---

<a name="adr-012"></a>
## ADR-012 — AI Runtime Consolidation & Extraction Sequence

**Status:** ACCEPTED (sequence; execution belongs to IS-xx)

### Context

Two parallel AI paths exist:

1. **Server-side (correct):** `server/ai/ProviderRouter` → `ProviderManager` (credentials
   from `process.env`) → `GeminiProvider`. Used by 2 routes. Verified fail-closed.
2. **Browser-side (legacy):** `src/modules/ai-providers/AiProviderService.ts` — own provider
   adapters, own failover, consumed by 5 pages + the job orchestrator. Marked legacy by its
   own header.

Two paths mean the L4 credential rule cannot hold, and `ai_providers.api_key` cannot be
dropped while the browser path expects it. **Under PS-02 this is worse than it was:** every
new runtime, factory, and assistant must target L4, and a second path guarantees some target
the wrong one.

### Options considered

1. **Adapt the browser service in place** — rejected: it is browser-resident by
   construction; "adapting" cannot make credentials server-only.
2. **Big-bang replacement** — rejected: five consumers with different risk profiles, no test
   suite to catch regressions.
3. **Incremental migration, lowest-risk first** — chosen.

### Decision

| # | Consumer | Why this position |
|---|---|---|
| 1 | Prompt Studio | Plain text; smallest surface; proves the pattern |
| 2 | Content Planner | Text, higher volume |
| 3 | Image Factory | Introduces binary payloads + storage upload |
| 4 | Video Factory | Long-running; needs job durability first |
| 5 | JobOrchestrator worker path | Depends on the L2 worker being enabled at all |

**Only after all five:** drop `ai_providers.api_key` and **rotate every key it has ever
held**.

### Consequences

- Steps 4–5 are blocked on L2: `JobWorker.start()` is commented out, so the queue never
  drains. Enabling it is a prerequisite, not a side-effect.
- **C.2B cannot fully close until this completes** — the column cannot be dropped while a
  consumer expects it. This is why C.2B's database layer is OPEN, not merely pending.
- Assume every key the column has held is compromised; rotation is not optional.
- This migration is a **prerequisite for the Factory Platform** (ADR-005) — building seven
  modalities on a legacy browser path would multiply the problem.
- **No code was written.** Sequence only.

**Related:** ADR-002, ADR-005, ADR-013.

---

<a name="adr-013"></a>
## ADR-013 — Treatment of Existing Layer-Boundary Violations

**Status:** ACCEPTED

### Context

| Violation | Count | Rule |
|---|---|---|
| L6 pages calling L0 Supabase directly, bypassing their own service | 7+ | Rule 3 |
| Request handlers opening a pooled RLS-bypassing connection | 9 | Rule 5 |
| L4 provider logic resident in the browser | 1 module, 5 consumers | L4 credential rule |
| `ContextProfileManagerPage` bypassing `ContextEngineService` | 1 | Rule 3 |

`CODE_STANDARDS.md` already calls the first pattern "legacy behavior [that] must not be
copied into new modules" — it predates this freeze.

### Options considered

1. **Fix now** — forbidden by PS-02, and unwise regardless: broad refactoring with no tests
   and no CI.
2. **Grandfather permanently** — rejected: makes the freeze decorative.
3. **Record as debt with a migration path; forbid new instances** — chosen.

### Decision

Existing violations are **recorded, not fixed**. New instances are **forbidden** from the
freeze date. All are enumerated in [`MASTER_MODULES.md`](./MASTER_MODULES.md).

### Consequences

- The dependency rule is mechanically checkable (`layer(importer) > layer(imported)`). **A
  lint rule enforcing it is the highest-leverage follow-up available** — recommended, not
  built (PS-02 writes no code).
- Migration is sequenced by ADR-012 (AI path) and ADR-011 criterion 1 (pool handlers).
- **Accepted risk:** with no tests and no CI, "forbid new instances" is enforced only by
  review. That is weak. It becomes real when the lint rule lands.

---

## Decisions deliberately NOT made here

| Not decided | Why | Owner |
|---|---|---|
| Fixing the 9 pooled handlers | Implementation | IS-xx (ADR-011 criterion 1) |
| Enabling `JobWorker` | Implementation | IS-xx |
| Adding tests/CI | Implementation; top structural gap | IS-xx |
| Schema Sync (JSON parse) error | DevOps, not architecture. **Reported, not reproduced** | IS-xx |
| Vault client `Authorization` headers | Implementation | IS-xx, after ADR-010 |
| Migrating `industries*` to platform-published packs | Flagged in ADR-003; nothing blocked today | IS-xx |
| Fine-tuning data governance & consent | Needs its own ADR when training becomes real | Council |
| Government/compliance connector obligations (GST, Udyam) | Regulatory scope beyond architecture | Council |
| Pushing the 7 unpushed commits | Process decision | Project owner |
| Reconciling `ARCHITECTURE_DECISIONS.md` / `ENGINEERING_GOVERNANCE.md` with ADR-001 | PS-02 may not modify existing files | Documentation sprint |
