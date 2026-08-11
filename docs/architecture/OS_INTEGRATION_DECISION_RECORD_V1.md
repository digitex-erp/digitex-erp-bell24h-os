# Bell24h-OS ↔ VyaparSethu
# OS Integration Decision Record v1.0

**Date:** 2026-08-11
**Repository:** `digitex-erp/digitex-erp-bell24h-os`
**Branch:** `main`
**HEAD:** `2dd23563b49640330a9673ad11b2fbc20eeb6f79` (unchanged by this task)

**Note on workspace path:** this task's header cited workspace
`C:\Users\Sanika\digitex-erp\digitex-erp-bell24h-os`. The actual, git-verified working
tree for this repository is `C:\Users\Sanika\digitex-erp-bell24h-os` (no intermediate
`digitex-erp\` segment) — confirmed via `git rev-parse --show-toplevel` this turn. This
record was produced against the correct, actual repository; the path in the task header
appears to be a minor transcription difference, not evidence of a second location.

---

## 1. Purpose

This record exists to prevent implementation of a Bell24h-OS ↔ VyaparSethu integration
before the cross-system decisions it depends on have actually been made. The governing
sequence for this work is evidence → founder decision → architecture → implementation →
test → deploy, and this document is deliberately the second step, not the fourth. It
contains no new code, no credentials, no schema changes, and no architectural design —
only the evidence needed to make four specific decisions, and the decisions themselves
framed as options for the founder, not as choices already made on the founder's behalf.

## 2. Evidence Hierarchy

Applied throughout, strongest first: **runtime > live deployment > current source >
schema > architecture docs > historical docs > assumption.** Where a claim rests on
architecture-doc-level evidence rather than runtime/deployment/source, that is stated
explicitly rather than presented as verified fact.

## 3. Current Verified State

**Bell24h-OS:** a Vite + React SPA with a single Express server. Real, narrow,
runtime-tested server-side AI execution (Gemini only, text/JSON) behind
`server/ai/ProviderRouter.ts`; a fail-closed user-authentication boundary
(`requireAuth.ts`) verified at runtime this session (unauthenticated requests to
protected routes return 401); one new versioned namespace (`/api/v1/health`) added and
runtime-tested locally, not in production. No Communication Hub, Agent Runtime, Policy
Engine, Event Bus, or Evidence/anchoring capability exists anywhere in this repository.

**VyaparSethu:** a separate, live, Next.js application (source repository
`bell24xcom/forBell24x`, not this repository), serving `vyaparsethu.com`/`bell24h.com`
in production per live Vercel evidence (re-confirmed this session). Its internal
implementation is not inspectable from this repository — every claim about what
VyaparSethu itself does internally is UNKNOWN — NOT VERIFIABLE FROM CURRENT EVIDENCE
unless it was observed passively from the outside (its live HTML/CSP, in an earlier
sprint).

**Connection:** none verified. No runtime, API, SDK, authentication, database, storage,
queue, or AI-infrastructure connection between the two systems was found in this
repository at any point across every sprint this session has run (OODA-01 through this
record). **VERIFIED absence** of a connection from Bell24h-OS's side; VyaparSethu's side
remains UNKNOWN by definition (inaccessible).

**Deployment:** Bell24h-OS (`digitex-erp-bell24h-os` Vercel project) has **zero
deployments, ever** — `latestDeployment: null`, `domains: []`, re-confirmed via live
Vercel API call this turn (not carried from memory). VyaparSethu is served by a separate
Vercel project (`bell24h`, Next.js) with a `READY`/`production` deployment and the live
custom domains. **VERIFIED** for both.

**Authentication:** Bell24h-OS authenticates its own end users via Supabase JWT
(`requireAuth.ts`) — user-to-Bell24h-OS only. No service-to-service, app-to-app, or
VyaparSethu-to-Bell24h-OS authentication mechanism exists — confirmed by a fresh
repository-wide search this turn for OAuth2/client-credentials/service-account/API-key
patterns (zero matches) and for any code reference to a VyaparSethu hostname (zero
matches). **VERIFIED absent.**

**Tenant model:** Bell24h-OS resolves `organization_id` for its own authenticated users
via two parallel, internal mechanisms — server-side (`requireAuth.ts`, for Express
routes) and client-side (`getCurrentOrganizationId()`, added in BR-03, for direct
browser→Supabase calls). Neither was designed for, or has ever been used by, a second
calling system. No mapping between a Bell24h-OS `organization_id` and any VyaparSethu
identity concept exists. **VERIFIED absent** on Bell24h-OS's side; VyaparSethu's own
tenant model is UNKNOWN.

**SDK/API:** `BELL24H_OS_VYAPARSETHU_SDK_API_CONTRACT_V1.md` is a contract document, not
a built system — see §7 and §9. The only thing externally callable today is
`/api/v1/health`, and only on a local, non-production port; it was never tested against a
deployed environment because none exists.

**Security:** see §9 for full BR-03 status. No BR-03 finding blocks this decision record;
BR-03's findings are internal-tenant-isolation fixes, orthogonal to the cross-system
questions this record exists to resolve.

## 4. Decision A — S2S Authentication

**FACT:** Bell24h-OS authenticates end users via Supabase JWT
(`requireAuth.ts`): verifies the token against `/auth/v1/user`, resolves
`organization_id` from `profiles` using the caller's own token, fails closed, emits a
denial audit event. This is real and runtime-verified. There is no mechanism, anywhere in
this repository, for authenticating a *system* (as opposed to an end user) — confirmed by
a fresh grep this turn for OAuth2/client-credentials/service-account/API-key-issuance
patterns (zero matches) and for any use of the `api_keys` table, which exists in the
schema but is never queried by any application code (zero matches, VERIFIED dead table).

**GAP:** No S2S credential type, no issuance mechanism, no storage location, no rotation
policy, no revocation path, and no way for `requireAuth.ts` (or anything else) to
distinguish "a request from VyaparSethu acting as a system" from "a request from an
individual Bell24h-OS end user" — because the second concept doesn't exist yet at all.

**SECURITY REQUIREMENT (must be true before any production integration):** a credential
that identifies VyaparSethu as a calling *system*, distinct from any individual
Bell24h-OS end-user session; storage of that credential that never places it in
VyaparSethu's own client-side/browser code (VyaparSethu is itself a public web app — a
credential embedded in it is not a secret); a revocation path that doesn't require a
code deploy; and an audit trail identifying "VyaparSethu" as the actor on every call,
distinct from the existing `requireAuth.ts` audit trail for end users.

**OPTIONS** (none implemented; assessed only):

| | Option A — Dedicated S2S API credential | Option B — OAuth2 client-credentials | Option C — Signed service assertions | Option D — existing approved mechanism |
|---|---|---|---|---|
| Security boundary | Simple shared-secret bearer token, server-to-server only | Standard, well-understood client-credentials grant; token has expiry | Cryptographic signature per request/short-lived token, no long-lived shared secret in transit | N/A — repository evidence supports none; `requireAuth.ts` is user-JWT-shaped and not reusable as-is for a system identity |
| Tenant identity | Would need a fixed mapping (this credential = VyaparSethu = some fixed context) | Same, via token claims | Same, via assertion claims | — |
| Credential storage | One secret on each side; simplest to leak if mishandled | Client ID + secret on each side; short-lived access tokens reduce exposure window | Private key on VyaparSethu's server-side only; no shared secret to leak in transit | — |
| Rotation | Manual, requires coordinated update on both sides | Standard OAuth2 rotation/refresh patterns exist | Key rotation, well-understood pattern | — |
| Revocation | Manual (delete/replace the one secret) | Can revoke a client without affecting others if multiple exist | Revoke by no longer trusting the signing key | — |
| Auditability | Easy — one fixed actor ID to log | Easy — token claims identify the client | Easy — assertion identifies the signer | — |
| Implementation complexity | **Lowest** | Moderate — needs a token endpoint, client registry | Moderate-to-higher — needs key management on both sides | — |
| Compatibility with existing Bell24h-OS auth | Additive — a second, parallel check alongside `requireAuth.ts`'s user-JWT path, not a replacement | Same — additive | Same — additive | — |
| Compatibility with VyaparSethu | Unknown — depends on what VyaparSethu's own server-side stack can hold/call | Unknown, same reason | Unknown, same reason | — |
| Operational burden | Lowest — one secret to manage | Moderate — a token lifecycle to operate | Higher — key management lifecycle | — |

**RECOMMENDED OPTION:** None is implemented or chosen here — this is the founder's
decision. If forced to rank by the assessment above alone: Option A is the smallest
first step and the easiest to reason about for a single known caller (VyaparSethu);
Option B is the more standard/extensible choice if more than one external caller is ever
expected. Option C's added cryptographic guarantee is not clearly justified yet given
there is currently exactly one known caller and no production deployment for it to call.

**FOUNDER DECISION REQUIRED:** which option (or another not listed) to build, and whether
a single fixed VyaparSethu identity is acceptable for a first version or whether a
registrable multi-client model is needed from day one.

## 5. Decision B — Tenancy Bridge

**FACT:** Bell24h-OS's `organization_id` (on `profiles`, `organizations`) is
self-contained — created, owned, and resolved entirely within Bell24h-OS's own Supabase
project, for Bell24h-OS's own end users. VyaparSethu's own organization/company identity
model is UNKNOWN — NOT VERIFIABLE FROM CURRENT EVIDENCE (its source is not accessible
from this repository). No table, column, code path, or document in this repository
establishes any mapping between the two.

**GAP:** there is no answer, from this repository's evidence, to "which VyaparSethu
organization corresponds to which Bell24h-OS organization" — not because the mapping is
implemented incorrectly, but because the concept does not exist yet in either direction.

**SECURITY REQUIREMENT:** whatever mapping is eventually built, Bell24h-OS must derive
organization context for a VyaparSethu-originated request from the trusted service
identity established in Decision A (or from a signed claim within that mechanism) —
**never** from a VyaparSethu-supplied `organization_id` value taken at face value, for
the same reason `requireAuth.ts` never trusts a client-supplied `organization_id` today
(re-confirmed unchanged in BR-03: organization context is always server-resolved, never
client input).

**OPTIONS (model, not implementation):**
- **1:1** — one VyaparSethu organization maps to exactly one Bell24h-OS organization.
  Simplest; matches the apparent current reality (Bell24h-OS has never served more than
  the assumption of one tenant model, and VyaparSethu's Hackathon-6.0-era scale doesn't
  obviously need more).
- **1:N** — one VyaparSethu organization could use multiple Bell24h-OS organizations
  (e.g. per department/brand). No evidence in either system suggests this is needed yet.
- **N:1** — multiple VyaparSethu organizations share one Bell24h-OS organization (e.g.
  Bell24h-OS treats "VyaparSethu" itself as a single tenant, and VyaparSethu's own
  business-level tenancy stays entirely inside VyaparSethu, invisible to Bell24h-OS).
  This has a notable advantage: it requires **no per-VyaparSethu-tenant mapping table in
  Bell24h-OS at all**, since Bell24h-OS would only ever see one caller ("VyaparSethu, as a
  system") rather than needing to resolve individual VyaparSethu businesses. Consistent
  with Bell24h-OS owning *infrastructure* capabilities, not VyaparSethu's business-tenant
  concept.
- **Remains UNKNOWN** until VyaparSethu's own tenant model is inspected.

**Who owns the mapping / where it lives / who can create it / how it's authenticated /
how it's revoked / how isolation is enforced:** all UNKNOWN — NOT VERIFIABLE FROM CURRENT
EVIDENCE. These are exactly the questions this record declines to answer by invention.

**RECOMMENDED MODEL:** the N:1 ("VyaparSethu as a single system-level caller")
framing is the one best supported by what's actually implemented today — it requires
no new mapping table, is consistent with Decision A's likely first step (one fixed
service identity), and matches the architectural boundary already declared in the SDK
contract document (Bell24h-OS owns infrastructure, not VyaparSethu's business-tenant
concept). This is a recommendation for the founder to weigh, not a decision made here.

**FOUNDER DECISION REQUIRED:** which model to adopt, and whether resolving it requires
first inspecting VyaparSethu's own repository/data model (which this record could not do).

## 6. Decision C — Deployment Timing

**CURRENT DEPLOYMENT STATE: NOT DEPLOYED.** Re-verified via live Vercel API call this
turn: `digitex-erp-bell24h-os` project — `latestDeployment: null`, `domains: []`. This is
not an inference from the absence of a `vercel.json` (there is none, confirmed) — it is
the platform's own record of zero deployments, ever.

**FACT:** no production domain, no health-endpoint uptime, no environment separation
(dev/staging/production), and no operational history of any kind exists for Bell24h-OS.
Everything runtime-verified this session (the auth 401 test, the `/api/v1/health` test)
was run locally, on a manually-chosen alternate port, and torn down immediately after.

**GAP:** there is no environment for VyaparSethu to call even if Decision A and B were
both resolved today.

**OPTIONS:**
- **A. Local integration only** — not viable beyond development; VyaparSethu is a public,
  live, production system and cannot reasonably call a developer's local machine.
- **B. Staging integration first** — Bell24h-OS is deployed to a real, reachable
  environment that is not the production domain VyaparSethu's users hit, VyaparSethu (or
  a test harness standing in for it) calls that staging environment first.
- **C. Production Bell24h-OS deployment first, then integrate** — deploy Bell24h-OS to
  production before any VyaparSethu call is attempted at all.
- **D. Other evidence-supported approach** — none found in this repository's evidence
  beyond B/C; no existing staging/preview convention was found to point to specifically
  (no `vercel.json`, no documented preview-deployment workflow).

**ASSESSMENT:** Security — a first S2S credential and a first tenant-mapping model (from
Decisions A/B) are exactly the kind of thing that should be exercised against a
non-production environment before being trusted with production traffic; this favors B
over C. Observability — Bell24h-OS currently has non-durable, stdout-only audit logging
(confirmed unchanged by BR-03) with no log drain configured anywhere; this is a gap
regardless of which environment is used first, and should be closed before *either* a
staging or production integration carries real traffic. Rollback — with zero deployment
history, there is no established rollback procedure for Bell24h-OS at all yet; this needs
to exist before production integration regardless of option chosen. Hackathon impact —
none of Bell24h-OS's own deployment states affect the VyaparSethu Hackathon 6.0 critical
path, since that path runs entirely inside VyaparSethu's own already-live deployment.

**RECOMMENDATION:** **B — staging integration first.** This is the option best supported
by the evidence and risk profile above: it lets Decisions A and B be tested against a
reachable Bell24h-OS without betting production VyaparSethu traffic on a
first-of-its-kind integration. This is a recommendation, not a decision made here.

**FOUNDER DECISION REQUIRED:** whether to accept B, and if so, what "staging" concretely
means for a project with zero deployment history today (a second Vercel project? a
preview-deployment convention? something else) — that setup is itself out of this
record's scope.

## 7. Decision D — First Capability

**CANDIDATE 1 — AI text generation.**
**CURRENT STATUS:** the only Bell24h-OS platform capability with real, working,
previously runtime-tested (BR-01) server-side code behind it —
`server/ai/ProviderRouter.generateText`/`generateJson`, Gemini only, with per-organization
daily budget and audit emission.
**EVIDENCE:** `server/ai/ProviderManager.ts`/`ProviderRouter.ts`, unchanged since BR-01
(confirmed via `git diff --stat`, zero changes to `server/ai/*` across every sprint this
session).
**WHY SUITABLE:** clearly Bell24h-OS-owned infrastructure (not VyaparSethu business
logic); the only capability besides the health probe with real code; independently
testable without touching VyaparSethu; low blast radius (text generation, not a
financial or contractual action); would not require VyaparSethu to hold any AI provider
credential itself, matching the stated target architecture.
**DEPENDENCIES:** Decision A (S2S auth) must exist before this can be called by
VyaparSethu at all; a new authenticated capability route would need to be added (not
built by this record — explicitly out of scope); Decision C's environment must be
reachable.
**RISKS:** narrow (Gemini only) — would need to be honest with VyaparSethu about a
single-provider limitation rather than the multi-provider surface the env-var template
implies; per-org budget is in-memory only (resets on restart, doesn't survive a redeploy)
— acceptable for a first, low-volume integration, not for real production load without
further work (out of this record's scope to fix).

**CANDIDATE 2 — Health/capability discovery (`/api/v1/health`).**
**CURRENT STATUS:** implemented, runtime-tested locally.
**EVIDENCE:** `server.ts`, `server/lib/requestContext.ts`.
**WHY SUITABLE:** smallest possible blast radius; a natural pre-integration connectivity
check.
**WHY NOT RECOMMENDED AS "THE FIRST CAPABILITY":** it carries no business value to
VyaparSethu on its own — it answers "is Bell24h-OS reachable," not anything VyaparSethu
would actually want. Better framed as step zero of Decision C's environment
verification, not as the first real capability the brief is asking to identify.

**CANDIDATE(S) EXCLUDED, per the brief's own rule not to choose a TARGET-only
capability:** Communication Hub, Media/Image/Video generation, Agent Runtime — all
TARGET, zero server-side implementation, explicitly disqualified by the brief's own
instruction not to choose these "merely because architecturally important" or "part of
the roadmap."

**RECOMMENDED FIRST CAPABILITY:** AI text generation (Candidate 1), with
`/api/v1/health` treated as the pre-requisite connectivity check rather than the
capability itself. This is the one candidate satisfying every criterion the brief lists,
using only what's already implemented and tested.

**FOUNDER DECISION REQUIRED:** whether to accept AI text generation as the first
capability, and — separately — whether the Gemini-only limitation is acceptable for a
first version or must be widened before VyaparSethu is allowed to depend on it.

## 8. Integration Readiness Gate

| # | Gate | Status |
|---|---|---|
| 1 | Bell24h-OS production endpoint | **BLOCKED** — zero deployments, ever (§6) |
| 2 | S2S authentication | **BLOCKED** — no mechanism exists (§4) |
| 3 | Tenant mapping | **BLOCKED** — no mapping, and no VyaparSethu-side model to map against (§5) |
| 4 | API capability surface | **PARTIAL** — one real capability (AI text generation) exists server-side; not yet exposed as an authenticated `/api/v1` route; everything else is TARGET |
| 5 | Security boundary | **PARTIAL** — the internal (Bell24h-OS-to-its-own-users) boundary is sound and BR-03-hardened; the cross-system boundary that matters for this integration doesn't exist yet |
| 6 | Observability | **PARTIAL** — structured audit logging exists but is non-durable, stdout-only, no drain (§6) |
| 7 | First capability | **PARTIAL** — identified and recommended (§7), not yet built as a callable route |
| 8 | Rollback strategy | **UNKNOWN — NOT VERIFIABLE FROM CURRENT EVIDENCE** — no deployment history exists to have established one |

**Single highest-leverage blocker: S2S authentication (Decision A).** Deployment (gate 1)
and tenant mapping (gate 3) both matter, but neither can be meaningfully exercised end
to end without an answer to "how does Bell24h-OS know a request is really from
VyaparSethu" first — a staging deployment with no S2S auth is not integrable, and a
tenant mapping has nothing trustworthy to key off without one. Decision A is also the one
of the four that can be decided and prototyped without waiting on deployment or on
inspecting VyaparSethu's own repository.

## 9. Security Position (BR-03 status — not re-run)

| Item | BR-03 status | Classification for this decision |
|---|---|---|
| Tenant isolation (`automation_workflows`, `seo_projects`/`seo_keywords`) | Fixed — defense-in-depth `.eq()` filters added; RLS was already the enforcing layer | NON-BLOCKING |
| `src/lib/currentOrganization.ts` | New, browser-side only, resolves org context from an authenticated Bell24h-OS end-user session | NON-BLOCKING — not usable as-is for S2S; a cross-system caller has no Bell24h-OS user session to resolve from, so this helper doesn't extend to Decision A/B at all |
| `AutomationService.ts` | Fixed (defense-in-depth + one real insert-bug fix) | NON-BLOCKING |
| `SeoIntelligenceService.ts` | Fixed (defense-in-depth) | NON-BLOCKING |
| Client-side AI security debt (`AiProviderService.ts`, Prompt/Image/Video Studio) | Assessed and explicitly stopped/reported, not fixed — credential itself confirmed unreachable in the browser today | **REQUIRES FOUNDER DECISION, separately from this record** — directly relevant to Decision D: if AI is exposed to VyaparSethu, it must go through the server-side `ProviderRouter` path, never through this client-side path; this record's Decision D recommendation already assumes that, but the client-side path itself remains a standing item BR-03 deferred, not resolved by choosing Decision D |
| Remaining P1 (5 more service classes with the same defense-in-depth gap) | Deferred, documented, not fixed | DEFERRED — unrelated to cross-system integration |

## 10. Architectural Boundary

Restated, unchanged by this record: **VyaparSethu owns business-domain logic** — Buyer,
Supplier, RFQ, Matching business rules, Quote, Negotiation, Trade Chat, Deal,
Procurement, Trust/Trust Graph business rules, KYB business rules, Payment business
rules, Escrow business rules, Logistics, Marketplace, Supplier discovery, Trade
intelligence, public marketplace experience. **Bell24h-OS owns reusable infrastructure
capabilities** — AI runtime, AI Provider Manager, provider routing, Communication Hub,
Media infrastructure, Agent infrastructure, Policy infrastructure, Identity/RBAC
infrastructure, Workflow infrastructure, Event infrastructure, Audit infrastructure,
Evidence infrastructure, Storage abstraction, provider adapters, Observability,
usage/cost infrastructure, integration infrastructure. **Provider-specific integrations
belong behind Bell24h-OS adapters** — VyaparSethu must never hold a provider credential
(OpenAI, Gemini, Spur, MSG91, Meta WhatsApp, or any other) directly; it calls a Bell24h-OS
capability, which calls a provider adapter, which calls the external provider. This
target shape is **documented, not operational** — nothing today exercises it end to end.

## 11. What Is NOT Authorized Yet

This record does not authorize: S2S authentication implementation; tenant bridge
implementation; production deployment; Communication Hub implementation; Media
implementation; Agent Runtime; Policy Engine; Event Bus; Evidence/Blockchain; JobWorker
repair; database migration; VyaparSethu source modification; repository merge.

## 12. Founder Decision Checklist

- [ ] Decision A — S2S Authentication (§4)
- [ ] Decision B — Tenancy Bridge (§5)
- [ ] Decision C — Deployment Timing (§6)
- [ ] Decision D — First Capability (§7)

None of the above are marked approved by this record. Only the founder can approve them.

## 13. Exact Next Gate

**After all four founder decisions are made:** a single, narrowly-scoped implementation
sprint building **only** the S2S authentication mechanism chosen in Decision A —
nothing else. That sprint should itself stop before touching deployment, tenant mapping,
or the first capability route, so each decision is implemented and verified in isolation
rather than as one combined change. No further gate beyond that is defined here — this is
intentionally not a roadmap.
