# Outstanding Investigation Register

**Part of PS-01.** Every investigation opened but never conclusively closed. Status
values: OPEN / PARTIALLY RESOLVED / RESOLVED / SUPERSEDED. No item below is marked
RESOLVED without a runtime artifact.

---

### Review Gate C (C.2B, C.2C)

**Updated 2026-08-03 after the RG-C remediation sprint.** Full evidence in
[`GATE_C_REMEDIATION_REPORT.md`](./GATE_C_REMEDIATION_REPORT.md).

| Field | Detail |
|---|---|
| Current status | **STILL OPEN overall** — 2 items CLOSED, 1 BLOCKED, 3 OPEN |
| Evidence | **Unauthenticated routes: CLOSED.** RG-C applied the existing `requireAuth` middleware to all 8 open registrations in `server.ts`. Before/after runtime pairs captured on **both** a dev server and a `NODE_ENV=production` build: all 8 moved from `500` (handler executing unauthenticated, failing on missing `DATABASE_URL`) to `401 {"error":"unauthenticated"}` (rejected before handler execution). Regression-checked: `/api/health` 200, `devOnly` routes still 404 in prod, pre-existing AI gates still 401, SPA still served; `tsc --noEmit` and `npm run build` both pass. **C.2B code layer: CLOSED** — no change was required; commit `343945c` had already narrowed both `ai_providers` projections, re-verified against the freshly built bundle (no `select('*')` on a credential table; the only bundled JWT decodes to `role: anon`). |
| Remaining unknowns | **C.2B database layer** — the `ai_providers.api_key` column still exists and is still tenant-readable at the grant level; no column `REVOKE` applied and no key rotation evidenced. Requires live DB credentials. **Tenancy** — `requireAuth` establishes identity, not tenancy: the vault tables have no `organization_id` and the handlers bypass RLS via the pooled `DATABASE_URL`, so any authenticated user of any org can still read every row (inferred from quoted SQL, not runtime-verified — no `DATABASE_URL` was configured). **Client impact** — no client file attaches an `Authorization` header, so the Knowledge Vault UI will now 401; this condition already existed for the AI Mentor since commit `aea842e`. |
| Owner | Project owner (DB `REVOKE` + key rotation; ratifying a C.2C definition) / Architecture Council (Vault tenancy decision) |
| Blocking? | Still blocks all `IS-xx` implementation sprints and PS-02 Architecture Freeze. Gate C is **not** fully passed. |
| Next action | (1) Apply the `ai_providers.api_key` column `REVOKE` and rotate every key it held. (2) Ratify a C.2C definition and commit it as an actual Gate C record (see below). (3) Council decides Vault tenancy from the options memo. (4) Attach the Supabase session token in client fetch calls to restore the Vault UI. |

---

### C.2C closure — BLOCKED (no authoritative gate record)

**Added 2026-08-03 during RG-C.**

