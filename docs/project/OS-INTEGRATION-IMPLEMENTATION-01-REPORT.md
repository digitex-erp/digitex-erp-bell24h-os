# OS-INTEGRATION-IMPLEMENTATION-01 — First Real Integration Proof

**Sprint:** Bell24h-OS ↔ VyaparSethu — First Real Integration Proof (staging, minimal capability)
**Date:** 2026-08-11
**Branch:** `main` · **Starting checkpoint (unchanged, no commit made during implementation):** `2df75c8`

---

## 1. Objective

Prove one secure production architecture path end-to-end in a controlled (non-production)
environment: `VyaparSethu → Bell24h-OS authenticated API → Bell24h-OS capability → AI
Provider Manager → AI provider`. Not a full Bell24h-OS build; not a VyaparSethu
integration; one capability (AI text generation) only, per the founder-decision baseline
in `OS_INTEGRATION_DECISION_RECORD_V1.md`.

## 2. Starting Git Checkpoint

`git rev-parse HEAD` → `2df75c85512292a63df1809c7df3477470c0f8a3`, branch `main`, working
tree clean at start. **VERIFIED.**

## 3. Deployment Verification

**Phase 0 premise was false and is corrected here, not silently accepted.** The task
stated "Vercel has reported a successful build/deployment for commit 2df75c8." Direct
evidence this sprint: `mcp__claude_ai_Vercel__list_deployments` for
`digitex-erp-bell24h-os` returned **zero deployments, ever**, before this sprint began.
**VERIFIED false premise, corrected.**

Per the brief's own instruction for exactly this case ("if no staging environment exists,
implement only the minimum deployment configuration required"), and with explicit
founder confirmation before doing so (deploying is a new, consequential action for a
project that had never been deployed), a minimal API-only staging deployment was built
and shipped via Vercel's file-upload deploy path (`target: preview`).

**Three real build/runtime defects were found and fixed in this sprint** — none were
previously known, all are genuine ESM/serverless-compatibility bugs masked by local
tooling (`tsx`, `tsc --noEmit` with `moduleResolution: "bundler"`) that never surface
outside a strict Node ESM runtime like Vercel's:

1. `ERR_UNSUPPORTED_DIR_IMPORT` — `api/index.ts`'s `import "../server"` was ambiguous
   between the file `server.ts` and the directory `server/`; Node's ESM resolver picked
   the directory and refused it. **Fixed:** explicit `../server.js` specifier.
2. `ERR_MODULE_NOT_FOUND` — every relative import across `server.ts` and `server/**`
   lacked the `.js` extension Node's strict ESM loader requires at runtime (TypeScript's
   `moduleResolution: "bundler"` accepts extensionless imports at the source level; the
   compiled runtime does not). **Fixed:** added `.js` extensions to all 13 relative
   import specifiers across `server.ts`, `server/lib/requestContext.ts`,
   `server/middleware/requireAuth.ts`, `server/middleware/requireServiceAuth.ts`,
   `server/middleware/rateLimit.ts`, `server/ai/GeminiProvider.ts`,
   `server/ai/ProviderRouter.ts`.
3. `Cannot find module '@rollup/rollup-linux-x64-gnu'` — `vite` was statically imported
   at the top of `server.ts` purely for a dev-only branch; Vite's `rollup` dependency
   ships platform-specific native binaries as optional dependencies, and resolving them
   crashed the serverless runtime outright even though `createViteServer` is never called
   in production. **Fixed:** converted to a dynamic `await import("vite")` inside the
   `NODE_ENV !== "production"` branch, so it is never loaded at all outside local dev.

All three fixes were applied to the actual repository files (not just the deployment
payload), typechecked (`npx tsc --noEmit`, clean), and **re-verified against local
traditional hosting** (`npm run dev` equivalent, both the dev branch exercising the new
dynamic vite import and the production-static branch) before redeploying, to confirm
none of the fixes changed existing local behavior. **VERIFIED.**

**Final staging deployment:** `dpl_2EUfJc5ANNzNnJEJxJMwnDvuq377`,
`https://digitex-erp-bell24h-mwyoloqh5-bell24xs-projects.vercel.app`, `readyState:
READY`, `target: null` (non-production). **VERIFIED live and correctly serving traffic**
— see §6.

**Deployment protection:** discovered mid-sprint that Vercel's own platform-level SSO
(Deployment Protection) intercepted every request before it reached the Express app at
all — a real, distinct finding from anything in application code. With explicit founder
confirmation, protection was temporarily disabled for the verification window, the full
test suite (§6–8) was run, and protection was restored immediately after
(`ssoProtection.enabled: true`, `deploymentType: "prod_deployment_urls_and_all_previews"`
— the closest available setting to the original `all_except_custom_domains`, since that
exact value is not a valid input to the update API; effective coverage for a project with
no custom domains is equivalent). **VERIFIED restored** — confirmed via
`get_project_deployment_protection` immediately after re-enabling.

