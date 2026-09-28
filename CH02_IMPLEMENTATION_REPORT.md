# CH-02 — Implementation Audit and Build Report

**Date:** 2026-09-28 · **Branch:** `sprint/ch-02-campaigns` (cut from `feature/communication-hub` @ `bd3b8af`; **local only — not pushed, no PR**)
**Frozen decisions honoured:** no Twilio · no MSG91 WhatsApp · WhatsApp = Meta WhatsApp Cloud API only · Email = Resend + SMTP · Bell24h-OS is the Communication Hub, VyaparSethu consumes it through the API · SHAP/LIME, RFQ Matching, Trust and MiroFish were **not** touched.

## 1. Verdict

**Code-complete for the CH-02 scope and verified against a real Postgres engine and a real browser — with no real provider, no real scheduler and no migration applied to any database.** Nothing in this sprint has sent a real email, WhatsApp message or SMS, and no provider has been verified.

| Certification asked for | Verdict | Why |
|---|---|---|
| **Campaign Engine** | **Logic verified with test doubles only — NOT production-certified** | Orchestration, gates, batching, suppression, unsubscribe, analytics and fail-closed behaviour are covered by 315 automated tests and a 63-check browser run. The provider in those runs is a labelled test double. |
| **Communications Hub** | **NOT certified** | No real provider has ever completed a send; the schema is not applied anywhere; unsubscribe env is unset; no durable audit table exists (§6). |
| **Scheduler (InsForge → worker tick)** | **NOT certified** | `npx tsx scripts/certify-scheduler.ts` run against the linked InsForge project today: **0 schedules exist → NOT CERTIFIED** (exit 1). The checker only says CERTIFIED with evidence (§4). |

| Item from the brief | Status |
|---|---|
| **Knowledge Vault "Could not load documents"** | **NOT confirmed fixed.** Only its diagnosability was improved; whether documents load is unknown until the query in §3 #1 is run against the live database. |
| **Admin Diagnostics "unauthenticated"** | Fixed in code (missing Authorization header); not re-observed on a deployed build. |
| **Industry Intelligence blank page** | Not investigated. |
| **AI Providers 0/6** | Not code — needs credentials. |

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **PASS** (exit 0) |
| `npm run build` | **PASS** |
| `npm test` | **315 / 315 pass**, 86 suites, 0 skipped |
| Browser E2E (`scripts/ch02-ui-harness`, real Chrome + real UI + real routes + real SQL) | **63 / 63 checks pass** — test-double provider, stand-in scheduler, stubbed login (§7) |
| Real provider send · real scheduler run · production deploy · migration applied to a live DB | **NOT DONE** |

## 2. Corrections to the premises of the brief (verified, not assumed)

1. **"Direct DB Connection (Admin) — Error: unauthenticated" is not a missing `SUPABASE_SERVICE_ROLE_KEY`.** The repo contains **no service-role client at all** (grep: no `SUPABASE_SERVICE_ROLE_KEY` use). Data access is (a) PostgREST *as the caller* with the caller's own token (`postgrestFetch`) and (b) a pooled `DATABASE_URL` pg connection. The 401 came from the diagnostics page calling `/api/check-table` and `/api/check-users-count` with a **plain `fetch` — no `Authorization` header** — so `requireAuth` correctly said "unauthenticated". Fixed in the client (§3 #2). Adding a service-role key would have been the wrong fix (and would bypass RLS).
2. **"Knowledge Vault: Could not load documents" cannot be diagnosed from this repo.** The code collapsed every non-401 failure into that one line. I made the real reason visible and added a health endpoint; the underlying cause (table missing? RLS? no policy?) needs one read-only query against the live database — see §3 #1. I did not guess.
3. **"Industry Intelligence blank page"** — the page and route exist (`/industry-dashboard`); the cause was **not investigated** (needs an authenticated browser session against the live backend; not in the CH-02 task list). Reported under Pending.
4. **"AI Providers 0/6"** is a credentials matter, not a code defect (Blocked / Requires Credentials).

## 3. Completed (item #1 is only partly done — read its heading)

