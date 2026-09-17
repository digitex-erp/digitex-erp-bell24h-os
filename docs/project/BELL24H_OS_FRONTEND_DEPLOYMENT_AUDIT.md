# BELL24H_OS_FRONTEND_DEPLOYMENT_AUDIT

**Repository:** `digitex-erp/digitex-erp-bell24h-os` (`HEAD` on `sprint-1/gov2-sec2-gov4`,
branched from `main` at `6f68242`)
**Phase:** Bell24h-OS Frontend Reality Alignment Sprint — **audit only**
**Date:** 2026-09-14
**Live target audited:** `https://digitex-erp-bell24h-os.vercel.app` (confirmed against the
linked `.vercel/project.json`: `projectName: "digitex-erp-bell24h-os"`)

No code was built, no file was modified, no backend API was touched, no Communication Hub
or Agent Runtime work was performed. One local, gitignored `npm run build` was run
(confirmed untracked via `git check-ignore`) purely to produce comparison evidence for
Section 6 — it has no effect on the live deployment, which builds fresh from `vercel.json`
independently of any local `dist/` state.

---

## 1. Frontend Entrypoint Audit

- `index.html` (repo root) is Vite's real entrypoint: `<div id="root"></div>` +
  `<script type="module" src="/src/main.tsx">`. This is a genuine, correctly-formed Vite SPA
  entrypoint — not itself the problem.
- `src/main.tsx` mounts `<App />` (React 18 `createRoot`) — standard, unremarkable.
- `src/App.tsx` defines the full route table via `react-router-dom`'s `BrowserRouter` — 25
  routes as of this session (24 pre-existing + `/industry-dashboard`, added this session
  under a separate Sprint 1 mission — see that report; this audit did not alter it further).
- **Conclusion: the frontend entrypoint is real and complete.** Nothing here explains the
  placeholder.

## 2. Vite Build Audit

- `vite.config.ts` is a standard, correctly-formed config: React + Tailwind plugins, `@`
  alias to `src/`, and — critically — `import 'dotenv/config'` as its first line, which is
  required for `process.env` (and therefore the `define` block's `VITE_SUPABASE_*`
  injection) to be populated at all. This import is present and intact.
- `package.json`'s own `"build"` script is:
  `vite build && esbuild server.ts --bundle --platform=node --format=cjs ... --outfile=dist/server.cjs`
  — a real build: Vite builds the SPA into `dist/`, then esbuild bundles the Express server
  separately into `dist/server.cjs`.
- Running this script directly this session (`npm run build`) succeeded cleanly: 1,873
  modules transformed, `dist/index.html` (422 bytes, real, references the built bundle),
  `dist/assets/index-*.js` (853.61 kB), `dist/assets/index-*.css` (59.37 kB),
  `dist/server.cjs` (28.3 kB). Full evidence in Section 6.
- **Conclusion: the Vite build itself is real, functional, and was verified working this
  session.** Nothing here explains the placeholder either.

## 3. SPA Routing Audit

- `src/App.tsx`'s route table is intact and was already audited in depth this session
  (`BELL24H_OS_FULL_PRODUCT_AUDIT.md`, `BELL24H_OS_PRODUCTION_READINESS_REPORT.md`): `"/"`
  redirects to `/dashboard` inside a `ProtectedRoute`; `/system/diagnostics` is the one
  public route; every other page sits behind `AppLayout`.
- `server.ts`'s non-production branch (`NODE_ENV !== "production"`) uses Vite's dev
  middleware with `appType: "spa"`, which correctly serves `index.html` for any unmatched
  path so client-side routing works in dev — confirmed live this session (`curl` against a
  local dev server returned `200` for both matched and unmatched paths, as expected for an
  SPA fallback).
- `server.ts`'s production branch serves `express.static(dist)` plus a `app.get('*', ...)`
  fallback to `dist/index.html` — a correct SPA-serving pattern **for a traditional
  Express host** (`node dist/server.cjs`), where every request reaches this one process.
