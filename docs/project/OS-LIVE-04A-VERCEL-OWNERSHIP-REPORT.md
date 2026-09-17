# OS-LIVE-04A — Vercel Ownership & Access Reconciliation

**Date:** 2026-08-18 (final re-verification pass — supersedes the version committed
earlier this session at `bd31707`, which reached identical conclusions without a
local build/typecheck baseline)
**Scope:** Read-only re-check of whether the actual owner of
`digitex-erp-bell24h-os.vercel.app` can now be identified. No source, `vercel.json`,
environment variable, domain, or Git integration was modified. Gate A and Gate B-02
were not reopened or retested. **This pass makes no git commit or push** — the report
file is written only; see Phase 11 / Git Discipline below.

Legend: **VERIFIED** (directly observed this sprint) / **INFERRED** (reasoned from
verified evidence) / **UNKNOWN** (no evidence) / **ACCESS DENIED** (a specific tool
call refused access).

---

## 1. Repository Identity — VERIFIED

Workspace: `C:\Users\Sanika\digitex-erp-bell24h-os`. Remote: `origin →
https://github.com/digitex-erp/digitex-erp-bell24h-os.git`.

## 2. Git Status — VERIFIED

At the time this report was written, `HEAD` and `origin/main` were both
`bd31707ca6e1e1be44e9698a1d4090fb7314d36e` (the commit that landed the prior version
of this same report), working tree otherwise clean. Exact post-write values are
captured in Phase 11 below, per instruction, without any commit.

## 3. Live Domain Status — VERIFIED

```
GET https://digitex-erp-bell24h-os.vercel.app/               -> HTTP 200
GET https://digitex-erp-bell24h-os.vercel.app/api/v1/health  -> HTTP 200
{"status":"ok","apiVersion":"v1","requestId":"req_msxx64po_t5yiqnb8"}
```
Reachable, unchanged in shape from every prior sprint this session.

## 4. Actual Vercel Owner — **ACCESS DENIED**

Re-tested fresh this pass, not reused from memory:

```
$ vercel whoami
bell24hhelpline-8523

$ vercel domains ls --scope bell24xs-projects
  Domain             ...
  vyaparsethu.com    ...          ← still the only domain owned

$ vercel domains inspect digitex-erp-bell24h-os.vercel.app --scope bell24xs-projects
Error: You don't have access to the domain digitex-erp-bell24h-os.vercel.app
under bell24xs-projects.

$ vercel inspect https://digitex-erp-bell24h-os.vercel.app --scope bell24xs-projects
Error: Can't find the deployment "digitex-erp-bell24h-os.vercel.app"
under the context "bell24xs-projects".
```
No bypass was attempted. Identical result to OS-LIVE-03 and the prior OS-LIVE-04A
pass — access has not changed.

## 5. Actual Vercel Project — UNKNOWN

Cannot be determined; owner is inaccessible (§4).

## 6. Project ID — UNKNOWN

Same reason.

## 7. Team/Account — UNKNOWN

Same reason. Only one team is visible to this session at all:
`BELL24x's projects` / `bell24xs-projects` / `team_4QgVezq9OAa7UqzMkRMteKZX`.

## 8. Domain Ownership — **ACCESS DENIED**

Per §4 — the accessible team's domain list contains only `vyaparsethu.com`;
`digitex-erp-bell24h-os.vercel.app` is not in it and cannot be inspected.

## 9. GitHub Integration — UNKNOWN

Cannot be directly verified — the owning project is inaccessible, so its Git
settings cannot be read. Per instruction, this is **not** inferred from the live
HTML/API response matching this repository (that observation was recorded in
OS-LIVE-03 §6 as corroborating-but-not-proof; it is not repeated here as evidence).
The one project this session *can* reach has no Git integration at all (unchanged),
which independently rules it out as the source but says nothing about the real owner.

## 10. Production Deployment — **ACCESS DENIED**

Cannot be inspected on the real owning project. On the accessible-but-wrong project,
the latest deployment (`dpl_k9wxJRarfhr7gNsFoNYSda2T2ntk`, `READY`, `target: null`) is
unchanged from every prior sprint — no new deployment has occurred there either.

## 11. Production Commit — UNKNOWN

Not discoverable — no commit SHA is exposed by the live HTTP responses, and the
owning project cannot be queried.

## 12. Environment Variable Names/Scopes

Only observable on the accessible-but-wrong project (`digitex-erp-bell24h-os`,
`prj_8oLwDwlcBgJAuf4FFFsSWwBcFBGp`, `bell24xs-projects`), re-checked this pass:

