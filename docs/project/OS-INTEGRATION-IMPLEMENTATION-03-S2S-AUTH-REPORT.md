# OS-INTEGRATION-IMPLEMENTATION-03 — S2S Authentication + Trusted VyaparSethu Caller

**Date:** 2026-08-12
**Starting checkpoint:** `f694e3d` (clean working tree)

---

## 1. Starting Checkpoint

`git rev-parse HEAD` → `f694e3d`, `git status --short` → clean. **VERIFIED.**

## 2. Existing `requireServiceAuth` Implementation (Phase 0)

Re-confirmed by direct source inspection this turn (unchanged since
OS-INTEGRATION-IMPLEMENTATION-01/02 — zero diff):

| Question | Answer |
|---|---|
| 1. Header? | `X-Bell24h-Service-Token` (`SERVICE_TOKEN_HEADER = "x-bell24h-service-token"`) |
| 2. Comparison method? | SHA-256 digest of both sides, compared via `crypto.timingSafeEqual` — constant-time, avoids the equal-length-buffer requirement |
| 3. Environment variable? | `BELL24H_VYAPARSETHU_SERVICE_TOKEN` |
| 4. Establishes `caller_system`? | Yes — `serviceReq.serviceCaller = { system: "vyaparsethu" }`, a fixed, non-client-derived value |
| 5. Establishes service identity? | Yes — same field, used downstream as both `userId: "service:vyaparsethu"` and `organizationId: "vyaparsethu"` in the AI router context |
| 6. Status on missing credential? | `401` |
| 7. Status on invalid credential? | `401` |
| 8. Leaks auth info? | No exploitable leak. One minor, non-actionable distinction: the message text differs between "missing header" and "credential rejected" — this reveals only whether a header was *sent*, not anything about the secret's value, shape, or length |
| 9. Preserves request ID? | Yes — via `resolveRequestId`, on every branch including denials |
| 10. Logs failures? | Yes — `emitAuditEvent`, action `s2s.verify`, outcome `denied`, on every failure branch |

**Conclusion: the existing implementation is already correct. Not rewritten, not
replaced — reused exactly as-is, per this sprint's own instruction.**

## 3. Credential Storage Design (Phase 2)

**BLOCKED — no tool available in this session to write a Vercel environment
variable, for any environment.** This is a harder blocker than "which environment is
correct": a repository-wide search of every Vercel-prefixed tool available this session
(`get_project`, `get_project_deployment_protection`,
`update_project_deployment_protection`, `deploy_to_vercel`, `list_deployments`,
`get_deployment`, `get_deployment_build_logs`, `get_runtime_logs`, `get_runtime_errors`,
`web_fetch_vercel_url`, `get_access_to_vercel_url`, `list_projects`, `get_web_analytics`,
`list_toolbar_threads`, the `buy_*`/`get_purchase_quote` billing tools) confirms **none
of them can create, update, or delete an environment variable on any Vercel project.**
No secret was invented, generated for real use, or configured — consistent with this
sprint's absolute rule.

**Per this sprint's own Phase 2 instruction, this is reported as the exact blocker
rather than worked around.** The design guidance for whoever does have that access
(documented in `docs/architecture/OS_API_SECURITY_BOUNDARY_V1.md` §8, unchanged this
sprint) still applies: Production and Preview should use different values, and — given
OS-INTEGRATION-IMPLEMENTATION-02's finding that the Production domain's SSO protection
gap remains open and unresolved — configuring the real Production secret today would
place it behind an application-layer gate only (sound, verified — see §5–6) with no
additional transport-level gate, which is worth the founder's explicit awareness at the
moment they do configure it, not a reason to avoid configuring it (the application layer
gate is real and sufficient on its own, per the threat model in the boundary doc).

## 4. Authentication Header (Phase 3)

`X-Bell24h-Service-Token` — the existing, already-implemented format. No second header,
no `Authorization: Bearer` variant, no new format introduced. **VERIFIED unchanged.**

## 5. Trusted Caller Identity (Phase 1 / Phase 5)

`caller_system = "vyaparsethu"`, established only after successful authentication, never
accepted from request body/query/headers. **VERIFIED this turn**, locally, with a real
generated-and-discarded test credential (never printed, never committed, removed
immediately after use — see §6): a request carrying
`{"caller_system":"admin","organization_id":"attacker-org","tenant_id":"attacker-tenant"}`
in its body, sent with a *valid* credential, produced an audit record showing
`"actor":"service:vyaparsethu","organizationId":"vyaparsethu"` — every injected field had
zero effect. No new database table, no tenant-mapping table was created (none was
needed).

