# OS-LIVE-02 — Vercel Deployment Reconciliation Report

**Date:** 2026-08-18
**Scope:** Read-only reconciliation only. No source, `vercel.json`, environment
variable, domain, or Git integration was modified. Nothing was deployed, committed, or
pushed. This report consolidates and, where possible, sharpens the findings from
OS-INTEGRATION-GATE-B-02 (prior sprints, same session) and OS-LIVE-01 — it does not
re-run Gate A or Gate B-02 proof, and does not reopen the Bell24h-OS ↔ VyaparSethu
architecture.

---

## 1. Git Truth

Actual local workspace: **`C:\Users\Sanika\digitex-erp-bell24h-os`** — the task's
"expected" path (`C:\Users\Sanika\Projects\digitex-erp-bell24h-os`) does not exist on
this machine; confirmed via direct path check.

```
HEAD        = c27f8e5cdd524ce1af510184164abd90e63e136d
origin/main = c27f8e5cdd524ce1af510184164abd90e63e136d
```
`HEAD == origin/main`. **Working tree is not fully clean**: one untracked file,
`docs/project/OS-LIVE-01-LIVE-PLATFORM-ACTIVATION-REPORT.md`, left over from the prior
(uncommitted, by design) OS-LIVE-01 sprint. No tracked file is modified. This report
adds one more untracked file to that same state — see §12 (Git Discipline).

---

## 2. Repository Deployment Configuration

`vercel.json` (unchanged, read-only inspection):
```json
{
  "version": 2,
  "framework": null,
  "outputDirectory": "dist",
  "buildCommand": "mkdir -p dist && echo '<!doctype html><title>Bell24h-OS staging</title><p>API-only staging build for OS-INTEGRATION-IMPLEMENTATION-01. See /api/v1/health.</p>' > dist/index.html",
  "rewrites": [{ "source": "/api/(.*)", "destination": "/api/index" }]
}
```

1. **What does it configure?** A custom `buildCommand` that writes a single
   placeholder `dist/index.html` instead of running any real build, plus a rewrite
   sending all `/api/*` traffic to the `api/index.ts` serverless function.
2. **Is the placeholder intentional?** Yes — labeled inline as scoped to
   `OS-INTEGRATION-IMPLEMENTATION-01`, the original API-only milestone. Not a bug or
   accident.
3. **Actual frontend build system in the repo:** Vite + React (`vite.config.ts`,
   `@vitejs/plugin-react`, `react-router-dom`), TypeScript, Tailwind.
4. **Actual frontend entry point:** `index.html` → `/src/main.tsx` → `src/App.tsx`
   (`BrowserRouter` with 21 routed pages behind a real Supabase-session
   `ProtectedRoute`).
5. **Expected build command** (from `package.json`, currently overridden by
   `vercel.json`): `vite build && esbuild server.ts --bundle --platform=node
   --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs`.
6. **Expected output directory:** `dist` (same directory `vercel.json` already points
   at — no path conflict, only a command conflict).
7. **Is the frontend production-capable?** Yes, on the evidence available without
   rewriting it: real routing, real auth gate, real Supabase-backed CRUD confirmed by
   direct code trace on two representative pages (Organizations, Teams — see
   OS-LIVE-01 §3). Whether every one of the 21 pages is production-quality was not
   re-verified page-by-page this sprint (out of scope here — this is a deployment
   reconciliation sprint, not a frontend audit).

---

## 3. Accessible Vercel Project Identity