- **Caveat specific to the Vercel-hosted case (not the Express-hosted case above):**
  `vercel.json`'s `rewrites` (Section 4) route only `/api/(.*)` to the serverless function
  that wraps this same Express app. A path like `/dashboard` matches neither a static file
  in `outputDirectory: dist` nor that rewrite, so on Vercel specifically, `server.ts`'s own
  `app.get('*', ...)` fallback is **never reached at all** for that request — Vercel's
  static file layer 404s it before the serverless function is ever invoked. This is a
  distinct, additional gap from the placeholder-build problem (Section 4/7) and is carried
  into Section 8 rather than resolved here, since confirming it doesn't require building
  anything (see Section 8's reasoning).
- **Conclusion: client-side routing logic (the React Router table, and the Express
  fallback for traditional hosting) is correctly implemented.** It is not, by itself,
  sufficient for direct navigation to a sub-route on Vercel specifically — see Section 8.

## 4. Vercel Configuration Audit

`vercel.json` (repo root, current content, unchanged since this session's earlier staging
certification):

```json
{
  "version": 2,
  "framework": null,
  "outputDirectory": "dist",
  "buildCommand": "mkdir -p dist && echo '<!doctype html><title>Bell24h-OS staging</title><p>API-only staging build for OS-INTEGRATION-IMPLEMENTATION-01. See /api/v1/health.</p>' > dist/index.html",
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/index" }
  ]
}
```

**This is the root cause.** `buildCommand` does not call `vite build` (or `npm run build`)
at all — it runs `mkdir -p dist && echo '...' > dist/index.html`, which writes one static
136-byte HTML file containing a literal `<p>` tag and nothing else: no bundled JS, no CSS,
no `<div id="root">`, no `<script src="/src/main.tsx">`. `framework: null` additionally
tells Vercel not to infer or fall back to any framework-default build behavior. An explicit
`buildCommand` in `vercel.json` **overrides** `package.json`'s own `"build"` script — Vercel
never runs the real build script at all, regardless of the fact that it exists and works
(Section 2).

The `rewrites` block only routes `/api/(.*)` to the serverless function
(`api/index.ts` → `createApp()` → `server.ts`); there is no rewrite for any other path, so
every non-`/api` request is served whatever static file `outputDirectory: "dist"` contains —
which, per `buildCommand` above, is only the one placeholder `index.html`, for every path.
This same gap — no rewrite exists for any path other than `/api/(.*)` — has a second
consequence beyond today's placeholder problem: it also means a real build alone would not
make sub-route deep-linking work on Vercel. See Section 3's caveat and Section 8 Part B.

## 5. Deployment Target Audit

- `.vercel/project.json` (gitignored, present locally) confirms a real, linked Vercel
  project: `projectId: prj_8oLwDwlcBgJAuf4FFFsSWwBcFBGp`, `projectName:
  "digitex-erp-bell24h-os"`. This is not a dangling/unconnected repo — deployment
  infrastructure exists and is correctly pointed at this codebase.
- `api/index.ts` (the serverless function target of the `/api/*` rewrite) correctly imports
  `createApp()` from `server.js` (the compiled form of `server.ts`) and forwards each
  invocation to it — this is real, matches traditional hosting's `createApp()`, and is
  consistent with the working API layer confirmed live in Section 6/Section 7 below.
- **Conclusion: the deployment target is correctly configured and connected.** The gap is
  entirely in what `vercel.json` tells that correctly-connected target to build (Section 4),
  not in whether it's connected at all.

## 6. Build Output Audit

Direct, side-by-side comparison — the real build (run this session) vs. what `vercel.json`'s
`buildCommand` actually produces (simulated in an isolated scratch directory, not written
into the repo's own `dist/`):

| | Real `vite build` (`npm run build`) | `vercel.json`'s `buildCommand` |
|---|---|---|
| `dist/index.html` | 422 bytes — real HTML, `<script src="/assets/index-DsH7jTBj.js">` + `<link ... index-C4uvaxMo.css>`, `<div id="root">` | 136 bytes — `<!doctype html><title>Bell24h-OS staging</title><p>API-only staging build...</p>` |
| `dist/assets/*.js` | 853.61 kB (the entire 25-route SPA, React, all 18 service modules) | **does not exist** |
| `dist/assets/*.css` | 59.37 kB | **does not exist** |
| `dist/server.cjs` | 28.3 kB (bundled Express server) | **does not exist** — not needed for this path anyway, since `/api/*` is handled by `api/index.ts` separately |

This is the exact, mechanical reason the deployed app is a placeholder: **Vercel is not
failing to build the SPA — it is never asked to.**

## 7. Live Verification — the Exact Reason the Dashboard Is Not Appearing

Direct `curl` against the live production URL, this session:

| Request | Result |
|---|---|
| `GET https://digitex-erp-bell24h-os.vercel.app/` | `200`, **136 bytes**, body byte-for-byte identical to the simulated `buildCommand` output above |
| `GET .../dashboard` | `404` |
| `GET .../assets/index-DsH7jTBj.js` (a real, locally-built asset filename) | `404` — confirms no such asset was ever deployed |
| `GET .../api/v1/health` | `200` — confirms the API layer is live and correctly separated from the frontend problem |

**Exact reason, stated plainly:** the dashboard, and every other one of the 25 SPA routes,
is not appearing because **Vercel's build step for this project never runs `vite build`.**
It runs a one-line shell command that writes a static placeholder file instead, per
`vercel.json`'s `buildCommand` (Section 4). Fixing that alone would make `/` (root) serve
the real app shell — but per Section 3's caveat and Section 8 Part B, direct navigation to
`/dashboard` specifically (as opposed to the root path) would remain 404 on Vercel even
after the build is fixed, for a second, separate reason (no catchall rewrite). Both gaps
are real; this section names the one that explains today's *total* absence of the app. The
SPA code is real, complete, and builds
correctly when the real build command is actually run (Section 2/6) — it has simply never
been given the chance to run in the one environment that matters. This is not a routing bug,
not a broken build, not a disconnected deployment — it is a build command that was
deliberately written to produce a placeholder and has not been changed since.

## 8. Minimal Remediation Plan

*(Recorded for the record — per this mission's "audit only" scope, nothing below is
executed here.)*

**This is a two-part fix, not one — the build-command change alone leaves a second, real
gap.**

**Part A — run the real build:**

```json
"buildCommand": "npm run build"
```

— or equivalently `vite build` alone, since `dist/server.cjs` is not needed for the
Vercel path (`api/index.ts` imports `server.js`/`server.ts` directly, not the esbuild
bundle `npm run build` also produces for traditional hosting). This alone fixes `GET /` —
the real app shell would load and React Router would take over client-side navigation
correctly, matching Section 3's routing audit.

**Part B — a client-side-routing fallback rewrite, additionally required.** Per Section 3's
caveat: `vercel.json`'s `rewrites` today cover only `/api/(.*)`, and `framework: null`
disables Vercel's automatic SPA-fallback detection. With only Part A applied, a **direct**
navigation, bookmark, or page refresh on any sub-route (`/dashboard`, `/settings`, etc.)
would still 404 at Vercel's static-file layer, before `index.html` — and therefore the
React app and its router — ever loads; only in-app client-side navigation (clicking a link
after the app has already loaded at `/`) would work. This was not built or tested to
confirm (audit-only scope), but follows directly from the `rewrites` array shown in Section
4 and is the standard, well-documented Vercel behavior for a project with
`framework: null` and no catchall rewrite. The fix is one additional rewrite, ordered after
the existing API rule so it does not shadow it:

```json
"rewrites": [
  { "source": "/api/(.*)", "destination": "/api/index" },
  { "source": "/(.*)", "destination": "/index.html" }
]
```

Both parts should be verified live (direct navigation to `/dashboard` on the deployed URL,
not just `/`) before this is treated as closed — this audit stops at identifying the gap,
per its own "audit only" scope.

Neither part alone is sufficient to ship safely, per this session's own prior findings
(`BELL24H_OS_PRODUCTION_READINESS_REPORT.md` §11A.1, `BELL24H_OS_REMEDIATION_MASTER_PLAN.md`
Phase 3, TASK-15's dependency on TASK-06/TASK-07/TASK-14): flipping this one line today
would deploy `/settings` and `/admin` as pure fabricated mockups presenting fake data as
real, to real users, for the first time. The minimal *safe* remediation is the sequence the
Master Plan already specifies — TASK-06 (done, this session, a separate Sprint 1 mission),
TASK-07 (Settings/Admin — not yet done), and TASK-14 (an explicit, dated decision that this
deployment *should* ship the SPA at all, rather than continue silently drifting from what
the repo contains) — before this one-line `vercel.json` change is actually applied.

---

## Final Classification

# A. Frontend exists but is not deployed

Not B (build output is not "wrong" — the real build was verified correct in Section 2/6),
not C (SPA routing logic is correctly implemented in both `App.tsx` and `server.ts`'s
production/dev branches — Section 3), not D (a real Vercel project is linked and correctly
configured for the API half — Section 5). The frontend exists, is complete, and builds
successfully; `vercel.json`'s `buildCommand` simply never invokes that build, deploying a
one-line placeholder in its place instead.

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GyjerP42mTVzzK2ZkSeRCf
