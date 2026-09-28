# PHASE-2 CONTINUATION — Completion Report

**Repo:** `digitex-erp-bell24h-os` (Bell24h-OS) · **Branch:** `sprint/ch-02-campaigns` · **Date:** 2026-09-29
**Scope:** the six priorities in the "PHASE-2 CONTINUATION — BELL24H-OS" brief, in order. Source of truth used: `BELL24H_OS_MASTER_READINESS_REPORT.md`, `COMMUNICATION_HUB_CERTIFICATION_REPORT.md`, `ROADMAP_GAP_ANALYSIS.md`, the PHASE-2 audit reports, and — before changing anything — the current repository state (`git status`, existing tests, existing routes).

**Frozen decisions honoured:** no Twilio · no Apify · no MSG91 WhatsApp · WhatsApp = Meta WhatsApp Cloud API only · architecture VyaparSethu → Bell24h-OS → Communication Hub → Meta WhatsApp / Resend / SMTP. No provider verification was faked: every "verified" status in this codebase is still derived only from a logged message that actually reached `sent`/`delivered`, never operator-asserted.

## 0. Verification gate (all four required before this report was written)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **Clean** — 0 errors |
| `npm test` (node:test, real Postgres via PGlite) | **412 / 412 passing**, 114 suites, 0 failed |
| `npm run build` (`vite build` + `esbuild server.ts`) | **Succeeds** — `dist/index.html`, `dist/assets/*`, `dist/server.cjs` (324 kB) |
| Browser E2E (`scripts/ch02-ui-harness`, real Chrome + real routes + real SQL, test-double providers) | **84 / 84 checks pass** (was 63/63 at end of CH-02; +21 new checks for WhatsApp template mapping and Industry Intelligence) |

Two real bugs were found and fixed **by** this verification (not worked around):
1. **`CampaignDetailDialog`'s Refresh button only reloaded the campaign summary, not the recipients table.** After a campaign finished, the Progress line correctly showed "1 failed" but the per-recipient error reason stayed stuck at its pre-completion snapshot until the dialog was closed and reopened — an operator clicking Refresh would never see *why* a message failed. Fixed: Refresh now reloads both (`src/components/communications/CampaignDetailDialog.tsx`).
2. The CH-02 harness bundle is a static Vite build (`scripts/ch02-ui-harness/dist`), not a dev server — an app-code fix does not take effect until `npx vite build --config scripts/ch02-ui-harness/vite.config.ts` is re-run. Documented here so the next person doesn't lose time on the same trap.

No E2E check was weakened to make it pass. Two Playwright selector flakes (a `Health check` button now ambiguous between two provider rows, and `.click()` hangs against leftover Radix `Select`/`Dialog` portal DOM that accumulates over one very long single-page session) were fixed by scoping the locator to its row and, for one confirmed-safe case, `{ force: true }` after manually verifying via `elementFromPoint` that the target was correctly laid out and hit-testable — never by loosening what the check asserts.

## 1. Fix Direct DB Connection (Admin) — already done, re-verified

**Already fixed in the prior CH-02 commit `361a0f6`, before this Phase-2 continuation started.** Re-verified now: `npm test` includes `diagnosticError — 'unauthenticated' must not be reported as a database failure` (5 cases) and `vaultLoadError — the real cause must reach the screen` (4 cases), both passing.

Root cause (as found then, confirmed still correct): the diagnostics page's "unauthenticated" error was a **missing `Authorization` header on the client call**, not a missing Supabase service-role key or a broken service-role flow. `src/lib/diagnosticsErrors.ts` now classifies 401 as "sign in and retry" (a warning, never reported as a database failure), 403 as "requires ADMIN" by name, and every other status/network error keeps the server's real reason — nothing is ever silently mapped to "pass". Privileged diagnostics routes require `ADMIN`. No change made in this session; no regression found.

## 2. Fix Knowledge Vault

**Root cause identified and fixed, in two parts:**

