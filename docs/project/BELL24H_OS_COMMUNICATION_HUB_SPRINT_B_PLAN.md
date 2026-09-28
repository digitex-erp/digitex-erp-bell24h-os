# Bell24h-OS Communication Hub — Sprint B Implementation Plan

> **Provider scope update (owner decision, 2026-09-28):** approved providers are Resend + SMTP (email), Meta WhatsApp Cloud API direct (WhatsApp), and MSG91 (SMS / OTP only). **Twilio and WhatsApp-via-MSG91 are removed from scope** and any reference below to them is superseded.

**Status:** PLAN ONLY — nothing in this document has been built as part of writing it. Where a component already exists (built in the preceding "Foundation" pass on `feature/communication-hub`), this plan says so explicitly and does not re-propose it as future work.
**Governance status:** Communication Hub is still an **unratified** module boundary — see `ARCHITECTURE_DECISIONS.md`'s "Proposed module (unratified): Communication Hub" note. This plan does not change that. Section 9 below states exactly which parts of Sprint B require review-gate sign-off before implementation and why.
**Branch:** all Foundation work referenced here lives on `feature/communication-hub` (uncommitted).

## 0. Reconciliation — what Sprint B's 10 components map to

| # | Sprint B component | Status | Where |
|---|---|---|---|
| 1 | Notification Service | **Not built** — see §3.1, this is new scope, distinct from what exists | — |
| 2 | Email Adapter | **Built** (2 real providers: Resend, SMTP) | `server/communication/providers/ResendProvider.ts`, `SMTPProvider.ts` |
| 3 | WhatsApp Adapter | **Stub only** — `send()` throws by design | `server/communication/providers/StubProviders.ts` |
| 4 | SMS Adapter | **Stub only** (MSG91) — same | same file |
| 5 | Template Engine | **Minimal version built** — `{{var}}` substitution only, no conditionals/loops | `CommunicationService.resolveTemplateIfNeeded()` |
| 6 | Event Queue | **Built** — deliberately reused `job_queue`/`QueueManager`, no new queue | `server/queue/QueueManager.ts` (existing, unmodified) |
| 7 | Delivery Tracking | **Built** — per-attempt append-only log | `communication_deliveries` table |
| 8 | Retry Logic | **Built** — job_queue's own retry_count/max_retries + explicit `retryFailedMessage()` | `CommunicationJobHandler.markFailed()`, `CommunicationService.retryFailedMessage()` |
| 9 | Audit Logging | **Built** — every state transition calls `emitAuditEvent()` | throughout `CommunicationService`/`CommunicationJobHandler` |
| 10 | Admin Dashboard Integration | **Not built** | — |

Sprint B's real net-new work is narrower than the 10-item list suggests: **items 3, 4, 1, and 10**, plus hardening item 5. Items 2, 6, 7, 8, 9 are already production-shaped code, not proposals.

## 1. Database schema

**Already exists** (`add_communication_hub.sql`, Supabase-native PostgreSQL, per requirement): `communication_providers`, `communication_templates`, `communication_campaigns`, `communication_messages`, `communication_deliveries`, `communication_webhooks`. All have `id/organization_id/created_at/updated_at`; `communication_deliveries`/`communication_webhooks` are append-only (no UPDATE/DELETE RLS policy).

**New for Sprint B — proposed, not yet created:**

```sql
-- Maps a business event to a template + channel(s), so VyaparSethu can say
-- "notify about event X" without knowing which provider/template that resolves to.
CREATE TABLE IF NOT EXISTS public.notification_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    event_key TEXT NOT NULL,              -- e.g. 'rfq.quote_received', 'order.shipped'
    channel_type TEXT NOT NULL CHECK (channel_type IN ('email','sms','whatsapp','voice','push')),
    template_id UUID REFERENCES public.communication_templates(id),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- RLS: same org-isolation pattern as every other table in this module.
```

No other schema changes are needed for items 2–9 — they're built on the existing tables.

