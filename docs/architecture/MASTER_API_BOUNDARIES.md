# Bell24h-OS — Master API Boundaries

**Part of PS-02.** The stable contracts between layers of
[`CANONICAL_ARCHITECTURE.md`](./CANONICAL_ARCHITECTURE.md).

**Conceptual contracts, not code.** No interface was implemented, no route added, no
signature changed. Where a contract does not exist, it is marked **FUTURE** rather than
described as though it did.

---

## Universal rules for every boundary

1. **`SecurityContext` is a required parameter, not ambient state.** Every cross-layer call
   at L1+ carries `{ userId, organizationId, roles, requestId }`. A call without it should
   not compile.
2. **Fail closed.** If identity, tenant, or authorization cannot be resolved, deny. There is
   no "continue without context" branch.
3. **Contracts expose behaviour, not tables.** A consumer never receives a raw row handle or
   a database connection.
4. **Errors are typed and safe** — a stable code, never a raw driver message. *Today this is
   violated:* handlers return `err.message` straight from Postgres, which is how
   `DATABASE_URL is not defined` reached an unauthenticated caller.
5. **Every mutation emits a domain event** (FUTURE — no event bus exists).
6. **Versioning:** additive-only within a major version. External REST is versioned by path
   (`/api/v1`); internal contracts by module manifest; **knowledge packs and agent profiles
   by their own immutable version records**.

---

## L0 → L1 · Infrastructure to Identity

| | |
|---|---|
| **L0 exposes** | Connection acquisition, config/secret reads, storage handles |
| **Auth required** | None — L0 is below identity |
| **Data flow** | ↓ connection strings, bucket handles · ↑ nothing tenant-aware |
| **Status** | **VERIFIED IMPLEMENTED** — Supabase client + pool operational |

**Binding rule:** L0 has **no tenant awareness**. It must never filter by
`organization_id`; that is L1's job.

**Known violation:** `getPool()` is reachable from request handlers, letting upper layers
obtain a raw RLS-bypassing connection. The contract should expose only a
`SecurityContext`-scoped repository. **9 handlers violate this.**

---

## L1 → L2+ · Identity, Tenancy & Security

The most important boundary in the system.

| Contract | Exposes | Auth | Status |
|---|---|---|---|
| **Authenticate** | bearer token → `{ userId, organizationId, token }` or typed denial | none (this *is* the gate) | **VERIFIED IMPLEMENTED** — 401 proven on 10 routes, dev + prod |
| **Resolve organization** | userId → `organizationId` | valid token | **VERIFIED IMPLEMENTED** — via caller's own JWT so RLS applies |
| **Authorize** | `(ctx, action, resource)` → allow/deny | valid context | ⚠️ **FUTURE — DOES NOT EXIST.** `hasPermission`/`checkRole`/`authorize` → 0 hits |
| **Audit** | append `{actor, org, action, target, outcome, requestId}` | server-internal | **PLATFORM FOUNDATION** — stdout only, not durable |
| **Organization management** | create org, manage membership | admin role | **FUTURE** — no service |

**The authorization gap is the significant one.** `requireAuth` answers *"who are you and
which tenant?"* — not *"may you do this?"*. Every gated route is therefore all-or-nothing:
any authenticated user of any organization can call any of them.

This blocks Elements 3 and 5 directly: assistants need per-profile tool authorization, and
integration credentials need role-gated access.

**Contract shape when built (ADR-011):**
```
authorize(ctx, "factory.video.generate", { organizationId }) -> Allow | Deny(reason)
```
Resolved server-side from `role → permission → action`, cached per session. Fails closed.

---

## L2 → L3+ · Platform Core Services

| Contract | Exposes | Auth | Status |
|---|---|---|---|
| **Job scheduling** | `enqueue(job, ctx)` → jobId; status; dependency graph | `SecurityContext` | **PLATFORM FOUNDATION** — enqueue works; ⚠️ **nothing dequeues** |
| **Workflow execution** | `trigger(workflowId, ctx)`; run history | `SecurityContext` | **PLATFORM FOUNDATION** — `triggerWorkflow()` is a simulation |
| **Event publish/subscribe** | `publish(event)`, `subscribe(type, handler)` | server-internal | ⚠️ **FUTURE — no bus, no outbox** |
| **Notification** | `send(channel, recipient, payload, ctx)` | `SecurityContext` | **FUTURE** — table only |
| **Rate limiting** | per-org window | `SecurityContext` | **PLATFORM FOUNDATION** — in-memory, per-process |
| **API Gateway** | HTTP surface, routing | per-route | **PLATFORM FOUNDATION** — 13 routes, no `/api/v1` |

