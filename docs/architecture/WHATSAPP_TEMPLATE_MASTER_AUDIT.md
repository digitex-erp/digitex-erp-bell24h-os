# WhatsApp Template Master Audit — Bell24h Ecosystem

**Repositories audited:**
1. `bell24xcom/forBell24x` (VyaparSethu) — local: `C:\Users\Sanika\Projects\bell24h`, `HEAD ba10f1a`
2. `digitex-erp-bell24h-os` (Bell24h-OS) — this session's working repo, `HEAD 6127418`

**Scope:** audit only. No code modified in either repository, nothing deployed, no commits made to `bell24h`. This document is committed to `digitex-erp-bell24h-os` only, as the durable record — consistent with this session's practice for cross-repository audits.

**Date:** 2026-09-15

---

## Correction from the prior audit, stated first

Since the last WhatsApp audit this session, `bell24h` received a new commit
(`ba10f1a`, "fix(rfq): wire quote submission and acceptance into orchestration on the
real production endpoints") — **from a different Claude Code session, not this one**
(co-authored by `session_01EKXCrqwemsSYDY5XEiU6df`). Verified by direct diff inspection,
not the commit message alone:

- `src/app/api/deal/select/route.ts` now imports and calls `onQuoteAccepted()` after its
  existing transaction — this is the real, confirmed-reachable endpoint both frontend
  call sites (`dashboard/quotes/page.tsx`, `rfq/[id]/page.tsx`) use.
- `src/app/api/marketing/quote/route.ts` now imports and calls `onQuoteSubmitted()`,
  guarded on `supplier_id` being present. Checked directly: `src/app/quote/[token]/page.tsx`
  always populates and sends `supplier_id` from the resolved token context — the guard is
  satisfied in the normal flow, so this is genuinely reachable, not merely conditionally so.

**Net effect:** the notification/n8n-trigger legs of Quote Submitted and Quote Accepted,
previously certified as dead code in this session's prior two audits, are **now live in
production**. This does not change the WhatsApp-specific finding for these two events —
WhatsApp delivery for both remains delegated to an external n8n workflow this repository
cannot audit (unchanged). The old wiring in `src/app/api/rfq/quotes/route.ts` (audited
previously) is now **redundant, duplicate dead code** — a second, unreachable
implementation of the same orchestration calls the real endpoints now also make.
`src/app/api/deal/complete/route.ts` is unaffected by this commit (last touched by an
unrelated fix) — still INSFORGE-only, still never calls `onDealCompleted()`.

---

## Template Approval Matrix

| Template Name | Meta Category | Repository | File Path | Function | Trigger Event | Variables Required | Direct Meta API / Bell24h-OS / n8n | Prod Reachable | Current Status | Priority | Required Before Launch |
|---|---|---|---|---|---|---|---|---|---|---|---|
| RFQ Supplier Notification | Utility | bell24h | `lib/orchestration.ts:264-287` | `onRFQCreated` | RFQ Created | supplier name, RFQ title, quote link | **Direct Meta API** | **Yes** | IMPLEMENTED (env vars empty locally — see caveat) | P0 | **Yes** |
| Company Claim Invitation | Marketing | bell24h | `src/lib/outreach/campaignService.ts:268-274` | `executeLiveSend` | Admin campaign → LIVE | company name, city, claim URL | **Direct Meta API** | Conditional (admin-gated) | IMPLEMENTED | P1 | No (growth, not launch-blocking) |
| Quote Submitted (buyer notify) | Utility | bell24h | `src/app/api/marketing/quote/route.ts:89-124` (new) → `lib/orchestration.ts:346` | `onQuoteSubmitted` | Supplier submits quote via `/quote/[token]` | buyer id, quote price/timeline | In-app + email direct; **WhatsApp via n8n** (unverifiable) | **Yes — newly confirmed this turn** | PARTIAL — orchestration live, WhatsApp leg unauditable | P0 | **Yes** |
| Quote Accepted (both parties) | Utility | bell24h | `src/app/api/deal/select/route.ts:103-125` (new) → `lib/orchestration.ts:439` | `onQuoteAccepted` | Buyer accepts quote via Deal Select | supplier/buyer id, price, RFQ title | In-app + email direct; **WhatsApp via n8n** (unverifiable) | **Yes — newly confirmed this turn** | PARTIAL — orchestration live, WhatsApp leg unauditable | P0 | **Yes** |
| Deal Completed | Utility | bell24h | `src/app/api/deal/complete/route.ts` (uses INSFORGE, not Prisma) | — (never calls `onDealCompleted`) | Buyer confirms deal complete | — | **Unwired** — no direct call, no n8n trigger fires | **No** | DEAD CODE (unaffected by the new commit) | P1 | **Yes** |
| Quote Rejected | Utility | bell24h | `lib/orchestration.ts:620` | `onQuoteRejected` | Buyer rejects a quote | supplier id, quote price | — | **No** — never invoked anywhere | DEAD CODE | P2 | No |
| Counter Offer | Utility | bell24h | `lib/orchestration.ts:642` | `onCounterOffer` | Supplier counters | buyer id, price, timeline | — | **No** — never invoked anywhere | DEAD CODE | P2 | No |
| (superseded) RFQ Quotes PUT/POST orchestration | — | bell24h | `src/app/api/rfq/quotes/route.ts:12,193,284` | `onQuoteSubmitted`/`onQuoteAccepted` (duplicate call sites) | — | — | — | **No** — no frontend caller (confirmed both this and prior audit) | **DUPLICATE, DEAD CODE** — same orchestration now correctly wired elsewhere (see correction above) | P3 | No — should be removed, not fixed |
| Day-1 Bulk Outreach | *n/a — wa.me* | bell24h | `src/app/api/admin/outreach/bulk-wa/route.ts:196` | (route handler) | Admin bulk outreach | phone, message text | **Not Meta API** — click-to-chat link | Yes (human-click) | IMPLEMENTED, non-Meta | P2 | No |
| Day-2 / Day-5 Follow-up | *n/a — wa.me* | bell24h | `lib/follow-up-engine.ts:173` | `buildFollowUpMessage` | 2/5 days, no quote | supplier name, RFQ title/category | **Not Meta API** | Yes (human-click) | IMPLEMENTED, non-Meta | P2 | No |
| Day-3 / 7 / 14 Drip | *n/a — wa.me* | bell24h | `lib/supplier-drip-engine.ts:65` | `buildDripMessage` | Behavior-gated timers | supplier name, category | **Not Meta API** | Yes (human-click) | IMPLEMENTED, non-Meta | P2 | No |
| RFQ Matched (distinct event) | Utility | bell24h | — | — | — | — | — | — | **MISSING** | P1 | Yes |
| RFQ Expiring | Utility | bell24h | — | — | — | — | — | — | **MISSING** | P2 | No |
| RFQ Closed | Utility | bell24h | — | — | — | — | — | — | **MISSING** | P2 | No |
| Deal Created (distinct from acceptance) | Utility | bell24h | — | — | — | — | — | — | **MISSING** | P2 | No |
| Deal Cancelled | Utility | bell24h | — | — | — | — | — | — | **MISSING** | P2 | No |
| Supplier Registered | Utility | bell24h | — | — | — | — | — | — | **MISSING** (confirmed via `auth/kyc/route.ts` check — zero whatsapp/notif/n8n refs) | P1 | Yes |
| Supplier Approved | Utility | bell24h | — | — | — | — | — | — | **MISSING** | P1 | Yes |
| Supplier Rejected | Utility | bell24h | — | — | — | — | — | — | **MISSING** | P2 | No |
| Supplier Verification Required | Utility | bell24h | — | — | — | — | — | — | **MISSING** | P1 | Yes |
| Supplier KYC Reminder | Utility | bell24h | — | — | — | — | — | — | **MISSING** | P2 | No |
| Supplier Profile Completion | Utility | bell24h | — | — | — | — | — | — | **MISSING** | P2 | No |
| Buyer Registered | Utility | bell24h | — | — | — | — | — | — | **MISSING** | P1 | Yes |
| Buyer Verification | Utility | bell24h | — | — | — | — | — | — | **MISSING** | P2 | No |
| Buyer Profile Completion | Utility | bell24h | — | — | — | — | — | — | **MISSING** | P2 | No |
| CRM New Message | Utility | bell24h | `src/lib/crm/company-timeline.ts` (read-only display only) | — | — | — | — | — | **MISSING** (send capability) | P2 | No |
| CRM Conversation Reminder | Utility | bell24h | — | — | — | — | — | — | **MISSING** | P3 | No |
| CRM Lead Created | Utility | bell24h | — | — | — | — | — | — | **MISSING** | P3 | No |
| CRM Lead Assigned | Utility | bell24h | — | — | — | — | — | — | **MISSING** | P3 | No |
| CRM Lead Follow-up | Utility | bell24h | — | — | — | — | — | — | **MISSING** | P3 | No |
| Supplier Reactivation | Marketing | bell24h | — | — | — | — | — | — | **MISSING** | P2 | No |
| Buyer Reactivation | Marketing | bell24h | — | — | — | — | — | — | **MISSING** | P2 | No |
| Premium Upgrade Offer | Marketing | bell24h | — | — | — | — | — | — | **MISSING** | P3 | No |
| OTP Login | Authentication | — | `src/lib/outreach/OutreachService.ts:10` (self-documented) | — | — | — | **MSG91 SMS, not WhatsApp, in either repo** | N/A | **MISSING as a WhatsApp template** | P3 | No |
| OTP Verification | Authentication | — | same | — | — | — | Same | N/A | **MISSING** | P3 | No |
| Password Reset | Authentication | — | — | — | — | — | — | — | **MISSING** | P3 | No |
| Notification Generic | Utility | digitex-erp-bell24h-os | — | — | — | — | **Bell24h-OS** (target, unbuilt) | — | **MISSING** — Communication Hub not yet authorized | P3 | No |
| Workflow Started / Completed | Utility | digitex-erp-bell24h-os | — | — | — | — | **Bell24h-OS** (target, unbuilt) | — | **MISSING** | P3 | No |
| Task Assigned / Completed | Utility | digitex-erp-bell24h-os | — | — | — | — | **Bell24h-OS** (target, unbuilt) | — | **MISSING** | P3 | No |

**Env-var caveat, carried forward and still unresolved:** `META_WHATSAPP_ACCESS_TOKEN`,
`META_WHATSAPP_PHONE_NUMBER_ID`, `META_WHATSAPP_BUSINESS_ACCOUNT_ID` are empty in every
local `.env*` file in the `bell24h` working copy. No tool access exists to confirm or rule
out the live Vercel deployment's dashboard-configured values.

---

## Classification

**A. Required Today (current production, if functioning as designed):**
RFQ Supplier Notification, Quote Submitted, Quote Accepted. All three now have real,
reachable orchestration (per the correction above) — RFQ Notification's WhatsApp leg is
direct Meta API (config-blocked); Quote Submitted/Accepted's WhatsApp legs are
n8n-delegated (unverifiable, but the trigger itself now fires).

**B. Required Before Marketplace Launch:**
Deal Completed (fix the dead-code gap), RFQ Matched, Supplier Registered/Approved/
Verification Required, Buyer Registered. These are the minimum set to make the core
RFQ→Quote→Deal→Supplier/Buyer lifecycle honestly complete, not just the currently-wired
subset.

**C. Required For Admin Marketing & Outreach:**
Company Claim Invitation (already implemented), the 5 wa.me-based outreach templates
(already implemented, non-Meta), Supplier/Buyer Reactivation, Premium Upgrade Offer.

**D. Required For Bell24h-OS Shared Communication Hub:**
Notification Generic, Workflow Started/Completed, Task Assigned/Completed, plus (if
WhatsApp-OTP is ever chosen over the current SMS/MSG91 path) OTP Login/Verification,
Password Reset. **All of D is gated on the Communication Hub itself being founder-
authorized** — per `BELL24H_COMMUNICATION_HUB_IMPLEMENTATION_PLAN.md`, this remains a
future, not-yet-approved phase independent of any template work.

**E. Future / Planned / Dead Code:**
Quote Rejected, Counter Offer (both written, never invoked), the superseded
`rfq/quotes/route.ts` duplicate wiring (should be removed, not fixed — the real endpoints
now carry this logic), RFQ Expiring/Closed, Deal Created/Cancelled, remaining KYC/profile-
completion events, all CRM send-capability events.

---

## Identify

- **Missing templates:** 22 of the 33 named business events across both repositories have
  zero implementation of any kind (Meta template, n8n-delegated, or wa.me link).
- **Duplicate templates:** `src/app/api/rfq/quotes/route.ts`'s `onQuoteSubmitted`/
  `onQuoteAccepted` wiring is now a duplicate, unreachable implementation of logic the real
  endpoints (`marketing/quote`, `deal/select`) correctly call — a maintenance hazard (a
  future edit to one could silently diverge from the other) more than a functional gap.
- **Unused templates:** none found — `META_WHATSAPP_RFQ_TEMPLATE` and
  `META_WHATSAPP_CLAIM_TEMPLATE` are the only two named template-config variables in the
  codebase, and both are referenced by real, reachable call sites.
- **Templates referenced but not approved:** cannot be determined from this repository.
  "Approved" is a Meta Business Manager state this session has no visibility into — the
  code only shows *configured* (env var present) vs. *referenced* (call site exists), never
  Meta's own approval status. Stated as an evidence-tier limit, not a finding either way.
- **Templates approved but not used:** same limit — unknowable from repository evidence
  alone.
- **Templates needed by outreach sequences:** the 5 wa.me-based Day-1/2/5/7/14 templates
  already exist and work; converting any of them to real Meta templates (to remove the
  human-click step) is an optional automation upgrade, not a gap being reported here.
- **Templates needed by company claim campaigns:** none beyond what's implemented — the
  Claim Invitation template and its admin-gated state machine are complete.
- **Templates needed by supplier acquisition workflows:** Supplier Registered, Approved,
  Verification Required — all three currently missing, all three block a clean acquisition
  funnel narrative even though the outreach (pre-registration) side is well built.
- **Templates needed by the RFQ → Quote → Deal journey:** RFQ Matched (distinct from mass
  notify) and Deal Completed (fix the dead INSFORGE-only route) are the two gaps that would
  make this specific journey read as complete end-to-end; everything else in the journey
  (RFQ Created, Quote Submitted, Quote Accepted) is now live per the correction above.

---

## Final Output

**1. Exact number required today:** 3 (RFQ Notification, Quote Submitted, Quote Accepted — all now confirmed reachable)

**2. Exact number required before launch:** 8 (the 3 above + Deal Completed, RFQ Matched, Supplier Registered/Approved/Verification Required, Buyer Registered — 3 + 5, using the corrected reachability from this audit)

**3. Exact number required for Bell24h-OS:** 8 (Notification Generic, Workflow Started/Completed, Task Assigned/Completed, OTP Login/Verification, Password Reset — all gated on Communication Hub authorization)

**4. Recommended Meta submission order:**
1. RFQ Supplier Notification (already coded, just needs live env vars — fastest path to a working template)
2. RFQ Matched, Deal Completed (Utility category, tied to code fixes already scoped)
3. Supplier Registered/Approved/Verification Required, Buyer Registered (new build + submission)
4. Company Claim Invitation's template (if not already Meta-approved — unknowable from here) plus Supplier/Buyer Reactivation, Premium Upgrade Offer (Marketing category, slower review)
5. Bell24h-OS's Table D — only after the Communication Hub itself is authorized

**5. Phase 0-3 submission plan:**
- **Phase 0 (code fixes, zero Meta involvement):** confirm live Meta env vars for RFQ Notification; fix `deal/complete` to call `onDealCompleted`; remove the duplicate `rfq/quotes/route.ts` orchestration wiring.
- **Phase 1 (Utility templates, launch-blocking):** submit RFQ Matched, Deal Completed, Supplier Registered/Approved/Verification Required, Buyer Registered to Meta.
- **Phase 2 (Marketing templates, growth):** submit Supplier/Buyer Reactivation, Premium Upgrade Offer; decide whether any wa.me outreach template should become a real Meta template.
- **Phase 3 (Bell24h-OS):** blocked until the Communication Hub is founder-authorized; not a Meta-timeline item until then.

**6. Gap analysis between approved templates and required templates:** cannot be computed precisely — "approved" isn't knowable from this repository (see Identify, above). What *is* knowable: of the 33 named business events, 2 have a real Meta template referenced in code (RFQ Notification, Claim Invitation), 2 more now have live orchestration but an unauditable WhatsApp leg (Quote Submitted, Quote Accepted), 5 work via non-Meta wa.me links, 3 are dead code, and 22 are entirely unbuilt.

**7. Final recommended template inventory for the entire Bell24h ecosystem:** the 8 items in "Required before launch" (output #2) plus the 8 items gated on Bell24h-OS's Communication Hub (output #3) — **16 templates total** represent the complete, business-justified inventory this audit can currently ground in named events; everything in Classification E is deferred, not recommended for near-term submission.

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GyjerP42mTVzzK2ZkSeRCf
