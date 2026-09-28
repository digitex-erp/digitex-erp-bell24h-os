# CH-02 — Admin Communications Center: Implementation Report

**Date:** 2026-09-28 · **Branch:** `sprint/ch-02-campaigns` (cut from `feature/communication-hub` @ `bd3b8af`; **local only — not pushed, no PR**)
**Scope:** build `/admin/communications` on top of the existing Communication Hub, with the Template → Test → Schedule → Execute → Log workflow. This report supersedes the earlier-named `COMMUNICATION_HUB_PRODUCTION_READINESS_REPORT.md` request (same sprint, revised brief).

## 1. Verdict

**Built and verified against a real Postgres engine and a real browser — with no real provider and no real scheduler in the loop.** Every send path fails closed when no provider is configured. **Nothing in this sprint has sent a real email, WhatsApp message or SMS**, and no provider has been verified. Do not describe the Communication Hub as "working" until the acceptance steps in §8 have been observed.

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **PASS** (exit 0) |
| `npm run build` | **PASS** (exit 0) |
| `npm test` | **209 / 209 pass**, 59 suites, 0 skipped |
| Browser end-to-end (real Chrome, real UI, real routes, real SQL) | **37 / 37 checks pass** — with a *test-double* provider and a stand-in scheduler (§4) |
| Real provider send / real scheduler / production deploy / migration applied to any DB | **NOT DONE — not verified** |

## 2. Requirement-by-requirement

| # | Requirement | Status | Evidence / note |
|---|---|---|---|
| 1 | `/admin/communications` with tabs Dashboard, Templates, Campaigns, Schedules, Logs, Providers | **Done, browser-verified** | Tab order asserted in the E2E. `/communications` now redirects to it; nav updated; the old placeholder page (which still said "WhatsApp (Meta/MSG91)") is deleted. |
| 2 | Integrate the existing Communication Hub service | **Done** | Campaign messages go through `CommunicationService.sendMessage()` — same validation, quota, idempotency, queue, worker, provider path as a single send. A campaign is not a second sending path. |
| 3 | Integrate InsForge scheduling | **Prepared, NOT executed** | InsForge CLI verified reachable (project linked, authenticated, `schedules list` = `[]`). No schedule created: that needs the deployed URL and the value of `CRON_SECRET`, which I do not have and must not invent. Exact commands, acceptance criteria and rollback: `docs/project/CH02_INSFORGE_WORKER_SCHEDULE_RUNBOOK.md`. The InsForge **MCP** server timed out at session start; the CLI works. |
| 4 | Template → Test → Schedule → Execute → Log | **Done, browser-verified** | Plus "select leads" and "create" ahead of it. Schedule and Execute are locked until a real test message has reached `sent` (server-enforced, mirrored in the UI). |
| 5 | No Twilio | **Done in code; docs cleaned** | No Twilio class, registry key, import, env var or SQL (`getAdapter("twilio")` throws — tested). Forward-looking planning docs edited (§6). |
| 6 | No MSG91 WhatsApp | **Done** | No code path exists; UI text corrected; docs edited. MSG91 remains an SMS/OTP **stub** in the registry (owner decision — see §7). |
| 7 | Providers: Resend, SMTP, Meta WhatsApp Cloud API (future-ready only) | **Done — Meta is more than "future-ready"** | Resend + SMTP: real adapters, never run live. Meta: a real adapter + signature-verified webhook **ported from the site repo's pattern**, shipped **disabled and labelled UNVERIFIED** (see §7 deviation 2). |
| 8 | Every send creates audit logs | **Done for what the repo supports** | Accepted, refused, worker-sent, failed, dead-lettered, campaign lifecycle: all emit audit events (tested by capturing real events). **Limit:** `server/audit.ts` writes structured JSON to stdout only — the repo has no durable audit table. The durable per-send record is `communication_messages` + `communication_deliveries`; tests assert both exist for every send that reached a provider. |
| 9 | No mock success responses | **Done** | No sample data anywhere in the UI or API. Every count is a `COUNT` of real rows. "Verified" appears only after a real successful delivery attempt. The Dashboard can only *warn*; it never reports "healthy". |
| 10 | Fail closed if provider not configured | **Done, tested at three layers** | Worker → `PROVIDER_NOT_CONFIGURED`, message failed, audited; test-send fails → campaign gate stays shut; UI shows the real error. Also: un-allow-listed secret names are refused; missing credential → `not_configured`, no adapter call. |
| 11 | Produce `CH02_IMPLEMENTATION_REPORT.md` | **This file** | |

