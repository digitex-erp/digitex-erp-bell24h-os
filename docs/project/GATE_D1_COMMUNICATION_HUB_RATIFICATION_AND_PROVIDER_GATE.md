# Gate D.1 — Communication Hub Ratification & Real-Provider Work Gate

> **Provider scope update (owner decision, 2026-09-28):** approved providers are Resend + SMTP (email), Meta WhatsApp Cloud API direct (WhatsApp), and MSG91 (SMS / OTP only). **Twilio and WhatsApp-via-MSG91 are removed from scope** and any reference below to them is superseded. Criterion 4 ("is MSG91 intended for this project") is answered: yes, for SMS/OTP only.

**Repository:** `digitex-erp/digitex-erp-bell24h-os`
**Branch:** `feature/communication-hub` (uncommitted)
**Date:** 2026-09-28
**Type:** Governance review / approval request. No code changed to produce this document.

---

## What this document is — and is not

This is a **recommendation package for the project owner**, not a ratification. Per this repository's own precedent (`GATE_C2_RATIFICATION.md`): *"no engineering session can self-ratify its own governance criteria."* `ARCHITECTURE_DECISIONS.md`'s "Proposed module (unratified): Communication Hub" note and `ENGINEERING_GOVERNANCE.md`'s requirement for an ADR + review-gate approval on architecture changes are both still open. Nothing below closes either. This document exists so the owner can make two separable decisions with the actual evidence in front of them, not so this session can declare itself approved.

## Executive Summary

Two separable questions, and conflating them is the risk to avoid:

1. **Should Communication Hub be ratified as an approved module boundary at all?** — procedural, cheap to answer, and everything built so far (Foundation slice: schema, `ProviderFactory`, two real providers, six API routes, audit logging, retry/dead-letter reuse of the existing queue) is evidence in favor.
2. **Is it safe to start real WhatsApp Cloud API and/or MSG91 (SMS/OTP) provider work (Sprint B phases B.4/B.5)?** — substantive, and the honest answer, checked against evidence, is **no — 1 of 6 gate criteria are met.**

Ratifying (1) must not be read as approving (2). They are asked and answered separately below.

## What was proposed

- `ARCHITECTURE_DECISIONS.md`, "Proposed module (unratified): Communication Hub" — the Foundation slice, reusing existing extension points (queue job types, migration scripts with review evidence), no new module-boundary approval yet.
- `docs/project/BELL24H_OS_COMMUNICATION_HUB_SPRINT_B_PLAN.md` — Sprint B's phased plan, which itself named B.4 (real WhatsApp) and B.5 (real MSG91 SMS/OTP) as requiring this exact gate before starting.

This document is that gate.

## Gate criteria for starting B.4/B.5 (real provider work), with evidence

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Communication Hub module boundary ratified in `ARCHITECTURE_DECISIONS.md` | **NOT MET** | Still marked "Proposed module (unratified)" — no owner sign-off recorded anywhere in the repo |
| 2 | Foundation slice has runtime evidence, not just typecheck | **PARTIALLY MET** | `npm run lint`/`npm run build` pass; SMTP protocol verified against a local mock server (caught and fixed a real crash bug in the process); all 6 API routes verified to return 401 unauthenticated against a running server. **Never run against a live Supabase database** — no live DB connection has been available in this entire session (see `ORG_WIDE_COMMIT_VERIFICATION.md`/S1 Supabase Architecture Validation thread, closed BLOCKED on live evidence for the same reason) |
| 3 | Real provider credentials exist for the specific provider being implemented | **NOT MET** | `SECRET_ROTATION_CHECKLIST.md` (this session): no WhatsApp Cloud API or MSG91 credential has been confirmed to exist for this project. Someone has to obtain one before B.4/B.5 produces working code rather than another well-typed stub |
| 4 | MSG91 is confirmed as actually intended for *this* project | **UNRESOLVED — needs an owner answer, not an engineering guess** | This repo's own `bell24h-verify` skill documents MSG91 phone-OTP as the signature of a *different, unrelated* Bell24h codebase (`Projects/bell24h`, Next.js). This session has already conflated the two projects' documentation once (the `bell24h-verify` skill exists specifically to prevent that). Building `MSG91Provider.ts` for real without this confirmation risks integrating a provider this project never actually needed |
| 5 | Cross-tenant isolation on the new tables demonstrated at runtime | **NOT MET** | Consistent with the project-wide finding in `GATE_C2_RATIFICATION.md` (0 of 4 tenant-isolation criteria met, unchanged since Aug 2026): `communication_providers`, `communication_messages`, etc. have never been queried as a second-tenant user. RLS policies exist in source (`add_communication_hub.sql`) but are unverified live, same gap as every other table in this repository |
| 6 | Abuse/rate-limit protection for outbound messaging designed | **NOT MET — newly identified, not previously raised** | Unlike an internal API call, a real WhatsApp/SMS send has per-message cost and spam/abuse potential (an attacker who reaches `/api/communications/send` could run up a bill or spam real phone numbers). No rate-limiting is designed for this route today — `server/middleware/rateLimit.ts` exists and is used elsewhere (`aiRateLimit` on the AI vault routes) but is not applied to `/api/communications/send` |

