# OS-LIVE-03 — Vercel Ownership / Production Deployment Reconciliation

**Date:** 2026-08-18
**Scope:** Read-only reconnaissance, re-verified fresh this sprint (not reused from
memory). No application source, `vercel.json`, environment variable, domain, or Git
integration was modified. Gate A and Gate B-02 were not reopened or re-proven. This
report follows OS-LIVE-01 and OS-LIVE-02 in the same investigation chain.

Legend used throughout: **VERIFIED** (directly observed this sprint) / **INFERRED**
(reasoned from verified evidence, not itself directly observed) / **UNKNOWN** (no
evidence either way) / **ACCESS DENIED** (a specific tool call refused access).

---

## 1. Git Truth — VERIFIED

```
Workspace   = C:\Users\Sanika\digitex-erp-bell24h-os
LOCAL HEAD  = c27f8e5cdd524ce1af510184164abd90e63e136d
ORIGIN/MAIN = c27f8e5cdd524ce1af510184164abd90e63e136d
```
`git status --short --branch`: `## main...origin/main`, plus two pre-existing
untracked files (`OS-LIVE-01...md`, `OS-LIVE-02...md`) from prior sprints — no tracked
file modified, nothing deleted or committed on their behalf.
`git remote -v`: `origin → https://github.com/digitex-erp/digitex-erp-bell24h-os.git`
(fetch+push).

**GIT: IN SYNC.**

---

## 2. Repository Truth — VERIFIED

Actual workspace confirmed at `C:\Users\Sanika\digitex-erp-bell24h-os` (re-verified by
direct path check this sprint, not assumed).

`vercel.json` (unchanged):
```json
{
  "version": 2,
  "framework": null,
  "outputDirectory": "dist",
  "buildCommand": "mkdir -p dist && echo '<!doctype html><title>Bell24h-OS staging</title><p>API-only staging build for OS-INTEGRATION-IMPLEMENTATION-01. See /api/v1/health.</p>' > dist/index.html",
  "rewrites": [{ "source": "/api/(.*)", "destination": "/api/index" }]
}
```
`package.json` build script (currently overridden by the above on Vercel):
`vite build && esbuild server.ts --bundle --platform=node --format=cjs
--packages=external --sourcemap --outfile=dist/server.cjs`. Output directory for both
the real build and the placeholder is the same `dist/` — only the *command* is
overridden, not the path Vercel looks in.

1. **Framework/build system:** Vite 6 + React + TypeScript + Tailwind.
2. **Build command:** identified, unchanged (above).
3. **Output directory:** `dist` — identified, matches `vercel.json`.
4. **Does `vercel.json` intentionally produce API-only output?** Yes — labeled inline
   as scoped to `OS-INTEGRATION-IMPLEMENTATION-01`.
5. **Is the frontend actually buildable?** **VERIFIED, not theoretical.** Ran the real
   `npm run build` this sprint (safe/read-only: `dist/` is `.gitignore`d, confirmed
   before running; nothing was deployed or committed):
   ```
   vite v6.4.3 building for production...
   ✓ 1871 modules transformed.
   dist/index.html                  0.42 kB
   dist/assets/index-CMCCQu7y.css   59.39 kB
   dist/assets/index-Br7xyHCP.js    854.26 kB
   ✓ built in 35.27s
   dist/server.cjs  26.6kb
   ```
   `dist/index.html` produced by this real build correctly references the compiled
   app bundle (`<script src="/assets/index-....js">`) — this is the actual
   application, not the placeholder string. `npm run lint` (`tsc --noEmit`) also
   passed cleanly, no output.
6. **What configuration would be required to expose it?** Only the `buildCommand` in
   `vercel.json` needs to become the real `npm run build` (or be removed so Vercel's
   own framework detection runs it) — `outputDirectory` and the `/api/*` rewrite are
   already correct and need no change.

---

## 3. Live-Domain Truth — VERIFIED

`GET https://digitex-erp-bell24h-os.vercel.app/`:
```
HTTP/1.1 200 OK
Server: Vercel
X-Vercel-Cache: HIT
X-Vercel-Id: bom1::kmrhf-1787009586003-ed9f7479a95d
Age: 597
Last-Modified: Mon, 17 Aug 2026 23:23:08 GMT
Content-Type: text/html; charset=utf-8

<!doctype html><title>Bell24h-OS staging</title><p>API-only staging build for OS-INTEGRATION-IMPLEMENTATION-01. See /api/v1/health.</p>
```
No redirect (200 direct, no `Location` header). Cached at the edge (`X-Vercel-Cache:
HIT`), region `bom1`.

