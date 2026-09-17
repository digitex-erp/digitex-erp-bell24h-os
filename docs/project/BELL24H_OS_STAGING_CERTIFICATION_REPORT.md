# BELL24H-OS STAGING CERTIFICATION REPORT

**Repository audited:** `digitex-erp/digitex-erp-bell24h-os` (local working copy:
`C:\Users\Sanika\digitex-erp-bell24h-os`, `HEAD = bd31707`)
**Deployment audited:** `https://digitex-erp-bell24h-os.vercel.app`
**Date:** 2026-09-14
**Method:** Direct source reading of every route/adapter/provider file; live HTTP
requests against the deployed URL (no credentials used or requested); a fresh
`vercel whoami` / `vercel domains ls` / `vercel inspect` check. No code was modified.
No architecture is recommended. Evidence only, per mission.

---

## 0. Reconciliation with the second message's claim

The prompt's second message asserts this repository currently contains a
**Communication Hub**, an **Agent Framework**, and adapters for **Twilio, MSG91,
Meta, OpenAI, Anthropic, Gemini, NVIDIA**. Direct evidence below does not support
most of that:

| Claimed to exist | Evidence found |
|---|---|
| Communication Hub | **No such module.** No directory, service, or route named for it. |
| Twilio / MSG91 / Meta(WhatsApp) / Spur adapters | **Zero code hits.** `WhatsApp` and `Email` appear exactly once each, as plain option strings in a category dropdown (`src/pages/PromptStudioPage.tsx:59`) — not adapters, not calls to any external API. |
| Agent Framework | `src/modules/agents/AgentService.ts` — 8 lines, 2 static methods: `listAgents()` returns `[]`; `spawnAgent()` only `console.log`s its argument. No orchestration, no execution. |
| OpenAI / Anthropic adapters | Exist, but **browser-side only**, in a file whose own header reads `"LEGACY — DO NOT USE FOR NEW SERVER ENDPOINTS"` (`src/modules/ai-providers/AiProviderService.ts`). They cannot function: `api_key` is deliberately excluded from the query that populates them, so every call throws `"API key is missing"` before any request leaves the browser. |
| Gemini / NVIDIA adapters | **Yes — these two are real, server-side, and working.** See §3. |

This report's tables below give the full, itemized breakdown behind this summary.

---

## 1. Current deployment status

- `GET https://digitex-erp-bell24h-os.vercel.app/` → **HTTP 200**, serves the static
  placeholder page (`<title>Bell24h-OS staging</title>… API-only staging build for
  OS-INTEGRATION-IMPLEMENTATION-01. See /api/v1/health.`), confirming `vercel.json`'s
  `buildCommand` is the one actually deployed.
- `GET /api/v1/health` → **HTTP 200**, `{"status":"ok","apiVersion":"v1","requestId":"…"}`.
- Deployed code is the **same Express app** as local `server.ts`: `api/index.ts`
  imports `createApp()` from `server.js` and forwards every request to it — this is
  not a separate/rewritten backend.
- **Ownership of the Vercel project is not accessible from this machine's CLI
  session**, re-verified fresh this session:
  - `vercel whoami` → `bell24hhelpline-8523`
  - `vercel domains ls --scope bell24xs-projects` → only `vyaparsethu.com` is owned
  - `vercel inspect https://digitex-erp-bell24h-os.vercel.app --scope bell24xs-projects` → `Error: Can't find the deployment … under the context "bell24xs-projects"`
  - Unchanged from `docs/project/OS-LIVE-04A-VERCEL-OWNERSHIP-REPORT.md` (2026-08-18).
    Env vars, deployment history, and Git integration for the real owning project
    **cannot be inspected** from this session — blocker, not inferred either way.

## 2. API health status

Both health endpoints respond correctly and unauthenticated, exactly as coded:

| Route | Live response |
|---|---|
| `GET /api/health` | `200 {"status":"ok"}` |
| `GET /api/v1/health` | `200 {"status":"ok","apiVersion":"v1","requestId":"req_…"}` |

## 3. Route-by-route audit

All 15 routes registered in `server.ts` (the only backend entry point; `api/index.ts`
just forwards to it). Every "Loads?" and status code below is a **live HTTP result**
against the deployed URL, taken this session — not inferred from source.

