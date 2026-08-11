# Bell24h-OS Kernel Architecture Specification

Sprint C.3A — Enterprise Kernel Architecture
Status: **DESIGN — NOT FROZEN**
Evidence baseline: repository verified 2026-07-30 at commit `d2ca7cd`

---

## 1. Executive Summary

Bell24h-OS is to become the orchestration kernel beneath VyaparSethu, 3DFabrica, and
future AI products. This document specifies that kernel.

**The stated premise of this sprint is not accurate, and the design accounts for it.**
Three of the four foundations declared "complete and frozen" are not complete:

| Foundation | Declared | Verified state |
|---|---|---|
| Authentication | complete | **Not verified once.** Zero successful logins observed |
| Supabase Foundation | complete | **8 of 13 routes unauthenticated; 9 bypass RLS** |
| AI Provider Foundation | complete | **Legacy browser adapter still live; 17 `api_key` refs in client bundle** |
| OmniRoute install | complete | ✅ **Genuinely complete** — verified running |

A kernel is an amplifier. Built over an unauthenticated data plane, it does not fix
those defects — it distributes them to every product that plugs in. The architecture
below is therefore specified with **hard preconditions** (§18) that must clear before
any module is admitted.

The design target is millions of users and billions of events. The design *strategy* is
phased: a modular monolith with strict internal seams that can be extracted to services
under load, rather than a distributed system built speculatively for traffic that does
not yet exist. The application currently has **zero deployments**.

---

## 2. Kernel Overview

### 2.1 Position in the stack