`GET https://digitex-erp-bell24h-os.vercel.app/api/v1/health`:
```
HTTP/1.1 200 OK
Server: Vercel
X-Powered-By: Express
X-Vercel-Cache: MISS
Content-Type: application/json; charset=utf-8

{"status":"ok","apiVersion":"v1","requestId":"req_msxvdb7h_96oyityi"}
```
Both endpoints are live and behave exactly as this repository's code would produce.
**Ownership is not inferred from this alone** — see §4 for the direct access test.

---

## 4. Vercel Domain Ownership — ACCESS DENIED

```
$ vercel domains inspect digitex-erp-bell24h-os.vercel.app --scope bell24xs-projects
Error: You don't have access to the domain digitex-erp-bell24h-os.vercel.app
under bell24xs-projects.

$ vercel inspect https://digitex-erp-bell24h-os.vercel.app --scope bell24xs-projects
Error: Can't find the deployment "digitex-erp-bell24h-os.vercel.app"
under the context "bell24xs-projects".
```

| Field | Result |
|---|---|
| ACCESSIBLE | **NO** |
| OWNING PROJECT | **UNKNOWN** |
| OWNING TEAM | **UNKNOWN** |
| DOMAIN OWNERSHIP | **ACCESS DENIED** |

No bypass was attempted, per instruction. `vercel domains ls --scope
bell24xs-projects` (re-run this sprint) lists exactly one domain owned by this
account/team: `vyaparsethu.com`. `digitex-erp-bell24h-os.vercel.app` is not in it.

---

## 5. Accessible Vercel Project — VERIFIED