| Route | Exists? | Loads? | Auth Required? | Data Source | External Deps | Env Vars Required | Runtime Errors (live HTTP result) | Prod Ready? |
|---|---|---|---|---|---|---|---|---|
| `GET /api/health` | Yes | Yes | No | none | none | none | `200 {"status":"ok"}` | Yes |
| `GET /api/v1/health` | Yes | Yes | No | none | none | none | `200`, envelope as above | Yes |
| `POST /api/v1/ai/text` | Yes | Yes | `requireServiceAuth` (shared secret) | server/ai/ProviderRouter → Gemini or NVIDIA | Google Gemini API or NVIDIA NIM API | `BELL24H_VYAPARSETHU_SERVICE_TOKEN`; `GEMINI_API_KEY` or `NVIDIA_API_KEY` | No header → `401 Missing x-bell24h-service-token header`; bogus header → `401 Service credential rejected` (confirms a real secret **is** configured in prod) | Partially — see §6 (S2S auth verified live; NVIDIA path independently proven end-to-end by the operator on 2026-08-12 per `OS-INTEGRATION-IMPLEMENTATION-04E-NVIDIA-PROOF-REPORT.md`; not re-verified this session since that requires the real token, which this session must not use) |
| `GET /api/env/diagnostic` | Yes (dev-only) | No in prod (by design) | N/A — disabled outright in prod | `process.env` | none | none | `404` (empty body) | Yes — correctly disabled |
| `GET /api/check-table` | Yes | Yes | `requireAuth` (Supabase JWT) | Postgres via pooled `DATABASE_URL` | Supabase Postgres | `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`/`SUPABASE_KEY` | No token → `401 unauthenticated` | Auth gate verified; cannot verify authenticated behavior (no test account) |
| `GET /api/check-users-count` | Yes | Yes | `requireAuth` | Postgres (`auth.users` count) | Supabase Postgres | same as above | `401 unauthenticated` | Same as above |
| `GET /api/migrate` | Yes (dev-only) | No in prod (by design) | N/A — disabled outright in prod | `supabase_schema.sql` executed against `DATABASE_URL` | Supabase Postgres | `DATABASE_URL` | `404` (empty body) | Yes — correctly disabled |
| `GET /api/vault/documents` | Yes | Yes | `requireAuth` | Postgres, `vault_documents` table | Supabase Postgres | `DATABASE_URL` + Supabase auth vars | `401 unauthenticated` | Gate verified live; tenancy not verified — see §6 (no `organization_id` column on this table; RLS bypassed by pooled connection regardless) |
| `POST /api/vault/documents` | Yes | Yes | `requireAuth` | same | Supabase Postgres | same | `401 unauthenticated` | Same caveat |
| `GET /api/vault/rd` | Yes | Yes | `requireAuth` | Postgres, `rd_library` | Supabase Postgres | same | `401 unauthenticated` | Same caveat |
| `GET /api/vault/timeline` | Yes | Yes | `requireAuth` | Postgres, `timeline_milestones` | Supabase Postgres | same | `401 unauthenticated` | Same caveat |
| `GET /api/vault/phases` | Yes | Yes | `requireAuth` | Postgres, `phases` | Supabase Postgres | same | `401 unauthenticated` | Same caveat |
| `GET /api/vault/decisions` | Yes | Yes | `requireAuth` | Postgres, `decision_records` | Supabase Postgres | same | `401 unauthenticated` | Same caveat |
| `POST /api/vault/ai-summary` | Yes | Yes | `requireAuth` + per-org rate limit | server/ai/ProviderRouter → Gemini | Google Gemini API | `DATABASE_URL`/Supabase vars + `GEMINI_API_KEY` | `401 unauthenticated` | Gate verified; provider-key configuration not verifiable without a real session token |
| `POST /api/vault/mentor-advice` | Yes | Yes | `requireAuth` + per-org rate limit | server/ai/ProviderRouter → Gemini | Google Gemini API | same | `401 unauthenticated` | Same caveat |

Additional observed behavior: any **unmatched** route (e.g.
`/api/nonexistent-route-xyz`) returns **`200`** with the static placeholder HTML, not
a JSON `404` — this is the SPA catch-all (`app.get('*', …)` serving `dist/index.html`
in production) firing for any unrecognized `GET`. This is consistent with the SPA
architecture, not a defect in any specific route, but means "route doesn't exist"
and "route exists and loaded the SPA shell" are not distinguishable from the HTTP
response alone for `GET` requests outside the registered set.

**Correction to `bell24h-verify`'s recorded finding:** that skill's "Known open
violations" table (dated Gate C, commit `281c08a`) states *"All 13 API routes
unauthenticated."* Current evidence contradicts this: there are **15** routes today,
and **10 of them require `requireAuth` or `requireServiceAuth`**; only the two health
checks are intentionally unauthenticated, and the two dev-diagnostic routes are
disabled outright in production. That finding is stale and has been superseded by
work landed since (`requireAuth`/`requireServiceAuth` introduced later in the
session per `docs/project/GATE_C_REMEDIATION_REPORT.md` and confirmed still-closed
as of `docs/project/GATE_C_CLOSURE_PACKAGE.md`, 2026-09-06).

## 4. Existing providers / adapters (server-side, real)