## 6. Negative Tests (Phase 4 Tests 1–3, Phase 6)

All four combinations tested **both locally (with a real, ephemeral, generated-only-for-
this-test credential) and against the live public production domain**
(`digitex-erp-bell24h-os.vercel.app`) this turn:

| Test | Local result | Live production result |
|---|---|---|
| No credential | `401 AUTHENTICATION_FAILED` | `401 AUTHENTICATION_FAILED` |
| Random invalid credential | `401 AUTHENTICATION_FAILED` | `503 PROVIDER_UNAVAILABLE` — because production has no `BELL24H_VYAPARSETHU_SERVICE_TOKEN` configured at all (§3), so there is nothing to compare against; this is the correct fail-closed behavior for that specific state, not a different code path |
| Malformed (empty) credential | `401 AUTHENTICATION_FAILED` | `401 AUTHENTICATION_FAILED` |
| Client-supplied `caller_system`/`organization_id`/`tenant_id` override attempt | Zero effect (§5) | Not separately re-tested live (requires a valid credential, which production doesn't have configured — local result is the relevant evidence, same code path) |

**VERIFIED** for every row reachable without a live secret; the "random invalid
credential" row's differing status code between local (401) and live (503) is itself
expected and explained, not a discrepancy.

## 7. Positive Authentication Test (Phase 4 Test 4)

**VERIFIED locally only.** With a real, locally-generated-and-immediately-discarded test
token set as `BELL24H_VYAPARSETHU_SERVICE_TOKEN` in a local process environment (never
written to any file that persisted, never printed, removed after the test run):
authentication succeeded (`s2s.verify` / `outcome: success`, `actor:
"service:vyaparsethu"`), and the request proceeded to attempt AI generation via the real
`server/ai/ProviderRouter` → `GeminiProvider` → Google's live API, which rejected the
environment's separate, pre-existing, stale local `GEMINI_API_KEY` with "API key not
valid" — proving the full path executes, and cleanly separating **authentication
success** from **AI provider execution**, per this sprint's explicit instruction not to
conflate the two.

**NOT VERIFIABLE against live production** — no real service credential is configured
there (§3), and none was invented to force a misleading live "success."

## 8. `/api/v1/ai/text` Test (Phase 5)

No new endpoint was introduced. The existing route was used as-is. Minimum required
payload: `{"prompt": "<non-empty string>"}` — confirmed via the route's own validation
(`VALIDATION_FAILED` / 400 if `prompt` is missing or empty; not separately re-tested this
turn, unchanged since OS-INTEGRATION-IMPLEMENTATION-01). Canonical response/error format
intact throughout (§6, §7). No provider credential and no service token ever appeared in
any response body, confirmed by direct inspection of every response this turn.

## 9. Request ID Evidence

**VERIFIED** on every test in §6 and §7 — every response, success or denial, carried a
`request_id`/`correlation_id` matching the `requestId` sent (or a generated one when
none was sent), including a live-production test with `X-Request-Id: live-s2s-test-001`
echoed back verbatim in both the header and the JSON body.

## 10. Secret Exposure Checks (Phase 7)

All **VERIFIED clean, this turn:**
- `grep -rl "BELL24H_VYAPARSETHU_SERVICE_TOKEN" src/` → zero matches (the variable name
  never appears in frontend source).
- Fresh `npm run build`, then `grep -l "BELL24H_VYAPARSETHU_SERVICE_TOKEN" dist/assets/*.js`
  → zero matches (the variable name never appears in the built browser bundle).
- `grep -l "x-bell24h-service-token" dist/assets/*.js` → zero matches (the header string
  never appears in the built browser bundle either — no frontend code path references
  this credential at all).
- `grep -rl "requireServiceAuth" src/` → zero matches (the middleware file itself is
  never imported from client code).
- The actual secret value was never printed in this report or in any tool output —
  every reference to it in this document is `[REDACTED]` or absent entirely.

## 11. Provider Boundary (Phase 9)

**VERIFIED unchanged.** `git diff --stat` this sprint shows zero changes to
`server/ai/ProviderManager.ts`, `server/ai/ProviderRouter.ts`, or
`server/ai/GeminiProvider.ts`. `/api/v1/ai/text` routes exclusively through the existing
`aiRouter.generateText()` → `ProviderRouter` → `GeminiProvider` → `ProviderManager`
chain — no direct provider client construction in the route handler, no new provider, no
credential ever exposed to the caller. VyaparSethu (or this sprint's stand-in test
client) never touches Gemini directly.

## 12. Gemini Configuration Status (Phase 10)

**NOT CONFIGURED — deliberately, unchanged this sprint.** No `GEMINI_API_KEY` was set,
requested, or invented. §7's local positive test proves the S2S auth mechanism and the
AI-routing path both work independently of whether a *valid* Gemini key exists — the
downstream provider rejection in that test came from a pre-existing, stale local `.env`
value (present before this session, not created by it), not from anything this sprint
touched.

## 13. Security Assessment

- **S2S authentication mechanism:** sound. Constant-time comparison, fail-closed on
  every branch, no credential leak in any response or log observed this turn, correct
  audit trail, correct request-ID propagation, correct rejection of client-supplied
  identity-override fields.
- **New finding, not previously documented:** `/api/v1/ai/text` has **no rate limiter**
  applied (unlike `/api/vault/ai-summary`/`mentor-advice`, which both carry `aiRateLimit`
  behind `requireAuth`). An attacker with no credential cannot get past
  `requireServiceAuth` regardless, so this is not an authentication bypass — but it does
  mean there is no defense-in-depth cap on the *rate* of credential-guessing attempts
  once a real (long, random, founder-generated) token exists, nor any cap on legitimate-
  but-runaway traffic once VyaparSethu is a real caller. Given `timingSafeEqual` already
  removes the timing side-channel and a properly-generated secret makes brute-forcing
  computationally infeasible regardless, this is a **P1 defense-in-depth recommendation,
  not a P0 exploitable defect** — noted, not fixed this sprint, consistent with "do not
  modify unrelated routes."
- **Credential storage:** correctly blocked, correctly reported, not worked around.

## 14. Remaining Work

1. **Configure `BELL24H_VYAPARSETHU_SERVICE_TOKEN` on Vercel** — requires either a tool
   this session does not have, or the founder/operator doing it directly. Only then can
   §7's live-production positive test be repeated for full end-to-end proof.
2. **Configure `GEMINI_API_KEY`** — separately deferred per this sprint's own preference,
   and blocked by the same tooling gap regardless.
3. **P1, not blocking:** add a rate limiter to `/api/v1/ai/text`, mirroring the existing
   `aiRateLimit` pattern, once real traffic from VyaparSethu is expected.
4. **Founder decision carried over from OS-INTEGRATION-IMPLEMENTATION-02:** whether to
   close the Production-domain SSO protection gap before or independent of configuring
   real credentials — unresolved, not this sprint's to decide.

---

## Production Credential Verification — 03B

**Date:** 2026-08-12
**Context:** the founder manually configured `BELL24H_VYAPARSETHU_SERVICE_TOKEN` in
Vercel (Production scope, per the founder's own statement) and redeployed. This section
verifies the result. The actual secret value was never requested, printed, echoed, or
discovered — every check below is a black-box HTTP/behavioral test.

### Phase 1 — Git Truth

`HEAD` = `f0e2520`, `origin/main` = `f0e2520`, working tree clean. **VERIFIED, matched.**

### Phase 2 — Deployment Truth

`list_deployments` for `digitex-erp-bell24h-os` still shows exactly the same **7**
deployment records as every prior sprint this session — no new deployment appeared.
`latestDeployment` is unchanged: `dpl_k9wxJRarfhr7gNsFoNYSda2T2ntk`, `target: null`,
`readyState: READY`. **INFERRED, not VERIFIED:** if the founder's "redeploy" happened
through the Vercel dashboard as an environment-variable-only refresh of this same
deployment (rather than a full rebuild), it would not necessarily create a new listed
deployment record — Phase 3's live behavioral test below is the authoritative signal,
not this deployment list. **Commit SHA:** still **UNKNOWN / not applicable** — this
project has no GitHub integration (re-confirmed, unchanged since the Deployment Truth
Reconciliation sprint); no deployment record here has ever carried a git commit SHA, this
one included. **Domain:** `digitex-erp-bell24h-os.vercel.app`, unchanged, confirmed live
this turn (see Phase 3).

### Phase 3 — Credential-Presence Diagnostic

**TOKEN CONFIGURED = YES. VERIFIED, live, this turn.**

The task's own suggested test (`Authorization: Bearer <random>`) does not match
`requireServiceAuth.ts`'s actual contract — that header is never read by the middleware
at all, so it only ever proves "no credential was sent," not "an invalid one was
rejected." Using the **correct** header
(`X-Bell24h-Service-Token`, the real, unchanged contract since
OS-INTEGRATION-IMPLEMENTATION-01) with a freshly-generated random value:

```
X-Bell24h-Service-Token: <random, never real>
→ 401 {"error_code":"AUTHENTICATION_FAILED","message":"Service credential rejected.",...}
```

This is the decisive signal: `"Service credential rejected"` only occurs when a real
value **is** configured server-side and the comparison genuinely fails — as opposed to
`503 PROVIDER_UNAVAILABLE` / `"...missing BELL24H_VYAPARSETHU_SERVICE_TOKEN"`, which is
what every identical test returned in Sprints 03 and 04. **This is a real, verified
change in production state since the last sprint** — not assumed, not carried over.

### Phase 4 — Negative Auth Matrix

All four tested live, this turn, against `digitex-erp-bell24h-os.vercel.app`:

| Test | Result |
|---|---|
| No header at all | `401 AUTHENTICATION_FAILED` — "Missing x-bell24h-service-token header." |
| Empty header value | `401 AUTHENTICATION_FAILED` — same message (empty is treated as absent) |
| Whitespace-only header value | `401 AUTHENTICATION_FAILED` — same message |
| Random invalid credential | `401 AUTHENTICATION_FAILED` — "Service credential rejected." (the Phase 3 signal) |

**VERIFIED — all four rejected, exactly as required.** (One transient `curl`-level
connection failure, `HTTP:000`, occurred on the first attempt at two of these tests —
retried immediately and got a clean result both times; noted here rather than silently
discarded, since it's evidence of a momentary network hiccup, not application behavior.)

### Phase 5 — Trusted Caller Test

**NOT TESTED — by design, not a failure.** This phase explicitly requires "the real
credential from the secure environment," which this session does not have and, per this
sprint's own absolute rule, must never request, print, or attempt to discover. The
mechanism itself (`caller_system` fixed to `"vyaparsethu"`, client-supplied
`caller_system`/`organization_id`/`tenant_id` fields ignored) was already fully verified
with a real, ephemeral, locally-generated test credential in
OS-INTEGRATION-IMPLEMENTATION-03 (§5 above) — that evidence stands; it is not re-derived
here because doing so would require the actual production secret.

### Phase 6 — `/api/v1/ai/text` Provider Boundary

**NOT DIRECTLY TESTABLE this turn, same root cause as Phase 5.** Reasoned from code
(unchanged, `git diff --stat` this turn shows zero source changes) and from Sprint 03's
local evidence: once a request passes `requireServiceAuth`, it reaches
`aiRouter.generateText()` → `ProviderManager.getCredential("gemini")`. Since
`GEMINI_API_KEY` remains unconfigured (Phase 9), that call would throw
`ProviderCredentialError` (`code: "provider_credentials_unavailable"`), which the route
maps to `503 PROVIDER_UNAVAILABLE` — **INFERRED**, consistent with the code path and
with Sprint 03's local test, not independently re-observed live this turn because doing
so requires the real credential this sprint correctly withholds from this session.

### Phase 7 — Secret Exposure

**VERIFIED clean, this turn.** Every response body captured in Phases 3–4 above was
inspected directly — none contains anything resembling a token value (all contain only
the canonical error envelope: `error_code`, `message`, `request_id`, `correlation_id`,
`retryable`). No source file, log, or document produced this turn contains the actual
secret value — every reference to it in this section is the variable **name** only.

### Phase 8 — Environment Scope

**UNKNOWN — cannot be verified from this session.** No tool available this session lists
or reads Vercel environment-variable scope assignments (confirmed by the same tool
search performed in Sprint 03 — still no such tool exists in this toolset). An attempt
to read a Preview-scoped deployment for comparison
(`digitex-erp-bell24h-dlwc739j2-bell24xs-projects.vercel.app`, via
`web_fetch_vercel_url`, read-only, no protection setting touched) was blocked by
Vercel's own SSO protection (`302` redirect to `vercel.com/sso-api`) — consistent with
every prior sprint's finding that deployment-specific/preview URLs remain correctly
protected. **The founder's own stated intent (Production-only) is recorded as reported,
not independently verified** — this is not the same as confirming
`ENVIRONMENT SCOPE = INCORRECT`, which would require positive evidence of the token also
working on a Preview deployment, which this session cannot obtain.

### Phase 9 — Gemini

`GEMINI_API_KEY` = **NOT CONFIGURED BY THIS SPRINT.** Not touched, not requested, not
inspected.

### Summary

The founder's configuration action is real and took effect: `BELL24H_VYAPARSETHU_SERVICE_TOKEN`
is now present on the production deployment, confirmed by a genuine behavioral change
(`503` → `401` on the identical invalid-credential test) between Sprint 04 and this
verification. The mechanism correctly rejects every invalid input tested. Full
trusted-caller and provider-boundary re-verification with the *real* credential is not
possible from this session by design, and was not attempted.