```
┌──────────────────────────────────────────────────────────────┐
│  Products:  VyaparSethu · 3DFabrica · AI Factories           │
├──────────────────────────────────────────────────────────────┤
│  Modules:   CRM · RFQ · SEO · GEO · Prompt Studio ·          │
│             Image/Video/Voice Factory · KG · GraphRAG        │
├──────────────────────────────────────────────────────────────┤
│  KERNEL                                                       │
│   Core: boot · registry · DI · discovery · lifecycle          │
│   Runtimes: AI · Agent · Workflow · Event · Memory ·          │
│             Graph · Search · Commerce · Analytics · Security   │
│   Bus: domain events · outbox · pub/sub · orchestration       │
├──────────────────────────────────────────────────────────────┤
│  Adapters:  Supabase · OmniRoute · MCP · object storage       │
├──────────────────────────────────────────────────────────────┤
│  Infra:     Postgres/pgvector · Redis · object store          │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Non-negotiable invariants

The kernel exists to make these true *by construction*, not by per-module discipline:

1. **No request reaches a runtime without a resolved `SecurityContext`.** Fail closed.
2. **No query executes without an organization scope.** Enforced at the data-access
   layer, not in handlers.
3. **No provider credential is reachable from browser code.** Ever.
4. **Every state mutation emits a domain event.** Events are the audit trail.
5. **Every AI call passes the AI Runtime.** No module holds a provider SDK.

Invariants 1–3 are precisely what the current codebase violates.

### 2.3 Boot process

Deterministic, ordered phases. Any failure aborts boot — no partial-readiness serving.

```
Phase 0  CONFIG      load + validate env against schema; fail fast on missing secrets
Phase 1  INFRA       Postgres pool, Redis, object store; connectivity probes
Phase 2  SECURITY    Security Runtime first — JWT verifier, RBAC cache, secret provider
Phase 3  CORE        DI container, event bus, outbox dispatcher, telemetry
Phase 4  RUNTIMES    topologically sorted by declared dependency graph
Phase 5  MODULES     manifest validation → capability grant → register
Phase 6  DISCOVERY   publish service table; open health endpoints
Phase 7  READY       accept traffic; emit kernel.booted
```

Security in Phase 2, before anything that touches data, is deliberate: it makes
"unauthenticated route" a structural impossibility rather than a review finding.

### 2.4 Runtime lifecycle

```ts
interface KernelComponent {
  readonly name: string;
  readonly dependsOn: readonly string[];
  init(ctx: KernelContext): Promise<void>;
  start?(): Promise<void>;
  health(): Promise<HealthReport>;
  drain?(): Promise<void>;    // stop accepting, finish in-flight
  stop(): Promise<void>;
}
```

Shutdown reverses boot order with a drain window. In-flight AI jobs and workflow steps
must checkpoint, not abort — see §7.4.

### 2.5 Module registration

Modules are declarative. The kernel refuses anything that does not declare its needs.

```ts
interface ModuleManifest {
  name: string;
  version: string;
  requires: { runtimes: string[]; capabilities: Capability[] };
  provides: { events: string[]; commands: string[]; routes?: RouteSpec[] };
  tables?: string[];          // must all carry organization_id
  aiPolicy?: { maxCostPerRequestUsd: number; allowedModelClasses: string[] };
}
```

Registration is rejected if: a required runtime is absent, a declared table lacks an
org-isolation policy, a route omits an auth requirement, or a capability is not granted.

### 2.6 Dependency management & service discovery

Constructor injection via a typed container. No service locator, no ambient singletons —
those defeat testability and hide the dependency graph. Discovery is an in-process
registry now, backed by a `service_registry` table when the kernel splits into
processes; the interface does not change at that point.

---

## 3. Runtime Architecture

Ten runtimes. Honest maturity assessment included — several are thin today, and saying
so is more useful than implying uniform depth.

| Runtime | Responsibility | Backing | Maturity |
|---|---|---|---|
| **Security** | Identity, RBAC, org scope, secrets, audit | Supabase Auth + `user_roles` | Partial |
| **Event** | Domain events, outbox, pub/sub, DLQ | Postgres outbox → broker | Design |
| **AI** | Routing, budget, cache, provider adapters | OmniRoute + `server/ai/*` | Partial |
| **Memory** | Unified memory, embeddings, retrieval | Postgres + pgvector | Design |
| **Workflow** | Durable orchestration, sagas, retries | Postgres state machine | Design |
| **Agent** | Agent loops, tool dispatch, MCP | AI + Workflow + MCP | Design |
| **Graph** | Entities, relations, traversal, GraphRAG | Postgres adjacency + CTEs | Design |
| **Search** | Lexical + vector + hybrid ranking | `tsvector` + pgvector | Design |
| **Commerce** | RFQ, quotation, order, escrow state | Postgres + Workflow | Design |
| **Analytics** | Event rollups, cost, funnels | Event store → marts | Design |

### 3.1 Why Postgres for most of this

At current scale, one well-indexed Postgres with pgvector replaces four specialised
stores. Introducing Neo4j, Elasticsearch, and Kafka on day one buys capability the
platform cannot yet exercise and costs operational surface it cannot yet staff. Each
runtime's interface is written so its backing store is swappable — that is the
extraction seam, and it is the thing worth designing now.

### 3.2 Runtime contract

```ts
interface Runtime<TCmd, TRes> extends KernelComponent {
  execute(cmd: TCmd, ctx: SecurityContext): Promise<TRes>;
  capabilities(): Capability[];
}
```

`SecurityContext` is a required parameter, not optional context. A runtime call without
it does not compile.

---

## 4. Module Architecture

### 4.1 Isolation rules

- Modules communicate via **events and commands only** — never direct imports of each
  other's internals.
- Modules own their tables; cross-module reads go through the owning module's query API
  or a projection.
- A module may not open a database connection. It receives a scoped repository.
- A module may not read `process.env`. Config arrives through its manifest.

### 4.2 Module inventory

| Module | Runtimes consumed | Emits | Current state |
|---|---|---|---|
| AI Provider Manager | AI, Security | `provider.*` | **Rewrite required** (browser-side) |
| Prompt Studio | AI, Memory | `prompt.*` | Exists, browser AI path |
| SEO Engine | AI, Search, Graph | `seo.*` | Exists |
| GEO Engine | AI, Search, Graph | `geo.*` | Not built |
| CRM | Commerce, Memory | `crm.*` | Exists |
| RFQ Engine | Commerce, Workflow, AI | `rfq.*` | Not built in this repo |
| Image / Video / Voice Factory | AI, Workflow, Event | `asset.*` | Exists, browser AI path |
| OmniRoute Adapter | AI | `provider.route.*` | **Installed, not integrated** |
| MCP Server | Agent, Security | `mcp.*` | Not built |
| Knowledge Graph | Graph, Memory | `graph.*` | Not built |
| GraphRAG | Graph, Memory, AI, Search | `rag.*` | Not built |

Six of eleven do not exist. Four exist but route AI through the legacy browser adapter.

---

## 5. Event Architecture

### 5.1 Transactional outbox

The only correctness-preserving pattern available without distributed transactions:
state change and event insert commit together, then a dispatcher publishes.

```sql
CREATE TABLE kernel_outbox (
  id              BIGSERIAL PRIMARY KEY,
  event_id        UUID NOT NULL UNIQUE,
  event_type      TEXT NOT NULL,
  organization_id UUID NOT NULL,
  actor_id        UUID,
  aggregate_type  TEXT NOT NULL,
  aggregate_id    UUID NOT NULL,
  payload         JSONB NOT NULL,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at    TIMESTAMPTZ,
  attempts        INT NOT NULL DEFAULT 0,
  last_error      TEXT
);
CREATE INDEX ON kernel_outbox (published_at) WHERE published_at IS NULL;
CREATE INDEX ON kernel_outbox (organization_id, occurred_at DESC);
```

### 5.2 Envelope

```ts
interface DomainEvent<T = unknown> {
  eventId: string;            // idempotency key
  type: string;               // "rfq.quotation.submitted"
  version: number;            // schema version, additive evolution only
  organizationId: string;     // ALWAYS present — no global events
  actorId: string | null;
  aggregate: { type: string; id: string };
  occurredAt: string;
  correlationId: string;      // request trace
  causationId: string | null; // parent event
  payload: T;
}
```

`organizationId` is mandatory in the envelope. A tenant-less event cannot be authorized,
filtered, or billed, and becomes a cross-tenant leak the moment a consumer forgets a
WHERE clause.

### 5.3 Delivery

At-least-once, with consumer-side idempotency keyed on `eventId`. Exactly-once is not
offered — it is not achievable across process boundaries, and pretending otherwise
produces consumers that quietly assume it.

Ordering is guaranteed **per aggregate**, not globally, via partition key
`{aggregate.type}:{aggregate.id}`.

Retry: exponential backoff (1s → 5m, 8 attempts) → DLQ. DLQ depth is an alertable SLO.

### 5.4 Phasing

- **Phase 1 (now):** outbox + `LISTEN/NOTIFY`, in-process handlers. Sufficient to
  ~1k events/sec.
- **Phase 2:** dispatcher publishes to Redis Streams; consumer groups per module.
- **Phase 3:** Kafka/Redpanda when partitioning or replay windows demand it.

The outbox table is unchanged across all three. Only the dispatcher target moves.

---

## 6. Memory Architecture

### 6.1 Unified model

Nine requested memory types are **scopes over one substrate**, not nine subsystems.
Separate stores would fragment retrieval and make cross-scope recall impossible.

```sql
CREATE TABLE memory_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  scope           memory_scope NOT NULL,   -- enum, see below
  subject_type    TEXT NOT NULL,           -- 'user'|'supplier'|'buyer'|'workflow'|...
  subject_id      UUID,
  kind            TEXT NOT NULL,           -- 'fact'|'preference'|'summary'|'episode'
  content         TEXT NOT NULL,
  embedding       VECTOR(1536),
  salience        REAL NOT NULL DEFAULT 0.5,
  valid_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to        TIMESTAMPTZ,             -- NULL = current  (temporal memory)
  superseded_by   UUID REFERENCES memory_records(id),
  source_event_id UUID,                    -- provenance
  metadata        JSONB NOT NULL DEFAULT '{}'
);
```

| Scope | Subject | Retention | Notes |
|---|---|---|---|
| `user` | user | until deletion request | GDPR erasure target |
| `organization` | org | indefinite | tenant-wide facts |
| `supplier` | supplier | indefinite | capability, reliability |
| `buyer` | buyer | indefinite | intent, history |
| `ai` | model/provider | 90d rolling | prompt/response distillates |
| `workflow` | workflow run | run + 30d | checkpoint context |
| `conversation` | thread | 30d hot → summarise | rolling window |
| `knowledge` | document | indefinite | GraphRAG corpus |
| `temporal` | any | bi-temporal | `valid_from`/`valid_to` |

### 6.2 Temporal semantics

Bi-temporal by default: nothing is updated in place. A superseding record sets the
predecessor's `valid_to` and links via `superseded_by`. This makes "what did we believe
on date X" answerable, which matters for pricing disputes, RFQ audit, and AI-decision
review.

### 6.3 Retrieval

Hybrid: BM25 (`tsvector`) ∪ vector (pgvector HNSW) → Reciprocal Rank Fusion → optional
cross-encoder rerank. Always filtered by `organization_id` **before** ranking — never
after, which would leak result counts across tenants.

---

## 7. AI Runtime Design

### 7.1 Layering

```
Module
  └─ AIRuntime.complete(request, securityContext)
       ├─ Policy      model allow-list, org budget, PII egress rules
       ├─ Budget      per-org / per-actor / per-request caps (durable counters)
       ├─ Cache       semantic + exact, org-partitioned
       ├─ Router      strategy → provider selection
       ├─ Providers   OmniRoute (primary) │ direct SDK (fallback)
       └─ Telemetry   tokens, cost, latency, provider, outcome → events
```

### 7.2 Credential rule

Provider credentials resolve **only** from the server secret provider. The kernel
prohibits a credential column in any tenant-readable table. This is the direct
generalisation of the `ai_providers.api_key` defect: the current schema stores plaintext
keys in an org-readable row, and the browser selects them.

### 7.3 Budget enforcement

Durable, not in-memory. Current implementation uses a process-local `Map`, which resets
on restart and does not coordinate across instances — adequate as a brake, not as a
control. Target: Postgres counters with advisory locks, Redis for hot-path reads.

### 7.4 Job durability

Long-running generation (video, batch embedding) runs as Workflow steps with
checkpoints, so a kernel restart resumes rather than restarts. Jobs are idempotent on
`(organization_id, idempotency_key)`.

---

## 8. Security Architecture

### 8.1 Zero Trust, concretely

"Zero Trust" is only meaningful as enforced chokepoints:

1. **Single ingress authenticator.** One middleware verifies the Supabase JWT and
   resolves `{ userId, organizationId, roles, permissions }`. Routes cannot opt out —
   the router rejects a `RouteSpec` without an auth declaration at registration time.
2. **Org scope in the data layer.** Repositories are constructed *from* a
   `SecurityContext` and inject `organization_id` into every query. A module cannot
   express an unscoped query.
3. **Defence in depth via RLS.** Application scoping and RLS both, because either alone
   has failure modes. **Direct-pool access bypasses RLS entirely** — 9 current routes
   do this and must be migrated or scoped explicitly.
4. **Capability grants.** Modules receive narrow capabilities, not a database handle.

### 8.2 RBAC

Schema exists and is unused: `roles`, `permissions`, `user_roles`. Target model is
`role → permission → action` resolved server-side and cached per session, with
`AuthService.resolveRole` (client) demoted to a display concern only.

**No server-side authorization primitive exists today** — `grep` for
`hasPermission|checkRole|authorize` returns nothing.

### 8.3 Secrets

Tiered: platform secrets (env/secret manager, server-only) · tenant integration
credentials (envelope-encrypted, KMS-wrapped DEK, never selectable by the client role) ·
public client config (`VITE_*` only, assumed public).

### 8.4 Audit

Every mutation emits a domain event; the audit log is a projection of the event stream
rather than a parallel write path that can drift. Required fields: actor, org, action,
target, outcome, correlation id, timestamp.

Current audit is **stdout-only** — structured, but not durable.

### 8.5 AI governance

Model allow-lists per org; PII egress classification before provider dispatch; prompt
and completion retention limits; human-approval gates for publish actions; full
decision provenance (`provider`, `model`, `cost`, `strategy`) on every AI event.

---

## 9. Observability Architecture

| Signal | Mechanism | SLO / alert |
|---|---|---|
| Logs | Structured JSON, correlation id, redaction filter | error rate |
| Metrics | OpenTelemetry → Prometheus | p95 latency, saturation |
| Traces | W3C context across kernel → runtime → provider | p99 span |
| AI cost | Per-org/model/day rollup from AI events | budget burn > 80% |
| Provider health | Success rate, latency, quota per provider | circuit-breaker trips |
| Workflow | Run states, step retries, stuck runs | stuck > 15m |
| Security | Auth denials, RLS errors, rate-limit rejects | denial spike |
| Event bus | Outbox lag, DLQ depth | lag > 30s, DLQ > 0 |

Cardinality discipline: `organization_id` is a metric label; `user_id` is not.

---

## 10. Scalability Strategy

Honest phasing against the stated target.

| Phase | Scale | Topology |
|---|---|---|
| **P0 — now** | 0 users, 0 deployments | Single Node process, one Postgres |
| **P1** | 10k users, 1k events/s | Horizontal app instances; PgBouncer; Redis cache; outbox → Redis Streams |
| **P2** | 500k users, 50k events/s | Read replicas; runtimes extracted to services; Kafka; org-sharded workers |
| **P3** | Millions; billions of events | Regional cells, org→cell routing; Citus or app-level sharding; per-region Postgres + global control plane |

**Statelessness** is the enabling property and must hold from P0: no in-process session
state, no in-memory counters of record, no local file writes. The current rate limiter
and AI budget counter both violate this and will produce incorrect behaviour the moment
a second instance exists.

Multi-tenancy: shared schema + `organization_id` through P2; cell-per-region at P3.
Org id is the shard key everywhere, which is why it is mandatory in the event envelope.

---

## 11. Deployment Architecture

```
Vercel/CDN ── static SPA
       │
       └── Kernel (Node) ──┬── Postgres (Supabase) + pgvector
                            ├── Redis (cache, streams, locks)
                            ├── Object store (assets)
                            └── OmniRoute (AI gateway, private network)
```

Workers run the same image with a different entrypoint — one artifact, several roles.
OmniRoute binds loopback/private only; it must never be internet-reachable, as
`REQUIRE_API_KEY=false` is its default.

Environments: local → preview (ephemeral, seeded) → staging → production.
**None of these exist yet.** No CI, no `.github/`, zero deployments.

---

## 12. Database Interaction Model

Three access paths, with strict rules:

| Path | Used by | RLS | Rule |
|---|---|---|---|
| Browser Supabase client (anon key) | SPA reads | **Enforced** | Explicit column projections only — never `select('*')` on tables holding secrets |
| Kernel Supabase client (user JWT) | Server, acting-as-user | **Enforced** | Preferred server path |
| Direct pool (`DATABASE_URL`) | Migrations, admin jobs | **Bypassed** | Must set `organization_id` explicitly; forbidden in request handlers |

The third path is the current architecture's largest hole: 9 request handlers use it.

Migrations are forward-only, reviewed, with rollback notes. `ai_providers` is currently
defined in **two** files (`supabase_schema.sql`, `add_ai_tables.sql`) — a duplication
that will silently revert column grants.

---

## 13. API & SDK Design

**External:** REST under `/api/v1`, cursor pagination, RFC 7807 problem details,
idempotency keys on mutations, per-org rate limits.

**Internal SDK:**

```ts
const kernel = await Kernel.boot(config);
const ctx = await kernel.security.authenticate(req);   // throws → 401/403
const rfq = kernel.module<RfqModule>('rfq');
await rfq.publish({ ... }, ctx);
```

`ctx` is unforgeable and required. There is no overload without it.

---

## 14. Integration with OmniRoute

**Verified state (2026-07-30):** `omniroute@3.8.49`, installed globally via npm,
running on `:20128`, `/healthz` → `ok`, 115 models, OpenAI + Anthropic wire formats both
responding, streaming confirmed (`text/event-stream`), keyless free providers working
(`felo`, $0.00).

Integration design:

```ts
class OmniRouteProvider implements AIProvider {
  // POST http://127.0.0.1:20128/v1/chat/completions
  // ALWAYS sends `stream` explicitly — omitting it returns SSE, not JSON
}
```

That last point is a verified behavioural trap, not a theoretical one: a request without
a `stream` field returns `text/event-stream`, which a strict OpenAI client will fail to
parse.

Placement: **primary router backend**, with direct provider SDKs as fallback so a gateway
outage is not a platform outage. Circuit-break on OmniRoute health; propagate its
`x-omniroute-*` cost/latency headers into AI telemetry events. Harden before any shared
environment: set `REQUIRE_API_KEY=true`, change `INITIAL_PASSWORD` from `CHANGEME`.

---

## 15. Integration with Supabase

| Capability | Kernel usage |
|---|---|
| Auth (GoTrue) | Sole identity provider; JWT verified at ingress |
| Postgres | System of record for all runtimes |
| pgvector | Memory + GraphRAG embeddings |
| RLS | Defence-in-depth tenant isolation |
| Storage | Factory asset output |
| Realtime | Optional UI push; **not** a substitute for the event bus |

Project reference `dqpaekyayhqhndihbnnn` (verified live). Anon key confirmed
`role: anon`. `mailer_autoconfirm: true`, `disable_signup: false`, email provider
enabled, all OAuth providers disabled.

---

## 16. Integration with AI Provider Manager

The existing manager **cannot be adapted** — it is browser-resident and reads
credentials from a tenant-readable table. It must be replaced by a server-side manager
behind the AI Runtime:

```
server/ai/
  ProviderManager.ts   ← credentials from process.env ONLY   (exists)
  ProviderRouter.ts    ← budget + audit                       (exists, minimal)
  GeminiProvider.ts    ← adapter                               (exists)
  OmniRouteProvider.ts ← primary backend                       (to build)
```

Migration order (lowest risk first): Prompt Studio (text) → Content Planner → Image
Factory (binary) → Video Factory (long-running) → JobOrchestrator (worker path).
Then drop `ai_providers.api_key` and **rotate every key it ever held.**

---

## 17. Future Expansion Strategy

New product onboarding: declare a `ModuleManifest` → receive scoped repository, AI
Runtime handle, event bus subscription → emit domain events. No product touches
infrastructure directly.

3DFabrica and VyaparSethu become module clusters over shared Commerce/Memory/Graph
runtimes. Note VyaparSethu today is an **independent Next.js application** using MSG91
auth and INSFORGE — it shares no code with this repo. Bringing it onto the kernel is a
migration project, not a configuration change.

---

## 18. Gap Analysis

### Preconditions to admitting ANY module (blocking)

| # | Gap | Evidence | Severity |
|---|---|---|---|
| 1 | 8 unauthenticated request routes | `server.ts` — `/api/vault/*`, `/api/check-*` | **CRITICAL** |
| 2 | 9 routes bypass RLS via direct pool | 9× `getPool()` in handlers | **CRITICAL** |
| 3 | Provider keys readable by any org member | `ai_providers.api_key` plaintext, org-RLS | **CRITICAL** |
| 4 | 17 `api_key` refs in shipped client bundle | bundle grep | **CRITICAL** |
| 5 | Column `REVOKE` never applied | no DB access | **CRITICAL** |
| 6 | No server-side authorization primitive | grep → 0 hits | **CRITICAL** |
| 7 | Authentication never verified end-to-end | 0 successful logins | **CRITICAL** |

### Kernel-level gaps

| # | Gap | Severity |
|---|---|---|
| 8 | No event bus, outbox, or domain events | HIGH |
| 9 | No workflow/durable execution | HIGH |
| 10 | Audit is stdout-only, not durable | HIGH |
| 11 | Rate limiter + AI budget in-memory per-process | HIGH |
| 12 | No memory substrate, no pgvector | HIGH |
| 13 | 6 of 11 modules do not exist (MCP, KG, GraphRAG, GEO, RFQ) | HIGH |
| 14 | No CI, no tests, no deployment pipeline | HIGH |
| 15 | No tracing/metrics; no OpenTelemetry | MEDIUM |
| 16 | `ai_providers` duplicated across two schema files | MEDIUM |
| 17 | `/system/diagnostics` outside `ProtectedRoute` | MEDIUM |
| 18 | OmniRoute defaults unhardened | MEDIUM |

---

## 19. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Kernel built over open data plane amplifies breach | High | Severe | Gaps 1–7 are hard preconditions |
| Provider keys already exfiltrated | Unknown | Severe | Assume compromised; rotate |
| In-memory counters break on scale-out | Certain at P1 | High | Durable counters before instance #2 |
| Distributed complexity outpaces team | High | High | Modular monolith; extract on evidence |
| Schema duplication reverts grants | Medium | High | Single source of truth |
| Event schema churn breaks consumers | Medium | Medium | Versioned envelope, additive only |
| VyaparSethu migration underestimated | High | Medium | Treat as separate programme |
| No tests → kernel regressions invisible | High | High | Test harness before module admission |

---

## 20. Recommendations

**Sequence — do not reorder.**

1. **C.2C** — Apply `requireAuth` + org scope to all 8 open routes; migrate 9 pool
   handlers off RLS bypass.
2. **C.2B completion** — Apply the column `REVOKE`; rotate every provider key.
3. **C.1J** — Verify login once, end to end.
4. **Kernel P0** — Security Runtime + DI + outbox + durable audit. No new features.
5. **AI Runtime** — `OmniRouteProvider`; migrate the 5 remaining browser consumers.
6. **Test + CI** — before any module is admitted.
7. **Memory Runtime** — pgvector; then Graph and GraphRAG.
8. **Workflow Runtime** — then Agent Runtime and MCP.
9. **Observability** — OpenTelemetry before P1 scale-out.
10. **Freeze review** — re-score; freeze only if ≥ 85.

---

## Enterprise Readiness Score

| Dimension | Weight | Score | Weighted |
|---|---|---|---|
| Architecture & governance docs | 15 | 72 | 10.8 |
| Authentication | 15 | 25 | 3.8 |
| Authorization / RBAC | 10 | 10 | 1.0 |
| Tenant isolation | 15 | 20 | 3.0 |
| Secret management | 10 | 15 | 1.5 |
| AI runtime | 10 | 40 | 4.0 |
| Observability | 5 | 20 | 1.0 |
| Event / workflow infrastructure | 10 | 5 | 0.5 |
| Deployment & CI | 5 | 5 | 0.25 |
| Testing | 5 | 0 | 0.0 |

### **Score: 27 / 100**

**Architecture CANNOT be frozen.**

The design in this document is sound and implementable. What is missing is the
foundation it assumes. Freezing now would ratify an architecture whose stated
prerequisites — authenticated APIs, enforced tenant isolation, server-held credentials —
are not met in the codebase.

Gaps 1–7 are the freeze gate. They are largely small, well-understood changes; several
are a single middleware application away. Once cleared, a re-score in the 60s is
realistic, and 85+ after Kernel P0 plus test infrastructure.
