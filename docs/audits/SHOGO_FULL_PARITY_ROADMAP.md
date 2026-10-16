# Shogo Full Feature-Parity Programme — Roadmap (Phase 4, investigation only)

No batch beyond Voice Studio (Batch 1) was implemented in this run. This document investigates the remaining requested scope against the expanded register (`SHOGO_FULL_PARITY_REGISTER_EXPANDED.csv`, 8 new rows) and the pre-existing 18-row register, and applies the stated ownership rule: **Bell24h-OS owns shared platform infrastructure; VyaparSethu owns marketplace/business functionality.**

## Architecture ownership — how it resolves each area

| Requested area | Correct owner, per the stated rule | Why |
|---|---|---|
| AI routing, provider registry/adapters, AI/Prompt/Image/Video/Voice Studio, Provider Health | **Bell24h-OS** | Platform infrastructure, used by any tenant/product |
| Communication Hub, full Voice Center, WhatsApp Business | **Bell24h-OS** | Shared communication infrastructure |
| Scheduling, Jobs, Automation, Workflows, Job Queue | **Bell24h-OS** | Shared platform infrastructure |
| Super Intelligence, Swarm, Growth Engine, Industry Intelligence | **Bell24h-OS** (if real and novel) or **shared API** consumed by VyaparSethu | Cross-cutting intelligence, not marketplace-specific |
| Marketplace, Suppliers, Buyers, RFQs, Video/Voice RFQ, RFQ Media Privacy | **VyaparSethu** | Marketplace business logic — confirmed already real and more mature there than in Shogo |
| Leads/Contacts/Deals/Activities (CRM) | **VyaparSethu** if marketplace-facing; **Bell24h-OS** if this is Bell24h-OS's own internal CRM for *its own* customers (ambiguous in the request — needs clarification, see below) |
| Administration (Users/Roles/Orgs/Audit/Feature Flags/System Health) | **Split** — identity/org/role administration belongs with whichever system owns that tenant's auth (already explicitly excluded per task instruction, both destinations have their own); shared observability (System Health) is platform-level, so Bell24h-OS |
| Developer features (API Keys, Integrations, Logs) | **Bell24h-OS**, as the platform exposing shared APIs/SDKs to VyaparSethu |

**One real ambiguity worth surfacing now, not silently resolved:** "Leads, Contacts, Deals and Activities" could mean (a) VyaparSethu's own buyer/supplier CRM tabs (confirmed real, inside `CRMPage.tsx`'s `leads`/`deals`/`activities` tab state — this is marketplace business logic, VyaparSethu's) or (b) a Bell24h-OS-internal CRM for managing *its own* platform customers (not found as a separate concept anywhere). Investigated this pass as (a), since that's what the Shogo source actually contains — flagging (b) as a possible scope misread, same pattern as "VyaparSetu Trade OS."

## Per-area investigation (not implementation)

### WhatsApp Business (full breakdown requested: overview, account setup, numbers, inbox, contacts, segments, templates, campaigns, workflows, AI agents, logs, webhooks, API explorer/docs/keys, analytics, costs, consent, opt-out, team assignment, integration settings, troubleshooting, audit)

**Already resolved by the existing register's row 8, at the whole-feature level — re-confirmed, not re-derived:** Shogo's WhatsApp module is "100% front-end simulation; zero backend; `/api/whatsapp/*` does not exist." Bell24h-OS's real Communication Hub (RBAC, per-org quotas, idempotency, multi-provider failover, RLS, a real executed test suite — 146 tests at the time of that finding, now 166 including this engagement's Voice Studio additions) is categorically more real. **None of the ~20 WhatsApp sub-areas listed in the request need individual investigation** — they're all facets of one already-decided EXCLUDE verdict. The one caveat already on record: VyaparSethu has its own `0014_whatsapp_send_logs` migration, suggesting a third, independent WhatsApp capability there — not re-investigated this pass, still an open item from the earlier Gap Report.

### Scheduling and Jobs (full breakdown requested: dashboard, scheduled messages, campaign calendar, recurring jobs, schedule creation/details, workflow triggers, execution history, failed jobs/retries, queue/worker health, scheduler provider config, InsForge status, audit trail, timezone/working hours)