| Field | Detail |
|---|---|
| Current status | **BLOCKED — no work attempted** |
| Evidence | RG-C scoped C.2C as *"as defined in the repository's Gate C record"* and directed a stop rather than an invented definition if that record is missing. **There is no Gate C record in this repository.** The only text anywhere defining C.2B/C.2C is `MASTER_CONTEXT/KERNEL_ARCHITECTURE.md §20`, which is: untracked (`git status` → `?? MASTER_CONTEXT/KERNEL_ARCHITECTURE.md`, never committed); self-labeled **`DESIGN — NOT FROZEN`** in its own header; and Source B (a prior session's design document), not a ratified gate record. An untracked, unratified design document has no authority to define a gate-closure item. Its §20 text also bundles C.2C with work RG-C explicitly excludes ("migrate 9 pool handlers off RLS bypass" is architecture work) — a further reason not to infer scope from it. |
| Remaining unknowns | What C.2C actually requires for closure. Cannot be determined from any authoritative source currently in the repository. |
| Owner | Project owner / Architecture Council |
| Blocking? | Blocks Review Gate C passing in full, and therefore blocks all `IS-xx` sprints |
| Next action | Ratify a C.2C definition and **commit it to the repository** as an actual Gate C record stating precisely which conditions constitute closure, then re-authorize the work explicitly. Do not proceed on the strength of the untracked design document. |

---

### Provider secret exposure (`ai_providers.api_key`)

| Field | Detail |
|---|---|
| Current status | **PARTIALLY RESOLVED** |
| Evidence | Commit `343945c` (unpushed) narrows `AiProviderService.getProviders()`'s `select()` to explicitly exclude `api_key`. Verified this session: production bundle grep finds every `api_key` occurrence is either an `if (!config.api_key) throw` guard or a UI placeholder string (`"sk-..."` in a form field) — no live secret value is present in the shipped bundle. `server/ai/ProviderManager.ts` correctly resolves credentials from `process.env` only. |
| Remaining unknowns | The `ai_providers.api_key` column itself still exists in the schema, unRESTRICTed at the column-grant level (query-layer fix only, not a schema/RLS-layer fix). No evidence any previously-exposed key has been rotated. |
| Owner | Project owner (DB-level `REVOKE` + key rotation requires production DB access this session does not have) |
| Blocking? | Blocks full closure of Gate C.2B |
| Next action | Apply the column-level `REVOKE` `KERNEL_ARCHITECTURE.md` recommends, then rotate every provider key that table ever held |

---

### Authentication investigation (does login actually work?)

| Field | Detail |
|---|---|
| Current status | **OPEN — deliberately not tested by this session, per instruction** |
| Evidence | This session independently verified the **rejection** path: `requireAuth` correctly returns `401 {"error":"unauthenticated"}` for an anonymous request, in both dev and production builds. This proves the middleware mechanism works for callers with no token. It says **nothing** about whether a real user credential can complete a login — that is a categorically different claim. The untracked `KERNEL_ARCHITECTURE.md` states "zero successful logins observed," while the tracked `MASTER_CONTEXT/CHANGELOG.md` (2026-07-03) claims a "Production Authentication Recovery" occurred — these two sources directly disagree and neither is re-verifiable from this session's tools. |
| Remaining unknowns | Whether any real Supabase user has ever completed `signInWithPassword`/OTP and reached an authenticated session in this application, in any environment. The SQL-level facts cited in the PS-01 brief (`has_password: true`, `banned_until: NULL`, prior successful login) were not independently re-queried this session — no DB credential was available, and doing so was out of scope regardless. |
| Owner | Project owner — requires one live login attempt, which this session must not and did not perform |
| Blocking? | Blocks certifying Authentication as VERIFIED IMPLEMENTED rather than PLATFORM FOUNDATION |
| Next action | Project owner performs a single live login attempt against the current build and reports the observed result (success, or the exact error code/message) |

---

### Password reset / `otp_expired`

**Updated 2026-08-03 during RG-C** (amended in place rather than duplicated, per the
"update the existing register, do not create a parallel one" rule). The previously
unverifiable question — *does the Supabase URL config point at an origin actually
serving the app?* — has now been answered by direct read-only dashboard inspection.

| Field | Detail |
|---|---|
| Current status | **OPEN — strong hypothesis, not yet verified** |
| Evidence | **Supabase dashboard inspected read-only, 2026-08-03** (browser session — labelled as such; distinct from repository evidence). Authentication → URL Configuration for project `dqpaekyayhqhndihbnnn` read verbatim: **Site URL** = `https://ais-dev-zxdg67fyg7gy22jrjbkrvr-299471748829.asia-east1.run.app`; **Redirect URLs** = exactly one entry, `https://ais-dev-zxdg67fyg7gy22jrjbkrvr-299471748829.asia-east1.run.app/auth/update-password` (page reported `Total URLs: 1`). Both are **ephemeral AI Studio / Google Cloud Run preview origins**. `https://digitex-erp-bell24h-os.vercel.app` appears in **neither**. Also read: `MAILER_OTP_EXP` = **3600** (1 hour), `MAILER_OTP_LENGTH` = 8, **Confirm email = DISABLED**, Email provider enabled, signups enabled. Repository-side: `/auth/update-password` route exists in `AuthPage.tsx`. |
| Hypothesis | Token *lifetime* is not the cause — 3600s is generous. The likely cause is that recovery links land on an **ephemeral origin that is no longer serving**, which presents to the user as a broken/expired reset regardless of the token's real validity. |
| Remaining unknowns | Is that Cloud Run origin currently serving requests? (Deliberately not fetched — requesting an `/auth/update-password` URL risks consuming a single-use token.) Can a reset complete against a live origin? Whether the Site URL / Redirect URLs have been changed since the 2026-08-03 inspection — a re-check later the same session failed with a browser-extension permission error, so **current config state is UNKNOWN**. |
| Owner | Project owner (you) |
| Blocking? | **No** — out of RG-C scope, and resolved by fixing the Supabase redirect URL then running one clean reset test |
| Next action | Point Site URL and Redirect URLs at an origin that is actually serving the app (Vercel, or `http://localhost:<port>` for local testing), remove the ephemeral Cloud Run entries, save. Then run **one** password reset test in an Incognito window with no extensions (to avoid link-prefetch/scanner consuming the single-use token). That will confirm or refute the hypothesis. |

---

### `AUTH_BYPASS` behavior

| Field | Detail |
|---|---|
| Current status | **RESOLVED** |
| Evidence | Commit `d2ca7cd` (unpushed) requires both `import.meta.env.DEV` (statically false in `vite build` output) **and** an explicit `VITE_AUTH_BYPASS=true` opt-in. Verified this session: production bundle grep for `dev-user-id`, `developer@bell24h.os`, `Developer Admin`, `Logout disabled`, `AUTH_BYPASS` — all return **0** matches. |
| Remaining unknowns | None for the production path. Not verified: whether `VITE_AUTH_BYPASS=true` set in a *non-production* preview environment (e.g., AI Studio preview) behaves as intended — plausible from code reading but not exercised live this session. |
| Owner | N/A — closed |
| Blocking? | Nothing currently |
| Next action | None required; re-verify if `useAuthStore.ts`, `useAuth.ts`, or `App.tsx` are touched again, per the skill's own standing instruction |

---

### Seven unpushed commits

| Field | Detail |
|---|---|
| Current status | **RESOLVED (classification complete; commits correctly held, not pushed)** |
| Evidence | Full per-commit classification in `PROJECT_CONTINUITY_REPORT.md` Step 1. All seven belong on `main` eventually; four (`aea842e`, `cfa6cea`, `343945c`, `d2ca7cd`) are independently runtime-verified this session, not just code-reviewed. |
| Remaining unknowns | None about their content. The only open question is timing — whether to push now (with an explicit note that Gate C remains open) or hold until Gate C fully closes. That is a project-owner judgment call, not a technical unknown. |
| Owner | Project owner (push decision only — this session did not push, per instruction) |
| Blocking? | Nothing technical; a process/communication decision only |
| Next action | Project owner decides push timing once Gate C.2C's remaining 8 routes are addressed |

---

### Vercel deployment

| Field | Detail |
|---|---|
| Current status | **RESOLVED (deployment state); UNKNOWN (environment variable count)** |
| Evidence | Live Vercel API call this session (`get_project` + `list_deployments` for `prj_8oLwDwlcBgJAuf4FFFsSWwBcFBGp`, confirmed via `.vercel/project.json` to be this repository's project): `"live": false`, `"latestDeployment": null`, `"domains": []`, `list_deployments` → `{"deployments": [], "count": 0}`. **Zero deployments is independently VERIFIED, not inherited.** |
| Remaining unknowns | The environment-variable count. No Vercel MCP tool available this session returns project environment variables — the "zero environment variables" claim in the PS-01 brief was **not independently re-verified** and should be labeled UNKNOWN rather than confirmed, distinct from the deployments finding above. |
| Owner | Project owner, or a future session with a Vercel env-var-listing tool/dashboard access |
| Blocking? | Blocks certifying "deployment readiness" as a closed question in full — though it is moot until Gate C closes regardless, since deployment is explicitly deferred until then |
| Next action | If/when deployment is being planned, check the Vercel dashboard's Environment Variables tab directly rather than assuming the figure from this or prior reports |

---

### Supabase deployment / configuration

| Field | Detail |
|---|---|
| Current status | **PARTIALLY RESOLVED** |
| Evidence | A local, gitignored `.env` exists in the working tree containing only `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` (confirmed by listing variable names only, not values, to avoid handling secrets unnecessarily). Building with this `.env` present bakes project ref `dqpaekyayhqhndihbnnn` and an anon-role JWT into the bundle — confirmed by direct bundle grep this session. This is a **local testing credential**, not a committed or Vercel-side configuration — `git status` confirms `.env` is untracked and gitignored. |
| Remaining unknowns | RLS policy state was inspected from the schema *file*, not from the live database (no DB credential was available to query `pg_policies` directly) — see `IMPLEMENTATION_STATUS.md` for the file-level findings, which should be re-verified against the live database before being treated as the database's actual current state. Site URL / Redirect URL configuration (see password-reset investigation above) also unverified live. |
| Owner | Project owner (live DB / dashboard access required) |
| Blocking? | Blocks fully certifying RLS as enforced in production versus merely declared in a schema file |
| Next action | Re-derive RLS policy state from the live Supabase project (`dqpaekyayhqhndihbnnn`) directly, e.g. via `pg_policies`, rather than trusting the schema file alone |

---

### Runtime verification / production UAT

| Field | Detail |
|---|---|
| Current status | **PARTIALLY RESOLVED this session, still far from complete** |
| Evidence | This session performed real runtime verification that prior sessions apparently had not: live curl against dev and production-mode servers for 8+ routes, a production bundle audit, and a live Vercel API call. This is more runtime evidence than any prior report in this repository cites. |
| Remaining unknowns | No UI-level (browser) interaction was performed this session — all verification was HTTP/bundle-level. Whether the SPA's client-side routing, `ProtectedRoute` redirect behavior, and the diagnostics dashboard render correctly in a real browser was not checked. |
| Owner | This could be closed by a future session with browser automation tooling loaded, or by the project owner manually |
| Blocking? | Blocks full production-UAT sign-off |
| Next action | A follow-up session should drive the built app in an actual browser (dev and prod builds) to confirm `/dashboard` redirects to `/auth` when logged out in production, and that `/auth/login` reaches `/dashboard` in dev — the code-level logic for this was read but not exercised through a real page load this session |