**Scope reduction, stated plainly:** this staging deployment serves the `/api/*` surface
only. The frontend SPA build (`vite build` against the full `src/` tree) was deliberately
not included — `buildCommand` produces a one-line placeholder `dist/index.html` instead.
This was a deliberate choice to keep the deployment payload to exactly what this sprint's
success condition requires (health + AI capability over HTTP), not a claim that the full
application is deployed. Any request to a non-`/api/*` path returns that placeholder
page, not the real app.

## 4. S2S Authentication Implementation

**New file:** `server/middleware/requireServiceAuth.ts`. Dedicated service-to-service
credential (Decision A, Option A from `OS_INTEGRATION_DECISION_RECORD_V1.md`) — a single
shared secret (`BELL24H_VYAPARSETHU_SERVICE_TOKEN`, server-side environment variable
only, never read by any browser-facing code), compared via SHA-256 digest +
`crypto.timingSafeEqual` (constant-time; digests avoid `timingSafeEqual`'s
equal-length-buffer requirement). Fails closed in every branch: missing header → 401
before server config is even checked (mirrors `requireAuth.ts`'s own ordering rationale);
missing server config → 503; mismatched credential → 401. Attaches
`req.serviceCaller = { system: "vyaparsethu" }` on success — a fixed, non-registry
identity per Decision B, not a new organization resolver (this middleware is parallel to
`requireAuth.ts`, not a modification of it — confirmed via `git diff`, zero lines changed
in `requireAuth.ts`'s own logic, only its request-ID and import lines already touched by
the prior SDK sprint). **VERIFIED** — code inspection + full runtime test suite, §7–8.

## 5. Trusted Caller Context

`ServiceCallerContext = { system: "vyaparsethu" }`. No `organization_id`, no `user_id`
mapping — deliberately absent, per Decision B's "no tenant mapping table" constraint. The
new `/api/v1/ai/text` route derives `organizationId`/`userId` passed to
`ProviderRouter` exclusively from `req.serviceCaller` (set only by
`requireServiceAuth` on a verified credential) — never from request body or any other
client-supplied field. **VERIFIED** by direct test: a request with
`{"prompt":"hello","organization_id":"attacker-supplied"}` in the body produced an audit
record showing `"organizationId":"vyaparsethu"` — the injected value had zero effect
(§8, security test 7).

## 6. Health Endpoint Verification

`/api/v1/health` — unchanged code from the prior SDK sprint, now runtime-verified against
the live staging URL for the first time:

```
GET /api/v1/health → 200 {"status":"ok","apiVersion":"v1","requestId":"req_msolg81z_xcdnc07t"}
Response header: X-Request-Id: req_msolg7sg_y83s0f45
```

Inbound request-ID propagation confirmed: `X-Request-Id: staging-trace-001` sent →
`X-Request-Id: staging-trace-001` echoed back, live on staging. `/api/health` (existing,
unversioned route) unchanged: `{"status":"ok"}`. **VERIFIED**, live HTTP, this sprint.

## 7. AI Capability Verification

**Local (full success path, real matching credential):** with
`BELL24H_VYAPARSETHU_SERVICE_TOKEN` set to a local test value and a matching
`X-Bell24h-Service-Token` header sent, the request passed S2S auth (audit:
`"action":"s2s.verify","outcome":"success"`) and reached the real `server/ai/ProviderRouter
→ GeminiProvider → Google's live Generative Language API`. The call returned a genuine
downstream rejection — `"API key not valid. Please pass a valid API key."` — because this
environment's local `.env` (pre-existing, dated before this session, not created or
modified by this sprint) contains a stale/invalid Gemini key. This is real evidence the
**entire path executes end-to-end**, including a live network call to Google's API; the
only unproven step is a *successful* generation, which requires a currently-unavailable
valid credential. **VERIFIED path execution; NOT VERIFIABLE full success** (no valid
provider credential reachable in this environment, by design — this session never holds
provider secrets, consistent with standing project convention).

**Staging:** `BELL24H_VYAPARSETHU_SERVICE_TOKEN` and `GEMINI_API_KEY` are not configured
on the Vercel deployment (this session has no Vercel env-var write access exercised, and
no real secret values to set even if it did). Requests correctly fail closed at the
earliest point config is missing: no header → 401 `AUTHENTICATION_FAILED`; header present
→ 503 `PROVIDER_UNAVAILABLE` naming the missing env var, never a secret value.
**VERIFIED fail-closed behavior on staging**; full success on staging is **BLOCKED** —
pending the founder configuring both env vars on Vercel (out of this session's authority
to do, per standing project convention on credentials).

No new AI provider, no new provider manager, no widened AI architecture — confirmed via
`git diff`: zero changes to `ProviderManager.ts` beyond the `.js` extension fix, zero new
providers.

## 8. Security Tests

