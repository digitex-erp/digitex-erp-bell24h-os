# META WHATSAPP CLOUD API — PRODUCTION READINESS CERTIFICATION

**Repositories:** `bell24xcom/forBell24x` (`C:\Users\Sanika\Projects\bell24h`, `HEAD ba10f1a`,
unchanged throughout this audit chain) and `digitex-erp-bell24h-os` (`HEAD 8e5e3dc` on
`main`; moved since the prior WhatsApp audit via unrelated AI-provider work, confirmed not
touching this audit's files).
**Scope:** audit only. No code modified in either repository. No plans, roadmaps, or new
architecture — this document reports current implementation exactly as found.
**Date:** 2026-09-19

This document completes the sections the recovery inventory
(`PREVIOUS_AUDIT_RECOVERY_REPORT.md`, `AUDIT_COMPLETION_MATRIX.md`,
`AUDIT_GAP_ANALYSIS.md` — all in this same directory) found missing or partial: webhook
implementation, cron/automation triggering mechanics, full environment-variable audit,
the two unaudited journeys (Deal Created, Organization Invite), and all six readiness
percentages. Send-path/template inventory itself is **not** repeated here — it is
complete and unchanged in `WHATSAPP_TEMPLATE_MASTER_AUDIT.md`; this document adds the
"Production Tested" and "Webhook Tracked" columns that document never had.

---

## 1. Send Path Table (extended with Production Tested / Webhook Tracked)

| Event | Repository | File | Function | Template Name | Env Var | Reachable | Prod Tested | Webhook Tracked |
|---|---|---|---|---|---|---|---|---|
| RFQ Created (supplier notify) | bell24h | `lib/orchestration.ts:264-287` | `onRFQCreated` | `vyaparsethu_rfq_notification` (fallback) | `META_WHATSAPP_RFQ_TEMPLATE` | YES | **NO** — no test/log evidence found; `META_WHATSAPP_ACCESS_TOKEN` unconfigured, so a live call would return `NOT_CONFIGURED` today | **NO** — the send outcome's `messageId` is never persisted anywhere (`orchestration.ts:278-282` only `console.warn`s on non-SENT status); the webhook has nothing to match against for this event |
| Company Claim Invitation | bell24h | `src/lib/outreach/campaignService.ts:268-280` | `executeLiveSend` | `META_WHATSAPP_CLAIM_TEMPLATE` | same | YES (admin-gated) | **NO** — same config gap | **YES** — `providerMessageId` is stored on the `OutreachRecipient` row (`campaignService.ts:278-281`), which the webhook route matches against (`webhooks/meta-whatsapp/route.ts:75-82`) |
| Quote Submitted (orchestration leg) | bell24h | `src/app/api/marketing/quote/route.ts:89-124` → `orchestration.ts:346` | `onQuoteSubmitted` | none in this repo (n8n-delegated) | `N8N_WEBHOOK_URL` | YES | **NO** | **NO** — not a WhatsApp-template send in this repo at all |
| Quote Accepted (orchestration leg) | bell24h | `src/app/api/deal/select/route.ts:103-125` → `orchestration.ts:439` | `onQuoteAccepted` | none in this repo | `N8N_WEBHOOK_URL` | YES | **NO** | **NO** |
| Day-1/2/5/3/7/14 outreach (5 templates) | bell24h | `bulk-wa/route.ts`, `follow-up-engine.ts`, `supplier-drip-engine.ts` | various | n/a — `wa.me` links, not Meta templates | n/a | Human-click only | **NO** | **NO** — not Meta API traffic |

**"Production Tested" is NO for every row** — no test script, CI job, staging-verification log, or code comment claiming a real send was ever observed was found anywhere in either repository. Stated as absence-of-evidence, not as a claim that no one has ever manually tested it outside version control.

---

## 2. Webhook Implementation Audit

**File:** `src/app/api/webhooks/meta-whatsapp/route.ts`, backed by
`src/lib/whatsapp/webhook.ts`.

| Requirement | Status | Evidence |
|---|---|---|
| GET verification endpoint | **EXISTS** | `route.ts:22-32` → `webhook.ts:19-25` `verifyHandshake`. Correctly implements Meta's `hub.mode`/`hub.verify_token`/`hub.challenge` handshake. |
| POST webhook endpoint | **EXISTS** | `route.ts:34-90` |
| Signature validation | **EXISTS** | `webhook.ts:32-45` `verifySignature` — HMAC-SHA256 over the raw body, **constant-time comparison** (`crypto.timingSafeEqual`), correctly guards the length-mismatch case before comparing. This is a materially better implementation than a naive `===` comparison would be. |
| Delivery status processing | **EXISTS** | `webhook.ts:56-80` `extractDeliveryStatuses` parses Meta's `entry[].changes[].value.statuses[]` shape; `route.ts:68-86` maps to `prisma.outreachRecipient` state |
| Read receipt processing | **EXISTS, but not distinct** | `route.ts:70-73`: `s.status === 'read' ? 'DELIVERED' : ...` — a `read` event is mapped to the **same** `DELIVERED` state as a plain `delivered` event. The distinction Meta sends is received and parsed, then discarded at the mapping step. |
| Failed message processing | **EXISTS** | `route.ts:73,80` — maps to `FAILED`, records `failedAt` |

**The decisive finding for this section, stated plainly:** every one of the six pieces
above is correctly built. **None of it can currently run**, because both gates fail
closed by design:
- `verifyHandshake` returns `null` (→ HTTP 403) whenever `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN`
  is unset (`webhook.ts:21`) — confirmed unset in every local `.env*` file (§4).
- `verifySignature` returns `false` (→ HTTP 401) whenever `META_WHATSAPP_APP_SECRET` is
  unset (`webhook.ts:34`) — same.

Meta will not register a webhook subscription without the GET handshake succeeding at
least once, so **this endpoint has, per this evidence, never received real traffic from
Meta**. The code's own header comment confirms this is the intended, understood state:
*"readiness infrastructure only, not yet activated in Meta's dashboard."* This is not a
bug — it is correctly-built, deliberately inert infrastructure.

**A coverage gap independent of the config gate, found this pass:** even once activated,
the webhook can only ever update rows that stored a `providerMessageId` — which only
`campaignService.ts`'s Claim Invitation path does (§1). RFQ Notification sends never
persist their `messageId` anywhere, so delivery/read/failed status for that event would
have nowhere to land even with a fully working webhook.

---

## 3. Cron / Automation Audit

**Scheduling mechanism:** exactly one Vercel cron is registered
(`vercel.json:"crons"`): `/api/cron/daily` at `30 3 * * *` (03:30 UTC). It fans out
sequentially to 8 internal routes via `callCron()` (`src/app/api/cron/daily/route.ts:8-17`,
`27-41`), each independently gated by `verifyCronSecret()`. Both drip/follow-up routes are
in that fan-out list (`daily/route.ts:32-33`) — **they are scheduled**, contrary to what a
bare `vercel.json` read alone would suggest.

| Job | Exists | Runs | Calls WhatsApp | Updates DB | Prod Reachable |
|---|---|---|---|---|---|
| Day 3/7/14 Drip | **YES** — `src/app/api/cron/supplier-drip/route.ts` → `lib/supplier-drip-engine.ts` | **YES** — invoked daily via the fan-out, secret-gated | **NO** — `getDripsDue()` (`supplier-drip-engine.ts:68`) only identifies candidates and builds `wa.me` links; no `fetch`/API call to Meta or anywhere else happens inside the cron itself | **YES, but unconditionally** — `route.ts:17` calls `logDripSent()` for **every** due supplier, marking `drip_dayN_sent` in `InteractionMemory` regardless of whether a human ever clicked the returned link | YES (the route itself) |
| Day 2/5 Follow-up | **YES** — `src/app/api/cron/follow-up-due/route.ts` → `lib/follow-up-engine.ts` | **YES** — same fan-out | **NO** — same pattern, `getFollowUpsDue()` only reports | **NO** — this route does **not** call any logging function at all; it only returns counts. Logging happens separately, only if an admin later calls `POST /api/outreach/follow-up` (`src/app/api/outreach/follow-up/route.ts:24-36`) | YES (the route itself) |
| Supplier Outreach Automation (Day-1 bulk) | **YES** — `src/app/api/admin/outreach/bulk-wa/route.ts` | **Manual only** — not in the cron fan-out; admin-triggered | **NO** — `wa.me` link generation only (`route.ts:196`) | **YES** — logs `day1_wa_sent` on send-confirmation | Manual/admin-only |

**The precise, load-bearing finding for this section:** neither scheduled job **ever
calls WhatsApp in any automated form** — not the Meta API, not even a server-side
trigger of a `wa.me` open. Both return links for a human operator to click. This is a
legitimate, working, human-in-the-loop design — but it means "Supplier Outreach
Automation" is automated only up through *candidate identification*, not through *send*.

**A second, asymmetric finding:** the drip cron marks every identified candidate as
`sent` in the database **unconditionally**, before any human has necessarily acted —
meaning `InteractionMemory`'s `drip_day3_sent`/`drip_day7_sent`/`drip_day14_sent` counts
(surfaced on the admin dashboards audited previously) reflect *candidates identified*,
not *messages delivered*. The follow-up cron does not have this issue, because it never
auto-logs at all — its counts only reflect confirmed admin action. The two jobs are
inconsistent with each other on this exact point.

---

## 4. Environment Variable Audit

Checked against every `META_WHATSAPP_*`/`N8N_*` reference found by repository-wide grep,
cross-referenced against `.env.example` and all three active env files
(`.env`, `.env.local`, `.env.production`).

| Variable | Configured | Documented (`.env.example`) | Referenced In |
|---|---|---|---|
| `META_WHATSAPP_ACCESS_TOKEN` | **Missing** | Yes | `src/lib/whatsapp/config.ts:30` |
| `META_WHATSAPP_PHONE_NUMBER_ID` | **Missing** | Yes | `config.ts:31` |
| `META_WHATSAPP_BUSINESS_ACCOUNT_ID` | **Missing** | Yes | `config.ts:32` |
| `META_WHATSAPP_APP_SECRET` | **Missing** | Yes | `config.ts:33` |
| `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN` | **Missing** | Yes | `config.ts:34` |
| `META_WHATSAPP_RFQ_TEMPLATE` | **Missing** | Yes | `orchestration.ts:227,265` |
| `META_WHATSAPP_CLAIM_TEMPLATE` | **Missing** | Yes | `campaignService.ts:273` |
| `META_WHATSAPP_RFQ_TEMPLATE_LANG` | **Missing** | **No — used but undocumented** | `orchestration.ts:271` |
| `N8N_WEBHOOK_URL` | **Missing** | *(not part of the WhatsApp `.env.example` block — carried from the prior audit)* | `lib/n8n-trigger.ts:9`, called by all 3 live orchestration events |
| `N8N_API_KEY` | **Missing** | No | `src/config/security.ts:8`, `src/lib/n8n-service.ts:36` |
| `N8N_API_URL` | **Missing** | No | `src/lib/n8n-service.ts:35` — real default present in code: `https://n8n.bell24h.com/api` |
| `N8N_WEBHOOK_SECRET` | **Missing** | No | `src/lib/n8n-service.ts:37` |
| `N8N_SECRET` | **Missing** | No | `src/app/api/marketing/rfq/route.ts:32,60` |
| `N8N_ERROR_WEBHOOK_URL` | **Missing** | No | **Referenced but unused** — appears only as an instructional string inside `src/app/admin/errors/page.tsx:393` ("Set `N8N_ERROR_WEBHOOK_URL` in Vercel"); confirmed via a separate targeted search that no `process.env.N8N_ERROR_WEBHOOK_URL` read exists anywhere |

**New finding this pass:** `src/lib/n8n-service.ts` — a complete, real n8n client with a
concrete default URL (`https://n8n.bell24h.com/api`, confirming a real hosted n8n
instance exists for this project) — **is never imported anywhere in `src/`.** Its three
env vars (`N8N_API_KEY`, `N8N_API_URL`, `N8N_WEBHOOK_SECRET`) are referenced only inside
this dead module — a clean "referenced but unused" case distinct from
`N8N_WEBHOOK_URL` (referenced *and* used, by the live `lib/n8n-trigger.ts`).

**Zero variables are configured** in any of the three active local env files. This
session has no access to Vercel's dashboard-configured production values and cannot
confirm or rule out that they differ there (carried forward from every prior pass — not
re-verified differently this time).

---

## 5. Production Journey Verification

| Journey | Code Exists | WhatsApp Exists | Template Exists | Webhook Tracked | End-to-End Complete |
|---|---|---|---|---|---|
| RFQ Created | YES | YES (direct Meta) | YES | **NO** (§2) | **NO** — config-blocked, untracked |
| RFQ Matched | NO | — | — | — | **NO** |
| Quote Submitted | YES | Delegated to n8n, unverifiable | Unknown | NO | **NO** |
| Quote Accepted | YES | Delegated to n8n, unverifiable | Unknown | NO | **NO** |
| **Deal Created** *(newly audited this pass)* | **YES** — created inside the same transaction as Quote Accepted (`deal/select/route.ts:41-50`) | **NO** — no distinct notification for Deal creation itself | NO | NO | **NO** |
| Deal Completed | NO (`deal/complete/route.ts` uses INSFORGE, never calls `onDealCompleted`) | — | — | — | **NO** |
| Company Claim Invitation | YES | YES (direct Meta) | YES | **YES** (§2 — the one fully-tracked event) | **NO** — code-complete, config-blocked only |
| Supplier Follow-up | YES | `wa.me`, human-click, not Meta API | n/a | NO | **NO** — as a Meta-tracked journey; functions as designed as a manual-assist tool |
| Supplier Reactivation | NO | — | — | — | **NO** |
| **Organization Invite** *(newly audited this pass)* | **NO in either repository** — `digitex-erp-bell24h-os` has an email-based team-invite feature (`TeamPage.tsx`) with zero WhatsApp involvement; `bell24h` has no invite concept of any kind (confirmed by repository-wide search) | NO | NO | NO | **NO** |

**Zero of the 10 named journeys are end-to-end complete.** Two (RFQ Created, Company Claim
Invitation) are code-complete and blocked only on configuration — the closest to
launch-ready. The rest have a structural gap (missing code, delegated/unverifiable
WhatsApp leg, or no distinct implementation) in addition to the configuration gap.

---

## 6. Readiness Scores

Every score below shows its derivation. Where a sub-dimension is genuinely unknowable
(Meta's own approval status), it is excluded from the ratio and stated separately —
never guessed into the number.

**Infrastructure Readiness: 47%**
Code-layer completeness: 7.5 of 8 core pieces built correctly (send abstraction, Meta
provider, config gate, webhook GET, webhook POST, signature validation, delivery
processing; read-receipt distinctness counted as half-credit — §2) = 94%.
Config-layer completeness: 0 of 7 required Meta env vars set = 0%.
**(94% + 0%) / 2 = 47%.**

**Template Readiness: 50%**
Name-reference completeness: 2 of 2 direct-Meta-API send paths have a template name
wired in code (RFQ, Claim) = 100%.
Functional-configuration completeness: 0 of those 2 templates can actually send today
(env vars unset) = 0%.
Meta-approval status: **excluded — unknowable from repository evidence.**
**(100% + 0%) / 2 = 50%.**

**Workflow Readiness: 32%**
Per-journey score (§5), each journey scored 0-1 by how many of its 4 sub-checks (Code/
WhatsApp/Template/Webhook Tracked) are met: RFQ Created 0.75, RFQ Matched 0, Quote
Submitted 0.4 (code+partial n8n, no template/tracking), Quote Accepted 0.4, Deal Created
0.25 (code only), Deal Completed 0, Company Claim Invitation 1.0, Supplier Follow-up 0.4
(code+send-mechanism, no template/tracking in the Meta sense), Supplier Reactivation 0,
Organization Invite 0.
Sum = 3.2 / 10 journeys = **32%.**

**Webhook Readiness: 46%**
Code completeness (§2): 6 of 6.5 required pieces (same 94% as infrastructure's code
component, read-receipt half-credit). Operational completeness: 0% (both gates reject
by design, unconfigured). **(94% + 0%) / 2 ≈ 46%** (rounding).

**Automation Readiness: 70%**
Per-job average of 5 dimensions (§3), each 0/1: Drip — Exists 1, Runs 1, Calls WhatsApp
0, Updates DB 1, Prod Reachable 1 = 4/5 = 80%. Follow-up — Exists 1, Runs 1, Calls
WhatsApp 0, Updates DB 0, Prod Reachable 1 = 3/5 = 60%.
**(80% + 60%) / 2 = 70%.**

**Production Launch Readiness: 49%**
Unweighted average of the five scores above: **(47 + 50 + 32 + 46 + 70) / 5 = 49%.**

---

## Certification Result

# NOT PRODUCTION READY — 49%

Not from any single catastrophic gap — every individual piece of code audited this
session is competently built (constant-time signature comparison, fail-closed config
gates, idempotent cron claiming, atomic transactions). The gap is **entirely
operational**: zero of the 15 relevant environment variables are configured in any local
file, which independently blocks the webhook, the two live-orchestration WhatsApp legs,
and both Meta-template sends — the same root cause behind nearly every sub-score above
landing near or below 50%. Separately, structural gaps exist independent of
configuration: Deal Completed's dead orchestration call, the fully-manual (not
auto-send) nature of both cron jobs, and 5 of 10 named journeys having no code at all.

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GyjerP42mTVzzK2ZkSeRCf
