# Bell24h-OS ↔ VyaparSethu SDK/API Contract v1.0

**Status:** DRAFT — architecture/contract document only. Implements only the P0 subset
(Section 19 below) this sprint; all other sections are TARGET design, explicitly not
built. Section structure and required content verified against the original mission
brief (session transcript, message at `e72bada7-…jsonl:903`) rather than reconstructed
from memory, after an advisor review flagged that risk.
**Author role:** Implementation Chief Engineer sprint — operating under existing approved
architecture (`CANONICAL_ARCHITECTURE.md`, `MASTER_DATA_OWNERSHIP.md`, `MASTER_MODULES.md`,
`ENGINEERING_GOVERNANCE.md`, `SECURITY_BASELINE.md`). This document does not redesign that
architecture; it specifies a contract surface consistent with it.
**Companion document:** `docs/architecture/BELL24H_OS_CURRENT_STATE.md` — read that first.
Every item below states whether it EXISTS today, is P0-IMPLEMENTED this sprint, or is
TARGET (design only, not built).

---

## 00. Contract Constitution

This contract governs how Bell24h-OS exposes its **reusable platform capabilities** to
callers — including a future VyaparSethu integration — as a versioned, tenant-scoped,
auditable API/SDK surface, rather than as ad hoc routes coupled 1:1 to the current SPA.

Binding rules, inherited unchanged from the mission brief and `ENGINEERING_GOVERNANCE.md`
/ `SECURITY_BASELINE.md`:
1. The contract defines an **interface**. It does not require a migration or rewrite of
   either system — no destructive rewrite, no DB migration for architectural purity, no
   replacement of working functionality in either system, no mass refactor, no moving
   business logic between repositories, no deleting working modules, no changing public
   VyaparSethu behaviour, no deployment, no git push.
2. Fail closed on identity, organization, or authorization ambiguity.
3. No capability is exposed through this contract before it exists, is authorized, and is
   organization-scoped in the underlying implementation.
4. This document does not authorize building anything beyond the P0 scope in Section 19.

## 01. System Identity & Tenancy