### Enterprise Integration Hub (Element 5) — FUTURE

| Contract | Exposes | Auth | Status |
|---|---|---|---|
| **Connector catalogue** | list available connectors (ERP, CRM, WhatsApp, payment, government, logistics, webhooks, MCP tools) | `SecurityContext` | **FUTURE** |
| **Binding management** | enable/disable a connector for an org; store credentials | admin role | **FUTURE** — needs the L1 authorize primitive |
| **Invoke** | `call(connectorId, operation, payload, ctx)` → typed result | `SecurityContext` | **FUTURE** |
| **Inbound webhook** | verified receipt → domain event | signature verification | **FUTURE** — needs the event bus |

**Binding rules (ADR-006):**
- **Applications consume integrations; they never build them.** An L6 app must not hold a
  Salesforce SDK, exactly as it must not hold a provider SDK.
- **Credentials are server-only and envelope-encrypted.** Never client-readable, never in a
  tenant-readable row — the same rule that `ai_providers.api_key` currently violates.
- **One connector, many bindings.** The connector is a platform asset; the binding and its
  credentials are org-scoped.
- **AI providers are NOT Integration Hub connectors.** They belong to L4's Provider Manager,
  because AI routing carries budget, model-policy, and telemetry concerns the generic hub
  does not model. Stated explicitly because the brief lists them under both.

**Job contract rule:** jobs must be idempotent on `(organizationId, idempotencyKey)` and
must checkpoint so a restart resumes rather than restarts. Neither property exists today.

**Delivery semantics when the bus is built:** at-least-once with consumer-side idempotency
on `eventId`. Exactly-once is not offered — it is not achievable across process boundaries,
and claiming it produces consumers that silently assume it. Ordering is guaranteed **per
aggregate**, not globally.

---

## L3 → L4+ · Knowledge & Memory Substrate

**L3 stores and retrieves. It does not reason.** Reasoning is L4.

| Contract | Exposes | Auth | Status |
|---|---|---|---|
| **Context resolution** | `getContext(profileId, ctx)` → flattened map | `SecurityContext` | **PLATFORM FOUNDATION** — exists, **no consumer**; its own page bypasses it |
| **Knowledge Vault** | document CRUD | `SecurityContext` | ⚠️ **PLATFORM FOUNDATION, defective** — authenticated but **not tenant-scoped** (ADR-010) |
| **Knowledge Pack registry** | `resolvePacks(ctx, categoryRefs)` → ordered pack versions; `getAsset(packVersion, key)` | `SecurityContext` | **FUTURE** (Element 2) |
| **Vector store** | `upsert(records, ctx)`, `similaritySearch(vector, filter, ctx)` | `SecurityContext` | **FUTURE** — no pgvector |
| **Search** | `search(query, filters, ctx)` → ranked results | `SecurityContext` | **FUTURE** |
| **Graph** | entity/relation traversal | `SecurityContext` | **FUTURE** |

**Binding retrieval rule:** filter by `organization_id` **before** ranking, never after.
Filtering after ranking leaks cross-tenant result counts even when rows are hidden.

**Pack resolution contract (ADR-003):** `resolvePacks` returns packs in precedence order —
**org override → org private → platform published** — with the resolved version pinned for
the life of the request, so a pack publish mid-request cannot change behaviour halfway.

---

## L4 → L5+ · Enterprise AI Runtime (the AI-OS kernel)

**Every model call goes through here. One path. No exceptions.**