| Environment | Variables |
|---|---|
| Production | **None** |
| Preview | **None** |
| Development | **None** |

For the real owning project: **PRODUCTION ENVIRONMENT: ACCESS DENIED** — no name,
scope, or value could be retrieved. No value was ever requested or displayed for any
variable on either project.

## 13. Current Frontend/API Deployment State — API-ONLY

Live root (`/`) still returns the placeholder string configured by this repository's
`vercel.json` (`"Bell24h-OS staging"` / `"API-only staging build..."`); `/api/*`
routes are live and functional. **Frontend was not activated; `vercel.json` was not
modified.**

## 14. Local Build/Typecheck Baseline

Run this pass, read-only (`dist/` is `.gitignore`d — confirmed before running,
nothing tracked was touched):

```
BUILD:      PASS   — vite build: 1871 modules transformed, clean, 17.48s;
                      esbuild server bundle: dist/server.cjs, 26.6kb, clean
TYPECHECK:  PASS   — npx tsc --noEmit, exit code 0, no output
```
This is a baseline check only, per instruction — no failures to fix, none attempted.

## 15. Security / Secret Findings — NONE

No value for `BELL24H_VYAPARSETHU_SERVICE_TOKEN`, `NVIDIA_API_KEY`,
`GEMINI_API_KEY`, or any other credential was retrieved, searched for, printed,
echoed, exported, or copied at any point this pass. Only variable **names** and
**presence** were checked (§12), and only on the project this session already has
legitimate access to. No `vercel env pull`, no `.env` file created or read from
production.

## 16. Required Human Action — YES

Unchanged from every prior sprint: a human with broader Vercel access must either (a)
grant `bell24hhelpline-8523` access to whichever account/team owns
`digitex-erp-bell24h-os.vercel.app`, or (b) directly retrieve and report back — from
inside that account — the project ID, Git integration status + branch, and Production
environment variable **names only** for `BELL24H_VYAPARSETHU_SERVICE_TOKEN`,
`NVIDIA_API_KEY`, and any `DATABASE_URL`/`SUPABASE_*` variables. This is a repeat of
OS-LIVE-03 §13, re-confirmed still necessary, not a new checklist.

## 17. Recommended Next Gate

**HUMAN VERCEL ACCOUNT ACCESS REQUIRED.** No automated reconciliation from this
session can proceed further — every access path available to this session (CLI
domain/deployment inspect, CLI domain listing, MCP team listing) has been exhausted
and re-confirmed unchanged across four consecutive sprints (OS-LIVE-02, 03, 04A ×2)
this session.

---

## OS-LIVE-04A — FINAL VERDICT

```
REPOSITORY:                   VERIFIED
LOCAL HEAD:                   (see Phase 11 output below — no commit made this pass)
ORIGIN MAIN:                  (see Phase 11 output below — no commit made this pass)
GIT:                          IN SYNC (unchanged by this pass)

LIVE DOMAIN:                  VERIFIED
LIVE /api/v1/health:          VERIFIED

ACTUAL VERCEL OWNER:          ACCESS DENIED
ACTUAL VERCEL PROJECT:        UNKNOWN
PROJECT ID:                   UNKNOWN
TEAM:                         UNKNOWN

DOMAIN OWNERSHIP:             ACCESS DENIED
GITHUB:                       UNKNOWN
PRODUCTION BRANCH:            UNKNOWN
PRODUCTION DEPLOYMENT:        ACCESS DENIED
PRODUCTION COMMIT:            UNKNOWN
GITHUB AUTO DEPLOY:           UNKNOWN

ENVIRONMENT VARIABLE NAMES:   none observable for the real owning project (access
                               denied); accessible project has zero variables in
                               Production, Preview, and Development
ENVIRONMENT VALUES:           NOT ACCESSED

FRONTEND:                     READY  (build + typecheck both pass this sprint;
                               not activated)
CURRENT DEPLOYMENT:           API-ONLY

BUILD:                        PASS
TYPECHECK:                    PASS

SECRET EXPOSURE:              NONE
SOURCE CODE:                  UNCHANGED
VERCEL CONFIG:                UNCHANGED
DEPLOYMENT:                   UNCHANGED

GATE A:                       UNCHANGED
GATE B-02:                    UNCHANGED

HUMAN ACTION REQUIRED:        YES

NEXT GATE:                    HUMAN VERCEL ACCOUNT ACCESS REQUIRED
```

STOP.