| # | Test | Result | Evidence |
|---|---|---|---|
| 1 | Missing S2S credential fails | **VERIFIED** | Local + staging: `401 AUTHENTICATION_FAILED` |
| 2 | Invalid S2S credential fails | **VERIFIED** | Local: `401 AUTHENTICATION_FAILED` (wrong-token test) |
| 3 | Valid S2S credential succeeds | **VERIFIED (local only)** | Local: passed auth, reached the real provider call (§7) |
| 4 | Browser/client cannot obtain the credential | **VERIFIED** | `BELL24H_VYAPARSETHU_SERVICE_TOKEN` is read only via `process.env` inside `requireServiceAuth.ts` (server-only file, never imported from `src/` — confirmed by `grep`, this turn); never appears in any response body or header |
| 5 | Provider API key never appears in response | **VERIFIED** | Every response inspected this sprint (local + staging) — no key value in any body, header, or audit log line |
| 6 | Provider API key never appears in browser storage | **N/A / unchanged** | No browser code touched this sprint; BR-01's existing fix (credential never written client-side) is unmodified |
| 7 | Client-supplied `organization_id` cannot override trusted context | **VERIFIED** | §5 — injected value had zero effect on the audit-recorded `organizationId` |
| 8 | Existing user authentication continues to work | **VERIFIED** | `/api/check-table` unauthenticated → `401 {"error":"unauthenticated","requestId":...}`, byte-identical shape to before this sprint, both locally and on staging |
| 9 | Existing RLS remains enabled | **NOT RE-VERIFIED THIS SPRINT** — no schema/RLS file touched (`git diff` confirms), no reason to expect a change; last directly verified in BR-03 | — |
| 10 | Authentication failures produce canonical errors | **VERIFIED** | All `requireServiceAuth` denials use `server/lib/errors.ts`'s `sendError` (`error_code`/`message`/`request_id`/`correlation_id`/`retryable`) — this is the canonical envelope's first real production use, previously dormant per the prior SDK implementation report |
| 11 | Request IDs propagate | **VERIFIED** | §6, and every audit log line this sprint carries a matching `requestId` |
| 12 | Audit logging occurs | **VERIFIED** | Real structured audit JSON confirmed in live Vercel runtime logs for both `s2s.verify` and `auth.verify` events, matching request IDs and outcomes exactly (§9) |

No secret value was printed in producing this report.

## 9. Failure Tests

**AI provider failure (Phase 7 of the brief):** the "invalid API key" rejection from
Google's live API (§7) is a genuine, non-fabricated provider failure — not a simulated
one. Verified:
- **Canonical error:** the route maps unrecognized provider errors to
  `INTERNAL_ERROR` (500) via `sendError` — confirmed in the local log
  (`error_code":"INTERNAL_ERROR"`).
- **No secret leakage:** the logged error message
  (`"API key not valid. Please pass a valid API key."`) is Google's own generic rejection
  text; it does not echo the key value (confirmed by reading the full log line, this
  turn).
- **Request ID preserved:** the failed request's `requestId` matches across the HTTP
  response and the audit log line.
- **Audit/telemetry preserved:** `ProviderRouter.ts`'s existing `run()` wrapper emitted a
  `failure` audit event (`"errorCode":"provider_error"`) — unchanged code, working as
  designed.
- **No server crash:** the process continued serving subsequent requests normally after
  the failure (confirmed — the same local server handled the next several test requests
  without restart).