| Field | Value |
|---|---|
| A. Authenticated account | `bell24hhelpline-8523` |
| A. Accessible team(s) | Exactly one — `bell24xs-projects` (`team_4QgVezq9OAa7UqzMkRMteKZX`) |
| B. Accessible project | `digitex-erp-bell24h-os` |
| C. Project ID | `prj_8oLwDwlcBgJAuf4FFFsSWwBcFBGp` |
| D. Connected Git repository | **None.** No GitHub integration on this project — confirmed both by direct inspection this sprint and by this session's prior sprint (`OS-INTEGRATION-IMPLEMENTATION-03-S2S-AUTH-REPORT.md`: *"this project has no GitHub integration... no deployment record here has ever carried a git commit SHA"*). |
| E. Production branch | N/A — no Git integration means no branch-triggered deploys exist for this project. |
| F. Production domains | `digitex-erp-bell24h-os-bell24xs-projects.vercel.app`, `digitex-erp-bell24h-os-bell24hhelpline-8523-bell24xs-projects.vercel.app` — confirmed via `get_project` and `vercel project ls` (which lists this project's "Latest Production URL" as the same `-bell24xs-projects.vercel.app` form). **The bare vanity domain `digitex-erp-bell24h-os.vercel.app` is absent from this list.** |
| G. Latest deployment | `dpl_k9wxJRarfhr7gNsFoNYSda2T2ntk`, `readyState: READY`, `target: null`, created `1786469237659`. |

---

## 4. Domain Ownership Reconciliation

**The accessible project does NOT own `digitex-erp-bell24h-os.vercel.app`.**

```
$ vercel domains inspect digitex-erp-bell24h-os.vercel.app --scope bell24xs-projects
Error: You don't have access to the domain digitex-erp-bell24h-os.vercel.app
under bell24xs-projects.

$ vercel inspect https://digitex-erp-bell24h-os.vercel.app --scope bell24xs-projects
Error: Can't find the deployment "digitex-erp-bell24h-os.vercel.app"
under the context "bell24xs-projects".

$ vercel domains ls --scope bell24xs-projects
  Domain             ...
  vyaparsethu.com    ...          ← the only domain this team/account owns
```

Per Phase 4's instruction, this is treated as **ACCESS/OWNERSHIP RECONCILIATION
REQUIRED** — not as a deployment-configuration problem to fix in this repository. No
domain create/attach was attempted.

---

## 5. Live Deployment Identity

1. **Current response:** `GET https://digitex-erp-bell24h-os.vercel.app/` → `200`,
   body: `<!doctype html><title>Bell24h-OS staging</title><p>API-only staging build for
   OS-INTEGRATION-IMPLEMENTATION-01. See /api/v1/health.</p>`
2. **`/api/v1/health`:** `{"status":"ok","apiVersion":"v1","requestId":"req_..."}`
3. **Deployment identity:** not discoverable by ID from this session — `vercel
   inspect` on the URL fails (§4). No `x-vercel-id` or similar header uniquely
   identifies the owning project/account from outside it.
4. **Does the accessible project correspond to this deployment?** **No — with an
   important nuance.** The placeholder HTML returned by the live URL is **byte-for-byte
   identical** to the string literal in *this repository's* `vercel.json` `buildCommand`
   (§2), and the `/api/v1/health` response shape matches this exact `server.ts`. That
   is strong content-fingerprint evidence that the live deployment is built from **the
   same GitHub repository** (`digitex-erp/digitex-erp-bell24h-os`) — just via a
   **different Vercel project/account** than the one this session can reach (which has
   no Git integration at all, per §3.D, and therefore cannot itself be that source).

**Explicit distinction honored, per instruction:** the API being publicly live does
**not** mean the accessible Vercel project is the one serving it. Ownership was not
inferred from reachability — it was tested directly (§4) and found absent.

---

## 6. GitHub ↔ Vercel Reconciliation

**Result: C — LIVE PROJECT EXISTS BUT IS NOT ACCESSIBLE.**

- The accessible project (`digitex-erp-bell24h-os` under `bell24xs-projects`) has
  **no** GitHub integration (§3.D) — it cannot be the project auto-deploying from
  `digitex-erp/digitex-erp-bell24h-os`.
- The live domain's content (§5.4) is a strong fingerprint match for this exact
  repository's current `vercel.json`/`server.ts`, indicating *some* Vercel project —
  under an account this session cannot reach — is deploying from this repository (or
  an identical copy of it).
- This session has no ability to query GitHub's own integration settings (no `gh api`
  access to repository webhooks/deployment integrations was attempted, as that falls
  outside "Vercel-side read-only metadata" and risks no clean answer anyway — GitHub's
  UI is the authoritative source for "which Vercel app is installed on this repo").
- Therefore: **not (A) verified same project** (the accessible project is confirmed
  different), **not (B) "accessible project is different" alone** (that undersells
  it — the live project isn't just different, it's unreachable), and **not (D) cannot
  verify** (we have positive content evidence, not just an absence of evidence). **C**
  is the precise, evidence-backed answer.

---

## 7. Environment Variable Presence — accessible project only

Project: `digitex-erp-bell24h-os` (`prj_8oLwDwlcBgJAuf4FFFsSWwBcFBGp`), scope
`bell24xs-projects`. Checked via `vercel env ls <environment>` (names/presence only —
no value ever retrieved, no `vercel env pull` used):

| Environment | Variables found |
|---|---|
| Production | **None** |
| Preview | **None** |
| Development | **None** |

**Classification, per explicit instruction:** since the public production API
demonstrably works (§5) while this accessible project has zero configuration in any
environment, this is evidence of a **project/account mismatch** (§4–§6), **not**
evidence that production is misconfigured. The real configuration — including
whatever satisfies `requireServiceAuth`'s `BELL24H_VYAPARSETHU_SERVICE_TOKEN` (proven
live and working via black-box behavioral test in the OS-INTEGRATION-GATE-B-02
sprints; not re-tested here per the "do not repeat Gate B-02 proof" instruction) —
lives in the inaccessible project from §4–§6, not here.

---

## 8. Frontend Deployment Readiness