### #1 Knowledge Vault document loading — NOT confirmed fixed (diagnosability improved only; root cause unknown until the query below is run)
- `server/lib/vaultHealth.ts` + `GET /api/vault/health` (auth required): asks PostgREST *as the caller* for one row of each of `vault_documents, rd_library, timeline_milestones, phases, decision_records` and classifies each failure `table_missing | permission_denied | server_unconfigured | upstream_error` with the upstream detail (capped) and a remedy.
- The five vault components now show the real reason (`vaultLoadError`) instead of "Could not load documents"; `authedFetch` errors now include the server's `detail`. Diagnostics page has a new **Knowledge Vault tables** row.
- **To find the actual cause, run this read-only query in the Supabase SQL editor and paste the result:**
```sql
SELECT v.t AS table_name,
       to_regclass('public.' || v.t) IS NOT NULL AS table_exists,
       c.relrowsecurity AS rls_enabled,
       CASE WHEN c.oid IS NULL THEN NULL ELSE has_table_privilege('authenticated', c.oid, 'SELECT') END AS authenticated_can_select,
       CASE WHEN c.oid IS NULL THEN NULL ELSE has_table_privilege('anon', c.oid, 'SELECT') END AS anon_can_select,
       (SELECT string_agg(p.polname || ' (' || p.polcmd || ')', ', ') FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
FROM (VALUES ('vault_documents'), ('rd_library'), ('timeline_milestones'), ('phases'), ('decision_records')) AS v(t)
LEFT JOIN pg_class c ON c.oid = to_regclass('public.' || v.t)
ORDER BY 1;
```
  If `table_exists = false`, the fix is applying `add_knowledge_vault.sql` (manual SQL workflow: I will give you one statement at a time). Note that file's `CREATE POLICY "Public Read Access"` lines are not idempotent — re-running it on a database that already has the policies errors.

### #2 Admin Diagnostics "unauthenticated" — fixed and hardened
- `fetchTableCheck / fetchUserCount / fetchVaultHealth` now use `authedFetchJson`; the Direct DB row shows a **warning ("not signed in")** rather than an error when there is no session; every diagnostics failure shows status + reason (`diagnosticError`).
- **Security tightening found on the way:** `/api/check-table` and `/api/check-users-count` were reachable by any signed-in user; both now require the **ADMIN** role (`requireAnyRole`, denial audited). Tests include source-level regression guards.

### #3 Supabase service-role architecture — verified (read-only)
See §2 #1. No service-role client exists; the model is "tenants read, server writes" with RLS + `REVOKE`, the server writing through the pooled `DATABASE_URL` connection. **Unverified:** which DB role `DATABASE_URL` connects as — run `SELECT current_user, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user;` before applying the migrations.