- **Appropriate status:** 500 was returned; arguably `PROVIDER_UNAVAILABLE` (503) would be
  a more precise mapping for an invalid-credential-at-the-provider case specifically, but
  `GeminiProvider.ts` does not classify this distinct error with its own `.code` today —
  noted as a P1 refinement, not fixed this sprint (would touch shared AI code beyond this
  sprint's narrow scope).

No new retry/circuit-breaker logic was added — none existed before, none was needed to
observe this failure mode cleanly.

## 10. Runtime Evidence

All of the following are real HTTP responses and real Vercel runtime log lines captured
this sprint (not asserted, not simulated) — see §3, §6–9 for the specific request/response
pairs and log excerpts. Deployment ID `dpl_2EUfJc5ANNzNnJEJxJMwnDvuq377`.

## 11. Build/Test Results

| Command | Result |
|---|---|
| `npx tsc --noEmit` (final state) | **PASS** (exit 0, no output) |
| Local traditional hosting (`npx tsx server.ts`), production-static branch | **PASS** — `/api/v1/health`, `/api/health`, `/api/check-table` (401) all verified after the createApp() refactor |
| Local traditional hosting, dev branch (exercises the new dynamic `vite` import) | **PASS** — verified after the vite-lazy-load fix, same three routes |
| Local S2S auth full test matrix | **PASS** — see §8 |
| Vercel build (staging) | **PASS** on the 4th attempt — 3 real build/runtime defects found and fixed (§3); first 3 attempts failed with `STATIC_BUILD_NO_OUT_DIR`, `invalid_version_value` (npm resolution), and two distinct ESM resolution errors, each diagnosed from real Vercel build/runtime logs, not guessed |
| Vercel staging runtime HTTP verification | **PASS** — full suite in §6–8, not claimed from build success alone |
| Unit/integration test suite | **NOT RUN — REASON:** no test suite exists in this repository (unchanged finding from every prior sprint) |

## 12. Files Changed

**OS-INTEGRATION-IMPLEMENTATION-01 changes:**

| File | Change |
|---|---|
| `server/middleware/requireServiceAuth.ts` | New — S2S authentication middleware (§4) |
| `api/index.ts` | New — Vercel serverless entry point wrapping `createApp()` |
| `vercel.json` | New — minimal deployment configuration (API-only staging build) |
| `server.ts` | Modified: extracted `createApp()` (returns the Express app without calling `listen()`, for serverless use — traditional hosting behavior unchanged); added `/api/v1/ai/text` route; added `.js` extensions to 7 relative imports; made the `vite` import dynamic/dev-only |
| `server/lib/requestContext.ts` | Modified: `.js` extension fix only (1 line) |
| `server/middleware/requireAuth.ts` | Modified: `.js` extension fixes only (2 lines) — no logic change |
| `server/middleware/rateLimit.ts` | Modified: `.js` extension fixes only (2 lines) — no logic change |
| `server/ai/GeminiProvider.ts` | Modified: `.js` extension fix only (1 line) |
| `server/ai/ProviderRouter.ts` | Modified: `.js` extension fixes only (2 lines) — no logic change |

## 13. Pre-Existing Changes (untouched by this sprint)

Confirmed via `git diff` scope this sprint touched exactly the files in §12 and nothing
else. Everything committed to `main` as of checkpoint `2df75c8` (the full BR-01 through
OS_INTEGRATION_DECISION_RECORD_V1 history) is unchanged. The local `.env` file referenced
in §7 predates this session (dated before this sprint) and was neither created nor
modified.

## 14. Remaining Blockers

1. **`BELL24H_VYAPARSETHU_SERVICE_TOKEN` and `GEMINI_API_KEY` are not configured on the
   staging Vercel deployment** — required before a full success path (not just fail-closed
   behavior) can be demonstrated live on staging. Setting these is a founder/ops action;
   this session holds no credentials to set and does not request them, per standing
   project convention.
2. **No real VyaparSethu caller was used** — a controlled `curl`-based test client stood in
   for it (§Test Client below), per the brief's explicit fallback allowance. Actual
   VyaparSethu integration remains unauthorized and untouched (Decision Record §11).
3. **Frontend SPA was not included in this deployment** (§3 scope reduction) — a
   deliberate, stated choice for this sprint's narrow scope, not a defect.

## 15. VyaparSethu Integration Status

**Unchanged: not yet integrated.** No VyaparSethu code, repository, or production
system was touched, inspected, or connected. This sprint proves the Bell24h-OS side of
the architecture path is real and reachable in a controlled environment; it does not
constitute an actual VyaparSethu integration, and this report does not claim one.

### Test Client

Per Phase 5's explicit fallback ("if actual VyaparSethu repository access is unavailable,
use a controlled HTTP test that faithfully represents the VyaparSethu service caller"):
plain `curl` requests carrying the `X-Bell24h-Service-Token` header stood in for a real
VyaparSethu caller. No test client code was committed to this repository; no credentials
were stored in source code; the local test token used during verification existed only as
a transient shell environment variable for the local server process and was never
written to any file.

## 16. Final Verdict

Not stated here as prose — see the required structured verdict block below, per the
brief's exact format.

---

# OS-INTEGRATION-IMPLEMENTATION-01 VERDICT

**BELL24H-OS DEPLOYMENT:**
VERIFIED (staging, API-only surface; frontend SPA intentionally excluded — see §3)

**STAGING:**
VERIFIED

**S2S AUTH:**
VERIFIED (fail-closed paths verified live on staging; full success path verified locally with a real matching credential — not yet demonstrated live on staging, pending env var configuration)

**TRUSTED CALLER:**
VERIFIED

**HEALTH:**
VERIFIED

**AI TEXT CAPABILITY:**
NOT VERIFIABLE (full success) / VERIFIED (path execution, fail-closed behavior) — no valid provider credential is reachable in this environment to prove a successful generation; every other part of the path (auth → trusted context → routing → real provider call → error handling) is verified

**VYAPARSETHU REAL INTEGRATION:**
NOT YET INTEGRATED

**SECURITY:**
PASS

**BUILD:**
PASS

**COMMIT:**
Applied after this report — see final message (explicit founder instruction to push to `https://github.com/digitex-erp/digitex-erp-bell24h-os.git` received after implementation began; overrides this task's original no-commit default)

**PUSH:**
Applied after this report — same reason

**NEXT GATE:**
Configure `BELL24H_VYAPARSETHU_SERVICE_TOKEN` and `GEMINI_API_KEY` as environment
variables on the Vercel staging deployment, then re-run the AI capability test live
against staging to close the one remaining "NOT VERIFIABLE" item. This is a founder/ops
action, not further engineering work.

---

## Vercel Staging Deployment Repair

**Sprint:** OS-INTEGRATION-IMPLEMENTATION-01 — Deployment Fix
**Date:** 2026-08-11 (same day, follow-up sprint)
**Starting checkpoint:** `2b7aa6a` (clean working tree)

### 1. Original Failure

The repair sprint's own brief stated the latest Vercel build failed for commit `2b7aa6a`
with `"Error: No Output Directory named 'build' found after the Build completed."`
**UNKNOWN whether this event actually occurred** — see §2. Regardless of that premise,
this section documents the real repair performed.

### 2. Root Cause

**INFERRED: the stated failure did not occur as described.** Direct evidence this turn:
`list_deployments` for this project returns exactly 6 deployments, all created in the
prior sprint, none newer than `dpl_2EUfJc5ANNzNnJEJxJMwnDvuq377` (created before this
repair sprint began) and none associated with commit `2b7aa6a` — the last deployment's
own `meta` carries no git-commit reference at all, confirming it was a file-upload
deploy (`deploy_to_vercel`), not a git-triggered one. This project has no GitHub
integration wired up, so pushing to `origin/main` cannot trigger a Vercel build.
**There is no mechanism by which commit `2b7aa6a` could have produced any Vercel build.**
Neither historical failed deployment in this project's real history ever mentioned a
directory named `"build"` (their real errors:
`STATIC_BUILD_NO_OUT_DIR: No Output Directory named "dist"...` and a separate
`invalid_version_value` npm-resolution failure) — so even the specific directory name in
the described error doesn't match anything this project has actually produced.
**VERIFIED** (evidence: `list_deployments`, `get_deployment` on the two real historical
failures).

**A real, separate, worth-fixing issue was found during this inspection and is the
actual repair performed:** the **committed** `vercel.json` at `2b7aa6a` was missing
`outputDirectory` entirely and its `buildCommand` was a plain `echo` that never created
`dist/index.html`. The deployment that actually succeeded in the prior sprint worked only
because its `outputDirectory`/`buildCommand` were passed out-of-band via the
`deploy_to_vercel` tool's `projectSettings` parameter, not from the committed file — a
real configuration-drift bug: anyone deploying from the committed file alone would have
hit a missing-output-directory failure (though naming `"dist"`, per the real historical
precedent, not `"build"`). **VERIFIED** (direct diff between the committed file and the
known-working `projectSettings`).

### 3. Configuration Inspected

`vercel.json` (committed vs. what was actually deployed), `package.json` (`build`
script — `vite build && esbuild server.ts ...`, unchanged, not the cause), `vite.config.ts`
(no custom `build.outDir`; Vite's own default is `dist`, never `build`), `server.ts`
(unchanged since the prior sprint), `.gitignore` (`dist/` correctly ignored). **VERIFIED**
— all read directly this turn.

### 4. Configuration Changed

`vercel.json` only:
```diff
   "framework": null,
+  "outputDirectory": "dist",
-  "buildCommand": "echo 'API-only staging build ... intentionally skipped ...'",
+  "buildCommand": "mkdir -p dist && echo '<!doctype html>...' > dist/index.html",
   "rewrites": [ ... ]
```
No source code, no authentication, no AI, no tenant logic touched — confirmed via
`git diff --name-only` (§ Git Discipline below).

### 5. Why the Fix Is Correct

This exact configuration (`outputDirectory: "dist"`, a `buildCommand` that creates
`dist/index.html`) is the one already proven to build and run successfully in the prior
sprint's own verification (`dpl_2EUfJc5ANNzNnJEJxJMwnDvuq377`, `READY`, full HTTP test
suite passed). This repair makes the **committed file** match what was already known to
work, rather than relying on an out-of-band parameter that isn't durably part of the
repository. **VERIFIED** by the successful redeploy in §8.

### 6. Local Build Result

`npm run build` (the repository's normal, unmodified build — Model A: static SPA + API
server, unchanged): **PASS**. Produced exactly the expected artifacts:
`dist/index.html`, `dist/assets/index-*.css`, `dist/assets/index-*.js`,
`dist/server.cjs`, `dist/server.cjs.map`. `node dist/server.cjs` (the real bundled
server, `PORT=5320 NODE_ENV=production`, run locally): `/api/v1/health` → `200
{"status":"ok","apiVersion":"v1","requestId":...}` with `X-Request-Id` header;
`/api/health` → `200`; `/api/check-table` (no auth) → `401`; `/` (root SPA page, now
serving the real built `index.html`) → `200`. **VERIFIED**, this turn.

### 7. Typecheck Result

`npx tsc --noEmit` → **PASS** (exit 0, no output). **VERIFIED.**

### 8. Vercel Deployment Result

Redeployed via `deploy_to_vercel` (`target: preview`, matching Decision C — staging
first) with the corrected `vercel.json`. Deployment `dpl_k9wxJRarfhr7gNsFoNYSda2T2ntk` —
`readyState: READY`, `target: null` (non-production). **VERIFIED.**

### 9. Staging URL

`https://digitex-erp-bell24h-dlwc739j2-bell24xs-projects.vercel.app`

### 10. `/api/v1/health` Runtime Result

One genuine, authenticated remote fetch (`web_fetch_vercel_url`, this turn) returned:
`200 OK`, body `{"status":"ok","apiVersion":"v1","requestId":"req_msoxp84y_dcx5aw38"}`,
header `x-request-id: req_msoxp84y_dcx5aw38`. **VERIFIED**, real, timestamped
(2026-08-11T17:28:28Z).

**Caveat, stated precisely rather than glossed over:** this deployment is behind
Vercel's own SSO Deployment Protection (unchanged setting from the prior sprint, applies
to all non-custom-domain deployments on this project). The one successful fetch above
appears to have used a cached bypass token from earlier in this session; two subsequent
fetches of the same URL (`/api/v1/health` again, and `/api/health`) were redirected to
Vercel's SSO login instead. The action that reliably enabled full verification in the
prior sprint — temporarily disabling SSO protection — was **blocked by this session's
permission classifier** on this attempt (it was permitted earlier in this same overall
task). Rather than retrying or working around that block, this was stopped and is
reported here for the founder to decide, per the classifier's own guidance. **Net
result: genuine runtime success is proven once, not repeatably confirmed this turn** —
distinct from, and more precise than, claiming full re-verification.

Database status: not exposed by `/api/v1/health`'s current response shape (unchanged;
this endpoint has never reported DB connectivity — confirmed by reading the route's
source, unchanged since the prior sprint).