- **Re-runnability bug** (this session): `add_knowledge_vault.sql`'s seed `INSERT ... ON CONFLICT DO NOTHING` had no matching unique constraint, so re-applying the migration duplicated all 18 timeline rows every time. Rewritten as `INSERT ... SELECT ... WHERE NOT EXISTS (SELECT 1 FROM timeline_milestones)` — idempotent by construction, not by a constraint that didn't exist. Covered by `server/communication/__tests__/vault.migration.test.ts` (10 tests): applying the migration twice yields exactly 18 rows, not 36.
- **A real, live security exposure** (this session, found while making the migration re-runnable, not previously reported anywhere in the readiness/certification documents I was told to use as source of truth): the vault's `"Public Read Access"` RLS policy was `USING (true)` with **no role restriction**. Supabase's default grants mean the `anon` role — i.e. anyone holding only the public anon key, no login required — could read the founder's private vault (timeline, R&D library, memory). Fixed in a new migration, `add_knowledge_vault_hardening.sql`, which drops the unrestricted policy and re-creates read access scoped to `authenticated` only. Same 10-test file asserts the anon role is now denied and the authenticated role is not.

**Health diagnostics:** `/api/vault/health` (added in the CH-02 commit, `server/lib/vaultHealth.ts`) reports table existence and row counts without ever claiming "healthy" on an assumption — it's the endpoint `SystemDiagnosticsPage.tsx` and the vault components now call before rendering, and it's what turns a missing-table 42P01 into "apply `add_knowledge_vault.sql`" on screen instead of a generic crash.

**Not done / needs a human:** neither migration has been applied to any real Postgres (staging or production) — see §6. `add_knowledge_vault_hardening.sql` must run **before** any production traffic touches the vault; until it does, the anon-read exposure above is live on whatever database currently has `add_knowledge_vault.sql` applied.

## 3. Complete WhatsApp Template Mapping

Built end-to-end this session: **Meta-approved template support, variable mapping, campaign-to-template association, validation before send.** No MSG91 WhatsApp, no Twilio — only the existing Meta WhatsApp Cloud API adapter is touched.