Two systems, two distinct roles (per the mission brief's Approved System Boundary):

**VyaparSethu** — public B2B marketplace/application. Owns business domain logic: Buyer,
Supplier, RFQ (+ categories/business schemas), supplier discovery, matching business
rules, Quote, Negotiation, Trade Chat semantics, Deal, procurement workflows,
Trust/Trust-Graph business rules, KYB business rules, Payment business rules, Escrow
business rules, Logistics business workflows, Marketplace functionality, trade
intelligence, public SEO/content, public marketplace experience.

**Bell24h-OS** — private reusable platform/infrastructure system. Owns reusable platform
capabilities: SDK/API infrastructure, AI runtime + Provider Manager + model/provider
routing, Communication Hub + WhatsApp/SMS/email adapters, Media infrastructure
(image/video/voice), Agent Runtime + Policy Engine, Identity/RBAC infrastructure,
Workflow infrastructure, Event infrastructure, Audit infrastructure, Evidence
infrastructure, Storage abstraction, provider adapters, Observability, usage/cost
metering, integration infrastructure, blockchain evidence anchoring.

Tenancy: every authenticated request carries `organization_id`, resolved server-side —
**EXISTS today** via `requireAuth.ts`. See Section 02.

## 02. Authentication & Authorization

**EXISTS today, reused unchanged.** `server/middleware/requireAuth.ts` verifies the
caller's Supabase JWT against `/auth/v1/user`, resolves `organization_id` from `profiles`
using the caller's own token (RLS-respecting), fails closed on every error path, and
emits a `denied` audit event on every rejection. Runtime-verified this sprint: an
unauthenticated `curl` to a protected route returns `401 {"error":"unauthenticated",...}`.

This contract does not define a new auth mechanism. Cross-system (VyaparSethu →
Bell24h-OS) service-to-service authentication does not exist today and is not designed
here — see Section 26 Stop Condition A.

Authorization: no RBAC exists server-side today (`role: 'ADMIN'` is hardcoded client-side
— `bell24h-verify` skill's known-violations table, re-confirmed unchanged). Authorization
beyond "authenticated + belongs to organization X" is TARGET.

## 03. Bell24h-OS SDK Surface

Conceptual capability surface (per the mission brief). **Do not implement functionality
that does not exist merely to make this list look complete** — status marked per group.

| Group | Operations | Status |
|---|---|---|
| AI | generate, extract, classify, embed, rerank, summarize, transcribe, translate | VERIFIED (generate/extract-ish only, via `ProviderRouter.generateText`/`generateJson`, Gemini-only); rest TARGET |
| Communication | send, template, notify, broadcast, delivery status | TARGET (none exist in this repo) |
| Media | create, render, transcode, thumbnail, asset management, status | TARGET (unconfirmed working pipeline — see current-state doc, marked UNKNOWN there) |
| Identity | authenticate, authorize, tenant context, user context | VERIFIED (authenticate + tenant context, via `requireAuth.ts`); authorize (real RBAC) TARGET |
| Agents | create/request, execute, approve, status, result | TARGET (none exist) |
| Policy | authorize action, risk classification, approval requirement | TARGET (only auth pass/fail + rate limiting exist, not a policy engine) |
| Workflow | create job, execute job, status, retry, cancel | VERIFIED-but-broken (`job_queue` + `JobOrchestratorService` exist; `JobWorker` disabled — see current-state doc) |
| Audit | record action, query audit trail | VERIFIED (record only — `emitAuditEvent`; no query/read API exists) |
| Evidence | create evidence, hash, verify, anchor | TARGET (none exist) |
| Provider | capability discovery, health, execution, usage, cost | PARTIAL (execution + usage exist for AI only, via `ProviderRouter`; discovery/health TARGET) |
| Storage | upload, retrieve, reference, metadata | INFERRED (Supabase Storage referenced in docs, not independently re-verified) |
| Observability | request ID, correlation ID, metrics, traces, logs | PARTIAL (request ID P0-implemented this sprint — Section 05; metrics/traces TARGET) |

## 04. VyaparSethu Domain Boundary

VyaparSethu remains authoritative for: Buyer, Supplier, RFQ, Matching, Quote, Trust/KYB
business rules, Trade Chat semantics, Negotiation, Deal, Payment business rules, Escrow
business rules, Logistics, Marketplace, Supplier discovery, Trade intelligence.

**Bell24h-OS must not absorb these business rules.** This is a declared boundary from the
mission brief, not an open question — it directly resolves what an earlier draft of this
document incorrectly treated as an unresolved "stop condition" (RFQ/marketplace schema
ownership). Correction: Bell24h-OS's own dormant RFQ/marketplace table group
(`supabase_schema.sql`, noted in OODA-01) is **not** authoritative and is not the target
for this contract — VyaparSethu's business schema is. Whether Bell24h-OS's dormant tables
should be removed, repurposed, or left alone is a separate, smaller decision, not an
architectural ambiguity; it is not resolved by this sprint either (no schema change made).

VyaparSethu must not embed provider-specific implementation (e.g. `spur.sendWhatsApp()`,
`openai.chat()`, `gemini.generate()`, direct provider credentials). Instead:
`VyaparSethu → Bell24h-OS capability API/SDK → provider adapter`.

## 05. Request/Response Contracts

**Request ID / correlation ID — PARTIALLY EXISTS, extended P0 this sprint.**

Today: `newRequestId()` (`server/audit.ts`) generates a fresh ID on every request inside
`requireAuth`, used both as the audit correlation key and the ID returned in error
responses.

**P0 change implemented this sprint** (`server/lib/requestContext.ts`): the ID-resolution
step now accepts an inbound `X-Request-Id` header and uses it verbatim if present and
well-formed (`^[A-Za-z0-9_.-]{1,128}$`); otherwise it generates one as before via the
existing `newRequestId()` — wrapped, not duplicated. The resolved ID is echoed back on the
response via the same header. `requireAuth.ts` was updated to call this wrapper instead of
`newRequestId()` directly (one-line change) — runtime-verified this sprint: an inbound
`X-Request-Id: trace-abc-999` is echoed back verbatim even on a 401 denial.

Response envelope for new `/api/v1` routes: see Section 15 (Error Contract) for the error
shape; success responses are route-specific JSON, no canonical success envelope is
mandated by the brief.

## 06. Async Job Contract

**TARGET design, referencing an existing but broken implementation.** Canonical lifecycle
(conceptual, not yet implemented as a formal state machine): `REQUESTED → QUEUED →
RUNNING → COMPLETED / FAILED / RETRYING / CANCELLED`. Each job should conceptually carry:
`job_id, tenant_id, correlation_id, idempotency_key, provider, created_at, started_at,
completed_at, status, error, result_reference`.

Current reality: `job_queue` (Supabase table) + `JobOrchestratorService` + `JobWorker`
exist in code but `JobWorker` is disabled (`src/main.tsx:7-9`, commented out,
re-confirmed this turn) and the schema is missing a `created_by` column the code already
references (`JobWorker.ts:43`). Two draft migrations from BR-02 remain unapplied. Per the
brief's rule ("only implement fields that fit the current database/schema without
destructive migration"), no schema change was made this sprint — that decision belongs to
the founder, not this sprint.

## 07. Event Contract

**TARGET only.** No event bus exists; `emitAuditEvent` is a log emission with no
subscribers and no delivery guarantee. Canonical event names named by the brief, for
design continuity (none implemented):

`RFQ_CREATED`, `QUOTE_RECEIVED`, `QUOTE_UPDATED`, `SUPPLIER_INVITED`, `MESSAGE_SENT`,
`MESSAGE_DELIVERED`, `MESSAGE_FAILED`, `MEDIA_JOB_CREATED`, `MEDIA_COMPLETED`,
`MEDIA_FAILED`, `AGENT_ACTION_REQUESTED`, `AGENT_ACTION_APPROVED`, `AGENT_ACTION_EXECUTED`,
`PAYMENT_STATUS_CHANGED`, `EVIDENCE_CREATED`, `EVIDENCE_ANCHORED`.

No existing production event differs from these names (none exist to differ from) — so
there is nothing to silently rename, and nothing was renamed.

## 08. Communication Contract

**TARGET only — high priority per the brief, zero implementation this sprint.**
Architecture: `VyaparSethu → Bell24h-OS Communication SDK → Communication Hub → Provider
Adapter → {Spur, Meta WhatsApp, MSG91, Email provider, future providers}`. VyaparSethu
requests a provider-agnostic capability; Bell24h-OS owns provider selection, credentials,
queue, retry, rate limiting, fallback, delivery status, webhook processing, provider
health, usage, cost, audit. No provider-specific communication code belongs in
VyaparSethu. Real WhatsApp/MSG91 integration exists only in the separate legacy repo
`digitex-erp/bell24h` (OODA-02) and is explicitly forbidden to extract this sprint.

## 09. Media Contract

**TARGET only.** No canonical Media SDK exists. Image/Video/Voice module names appear in
BR-02's test plan but no working generation pipeline was confirmed end-to-end (current-
state doc marks this UNKNOWN, not VERIFIED or TARGET, since absence wasn't confirmed
either). Would follow the same adapter shape as Communication (Section 08) and AI
(Section 10) once built — not designed further here to avoid inventing unverified detail.

## 10. AI Contract

**PARTIALLY EXISTS, unchanged this sprint.** Architecture already matches the brief's
target shape: `VyaparSethu → Bell24h-OS AI SDK → AI Provider Manager → provider/model
routing → external AI provider` — except there is no "Bell24h-OS AI SDK" layer yet callable
by an external caller like VyaparSethu; today `ProviderManager.ts`/`ProviderRouter.ts` are
internal-only (`server/ai/*`, never imported from `src/`, per the file's own header
comment). Bell24h-OS already owns, per the brief's list: provider selection (single
provider, Gemini), model routing (narrow), rate limits (per-org daily budget, in-memory),
logging/usage (via `emitAuditEvent`), credentials (`ProviderManager.getCredential()`).
Fallback and cost policies beyond the daily budget are TARGET. This sprint does not widen
the AI Contract (no new providers, no new modalities, no external-facing AI SDK route) —
that is explicitly P1+.

