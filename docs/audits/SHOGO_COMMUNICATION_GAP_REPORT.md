# Shogo Communication Module — Gap Report

Read-only audit. No implementation or deployment in this pass. Builds on, and does not duplicate, the already-implemented Voice Studio migration (Batch 1, this engagement) and the already-real Communication Hub (`server/communication/*`, pre-existing). Scope: the 22 named Communication items plus the 7 shared-dependency areas the task explicitly listed alongside them.

## Methodology note (stated explicitly, per advisor review of this audit's first draft)

The register CSV carries UI/backend/integration status, security notes, and migration decision per item. Full DB schema field lists and API endpoint/middleware detail per item live in the companion `SHOGO_COMMUNICATION_SCHEMA_AND_API_MAP.md`, not duplicated in the CSV cells — the CSV would be unreadable with 2 more wide free-text columns added to its existing 11. This is a deliberate split, not an omission of the task's requested fields.

## Headline finding

Of the 22 named items, **2 are already fully implemented and tested this engagement** (AI Voice Center core loop, Call History/Conversations), **4 more have real schema plus a partial CRUD surface** (Voice Agents, Call Campaigns — list+create only), and **12 have a destination table created but no route, service, or UI at all** — honest "schema-ready, not implemented" gaps, not silently-working features. **4 items were never real, distinct features in Shogo to begin with** (Live Calls, Conversations, RFQ Follow-up Agent, SIP/Telephony, STT/TTS Providers, AI Models — these are sub-views or category filters on other items' own pages, not standalone screens; see the register's `ui_status` column for each). **1 item (AI Receptionist) has no destination schema concept at all and needs its own design**, since it's inbound-call handling, structurally different from Batch 1's outbound-dispatch-shaped schema.

**No item was found where a UI page displays data that looks real but has no backing write path** — the specific failure mode the task's instruction ("never infer that a feature works merely because its page exists") was most worried about. Every item in the register that's marked UI-complete-but-backend-absent has that marked explicitly; none of this engagement's own earlier work overstated a gap as a feature.

## The one real architectural tension this audit surfaces

**`voice_providers` (created this engagement) vs. the existing `communication_providers` table's `channel_type` CHECK constraint, which already includes `'voice'` as a valid value** (confirmed in `add_communication_hub.sql`, predating this engagement). Communication Hub's schema reserved a voice slot; Batch 1 built a separate table instead of using it. This is exactly the "competing provider system" risk the task's safety rules warn against, and it was not caught during Batch 1's own implementation or review. See the Security Review for the recommended resolution path. **This does not mean Batch 1's implementation is wrong or needs to be reverted** — `voice_providers` has 4 category values (`sip`, `stt`, `tts`, `llm`) that `communication_providers` was never designed to hold alongside its own `email`/`sms`/`whatsapp`/`push` values, so a straight merge isn't obviously correct either. It means the decision needs to be made deliberately, not by default.

## Shared dependencies — audited as the task required, each with its own real/simulated status

