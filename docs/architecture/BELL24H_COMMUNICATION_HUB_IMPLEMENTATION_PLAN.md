# BELL24H COMMUNICATION HUB IMPLEMENTATION PLAN

> **Provider scope update (owner decision, 2026-09-28):** approved providers are Resend + SMTP (email), Meta WhatsApp Cloud API direct (WhatsApp), and MSG91 (SMS / OTP only). **Twilio and WhatsApp-via-MSG91 are removed from scope** and any reference below to them is superseded. Adapters, webhook routes and phases for those providers no longer apply. Spur and Gupshup/Exotel remain deferred.

**Repository:** `digitex-erp/digitex-erp-bell24h-os` (`HEAD = bd31707`)
**Phase:** Communication Hub Foundation Sprint — **planning and architecture only**
**Date:** 2026-09-14
**Scope discipline:** No code was written. No file was modified. No commit was made. No
package was installed. No database or architecture was changed. This document is the
deliverable in full.

---

## Anchor: this plan does not create new architecture

`docs/architecture/CANONICAL_ARCHITECTURE.md` is **FROZEN** (as of 2026-08-04, PS-02) and
binding on every subsequent implementation sprint. It already reserves the exact capability
this mission asks for, marked **FUTURE**, not yet built:

- **L2 — Platform Core Services** names `Notification` and the **Enterprise Integration
  Hub** explicitly, with WhatsApp listed as a named connector example
  (`MASTER_API_BOUNDARIES.md` L2 table; `ARCHITECTURE_DECISION_RECORDS.md` ADR-006).
- ADR-006 already decided the shape: **Connector / Binding / Credential**, three distinct
  scopes, Integration Hub as an **L2 core service**, credentials **envelope-encrypted,
  server-only, never client-readable** — stated pointedly against the one place the
  platform has already gotten this wrong (`ai_providers.api_key`, tenant-readable, no
  `REVOKE`).
- ADR-006 also already decided **AI providers are NOT Integration Hub connectors** — they
  stay in L4's Provider Manager. This plan does not touch that boundary.

**This plan fills the L2 Notification / Integration Hub slot that `CANONICAL_ARCHITECTURE.md`
already reserves as FUTURE. It does not add a layer, move a boundary, or revise ADR-006's
Connector/Binding/Credential separation.** Every component in Section 4 is named and scoped
to fit inside that existing, frozen decision — not to replace it.

---

## 1. Executive Summary

The user's stipulated certified findings (from the completed staging certification, this
session) are the starting baseline, not re-derived here:

**PASS:** Health APIs, Gemini, NVIDIA, authentication (`requireAuth`/`requireServiceAuth`),
Supabase, deployment.
**CONFIRMED ABSENT:** Communication Hub, WhatsApp/SMS/Email adapters, provider abstraction
layer, notification routing engine, orchestration workers, durable audit persistence.

Bell24h-OS has exactly one proven precedent for what this mission asks for: the
Gemini → NVIDIA provider pattern (`server/ai/ProviderManager.ts` +
`server/ai/ProviderRouter.ts`, gated by `requireServiceAuth`, credential-isolated,
audit-emitting, proven in production for NVIDIA on 2026-08-12 by an operator-performed
call). This plan is that same pattern, generalized from one provider family (AI) to
another (Communication) — not a new design philosophy.

The single largest gap is not any provider adapter — it is that **nothing in this
repository can dequeue anything.** `job_queue` (the closest existing analog) is
write-only; its worker is disabled and runs only in a browser tab
(`docs/project/RUNTIME_BASELINE_REPORT.md`). The deployed runtime is a Vercel serverless
function (`api/index.ts` → `server.ts`), which has no persistent process to run a worker
in. This is the load-bearing decision that Phase 1 must resolve — as **options**, not a
committed choice; see Section 2 and Section 12.