**Mostly resolved by existing register row 9**, with one correction from this pass: Shogo's `ScheduledPost` model and cron engine are real but "nothing executes the schedules yet (acknowledged gap in Shogo itself)." **Bell24h-OS already has a real, working job_queue/QueueManager/WorkerRegistry system** — confirmed extensively in this engagement (used directly by Communication Hub and now Voice Studio). **This means Bell24h-OS's own scheduling/queue infrastructure is already more complete than Shogo's for the execution layer** — the only genuinely novel sub-items would be UI-level (a scheduling dashboard, campaign calendar view, execution-history/failed-jobs UI) wrapping the *existing* queue, not new backend. "InsForge status" is Shogo-specific (its own build-tool integration) and has no meaning at either real destination. **Verdict: largely redundant at the infrastructure level; any real gap is UI-only, not backend.**

### RFQ Media Privacy/Redaction (VyaparSethu)

**Unchanged from the existing register (row 15) — still a genuine gap candidate, still needs one human confirmation step** before scoping: whether VyaparSethu's `0009_rfq_video_url` migration already has identity-masking/redaction logic that a code search simply didn't surface. Not re-investigated this pass; no new evidence to add.

### Image/Video Factory backend parity

**Unchanged from the existing register (rows 5–6) — still UNVERIFIED**, not HOLD-by-default. The specific next step already on record (read `ImageStudioPage.tsx`/`VideoStudioPage.tsx`'s actual data calls) was not performed this pass either — still open.

### Avatar Studio and Colibrì demos

**Both NOT FOUND in the Shogo source** (see the expanded register's two new rows) — "Colibrì" appears only as a provider/engine name mentioned in passing in the existing AI Provider Management row, not as its own feature. Avatar Studio has zero matches anywhere searched. **Neither can be scoped as a migration batch until someone identifies where they actually exist** (if anywhere) — I am not inventing a source for either.

### Company DNA, Super Intelligence, Swarm Prediction, Growth Engine

**Unchanged from the existing register (rows 13, 16) — both still UNDECIDED**, both still need the same unresolved step: a human with direct VyaparSethu repo access diffing `0003_company_dna`/`0010_reviews`/`0012_provider_failures`/`0013_match_approvals` against Shogo's `CompanyDna`/`DnaStrand`/`DnaFact`/`DnaSignal`/`TrustLedger`/`DemandSignal`/`SuccessCard` models. Not re-investigated this pass.

### CRM, marketplace and trade-specific capabilities

**Unchanged from the existing register (row 14) — confirmed REDUNDANT**, VyaparSethu's own system is categorically more mature. The Leads/Contacts/Deals/Activities sub-areas requested are the exact tabs already inside Shogo's `CRMPage.tsx`, which this whole row already covers — no new sub-row needed per the register's own established consolidation convention (mirroring how WhatsApp's ~20 sub-areas are one row, not twenty).

### Administration, observability, API management, remaining developer pages

**Three genuinely new findings this pass** (see the expanded register): `SettingsPage.tsx` and `SystemHealthPage.tsx` are real Shogo pages not previously registered — both provisionally LIKELY REDUNDANT or HOLD pending a direct content comparison against Bell24h-OS's own `SettingsPage.tsx` (same name, exists) and the absence of any dedicated System Health page at either destination (Bell24h-OS has `SystemDiagnosticsPage.tsx`, which is DB/auth/schema-sync-specific, not general infra health — not confirmed to be the same scope). **"Feature Flags" and dedicated "API Keys"/"Integrations" pages were not found in the Shogo source under those names at all** — flagged as not-a-confirmed-gap for lack of a source to migrate from, not excluded as redundant.

## Proposed batch priority, unchanged in spirit from the existing `SHOGO_MIGRATION_BATCH_PLAN.md`, updated with this pass's findings

1. **Batch 1 — Voice Studio.** Done, this engagement.
2. **Batch 2 — RFQ Media Privacy/Redaction (VyaparSethu).** Still the next-highest-confidence real gap, still gated on one human confirmation step.
3. **Batch 3 (research, not implementation) — resolve the three UNDECIDED schema-overlap questions** (Company DNA, Trust/Demand signals, Image/Video Factory backend depth) before scoping any further batch touching those areas.
4. **New, smaller candidates surfaced this pass, not yet scoped:** a UI-only scheduling/campaign-calendar wrapper around Bell24h-OS's existing queue (if genuinely wanted — the backend already exists); a direct content diff of `SettingsPage.tsx`/`SystemHealthPage.tsx` against their Bell24h-OS namesakes.
5. **Not real candidates, pending clarification:** Avatar Studio, Colibrì Demos, Feature Flags, dedicated API Keys/Integrations pages — none were located in the Shogo source under the names requested.

## What this document deliberately does not do

It does not implement, scope acceptance criteria for, or estimate effort for any batch beyond Voice Studio — per this task's explicit instruction to investigate, not implement, the remaining batches in this run.