## 11. Agent Contract

**TARGET only.** No agent runtime exists in this repo. Canonical flow (design reference
only, not built): `Agent → Capability → Policy → Permission → Risk classification → Human
approval if required → Execution → Audit`. Five risk categories: Advisory, Reversible,
Financial, Contractual, Irreversible — no agent gets financial or contractual authority
merely because an API exists. Illustrative example from the brief (not implemented): a
Procurement Agent MAY prepare an RFQ, invite suppliers, request quotes, draft a
negotiation; it MUST NOT automatically accept a purchase order, release escrow, alter
contractual terms, or commit financial liability, unless explicit policy permits it.

## 12. Policy Contract

**TARGET only.** No general policy engine exists. The only policy-like enforcement today
is `requireAuth`'s fail-closed authentication check and `rateLimit.ts`'s per-organization
request cap — neither is a risk-classification or approval-requirement system as
described in Section 11's Agent flow.

## 13. Audit & Evidence Contract

**Audit EXISTS (partially); Evidence is TARGET.** Kept deliberately separate per the
brief: **Audit** answers "what happened?" — `server/audit.ts` provides structured,
non-durable (stdout-only, no `DATABASE_URL` configured) logging. **Evidence** answers
"what proves what happened?" — a distinct, stronger property nothing in this repo
provides. Canonical evidence flow (design reference, not built): `Trade event → Canonical
representation → Hash → Evidence record → Optional blockchain anchor`. Per the brief:
blockchain here means evidence anchoring only — explicitly **not** cryptocurrency, a
payment token, a customer wallet, a stablecoin, or a custody system. Real (non-
production-confirmed) blockchain code exists only in the legacy repo and is not imported.