The second-largest gap is credential storage: ADR-006's full target (org-scoped,
envelope-encrypted, KMS-wrapped credentials) requires L0 secret infrastructure that does
not exist anywhere in this repository (`MASTER_MODULES.md` L0: "Secret access policy —
FUTURE — Needed for Integration Hub credentials"). This plan's MVP scope (Section 10)
deliberately does not build a credential vault nobody has authorized — it uses
platform-level credentials (one Bell24h-OS-owned account per provider), exactly as
`GEMINI_API_KEY`/`NVIDIA_API_KEY` are held today, and defers org-scoped bring-your-own
credentials to Phase 7.

## 2. Current State Assessment

### 2.1 Existing architecture map (as it runs today)

```
Browser (VyaparSethu — separate repository, not audited this session)
         │  (no live integration point exists yet)
         ▼
digitex-erp-bell24h-os.vercel.app
         │
    api/index.ts  (Vercel serverless handler)
         │  imports createApp() from server.js — same code, no separate backend
         ▼
    server.ts  (Express app)
    ├── GET  /api/health              (public)
    ├── GET  /api/v1/health           (public)
    ├── POST /api/v1/ai/text          (requireServiceAuth) ──▶ server/ai/ProviderRouter.ts
    │                                                          ├── GeminiProvider.ts  ──▶ Gemini API
    │                                                          └── NvidiaProvider.ts  ──▶ NVIDIA NIM API
    ├── GET  /api/env/diagnostic      (dev-only, 404 in prod)
    ├── GET  /api/check-table         (requireAuth) ──▶ pg.Pool ──▶ Supabase Postgres (pooled, RLS bypassed)
    ├── GET  /api/check-users-count   (requireAuth) ──▶ same
    ├── GET  /api/migrate             (dev-only, 404 in prod)
    └── /api/vault/*  (7 routes, requireAuth) ──▶ pg.Pool ──▶ Supabase Postgres (pooled, RLS bypassed)

Browser SPA (React/Vite, dist/) ──▶ supabase-js ──▶ Supabase Auth + REST (RLS-respecting)
                                 └─▶ src/modules/ai-providers/AiProviderService.ts (LEGACY,
                                     non-functional — api_key excluded from client query)
```

### 2.2 Existing services

| Service | Location | Real / functional? |
|---|---|---|
| `ProviderManager` (AI credential resolution) | `server/ai/ProviderManager.ts` | Yes — `process.env` only, fails closed |
| `ProviderRouter` (AI budget + audit wrapper) | `server/ai/ProviderRouter.ts` | Yes — in-memory per-org daily budget, `emitAuditEvent` per attempt |
| `GeminiProvider` / `NvidiaProvider` | `server/ai/*.ts` | Yes, both proven; NVIDIA has an operator production proof |
| `AgentService` | `src/modules/agents/AgentService.ts` | No — 8-line stub, `listAgents()` returns `[]` |
| `JobOrchestratorService` / `JobWorker` | `src/modules/job-orchestrator/*.ts` | No — browser-only, disabled at its one call site |
| `AutomationService` | `src/modules/automation/AutomationService.ts` | Partial — CRUD only; `triggerWorkflow()` is a simulation per its own comment |
| Communication Hub (any form) | — | **Does not exist.** |

### 2.3 Existing APIs

15 routes total on `server.ts` (full route table already produced in the staging
certification report, `docs/project/BELL24H_OS_STAGING_CERTIFICATION_REPORT.md`). Relevant
conventions this plan must reuse rather than reinvent:

- **Namespace:** new capability routes live under `/api/v1/*`; existing routes are never
  moved (`BELL24H_OS_VYAPARSETHU_SDK_API_CONTRACT_V1.md` §16).
- **Error envelope:** `server/lib/errors.ts` — `{error_code, message, request_id,
  correlation_id, retryable, details}`, canonical codes already defined
  (`AUTHENTICATION_FAILED`, `VALIDATION_FAILED`, `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`,
  etc.). New Communication Hub routes should emit this envelope, not invent a new one.
- **Request/correlation ID:** `server/lib/requestContext.ts` — accepts inbound
  `X-Request-Id`, echoes it back; reuse verbatim.

### 2.4 Existing authentication model

- **End-user (browser → Bell24h-OS):** `requireAuth.ts` — Supabase JWT, resolves
  `organization_id` server-side from the caller's own token (RLS-respecting), fails
  closed on every branch.
- **Service-to-service (VyaparSethu → Bell24h-OS):** `requireServiceAuth.ts` — single
  shared secret (`BELL24H_VYAPARSETHU_SERVICE_TOKEN`), constant-time comparison, fixed
  caller identity `"vyaparsethu"`, no tenant mapping, no scopes. **This is the mechanism
  a Communication Hub API would sit behind** for VyaparSethu calls — it already exists
  and is confirmed configured in production (live-verified in the staging certification:
  a bogus token returns `401 Service credential rejected`, not `503 not configured`).
- **Authorization (RBAC):** does not exist server-side. `hasPermission`/`checkRole`/
  `authorize` → 0 hits repo-wide (`MASTER_API_BOUNDARIES.md` L1). This blocks any
  admin-only Communication Hub endpoint (provider config, template approval) from having
  real authorization beyond "is this the one recognized service caller."

### 2.5 Existing database usage

- **Supabase Postgres**, two access paths: RLS-respecting `supabase-js` (browser, via the
  caller's JWT) and a pooled `DATABASE_URL` connection (`server.ts`'s `getPool()`) that
  **bypasses RLS** — used by all 9 existing `/api/check-*` and `/api/vault/*` handlers.
  New Communication Hub tables/routes must not repeat this pattern for tenant data.
- **Prisma** — declared dependency, zero code references anywhere.
- **RLS convention:** every tenant-owned table in `supabase_schema.sql` follows the same
  shape — `organization_id UUID REFERENCES public.organizations(id)`, RLS enabled, four
  `CREATE POLICY "Org isolation {select,insert,update,delete}" ... USING/WITH CHECK
  (organization_id = public.get_current_org_id())` statements. Section 5 below follows
  this convention exactly.
- **A `notifications` table already exists** (`supabase_schema.sql:323`) — `user_id`,
  `title`, `message`, `is_read`. **This is an in-app notification-bell table, not a
  message-delivery table.** It must not be reused or conflated with the Communication
  Hub's outbound delivery tables (Section 5) — doing so would repeat the
  `image_*`/`video_*` duplicate-table anti-pattern this repository has already been
  flagged for (`MASTER_API_BOUNDARIES.md` L5).

### 2.6 Existing AI integrations

Gemini and NVIDIA, both server-side, both real (Section 2.2). This matters to the
Communication Hub plan only as **the pattern to copy** (Section 3) — the Communication
Hub must not route through the AI Provider Manager, and the AI Provider Manager must not
gain communication responsibilities (ADR-006's explicit boundary).

### 2.7 Existing deployment model

Vercel serverless. `vercel.json` rewrites all `/api/*` to a single serverless function
(`api/index.ts`) that imports and invokes the same `createApp()` Express app used by
traditional hosting (`npm run dev`, `node dist/server.cjs`). **This means every request is
a fresh or warm-reused function invocation with no guaranteed persistent process between
requests.** In-memory state declared inside `createApp()` (the AI budget `Map` in
`ProviderRouter.ts`, the rate-limit windows `Map` in `rateLimit.ts`) is **not reliable
across invocations in production** — a cold start resets it, and concurrent warm instances
each hold their own copy. This is a pre-existing, inherited limitation, not something this
plan introduces — but it directly determines what the Communication Hub can safely rely on
in-memory versus what it must persist to Postgres (Section 8, Section 12 Phase 1).

## 3. Gap Analysis

Per the certified findings (stipulated), everything below is confirmed absent. Severity
reflects how much of the target architecture is blocked by each gap.

| Gap | Severity | Why |
|---|---|---|
| **No process anywhere can dequeue work.** Vercel serverless has no persistent process; `JobWorker` (the only precedent) is browser-only and disabled. | **CRITICAL** | Every downstream component (dispatch, retry, webhook processing) needs *something* running continuously or on a schedule. Nothing today satisfies that outside a request/response cycle. |
| **No durable, atomic job/queue claim exists.** `job_queue`'s only consumer used a plain `SELECT`, not `FOR UPDATE SKIP LOCKED` — a correctness gap, not just an absence. | **CRITICAL** | A retry/dispatch queue with concurrent workers (even two Vercel Cron invocations overlapping) would double-process without this. |
| **No provider abstraction/adapter layer for communication exists.** | **CRITICAL** | This is the mission's core ask; zero code exists (`server/`, `src/`, `api/` all searched, zero hits for whatsapp/msg91/twilio/spur/sendgrid/nodemailer/resend). |
| **No webhook signature verification pattern exists anywhere in the repo.** | **CRITICAL** | Every provider (Meta, MSG91) requires verifying an inbound signature before trusting a webhook body; there is no existing convention to extend. |
| **No RBAC/`authorize()` primitive exists.** | **HIGH** | Blocks admin-scoped endpoints (`/providers`, `/providers/test`, template approval) from having real authorization; today "authenticated" and "authorized" are the same check. |
| **No durable audit persistence exists.** `server/audit.ts` is stdout-only by its own header comment. | **HIGH** | SECURITY_BASELINE.md requires durable audit coverage for "provider changes" and "administrative actions" — both apply directly to a Communication Hub. |
| **No event bus/outbox exists.** | **HIGH** | ADR-006 states inbound webhooks should convert to domain events, not invoke business logic directly. Without an event bus, webhook processing must call the delivery-update logic directly for now — an accepted MVP simplification, not the frozen target shape. |
| **Pooled `DATABASE_URL` bypasses RLS in 9 existing handlers.** | **HIGH** | A precedent the Communication Hub must explicitly avoid repeating for its own tenant-scoped tables (`message_templates`, `message_requests`). |
| **No secret/KMS infrastructure (L0) exists** for envelope-encrypted, org-scoped credentials. | **HIGH** (blocks Phase 7 only) | ADR-006's full target needs this; MVP does not, by design (Section 10). |
| **No idempotency-key enforcement pattern exists anywhere in the repo**, despite being a stated rule (`MASTER_API_BOUNDARIES.md`: "jobs must be idempotent on `(organizationId, idempotencyKey)`"). | **MEDIUM** | Needed for `POST /api/v1/notifications/send` to be safely retryable by a caller (VyaparSethu) without double-sending a WhatsApp message. |
| **Rate limiting is in-memory, per-process** — and per Section 2.7, unreliable on serverless. | **MEDIUM** | A send-rate limiter for external providers (who have their own rate limits, e.g. WhatsApp) needs to be durable, not a `Map` that resets on cold start. |
| **No observability/metrics endpoint exists anywhere.** | **MEDIUM** | Delivery-rate, failure-rate, and queue-depth visibility are normal operational requirements for a communication system. |
| **No template-approval workflow tracking exists.** | **LOW** | Meta WhatsApp templates require provider-side approval; nothing in this repo models "pending provider approval" as a state today. |
| **No provider health-check/discovery mechanism exists**, even for the two working AI providers (`MASTER_API_BOUNDARIES.md` L4: "capability discovery... NOT IMPLEMENTED"). | **LOW** | Nice-to-have for MVP; matters more once multiple communication providers compete for the same channel (Phase 5). |

## 4. Communication Hub Architecture

Positioned inside L2 (Notification / Integration Hub, per the Anchor section). Each
component below is scoped to fit ADR-006's Connector/Binding/Credential separation and
the existing `ProviderManager`/`ProviderRouter` pattern — not a new design.

| Component | Responsibility | Existing precedent it extends |
|---|---|---|
| **Notification Service** | The single entry point capability (`send`, `bulk-send`, `status`) that a caller (VyaparSethu, or an internal Bell24h-OS module) calls. Resolves channel + template, validates the request, writes `message_requests`, hands off to the Message Routing Layer. Never talks to a provider directly. | `ProviderRouter.generateText()` — a thin, auditable front door in front of provider execution. |
| **Message Routing Layer** | Given a `message_requests` row, decides *which* provider handles it (single-provider-per-channel for MVP; capability/health/priority-based selection once the Provider Registry has more than one option per channel). Owns no provider SDK itself. | The `provider` field switch in `/api/v1/ai/text` (Gemini vs. NVIDIA) — the same shape, generalized. |
| **Provider Adapter Layer** | One adapter per provider (`MetaWhatsAppAdapter`, `Msg91Adapter`, `SpurAdapter`, `EmailAdapter`, `SmsAdapter`), each implementing one shared interface (Section 8). Holds no business logic — only "how to talk to this provider." | `GeminiProvider.ts` / `NvidiaProvider.ts` — same shape (`generateText(req)` → `execute(message)`). |
| **Provider Registry** | The catalog of what providers exist, their channel type, capability flags, and configuration status (never credential values) — the "Connector" half of ADR-006's three-part separation. Backs `GET /api/v1/providers`. | No direct precedent; new, but data-only — mirrors `ai_providers` *minus* the `api_key` column mistake. |
| **Delivery Tracking Layer** | Owns `message_deliveries` / `message_events` — the current-status and full-timeline views of every send attempt, populated by both the dispatch path (outbound) and the webhook path (inbound provider confirmations). | No precedent; net-new, but modeled directly on the `job_queue`/`job_logs` split already in the schema. |
| **Retry Layer** | Owns `retry_queue`, using an atomic claim (`FOR UPDATE SKIP LOCKED`) that the existing `job_queue`/`JobWorker` pattern lacks — this is a **correction**, not a repetition, of that gap. Exponential backoff, bounded `max_attempts`, per `AI_ROUTER_POLICY.md`'s existing retry principle ("retry only transient failures with bounded exponential backoff and idempotency"). | `AI_ROUTER_POLICY.md`'s retry/circuit-breaker policy (currently normative-only, not implemented even for AI) — the Communication Hub would be the first place either system actually implements it. |
| **Template Management Layer** | Owns `message_templates` — org-scoped content, provider-approval state tracking (Meta requires pre-approved templates), variable substitution. | No precedent; net-new. |
| **Webhook Processing Layer** | Verifies inbound provider signatures, writes raw payloads to `webhook_events` before any interpretation (audit-safe capture), then maps verified events to `message_events` / updates `message_deliveries`. | No precedent — this is the first webhook-handling code in the repository. |
| **Audit Layer** | Emits `communication_audit` events for every send, credential check, provider-config change, and webhook receipt, using the exact event shape `server/audit.ts` already defines (`actor, organizationId, action, targetType, targetId, outcome, requestId, metadata`). Durable persistence is the one open dependency (Section 3, Section 12) — until it lands, this layer degrades to the existing stdout-only behavior, explicitly, not silently. | `server/audit.ts` — reused verbatim, not reinvented. |

### 4.1 Provider Adapter Design — shared contract

Every adapter (`MetaWhatsAppAdapter`, `Msg91Adapter`, `SpurAdapter`,
`EmailAdapter`, `SmsAdapter`) implements the same conceptual interface, matching the
shape `GeminiProvider.ts`/`NvidiaProvider.ts` already establish for AI:

- `send(message): Promise<ProviderSendResult>` — the one required method. Takes a
  normalized message (recipient, rendered body, channel-specific metadata), returns a
  normalized result (`provider_message_id`, `status`, `latency_ms`) or throws a typed
  error.
- `verifyWebhookSignature(headers, rawBody): boolean` — required for any provider that
  sends webhooks (Meta, MSG91); a no-op returning `true` for providers that don't
  (some SMS/email providers only offer polling).
- `checkHealth(): Promise<boolean>` — optional for MVP (Section 3 rates this LOW), useful
  once the Provider Registry supports failover.

### 4.2 Provider-specific concerns

| Provider | Channel | Notable adapter-specific behavior |
|---|---|---|
| Meta WhatsApp Cloud API | WhatsApp | Requires pre-approved templates for business-initiated conversations; 24-hour session window for free-form replies; webhook signature via `X-Hub-Signature-256`. |
| MSG91 | SMS / OTP only | WhatsApp via MSG91 is removed (WhatsApp goes direct via Meta Cloud API). Retained for SMS/OTP; template/DLT registration requirements specific to Indian SMS regulation. |
| Spur | WhatsApp (commerce-focused) | Named in the target architecture with no further detail available from this repository or session — its API shape is unverified; Phase 5 scoping should not assume feature parity with Meta until confirmed. |
| Email (provider unspecified — `.env.example` lists `RESEND_API_KEY`, unused by any code) | Email | Lowest regulatory friction of the six; no template pre-approval requirement typical of WhatsApp. |
| SMS (provider unspecified — MSG91 covers this channel) | SMS | May not need a *seventh* adapter if MSG91 already covers plain SMS — worth resolving as a Phase 5 scoping question rather than building a redundant adapter. |

### 4.3 Error handling

Reuse the canonical error codes already defined in `server/lib/errors.ts` rather than
inventing communication-specific ones: `PROVIDER_UNAVAILABLE` (credential missing/invalid,
provider outage), `VALIDATION_FAILED` (malformed recipient, missing template variable),
`RATE_LIMITED` (provider or Bell24h-OS budget exceeded), `TIMEOUT`. Every adapter failure
must be caught and normalized to one of these before reaching the Notification Service —
never a raw provider SDK error surfaced to the caller (the same rule
`MASTER_API_BOUNDARIES.md` already states: "Errors are typed and safe — a stable code,
never a raw driver message").

### 4.4 Retry strategy

Bounded exponential backoff, per `AI_ROUTER_POLICY.md`'s existing (currently
unimplemented-even-for-AI) principle: retry only transient failures
(`PROVIDER_UNAVAILABLE`, `TIMEOUT`); never retry `VALIDATION_FAILED` (the message itself
is wrong, retrying won't fix it) or an explicit provider rejection (e.g., invalid phone
number). `retry_queue.max_attempts` bounds total retries per delivery.

### 4.5 Rate limiting strategy

Two independent limits apply: (a) Bell24h-OS's own per-organization send budget
(the same shape as `ProviderRouter.ts`'s AI daily budget, but **must be Postgres-backed,
not in-memory**, per the serverless statelessness finding in Section 2.7); (b) each
provider's own rate limit (e.g., WhatsApp's messaging-tier limits), which the adapter
layer should surface as a distinct `RATE_LIMITED` cause so the Retry Layer can back off
appropriately rather than treating it identically to a Bell24h-OS-side budget rejection.

## 5. Folder Structure

Proposed, mirroring `server/ai/*`'s existing shape (`server/` = server-only, never
imported from `src/`):

