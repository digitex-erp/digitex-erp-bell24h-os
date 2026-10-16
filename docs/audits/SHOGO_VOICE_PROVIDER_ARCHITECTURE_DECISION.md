# Voice Provider Architecture Decision

**Question:** should `voice_providers` (created in the Voice Studio migration) be merged into, or replaced by, the existing `communication_providers` table — or kept separate?

**Decision: keep them separate. No schema change, no migration, no code change required to resolve this.** This is a documentation-only decision; nothing below required a risky refactor, so nothing was deferred.

## Evidence examined

- `add_communication_hub.sql` lines 29-43 — `communication_providers` schema.
- `server/communication/types.ts` lines 12, 39-53, 192-201 — `ChannelType`, `CommunicationProvider`, `ProviderAdapter` interface.
- `server/communication/providers/ProviderFactory.ts` — the full adapter registry, secret-resolution, and allowlist logic.
- `server/workers/handlers/CommunicationJobHandler.ts` lines 72-84 — the actual failover query and selection logic.
- `add_voice_studio_tables.sql` lines 183-205 (this engagement, Batch 1) — `voice_providers` schema.
- Confirmed by grep: no file anywhere in `server/` registers a `'voice'`-channel adapter in `ProviderFactory.registry`, and no route exists yet for either table's CRUD (`server/communication/routes.ts` has zero provider-related code). **There is no live conflict today** — this is a decision about where future work should land, not a fix to an existing bug.

## Why they are structurally incompatible, not just two tables for one thing

1. **`ProviderAdapter` is a single-message dispatch contract.**
   ```ts
   interface ProviderAdapter {
     send(message: OutboundMessage, config: ResolvedProviderConfig): Promise<AdapterSendResult>;
     status(providerMessageId: string, config: ResolvedProviderConfig): Promise<AdapterStatusResult>;
     validate(config: ResolvedProviderConfig): Promise<AdapterValidationResult>;
     healthCheck(config: ResolvedProviderConfig): Promise<AdapterHealthResult>;
   }
   ```
   `CommunicationJobHandler` selects a provider with `WHERE channel_type = $1 AND organization_id = $2 AND is_active = true ORDER BY priority ASC`, then calls `send()` on each in order until one succeeds (failover). The result is a synchronous-ish `{success, providerMessageId, errorMessage, rawResponse}`.

   Voice Studio's calling engine (`server/voice/voiceDriver.ts`) is **asynchronous and webhook-driven**: `dispatch()` returns `{accepted, driverJobId}` immediately; the actual outcome (transcript, `interested`, `price`, `moq`, `deliveryDays`, `confidence`, `duration`) arrives **minutes later via `POST /api/voice/webhooks/dograh`**, or inline for the simulated driver. There is no `providerMessageId`/`status()` polling model, and the result shape has nine structured business fields that `AdapterSendResult` has no place for. Forcing Dograh (or any real AI-voice-agent engine) into `ProviderFactory.registry` would mean rewriting the adapter contract itself — not a config change.

2. **`voice_providers.category` has no equivalent in `communication_providers.channel_type`.**
   `channel_type` is a flat enum: `email | sms | whatsapp | voice | push`. `voice_providers.category` is `telephony | sip | stt | tts | llm | voice | recording` — five of those seven values (telephony, sip, stt, tts, recording) describe configuration for a *calling engine's* sub-components, which `communication_providers` was never designed to express. There is no column to put "this is an STT provider" or "this is a SIP trunk" on a `communication_providers` row without altering its schema.

3. **The `channel_type='voice'` slot in `communication_providers` is reserved for a different, not-yet-built feature.** If Bell24h-OS ever adds a literal outbound voice *notification* send (e.g. a Twilio-Voice-style adapter that plays a TTS message and reports `sent`/`delivered`), that feature is structurally compatible with `ProviderAdapter.send()`/`status()` and correctly belongs under `communication_providers` with `channel_type='voice'`, using the existing `ProviderFactory`. **That is not Voice Studio.** Voice Studio is an AI-agent-driven conversation (Dograh), not a one-shot message. Confusing the two — e.g. by trying to route Dograh through `channel_type='voice'` — would be the actual duplication risk, and this decision explicitly forecloses it.

4. **Organization-isolation constraint asymmetry.** `communication_providers.organization_id` is **nullable** (`UUID REFERENCES organizations(id)`, no `NOT NULL` — `add_communication_hub.sql:31`). `voice_providers.organization_id` is **`NOT NULL`** (this engagement's own, stricter convention, matching every other Voice Studio table). Merging the two tables would force resolving this constraint difference as part of the merge — one more reason a forced merge is not "safe consolidation," it's a schema change with its own blast radius, and out of scope for this decision.

## What IS reused (pattern-level, not table-level)

- **Secret handling.** `ProviderFactory.resolveSecret()` checks `credentials_secret_ref` against a per-provider allowlist regex *before* touching `process.env`, and never returns the resolved value — only the reference name is ever persisted or returned. `voice_providers.credentials_secret_ref` already follows the identical naming convention (a secret *name*, never a value). **Recommendation for whenever a Voice Providers CRUD service is built** (not done in this batch — see Call Scripts report; no route exists yet for `voice_providers` at all): reuse this exact allowlist-then-`process.env` pattern, and extend `ProviderFactory`'s allowlist map (or extract a small shared `resolveSecretByAllowlist(allowlist, provider, secretRef)` helper both modules call) rather than inventing a second secret-resolution mechanism. This is the "reuse existing infrastructure" principle applied at the function level, since the table level doesn't fit.
- **RLS + REVOKE convention.** Identical in both migrations (`SELECT`-only RLS policy keyed on `organization_id = get_current_org_id()`, `REVOKE` write grants from `anon`/`authenticated`). No change needed — already consistent.
- **`health_status` vocabulary.** `voice_providers.health_status` already uses the same `unknown|healthy|degraded|down` values `communication_providers.health_status` uses. Keep this vocabulary shared going forward even though the tables aren't merged, so a future cross-provider health dashboard (if ever built) doesn't have to reconcile two different enums.

## Explicit guardrails for future work (none required a code change today — stated so a future implementer doesn't accidentally violate them)

1. Never register an AI-voice-agent engine (Dograh or any future equivalent) inside `ProviderFactory.registry`. It is not a `send()`-shaped adapter.
2. Never populate `communication_providers` with a `channel_type='voice'` row that represents an AI-agent call. That slot is reserved exclusively for a future plain-notification voice-send feature, if one is ever built — a different feature from Voice Studio.
3. A future `voice_providers` CRUD API (none exists yet) must never return a resolved credential value in an API response — only `credentials_secret_ref`'s name, exactly like `communication_providers` already does.
4. A future `voice_providers` CRUD API must keep the existing `organization_id NOT NULL` constraint and RLS/REVOKE pattern; do not weaken it to match `communication_providers`'s nullable column to make a merge easier later — the nullable column on the communication side is itself a known weakness (see `SHOGO_COMMUNICATION_SECURITY_REVIEW.md`), not a model to copy.

## What this decision does NOT do

It does not implement any Voice Providers route, service, or UI — none exists yet on either side of this decision, and none was added in this batch. It does not alter `communication_providers`, `voice_providers`, `ProviderFactory`, or any RLS policy. It is a documented boundary, not a code change.
