# Trust Infrastructure — Master Gap Analysis

**Date:** 2026-09-28. Read-only classification pass — no code changes. Every "Already Built" / "Partial" claim below has a file:line citation; everything else is "Not Started," with a distinction between "no plan exists" and "planned in docs only."

## Architectural boundary finding (governs every item below)

This repo's own governance record, `docs/architecture/OS_INTEGRATION_DECISION_RECORD_V1.md:322-334` ("Architectural Boundary," restated as unchanged by that record), states explicitly: **VyaparSethu owns business-domain logic** — including **Trust/Trust Graph business rules, KYB business rules, Payment business rules, and Escrow business rules** — while **Bell24h-OS owns reusable infrastructure** (AI runtime, Communication Hub, Identity/RBAC, Workflow, Event, Audit, Evidence infrastructure, provider adapters). Per this same repo's own decision record, most of what "Trust Infrastructure" asks for is **explicitly out of Bell24h-OS's owned scope** and belongs in the separate VyaparSethu codebase. This gap analysis still classifies what exists here, but that scope boundary should be the first thing resolved, not assumed away.

## 1. GST Verification — **Partial**

- `organizations.gst_number TEXT` column exists (`supabase_schema.sql:17`), also added earlier via `add_org_fields.sql:6` and `activate_vyaparsethu_root_org.sql:12`.
- Frontend has a working form field for it: `src/pages/OrganizationPage.tsx:335-341` (labeled "GST Number," placeholder validates a 15-character GSTIN pattern via HTML `title` attribute only — no actual format validation or API call found).
- **No verification logic exists anywhere** — no call to the government GST API, no format-validation function, no verified/unverified status column. It is a free-text field an org admin can type anything into. The only other "GST" references in the codebase are fabricated SEO marketing copy in `src/modules/seo-intelligence/EnterpriseSeoService.ts` (e.g. line 511: `"...undergo GOTS, OEKO-TEX, and GST compliance verification"` — mock content for AI-search-citation tracking, not a real feature).

## 2. Udyam Verification — **Not Started** (no plan exists under this name)

- No literal "Udyam" reference anywhere in the repo. The closest related field is `organizations.msme_number TEXT` (`supabase_schema.sql:21`) — Udyam registration is India's MSME registration number, so this column is the plausible storage slot, but nothing reads, writes, validates, or surfaces it in any route or UI component found. No form field for it exists in `OrganizationPage.tsx` (only `gst_number` has one).

## 3. Trade Confidence Score — **Not Started** (no plan exists under this name)