### 11. Production Impact

**UNCHANGED.** This project has no custom domain and no production traffic (confirmed
in the prior sprint: `domains` contains only auto-generated `*.vercel.app` subdomains).
The redeploy targeted `preview`, and the platform independently reported
`target: null` (non-production) for the resulting deployment. No environment variable
was read, set, or changed this turn beyond the one blocked (not executed) attempt to
toggle deployment protection.

### 12. Remaining Integration-01 Work

Unchanged from the prior sprint's "NEXT GATE": configure
`BELL24H_VYAPARSETHU_SERVICE_TOKEN` and `GEMINI_API_KEY` on Vercel (founder/ops action),
then S2S authentication and AI capability can be re-verified live against a now-correctly
-configured staging deployment. Per this repair sprint's own Phase 9, S2S auth, trusted
caller, AI capability, Communication Hub, and every other capability remain explicitly
not started this turn.

---

## Deployment Truth Reconciliation

**Sprint:** OS-INTEGRATION-IMPLEMENTATION-01 — Deployment Truth Reconciliation
**Date:** 2026-08-12
**HEAD:** `465f280` (unchanged by this sprint — investigation and documentation only)

### Summary — the founder's screenshot is correct, and points at a real finding

**The "Production" badge is genuine, not a misread UI label, and it uncovered a real
security-relevant gap: this project's Production domain
(`digitex-erp-bell24h-os.vercel.app`) is live and publicly reachable without the SSO
protection this sprint's own settings claimed to enforce.** Confirmed with direct,
unauthenticated HTTP evidence, this turn — see §6.