| Provider | File | Wired into a route? | Credential source |
|---|---|---|---|
| Gemini | `server/ai/GeminiProvider.ts` | Yes — default path for `/api/v1/ai/text`, `/api/vault/ai-summary`, `/api/vault/mentor-advice` | `process.env.GEMINI_API_KEY`, resolved server-side only via `server/ai/ProviderManager.ts` |
| NVIDIA (NIM, OpenAI-compatible endpoint) | `server/ai/NvidiaProvider.ts` | Yes — opt-in via `provider: "nvidia"` on `/api/v1/ai/text` only | `process.env.NVIDIA_API_KEY`, same resolution pattern |

Both go through `server/ai/ProviderRouter.ts`, which enforces a per-organization
in-memory daily budget and emits an audit event (console JSON) per attempt. No other
server-side provider exists.

## 5. Existing providers (client-side, browser — non-functional as deployed)

`src/modules/ai-providers/AiProviderService.ts` — flagged in its own header as
`"LEGACY — DO NOT USE FOR NEW SERVER ENDPOINTS"` and as Critical Security Debt in the
same file. Contains real request-shape code for:

| Provider | Class | Functional in this deployment? |
|---|---|---|
| Gemini | `GeminiProvider` | No — reads `api_key` from a browser query that deliberately excludes that column |
| OpenAI | `OpenAIProvider` | No — same reason |
| Anthropic | `AnthropicProvider` | No — same reason |
| DeepSeek, Qwen, GLM, MiniMax, NVIDIA | `OpenCompatibleProvider` (shared class, different base URLs) | No — same reason |

This module is called by `src/modules/job-orchestrator/JobOrchestratorService.ts`,
which is itself never started in production (see §6).

**Groq and Ollama: zero references anywhere in the repository's code** (`src/`,
`server/`, `api/`).

## 6. Existing orchestration / job services

Per direct source reading, corroborated by `docs/project/RUNTIME_BASELINE_REPORT.md`
(same-repo, dated 2026-09-14 session predecessor, Sprint B.5 Phase 1):

- `src/modules/job-orchestrator/JobOrchestratorService.ts` / `JobWorker.ts` — run
  **entirely in the browser**, backed by Supabase table `job_queue`. `JobWorker`'s
  only call site (`src/main.tsx:7-9`) is **commented out** — no worker runs anywhere,
  browser or server, in the current build.
- No Redis, no BullMQ, no n8n, no cron library, and no `crons` key in `vercel.json`
  anywhere in this repository.
- Retry state (`status: 'retrying'`) is set but never re-consumed — a failed job
  retries zero times regardless of configured `max_retries`.
- `src/modules/agents/AgentService.ts` — 8-line stub, no real agent execution.
- No server-side worker process exists to enable; one would be new construction, not
  a restoration of disabled code.

## 7. Existing communication services / adapters

Grepped across `src/`, `server/`, `api/` for `whatsapp`, `msg91`, `twilio`, `spur`,
`sendgrid`, `nodemailer`, and (added this pass) `resend`:

| Adapter | Exists? | Implemented? | Tested? | Production Ready? |
|---|---|---|---|---|
| Meta WhatsApp | No | No | No | No |
| MSG91 | No | No | No | No |
| Twilio | No | No | No | No |
| Spur | No | No | No | No |
| Email (any provider, incl. Resend — `.env.example` lists `RESEND_API_KEY` but no code reads it or calls any email API) | No | No | No | No |
| SMS (any provider) | No | No | No | No |

The only occurrences of these terms anywhere in code are two plain option-label
strings ("WhatsApp", "Email") in a content-category dropdown
(`src/pages/PromptStudioPage.tsx:59`) — UI labels, not integrations.

## 8. AI layer audit

| Provider | Exists (server-side)? | Enabled (wired to a route)? | Production Ready? |
|---|---|---|---|
| Gemini | Yes | Yes (default path, 3 routes) | Credential-gated; not independently re-verified with a live call this session (would require the real token) |
| NVIDIA | Yes | Yes (opt-in, 1 route) | **Yes — end-to-end production proof exists**: operator-performed real call, 2026-08-12, `200`, proof marker `BELL24H-OS-NVIDIA-PROOF-OK` received (`docs/project/OS-INTEGRATION-IMPLEMENTATION-04E-NVIDIA-PROOF-REPORT.md`). Not re-run this session — doing so would require the real service token, which per the constitution this session must not request or use. |
| OpenAI | Browser-only, legacy, non-functional | No | No |
| Anthropic | Browser-only, legacy, non-functional | No | No |
| Groq | Does not exist | No | No |
| DeepSeek | Browser-only, legacy, non-functional | No | No |
| Ollama | Does not exist | No | No |

## 9. Existing authentication services

