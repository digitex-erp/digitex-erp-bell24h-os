# Bell24h-OS — Canonical Architecture

**Bell24h-OS is an Enterprise AI Operating System.** Not a backend framework. Not a
marketplace platform. An operating system for enterprise AI.

**Status:** FROZEN as of 2026-08-04 (PS-02)
**Supersedes:** all competing layer models in this repository, and the PS-02 v1 freeze
**Authority:** binding on every subsequent IS-xx implementation sprint
**Nothing in this sprint modified source code, schema, Supabase config, or git state.**

---

## READ THIS FIRST — inherited premises, verified

Three premises in the brief did not survive repository inspection. Freezing on an
unverified premise ratifies the wrong thing, so they are stated up front.

**1. `bell24h-platform-strategy-v2.md` does not exist; "Layer 0–6" has no definition here.**
```
$ find . -iname "*platform-strategy*" -not -path "./node_modules/*"   → (no results)
$ grep -rniE "layer\s*0|layer\s*6" --include="*.md" .                 → (none outside ./docs/)
```
The brief's "THREE COMPETING MODELS" section is also empty in the text supplied. There are
**two** documented models in the repository, not three. Choosing Layer 0–6 therefore
**authors** it here (Confidence: **UNKNOWN → decided by ADR-001**), it does not adopt a
recovered artifact.

**2. The 9-stage pipeline lives in `ARCHITECTURE_DECISIONS.md`, not `KERNEL_ARCHITECTURE.md`** —
and it is **tracked and committed** (`5c24483`), making it the only committed architecture
model in the repository. The "kernel" model is untracked and self-labelled `DESIGN — NOT
FROZEN`. (Confidence: **VERIFIED**.)

**3. C.2B is not fully closed.** Code/bundle layer: CLOSED (verified). **Database layer:
OPEN** — `ai_providers.api_key` still exists, still tenant-readable, no `REVOKE`, no key
rotation. Recording it as closed would let a future sprint stop treating exposed keys as
compromised. They should still be treated as compromised.

**Also labelled, not dismissed:**

| Claim | Position |
|---|---|
| "Authentication working" / "V1.0 STABLE" | **VERIFIED-BY-OWNER.** Credible and significant — the dashboard requires `auth`+`db`+`session`+`jwt`+`org` all passing (`SystemDiagnosticsPage.tsx:212-218`). Not observed by me; I cannot log in. |
| "RLS enforced" | **Split.** "RLS permits the owning org to read its own rows" — supported. "RLS denies a different tenant" — **UNVERIFIED**, never tested. Only the second is isolation. |
| "~95% of artifacts recovered / historical repositories audited" | **UNKNOWN.** PS-01 audited *this repository only*. |
| "Schema Sync error" | **REPORTED, not reproduced.** DevOps concern, not architecture. |

### Scope change recorded

PS-01 explicitly excluded the Transformer Runtime, foundation models, and knowledge packs,
and stated that any layer model introducing a Transformer Runtime was "not part of the
current baseline." **PS-02 reverses that**, and is the correct place to do so — PS-01
itself deferred such changes here. Recorded in ADR-002 rather than applied silently.

### Evidence baseline for the eight new elements

Verified by direct search across `src/`, `server/`, `server.ts`, `supabase_schema.sql`:

| Element | Occurrences | Status |
|---|---|---|
| Transformer Runtime / Foundation Models / Reasoning | 0 | **FUTURE** |
| Industry Knowledge Packs | 0 | **FUTURE** |
| Enterprise AI Support (assistants) | 0 | **FUTURE** |
| AI Factory Platform (CAD, Document, Digital Asset) | 0 real | **FUTURE** (Content/Image/Video exist separately) |
| Enterprise Integration Hub (ERP, CRM, MCP, Razorpay, Salesforce) | 0 real | **FUTURE** |
| OmniRoute | 0 | **FUTURE** |
| 3DFabrica (fabric, PBR, material library, digital twin) | 0 real | **FUTURE** |
| Category seed data (450+) | 0 rows | **FUTURE** |

The few textual hits are noise: UI placeholder copy in `SettingsPage.tsx`, a "Webhook"
dropdown option, a code comment containing the word *fabricate*, and an ICECRAFT seed row
tagged `CAD`. **All eight elements are architectural reservations, not implementations.**
This document says where they *will* go, not that they exist.

---

## The canonical model: Layer 0–6

**Bell24h-OS is Layers 0–5. Applications are Layer 6.** Applications consume the platform;
the platform never consumes an application.

The AI-OS identity lives at **L4**, which is the kernel of the operating system: every
model call, every agent, every reasoning step passes through it. Layers below exist to
make L4 safe and durable; layers above exist to make it useful.

