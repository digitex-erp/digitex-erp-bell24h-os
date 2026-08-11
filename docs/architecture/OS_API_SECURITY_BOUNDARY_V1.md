# Bell24h-OS API Security Boundary v1.0

**Date:** 2026-08-12
**HEAD:** `bc6ea7f` (documentation-only sprint — confirmed unchanged; see §12)
**Purpose:** define the minimum public-health / privileged-machine-API boundary required
before `BELL24H_VYAPARSETHU_SERVICE_TOKEN` or `GEMINI_API_KEY` are ever configured. No
secret is set, inspected, or printed in this sprint.

Every claim below is labeled **VERIFIED** (direct evidence, this turn or a cited prior
turn), **DESIGN DECISION** (a choice made here, not yet forced by evidence), **FUTURE**
(explicitly deferred), or **UNKNOWN**.

---

## 1. Public API Surface (Zone 1)

| Route | Method | Exposes |
|---|---|---|
| `/api/health` | GET | `{status:"ok"}` only |
| `/api/v1/health` | GET | `{status, apiVersion, requestId}` only |
| `*` (SPA catch-all, production branch only) | GET | Static placeholder HTML (this deployment's `dist/index.html`) |

**VERIFIED**, this turn, via direct unauthenticated `curl` against the live public
production domain (`digitex-erp-bell24h-os.vercel.app`): both health routes return
exactly the shape above — no provider credential, no database credential, no
organization data, no internal diagnostic, no AI provider configuration, no secret of
any kind. Zero difference in behavior between local, staging, and this public production
domain (all covered by prior sprints' tests plus this turn's).

## 2. User-Authenticated Surface (Zone 2)

`requireAuth.ts` — Supabase JWT, fail-closed, unchanged since BR-01. Every route below
returned `401 {"error":"unauthenticated","requestId":...}` to an anonymous request
against the live public production domain, **VERIFIED this turn**:

`/api/check-table`, `/api/check-users-count`, `/api/vault/documents` (GET+POST),
`/api/vault/rd`, `/api/vault/timeline`, `/api/vault/phases`, `/api/vault/decisions`,
`/api/vault/ai-summary`, `/api/vault/mentor-advice` (the last two also carry
`aiRateLimit`, unreachable without passing `requireAuth` first).

**Do not replace this mechanism** — per this sprint's explicit instruction, and because
it is already correctly enforced everywhere it's applied.

## 3. Future Machine-to-Machine Surface (Zone 3)

`requireServiceAuth.ts` (built in OS-INTEGRATION-IMPLEMENTATION-01, unchanged this
sprint) — a dedicated shared-secret credential
(`BELL24H_VYAPARSETHU_SERVICE_TOKEN`), never a browser cookie, never a user JWT, never a
client-supplied `organization_id`. **VERIFIED** unreachable without it: the one route in
this zone, `POST /api/v1/ai/text`, returned `401 AUTHENTICATION_FAILED` to an anonymous
request against the live public production domain this turn.

**Caller identity is fixed:** `caller_system = "vyaparsethu"` — no per-VyaparSethu-tenant
registry, matching Decision B in `OS_INTEGRATION_DECISION_RECORD_V1.md`. The credential
itself is **NOT configured anywhere** — `FUTURE`, deliberately, this sprint does not set
it.

**Namespace decision (Phase 6): no new `/api/v1/internal/*` prefix is created.**
`DESIGN DECISION`: the existing `/api/v1/*` versioned surface, combined with per-route
middleware choice (`requireServiceAuth` vs `requireAuth` vs none), already achieves the
zone separation this sprint asks for — the zone boundary is the *middleware*, not the
URL path. Introducing a second path-based zoning scheme on top of an already-sufficient
middleware-based one would be exactly the kind of unrequired complexity this sprint's own
instructions warn against ("do not create a new namespace if the current contract
already defines an appropriate machine boundary"). Consistent with Section 05 of
`BELL24H_OS_VYAPARSETHU_SDK_API_CONTRACT_V1.md`, which already establishes `/api/v1/*` as
the surface new capability routes belong on, unversioned legacy routes stay where they
are.

## 4. Health Endpoint Contract

`GET /api/v1/health` — **VERIFIED safe, unmodified this sprint.** Returns exactly
`{status, apiVersion, requestId}`. No database status, no provider status, no
organization information, no environment variable is exposed, confirmed by direct
inspection of the unchanged route source and by live HTTP response this turn. Per this
sprint's Phase 3 instruction ("if current behavior is safe: do not modify it") — not
touched.

## 5. Sensitive Route Inventory (Phase 4)

| Route | CURRENT AUTH | CURRENT EXPOSURE | REQUIRED FUTURE AUTH |
|---|---|---|---|
| `/api/env/diagnostic` | `devOnly` guard (404 outside dev) | **VERIFIED none** — 404 on live production, this turn. The single route that would disclose which env vars are configured (never values) if ever reachable. | Unchanged — already correctly the most tightly gated route in the file |
| `/api/migrate` | `devOnly` guard (404 outside dev) | **VERIFIED none** — 404 on live production, this turn. The single most dangerous route in this file (runs the entire schema file against the DB). | Unchanged — correctly gated; if ever re-enabled for production use, the file's own comment already specifies it must become `POST` + `requireAuth` + an admin-role check, not a schema question this sprint needs to resolve |
| `/api/check-table` | `requireAuth` | Confirms `organizations` table existence only; **on error, echoes the raw `err.message` to the client** — a small, systemic pattern (present on nearly every route in this file, not unique to this one), not a new finding | Not S2S-relevant; existing gap noted, not fixed this sprint (see §12) |
| `/api/check-users-count` | `requireAuth` | Returns a **cross-tenant** total user count (not scoped to the caller's own organization) to any authenticated user of any organization — a real, small, pre-existing information-disclosure gap | Not S2S-relevant; noted, not fixed this sprint (see §12) |
| `/api/vault/*` (7 routes) | `requireAuth` | **Already documented, pre-existing** (Gate C, BR-01): no `organization_id` column on these tables; the pooled `DATABASE_URL` connection bypasses RLS regardless. Any authenticated user of any org can read/write these tables. Explicitly tracked as a Council-level data-model decision in `GATE_C_REMEDIATION_REPORT.md`, not this sprint's to resolve | Unchanged — out of this sprint's scope by design |
| `/api/v1/ai/text` | `requireServiceAuth` | **VERIFIED correctly gated** — this IS Zone 3 done correctly; no gap | N/A — already the target state |

No newly-discovered privileged-route exposure was found. Every route that should require
authentication does, verified live against the public production domain this turn — not
merely inferred from source.

## 6. Authentication Matrix

| Zone | Mechanism | File | Applies to |
|---|---|---|---|
| Public | None | — | `/api/health`, `/api/v1/health`, SPA catch-all |
| Dev-only | `devOnly()` (404 outside `NODE_ENV=production`... inverted: blocks IN production) | `server.ts` | `/api/env/diagnostic`, `/api/migrate` |
| User-authenticated | `requireAuth` (Supabase JWT) | `server/middleware/requireAuth.ts` | `/api/check-table`, `/api/check-users-count`, all `/api/vault/*` |
| System/Machine | `requireServiceAuth` (shared secret) | `server/middleware/requireServiceAuth.ts` | `/api/v1/ai/text` |

## 7. Secret-Handling Rules

- `BELL24H_VYAPARSETHU_SERVICE_TOKEN` and `GEMINI_API_KEY`: **NOT CONFIGURED** anywhere
  in this project — **VERIFIED** by the fail-closed 401/503 responses observed this turn
  and every prior verification turn; **not set, inspected, or printed this sprint.**
- The S2S credential must never be readable by, or accepted from, browser code, the
  public health route, or any user-facing frontend route — **VERIFIED unchanged**:
  `requireServiceAuth.ts` is a `server/`-only file, never imported from `src/` (confirmed
  by `grep`, this turn, zero matches).
- No provider credential (Gemini or otherwise) is ever read outside
  `server/ai/ProviderManager.ts` — unchanged since BR-01, re-confirmed via `git diff`
  showing zero changes to that file across this entire task family.

## 8. Production vs. Preview Environment Rules (Phase 8 — design only, nothing set)

**DESIGN DECISION, not yet implemented:** Vercel's standard model supports distinct
environment-variable scopes for Production, Preview, and Development. When the founder
does configure real credentials:

- `GEMINI_API_KEY` and `BELL24H_VYAPARSETHU_SERVICE_TOKEN` should each have **separate
  values for Production and Preview** — a Preview-scoped value must never be the same as
  the Production one, so a leak from a preview deployment (which this task family has
  shown can be more loosely protected, or in the past turn's case, discovered to overlap
  unexpectedly with production reachability) cannot be used against production traffic,
  and vice versa.
- Given §9's finding that the SSO protection gap applies to the **Production domain**
  specifically, Production secrets carry materially higher exposure risk today than
  Preview secrets would. This is an argument for configuring Preview credentials (for
  further staging verification) before Production ones, not the reverse — recorded as a
  recommendation, not acted on this sprint.

**This session has no tool loaded that writes Vercel environment variables** — this
section is architecture guidance for whoever does configure them, not a claim that any
scoping was applied.

## 9. VyaparSethu Caller Model

Unchanged from `OS_INTEGRATION_DECISION_RECORD_V1.md` Decision B: a single, fixed
`caller_system = "vyaparsethu"` identity, attached only after `requireServiceAuth`
verifies the shared secret. No tenant-mapping table, no per-company registry, no
client-supplied `organization_id` ever trusted. **VERIFIED unchanged** — zero diff to
`requireServiceAuth.ts` this sprint.

## 10. S2S Authentication Requirements (recap, not re-implemented)

Already built (OS-INTEGRATION-IMPLEMENTATION-01): constant-time credential comparison
(SHA-256 digest + `timingSafeEqual`), fail-closed on missing header, fail-closed on
missing server config, fail-closed on mismatch, canonical error envelope, audit event on
every outcome, request-ID propagation. **FUTURE, unchanged this sprint:** the actual
secret value — configuring it is explicitly out of scope here and remains gated on the
founder's decision from the prior reconciliation sprint about the Production-domain
protection gap.

## 11. Threat Model

- **Anonymous internet caller, public production domain** (the scenario this sprint
  exists to address): can reach `/api/health` and `/api/v1/health` only — **VERIFIED**
  safe, no privileged data returned. Every other route fails closed. Even
  `/api/v1/ai/text`, if it ever received a request from such a caller, could not execute
  anything (no credential configured to check against) and would not leak the fact that
  a credential is or isn't set beyond the generic `PROVIDER_UNAVAILABLE` message it
  already returns when the header is present but the server-side secret is absent.
- **Compromised/leaked S2S credential** (future risk, once configured): would grant the
  ability to call `/api/v1/ai/text` as `caller_system: vyaparsethu`, consuming the
  per-organization AI budget under that fixed pseudo-org key and generating text via
  Gemini — bounded, auditable (every call logs `s2s.verify` + `ai.s2s.generateText`
  events), not able to reach any user-authenticated route (different middleware, no
  cross-grant).
- **Unprotected Production domain generally** (carried over from the prior
  reconciliation sprint, not resolved here — see §12): the practical risk today is
  bounded specifically because no privileged route is reachable without its own
  application-layer credential. The residual risk is entirely in *what gets configured
  next* on that domain, which is exactly why this sprint exists before that happens.

## 12. Remaining Blockers / Decisions Not Made Here

1. **Whether to fix the unprotected-Production-domain gap, or accept it, remains the
   founder's decision from the prior reconciliation sprint** — not resolved, not
   attempted, per that sprint's own explicit scope lock and this sprint's Phase 9
   instruction not to change Vercel protection settings.
2. **Two small, pre-existing, non-S2S-related information-disclosure gaps** were
   reconfirmed, not fixed, staying in scope: `/api/check-users-count` returns a
   cross-tenant total; `/api/check-table` echoes raw error messages on failure. Neither
   is new, neither blocks the S2S boundary, both are candidates for a future, separately
   scoped hardening pass.
3. **`BELL24H_VYAPARSETHU_SERVICE_TOKEN` / `GEMINI_API_KEY` remain unconfigured** —
   deliberately, this sprint's entire purpose. The next gate is a founder decision (§12.1
   and §8), not further engineering.