### 1. `465f280` Deployment Records

**VERIFIED — zero deployments carry any git-commit association at all, for any commit,
ever, in this project.** `list_deployments` for `digitex-erp-bell24h-os`
(`prj_8oLwDwlcBgJAuf4FFFsSWwBcFBGp`) returns **7 total deployments**. Every one's `meta`
field is either empty (`{}`) or contains only `lambdaRuntimeStats` — none carries a
`githubCommitSha`, branch name, or any other git reference. This is expected: every
deployment in this project's history was created via `deploy_to_vercel` (a file-upload
deploy path, explicitly documented as "no git repo and no CLI needed"), never via a
GitHub-integration-triggered build. **There is no deployment record anywhere in this
project literally "for" commit `465f280`** — the deployment that happens to contain the
same file content `465f280` also contains
(`dpl_k9wxJRarfhr7gNsFoNYSda2T2ntk`) was created *before* that commit existed locally,
via a manually-uploaded file tree, not a git checkout.

| Deployment ID | URL | state | readyState | target | createdAt |
|---|---|---|---|---|---|
| `dpl_k9wxJRarfhr7gNsFoNYSda2T2ntk` | `digitex-erp-bell24h-dlwc739j2-...` | READY | READY | `null` | 2026-08-11T17:27:17Z |
| `dpl_2EUfJc5ANNzNnJEJxJMwnDvuq377` | `digitex-erp-bell24h-mwyoloqh5-...` | READY | READY | `null` | 2026-08-11T (prior sprint) |
| `dpl_9dBBKwBaamrFqQmE3T87rKwDVpvM` | `digitex-erp-bell24h-9alj56zez-...` | READY | READY | `null` | 2026-08-11T (prior sprint) |
| `dpl_98y3scCBE8GfxKaRmJgdma6UiNia` | `digitex-erp-bell24h-91rblufvq-...` | READY | READY | `null` | 2026-08-11T (prior sprint) |
| `dpl_4QRK6MN2UJ2XMoVC5zBFmAvKTnTv` | `digitex-erp-bell24h-2lva7gutm-...` | READY | READY | `null` | 2026-08-11T (prior sprint) |
| `dpl_6LwVY9NqVDMcbBfqmc1Zh5i5Hydz` | `digitex-erp-bell24h-52khaaza7-...` | ERROR | ERROR | `null` | 2026-08-11T (prior sprint, npm resolution failure) |
| `dpl_9W5L1A2fVEfURAJHkHXuwHtnYiBo` | `digitex-erp-bell24h-47u703kae-...` | ERROR | ERROR | **`production`** | 2026-08-11T (prior sprint — the project's very first deployment ever, auto-assigned production target by the platform, failed to build) |

None of the seven carry a git commit SHA. **VERIFIED.**

### 2. Environment: `PRODUCTION` and `PREVIEW`, via two different mechanisms — not a single simple answer

**INFERRED, with strong direct evidence:** exactly one deployment record has ever had
`target: "production"` in Vercel's API (`dpl_9W5L1A2fVEfURAJHkHXuwHtnYiBo`), and it is in
`ERROR` state — it never successfully served anything. Every deployment since, including
the current `latestDeployment` (`dpl_k9wxJRarfhr7gNsFoNYSda2T2ntk`), reports
`target: null` via the API.

**However — this is not the full picture, and the founder's screenshot is why.** The
project's short-form default domain, `digitex-erp-bell24h-os.vercel.app`, is **not
listed** in `get_project`'s own `domains` array (which only lists two longer, team-scoped
aliases) — it is Vercel's automatic, inherent default domain for the project, assigned
independent of any explicit "add domain" action. Direct, unauthenticated `curl` against
that domain (§6) returns **my own application's exact content** — the placeholder
`Bell24h-OS staging` HTML and a genuine `/api/v1/health` JSON response — proving this
domain is live and currently serving the same deployment content as
`dpl_k9wxJRarfhr7gNsFoNYSda2T2ntk`. This domain is, by Vercel's own platform convention,
the project's **Production environment's** default domain. A dashboard view keyed off
that domain would correctly show a "Production" badge — **the badge is accurate to what
Vercel's platform considers Production for this project**, even though the per-deployment
API `target` field for the deployment currently occupying it reports `null`.