```
┌────────────────────────────────────────────────────────────────────────┐
│ L6  APPLICATIONS                                                        │
│     VyaparSethu · 3DFabrica · Knowledge Book · future Bell* products    │
├────────────────────────────────────────────────────────────────────────┤
│ L5  APPLIED AI CAPABILITIES                                             │
│     AI Factory Platform (Content·Image·Video·Voice·Document·CAD·Asset)  │
│     Enterprise AI Support (Public·Buyer·Supplier·Admin·Developer·Trade) │
│     SEO · GEO · Analytics · Publishing · Commerce primitives            │
├────────────────────────────────────────────────────────────────────────┤
│ L4  ENTERPRISE AI RUNTIME          ◀── the AI-OS kernel                 │
│     Provider Manager · OmniRoute · Prompt · Context · Memory ·          │
│     Knowledge · Reasoning · Agent · Transformer · Foundation Models     │
├────────────────────────────────────────────────────────────────────────┤
│ L3  KNOWLEDGE & MEMORY SUBSTRATE                                        │
│     Vector store · Knowledge Graph · Search index ·                     │
│     Industry Knowledge Pack registry · Context/profile store            │
├────────────────────────────────────────────────────────────────────────┤
│ L2  PLATFORM CORE SERVICES                                              │
│     Event Bus/Outbox · Workflow · Jobs · Notification ·                 │
│     Enterprise Integration Hub · API Gateway · Observability            │
├────────────────────────────────────────────────────────────────────────┤
│ L1  IDENTITY, TENANCY & SECURITY                                        │
│     Authentication · Organizations · Permissions/RBAC · Audit ·         │
│     Secret access policy                                                │
├────────────────────────────────────────────────────────────────────────┤
│ L0  INFRASTRUCTURE SUBSTRATE                                            │
│     Postgres/pgvector · object store · cache/queue · hosting · secrets  │
└────────────────────────────────────────────────────────────────────────┘
                        dependencies point DOWN only
```

### Layer definitions

**L0 — Infrastructure Substrate.** Managed resources and connection/config management.
**No business logic, no tenant awareness.** Postgres + pgvector, object storage,
cache/queue, hosting, secret storage.

**L1 — Identity, Tenancy & Security.** Establishes *who is calling* and *which tenant they
act for*, and fails closed when it cannot. Owns Authentication, Organizations,
Permissions/RBAC, Audit, secret-access policy.
*Binding rule:* nothing above executes business logic without a resolved `SecurityContext`
carrying `{ userId, organizationId, roles }`.

**L2 — Platform Core Services.** Cross-cutting mechanics every capability needs and none
should reimplement: Event Bus/outbox, Workflow Engine, Job Orchestration, Notification,
**Enterprise Integration Hub**, API Gateway, Observability, rate limiting.

**L3 — Knowledge & Memory Substrate.** The *storage and retrieval mechanics* for knowledge:
vector store, knowledge graph, search index, context/profile store, and the **Industry
Knowledge Pack registry** that holds 450+ category packs as versioned data.
*This layer stores and retrieves. It does not reason.*

**L4 — Enterprise AI Runtime — the AI-OS kernel.** Every model call goes through here. One
path, no exceptions. Owns ten runtimes:

| Runtime | Responsibility |
|---|---|
| Provider Manager | Sole holder of provider credentials; resolves from server secret storage |
| OmniRoute | Cost/latency-optimised model routing across providers |
| Prompt Runtime | Templates, versioning, testing, rendering |
| Context Runtime | Token budgeting, semantic compression, context assembly |
| Memory Runtime | Working / episodic / semantic memory *over* the L3 substrate |
| Knowledge Runtime | Knowledge pack resolution and retrieval *over* the L3 substrate |
| Reasoning Runtime | Multi-step reasoning, planning, verification |
| Agent Runtime | Autonomous loops, tool invocation, MCP dispatch |
| Transformer Runtime | Future fine-tuned domain models (reserved — see ADR-002) |
| Foundation Models | External model access (Claude, GPT, Llama, Mistral, Groq) |

*Binding rule:* no module in any other layer holds a provider SDK or credential.

**L5 — Applied AI Capabilities.** Reusable capabilities composed from L0–L4, usable by more
than one application: the **AI Factory Platform** (7 modalities on one pipeline), the
**Enterprise AI Support** assistants (6 profiles on one Agent Runtime), SEO, GEO, Analytics,
Publishing, and commerce primitives.
*Admission test:* a capability belongs at L5 only if a **second** application could
plausibly consume it unchanged. If it encodes one application's domain rules, it is L6.

**L6 — Applications.** VyaparSethu (marketplace, RFQs, quotes, deals, trade workflows),
3DFabrica (digital fabric intelligence), Knowledge Book, future Bell* products. Own their
domain entities. Consume L0–L5 only through published contracts.

### The L3/L4 split, stated explicitly

The brief lists "Memory Runtime" and "Knowledge Runtime" among Transformer Runtime
components. This model places the **runtimes at L4** and their **substrate at L3**:

- L3 Memory *substrate* stores embeddings and records. L4 Memory *Runtime* decides what to
  remember, what to recall, and how to compress it.
- L3 Knowledge Pack *registry* stores pack contents. L4 Knowledge *Runtime* decides which
  packs apply to a request and retrieves from them.

This is a deliberate decision (ADR-002). It keeps L4 swappable — a different reasoning
strategy should not require re-storing the corpus — and keeps L3 free of model concerns.

### Dependency rules (binding)