## 2. API endpoints

**Already built** (org-user-facing, `requireAuth`-gated, runtime-verified to 401 correctly when unauthenticated):

```
POST /api/communications/send
GET  /api/communications/templates
POST /api/communications/templates
GET  /api/communications/history
GET  /api/communications/status/:id
POST /api/communications/retry/:id
```

**New for Sprint B — the VyaparSethu-facing surface (§3.2 below):**

```
POST /api/v1/communications/notify     -- service-to-service, requireServiceAuth
POST /api/v1/webhooks/communications/:provider  -- inbound provider webhook receiver
```

## 3. Service architecture

### 3.1 Notification Service (new)

A thin layer **above** `CommunicationService`, not a replacement for it. `CommunicationService` is the low-level primitive ("send this exact message via this channel"); `NotificationService` is the business-event-facing entry point ("something happened, notify about it"):

```
NotificationService.notify(organizationId, eventKey, recipient, context)
    -> look up notification_rules WHERE event_key = eventKey AND is_active
    -> resolve the rule's template_id + channel_type
    -> CommunicationService.sendMessage({ organizationId, channelType, templateId, recipient, variables: context })
```

This is what "Do not implement provider-specific business logic in VyaparSethu" actually buys: VyaparSethu calls `notify("rfq.quote_received", ...)` and never knows or cares whether that resolves to email via Resend or WhatsApp via Meta — that mapping lives entirely in `notification_rules`, in Bell24h-OS.

### 3.2 VyaparSethu SDK/API exposure

**Reuse the existing OS-INTEGRATION pattern exactly** — this codebase already solved "a trusted external system calls Bell24h-OS without an end-user session" for AI (`/api/v1/ai/text`, gated by `requireServiceAuth`, not `requireAuth`). Communication Hub's VyaparSethu-facing route follows the same shape:

```typescript
app.post("/api/v1/communications/notify", requireServiceAuth, async (req, res) => {
  const { serviceCaller, requestId } = req as ServiceAuthedRequest;
  // organizationId here is NOT resolved from a user session (there is no user
  // session in this call path) — per OS_INTEGRATION_DECISION_RECORD_V1.md
  // Decisions A/B, it's a fixed identifier for "VyaparSethu as a system,"
  // exactly as /api/v1/ai/text already does. Do not invent a different
  // tenant-mapping mechanism here — reuse that decision, don't relitigate it.
  ...
});
```

This is the concrete mechanism behind "Expose SDK/API for VyaparSethu" — no new auth pattern needs inventing.

### 3.3 Provider adapters (WhatsApp, SMS)

**Already interface-conformant** (`ProviderAdapter`, via `StubProviders.ts`) — implementing them for real means writing `send()`/`status()`/`validate()`/`healthCheck()` bodies against Meta's WhatsApp Cloud API and MSG91's REST API, registering them in `ProviderFactory`, and nothing else changes (`CommunicationService`, `CommunicationJobHandler`, the API routes are all already provider-agnostic). This is genuinely low-risk to wire in *mechanically* — the risk is entirely in governance and credential-handling, covered in §9.

## 4. Folder structure

```
server/communication/
├── types.ts                          # existing — ProviderAdapter, message/template types
├── CommunicationService.ts           # existing
├── NotificationService.ts            # NEW — §3.1
└── providers/
    ├── ProviderFactory.ts            # existing
    ├── ResendProvider.ts             # existing, real
    ├── SMTPProvider.ts                # existing, real
    ├── StubProviders.ts               # existing — MSG91 stub (Meta WhatsApp has been a real, unverified adapter since CH-02)
    ├── WhatsAppCloudProvider.ts       # NEW — replaces the WhatsApp stub (§9 gate)
    ├── MSG91Provider.ts                # NEW — replaces the MSG91 stub (§9 gate)

server/workers/handlers/
└── CommunicationJobHandler.ts        # existing — no change needed for new providers

server/routes/  (or inline in server.ts, matching existing house convention)
└── (communications routes are currently inline in server.ts, matching /api/vault/* — §2)
```

