# Communication Hub Implementation Report — Foundation

> **Provider scope update (owner decision, 2026-09-28):** approved providers are Resend + SMTP (email), Meta WhatsApp Cloud API direct (WhatsApp), and MSG91 (SMS / OTP only). **Twilio and WhatsApp-via-MSG91 are removed from scope** and any reference below to them is superseded. This report describes the foundation slice as first built; Sprint C0 (hardening) and CH-02 (campaigns / admin console) supersede parts of it.

**Branch:** `feature/communication-hub` (off `main`, uncommitted)
**Date:** 2026-09-28
**Verified:** `npm run lint` (tsc --noEmit) and `npm run build` both pass clean. The SMTP client (the highest-risk new code — hand-written protocol, not a library) was additionally driven against a local mock SMTP server and confirmed to complete a full EHLO → STARTTLS-capable → AUTH LOGIN → MAIL FROM → RCPT TO → DATA (with correct RFC 5321 dot-stuffing) → QUIT exchange, returning a real provider message ID. That test also caught and fixed a real bug (see "Bugs found and fixed" below) before it shipped.

## What "foundation and provider abstraction" means here, explicitly

The request's numbered objectives 4–5 ask for API endpoints and an admin UI; its closing line says "Only foundation and provider abstraction." Objectives 4 and 5 are **not built** in this pass — that is a deliberate scope decision, not an oversight. Objectives 1, 2, 3, 6, and 7 are built.

## 1. Schema

Rewrote `add_communication_hub.sql` (this file was never committed, so this is a revision, not a migration-on-top-of-a-migration). Deviates from the request's literal 5-table list in two ways, both stated here rather than silently done:

- **Dropped the separate `communication_channels` table** this session's earlier pass had built. A `communication_providers` row now carries `channel_type` directly — one fewer layer of indirection, same capability (multiple providers per channel type, ordered by `priority`, for failover).
- **Kept `communication_campaigns`**, which wasn't in this request's table list but wasn't asked to be removed either, and `sendBulkMessages()`/`communication_messages.campaign_id` already depend on it. Dropping a working, harmless table would have been pure churn.
- **Did not carry forward `communication_logs`** (a generic lifecycle-event table from the earlier pass). Its job is now split between `communication_deliveries` (per-provider-attempt outcomes — a genuine improvement over the old table, which had no per-attempt granularity) and the existing `emitAuditEvent()` calls already present in `CommunicationService`/`CommunicationJobHandler`, which is the same audit mechanism every other job handler in this codebase uses (AIJobHandler, MediaJobHandler, PublishingJobHandler) — none of them have a dedicated per-domain log table either.

Final table set: `communication_providers`, `communication_templates`, `communication_campaigns`, `communication_messages`, `communication_deliveries`, `communication_webhooks`. All have `id`, `organization_id`, `created_at`, `updated_at`. `communication_deliveries` and `communication_webhooks` are append-only — RLS intentionally has no UPDATE/DELETE policy on them, enforcing immutability at the database level, not just by convention.

**`communication_webhooks` is schema-only.** No receiver route exists — that's an API endpoint, explicitly out of scope this pass.

## 2. Provider abstraction layer

- **`server/communication/types.ts`** — `ProviderAdapter` interface (renamed from the earlier pass's `CommunicationProviderAdapter` to match this request's literal naming): `send() / status() / validate() / healthCheck()`.
- **`server/communication/providers/ProviderFactory.ts`** — maps a `provider` string to a concrete adapter and resolves credentials from `process.env` by name (never a database column). Adding a provider later means: implement the interface, register it here — `CommunicationService` and `CommunicationJobHandler` never change.

## 3. Providers implemented

| Provider | File | Status |
|---|---|---|
| **Resend** | `providers/ResendProvider.ts` | Real, working (renamed from the earlier `EmailAdapter.ts`). Unchanged logic. |
| **SMTP** | `providers/SMTPProvider.ts` | Real, working. Hand-rolled over Node's `net`/`tls` (no new dependency — no `nodemailer` in `package.json`, and this matches the codebase's existing "raw fetch, no vendor SDK" convention). Implements EHLO, opportunistic STARTTLS upgrade, AUTH LOGIN, MAIL FROM/RCPT TO/DATA with dot-stuffing. `status()` honestly reports that SMTP has no native delivery-status query rather than fabricating one. |
| **MSG91** (stub) | `providers/StubProviders.ts` | Non-functional. `validate()` returns a clean "stub, not implemented" result; `send()/status()/healthCheck()` throw loudly if anything ever tries to actually use one. |
| **Meta WhatsApp** (stub) | same file | Same stub behavior. |

**No MSG91 or WhatsApp sending was implemented**, per the request's explicit instruction. The stubs exist only so `ProviderFactory` has a registry entry for those names — this is not a signal that integration work has started.

## Bugs found and fixed (via the mock-server test)