1. A layer may depend **only on strictly lower layers**. Never sideways into a peer's
   internals, never upward.
2. Skipping downward is permitted (L5 → L1) **provided** the call goes through the lower
   layer's published contract, never its internals.
3. **No lower layer may name, import, or branch on a higher-layer concept.** L1 must not
   know what an RFQ is. L4 must not contain `switch (category)`.
4. Same-layer communication goes through L2 events or a published query contract — never a
   direct import of another module's internals.
5. Every L1+ operation carries a `SecurityContext`. Required parameter, not ambient state.
6. **No category, assistant, factory modality, or integration may be added by changing a
   layer.** Each is registered configuration (ADR-003, -004, -005, -006, -009).

Rule 6 is what makes 450+ categories tractable and is the load-bearing rule of this freeze.

### Why this model over the alternatives

Full reasoning in **ADR-001**. Summary:

**The 9-stage pipeline was disqualified on the platform/application invariant.**
`ARCHITECTURE_DECISIONS.md:26`: *"Marketplace owns buyers, suppliers, products, RFQs,
matching, quotations, and orders."* PS-00 assigns exactly those to **VyaparSethu, an
application**. The model places an application's domain inside the platform — the precise
inversion the platform exists to prevent. It is also a left-to-right *sequence*, not a
stack, so "arrows point down" is undefined in it, and it has no position for an AI kernel:
"Enterprise AI Router" is one stage among nine rather than the substrate everything uses.
It cannot express an AI Operating System.

**The 5-tier kernel is structurally sound but too coarse.** It passes reusability and
dependency-flow, and its invariants are correct (and are inherited here). But a single
"KERNEL" tier holding ten runtimes cannot answer "which layer owns the Prompt Platform?"
— the answer is "the kernel," which does not discriminate. With ten runtimes now formally
required, that coarseness becomes disqualifying.

**Layer 0–6 is chosen** because numbering gives unambiguous per-module ownership (every
module gets exactly one integer) and a mechanically checkable dependency rule
(`layer(importer) > layer(imported)`), while dedicating L4 to the AI kernel — which is what
makes the model express an *AI operating system* rather than a web stack with AI bolted on.

**Nothing is discarded.** The 5-tier model's invariants are carried into the L1/L4 binding
rules. The 9-stage pipeline is retained as **VyaparSethu's L6 domain value-chain**, an
accurate description of that application's internal flow.

---

## How the eight elements are accommodated

| # | Element | Home | ADR |
|---|---|---|---|
| 1 | Enterprise Transformer Runtime | **L4** — all ten runtimes | ADR-002 |
| 2 | Industry Knowledge Packs (450+) | **L3** registry (data) + **L4** Knowledge Runtime (resolution) | ADR-003, ADR-009 |
| 3 | Enterprise AI Support (6 assistants) | **L5** — six *profiles* over one L4 Agent Runtime | ADR-004 |
| 4 | AI Factory Platform (7 factories) | **L5** — one pipeline, seven modality adapters | ADR-005 |
| 5 | Enterprise Integration Hub | **L2** — platform-owned connectors, org-scoped bindings | ADR-006 |
| 6 | 3DFabrica (digital fabric intelligence) | **L6** application consuming L5 factories | ADR-007 |
| 7 | Multi-tenant data ownership | **L1** enforcement + org scope on every entity | ADR-008 |
| 8 | Category extensibility (#451 = config) | Guaranteed by dependency rule 6 | ADR-009 |

---

## Honest status of this architecture

This is a **target** architecture. It is frozen as the thing to build toward, not a
description of what runs today. The gap is large and documented, not hidden:

- **L0, L1 partially real.** L1's authentication is the strongest verified component.
- **L2 barely exists** — the job queue is write-only (`JobWorker.start()` commented out);
  no event bus; **no Integration Hub**.
- **L3 does not exist** — no pgvector, no graph, no search, no pack registry.
- **L4 is ~10% real** — a Gemini-only, two-endpoint server router, plus a **parallel legacy
  AI path resident in the browser** consumed by 5 pages.
- **L5 exists as three disconnected studios**, not a factory platform; **zero assistants**.
- **L6 is one application shell**; the marketplace domain is schema without behaviour.

Current violations: dependency rule 3 in 7+ places (pages bypassing their own service
layer), rule 5 in 9 places (handlers using an RLS-bypassing pooled connection), and the L4
credential rule in 1 module with 5 consumers.

**All recorded, none fixed.** They belong to IS-xx sprints. Detail in
[`MASTER_MODULES.md`](./MASTER_MODULES.md) and ADR-013.

---

## Related documents

- [`MASTER_MODULES.md`](./MASTER_MODULES.md) — every module, assigned to a layer, with evidence
- [`MASTER_DATA_OWNERSHIP.md`](./MASTER_DATA_OWNERSHIP.md) — entity ownership and tenant boundaries
- [`MASTER_API_BOUNDARIES.md`](./MASTER_API_BOUNDARIES.md) — contracts between layers
- [`ARCHITECTURE_DECISION_RECORDS.md`](./ARCHITECTURE_DECISION_RECORDS.md) — ADR-001 … ADR-013