### #4 CH-02 features (all server-side tested; UI browser-tested)
| Feature | What exists |
|---|---|
| **Campaign Management** | Draft → test → schedule/execute → cancel/resume; bounded worker batches; quota pause; consent attestation; audience from **exactly one** of picked contacts / a saved list / a saved segment. |
| **Campaign Templates** | Create **and edit** (PATCH: name/subject/body/active; same validation as create; audited by field *names* only). Content and deactivation are **locked (409 `template_in_use`) while a draft/scheduled/running/paused campaign uses the template**; renaming is always allowed. Email templates used in campaigns must contain `{{unsubscribe_url}}`. |
| **Campaign Scheduling** | `schedule` records *when* (job with `scheduled_at`); gated on a **verified real test send**. Starts only when a tick runs (§4). |
| **Campaign Execution Logs** | `communication_logs` view (one row per message + attempts), Logs tab, per-attempt drill-down; durable rows in `communication_messages` / `communication_deliveries`. |
| **Campaign Analytics** | Org analytics (7/30/90 days: per-day accepted/failed, by channel, failure reasons, suppression breakdown, audience sizes) and per-campaign analytics. **Only real counts.** Email/SMS report *provider acceptance only* — delivered/open/click rates are **not shown because they do not exist** (`null` → "n/a", tested). WhatsApp shows a delivered rate only from webhook-reported statuses. |
| **Contact Lists** | Create/delete, member add/remove (only this org's live contacts; foreign/deleted/unknown ids reported, never inserted; idempotent). |
| **Segmentation** | Saved criteria (`listIds, companyContains, nameContains, createdAfter/Before`), **strictly validated (unknown keys rejected so a typo cannot widen an audience), parameterised SQL, LIKE wildcards escaped, org-isolated, capped**; preview shows matches, suppressed count and a sample. Tested against SQL-injection strings. |
| **Suppression Lists** | Per-org, per-channel; reasons `unsubscribed/bounced/complained/manual/invalid`; enforced **three times**: at audience creation (counted, not silent), at the send API (422 `recipient_suppressed`) and again by the worker just before the provider call (message cancelled `suppressed: <reason>`, audited). Removal is ADMIN-only. |
| **Unsubscribe** | HMAC-signed one-click link (no secret/id in it); public page: **GET only asks for confirmation, POST unsubscribes** (defeats mail-scanner prefetch); CSP/no-store/noindex; `List-Unsubscribe` + `List-Unsubscribe-Post` on Resend and SMTP (header-injection-safe, tested on the wire). **Fails closed:** without `COMM_UNSUBSCRIBE_SECRET` + `COMM_PUBLIC_BASE_URL` an email campaign cannot be scheduled/executed and a running one pauses (`unsubscribe_not_configured`). |
| **UI** | New tabs **Audience** (lists + segments), **Analytics**, **Suppressions**; wizard audience source; template edit dialog; per-campaign analytics panel; every disabled control states why. |

### #5 InsForge Scheduler — prepared and certifiable, not created
See §4.

### #6 Meta WhatsApp Cloud API adapter framework — present, UNVERIFIED
`MetaWhatsAppCloudProvider` + HMAC-SHA256 webhook on the raw body (fail-closed when unconfigured, monotonic status ingestion, phone numbers not stored). Needs no credentials to exist; makes **no request to Meta** until an operator creates a provider row and sets an allow-listed token. **Open decision (yours):** the brief said "future-ready only"; if that meant *interface only*, revert `MetaWhatsAppCloudProvider.ts`, `whatsappWebhook.ts` and the two webhook routes to a stub. Not resolved without your yes/no.

## 4. Scheduler certification (repeatable)
`npx tsx scripts/certify-scheduler.ts [--app-url https://<host>]` reads `insforge schedules list/logs` through the CLI and prints **CERTIFIED** only when *all* hold: an **active GET https** schedule targets `/api/v1/workers/tick` with an Authorization header; **≥ 3 of the last 10 runs are HTTP 2xx and none failed** (a log row with no readable status is *never* counted as success); the newest run is < 24 h old; and (with `--app-url`) an **unauthenticated** GET of the tick route is refused (401/403). It never creates a schedule, never sends a credential, never prints a header value. 13 unit tests cover the decision logic. **Today: NOT CERTIFIED (0 schedules).** Creating the schedule needs the deployed URL and `CRON_SECRET` — see `docs/project/CH02_INSFORGE_WORKER_SCHEDULE_RUNBOOK.md`. Throughput reminder: 5 jobs per tick ≈ 5 messages/minute at a 1-minute cadence.

## 5. How it was verified — and what that does not prove
1. **315 automated tests** (node:test via tsx; PGlite runs the **real** migrations, real `job_queue`, real `QueueManager` and handler). New this sprint: suppression 26 · audience/lists/segments/analytics/templates 24 · unsubscribe tokens 7 · provider unsubscribe headers 6 · diagnostics 9 + 9 · scheduler certifier 13 · UI flow helpers 34.
2. **Mutation checks** (break → tests must fail → restore): earlier — webhook signature always-true (4 fail), verified-test gate removed (3 fail); this turn — LIKE escaping removed (caught), template in-use lock removed (caught).
3. **Browser E2E** (`scripts/ch02-ui-harness/`, restart the harness server before each run): 63/63. Covers no-provider fail-closed, provider test double, worker path, schedule/execute, logs, templates (missing-placeholder warning → edit → in-use lock → rename allowed), lists, segments + preview, the **real public unsubscribe page** (GET does not unsubscribe; POST does), suppression list, suppressed member left out and counted, the unsubscribe-not-configured gate, analytics with no invented rates.
4. **Stubbed in the harness:** login (always a seeded ADMIN); the provider ("Resend (TEST DOUBLE)", no network); the scheduler (`/__tick`). **A pass therefore proves UI + orchestration + fail-closed behaviour. It does not prove Resend/SMTP/Meta deliver, that real Supabase login/roles work in the UI, or that a scheduler triggers the worker.**

## 6. Pending
- **Industry Intelligence blank page** — not investigated (§2 #3).
- **Knowledge Vault: loading is still unconfirmed** — root cause needs the §3 #1 query result; the actual fix (e.g. applying `add_knowledge_vault.sql`) has not been done.
- **Durable audit table** — `server/audit.ts` writes structured JSON to stdout only; the durable per-send record is `communication_messages` + `communication_deliveries`. Deferred by design (schema decision).
- **Provider-reported failures after acceptance** (e.g. a WhatsApp delivery failure) update the message and Logs but not the campaign counters, which reflect provider acceptance.
- **CSV import / export of lists and suppressions**, bounce/complaint **webhook ingestion for Resend** (so `bounced`/`complained` suppressions arrive automatically — today only unsubscribes and manual entries do): not built.
- **Provider/channel mismatch is not constrained in SQL** (`provider='msg91', channel_type='whatsapp'` is schema-legal; fails closed today because MSG91 is a stub) — add a check in Sprint C2.
- **Oversized list-member batches (> ~5,000 ids) are refused by the JSON body-size limit (HTTP 413) before the service's own "at most 5000 items" check runs**, so that message is effectively unreachable for very large arrays; behaviour is still a safe refusal.
- **Rate limits are in-memory per instance**; email bodies are HTML and not escaped (C0 carry-overs).
- Queued after CH-02, read but not started: **Research Consolidation Sprint** (3 planning files) and **SEO & Positioning Plan** (1 file).

## 7. Blocked (cannot proceed without something outside this repo)
| Item | Blocked on |
|---|---|
| Create the InsForge schedule / certify the Scheduler | A deployed build containing CH-02 (URL) and `CRON_SECRET` |
| Apply `add_communication_hub.sql` then `add_communication_campaigns.sql` | Your decision + a staging DB; DB-role check (§3 #3). **Not applied anywhere.** |
| Confirm the Knowledge Vault cause | Result of the read-only query in §3 #1 |
| AI Providers 0/6 | Provider API keys (not code) |
| Any "it really delivers" claim | A real provider credential and a test to an address you own |

## 8. Requires Credentials (names only — never values in chat or git)
`RESEND_API_KEY` (or `COMM_RESEND_*`) · `SMTP_PASSWORD` + host/user settings · `COMM_UNSUBSCRIBE_SECRET` (≥ 32 random chars) · `COMM_PUBLIC_BASE_URL` (public https origin of this server) · `CRON_SECRET` (same value as an InsForge secret) · WhatsApp: Meta business verification, phone-number ID, an **approved template**, `META_WHATSAPP_ACCESS_TOKEN`, `META_WHATSAPP_APP_SECRET`, `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN`, webhook URL `/api/communications/webhooks/meta-whatsapp` registered in Meta. `.env.example` lists the names (empty).

## 9. Ready For Production
**Nothing is certified for production.** What is *code-complete and test-verified*, and therefore ready to be **staged** once §7 is unblocked: the campaign engine, templates (create/edit/lock), lists, segments, suppression list + unsubscribe, analytics, the admin console, diagnostics hardening, the scheduler certifier.
Order to reach "working": (1) DB role check → (2) apply the two migrations in **staging** → (3) roles in `user_roles` → (4) set `RESEND_API_KEY`, `COMM_UNSUBSCRIBE_SECRET`, `COMM_PUBLIC_BASE_URL`, `CRON_SECRET` and insert a provider row (example in the runbook / previous section 8) → (5) create the InsForge schedule and run `certify-scheduler.ts --app-url …` until it says CERTIFIED → (6) **Providers → Health check**, then a campaign **test to an address you own** and wait for *sent* (only then does the console show *verified*) → (7) a real unsubscribe-link click end to end.

## 10. Decisions and deviations (please review)
1. `communication_logs` is a **read-only view**, not a table (`communication_deliveries` already is the append-only per-attempt log; a second table would duplicate it).
2. **Meta WhatsApp is a real adapter, not "future-ready only"** (§3 #6) — decision needed.
3. **MSG91 remains an SMS/OTP stub** in the registry (cannot send); say the word to remove it.
4. **"Leads" = the organization's `contacts`** (no `leads` table exists); contacts carry no consent field, so creation requires an explicit consent attestation stored with the campaign.
5. Schedule/Execute require a **verified real test send**; suppression and unsubscribe fail closed — stricter than the brief, deliberately.
6. Permissions (mine): send/test/schedule/execute/cancel = ADMIN, MANAGER; write (drafts, templates, lists, segments, manual suppressions) = +EDITOR; read = +VIEWER; provider health check and suppression **removal** = ADMIN.
7. `playwright-core` is **not** a project dependency (`npm i --no-save` per the harness README); `@electric-sql/pglite` is a dev dependency (C0).

## 11. Files
**New:** `server/communication/{AnalyticsService,AudienceService,SuppressionService,TemplateService,unsubscribe}.ts`, `server/lib/vaultHealth.ts`, `src/lib/diagnosticsErrors.ts`, `scripts/certify-scheduler.ts`, UI `src/components/communications/{AudienceTab,SuppressionsTab,AnalyticsTab,CampaignAnalyticsPanel}.tsx`; tests `audience, suppression, unsubscribe.unit, unsubscribe.headers, diagnostics, certifyScheduler` (+ `diagnosticsErrors` under `src/lib/__tests__`).
**Modified:** `add_communication_campaigns.sql` (section 6: suppressions, lists, list members, segments, campaign audience columns, recipient status `suppressed`, RLS/REVOKEs), `server.ts`, `server/communication/{routes,rbac,types,validation,CampaignService,CommunicationService}.ts`, providers (`SMTP`, `Resend`), `CommunicationJobHandler.ts`, `SystemDiagnosticsPage.tsx`, 5 vault components, `authedFetch.ts`, `CampaignWizard/TemplatesTab/CampaignDetailDialog`, `AdminCommunicationsPage`, `communicationsApi/Flow`, `types/communications.ts`, test harness helpers, `scripts/ch02-ui-harness/*`, `.env.example` (names only), runbook.
**Withheld from git on purpose:** `BELL24H_OS_MASTER_READINESS_REPORT.md`, `GITHUB_PURGE_REQUEST.md`, `ORG_WIDE_COMMIT_VERIFICATION.md`, `SSH_KEY_EXPOSURE_REPORT.md` (untracked; not staged).