```
server/
  communication/
    adapters/          # One file per provider: metaWhatsApp.ts, msg91.ts,
                        # spur.ts, email.ts, sms.ts — each implements the shared
                        # ProviderAdapter interface (Section 8). Holds provider-specific
                        # request/response shaping only, never business logic.
    providers/          # ProviderManager.ts (credential resolution, mirrors
                        # server/ai/ProviderManager.ts exactly) + ProviderRegistry.ts
                        # (catalog/health/capability metadata, backs GET /api/v1/providers).
    routing/             # MessageRouter.ts — resolves channel+request to a chosen
                        # provider/adapter; the Communication analog of ProviderRouter.ts.
    templates/           # TemplateService.ts — CRUD + variable rendering + provider
                        # approval-state tracking for message_templates.
    workers/             # DispatchWorker.ts, RetryWorker.ts, WebhookWorker.ts,
                        # DeliverySyncWorker.ts — see Section 7. Entry points only;
                        # actual scheduling/hosting mechanism is a Phase 1 decision
                        # (Section 12), not fixed by this folder layout.
    webhooks/             # One handler per provider: metaWebhook.ts, msg91Webhook.ts,
                        # webhook_events, before any interpretation.
    audit/                # CommunicationAudit.ts — thin wrapper around the existing
                        # emitAuditEvent(), scoping the `action` namespace to
                        # `communication.*` (send, credential.check, provider.config,
                        # webhook.received) rather than a parallel audit system.
    notifications/       # NotificationService.ts — the single public entry point
                        # (send/bulk-send/status), the only module other server code or
                        # a future SDK should import from this tree.
    sdk/                  # Typed request/response interfaces shared between
                        # notifications/, routing/, and adapters/ — no runtime logic,
                        # matching server/lib/errors.ts's existing "types only, no new
                        # spec technology" convention.
  api/                   # Not a new top-level folder — the existing /api/v1/* route
                        # registrations in server.ts call into
                        # server/communication/notifications/*, exactly as
                        # /api/v1/ai/text calls into server/ai/ProviderRouter.ts today.
                        # No parallel routing layer is introduced.
```