| Contract | Exposes | Auth | Status |
|---|---|---|---|
| **Text generation** | `generateText(ctx, {prompt, model?})` → string | `SecurityContext` | **PLATFORM FOUNDATION** — Gemini-only, 2 endpoints |
| **Structured generation** | `generateJson<T>(ctx, {prompt, responseSchema})` → T | `SecurityContext` | **PLATFORM FOUNDATION** |
| **Provider credential resolution** | *(internal to L4 — never exposed upward)* | server-only | **PLATFORM FOUNDATION** — `process.env` only, fails closed |
| **Budget enforcement** | per-org cap, pre-flight | `SecurityContext` | **PLATFORM FOUNDATION** — in-memory, resets on restart |
| **Model routing (OmniRoute)** | select model by cost/latency/capability | `SecurityContext` | **FUTURE** |
| **Prompt Runtime** | render + execute a versioned template | `SecurityContext` | **PLATFORM FOUNDATION** — via **legacy browser path** |
| **Context Runtime** | assemble + compress context within a token budget | `SecurityContext` | **FUTURE** |
| **Memory Runtime** | `remember(record, scope, ctx)`, `recall(query, scope, ctx)` | `SecurityContext` | **FUTURE** — blocked on L3 |
| **Knowledge Runtime** | `ground(query, packScope, ctx)` → retrieved context + citations | `SecurityContext` | **FUTURE** — blocked on L3 registry |
| **Reasoning Runtime** | `plan(goal, ctx)`, multi-step execution with verification | `SecurityContext` | **FUTURE** |
| **Agent Runtime** | `invoke(agentProfileId, input, ctx)` → result + trace | `SecurityContext` | **FUTURE** — `AgentService` is a stub |
| **Transformer Runtime** | `infer(modelRef, input, ctx)` for fine-tuned domain models | `SecurityContext` | **FUTURE (reserved)** — ADR-002 |
| **Image / video generation** | `generateImage/Video(ctx, params)` | `SecurityContext` | ⚠️ **Exists only on the legacy browser path** |

**Binding credential rule:** no module in any other layer holds a provider SDK or
credential. `server/ai/*` must never be imported from `src/` — verified today: it is not.

**Known violation, and it is the significant one:**
`src/modules/ai-providers/AiProviderService.ts` is a **second, parallel AI path resident in
the browser**, consumed by 5 pages plus the job orchestrator, with its own provider adapters
and failover. It cannot be adapted — it must be replaced (ADR-012).

**Substitution rule (ADR-002):** the Transformer Runtime is reachable through the *same*
`generateText`/`generateJson` contract as foundation models. A caller specifies a
capability, not a vendor. This is what lets fine-tuned models replace external ones later
without touching a single L5 or L6 consumer — the whole point of reserving the layer now.

**Telemetry contract:** every AI call emits provider, model, tokens, cost, latency,
outcome, **and the resolved knowledge-pack versions**. Partially implemented — audit events
go to stdout.

---

## L5 → L6 · Applied AI Capabilities

### AI Factory Platform (Element 4)

**One pipeline, seven modality adapters** — not seven stacks (ADR-005).

```
request → authorize → resolve packs (L3) → build context (L4) →
  enqueue job (L2) → model call (L4) → persist asset + provenance → emit event (L2)
```

| Contract | Exposes | Auth | Status |
|---|---|---|---|
| `submit(modality, params, ctx)` | → jobId | `SecurityContext` | **FUTURE** as unified contract |
| `getJob(jobId, ctx)` / `getAsset(assetId, ctx)` | job state, asset + provenance | `SecurityContext` | **FUTURE** |
| Modality adapters | Content · Image · Video · Voice · Document · CAD · Digital Asset | — | 3 exist **as separate studios**; 4 absent |

**Only the adapter differs per modality.** Authorization, pack resolution, job handling,
asset persistence, provenance, and events are shared. The current schema shows the
anti-pattern this corrects: `image_*` and `video_*` are near-identical table families
duplicated per modality (VERIFIED).

### Enterprise AI Support (Element 3)

**Six profiles over one Agent Runtime** — not six modules (ADR-004).

| Contract | Exposes | Auth | Status |
|---|---|---|---|
| `chat(profileId, message, ctx)` | → response + citations + trace | `SecurityContext` (Public Assistant: anonymous session, org-less, tightly scoped) | **FUTURE** ×6 |

A profile is a row: system prompt, tool grants, knowledge-pack scope, memory scope,
authorization context. **Adding a seventh assistant is a row, not a module.**