**Reconciling Phase 4's five options precisely:** this is **closest to option 3+4
combined** — there are not "two deployments for the same commit" in the sense of two
separate builds; there is **one deployment, serving two roles**: it is both the project's
`latestDeployment` (reported `target: null`, a "preview"-style record) and, independently,
the deployment currently occupying the Production domain slot (which Vercel's dashboard
correctly labels "Production"). The API's per-deployment `target` field and the
project's actual domain-based environment assignment are **two different, not fully
consistent signals** in this project's current state — both are real, neither is wrong,
they just answer different questions. **VERIFIED** that the domain serves this content;
**INFERRED** (not directly confirmed via a dashboard screenshot on this session's side)
that this is exactly what the founder's badge reflects — but it is the only
evidence-supported explanation, and no alternative (a second project, a different repo,
a misread label) survived investigation.

### 3. Project Configuration

- **Production branch:** **UNKNOWN / not applicable** — no GitHub repository is linked to
  this Vercel project (see below), so there is no git-branch-to-environment mapping to
  report.
- **GitHub connected to Vercel:** **INFERRED: NO.** Every one of the 7 deployments in this
  project's history lacks any git metadata; `deploy_to_vercel` (the only deployment
  mechanism used, ever, for this project) is explicitly a non-git, file-upload path. This
  session holds no direct "list connected git integrations" tool, so this is inferred
  from consistent absence of evidence across every deployment record, not confirmed via a
  dedicated settings endpoint.
- **Git pushes automatically create deployments:** **NO** — follows directly from the
  above; this session's `git push` calls throughout this entire task family have never
  once been followed by a new deployment appearing in `list_deployments` unless this
  session explicitly called `deploy_to_vercel` itself.
- **Deployment protection (Vercel Authentication / SSO):** reported by
  `get_project_deployment_protection` as `enabled: true`,
  `deploymentType: "prod_deployment_urls_and_all_previews"` — **but this setting is not
  actually being enforced on the production domain**, per §6's direct evidence. Recorded
  precisely as a contradiction between the settings API's stated value and observed
  runtime behavior, not resolved by assumption. One plausible, evidence-adjacent
  explanation: earlier this task family, setting `ssoProtection` with
  `deploymentType: "all"` was rejected outright by the API with
  `"Vercel Authentication is not available on your plan for production deployments"` —
  suggesting this team's plan may not actually support enforcing SSO on production
  traffic at all, and the `"prod_deployment_urls_and_all_previews"` value that *was*
  accepted may only be enforced for its preview portion. **INFERRED**, not confirmed via
  Vercel support or billing detail this session has no access to.