## 14. Provider Adapter Contract

**EXISTS (AI-only); pattern documented for reuse, not duplicated.** Every external
provider should conform to a common conceptual adapter: capability discovery,
authentication, execute, status, webhook, retry, health, usage/cost. Mapped honestly:

| Adapter capability | Status |
|---|---|
| execute | EXISTING (AI/Gemini only — `GeminiProvider.ts` behind `ProviderManager`/`ProviderRouter`) |
| authentication (credential resolution) | EXISTING (AI only — `ProviderManager.getCredential()`) |
| usage/cost | EXISTING (AI only — in-memory per-org daily budget) |
| capability discovery | NOT IMPLEMENTED |
| status | NOT IMPLEMENTED |
| webhook | NOT IMPLEMENTED |
| retry | NOT IMPLEMENTED (no explicit retry logic found in `ProviderRouter.ts`) |
| health | NOT IMPLEMENTED |

No new adapter was written this sprint — the one AI example is cited, not duplicated, per
the brief's "do not build unnecessary adapters now."

## 15. Error Contract

**Canonical envelope defined P0 this sprint** (`server/lib/errors.ts`), per the brief's
exact field/code list — **used only for new `/api/v1` routes; `requireAuth.ts`'s existing
error handling is unchanged**, per "use existing project conventions where they already
exist, do not unnecessarily replace existing error handling."

Envelope: `error_code, message, request_id, correlation_id, retryable, details`.