- **End-user:** `server/middleware/requireAuth.ts` — verifies a Supabase JWT against
  `SUPABASE_URL`/anon key, resolves `organization_id` from the caller's own
  `profiles` row (using the caller's token, so Supabase RLS applies to that lookup).
  Fails closed on every branch (missing token → 401; server misconfigured → 503;
  invalid token → 401; no organization → 403). Live-confirmed: every `requireAuth`
  route returns `401 unauthenticated` with no token, this session.
- **Service-to-service:** `server/middleware/requireServiceAuth.ts` — single shared
  secret (`BELL24H_VYAPARSETHU_SERVICE_TOKEN`), constant-time comparison
  (`timingSafeEqual` over SHA-256 digests), fixed caller identity `"vyaparsethu"`,
  no tenant mapping. **Live-confirmed this session** that a real secret is configured
  in production: a bogus (non-empty) token returns `401 Service credential rejected`
  rather than `503 … not configured on the server` — this distinguishes "wrong
  secret" from "no secret set" without ever using or requesting the real value.
- **Browser session (SPA):** Supabase email/password via `supabase-js`, session in
  `localStorage`. Separate from both server-side mechanisms above; not exercised
  this session (no credentials used, per standing instruction).

## 10. Existing database dependencies

- **Supabase Postgres** — accessed two ways: (a) `supabase-js` REST calls from
  `requireAuth` using the caller's own JWT (RLS applies), and (b) a raw `pg.Pool`
  against pooled `DATABASE_URL` for all `/api/check-*` and `/api/vault/*` routes
  (**RLS does not apply** to this path — it is a direct pooled connection, not a
  per-user Supabase client).
- **Prisma** — `@prisma/client` and `prisma` are declared dependencies
  (`package.json`) but **zero code references anywhere** (`grep -r "PrismaClient"` →
  no hits across `.ts`/`.tsx`). Present in the dependency tree, unused.
- **Audit logging** — `server/audit.ts` writes structured JSON to **stdout only**.
  No durable persistence: the file's own header states durable write-through
  "requires `DATABASE_URL`, which is not configured in this environment" and is
  tracked as follow-up work, not implemented.
- **Knowledge Vault tables** (`vault_documents`, `rd_library`, `timeline_milestones`,
  `phases`, `decision_records`) — none has an `organization_id` column; RLS is
  `USING (true)` (open read, no write policy); and the pooled-connection access path
  above bypasses RLS regardless of policy. This is an existing, open finding (not
  raised fresh here) — see §11.

## 11. Inherited, still-open findings that bear on "Production Ready?"

Per `docs/architecture` and `docs/project` reports already in this repository,
re-checked against current source this session and found **unchanged**:

- **Review Gate C status: BLOCKED** (`docs/project/GATE_C_CLOSURE_PACKAGE.md`,
  2026-09-06), four open items, none closable by further code inspection:
  1. `ai_providers.api_key` column not `REVOKE`d from `anon`/`authenticated`; no key
     rotation evidenced.
  2. No ratified Gate C closure-criteria record exists in the repo (only a
     self-labeled `DESIGN — NOT FROZEN` document).
  3. Knowledge Vault tenancy decision (Option A/B/C) not made.
  4. No evidence any real user has ever completed a live login.
- These are cited as existing, dated findings from prior audits in this same
  repository — not restated or extended recommendations from this report.

## 12. Bottom line

- **Deployment:** live, reachable, serving the intended API-only staging build; the
  Vercel project is not owned by any account accessible from this machine (unchanged
  since 2026-08-18) — env-var and deployment-history inspection on the real owning
  project remains a blocker, not resolved here.
- **API surface:** 15 routes exist; all behave in live production exactly as their
  source predicts — 2 public health checks, 2 disabled-in-prod dev routes (correctly
  404), 1 service-to-service AI route (S2S secret confirmed configured), 10
  end-user routes correctly gated by `requireAuth` (all confirmed 401 without a
  token).
- **AI layer:** Gemini and NVIDIA are real, server-side, credential-isolated
  adapters; NVIDIA has an operator-verified production proof call. OpenAI/Anthropic/
  DeepSeek exist only as non-functional legacy browser code. Groq and Ollama do not
  exist. No AI router beyond the two-provider `ProviderRouter.ts` exists.
- **Communication Hub:** does not exist. No WhatsApp, MSG91, Twilio, Spur, Email, or
  SMS adapter exists anywhere in code.
- **Orchestration / Agent Framework:** does not exist as a running system. The only
  code is a browser-only, disabled job poller and an 8-line agent stub.
- **Governing gate:** Review Gate C is **BLOCKED**, inherited from prior sessions in
  this same repository, with four named open items — this bears directly on the
  "Production Ready?" answer for every authenticated/tenant-scoped route above.