No match for "trade confidence" anywhere in code or docs. Closest related concept is "Trust Score" (see #6/#7) — treated as a separate, unbuilt concept here since the repo never uses this exact term.

## 4. Escrow Architecture — **Not Started (planned in docs only)**

- Explicitly and repeatedly marked **"VERIFIED ABSENT"** by this repo's own prior audits: `docs/architecture/MASTER_MODULES.md:143` ("Commerce: Payment · Wallet · Ledger · Escrow — FUTURE — VERIFIED ABSENT... Escrow → planning docs only"), `docs/architecture/REALITY_TO_TARGET_GAP_MAP.md:69` ("No tables, no code anywhere... Entirely unbuilt"), `docs/project/PROJECT_CONTINUITY_REPORT.md:243` ("ABSENT in code").
- Only appears at design/planning level in `MASTER_CONTEXT/KERNEL_ARCHITECTURE.md:149` ("Commerce: RFQ, quotation, order, escrow state — Postgres + Workflow — Design").
- Every other "escrow" hit in the repo (`EnterpriseSeoService.ts`, `SeoCenterPage.tsx`, `server/routes/seoRoutes.ts`) is **fabricated marketing/mock content** for the SEO module's AI-citation and keyword-tracking demo data (e.g. fake page `https://bell24h.com/trust-os/escrow`, fake citation text) — not a real escrow feature or even a real page. Per the architectural-boundary finding above, this is also explicitly VyaparSethu's domain, not Bell24h-OS's, even once built.

## 5. Risk Engine — **Not Started** (no plan exists)

No match anywhere in code or docs for "risk engine," "risk score," or equivalent. Not even mentioned at the planning-doc level.

## 6. Supplier Trust Score — **Not Started** (no plan exists as a distinct supplier-specific concept)

No matches. See #7 for the general "Trust Score" concept, which this would presumably specialize.

## 7. Buyer Trust Score — **Not Started (planned in docs only, then marked absent)**

- `docs/architecture/MASTER_MODULES.md:143`: "Wallet/Ledger/**Trust Score**/Ratings → no source matches."
- `docs/project/PROJECT_CONTINUITY_REPORT.md:244`: "Trust Score | **ABSENT** | No matches."
- `docs/project/IMPLEMENTATION_STATUS.md:87` lists "Trust Score" among features to check against the continuity report's table — same absent conclusion.
- No buyer-specific or supplier-specific split exists even at the planning level; "Trust Score" is discussed as one undifferentiated future concept, already found absent by this repo's own prior audits (not just by this pass).

## 8. Verification Workflows — **Not Started** (no plan exists as a general workflow)

The only `is_verified` boolean fields anywhere in the codebase belong to the **SEO/AI-citation-tracking module** (`add_enterprise_seo_intelligence_18_tables.sql:320`, `add_enterprise_seo_center_v2.sql:283`, `src/types/seo.ts:355`) — these track whether an AI-engine citation of Bell24h's content was "verified," a completely unrelated concept to supplier/buyer/document verification. No document-upload flow, no admin-approval queue, no email/phone verification beyond Supabase Auth's own built-in flow (not audited here — out of this report's scope) was found.

## 9. Audit Trail — **Partial**

- A real, working, broadly-adopted audit mechanism exists: `server/audit.ts` — `emitAuditEvent()` emits structured JSON events (`actor`, `organizationId`, `action`, `targetType`, `targetId`, `outcome`, `requestId`, `metadata`) to stdout, matching the schema `SECURITY_BASELINE.md` requires (per that file's own doc comment, `server/audit.ts:4-5`).
- Genuinely used across the codebase, not just defined: 14 files call it, including `server.ts`, `CommunicationJobHandler.ts`, `CommunicationService.ts`, `PublishingJobHandler.ts`, `MediaJobHandler.ts`, `AIJobHandler.ts`, `WorkerSupervisor.ts`, `requireAuth.ts`, `requireServiceAuth.ts`, `requireCronAuth.ts`, `rateLimit.ts`, `ProviderRouter.ts`.
- **Explicit, self-documented limitation** (`server/audit.ts:7-11`): events go to **stdout only** — "Durable persistence (the `ai_request_logs` / audit tables) requires DATABASE_URL, which is not configured in this environment... durable write-through is tracked follow-up work." No `audit_events` table exists in `supabase_schema.sql` or any `add_*.sql` file. **This means today's audit trail cannot answer "what happened to organization X's data last month" — only whatever a live log drain captured at the time**, which is a real gap if this is meant to underpin a Trust Score or Verification Workflow's evidentiary record later.

## 10. Fraud Detection — **Not Started** (no plan exists)

No match anywhere in code or docs for "fraud" in any form.

## Summary table

| Item | Status | Evidence basis |
|---|---|---|
| GST Verification | Partial | Storage field + UI field exist; zero validation/API logic |
| Udyam Verification | Not Started | Storage field plausibly exists (`msme_number`); nothing reads/writes/validates it |
| Trade Confidence Score | Not Started | No plan exists |
| Escrow Architecture | Not Started | Verified absent by 3 prior audits; design-stage mention only; also out of Bell24h-OS's owned scope per governance record |
| Risk Engine | Not Started | No plan exists |
| Supplier Trust Score | Not Started | No plan exists |
| Buyer Trust Score | Not Started | Verified absent by 3 prior audits |
| Verification Workflows | Not Started | Only unrelated SEO-module `is_verified` fields exist |
| Audit Trail | Partial | Real, widely-used event emitter; no durable storage yet |
| Fraud Detection | Not Started | No plan exists |

## Prioritized recommendation

**P0 — Resolve the scope boundary before building anything.** `OS_INTEGRATION_DECISION_RECORD_V1.md` already assigns Trust/KYB/Escrow/Payment business rules to VyaparSethu, not Bell24h-OS. Confirm this is still the intended split before any of items 1-8 are built here — otherwise this repo would be duplicating a domain another repo already owns, which is exactly the kind of scope/architecture question the constitution says needs a human decision, not an engineering default.

**P1 — Fix the Audit Trail's durability gap first, regardless of the scope question.** It's the one item already Partial and already broadly wired in; a Trust Score or Verification Workflow of any kind will need a queryable evidentiary record, and today's stdout-only emission can't provide one. This is also infrastructure-layer work, squarely inside Bell24h-OS's owned scope per the boundary above — no scope conflict, unlike items 1-8.

**P2 — Don't build Trust/Risk/Fraud scoring before the RFQ workflow itself exists.** Per the separately-confirmed finding in `C4_EXECUTION_READINESS_REPORT.md`: the `buyers`/`suppliers`/`rfqs`/`quotations` tables have zero application-layer code anywhere (no routes, no frontend, no Supabase-client calls) — they are schema-only. A trust score, risk engine, or fraud detector needs real transaction data to score; building scoring logic against a workflow that doesn't run yet would be speculative work with nothing to validate it against. Sequence: RFQ workflow (build) → real transactions (accumulate) → Trust/Risk scoring (build against real data).

**P3 — GST/Udyam verification (real, API-backed) and Escrow.** These are the highest-effort, most compliance-sensitive items (live government API integration, financial custody) and, per the P0 boundary question, may not belong in this repository at all. Lowest priority for Bell24h-OS specifically; revisit only after P0 is resolved and only if the answer keeps this domain here.