Standard codes (all implemented in the `CanonicalErrorCode` union):
`AUTHENTICATION_FAILED`, `AUTHORIZATION_DENIED`, `TENANT_NOT_FOUND`, `VALIDATION_FAILED`,
`RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, `TIMEOUT`, `DUPLICATE_REQUEST`, `POLICY_DENIED`,
`HUMAN_APPROVAL_REQUIRED`, `RESOURCE_NOT_FOUND`, `INTERNAL_ERROR`.

`requireAuth.ts`'s own existing (unchanged) lowercase codes map conceptually as follows,
documented for future routes rather than applied retroactively: `unauthenticated` /
`invalid_token` → `AUTHENTICATION_FAILED`; `auth_unavailable` → `PROVIDER_UNAVAILABLE`;
`organization_unresolved` / `no_organization` → `TENANT_NOT_FOUND`.

**`correlation_id` note:** in this sprint's implementation, `correlation_id` always equals
`request_id` — there is no multi-hop call chain in this repo today (single Express
process; nothing downstream re-propagates the ID further), so a genuinely distinct
correlation value has no consumer yet. The envelope carries both fields, as specified, so
a future caller (e.g. VyaparSethu) can rely on the shape without a breaking change once
the two values do need to diverge.

## 16. Versioning & Compatibility

**Adopted P0 this sprint for new endpoints only; EXISTING routes untouched.** New
SDK-surface endpoints are namespaced `/api/v1/*`. `/api/v1/health` is the one concrete
endpoint added, demonstrating request-ID propagation (Section 05) and available for the
canonical error shape (Section 15) without expanding into any new capability domain. Every
pre-existing route (`/api/health`, `/api/check-table`, `/api/check-users-count`, all
`/api/vault/*`, dev-only `/api/env/diagnostic`/`/api/migrate`) stays exactly where it is —
the current SPA calls these as relative paths; moving them would break the running
frontend for no benefit.

Rules per the brief: additive changes are compatible within `v1`; breaking changes
require a new major version (`v2`); deprecated interfaces need a documented migration
period; SDK and API compatibility must be explicit. No deprecation-window policy is
defined this sprint (P1+, TARGET) — the only committed rule is that adopting this
contract never renames or moves an existing route.

## 17. Boundary Matrix

| Boundary | Bell24h-OS | VyaparSethu |
|---|---|---|
| Business domain logic (RFQ, Quote, Deal, Trust, Payments/Escrow *rules*, Logistics, Marketplace) | Must not absorb | Owns (Section 04) |
| SDK/API infra, AI runtime, Communication Hub, Media infra, Agent Runtime, Identity/RBAC infra, Workflow/Event/Audit/Evidence infra, provider adapters, Observability, cost metering | Owns | Must not embed provider-specific code (Section 04) |
| Provider credentials (AI, Communication, Media) | Owns, never crosses to browser or to VyaparSethu clients (Section 18) | Never holds |
| Authentication of end users | Owns (Supabase JWT, `requireAuth.ts`) | N/A — separate live system, own auth |
| Cross-system (service-to-service) authentication | Does not exist | Does not exist — Stop Condition A (Section 26) |

## 18. Security Model

Inherited unchanged from `SECURITY_BASELINE.md`, addressing each item the brief requires:

- **Tenant isolation:** `organization_id` always server-resolved, never client-supplied (`requireAuth.ts`).
- **Service authentication:** does not exist cross-system — Stop Condition A.
- **Authorization / RBAC:** does not exist server-side today (Section 02) — TARGET.
- **Policy enforcement:** narrow (auth + rate limit only) — TARGET beyond that (Section 12).
- **Credential isolation:** AI provider credentials never leave `server/ai/*` — re-verified this sprint (`git diff --stat` shows zero changes there).
- **Secrets / API keys / provider credentials:** never exposed to VyaparSethu clients or browser code — no new exposure introduced this sprint; the one new route (`/api/v1/health`) discloses no secret or configuration state.
- **Auditability:** `emitAuditEvent` on every `requireAuth` denial, unchanged.
- **Idempotency / replay protection:** not implemented anywhere in this repo — TARGET.
- **Rate limits:** exist (`rateLimit.ts`, per-org, in-memory, single-process only) — not extended to `/api/v1/*` beyond the demonstration route this sprint.
- **Request signing:** not implemented — TARGET, not required for the current single-hop system.
- **Sensitive data handling:** `audit.ts`'s own header comment already forbids secrets/tokens/prompts/raw user content in audit metadata — unchanged.

## 19. Implementation Status (P0 scope actually built this sprint)

Per the brief's Implementation Rule: identify what can be implemented safely now, what
already exists, what requires cross-repo changes or architectural approval — then
implement **only** the minimum safe foundation.

**P0 (this sprint, done):**
- Contract/documentation (this document + `BELL24H_OS_CURRENT_STATE.md`)
- Authentication boundary — reused unchanged (Section 02)
- Tenant context — reused unchanged (Section 02)
- Request/correlation IDs — extended (Section 05, `server/lib/requestContext.ts`)
- Standardized errors — new module for new routes only (Section 15, `server/lib/errors.ts`)
- API versioning — `/api/v1` namespace adopted, additive only (Section 16)
- Provider abstraction boundary — verified unchanged, not widened (Section 10, 14)

**P1 (not started, out of scope):** AI SDK abstraction (external-facing), Communication
SDK abstraction, Media SDK abstraction, Audit/Evidence interfaces (queryable audit trail,
evidence creation).

**P2 (not started, out of scope):** Agent/Policy SDK, Workflow/Event SDK, cost/metering
integration beyond the existing AI-only budget, advanced provider capabilities (discovery,
health, webhooks, retry).

**P3 (not started, out of scope):** future capabilities, undefined.

## 20. Migration Strategy

Not a schema migration plan — a sequencing note, matching Section 19's tiers. P0 is
complete. P1 would start with repairing the job queue (apply/verify the two BR-02
migrations) since Section 06's Async Job Contract depends on a working queue, and with
building a queryable audit-read API since Section 13 depends on more than write-only
logging. Neither was started this sprint — both require decisions (schema migration;
durable storage / `DATABASE_URL`) outside this sprint's authority.

## 21. Machine-Readable Contract

Not produced this sprint. The brief permits OpenAPI / JSON Schema / TypeScript interfaces
"if existing project conventions support it" and explicitly says not to introduce a new
specification technology unnecessarily. This repo has no existing OpenAPI/JSON-Schema
convention; the one new route (`/api/v1/health`) is trivial enough that a formal schema
would be premature ahead of any real P1 capability route. The `CanonicalErrorCode` /
`CanonicalErrorEnvelope` TypeScript types in `server/lib/errors.ts` are the one
machine-readable artifact produced, consistent with the repo's existing convention of
typing request/response shapes in TypeScript rather than a separate spec file.

## 22. Hackathon 6.0 Compatibility

The Hackathon 6.0 critical path (Verified Business → RFQ → AI Matching → Supplier → Quote
→ Trade Chat → Deal → Protected Transaction → Evidence/Trust) is **not touched** by this
sprint. No route, table, or module on that path was modified. The new route
(`/api/v1/health`) and the modified files (`server.ts`, `server/middleware/requireAuth.ts`
— both additive/wrapped, not replaced) are outside that path and outside VyaparSethu
entirely.

## 23. Boundary Matrix Cross-Reference

See Section 17.

## 24. Required Deliverables

1. `docs/architecture/BELL24H_OS_CURRENT_STATE.md` — done.
2. `docs/architecture/BELL24H_OS_VYAPARSETHU_SDK_API_CONTRACT_V1.md` — this document.
3. Minimal source files for the SDK/API foundation, since safe implementation was
   justified for the P0 subset only — `server/lib/requestContext.ts`,
   `server/lib/errors.ts`, plus the two small wiring changes in `server.ts` and
   `requireAuth.ts`.
4. Machine-readable contract — see Section 21 (TypeScript interfaces only, no new spec
   technology).

## 25. Final Engineering Report Cross-Reference

See `docs/architecture/BELL24H_OS_SDK_API_IMPLEMENTATION_REPORT.md` for the full A–R
report (executive summary, findings by evidence class, contract implemented/not
implemented, files changed, tests, build, security findings, contradictions,
cross-repository dependencies, VyaparSethu/Bell24h-OS follow-up changes, Hackathon
impact, recommended next step).

## 26. Stop Conditions Encountered

Per the mission brief's required FACT/CONFLICT/IMPACT/OPTIONS/RECOMMENDED-DECISION
format. One genuine stop condition was found this sprint (cross-system auth). The
RFQ/marketplace-ownership item that an earlier draft of this document raised as a second
stop condition was **not** actually ambiguous — Section 04 shows the brief already
resolves it (VyaparSethu owns it) — so it is recorded here as a corrected error, not
carried forward as an open item.

### Stop Condition A — Cross-system (VyaparSethu → Bell24h-OS) authentication

- **FACT:** `requireAuth.ts` verifies a Supabase end-user JWT. No service-to-service /
  app-to-app credential mechanism exists anywhere in this repo.
- **CONFLICT:** A real integration between the two systems (this contract's stated
  purpose) implies VyaparSethu could call Bell24h-OS directly. There is no authentication
  primitive for that today.
- **IMPACT:** Any concrete cross-system call path designed now would rest on a
  nonexistent mechanism.
- **OPTIONS:** (1) leave cross-system auth undesigned until a real integration is
  approved; (2) design a service-account/API-key mechanism speculatively now.
- **RECOMMENDED DECISION:** (1). This contract does not invent one; it is named as the
  primary remaining gap for a future sprint.

### Correction — RFQ/marketplace ownership (not a stop condition)

- **FACT (previously misstated):** An earlier draft of this document flagged
  RFQ/marketplace schema ownership between Bell24h-OS's dormant table group and
  VyaparSethu's live schema as unresolved, formatted as Stop Condition B.
- **CORRECTION:** The mission brief's own Section 08 (`VYAPARSETHU DOMAIN API BOUNDARY`,
  reproduced here as Section 04) explicitly assigns RFQ/Matching/Quote/Marketplace to
  VyaparSethu and instructs Bell24h-OS not to absorb them. This is a declared boundary,
  not an open architectural question — treating it as ambiguous was an error, caught only
  after re-checking the original brief text rather than relying on a compaction summary.
  Bell24h-OS's own dormant RFQ/marketplace tables remain unaddressed by this contract, but
  that is a smaller "what to do with unused legacy tables" question, not a boundary
  dispute.