**Why this shape:** every folder maps 1:1 to a component in Section 4, and the pattern
(`providers/` for credential resolution, a router module, provider-specific adapter
files, an `sdk/`-style types-only folder) is the same shape `server/ai/*` already uses —
this plan proposes replicating a proven internal convention, not introducing a new one.
`src/` gains nothing — per ADR-006 and the L4 credential rule this pattern already
enforces for AI, no communication provider SDK or credential may ever be reachable from
browser code.

## 6. Database Design

All tables follow the existing schema convention exactly: `UUID PRIMARY KEY DEFAULT
uuid_generate_v4()`, `organization_id UUID REFERENCES public.organizations(id)` on every
tenant-owned table, `TIMESTAMPTZ DEFAULT NOW()` timestamps, RLS enabled with the four
standard `"Org isolation {select,insert,update,delete}"` policies using
`public.get_current_org_id()`. Platform-level (non-tenant) tables are noted explicitly.

| Table | Purpose | Primary key | Important fields | Relationships | Tenant-scoped? |
|---|---|---|---|---|---|
| **communication_providers** | Provider Registry — the "Connector" half of ADR-006: which providers exist, their channel and capabilities. Platform asset, not per-org. | `id` | `provider_key` (unique, e.g. `meta_whatsapp`), `channel_type` (`whatsapp`\|`sms`\|`email`), `capability_flags` (jsonb), `status`, `health_last_checked_at` | Referenced by `message_requests.provider_id`, `message_templates.provider_id`, `provider_credentials.provider_id` | **No** — platform-level |
| **provider_credentials** | Metadata about a configured credential — **never the secret value itself** (see Section 9). The "Credential" half of ADR-006, MVP-scoped to platform-level per Section 10. | `id` | `provider_id` (FK), `environment`, `credential_ref` (name of the env var/secret-manager key, not the value), `status` (`configured`\|`missing`\|`invalid`), `last_verified_at`, `rotated_at` | FK → `communication_providers` | **No** — platform-level for MVP; org-scoping is Phase 7, blocked on L0 KMS |
| **message_templates** | Org-owned reusable outbound content, with provider-approval tracking (Meta requires pre-approved templates). | `id` | `organization_id`, `channel_type`, `provider_id` (FK, nullable for channel-generic templates), `template_key`, `body`, `variables` (jsonb), `provider_template_id` (nullable), `approval_status` (`draft`\|`pending_provider_approval`\|`approved`\|`rejected`), `created_by` | FK → `organizations`, `communication_providers`, `profiles` | **Yes** |
| **message_requests** | One row per logical send request (the caller's "intent") — the idempotency anchor. | `id` | `organization_id`, `caller_type` (`user`\|`service`), `caller_id`, `channel_type`, `template_id` (FK, nullable), `provider_id` (FK, resolved), `recipient` (PII — see Section 9 on handling), `idempotency_key` (unique per `organization_id`), `status` (`queued`\|`dispatching`\|`sent`\|`delivered`\|`failed`\|`cancelled`), `priority` | FK → `organizations`, `message_templates`, `communication_providers` | **Yes** |
| **message_deliveries** | One row per provider-level send attempt (1:N with `message_requests` — retries create additional rows). | `id` | `message_request_id` (FK), `attempt_number`, `provider_message_id` (external ID), `status`, `error_code`, `error_message`, `latency_ms`, `sent_at`, `delivered_at` | FK → `message_requests` | Inherits tenancy via `message_request_id` join — no direct `organization_id` needed if the RLS policy is expressed as an `EXISTS` subquery against `message_requests`, matching the existing `job_dependencies`/`job_logs` convention exactly |
| **message_events** | Append-only timeline of every state transition for a delivery — finer grain than `message_deliveries`' current-status columns; tolerant of out-of-order webhook delivery. | `id` | `message_delivery_id` (FK), `event_type` (`queued`\|`sent`\|`delivered`\|`read`\|`failed`\|`bounced`), `event_source` (`system`\|`webhook:meta`\|`webhook:msg91`\), `raw_payload` (jsonb, redacted), `occurred_at`, `received_at` | FK → `message_deliveries` | Inherits tenancy via join, same pattern as above |
| **notification_logs** | The read-optimized, queryable surface behind `GET /api/v1/notifications/status/:id`. **Recommended as a VIEW over `message_requests`/`message_deliveries`, not a physical table** — a duplicated, independently-written table here would repeat the `image_*`/`video_*` anti-pattern (`MASTER_API_BOUNDARIES.md` L5). If a physical, denormalized table is later needed for query performance, it must be populated only by the same write path as `message_requests`/`message_deliveries`, never written independently. | (view — no independent PK) | Projected: request id, status, channel, provider, last event, attempt count | Derived, not owned | Follows `message_requests`' tenancy |
| **communication_audit** | Durable audit trail for communication actions, once durable audit persistence exists (Section 3, Section 12). **If a general L1 durable audit sink is built first, this should be rows in that shared table filtered by an `action` prefix (`communication.*`), not a parallel audit system** — flagged as a sequencing dependency, not a design choice this plan is free to make unilaterally. | `id` | `actor` (nullable), `organization_id` (nullable — platform-level events have none), `action`, `target_type`, `target_id`, `outcome`, `request_id`, `metadata` (jsonb, secrets redacted) | Loosely coupled by `target_id`/`target_type` to `message_requests`, `provider_credentials`, etc. | Mixed — organization-scoped rows and platform-level rows coexist, same as `emitAuditEvent`'s existing shape allows (`organizationId: null` is already a valid call today) |
| **retry_queue** | Durable, atomically-claimable retry scheduling — the concurrency-safety property `job_queue`/`JobWorker` never had (`RUNTIME_BASELINE_REPORT.md`: "not addressed, currently moot ... becomes real the moment more than one consumer exists"). | `id` | `message_delivery_id` (FK), `organization_id`, `attempt_number`, `next_attempt_at`, `backoff_seconds`, `max_attempts`, `status` (`pending`\|`claimed`\|`exhausted`\|`resolved`), `claimed_by` (worker id, nullable), `claimed_at` | FK → `message_deliveries`, `organizations` | **Yes** |
| **webhook_events** | Raw inbound webhook capture, before any interpretation — audit-safe, replayable, and the idempotency anchor for provider event de-duplication. | `id` | `provider_id` (FK), `external_event_id`, `signature_valid`, `raw_headers` (jsonb, redacted), `raw_body` (jsonb), `processing_status` (`received`\|`verified`\|`processed`\|`rejected`\|`duplicate`), `received_at`, `processed_at` | FK → `communication_providers`; **unique `(provider_id, external_event_id)`** for idempotent processing | **No** — platform-level (a webhook arrives before any tenant is known; tenancy is resolved during processing via the matched `message_deliveries` row) |

## 7. API Design

All new routes live under `/api/v1/*`, use the canonical error envelope
(`server/lib/errors.ts`), and reuse `resolveRequestId()` for request/correlation IDs.
Send/status/provider-management routes are gated by `requireServiceAuth` (the existing
VyaparSethu S2S mechanism) since VyaparSethu — not a browser — is the intended caller,
per the mission's target architecture ("VyaparSethu should communicate only with
Bell24h-OS APIs/SDK"). Webhook routes are gated by provider-specific signature
verification instead, since an external provider cannot hold our service token.

| Route | Method | Auth | Request (key fields) | Response (key fields) | Notes |
|---|---|---|---|---|---|
| `/api/v1/notifications/send` | POST | `requireServiceAuth` | `channel`, `to`, `template_key` or `body`, `variables`, `idempotency_key` (required) | `{request_id, status, provider, requestId}` | Mirrors `/api/v1/ai/text`'s existing `provider` opt-in field shape for channel/provider selection. Idempotency: a repeated call with the same `(organizationId-equivalent-caller, idempotency_key)` must return the original `message_requests` row, not create a second one — the enforcement mechanism (unique constraint + upsert-or-fetch) is a Phase 1 implementation detail, not designed further here. |
| `/api/v1/notifications/bulk-send` | POST | `requireServiceAuth` | array of the single-send shape, each with its own `idempotency_key` | `{accepted: [...], rejected: [...]}` per-item | Partial failure is expected and must be representable — never all-or-nothing for a batch. |
| `/api/v1/notifications/status/:id` | GET | `requireServiceAuth` | — | Projection of `notification_logs` (Section 6): status, channel, provider, delivery attempts, last event | Read-only; no side effects. |
| `/api/v1/providers` | GET | `requireServiceAuth` (RBAC-gated once available — see gap in Section 3) | — | List of `communication_providers` rows + `status` from `provider_credentials` — **never `credential_ref` or any secret value** | |
| `/api/v1/providers/test` | POST | `requireServiceAuth` + admin-equivalent (blocked on RBAC gap; MVP may need to restrict this to `devOnly`-style environment gating until real RBAC exists) | `provider_id`, test payload | Result of a single test send, flagged `test: true` in `message_requests` so it never pollutes real delivery metrics | Explicitly a MVP-vs-target tension: without RBAC this route can only be as safe as `requireServiceAuth` alone makes it. |
| `/api/v1/templates` | POST | `requireAuth` (org-scoped content, browser-creatable, unlike sends) | `channel_type`, `body`, `variables` | Created `message_templates` row | Template *authoring* is naturally org-scoped end-user work (unlike sending, which is the VyaparSethu-facing SDK surface) — this is the one Communication Hub route that plausibly belongs behind `requireAuth`, not `requireServiceAuth`. |
| `/api/v1/templates` | GET | `requireAuth` | — | List of the caller's org's templates | |
| `/api/v1/webhooks/meta` | POST | Meta signature verification (`X-Hub-Signature-256`), not `requireAuth`/`requireServiceAuth` | Meta's webhook payload shape | `200` acknowledgment only | Must write to `webhook_events` **before** any interpretation, per Section 4's Webhook Processing Layer design — an unverifiable payload is still captured, then rejected. |
| `/api/v1/webhooks/msg91` | POST | MSG91's signature/shared-secret scheme | MSG91's webhook payload shape | `200` acknowledgment only | Same capture-first discipline. |

## 8. Worker Architecture

**The precondition every worker below depends on is a hosting decision this plan does
not make** (Section 2.7, Section 12 Phase 1): something must run continuously or on a
schedule outside the request/response cycle. Options, not a chosen path:

1. **Vercel Cron** invoking an internal, service-authenticated endpoint every N minutes —
   works within the current all-serverless deployment, but Vercel Cron's minimum
   interval and execution-time limits bound how "real-time" dispatch/retry can be.
2. **A separate always-on Node process** (a small worker host, outside Vercel) that polls
   Postgres directly — matches the "durable, atomic claim" requirement most directly, but
   introduces a second deployment target and failure domain, which `RUNTIME_BASELINE_REPORT.md`
   already flagged as "a real architectural addition" when the same question came up for
   the general job queue.
3. **An external managed queue** (e.g., a hosted queue/worker service) — removes the
   "what polls Postgres" question entirely but introduces a new vendor dependency.

| Worker | Responsibility | Execution flow |
|---|---|---|
| **Message Dispatch Worker** | Claims `queued` rows from `message_requests` (or a request-scoped in-line dispatch for the MVP synchronous path — see Section 10), resolves provider via the Message Routing Layer, calls the adapter, writes `message_deliveries` + `message_events`. | `claim → resolve provider → adapter.send() → record result → on failure, enqueue retry_queue row` |
| **Retry Worker** | Polls `retry_queue` where `next_attempt_at <= now()` and `status = 'pending'`, claims atomically (`FOR UPDATE SKIP LOCKED`), re-invokes the same adapter path, applies exponential backoff, marks `exhausted` after `max_attempts`. | `claim (locked) → re-attempt → success: mark resolved; failure: reschedule or exhaust` |
| **Webhook Processing Worker** | Drains `webhook_events` where `processing_status = 'received'` (if signature verification is deferred from the inline handler for latency reasons), verifies signature, maps to `message_events`, updates `message_deliveries.status`. Idempotent on `(provider_id, external_event_id)`. | `claim unverified event → verify → map to message_events → update delivery status → mark processed` |
| **Delivery Sync Worker** | Optional reconciliation: for deliveries stuck in `sent` beyond a threshold with no webhook received, polls the provider's own status API directly. Not all providers guarantee webhook delivery. | `select stale sent deliveries → query provider status API → reconcile` |
| **Audit Worker** | Only needed if durable audit writes are batched/async rather than synchronous; flushes buffered `communication_audit` rows. Optional simplification once a durable audit sink exists (Section 2). | `drain buffer → write batch → clear` |

## 9. Security Architecture

- **Authentication:** unchanged from Section 2.4 — `requireServiceAuth` for
  VyaparSethu-facing send/status/provider routes, `requireAuth` for org-scoped template
  authoring, provider-specific signature verification for inbound webhooks.
- **Authorization:** the RBAC gap (Section 3) is inherited, not solved here. Until an
  `authorize()` primitive exists, `/providers`, `/providers/test`, and template-approval
  actions can only be as scoped as "the one recognized service caller" — a real gap this
  plan does not paper over.
- **Service-to-service security:** reuse `requireServiceAuth` as-is for the first
  integration. If Communication Hub capabilities need finer-grained scoping than AI
  capabilities (e.g., a caller allowed to send but not manage providers), that requires
  extending `ServiceCallerContext` with a `scopes` field — a small, additive change to an
  existing file, not a new mechanism, and explicitly **not built by this plan**.
- **Secret management:** **MVP uses platform-level credentials only** — one Bell24h-OS-held
  account per provider, resolved server-side from `process.env` via a
  `provider_credentials`-adjacent `ProviderManager` exactly like `GEMINI_API_KEY`/
  `NVIDIA_API_KEY` today. `provider_credentials` (Section 6) stores *metadata about* a
  credential (which env var, its status, when last rotated) — **never the secret value**.
  This deliberately does not repeat the `ai_providers.api_key` mistake
  (SECURITY_BASELINE.md: "Never store provider keys in ordinary tenant-readable
  records").
- **Credential rotation:** tracked via `provider_credentials.rotated_at`, same manual
  checklist discipline already established for AI providers
  (`docs/project/GATE_C_CLOSURE_PACKAGE.md` Deliverable 4d) — no automated rotation
  mechanism exists or is proposed here.
- **Org-scoped (bring-your-own) provider credentials:** explicitly **out of MVP scope**
  (Section 10) — blocked on L0 envelope-encryption/KMS infrastructure that does not exist
  anywhere in this repository. Building a credential vault ahead of that infrastructure
  existing would be scope the mission did not ask for and this repo's own governance
  (`ARCHITECTURE_DECISIONS.md`: "Forbidden dependencies... Unreviewed destructive
  migrations" / general "do not build ahead of decision" ethic) counsels against.
- **Webhook validation:** mandatory signature verification per provider (Section 4.1, Section 8)
  before any payload is trusted; raw capture into `webhook_events` happens regardless of
  verification result, so a rejected/invalid webhook is still auditable.
- **Audit logging:** every send, credential check, provider-config change, and webhook
  receipt emits an event via the existing `emitAuditEvent()` shape, namespaced under
  `communication.*` actions. Durable persistence is inherited as an open dependency
  (Section 3), not solved by this plan.
- **Recipient / PII handling:** `message_requests.recipient` (a phone number or email
  address) is personal data. It must never appear in `communication_audit.metadata`
  (matching `server/audit.ts`'s existing header rule against secrets/prompts/raw user
  content in audit metadata) and should be masked in any operator-facing log line
  (e.g. last 4 digits only) — the same discipline `requireServiceAuth.ts` already applies
  to credential values, applied here to personal data instead.
- **Compliance considerations:** WhatsApp Business Platform policy (template approval,
  24-hour session window, opt-in requirements) and Indian SMS/DLT regulation (relevant to
  MSG91) both carry compliance obligations beyond this repository's technical scope —
  flagged for the operator's awareness, not resolved here.

## 10. MVP Scope

| Category | Items |
|---|---|
| **Must Have** | One working channel end-to-end (recommend WhatsApp via Meta, per the mission's own Phase 2 ordering) proven with the same discipline NVIDIA was proven (mock/local verification → operator-performed real production proof, no secret touched by any session); `message_requests`/`message_deliveries`/`message_events` tables; `POST /api/v1/notifications/send` behind `requireServiceAuth`; idempotency-key enforcement; a resolved hosting decision for "what dequeues" (Section 8) — even a minimal one; platform-level credential storage only; audit events emitted (durable persistence not required for MVP, explicitly noted as degraded). |
| **Should Have** | `GET /api/v1/notifications/status/:id`; `retry_queue` with atomic claim and bounded backoff; webhook processing for the one MVP channel, with signature verification and raw capture; `message_templates` for the one MVP channel. |
| **Nice to Have** | `GET /api/v1/providers` / provider health checks; `POST /api/v1/providers/test`; bulk-send; a Delivery Sync Worker (polling reconciliation) for providers without reliable webhooks. |
| **Out of Scope (this MVP)** | Every provider beyond the first (MSG91 SMS/OTP, Spur, Email — Phase 5); org-scoped bring-your-own credentials (Phase 7, blocked on L0 KMS); RBAC-gated admin endpoints (blocked on L1 `authorize()`); event-bus-based webhook-to-domain-event conversion (blocked on L2 event bus); multi-provider failover/health-based routing. |

## 11. VyaparSethu Migration Plan

**Current state:** VyaparSethu's own repository was **not audited this session** — it is
a separate repository (`bell24xcom/forBell24x` or equivalent, per the user's own
workstream map) and nothing about its current WhatsApp/SMS/email integration code can be
asserted here as verified fact. What *is* verified, from this repository's own documents:
VyaparSethu already has one working precedent for calling Bell24h-OS as a service —
the AI text-generation path (`requireServiceAuth`, proven in production for NVIDIA on
2026-08-12). That precedent is the template this migration should follow, not a fresh
design.

**Future state:** VyaparSethu calls `POST /api/v1/notifications/send` (and related
routes) instead of holding any provider SDK or credential directly — matching the
target architecture's stated flow (`VyaparSethu → Bell24h SDK/API → Communication Hub →
Provider Adapter Layer`).

**Migration strategy:** additive, channel-by-channel, following the same pattern already
proven for AI (Gemini first, NVIDIA added later as an opt-in `provider` field without
touching Gemini's default path). Whichever channel VyaparSethu currently has live (if
any — unverified this session) should keep working unmodified until its Bell24h-OS
equivalent is proven end-to-end, then cut over per-channel, not as a single big-bang
switch.

**Risk areas:**
- **Cannot assess dual-write or cutover risk concretely without auditing VyaparSethu's
  current integration code** — this is a named gap in this plan, not an oversight.
- Template parity: if VyaparSethu already has Meta-approved WhatsApp templates under its
  own account, migrating to Bell24h-OS-held platform-level credentials (Section 9) means
  either re-approving templates under Bell24h-OS's account or a more complex
  credential-migration step — a decision this plan flags but does not resolve.
- Any gap between VyaparSethu's current send volume and Bell24h-OS's new (initially
  unproven) provider budget/rate-limit configuration could cause dropped or throttled
  messages during cutover.

**Backward compatibility strategy:** a feature flag or per-channel routing switch on the
VyaparSethu side (outside this repository) that can send via the old path or the new
Bell24h-OS path — the specific mechanism belongs to VyaparSethu's own codebase and
cannot be designed from within this repository.

## 12. Production Roadmap

| Phase | Scope | Key dependency / open decision |
|---|---|---|
| **Phase 1 — Communication Hub Foundation** | `server/communication/*` skeleton (Section 5); Section 6 tables as an additive migration; `NotificationService` + `POST /api/v1/notifications/send` wired to a no-op/stub adapter first (proving the pipeline end-to-end, exactly as Gemini was proven before NVIDIA); durable, atomically-claimable `retry_queue`. | **Must resolve the hosting/dequeue question from Section 8 as a decision, not left implicit** — nothing in later phases can run without it. |
| **Phase 2 — Meta WhatsApp Adapter** | First real provider behind the Phase 1 interface, following the exact Gemini→NVIDIA proof discipline: mock/local verification, then an operator-performed real production proof call — no secret ever touched by a Claude Code session. | Meta Business/WhatsApp Cloud API account and credentials (operator-held, per Section 9's platform-level scoping). |
| **Phase 3 — Template Management** | `message_templates` CRUD; Meta template submission/approval-status tracking. | Depends on Phase 2's adapter existing to actually submit templates. |
| **Phase 4 — Delivery Tracking** | `webhook_events` + `message_events`; Meta webhook signature verification; `GET /api/v1/notifications/status/:id`; optional Delivery Sync Worker. | Requires a publicly reachable webhook URL and Meta webhook configuration (operator action). |
| **Phase 5 — Multi-Provider Support** | MSG91 (SMS/OTP), Spur, Email adapters, added the same additive way NVIDIA was added to Gemini. Resolve the "does SMS need its own adapter beyond MSG91" question (Section 9.2) before committing adapter-by-adapter scope. | Each provider needs its own operator-held account/credentials. |
| **Phase 6 — Orchestration Workers** | Full Retry Worker with backoff (Section 8); durable `communication_audit` once a durable audit sink exists; provider health checks feeding Message Routing Layer failover decisions. | Durable audit persistence is a cross-cutting L1 dependency, not owned by Communication Hub work alone. |
| **Phase 7 — Full Bell24h Communication Platform** | Org-scoped provider bindings/credentials (ADR-006's full Connector/Binding/Credential realization); RBAC-gated admin endpoints; event-bus-based webhook-to-domain-event conversion. | Explicitly blocked on three platform primitives outside Communication Hub's own scope: L0 secret/KMS infrastructure, L1 `authorize()`, L2 event bus. This phase cannot start by Communication Hub work alone. |

## 13. Risks

- **Hosting/worker decision deferred too long stalls everything downstream.** Every phase
  after Phase 1 assumes *something* dequeues reliably; if that decision (Section 8)
  isn't made early, Phase 2 onward has nothing to run against.
- **Serverless in-memory state is an easy, silent mistake to repeat.** `rateLimit.ts` and
  `ProviderRouter.ts`'s existing budget counter already have this bug; a Communication
  Hub built by copying that file's pattern verbatim (rather than the Postgres-backed
  correction this plan recommends) would inherit the same unreliability at production
  scale.
- **VyaparSethu's actual current integration state is unknown to this plan.** Section 11's
  migration risk assessment is necessarily incomplete until that repository is audited.
- **Provider-specific compliance obligations (WhatsApp Business Policy, Indian SMS/DLT
  rules) are outside this repository's technical control** and could block a phase's
  go-live independent of any code being ready.
- **RBAC and durable audit are both inherited, cross-cutting gaps.** Communication Hub
  work can proceed without them (MVP explicitly does), but Phase 7 cannot close without
  them, and neither is Communication Hub's own responsibility to build.
- **Spur's integration surface is unverified.** No API details were available from this
  repository or session; Phase 5 scoping for Spur specifically carries more uncertainty
  than the other five providers.

## 14. Recommendations

1. Treat Section 8's hosting/dequeue decision as the first thing to resolve — before any
   adapter code, before any table migration — because every other component assumes an
   answer to it.
2. Build Phase 1 and Phase 2 with the same proof discipline already established for
   NVIDIA (mock verification → operator-performed production proof, credentials never
   touched by a Claude Code session) — it is a proven, working pattern in this exact
   repository, not a new process to invent.
3. Resolve VyaparSethu's current integration state (Section 11) before finalizing a
   cutover strategy — that requires auditing the other repository, out of this session's
   scope.
4. Do not build org-scoped credential storage (Phase 7) ahead of L0 KMS infrastructure
   existing — doing so would either be insecure (storing real secrets without envelope
   encryption) or premature abstraction (building encryption infrastructure as a
   Communication Hub side-effect rather than its own platform decision).
5. When durable audit persistence is eventually built, build it once at L1 and let
   `communication_audit` be a filtered view of it — not a second, parallel audit table.

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GyjerP42mTVzzK2ZkSeRCf
