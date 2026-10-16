# Shogo → Bell24h-OS Migration Batch 1: Voice Studio

**Base SHA:** `ca8d1bb6d48e1b9dfc084acdfbe1a6b213d25695` (`feature/communication-hub`, re-verified current at worktree creation — matched `origin/feature/communication-hub` exactly)
**New branch / worktree:** `feature/shogo-voice-studio-migration`, `C:\Projects\bell24h-os-voice-studio-migration`
**Source checkout:** `C:\Projects\bell24h-voice-prototype\bell24h-os-source` (branch `shogo-prototype`, HEAD `1a9627f`)
**Source archive (used only for 4 files absent from the git branch):** `C:\Users\Sanika\Downloads\bell24h-os-source-2026-10-09.zip`

No change was made outside this worktree. The primary checkout, the FD1A worktree, the JWT-hardening worktree, and the `shogo-prototype` source checkout were all reconfirmed unmodified before and after this work.

## Source ZIP/Git divergence — recorded explicitly, not silently worked around

`SHOGO_MIGRATION_BATCH_PLAN.md` cites `DOGRAH-VOICE-SERVER-SPEC.md`, `scripts/dograh-driver-test.ts`, `scripts/dograh-webhook-test.ts`, and `src/lib/voice-driver.ts` as Batch 1 source files. **None exist in the `shogo-prototype` git branch.** All four exist in the ZIP. I read `voice-driver.ts` in full directly from the archive (via `unzip -p`, nothing extracted to disk) and ported it; the other three were not read in full (the spec doc and test scripts are not load-bearing for the implementation — `voice-driver.ts`'s own inline comments already document the Dograh contract completely). This divergence should be reported to whoever maintains the `shogo-prototype` branch independent of this batch.

## Files added or changed

| File | Status |
|---|---|
| `add_voice_studio_tables.sql` | New — 12 tables, RLS + REVOKE, no destructive statement |
| `server/voice/voiceDriver.ts` | New — ported from the ZIP's `src/lib/voice-driver.ts`, near-verbatim |
| `server/voice/VoiceService.ts` | New — service layer |
| `server/voice/routes.ts` | New — Express routes |
| `server/voice/rbac.ts` | New — permission mapping, reuses `communication/rbac.ts`'s `getUserRoleNames` |
| `server/voice/validation.ts` | New — input validators |
| `server/voice/__tests__/voiceDriver.test.ts` | New — 14 pure unit tests |
| `server/voice/__tests__/routes.integration.test.ts` | New — 15 integration tests (PGlite) |
| `server/workers/handlers/VoiceJobHandler.ts` | New — worker-side dispatch |
| `server/workers/WorkerRegistry.ts` | Modified, +12/-1 — registers `VoiceJobHandler`; moves `'voice'` out of the `mediaHandler` case (where it would have thrown `Unsupported media job type: voice` — confirmed this was the actual pre-existing behavior) into its own case |
| `server.ts` | Modified, +5 — registers `registerVoiceRoutes` alongside the existing Communication Hub registration, same pattern |
| `src/pages/VoiceStudioPage.tsx` | New — UI |
| `src/App.tsx` | Modified, +2 — one new route, `/voice-studio` |

**No unrelated file was touched.** Communication Hub's own code, routes, RBAC, and tests are unmodified — confirmed by running its full test suite afterward (see Tests, below).

## Source-to-destination mapping

| Shogo source | Destination |
|---|---|
| `src/lib/voice-driver.ts` (ZIP) | `server/voice/voiceDriver.ts` — ported near-verbatim; only naming/comment style changed |
| `sprint8-voice-routes.ts` (1418 lines, Hono) | `server/voice/routes.ts` (Express) — re-architected, not a line-for-line port; implements the dispatch/history/agents/campaigns/webhook subset below |
| 13 `Voice*`/`CommEvent` Prisma models | `add_voice_studio_tables.sql` — **raw SQL, not Prisma** (see correction below), 12 tables (`VoiceQueueJob` deliberately not recreated) |
| Shogo's bespoke `VoiceQueueJob`/queue | Destination's existing `job_queue`/`QueueManager`, `job_type: 'voice'` (already a reserved `JobType` value — see Architecture correction below) |
| Shogo's own auth (query-token, unsigned) | **Not ported.** Destination's `requireAuth` + a new `server/voice/rbac.ts` mirroring `communication/rbac.ts`'s exact shape |
| ~20 UI sub-areas (overview, hub, engine, agents, calls, campaigns, live, queue, history, scripts, flow, receptionist, architecture, providers, voices, numbers, escalations, automation, analytics, settings, policies) | **3 implemented** (Overview+dispatch, Calls/history, Agents) — see Parity gaps |

## Architecture correction, made during implementation (verified, not assumed)

The batch plan said *"New Prisma models need adding to Bell24h-OS's own schema."* **Verified incorrect for this destination:** zero files in `server/` or `src/` import `PrismaClient` anywhere in this repo — it's a listed but unused dependency. The actual convention (used by every existing feature, including Communication Hub) is a raw SQL fragment (`add_<feature>_tables.sql`). Implemented accordingly.

A second finding, made while wiring the worker: **`'voice'` was already a reserved `JobType` value** (`QueueTypes.ts`) but was routed to `MediaJobHandler`, which has no `'voice'` case and would throw `Unsupported media job type: voice` — confirmed this was the actual, broken pre-existing behavior, not something this batch regressed. Redirected to the new `VoiceJobHandler`.

## Routes implemented

| Route | Permission | Purpose |
|---|---|---|
| `GET /api/voice/dograh/contract` | none (docs only) | The Dograh integration contract, as JSON |
| `POST /api/voice/calls/dispatch` | `dispatch` (ADMIN/MANAGER) | Validates, records intent, enqueues a `job_queue` job |
| `GET /api/voice/calls` | `read` | List calls, org-scoped |
| `GET /api/voice/calls/:ref` | `read` | Call detail + transcript |
| `GET /api/voice/agents`, `POST /api/voice/agents` | `read` / `write` | Representative builder CRUD |
| `GET /api/voice/campaigns`, `POST /api/voice/campaigns` | `read` / `write` | Representative builder CRUD |
| `POST /api/voice/webhooks/dograh` | secret-gated, not session-gated | Applies a Dograh capture, idempotent on `workflow_run_id` |

## Authentication, organization-isolation, and security design

- `organizationId`/`userId` always come from `req.auth` (the verified token), never the request body — enforced identically to Communication Hub's own pattern, confirmed by the org-isolation tests below (cross-org dispatch/list/lookup all correctly scoped or rejected).
- RBAC: `dispatch` (ADMIN/MANAGER), `write` (+EDITOR), `read` (+VIEWER) — a new, Voice-specific permission map reusing the *same* role-lookup function Communication Hub uses, not a second auth implementation.
- Full phone numbers are never persisted — only `maskPhone()`'s last-4-digit form reaches `voice_calls.phone_masked`; the real number lives only in the one-shot job payload consumed by the worker.
- **Webhook secret is a real, verified improvement over the Shogo source**: Shogo's own spec allowed an unset-secret fallback that accepted unverified calls ("If unset the endpoint accepts unverified calls and says so in its response"). This implementation **fails closed (503)** if `DOGRAH_WEBHOOK_SECRET` is unset, and uses a **constant-time comparison** (`timingSafeEqual` over SHA-256 digests, same pattern as `requireServiceAuth.ts`) against the provided header — never a plain `===`.
- Dograh dispatch fails closed with a specific, actionable error listing exactly which env var is missing, and never silently substitutes the simulated driver.
- Simulation is never ambiguous: every `voice_calls` row has a `driver` column (`'simulated'` | `'dograh'`), checked by a dedicated test.

## Database changes

`add_voice_studio_tables.sql` — 12 tables, additive only (`CREATE TABLE IF NOT EXISTS`), `organization_id NOT NULL REFERENCES organizations(id)` on every table (a correction over Shogo's own schema, where `orgId` was nullable everywhere), RLS enabled + `SELECT` isolation policies + `REVOKE` from `anon`/`authenticated` on every table, matching `add_communication_hub.sql`'s exact convention. **No migration was executed against any live database** — only applied inside the PGlite in-process test engine.

## Tests executed — exact commands and real results

```
npx tsx --test server/voice/__tests__/voiceDriver.test.ts
  14 pass, 0 fail

npx tsx --test server/voice/__tests__/routes.integration.test.ts
  15 pass, 0 fail (one genuine test-isolation bug found and fixed in my own
  test during this run — a job-count query wasn't scoped to the specific
  ref under test, so it also counted a leftover queued job from an earlier
  test in the same file; not an application defect)

npx tsx --test server/ai/*.test.ts "server/communication/__tests__/*.test.ts" "server/middleware/*.test.ts" "server/voice/__tests__/*.test.ts"
  166 pass, 0 fail, exit 0  -- confirms zero regression to Communication
  Hub, the AI router, or requireServiceAuth from touching server.ts and
  WorkerRegistry.ts
```

**Coverage against Phase 5's list:** authentication ✓, RBAC ✓, cross-org isolation ✓, request validation (incl. CRLF injection) ✓, safe errors (never 500 with raw internals) ✓, queue lifecycle (real `job_queue` row, real `VoiceJobHandler` processing) ✓, idempotency (duplicate dispatch, webhook replay) ✓, Dograh adapter with a fake transport (no real network call) ✓, webhook secret enforcement (missing/invalid/valid) ✓, missing configuration (Dograh env vars) ✓, simulation-vs-real labeling ✓.

**Not covered, reported honestly rather than skipped silently:** frontend loading/error/empty/status-state tests, and regression tests for the frontend. This repo has **no frontend/component test harness at all** (no Vitest/Jest/JSDOM config anywhere) — confirmed in an earlier sprint of this same engagement. Building one is new infrastructure, out of this batch's scope. `VoiceStudioPage.tsx` implements real loading/error/empty states in its own code (visible on inspection) but they are not exercised by an automated test.

`tsc --noEmit` in this worktree reported ~260 errors, **all in pre-existing, unrelated files** (`src/App.tsx`'s own existing lines, `ErrorBoundary.tsx`, several pre-existing pages) — **zero errors in any file this batch created or modified**, confirmed by grepping the output for those exact paths. Re-running the identical check in the primary checkout (real, non-symlinked `node_modules`) came back clean (exit 0), confirming this is a symlink-resolution artifact of this worktree's `node_modules` setup, not a real regression.

## Remaining parity gaps — explicit, not glossed over

**Implemented:** dispatch → queue → worker → capture → writeback loop (both drivers); call history + detail with transcript; representative agent/campaign CRUD; Dograh webhook with real secret enforcement and idempotency; 12 of 13 source data entities (the 13th, `VoiceQueueJob`, intentionally replaced by the existing queue).

**Not implemented in this batch** (tables exist in the migration where applicable; no routes, service methods, or UI for): Scripts Studio, Provider/Voice-profile/Number configuration management, Escalation Center, Automation Rules UI, Policies UI, Analytics, Architecture diagram, Receptionist configuration, Live call monitor feed. These map to real tables already created (`voice_scripts`, `voice_providers`, `voice_profiles`, `voice_numbers`, `voice_escalations`, `voice_automation_rules`, `voice_policies`) — the schema is ready; the service/route/UI layer for them is a follow-up batch, not claimed here.

**RFQ linkage is not implemented** — `VoiceJobHandler` passes `rfq: null` unconditionally; `voice_calls.rfq_number` exists as a column but nothing populates it from a real RFQ yet.

**I am not claiming full Voice Studio parity.** The source area list above (9 sub-areas) remains unimplemented and untested; this batch delivers the core loop plus two representative admin areas, exactly as "minimum complete, reviewable" was asked for.

## Review / production-activation status

**Ready for code review** — complete, type-sound (for its own files), tested (29/29 new tests passing, 166/166 including the full existing suite), isolated to its own worktree/branch, nothing committed or pushed.

**Not ready for production activation**, independent of code review outcome, because: (1) `DOGRAH_BASE_URL`/`DOGRAH_AGENT_ID`/`DOGRAH_API_KEY`/`DOGRAH_WEBHOOK_SECRET` are not configured anywhere (expected — this batch never touched environment variables); (2) the migration has never run against a real Supabase/Postgres database, only PGlite; (3) the 9 unimplemented sub-areas above would need their own scoping before Voice Studio could be called feature-complete relative to Shogo.

---

No real call was placed, no provider was activated, no external message was sent, no migration ran against a live database, no production secret was touched, and nothing was committed, pushed, merged, or deployed. Presenting the diff and this test evidence for review.
