# Shogo Communication Module — Security Review

Scope: the 22 Communication items plus shared dependencies. Per the task's instruction, this leads with concrete, verified tensions rather than a broad checklist — precision over volume.

## 1. `voice_providers` vs. `communication_providers` — a real risk of two provider-config systems, not yet actualized into a bug

Batch 1 created `voice_providers` (category: `telephony|sip|stt|tts|llm|voice|recording`) as a standalone table. The pre-existing `communication_providers` table's `channel_type` CHECK constraint already includes `'voice'` (confirmed in `add_communication_hub.sql`, which predates this engagement). No code currently reads or writes `communication_providers` with `channel_type='voice'` — so there is **no live conflict today** — but if a future change (by anyone, not necessarily this engagement) adds a voice-provider row to `communication_providers` while `voice_providers` also exists, the platform would have two places claiming to be the source of truth for voice provider health/credentials/failover, with no code to reconcile them. **Recommendation: decide and document which table owns voice provider config before building any CRUD route on top of `voice_providers`** — this is a design decision, not a code fix, and is explicitly flagged as unresolved in the Gap Report.

## 2. `voice_providers.category='llm'` — a boundary that must not become a second AI-routing path

Bell24h-OS's real AI model routing is `server/ai/ProviderRouter.ts` plus 6 real provider adapters (NVIDIA/DeepSeek/Qwen/GLM/MiniMax/Gemini) — mature, tested infrastructure, unrelated to Voice Studio. `voice_providers.category='llm'` exists only as a labeling slot (ported from Shogo's own category list) and is never read by `voiceDriver.ts` or any other code to actually select a model. **Verified: no current violation.** This is a preventive note for future work — if Voice Studio is ever extended to do something like transcript summarization via an LLM, that call must route through the existing `ProviderRouter`, not through a second mechanism keyed off `voice_providers.category='llm'`.

## 3. Webhook authentication — fail-closed design, deliberately stricter than the Shogo source

`POST /api/voice/webhooks/dograh` (`server/voice/routes.ts`) requires `DOGRAH_WEBHOOK_SECRET` to be set in the environment; if it is not, the route returns `503` rather than accepting an unverified call. The header (`x-bell24h-voice-webhook-secret`) is compared via `timingSafeEqual` over SHA-256 digests (constant-time, no early-exit string comparison). **This is a deliberate correction over the Shogo source**, which — per the contract note already written into `voiceDriver.ts`'s `dograhCaptureContract()` — allowed an unset-secret fallback. Confirmed by 3 passing tests (missing-secret → 503, missing/wrong header → 401, correct header → applied). The webhook handler also never trusts an `organization_id` from the inbound payload; it looks the call up server-side by `driver_job_id` or `ref` first, so a malicious or malformed payload cannot write into another org's data even with a valid secret.

## 4. Phone number handling — consistently masked, never stored or logged in full

`voice_calls.phone_masked`, `voice_numbers.masked` — both store only a last-4-digit display form (`maskPhone()` in `voiceDriver.ts`). No column anywhere in the 12 new tables stores a full phone number. This matches the convention already established for `communication_*` tables. Not independently re-verified this pass whether `VoiceService.dispatchCall`'s input validation (`validatePhone`, E.164 format) ever logs the raw input phone number before masking — worth a targeted check in a future pass, not confirmed as a problem here.

## 5. Credential handling — secret-reference pattern, consistent

`voice_providers.credentials_secret_ref` stores a secret *name*, never a value — same convention as `communication_providers.credentials_secret_ref`. `voice_providers` additionally has a stricter `REVOKE ALL` (not just write) from `anon`/`authenticated` roles, matching `communication_providers`'s own stricter grant.

## 6. Auth exclusion — Shogo's own insecure pattern confirmed NOT ported

`scripts/verify-voice-pages.ts` constructs an unsigned, fake JWT via `btoa()` and passes it as a `?token=` query parameter against a hardcoded Shogo preview URL. This pattern (query-string token, unsigned, Shogo-specific) was identified during the Voice Studio migration and explicitly not carried into the destination. Every destination Voice Studio route uses the same `requireAuth` middleware already used by Communication Hub and every other authenticated route in this codebase — one implementation of token verification, not a parallel one. Re-confirmed, not re-derived, in this pass.

## 7. Tenant isolation — corrected, not inherited

Every one of Shogo's 13 Prisma Voice*/CommEvent models declared `orgId String?` (nullable) — a real tenant-isolation weakness in the source (a null `orgId` row would not be isolated by any org-scoped query that doesn't explicitly handle the null case). Every destination table declares `organization_id UUID NOT NULL`. This was deliberately not carried forward. Confirmed by this engagement's own org-isolation tests (cross-org list/lookup returns empty/404).

## 8. RBAC — three-tier, fail-closed, reused rather than reimplemented

`requireVoicePermission` (`server/voice/rbac.ts`) imports `getUserRoleNames` from `server/communication/rbac.ts` directly. No new role table, no new permission-checking logic. `dispatch` is ADMIN/MANAGER only; `write` adds EDITOR; `read` adds VIEWER; a caller with no matching role gets 403 on every route, confirmed by test. No gaps found in what's implemented. The 12 items with schema but no route yet (Scripts, Providers, Profiles, Numbers, Escalations, Automation Rules, Policies) have **no RBAC gap because they have no route at all** — the gap is "doesn't exist," not "exists unprotected."

## 9. Audit trail — a platform-wide gap, not Voice-specific

No append-only audit log exists for administrative actions (who created/edited/disabled a voice agent, campaign, or provider). `comm_events` records call outcomes, not admin actions. This appears to be true of Communication Hub's own admin routes too, based on this pass's reading of `server/communication/routes.ts` — not independently verified beyond that one file, flagged as an open question in the Gap Report rather than asserted as fully confirmed.

## What was NOT found — explicitly stated per the task's "never infer" instruction

No instance was found, across any of the 22 items, where a Shogo UI page displays data that implies a real backend write path when none exists in the destination. Every "UI complete, backend absent" item in the register was verified by checking for the actual route/service/table, not inferred from the page rendering successfully in Shogo's own simulated mode.