## 3. What was built

**Database — `add_communication_campaigns.sql`** (new file; requires `add_communication_hub.sql`; re-runnable; **not applied anywhere**)
- `communication_campaign_recipients` — audience snapshot (validated address, per-recipient variables, status, message link), `UNIQUE(campaign_id, recipient)`.
- Campaign columns: consent attestation, last test message, run counter, started/completed, paused reason; status now includes `paused`.
- `communication_messages.is_test` — test sends never count toward campaign totals.
- `communication_logs` — a **read-only view** (`security_invoker`) joining messages to their delivery attempts. See §7 deviation 1.
- Same write model as C0: tenants read their own org's rows; only the server writes.

**Server — `server/communication/`**
- `CampaignService` (leads, create, test, schedule, execute, cancel, worker batch expansion, reconcile), `DashboardService`, `ProviderAdminService`.
- `MetaWhatsAppCloudProvider`, `whatsappWebhook` (handshake + HMAC-SHA256 on the **raw** body, fail-closed when unconfigured, monotonic status ingestion, phone numbers not stored).
- 17 new routes under `/api/communications/*` (leads, campaigns ×8, logs ×2, providers ×2, dashboard, schedules, webhook ×2), all behind the C0 RBAC → rate-limit chain. New `manage` permission (ADMIN) for provider health checks; campaign test/schedule/execute/cancel need `send`; creating a draft needs `write`.
- `CommunicationJobHandler` handles `{campaignId, run}` jobs and reconciles the campaign after each message.

**UI — `src/`** (`AdminCommunicationsPage` + 9 component files, typed API client, pure flow helpers with unit tests). Disabled buttons state their reason; execute/cancel need confirmation; polling only while something is in flight.

## 4. How it was verified — and what that does not prove