| Shared dependency | Status | Evidence |
|---|---|---|
| Scheduling / job queue | **REAL, already reused correctly.** | `job_queue`/`QueueManager`/`WorkerRegistry` (pre-existing); Voice Studio's `job_type: 'voice'` now correctly routes to `VoiceJobHandler` (this engagement's fix of a pre-existing mis-routing bug — see migration report). No second queue was created for any Communication item. |
| AI routing | **REAL at destination (`server/ai/ProviderRouter.ts`), correctly NOT touched by Voice Studio.** | `voiceDriver.ts` never calls `ProviderRouter`; the `voice_providers.category='llm'` slot is a label only, not a live model-selection path. Flagged in the register (AI Models row) as a boundary to maintain, not a current violation. |
| Org isolation | **REAL and consistently applied.** | Every one of the 12 new tables has `organization_id UUID NOT NULL REFERENCES organizations(id)` plus RLS `SELECT` policy plus a `REVOKE` backstop — the identical pattern already used by `communication_*` tables. Confirmed by this engagement's own cross-org integration tests (15/15 passing, including 3 dedicated org-isolation assertions). |
| Permissions / RBAC | **REAL.** | `server/voice/rbac.ts` reuses `getUserRoleNames` from `server/communication/rbac.ts` directly — no reimplementation, no parallel role system. Confirmed by 29 passing tests covering all 3 permission tiers (dispatch/write/read) and the role-less-403 case. |
| Audit | **PARTIAL.** | `comm_events` exists and is written by `VoiceService.applyCapture()` after every call concludes — but no append-only audit log exists for administrative actions on voice_agents/campaigns/providers/etc. (who created/edited/disabled what, when). Communication Hub itself does not appear to have this either for its own admin actions, based on this engagement's reading of `server/communication/routes.ts` — so this is not a Voice-specific gap, it's a platform-wide one, out of scope to fix here. |
| Communication Hub (the real one, `server/communication/*`) | **REAL, untouched, not duplicated.** | Voice Studio added its own tables and routes under `/api/voice/*`, entirely separate from `/api/communication/*`. The one overlap risk is the provider-table question above — everything else (auth, RBAC pattern, RLS convention, error-mapping convention) was deliberately copied as a *pattern*, never as a shared *table or runtime instance*. |
| "Communication Hub (SIM)" the Shogo UI concept (item #1) | **UI-only, simulated, no backend of its own** | See register row 1 — this is a cross-channel landing view inside `CommandCenter.tsx`, distinct from the voice-specific overview, with no dedicated data source in Shogo either. |

## Reconciliation with the Voice Studio migration (already implemented, not re-litigated here)

Items 1 (Communication Hub SIM), 2 (AI Voice Center), 4 (Call History), and 6 (Conversations) are either already covered by Batch 1's real implementation or need only a thin additional UI layer over data Batch 1 already makes real (see register for each). Items 7, 12, 17, 18, 19 (Voice Agents partial, Call Campaigns partial, Voice Providers, STT/TTS Providers, AI Models) have real schema from Batch 1 but no route/UI beyond the 2-tab subset Batch 1 built. The remaining items (5, 8, 9, 10, 11, 13, 14, 15, 16, 20, 21, 22) are genuinely new ground not touched by Batch 1.

## Recommended migration order (investigation only, no batch scoped or implemented here)

1. **Resolve the `voice_providers`/`communication_providers` overlap question first** — any further work on Voice Providers, STT/TTS Providers, or AI Models (items 17-19) should wait on this, since building CRUD on top of the wrong table is wasted/harmful work.
2. **Small, same-pattern CRUD additions** (Call Scripts, Escalations, Phone Numbers, Voice Library) — each is a direct repeat of the Agents/Campaigns CRUD pattern already proven in Batch 1, lowest risk.
3. **Call Analytics** — purely additive aggregate queries over already-real `voice_calls` data, no new table needed.
4. **Call Queue UI, Live Calls UI** — both are read-only views over data that's already real (`job_queue` rows / `voice_calls.status`), just missing a route+UI.
5. **Call Campaigns bulk-dispatch orchestration** — needs its own fan-out design, higher risk than #2.
6. **RFQ Follow-up Agent / real RFQ linkage** — blocked on the same open question already on record from the Voice Studio migration report (`rfq: null` hardcoded).
7. **Call Flow Builder, Automation Rules, Communication Settings, AI Receptionist** — each needs its own design decision before any implementation batch; do not scope these as simple CRUD.

## Unresolved questions (explicitly separated from verified facts)

- Does `voice_providers` stay separate from `communication_providers`, or get merged/aliased? (architectural, unresolved)
- Is "Communication Settings" meant to be `voice_policies`'s UI, or a broader, un-modeled settings concept? (scope, unresolved)
- Is AI Receptionist in scope for Bell24h-OS at all, or VyaparSethu-facing (buyer-initiated calls)? (scope, unresolved)
- Does Communication Hub's own admin-action audit trail exist anywhere not yet found, or is the platform-wide audit gap noted above real? (not independently re-verified this pass beyond re-reading `server/communication/routes.ts`)