```
FRONTEND:            EXISTS
BUILD:                IDENTIFIED   (vite build && esbuild server.ts ...)
ENTRY POINT:          IDENTIFIED   (index.html -> src/main.tsx -> src/App.tsx)
OUTPUT:                IDENTIFIED   (dist/, already vercel.json's outputDirectory)
CURRENT vercel.json:  API-ONLY
```
The existing frontend can theoretically be deployed **without rewriting it** — the
`outputDirectory` Vercel already expects (`dist`) is exactly where the real
`vite build` already writes its output; only the `buildCommand` override in
`vercel.json` stands between the current placeholder and the real app. This is
inspection only, per instruction — `vercel.json` was **not** changed.

---

## 9. Security Boundary Confirmation

- No provider API key, service token, admin token, JWT secret, Authorization header
  value, or other secret was retrieved, printed, or displayed at any point in this
  sprint.
- `vercel env ls` was used strictly for name/presence/scope — never `vercel env pull`,
  never a value flag, never `.env` production extraction.
- The one behavioral proof cited in §7 (that a real service token exists somewhere)
  is inherited from the earlier, separately-authorized OS-INTEGRATION-GATE-B-02
  sprints and was **not** re-executed this turn, per the "do not repeat Gate B-02
  proof" instruction — it is cited as prior evidence only.
- No domain, DNS, environment variable, GitHub connection, or deployment was created,
  modified, or triggered.

---

## 10. Human Action Required — exact checklist

Because the live production project is not accessible from this Claude session, and
per instruction this is **not** to be worked around, the following must be done by a
human with broader Vercel/GitHub access:

1. **Vercel account/team to open:** whichever account is *not*
   `bell24hhelpline-8523` / `bell24xs-projects` — most likely a founder's personal
   Vercel account, or a second team this session was never invited to. (Elimination:
   it is confirmed **not** `bell24xs-projects` — that team's only domain is
   `vyaparsethu.com`, and its only two projects, `bell24h` and
   `digitex-erp-bell24h-os`, were both directly inspected and ruled out in §3–§4.)
2. **Project to locate:** whichever Vercel project, once that account is open, has
   `digitex-erp-bell24h-os.vercel.app` listed under its Domains tab.
3. **Domain to verify:** confirm that project's Domains tab shows
   `digitex-erp-bell24h-os.vercel.app` as an assigned (not just requested) domain.
4. **Git repository to verify:** confirm that project's Settings → Git shows
   `digitex-erp/digitex-erp-bell24h-os` connected, on the `main` branch. (§6's content
   fingerprint predicts this will match; it has not been directly confirmed because
   this session cannot open that project.)
5. **Production branch to verify:** confirm it is `main` (or identify the actual
   branch if different — this session cannot assume it).
6. **Environment-variable NAMES/scopes to check** in that project's Production
   environment (presence only, never open/reveal values):
   - `BELL24H_VYAPARSETHU_SERVICE_TOKEN`
   - `NVIDIA_API_KEY`
   - Any `DATABASE_URL` / `SUPABASE_*` variables (relevant to §8's frontend
     activation and to `server/audit.ts`'s durable-persistence gap noted in
     OS-LIVE-01)

Once that project is identified, the smallest safe next step (not authorized in this
sprint) is the `vercel.json` `buildCommand` fix already scoped in OS-LIVE-01 §4,
applied to *that* project specifically.

---

## 11. What MUST NOT Be Changed Yet

- `vercel.json` — remains untouched until the correct project is confirmed; changing
  it in the accessible-but-wrong project would have zero effect on the real domain
  and would create false confidence.
- Any environment variable, in either the accessible or the (still unreached) live
  project.
- Any domain attachment/detachment.
- Any GitHub App / Vercel Git integration connect or disconnect.
- No redeploy, no `vercel --prod`, no `git push` intended as a deployment trigger
  (the accessible project has no Git integration to trigger from anyway, per §3.D).

---

## 12. Git Discipline

```
$ git status --short
?? docs/project/OS-LIVE-01-LIVE-PLATFORM-ACTIVATION-REPORT.md
?? docs/project/OS-LIVE-02-VERCEL-RECONCILIATION-REPORT.md

$ git diff --stat
(no output — no tracked file modified)

$ git diff
(no output — no tracked file modified)
```
Only two **untracked, uncommitted** report files exist beyond the clean `HEAD ==
origin/main` state. Nothing was committed. Nothing was pushed.

---

## 13. Recommended Next Sprint

**Exactly one:** *"OS-LIVE-03 — Human-Executed Vercel Account Access Grant."* A
human-only action: whoever controls the Vercel account currently hosting
`digitex-erp-bell24h-os.vercel.app` either (a) adds `bell24hhelpline-8523` as a member
of that team, or (b) directly performs the checklist in §10 and reports back the
project ID, Git-integration status, and environment-variable presence (names only).
No further automated Vercel investigation from this session will change the outcome —
the boundary is an access boundary, not an information-gathering one.
