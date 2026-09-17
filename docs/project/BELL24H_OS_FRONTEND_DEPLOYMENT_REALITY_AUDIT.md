# BELL24H_OS FRONTEND DEPLOYMENT REALITY AUDIT

**Repository:** `digitex-erp/digitex-erp-bell24h-os`
**Phase:** Frontend Deployment Reality Audit (Phase 10) — **audit only, no code modified,
no commit made, nothing deployed, no Vercel setting changed, no branch created**
**Date:** 2026-09-14

**This document is intentionally left UNCOMMITTED**, per this turn's explicit "Do NOT
create commits."

---

## Root cause, stated first

Production serves the exact string `main`'s `vercel.json` produces, because `main`'s
`vercel.json` — read fresh this turn via `git show main:vercel.json` — still contains the
**original placeholder `buildCommand`**, a literal `echo` that writes a static HTML string
into `dist/index.html` instead of running a real build:

```
"buildCommand": "mkdir -p dist && echo '<!doctype html><title>Bell24h-OS staging</title><p>API-only staging build for OS-INTEGRATION-IMPLEMENTATION-01. See /api/v1/health.</p>' > dist/index.html"
```

This is a **byte-for-byte match** to the exact text observed live in production last turn
(`BELL24H_OS_ORIGINAL_BLOCKER_VALIDATION.md`, `05c9cc9`). The fix for this — `vercel.json`
with `buildCommand: "vite build"` and an SPA catchall rewrite — already exists, already
works, and is already committed, but only on `frontend-activation/fd1-vercel-build`
(commit `1ecd051` onward), which has never been merged into `main`. There is no mystery
left to investigate here; the remaining work is entirely a merge/deploy action, not a code
fix.

---

## 1. Deployment Architecture Diagram

```
GitHub: digitex-erp-bell24h-os
   ├── main  ─────────────────────────► [Vercel production deployment, per content match]
   │     vercel.json: placeholder buildCommand, no SPA rewrite
   │     └─ dist/index.html = static placeholder string only
   │     └─ api/index.ts → createApp() → server.ts   [REAL, deployed, responding 200]
   │
   └── frontend-activation/fd1-vercel-build  ─────► [NOT deployed anywhere — unmerged]
         vercel.json: buildCommand "vite build", SPA catchall rewrite present
         └─ dist/index.html = real Vite-built SPA shell (verified locally, this turn: 422
            bytes, references hashed assets/ bundle, dist/ freshly present in working tree)
         └─ api/index.ts → createApp() → server.ts   [identical backend code to main]

Live production (digitex-erp-bell24h-os.vercel.app), confirmed this session:
   GET /                    → 200, static placeholder (matches main's buildCommand output)
   GET /system/diagnostics  → 404 NOT_FOUND (no SPA router loaded to handle client routes)
   GET /api/v1/health       → 200, real JSON (backend is genuinely deployed and running)
```

**One caveat carried over from this repository's own prior investigation, not resolved by
this audit:** `docs/project/OS-LIVE-04A-VERCEL-OWNERSHIP-REPORT.md` records
`PRODUCTION BRANCH: UNKNOWN` and `PRODUCTION DEPLOYMENT: ACCESS DENIED` — that session
never obtained Vercel dashboard/API access to directly confirm which branch or Git
integration serves this domain. This audit's conclusion that `main` is what's deployed is
**not** based on dashboard access (none exists in this session either) — it is based on
the live-served content being an exact textual match to `main`'s current `vercel.json`,
which is strong, but content-level, not access-level, evidence. Both can be true at once:
branch/account ownership remains formally unconfirmed, while the specific placeholder text
being served is fully explained by `main`'s current file content regardless.

## 2. Branch → Build → Deploy Flow

| Step | `main` (currently deployed, per content match) | `frontend-activation/fd1-vercel-build` (fix, unmerged) |
|---|---|---|
| `vercel.json` buildCommand | `mkdir -p dist && echo '...' > dist/index.html` | `vite build` |
| `vercel.json` rewrites | `/api/(.*)` only | `/api/(.*)` + `/(.*) → /index.html` (SPA catchall) |
| `dist/index.html` after build | Static placeholder, no JS, no router | Real Vite shell referencing hashed JS/CSS bundle |
| Result for `GET /system/diagnostics` | 404 (no client router exists to intercept it) | Would resolve via the SPA catchall to `index.html`, letting React Router handle it client-side |
| Result for `GET /api/v1/health` | 200 (unaffected either way — `api/index.ts` is identical on both branches) | Same, 200 |

## 3. Frontend Build Verification