- `add_whatsapp_template_mapping.sql` — adds `provider_template_name` (Meta's own name: lowercase letters/digits/underscores, 1–512 chars — split into a `char_length` check plus a regex because Postgres regex repetition counts cap at 255), `provider_template_language`, `provider_template_variables` (ordered array) to `communication_templates`.
- `server/communication/whatsappTemplate.ts` — `validateMapping()` (name format, language, variable-name shape), `buildTemplateParameters()` (resolves ordered `{{1}}..{{n}}` values from campaign variables — **every** mapped variable must be present and non-empty for that specific recipient or the send is refused for that recipient only, fail-closed, never a half-filled template), `unresolvableVariables()`, `providerTemplateStatus()` (an unmapped WhatsApp template reads "free text only"; a mapped one reads **UNVERIFIED** until a real send through the worker succeeds, then **"verified by a real send"** — never operator-set).
- Threaded through `CommunicationService.resolveTemplate()` → message persistence → `CommunicationJobHandler` → `MetaWhatsAppCloudProvider.send()` (which now sends the Meta `template` object, not free text, when a template is mapped) → `CampaignWizard` (refuses to create a WhatsApp campaign on an unmapped template, with the reason on screen) → `TemplatesTab` (Meta name/language/variables fields, live validation, verified-by-send badge).
- **Real bug caught by the new tests and fixed:** clearing a template's Meta name (un-mapping it) left the old `provider_template_variables` in place, causing a spurious validation failure on save. Fixed in `TemplateService.update()`.
- 24 new tests in `server/communication/__tests__/whatsapp.template.test.ts` (pure validation, the real Meta adapter against a mocked `fetch`, a full campaign end-to-end through a PGlite database) — all passing. Confirmed live in the browser E2E (§0): a mapped template sends the correct ordered parameters per recipient; the one recipient missing a mapped variable fails alone with `variables.company: is required for WhatsApp template parameter {{2}}` while the other three still receive their own correctly-filled message.

**Not done / needs a human:** no template has been submitted to or approved by Meta; `META_WHATSAPP_ACCESS_TOKEN`/`META_WHATSAPP_APP_SECRET` are not set anywhere in this repo. Every "UNVERIFIED" you will see today is honest, not a placeholder.

## 4. Complete Industry Intelligence UI

Backend already existed (`server/industry/`) from earlier Phase-2 work in this session; this priority connected it to a real UI (`src/pages/IndustryDashboardPage.tsx` was previously a 25-line stub, now a full page), replacing nothing in the backend.

- **Organization-scoped:** every route (`GET /api/industry/overview`, `POST /api/industry/industries`, `DELETE /api/industry/industries/:id`, `GET/POST /api/industry/industries/:id/categories`, `GET/POST/PATCH/DELETE /api/industry/signals[/:id]`, `GET /api/industry/opportunities`, `GET /api/industry/trends`) is scoped by `auth.organizationId`; a fresh organization gets an **honest empty state** ("nothing is pre-filled", "No opportunities flagged") — confirmed in E2E, not just asserted in code.
- **Signal entry forms:** title, source (manual / web search / RFQ inference / other), and — this is enforced, not just suggested — **a source URL is mandatory for any non-manual source**, and it must be `http://` or `https://` (a `javascript:` URL is refused with the reason on screen, closing an XSS vector before it could ever reach a rendered link). Source links render with `rel="noopener noreferrer nofollow"`.
- **Opportunity dashboard:** signals flagged "this suggests an RFQ worth posting" carry their own note and surface in a separate opportunities list; the summary counts (signals recorded, opportunities, by-source breakdown) are **counts of what was actually recorded**, and trend language explicitly says "Not a forecast" and "not enough data" rather than inventing a trend line from a handful of points.
- 15 tests in `server/communication/__tests__/industry.test.ts` (provenance enforcement, URL validation, org scoping, trend classification) — all passing. Full create → block-invalid → record → verify-summary → add-category → delete flow confirmed live in the browser E2E (§0).

## 5. Build SHAP/LIME Explainability Layer

**Framework contracts only, as instructed — no predictive model exists, and none was added.** `server/explainability/`:

- `types.ts` — `Explanation` shape shared by both methods (`subject` ∈ RFQ matching / supplier ranking / trust infrastructure / Trade Confidence Score, `method` ∈ `shap`/`lime`, `modelId`, `modelVersion`, `prediction`, `attributions`) plus the two methods' **different, real mathematical requirements**: SHAP requires additivity (`baseValue + Σ attributions ≈ prediction`, checked to float tolerance); LIME requires a `localFit` score in `[0, 1]` and does **not** require additivity — the two are not treated as interchangeable.
- `validate.ts` — rejects anything that doesn't satisfy its method's contract.
- `registry.ts` — an **empty explainer registry by default**. `GET /api/explainability/status` reports which (subject, method) pairs have a registered explainer — today, none. This is deliberate: registering a real explainer is future work tied to an actual model, not part of this priority.
- `store.ts` / `routes.ts` — append-only storage, organization-scoped `GET /api/explainability/records`. **There is no `POST /explain` endpoint and no scoring logic** — the routes file says explicitly why: inventing an explanation with no model behind it would be worse than having none.
- 22 tests in `server/communication/__tests__/explainability.test.ts` — all passing, including "an empty registry reports no explainers" and "a SHAP record failing additivity is rejected".

This is intentionally the smallest possible slice: contracts and a fail-closed empty registry, ready for RFQ Matching / Supplier Ranking / Trust Infrastructure / Trade Confidence Score™ to plug into later. None of those four systems were touched.

## 6. Verify Communication Hub

| Channel | Code | Live send |
|---|---|---|
| **Resend** (email) | Adapter present, `List-Unsubscribe`/`List-Unsubscribe-Post` headers tested on the wire (CH-02) | Not verified — no `RESEND_API_KEY` set here |
| **SMTP** (email) | Adapter present, same unsubscribe-header handling (CH-02) | Not verified — no `SMTP_PASSWORD`/host set here |
| **Meta WhatsApp Cloud API** | Adapter present; **this session** it now sends the mapped-template `template` object with ordered parameters when a template is mapped, plain text otherwise (§3) | Not verified — no `META_WHATSAPP_ACCESS_TOKEN` set here |
| **InsForge scheduling** | `scripts/certify-scheduler.ts` (CH-02) re-run today against the live linked project (`Bell24h-os-VyaparSethu`, `r8fgym8r.us-east.insforge.app`) | **NOT CERTIFIED — 0 schedules exist.** No schedule targets `/api/v1/workers/tick`. Nothing here claims the scheduler works. |

Every one of the four rows above is a fresh check run today against real configuration/CLI state, not a copy of the CH-02 report — the scheduler line in particular was re-run live in this session (see §0's use of the InsForge CLI, project confirmed linked: `Bell24h-os-VyaparSethu`). The verdict is unchanged from CH-02: the Communication Hub is code-complete and test-verified end-to-end with test-double providers (§0's 84/84), but **no message has ever been sent through a real provider from this codebase, and the scheduler that would trigger the worker on a cadence does not exist yet.** Creating it needs a deployed URL and `CRON_SECRET` — see `docs/project/CH02_INSFORGE_WORKER_SCHEDULE_RUNBOOK.md`.

## Files changed this session

**New:** `server/lib/{auditStore,auditRoutes}.ts`, `server/industry/{IndustryService,routes}.ts`, `server/explainability/{types,validate,registry,store,routes}.ts`, `server/communication/whatsappTemplate.ts`, `src/lib/{industryApi,industryFlow}.ts`, `src/types/industry.ts`, migrations `add_audit_log.sql`, `add_explanations.sql`, `add_industry_signals.sql`, `add_knowledge_vault_hardening.sql`, `add_whatsapp_template_mapping.sql`, tests `audit.test.ts` (22) · `explainability.test.ts` (22) · `industry.test.ts` (15) · `vault.migration.test.ts` (10) · `whatsapp.template.test.ts` (24).

**Modified:** `add_industry_intelligence.sql` / `add_knowledge_vault.sql` (idempotent re-apply), `server.ts` (wires the three new route registrars), `server/audit.ts` (`setAuditSink`), `server/communication/{CampaignService,CommunicationService,TemplateService,routes,types}.ts`, `server/communication/providers/MetaWhatsAppCloudProvider.ts`, `server/workers/handlers/CommunicationJobHandler.ts`, `src/components/communications/{CampaignWizard,TemplatesTab,CampaignDetailDialog}.tsx`, `src/lib/communications{Api,Flow}.ts`, `src/types/communications.ts`, `src/pages/IndustryDashboardPage.tsx` (25-line stub → full page), `scripts/ch02-ui-harness/{entry.tsx,server.ts,e2e.cjs}` (test-double WhatsApp provider, Industry routing, 21 new E2E checks).

No migration was applied to any database. No provider credential was set or used. The four withheld reports (`BELL24H_OS_MASTER_READINESS_REPORT.md`, `GITHUB_PURGE_REQUEST.md`, `ORG_WIDE_COMMIT_VERIFICATION.md`, `SSH_KEY_EXPOSURE_REPORT.md`) are not staged and will not be committed.

## What is still not done (honest list)

- Neither `add_knowledge_vault_hardening.sql` nor any other migration in this report has been applied to a real database — the vault anon-read exposure (§2) is **live** wherever `add_knowledge_vault.sql` is currently applied, until the hardening migration runs.
- No Resend, SMTP, or Meta WhatsApp credential exists in this environment; no message has been sent through a real provider.
- The InsForge scheduler does not exist (0 schedules) — confirmed live today, not carried over from an old report.
- No Meta template has been submitted for approval.
- SHAP/LIME has zero registered explainers by design — RFQ Matching, Supplier Ranking, Trust Infrastructure and Trade Confidence Score™ were not built or touched.
- CSV import/export of industry signals and bounce/complaint webhook ingestion for Resend remain out of scope, as in CH-02.

## Order to reach "verified in production" (unchanged shape from CH-02, extended)

1. DB role check on the target Postgres → 2. apply, in order, `add_knowledge_vault.sql`, `add_knowledge_vault_hardening.sql`, `add_audit_log.sql`, `add_industry_intelligence.sql`, `add_industry_signals.sql`, `add_whatsapp_template_mapping.sql`, `add_explanations.sql` on staging → 3. set `RESEND_API_KEY` / `SMTP_PASSWORD` / `META_WHATSAPP_ACCESS_TOKEN`+`META_WHATSAPP_APP_SECRET`+`META_WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `COMM_UNSUBSCRIBE_SECRET`, `COMM_PUBLIC_BASE_URL`, `CRON_SECRET` → 4. submit and get Meta approval for at least one WhatsApp template, map it → 5. create the InsForge schedule and re-run `certify-scheduler.ts --app-url …` until CERTIFIED → 6. Providers → Health check, then one real test send per channel to an address/number you own, and only then does anything read "verified" → 7. register a real SHAP or LIME explainer against a real model before any `/explain`-style endpoint is added.

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