`SmtpSession`'s socket had no `'error'` event listener. An `ECONNRESET` (remote closes abruptly, network drop mid-transaction) would have been an **unhandled error that crashes the entire Node process** — not just failed one send, taken down the whole worker. Fixed by attaching a persistent error handler that rejects the in-flight command instead. Also tightened `quit()`/`destroy()` to close the socket gracefully (FIN) instead of a double-`destroy()` that could race the write and reset the connection. Both fixes are in the code now, not left as known issues.

## 4. API endpoints — built (incremental follow-up, on this same branch)

Per the user's explicit choice to build incrementally on `feature/communication-hub` rather than jump to a "V1" with Campaign Engine/Analytics Dashboard/Feature Flags/full UI on a new branch. Added to `server.ts`, matching the exact inline-route style already used for `/api/vault/*` and `/api/v1/queue/*` (not a separate router file — this codebase's DB-backed routes are defined inline against the `createApp()` closure's `getPool()`):

| Route | Method | Backing |
|---|---|---|
| `/api/communications/send` | POST | `CommunicationService.sendMessage()` |
| `/api/communications/templates` | GET, POST | Direct query against `communication_templates` (list / create) |
| `/api/communications/history` | GET | Direct query against `communication_messages`, filterable by `status`/`channelType`, paginated |
| `/api/communications/status/:id` | GET | `CommunicationService.getMessageStatus()` |
| `/api/communications/retry/:id` | POST | `CommunicationService.retryFailedMessage()` |

The last two weren't in this request's literal 3-endpoint list — they're trivial exposure of two `CommunicationService` methods that already existed and were otherwise unreachable from any route. Flagged here rather than silently added.

**All 6 routes are `requireAuth`-gated and resolve `organizationId` from `auth.organizationId`** (the caller's own verified token), never from the request body — the exact contract this report's earlier "Organization Context integration" section required. **Runtime-verified**, not just typechecked: built the server, ran it, and confirmed all 6 return `401 {"error":"unauthenticated"}` unauthenticated, matching every other protected route in this codebase (`curl` output captured, server process cleaned up afterward). Full authenticated behavior (a real send actually reaching a provider) remains unverified — no live Supabase session or provider credentials are available in this environment.

## 5. Admin UI — not built

Still deferred. No dashboard/templates/logs/settings UI exists.

## 6. Organization Context integration

Every table has `organization_id`. `CommunicationService` takes `organizationId` as an explicit parameter on every method — the same pattern `QueueManager.enqueueJob()` already uses — rather than resolving it itself. **When an API route is eventually built, it must resolve `organizationId` from `req.auth.organizationId`** (set by `requireAuth`, which derives it from the caller's own verified token — see `server/middleware/requireAuth.ts`), never accept it from the request body. No route exists yet to get this wrong, but this is the contract the future route must follow.

## 7. RLS enforcement

Org-isolation policies (`organization_id = public.get_current_org_id()`) on every table, matching house convention. `communication_providers.credentials_secret_ref` is a column, and RLS is row-level, not column-level — **the future API layer must never project that column to the browser**; this is a design constraint stated here for whoever builds the route next, not something RLS itself enforces.

## Governance note (carried forward, still open)

Communication Hub is still **not** a ratified module boundary — see "Proposed module (unratified)" in `ARCHITECTURE_DECISIONS.md`. This pass extends that same unratified proposal; it doesn't seek or claim new approval. Get review-gate sign-off before a real (non-stub) SMS/WhatsApp/voice provider is added, or before this is treated as an approved module.

## Files changed

| File | Change |
|---|---|
| `add_communication_hub.sql` | Rewritten: dropped `channels`, renamed `provider_configs`→`providers` with direct `channel_type`, added `deliveries` and `webhooks`, dropped `logs` |
| `server/communication/types.ts` | Updated interfaces for the new shape; `ProviderAdapter` renamed |
| `server/communication/CommunicationService.ts` | Updated to `channelType`-based inputs; removed `communication_logs` writes |
| `server/communication/providers/ProviderFactory.ts` | New (was `adapters/AdapterRegistry.ts`) — now a class, registers 5 providers |
| `server/communication/providers/ResendProvider.ts` | New (renamed from `adapters/EmailAdapter.ts`), logic unchanged |
| `server/communication/providers/SMTPProvider.ts` | New — real SMTP client, bug-fixed after live testing |
| `server/communication/providers/StubProviders.ts` | New — MSG91/Meta WhatsApp non-functional stubs |
| `server/workers/handlers/CommunicationJobHandler.ts` | Updated for `communication_providers`/`communication_deliveries` |
| `server/workers/WorkerRegistry.ts` | Unchanged from the earlier pass (already wires the `communication` job type) |
| `server/communication/adapters/` | **Deleted** — superseded by `providers/` |
| `server.ts` | Added 6 `/api/communications/*` routes (see §4 above) |

No commits were created. UI is still not built.