**1 of 6 criteria are met** (criterion 2, partially). This is not a regression — it is the honest current state, consistent with this session's evidence-only discipline throughout.

## Two decisions, kept explicitly separate

**Decision A — Ratify the Communication Hub Foundation slice as an approved module boundary**, covering exactly what's built: schema, `ProviderFactory`/`ProviderAdapter`, Resend, SMTP, the 6 API routes, audit logging, and reuse of the existing job queue for retry/dead-letter. This does not extend to WhatsApp or MSG91 SMS/OTP — Meta is a real but unverified adapter (CH-02) and MSG91 remains a stub regardless of Decision A.

**Decision B — Approve or decline starting B.4 (WhatsApp) and/or B.5 (MSG91 SMS/OTP) real provider work.** Given 1 of 6 criteria met, this session's recommendation is **decline for now**, with a named path to revisit: criteria 3 and 4 are the actual blockers (credentials don't exist; MSG91's relevance to this project is unconfirmed) and both need the owner's input, not more engineering.

## Risks

| Risk | If Decision A is skipped | If Decision B is approved anyway (B.4/B.5 start now) |
|---|---|---|
| Governance drift | Communication Hub stays permanently "proposed," and Sprint B/C work keeps building on an unratified foundation | N/A |
| Wasted work | N/A | Building `WhatsAppCloudProvider.ts`/`MSG91Provider.ts` against no real credential produces another stub-shaped file, not working code — the same category of non-outcome this repo's constitution explicitly warns against ("no fabricated success paths") |
| Wrong integration | N/A | If MSG91 turns out to be irrelevant to this project (criterion 4), the work is thrown away, and worse, risks re-introducing the exact project-conflation `bell24h-verify` was written to prevent |
| Cost/abuse exposure | N/A | Real messaging providers bill per message and can be abused for spam; shipping B.4/B.5 without criterion 6 (rate limiting) live is a real production risk, not a hypothetical one |

## Approval recommendation

**To the project owner:**

1. **Approve Decision A** — ratify the Foundation slice as built. It is real, verified (within the limits stated in criterion 2), and follows every existing convention in this codebase (secrets never in the database, RLS on every table, `ProviderAdapter` pattern for extensibility).
2. **Decline Decision B for now.** Recommend resolving criteria 3 and 4 first (obtain real credentials; confirm MSG91 is actually wanted here) before any B.4/B.5 engineering work starts. This is not a rejection of Sprint B — it's sequencing B.4/B.5 after the two things only the owner can supply.
3. **Do not treat this document as ratification.** A dated sign-off below (or a short addendum) is what converts this from a recommendation into a ratified record.

**Sign-off (to be completed by the owner, not by this session):**

```
Decision A (ratify Foundation slice as an approved module boundary):
  [ ] Approved   [ ] Rejected   [ ] Amended — describe:

Decision B (approve starting B.4 WhatsApp real provider work):
  [ ] Approved   [ ] Declined for now   [ ] Approved with conditions — describe:

Decision B (approve starting B.5 MSG91 SMS/OTP real provider work):
  [ ] Approved   [ ] Declined for now   [ ] Approved with conditions — describe:

Confirmation: is MSG91 actually intended for this project (digitex-erp-bell24h-os),
as distinct from the unrelated Next.js Bell24h codebase?
  [ ] Yes, MSG91 is intended here   [ ] No — drop MSG91 from this module's scope   [ ] Unsure — investigate further

Signed:
Date:
```

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