## 5. Security model

- **No provider credential ever lives in a database column** — `communication_providers.credentials_secret_ref` is a secret *name*, resolved from `process.env` at call time by `ProviderFactory` (already built). This is the same rule `AiProviderService.ts`'s own header comment says was violated for AI provider keys — this module does not repeat that mistake, and Sprint B must not either.
- **RLS is row-level, never column-level** — the API layer must never project `credentials_secret_ref` in a response. All 6 existing routes already avoid this (they select specific columns or use `CommunicationService`, never `SELECT * FROM communication_providers` exposed raw to a client).
- **`organizationId` is always resolved server-side from a verified identity** — from `req.auth.organizationId` (end-user path) or a fixed system identifier (VyaparSethu service path) — never from request body input, in any route, existing or planned.
- **VyaparSethu authenticates as a system, not a tenant** — via `requireServiceAuth`, the same shared-secret-with-constant-time-comparison mechanism already built for AI. No new credential type needs inventing.

## 6. RLS policies

Already implemented and unchanged by Sprint B: org-isolation (`organization_id = public.get_current_org_id()`) on every existing table; append-only enforcement (no UPDATE/DELETE policy) on `communication_deliveries`/`communication_webhooks`. The new `notification_rules` table (§1) gets the identical 4-policy pattern (select/insert/update/delete, org-isolated) — no new RLS pattern is being introduced.

## 7. Migration scripts

- **Existing:** `add_communication_hub.sql` (not yet applied to any live database — this repo's migrations are applied manually per this project's own Runtime Verification workflow, not auto-run).
- **New for Sprint B:** one additional migration adding `notification_rules` (§1's SQL), following the same file-naming convention as the existing loose `add_*.sql` files in the repo root.
- **Neither has been run against a live database.** Per this session's established workflow, applying either is a manual step the project owner performs in the Supabase SQL Editor, not something done automatically.

## 8. Implementation phases

| Phase | Scope | Gate before starting |
|---|---|---|
| **B.1** | `notification_rules` migration + `NotificationService` (§3.1), built against the two already-real providers (Resend, SMTP) only | None — additive, no new provider risk |
| **B.2** | `/api/v1/communications/notify` service-to-service route (§3.2) | None — reuses an existing, already-ratified auth mechanism |
| **B.3** | Webhook receiver route + wiring `communication_webhooks` inserts for Resend's real webhook events (delivered/bounced/complained) | None — Resend is already a real, working provider |
| **B.4** | Real WhatsApp Cloud API provider | **Review-gate sign-off required first** — see §9 |
| **B.5** | Real MSG91 SMS/OTP provider | **Review-gate sign-off required first** — see §9 |
| **B.6** | Admin Dashboard Integration (item 10) | Depends on B.1–B.3 being real; needs its own design pass (no UI has been scoped anywhere in this module yet) |

## 9. Governance gate — read before starting B.4 or B.5

`ARCHITECTURE_DECISIONS.md` requires an Architecture Decision Record and review-gate approval for architecture changes; Communication Hub has neither yet. Two additional, more specific reasons B.4/B.5 need a checkpoint before code, not just architecture-in-general:

1. **WhatsApp Cloud API and MSG91 both require real, live third-party credentials.** Per `SECRET_ROTATION_CHECKLIST.md` (this session), no such credential currently exists in this project's environment. Someone has to obtain one before B.4/B.5 can produce *working* code rather than another well-typed stub.
2. **MSG91 specifically:** this repo's own `bell24h-verify` skill documents MSG91 phone-OTP auth as the signature of a *different, unrelated* Bell24h codebase. Before writing `MSG91Provider.ts` for real, confirm this project is actually meant to integrate MSG91 itself, rather than that association being a holdover from conflating the two projects' documentation (which has happened before in this session's own audits).

B.1–B.3 have no such blocker and can proceed once approved to start.