- **Environment variable environments:** **UNCHANGED, NO new secrets configured** —
  `BELL24H_VYAPARSETHU_SERVICE_TOKEN` and `GEMINI_API_KEY` were not set, inspected, or
  referenced with any value this turn. **VERIFIED** — no write action to environment
  variables was attempted this sprint.

### 4. Screenshot Reconciliation — Direct Answers to Phase 4's Six Questions

1. **Does the dashboard badge really represent Production?** Yes — it reflects the
   project's actual Production domain slot, which is genuinely serving live content.
2. **Does the deployment record report a different target?** Yes — the same underlying
   deployment's own API record reports `target: null`. Both are true simultaneously; they
   describe different aspects of Vercel's data model (see §2).
3. **Are there two deployments for the same commit?** No — one deployment, occupying two
   roles (project `latestDeployment` and Production-domain occupant).
4. **Is the UI label being interpreted incorrectly?** No — the label is accurate to what
   is actually being served on the Production domain.
5. **Does the URL belong to a production deployment?** If the founder's screenshot shows
   `digitex-erp-bell24h-os.vercel.app` (or its dashboard entry) — yes, genuinely.
6. **Does the URL belong to a preview deployment?** The *other* URLs this task family has
   been testing against (the `-dlwc739j2-`, `-mwyoloqh5-` etc. deployment-specific
   hostnames, and the two longer `domains[]` aliases) are, by contrast, the ones actually
   gated by SSO protection — functioning as the "preview" side of this same picture.

### 5. Domain Verification

`digitex-erp-bell24h-os.vercel.app` is **VERIFIED, by direct evidence this turn, to be
the project's own default/Production domain** — not a preview deployment URL, not a
project alias in the `domains[]` list sense (it doesn't appear there, being automatic
rather than explicitly added), and not an unrelated project: the content served is
byte-identical to this project's own known application code (confirmed via the exact
placeholder HTML string and the `/api/v1/health` JSON shape, both authored in this task
family and found nowhere else).

### 6. Runtime Check (read-only; no protection settings changed this turn)

| Target | Result |
|---|---|
| Deployment-specific URL (`digitex-erp-bell24h-dlwc739j2-...`), `/api/v1/health` | `302` → Vercel SSO redirect. **PROTECTED BY VERCEL DEPLOYMENT PROTECTION.** |
| Project alias domain (`digitex-erp-bell24h-os-bell24hhelpline-8523-...`), `/api/v1/health` | `302` → Vercel SSO redirect. **PROTECTED BY VERCEL DEPLOYMENT PROTECTION.** |
| Project default domain (`digitex-erp-bell24h-os.vercel.app`), `/api/v1/health` | **`200 OK`**, plain unauthenticated `curl`, this turn — `{"status":"ok","apiVersion":"v1","requestId":"req_msp0dq6n_le5dgv5u"}`. **VERIFIED reachable, unprotected.** |
| Same domain, `/` | `200 OK`, serves this project's own placeholder HTML. **VERIFIED.** |
| Same domain, `/api/env/diagnostic` | `404` — the existing `devOnly` production guard is working correctly. **VERIFIED no diagnostic/secret-disclosure route is reachable.** |
| Same domain, `/api/v1/ai/text` (no credential) | `401 AUTHENTICATION_FAILED`, canonical envelope, no secret leaked. **VERIFIED fail-closed even though the transport itself is unprotected.** |
| Same domain, `/api/check-table` (no auth) | `401 {"error":"unauthenticated",...}`. **VERIFIED unchanged, fail-closed.** |

**APPLICATION RUNTIME: VERIFIED** (genuinely reachable, both protected and unprotected
paths exist depending on which domain is used) — **not** simply "PROTECTED," because one
real, public path bypasses protection entirely.

**Security posture, stated plainly:** the application's own code is behaving correctly
under this exposure — every route that should require authentication does, the dev-only
diagnostic route is correctly gated, and no secret is configured anywhere to leak. The
finding is that the **transport-level gate this task family believed was covering all
traffic does not cover this specific domain**, which is exactly the situation the
founder's screenshot flagged and which this task's own instruction ("this contradiction
MUST be resolved before any credentials are configured") anticipated. **No S2S or AI
provider credential should be configured until this is either accepted as an acceptable
risk (nothing secret is exposed today) or fixed (a deliberate decision, correctly out of
this sprint's locked scope).**

### 7. Security Boundary

**VERIFIED: no new secret was configured, inspected, or printed this turn.**
`BELL24H_VYAPARSETHU_SERVICE_TOKEN` and `GEMINI_API_KEY` remain unset on every Vercel
deployment in this project, confirmed indirectly via the `401`/`503`-shaped responses
observed throughout this task family and directly via this sprint's explicit
instruction not to touch them, which was followed.

### Final Determination

See the structured verdict block in the final message of this sprint (not duplicated
here to avoid drift between two copies of the same facts).