**The Public Assistant is the one genuine exception** to the "always authenticated" rule —
it serves anonymous external users. It therefore gets its own hard constraints: no tenant
data access, no tools with side effects, platform-published packs only, and its own rate
limit. Called out explicitly because it is the easiest place to accidentally leak tenant
data.

### Other capabilities

| Capability | Status |
|---|---|
| SEO Intelligence | **PLATFORM FOUNDATION** — rule-based, not AI |
| Publishing · Campaign · Performance · Media Composer | **PLATFORM FOUNDATION** — thin CRUD |
| Industry Intelligence | **PLATFORM FOUNDATION** — consumer orphaned |
| GEO Engine · AI Discovery · Analytics | **FUTURE** |
| Commerce (Payment/Wallet/Ledger/Escrow) | ⚠️ **FUTURE — none exist** |

**L5 admission test (binding):** a capability belongs at L5 only if a **second** application
could plausibly consume it unchanged. This is the test `ARCHITECTURE_DECISIONS.md` failed
when it placed Marketplace inside the platform.

---

## L6 · Applications

Applications consume L0–L5 through the contracts above and own their domain entities. They
may **not**: import another application's modules, reach past a contract into a lower
layer's internals, hold provider or integration credentials, or open their own database
connection.

**3DFabrica's consumption path (ADR-007)** — digital fabric intelligence:

| 3DFabrica capability | Consumes |
|---|---|
| AI Fabric Digitization | L5 Image Factory + L4 vision models |
| AI PBR Generation | L5 Image Factory (material map generation) |
| Material Library | L3 substrate + L5 Digital Asset Factory |
| Interior Rendering | L5 CAD Factory + Image Factory |
| Digital Fabric Twins | L3 knowledge/graph + L5 Digital Asset Factory |
| Visualization Platform | own L6 UI |

**Every one of these depends on an L5 factory that does not exist yet.** 3DFabrica cannot
begin before the Factory Platform.

**Known violations today:** 7+ pages call the L0 Supabase client directly, bypassing their
own service layer. Recorded in ADR-013, not fixed.

---

## External API surface

**Status: FUTURE.** Today's `server.ts` is an internal Express surface, not a published API.

| Aspect | Rule |
|---|---|
| Path | `/api/v1/...` |
| Auth | Bearer JWT; **every** route declares its auth requirement at registration |
| Authorization | server-side `authorize(ctx, action, resource)` — currently missing |
| Pagination | cursor-based, never offset |
| Errors | RFC 7807 problem details, stable codes — never raw driver messages |
| Idempotency | `Idempotency-Key` required on all mutations |
| Rate limits | per-organization, durable |
| Versioning | additive-only within `v1` |

**Registration-time rule (the structural fix):** the router should reject any route
registered without an explicit auth declaration, making "unauthenticated route" a boot-time
impossibility rather than something review must catch — which is exactly how the 8 routes
RG-C closed came to exist.

---

## Boundary status summary

| Boundary | Status |
|---|---|
| L0 → L1 | **VERIFIED IMPLEMENTED** (with a pool-leak violation) |
| L1 → L2+ (authenticate) | **VERIFIED IMPLEMENTED** |
| L1 → L2+ (**authorize**) | ⚠️ **FUTURE — does not exist.** Blocks Elements 3 and 5 |
| L2 → L3+ (jobs) | **PLATFORM FOUNDATION** — enqueue only, nothing dequeues |
| L2 → L3+ (events) | ⚠️ **FUTURE** |
| L2 → L3+ (**Integration Hub**) | ⚠️ **FUTURE — Element 5 entirely unbuilt** |
| L3 → L4+ (substrate) | **FUTURE**, except a defective Vault |
| L3 → L4+ (**pack registry**) | ⚠️ **FUTURE — Element 2 entirely unbuilt** |
| L4 → L5+ (text/JSON) | **PLATFORM FOUNDATION** — correct shape, narrow scope, legacy path in parallel |
| L4 → L5+ (**runtimes 3–10**) | ⚠️ **FUTURE — Element 1 reserved, unbuilt** |
| L5 → L6 (**Factory Platform**) | **FUTURE** as a platform; 3 studios exist separately |
| L5 → L6 (**AI Support**) | ⚠️ **FUTURE — Element 3, zero assistants** |
| External API | **FUTURE** |