Re-confirmed this turn, on the current branch's working tree: `dist/` is present and
recent (`index.html` + `assets/`), consistent with this session's earlier, repeated `vite
build` runs (1,874 modules, deterministic hashes across multiple runs, documented in
`BELL24H_OS_FRONTEND_DEPLOYMENT_CERTIFICATION.md`). A fresh `npm run build` was **not**
re-run this turn — nothing has changed in the source since that was last verified, so
re-running would not produce new evidence, only repeat a known-passing result.

## 4. Vercel Configuration Audit

`git diff main -- vercel.json`, run fresh this turn, shows the complete, minimal, already-
committed fix:

```diff
-  "buildCommand": "mkdir -p dist && echo '<!doctype html><title>Bell24h-OS staging</title><p>API-only staging build for OS-INTEGRATION-IMPLEMENTATION-01. See /api/v1/health.</p>' > dist/index.html",
+  "buildCommand": "vite build",
   "rewrites": [
-    { "source": "/api/(.*)", "destination": "/api/index" }
+    { "source": "/api/(.*)", "destination": "/api/index" },
+    { "source": "/(.*)", "destination": "/index.html" }
   ]
```

No `client/package.json` or `server/package.json` exists in this repository (confirmed via
glob this turn) — this is a flat, single-`package.json` repo with `server.ts` at the root
and the SPA source under `src/`, not a monorepo split. Root `package.json`'s own `build`
script (`vite build && esbuild server.ts ...`) is unaffected by and unrelated to this bug
— it has always been correct; the bug is entirely in `vercel.json`'s separate,
Vercel-specific `buildCommand` override, which does not call the root `package.json`'s
`build` script at all.

## 5. Root Cause Analysis

**A. What application is currently configured for deployment (on `main`)?**
A backend-only deployment: `api/index.ts` (real, serving `server.ts`'s Express app) plus a
static placeholder page at every non-`/api` path. No frontend application is configured to
build at all on `main` — `vercel.json`'s `buildCommand` never invokes `vite build`.

**B. Is the React SPA configured to build?**
Not on `main`. Yes, on `frontend-activation/fd1-vercel-build` — verified this turn (§3).

**C. Is the SPA build output connected to Vercel routing?**
Not on `main` — no SPA catchall rewrite exists, so even if `dist/` somehow contained a
real build, direct navigation to any client-side route would still 404. Yes, on the fix
branch — catchall rewrite present (§4).

**D. Does the deployed branch differ from `frontend-activation/fd1-vercel-build`?**
Yes — by strong content-match evidence (§1's caveat notwithstanding), production is
serving `main`'s configuration, not the fix branch's.

**E. Classification of the production deployment:**
**Wrong branch deployment**, more precisely than "misconfigured" — the configuration
being served isn't broken in some ambiguous way, it is `main`'s own, internally-consistent
(if incomplete) configuration, working exactly as `main`'s `vercel.json` specifies. It is
"backend only" as an accurate description of the *result*, but the *cause* is that the
branch carrying the frontend fix was never merged — not that the frontend was deliberately
excluded from an otherwise-correct `main` configuration.

**F. What exact routes should exist if the SPA were deployed correctly?**
Every route already defined in `src/App.tsx` (`/dashboard`, `/video-studio`,
`/image-studio`, `/knowledge-vault`, `/system/diagnostics`, `/settings`, `/admin`,
`/team`, `/organization`, `/ai-providers`, `/content-planner`, `/prompt-studio`,
`/job-orchestrator`, `/industry-dashboard`, plus auth routes) would resolve via the SPA
catchall to `index.html`, with React Router handling the rest client-side — exactly as
they already do when served locally via `vite build && vite preview`.

**G. Should `/system/diagnostics` exist in the deployed frontend?**
Yes — it is a real route in `src/App.tsx`, part of the same build as every other page.
Its current 404 is not specific to that route; it is a symptom of the SPA not being
deployed at all, and would affect every client-side route identically.

## 6. Exact Remediation Plan

No new code is required — the fix already exists, already builds successfully, and is
already committed. The remediation is a **deployment action**, not an engineering task:

1. Merge `frontend-activation/fd1-vercel-build` into `main` (confirmed earlier this
   session, via `git merge-base --is-ancestor` and `git merge-tree`: fast-forward
   available, zero conflicts — not re-verified fresh this turn since nothing has changed
   on either branch since that check).
2. Allow Vercel's Git integration to redeploy `main` (or trigger manually, if that's how
   this project's deployments are actually initiated — unknown per §1's caveat).
3. Re-run this session's already-prepared Post-Deployment Validation Checklist
   (`BELL24H_OS_FRONTEND_DEPLOYMENT_CERTIFICATION.md` §4) against the new production
   deployment.

This remediation is **separate from and does not depend on** the RLS remediation
(`OWNER_EXECUTION_PACKAGE.md`) — they are two independent blockers (one a Vercel build
configuration, one a Postgres policy) that happen to both gate the same eventual outcome
(a working, deployed application). Neither fixes the other.

---

## Final Verdict

# GO TO DEPLOYMENT FIX

Not "GO TO RUNTIME VALIDATION" — further runtime probing of the current production
deployment would only re-confirm what is already conclusively explained: `main`'s
`vercel.json` is the complete, sufficient root cause, verified this turn by an exact
content match between the live-served placeholder text and `main`'s own file content, cross-
checked against a clean, minimal, already-committed diff on the fix branch. No further
audit narrows this any further — the next meaningful action is the merge/deploy step in
§6, which is outside this session's permitted scope this turn (no deploy, no commit, no
branch creation, no Vercel setting change).

---
*(Deliberately uncommitted this turn — see note at top.)*