| Field | Value |
|---|---|
| Project | `digitex-erp-bell24h-os` |
| Project ID | `prj_8oLwDwlcBgJAuf4FFFsSWwBcFBGp` |
| Team | `bell24xs-projects` (`team_4QgVezq9OAa7UqzMkRMteKZX`) |
| Framework (Vercel's own metadata) | `vite` |
| Git integration | **None.** No connected repository. Deployments on this project have never carried a git commit SHA (re-confirmed against this session's earlier `OS-INTEGRATION-IMPLEMENTATION-03-S2S-AUTH-REPORT.md` finding). |
| Production branch | N/A — no Git integration to define one. |
| Latest deployment | `dpl_k9wxJRarfhr7gNsFoNYSda2T2ntk`, `readyState: READY`, `target: null` |
| Domains | `digitex-erp-bell24h-os-bell24xs-projects.vercel.app`, `digitex-erp-bell24h-os-bell24hhelpline-8523-bell24xs-projects.vercel.app` — **not** the bare vanity domain |
| Environment variables — Production | **None** (`vercel env ls production` → "No Environment Variables found") |
| Environment variables — Preview | **None** |
| Environment variables — Development | **None** |
| Build/output settings | `outputDirectory: dist` (from `vercel.json`, read via this repo — Vercel project-level override settings were not separately queryable from this session beyond what `get_project` exposes above) |

No variable name, scope, or value beyond "zero variables exist" was retrieved for
this project — there was nothing further to enumerate.

---

## 6. GitHub ↔ Vercel Reconciliation

**GitHub integration on the accessible project: NOT CONNECTED** (§5).

Checked whether any other visible deployment/project in this account appears to
originate from `digitex-erp/digitex-erp-bell24h-os`: only two projects exist under
`bell24xs-projects` (`bell24h` and `digitex-erp-bell24h-os`); the `bell24h` project is
VyaparSethu's own project, connected to a *different* repository
(`bell24xcom/forBell24x`, confirmed in an earlier sprint) — not this one. So within
this account, no project is Git-connected to `digitex-erp/digitex-erp-bell24h-os` at
all.

Per instruction — **not** claiming Git linkage from content match alone — the
classification is based on what was actually tested:
- A (directly verified linkage): not available — no accessible project has this
  repository connected.
- B (strong same-source evidence) alone would understate what's known: we also
  directly confirmed (§4) that a live, working deployment exists at the domain and is
  outside this account's reach — that's more specific than "some project, somewhere,
  probably shares source."

**Classification: C — Live project exists but is inaccessible.** Supporting evidence
(not a substitute for direct verification, offered only as corroboration): the live
placeholder HTML (§3) is byte-for-byte identical to this repository's current
`vercel.json` string literal, and `/api/v1/health`'s response shape matches this exact
`server.ts` — consistent with, but not proof of, the live project deploying from this
same GitHub repository under a different account.

---

## 7. Production Deployment Identity

```
LIVE PRODUCTION DEPLOYMENT: UNKNOWN   (exists and responds, per §3; its Vercel
                                        deployment ID/record is not accessible, per §4)
DEPLOYMENT URL:             https://digitex-erp-bell24h-os.vercel.app  (public, non-secret)
DEPLOYMENT COMMIT:          UNKNOWN   (not directly verifiable — no commit SHA is
                                        exposed by the live HTTP responses, and the
                                        owning Vercel project cannot be queried)
PRODUCTION BRANCH:          UNKNOWN   (not directly verifiable, for the same reason)
GITHUB → VERCEL AUTO DEPLOY: UNKNOWN  (cannot be determined without access to the
                                        owning project's Git integration settings)
```
No commit was inferred from unrelated deployment metadata, per instruction — the
accessible project's own `dpl_k9wxJRarfhr7gNsFoNYSda2T2ntk` deployment record belongs
to a project confirmed (§5) to have no Git integration, so it cannot be used to infer
a commit SHA for the live domain either.

---

## 8. Frontend Readiness — READY

```
frontend source exists:        YES
Vite/build configuration:      YES
frontend build succeeds:       YES — VERIFIED this sprint (§2.5, real npm run build,
                                 1871 modules, clean output, no errors)
typecheck (tsc --noEmit):      YES — VERIFIED this sprint, clean, no errors
output directory:               dist/ (matches vercel.json's outputDirectory exactly)
vercel.json compatibility:      YES — no path conflict, only the buildCommand string
                                 needs to change
current deployment is API-only: YES (confirmed live, §3)
deployable without architecture change: YES — same conclusion as OS-LIVE-01/02,
                                 now backed by an actual successful local build
                                 rather than static inspection alone
```
The local build was run only as read-only verification; nothing was deployed, and the
resulting `dist/` output is untracked/`.gitignore`d and irrelevant to any actual Vercel
deployment (Vercel performs its own build in its own environment regardless of local
artifacts).

**FRONTEND: READY.**

---

## 9. Production Configuration Gap

Exact blocker, in priority order:

**A — Vercel ownership/access.** This is the actual, sole hard blocker. Every other
category below is either already fine or cannot be assessed until A is resolved:
- **B — Git integration:** status on the *real* live project is unknown (§6/§7); on
  the only project this session can reach, it's absent, but that project isn't the
  live one, so this isn't the live project's blocker — it's evidence of a different
  project entirely.
- **C — Production branch configuration:** unknown for the same reason (§7).
- **D — Build command:** identified and would need correction, but only meaningfully
  actionable once A is resolved (§2.6, §8).
- **E — Output directory:** already correct, not a blocker.
- **F — Domain assignment:** the domain is already assigned — just not to a project
  this session can reach (§4).
- **G — Environment configuration:** unknown for the real live project; confirmed
  empty (irrelevantly) on the accessible one (§5).
- **H — Vercel project mismatch:** this **is** the concrete manifestation of A — the
  project this session was granted is provably not the project serving production.
- **I — Other:** none identified.

No implementation is prescribed here, per instruction — this section identifies the
blocker only.

---

## 10. Environment-Variable Scope Observations

Only the accessible project (`digitex-erp-bell24h-os`, `bell24xs-projects`) could be
enumerated. Result: **zero variables in Production, Preview, and Development.** No
name, scope, or value was retrieved for the real live project — it remains
inaccessible (§4/§5). This absence is evidence of the account/project mismatch (§9),
not evidence that real production is unconfigured — the live domain's own auth
behavior (proven in the separately-authorized OS-INTEGRATION-GATE-B-02 sprints, not
re-tested here) already shows a real secret is configured somewhere.

---

## 11. Frozen Architecture Confirmation

Nothing in this sprint touched: `requireServiceAuth`, `/api/v1/ai/text`
authentication, the NVIDIA adapter, `ProviderRouter`/AI Provider Manager routing, the
VyaparSethu integration, Gate A, Gate B-02, any provider credential, Gemini
configuration, application source, `vercel.json`, domains, or environment variables.
The only local filesystem change was a `.gitignore`d `dist/` build output (§8),
produced solely to verify the frontend builds — not part of any tracked change.

**GATE A: UNCHANGED. GATE B-02: UNCHANGED. SOURCE CODE: UNCHANGED. VERCEL CONFIG:
UNCHANGED.**

---

## 12. No Secret Exposure — VERIFIED

- `vercel env pull` was never run. No `.env` file was created. No environment
  variable value was echoed, printed, or exported at any point.
- `BELL24H_VYAPARSETHU_SERVICE_TOKEN` and `NVIDIA_API_KEY` values were never
  requested or retrieved this sprint.
- As additional (not requested, but directly relevant) verification: the freshly
  built client bundle (`dist/assets/index-*.js`, §8) was grep-scanned for the literal
  variable **names** `NVIDIA_API_KEY`, `BELL24H_VYAPARSETHU_SERVICE_TOKEN`,
  `GEMINI_API_KEY`, `SUPABASE_SERVICE_KEY`, `DATABASE_URL` — only `DATABASE_URL`
  appears, and only as a UI label string inside the existing `/system/diagnostics`
  page's own connectivity-check code (e.g. `"Check if DATABASE_URL is reachable from
  the server."`, `"DATABASE_URL missing"`) — not as an assigned value. No credential
  value is embedded in the client bundle.

---

## 13. Human Action Required

**YES.**

1. Open the Vercel account/team that actually owns
   `digitex-erp-bell24h-os.vercel.app` (confirmed **not** `bell24hhelpline-8523` /
   `bell24xs-projects` — that account's only domain is `vyaparsethu.com`).
2. Within that account, locate the project whose Domains tab lists
   `digitex-erp-bell24h-os.vercel.app`.
3. Confirm that project's Settings → Git shows `digitex-erp/digitex-erp-bell24h-os`
   connected (predicted by the content-fingerprint evidence in §6, not yet directly
   verified) and note its production branch.
4. Either grant `bell24hhelpline-8523` access to that team, or have someone with
   access directly report back: project ID, Git integration status + branch, and
   Production environment variable **names** (never values) for
   `BELL24H_VYAPARSETHU_SERVICE_TOKEN`, `NVIDIA_API_KEY`, and any
   `DATABASE_URL`/`SUPABASE_*` variables.

Only after that access/identification step can OS-LIVE-04 safely change a
`buildCommand` that will actually reach the real production domain.

---

## 14. Exact Next Gate

**OS-LIVE-04 — Controlled Frontend Activation** — blocked until §13 is resolved by a
human with the correct Vercel access. No further automated Vercel reconnaissance from
this session will change the outcome; the boundary is access, not information.

---

## OS-LIVE-03 — FINAL VERDICT

```
REPOSITORY:                      VERIFIED
LOCAL HEAD:                      c27f8e5cdd524ce1af510184164abd90e63e136d
ORIGIN MAIN:                     c27f8e5cdd524ce1af510184164abd90e63e136d
GIT:                             IN SYNC

LIVE DOMAIN:                     VERIFIED
LIVE /api/v1/health:             200

ACTUAL VERCEL OWNER:             ACCESS DENIED
ACTUAL VERCEL PROJECT:           UNKNOWN
ACTUAL PROJECT ID:               UNKNOWN
ACTUAL TEAM:                     UNKNOWN

ACCESSIBLE PROJECT:              digitex-erp-bell24h-os (prj_8oLwDwlcBgJAuf4FFFsSWwBcFBGp,
                                  team bell24xs-projects)
ACCESSIBLE PROJECT OWNS LIVE DOMAIN: NO

GITHUB ↔ LIVE DEPLOYMENT:        C

PRODUCTION DEPLOYMENT:           UNKNOWN
PRODUCTION COMMIT:               UNKNOWN
GITHUB AUTO DEPLOY:              UNKNOWN

FRONTEND:                        READY
CURRENT DEPLOYMENT:              API-ONLY
PRODUCTION CONFIG:               BLOCKED

SECRETS:                         NOT EXPOSED
SOURCE CODE:                     UNCHANGED
VERCEL CONFIG:                   UNCHANGED

GATE A:                          UNCHANGED
GATE B-02:                       UNCHANGED

HUMAN ACTION REQUIRED:           YES
EXACT HUMAN ACTION:              Locate/access the Vercel account that owns
                                  digitex-erp-bell24h-os.vercel.app and report back
                                  its project ID, Git integration status, and env-var
                                  NAMES per §13.

NEXT GATE:                       OS-LIVE-04 — CONTROLLED FRONTEND ACTIVATION
```

STOP.