1. **209 automated tests** (node:test via tsx; PGlite runs the **real** migrations, real `job_queue` DDL, real `QueueManager`, real handler): campaign flow 26 · dashboard/schedules/audit 14 · WhatsApp adapter + webhook 25 · provider admin 11 · routes 41 · validation 21 · providers 19 · handler 11 · migration 10 · SMTP wire 7 · UI flow helpers 22 · idempotency race 2.
2. **Mutation checks** (a break is introduced, the tests must fail, then it is restored): webhook signature always-true → 4 tests fail; "test must be verified" gate removed → 3 tests fail. (C0's earlier checks on SMTP/migration/allowlist also still hold.)
3. **Browser E2E** — `scripts/ch02-ui-harness/` (documented, repeatable): real Chrome drives the real page against the real routes/SQL/handler.
   - *Scenario A, no provider:* template created via UI → wizard selects 5 leads (invalid address flagged, phone-only contact excluded) → consent required → test send → **fails with `PROVIDER_NOT_CONFIGURED`, gate stays closed**, Logs show "no provider was ever called".
   - *Scenario B, test-double provider:* health check → test send → **verified only after the worker actually ran** → schedule → Schedules tab (queued, not overdue) → execute with confirmation → **5 sent, 0 failed, completed** → Logs 5 rows → provider becomes "verified" → Dashboard counts.
   - **Stubbed in the harness:** login (always a seeded ADMIN), the provider (a double called "Resend (TEST DOUBLE)" — no network), the scheduler (`/__tick` runs queued jobs through the real handler).
   - **Therefore:** a pass proves the UI and orchestration are correct and fail closed. It does **not** prove that Resend, SMTP or Meta deliver, that real Supabase login/roles work in the UI, or that a scheduler triggers the worker.

## 4b. A defect found and fixed during verification
An early test run showed the UI consent checkbox had a 0×0 box. Root cause: **my harness had no CSS** (Tailwind v4 scans from Vite's root; the harness root was a temp folder). Not a product bug; fixed in the harness and re-run. Recorded so nobody wonders why the E2E has a `root` override.

## 5. Fail-closed behaviour (all tested)
- No provider row / no allow-listed credential on the server → send fails `PROVIDER_NOT_CONFIGURED` (audited); nothing is marked sent.
- Test message not `sent`/`delivered` → schedule and execute refused (409), in API **and** UI.
- No consent attestation → campaign not created; consent record missing → run refused.
- Quota reached mid-campaign → campaign **pauses** (nothing dropped, resumable), audited.
- Webhook with no app secret / bad signature / no raw body → 401, nothing changed.
- Health check with a stub, unknown provider, or missing credential → reported, adapter not called, nothing written.

## 6. Documentation cleanup
Edited (forward-looking): `BELL24H_COMMUNICATION_HUB_IMPLEMENTATION_PLAN.md`, `BELL24H_OS_COMMUNICATION_HUB_SPRINT_B_PLAN.md`, `GATE_D1_…_PROVIDER_GATE.md`, `COMMUNICATION_HUB_IMPLEMENTATION_REPORT.md`, `ARCHITECTURE_DECISIONS.md` — Twilio rows/adapters/routes removed, MSG91 narrowed to SMS/OTP, a dated "provider scope update" banner added. The banners themselves (and a historical "terms searched" list) still contain the word "Twilio" as a statement of removal.
**Deliberately not edited** (dated historical records — rewriting them would falsify history): `BELL24H_OS_PRODUCTION_VERIFICATION_REPORT.md`, `BELL24H_OS_REMEDIATION_MASTER_PLAN.md`, `BELL24H_OS_STAGING_CERTIFICATION_REPORT.md`, `OS-LIVE-01-LIVE-PLATFORM-ACTIVATION-REPORT.md`, `BELL24H_OS_AGENT_RUNTIME_AUDIT_MULTI_AGENT_WEB_AGENCY.md`. Tell me if you want them annotated.

## 7. Decisions and deviations from the brief (please review)
1. **`communication_logs` is a view, not a table.** `communication_deliveries` already is the append-only per-attempt log (built in C0); a second log table would duplicate it, which `ARCHITECTURE_DECISIONS.md` forbids. The view gives the Logs tab one row per message.
2. **Meta WhatsApp is a real adapter, not "future-ready only".** I had already chosen "port the site repo's provider/webhook pattern" earlier in this sprint. It is gated exactly like any provider (needs an allow-listed token + an operator-created provider row) and is reported as **UNVERIFIED**; it has never made a request to Meta.
3. **MSG91 stays in the registry as an SMS/OTP stub.** The brief's provider list omits it; the earlier owner decision kept it for OTP. It cannot send. Say the word to remove it.
4. **"Leads" = the organization's `contacts`.** There is no `leads` table in this schema (checked). Contacts carry no consent field, so campaign creation requires an explicit operator **consent attestation**, stored with the campaign.
5. **Schedule / Execute require a *verified real test send*.** Stricter than the brief; it is what makes "fail closed" real.
6. **Permission mapping** (mine, not pre-existing): send/test/schedule/execute/cancel = ADMIN, MANAGER; draft creation = +EDITOR; provider health check = ADMIN.
7. **Route:** literal `/admin/communications` as a flat route (no nested admin router exists in the app).
8. **Dependency/tooling:** `@electric-sql/pglite` (dev only) from C0; `playwright-core` is **not** added to the project (the harness README says `npm i --no-save`).

## 8. Before this can be called working — owner checklist
1. Verify the DB role: `SELECT current_user, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user;` (the migrations `REVOKE` from `anon`/`authenticated`).
2. Apply, in order, in **staging first**: `add_communication_hub.sql`, `add_communication_campaigns.sql`.
3. Ensure roles exist in `user_roles` (RBAC fails closed: no role → 403).
4. Set `RESEND_API_KEY` (or `COMM_RESEND_*`) on the server; insert a provider row by SQL, e.g.
   `INSERT INTO communication_providers (organization_id,name,provider,channel_type,credentials_secret_ref,priority,settings) VALUES ('<org>','Primary email','resend','email','RESEND_API_KEY',0,'{"fromAddress":"no-reply@<verified-domain>"}');`
5. Set `CRON_SECRET`; create the InsForge schedule per the runbook.
6. In the console: **Providers → Health check** (ADMIN), then a **campaign test** to an address you own; wait for **sent**. Only then does **Providers** show *verified*.
7. WhatsApp additionally needs: Meta business verification, phone number ID, an **approved template**, `META_WHATSAPP_ACCESS_TOKEN`, `META_WHATSAPP_APP_SECRET`, `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN`, and the webhook URL `/api/communications/webhooks/meta-whatsapp` registered in Meta.

## 9. Known limitations and residual risks
- **Throughput:** each worker tick runs at most **5 jobs** → ~5 messages/minute at a 1-minute cadence (a 1,000-recipient campaign ≈ 3½ h). Documented in the runbook; raising it is a code change not made here.
- **No scheduler exists yet** (§2 #3): until one calls `/api/v1/workers/tick`, only Vercel's once-daily cron would run jobs. The Dashboard/Schedules tabs will show *overdue* / *no job has ever completed* — by design.
- **Audit events are stdout-only** (repo limitation); durable records are the message/delivery rows.
- **Provider-reported failure after acceptance** (e.g. a WhatsApp delivery failure) updates the message and Logs but does **not** change the campaign's counters, which reflect provider acceptance.
- **WhatsApp outside the 24-hour window needs an approved template**; the adapter sends free text otherwise and reports Meta's rejection as a failure.
- **Email bodies are HTML and not escaped**; template variables can inject markup (carried over from C0).
- **Quotas count test sends** and are per organization/channel; per-minute rate limits are in-memory per instance (C0 limitation).
- **UI not exercised with real Supabase login** (harness stubs auth); real-session behaviour rests on the existing `authedFetch` + server-side `requireAuth`, unchanged.
- **This branch is local only.** Nothing pushed; PR #1 (C0) is untouched.

## 10. Files
New: `add_communication_campaigns.sql`; `server/communication/{CampaignService,DashboardService,ProviderAdminService,whatsappWebhook}.ts`, `providers/MetaWhatsAppCloudProvider.ts`; 4 new test files (+ a shared HTTP harness) and 3 extended ones under `server/communication/__tests__/`; `src/pages/AdminCommunicationsPage.tsx`, `src/components/communications/*` (9), `src/lib/{communicationsApi,communicationsFlow}.ts`, `src/lib/__tests__/`, `src/types/communications.ts`; `scripts/ch02-ui-harness/*`; `docs/project/CH02_INSFORGE_WORKER_SCHEDULE_RUNBOOK.md`.
Modified: `routes.ts`, `rbac.ts`, `validation.ts`, `types.ts`, `CommunicationService.ts`, `CommunicationJobHandler.ts`, `ProviderFactory.ts`, `StubProviders.ts`, `server.ts` (raw-body capture), `App.tsx`, `AppLayout.tsx`, `authedFetch.ts` (surfaces the server's `detail`), `package.json` (test script), `.env.example` (names only), `.gitignore`, 5 docs.
Deleted: `src/pages/CommunicationsPage.tsx`.

## 11. Not started (queued behind CH-02)
The two other briefs in the same message — **Research Consolidation Sprint** (`MASTER_RESEARCH_INDEX.md`, `MASTER_EXECUTION_BOARD_V2.md`, `IMPLEMENTATION_PRIORITY_MATRIX.md`) and the **SEO & Positioning Plan** (`BELL24H_OS_SEMANTIC_POSITIONING_PLAN.md`) — were read but not started, per "first continue as per above first".
