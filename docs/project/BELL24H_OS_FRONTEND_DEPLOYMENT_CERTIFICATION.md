# BELL24H_OS FRONTEND DEPLOYMENT CERTIFICATION

**Repository:** `digitex-erp/digitex-erp-bell24h-os`
**Branch under certification:** `frontend-activation/fd1-vercel-build`, `HEAD 3380c76`
(6 commits ahead of `main`: `b0eaabe`, `e0cfcb9`, `6f68242`, `1ecd051`, `4bfd2b4`, `3380c76`)
**Phase:** Frontend Deployment Certification — **certification only, no code changed, no
deploy, no merge**
**Date:** 2026-09-14

**Revision note:** this document supersedes the certification written earlier in this
session against `HEAD 1ecd051`. Two of that certification's three named High/Medium risks
(fabricated Settings/Admin, the Knowledge Vault Authorization bug) were fixed in the
interim, on this same branch (`4bfd2b4`, `3380c76`) — this is a fresh re-certification
against current state, not an amendment. No new feature was built, Communication Hub and
Agent Runtime were not touched, no new dashboard or plan was created, per this mission's
constraints.

---

## 1. Frontend Deployment Certification Report

### 1.1 — Frontend activation changes: complete and re-verified

`git diff --stat main...HEAD` (17 files, 429 insertions / 363 deletions) confirms the full
scope of what this branch carries: the `vercel.json` build/routing fix, Sprint 1's three
tasks (hardcoded-status removal, orphaned-page routing, partial RLS-bypass migration), and
this turn's two blocker fixes (Settings/Admin, Knowledge Vault auth). Working tree is clean
against `HEAD` — no uncommitted drift.

### 1.2 — Vite build output

Re-ran `vite build` fresh this turn (the exact `buildCommand` string, not the fuller `npm
run build`): succeeded clean, 1,874 modules, 16.18s.

| File | Size |
|---|---|
| `dist/index.html` | 422 bytes — real, references the built bundle |
| `dist/assets/index-CjYY1-63.js` | 848.79 kB |
| `dist/assets/index-BchmJi-h.css` | 59.52 kB |

Same file hashes as the prior turn's build (run immediately after `3380c76`) — deterministic,
not a one-off. Bundle is ~4.8 kB smaller than before the Settings/Admin fix, consistent with
fabricated content having been removed rather than added. **Verified.**

### 1.3 — SPA routing behavior

`vercel.json`'s `rewrites` array is unchanged since the last certification: `/api/(.*)` →
`/api/index`, then a catchall `/(.*)` → `/index.html`. **Evidence tier, unchanged and stated
plainly again:** this ordering has never been live-tested against Vercel's actual routing
layer. One attempt via `vercel dev` two turns ago did not converge (this repo's
`framework: null` + custom Express/Vite setup doesn't fit its zero-config heuristics); no
further attempt was made this turn, since repeating a tool that already failed to fit this
repo's shape produces no new evidence. The claim rests on Vercel's documented, stable
rewrite semantics — **sound, but still unverified against the live routing layer. This
remains the single most load-bearing open item in this certification** — not one line among
several, since every other named risk from the prior certification has either been fixed or
was never about whether the mechanism works.

### 1.4 — Dashboard routes

`src/App.tsx:79` — present. Held to the same evidence tier as 1.3: the route entry is
correct source-level evidence; whether it resolves through Vercel's routing layer for a
direct navigation is the same open question, not separately verified.

### 1.5 — Video Studio routes

`src/App.tsx:87` — present. `src/pages/VideoStudioPage.tsx` does not appear anywhere in
`git diff --stat main...HEAD` — **confirmed untouched**, matching this mission's
constraints. Renders, real CRUD, 0% of its advertised generation capability works (no
server-side video-generation provider exists — `server/ai/` contains only
`GeminiProvider.ts`/`NvidiaProvider.ts`; `JobWorker.start()` remains commented out in
`src/main.tsx`). Pre-existing, unaffected by this branch.

### 1.6 — Image Studio routes

`src/App.tsx:86` — present, **confirmed untouched**. Same underlying gap as Video Studio.

### 1.7 — Discovery routes

**No route, page, or component named "Discovery" exists anywhere in this codebase.** This
turn's fresh `<Route path=` listing of `src/App.tsx` (Section 1.4's evidence) confirms no
such route exists there now, consistent with the full `src/pages/`/`AppLayout.tsx` search
from the prior certification (not re-run in full this turn — that broader search wasn't
repeated, since nothing in this branch's diff touches page or nav file additions/removals
beyond what's already listed in 1.9). The only match anywhere in this codebase remains the
unrelated hardcoded string inside `KnowledgeVaultPage.tsx`'s mentor-advice text ("Finalize
Supplier Discovery..."), not a route. Reported as absent, per this session's standing
evidence discipline (same standard applied to "Marketplace Integration" in an earlier
certification) — not guessed at, not dropped from this report.

### 1.8 — AI Provider routes

`src/App.tsx:83` — present, **confirmed untouched**. Backing route (`POST
/api/v1/ai/text`) and the two real, credential-isolated providers
(`GeminiProvider.ts`/`NvidiaProvider.ts`) also untouched. Real and working for
Gemini/NVIDIA; `ai_providers.api_key` remains un-`REVOKE`d (Gate C GC-1, still open,
unrelated to this branch).

### 1.9 — Production deployment blockers

Compared against the prior certification's three named risks:

| Prior risk | Status now |
|---|---|
| `/settings`, `/admin` present fabricated data as real | **Resolved** — `3380c76`. Both pages now show an honest "not implemented" state; removed from nav in both the sidebar and the user avatar dropdown (a second path found this session). Grep-confirmed zero remaining fabricated strings outside comments. `npm run lint`/`build` clean. **Not** confirmed by a live authenticated render (see below). |
| Knowledge Vault 401/render break | **Resolved** — `4bfd2b4`. All 6 call sites now attach the session token via a shared `authedFetchJson` helper; a distinct error state prevents the prior crash-on-401 behavior. Same "not confirmed by live render" caveat applies. |
| No recorded owner decision to ship (TASK-14) | **Still open.** This is an owner action, not something any engineering session can close. Independent of the two rows above — closing them does not touch this one. |

**Remaining blockers, ranked:**

1. **TASK-14 — no recorded decision to deploy.** Blocking by itself, regardless of code
   quality.
2. **Unverified live routing/render behavior (Items 1.3–1.4).** The two fixes above are
   verified by type-checked code review, grep, and the server-side 401 contract — not by
   watching them work for a real, authenticated user in a real browser. An attempt was made
   this session (temporary `VITE_AUTH_BYPASS` + browser automation) and hit a genuine
   environment limitation (Chrome extension not connected), not a policy denial. This is now
   the single most consequential unknown left in this certification.
3. **Pre-existing, out-of-scope-for-this-branch gaps**, unaffected either way by merging:
   Video/Image Studio's 0% generation capability (no user-facing indication that "Generate"
   silently does nothing); Gate C's 4 open items (governance, not a functional blocker to
   this plan's own Production Ready definition); the 848.8 kB unsplit JS bundle
   (performance, not correctness).

---

## 2. Production Deployment Blockers

See 1.9's ranked list. In short: **1 hard blocker (TASK-14, owner-only) + 1 unverified
mechanism (live routing/render) + 3 pre-existing, lower-severity gaps that don't block this
plan's own Production Ready definition.**

---

## 3. Required Merge Sequence

*(Recorded as the sequence that would be correct if/when the remaining blockers close — not
authorization to begin it.)*

1. TASK-14: obtain and commit a dated decision that the SPA should be deployed.
2. Obtain a live, authenticated-session verification that `/dashboard`, `/knowledge-vault`,
   and the direct-URL `/settings`/`/admin` all render as expected (closes 1.3/1.4's open
   evidence gap) — requires either working browser automation in this environment or a
   manual check by someone with real credentials.
3. Merge `frontend-activation/fd1-vercel-build` → `main` as a single fast-forward or merge
   commit (no rebase needed — the branch is linear, 6 commits; `main` confirmed unmoved at
   `bd31707` both locally and on `origin`, re-checked this turn via `git fetch`, so a
   fast-forward merge is genuinely available, not merely assumed).
4. Re-run `npm run lint` and `npm run build` on `main` post-merge as a final gate, not a
   formality — confirms the merge itself didn't silently reintroduce a conflict resolution
   error.

---

## 4. Required Deployment Sequence

*(Same caveat — sequence only, not authorization.)*

1. Confirm `main`'s `HEAD` matches what Section 3 merged (no intervening commits).
2. Trigger the Vercel deployment (push to the branch Vercel watches, or `vercel --prod`
   if manually triggered) — this is the first point at which `vercel.json`'s fixed
   `buildCommand` actually runs in Vercel's own build environment, which is a materially
   different environment from every local `vite build` run in this certification.
3. Immediately after deploy, run the Post-Deployment Validation Checklist below **before**
   announcing the deployment complete — several of its items are exactly the things this
   certification could not verify locally (live routing, live render).
4. Only after that checklist passes should this be treated as done — a deploy that "went
   out" but hasn't been checked against the checklist is not yet certified live, by this
   document's own standard.

### Post-Deployment Validation Checklist

- [ ] `GET /` returns the real app shell, not a placeholder.
- [ ] `GET /dashboard` (direct navigation) returns the app shell, not `404`.
- [ ] `GET /assets/<real-hash>.js` returns `200`.
- [ ] `GET /api/v1/health` still returns `200` (confirms `/api` rewrite unaffected by the
      catchall).
- [ ] A real, authenticated user reaches `/dashboard` with no console error.
- [ ] A real, authenticated user opens `/knowledge-vault`; its 5 components load real data
      (not the error state) — confirms the Authorization-header fix works live, not just in
      review.
- [ ] Direct navigation to `/settings` and `/admin` shows the new honest message, not the
      old fabricated content and not a blank page.
- [ ] `/video-studio` and `/image-studio`'s "Generate" actions are either clearly labeled
      non-functional, or the dequeue work (TASK-17) has landed first.

---

## 5. Rollback Plan

Nothing is deployed or merged, so this stays procedural.

1. **Pre-merge:** none needed — deleting or leaving the branch unmerged fully contains
   everything above.
2. **Merged, not yet deployed:** `git revert` the merge commit on `main` (or the 6 individual
   commits in reverse, if a partial rollback of only some fixes is ever wanted — each is
   independently scoped and reviewable).
3. **Deployed, and something in the checklist fails:** Vercel's instant rollback to the prior
   deployment (dashboard or `vercel rollback`) is faster than a revert-and-redeploy cycle and
   restores the placeholder page immediately. Follow with the `git revert` from step 2 so
   `main` and the live state agree.
4. **Narrower, targeted mitigations** (short of a full rollback), if only one specific thing
   fails live:
   - Live render of `/settings`/`/admin` looks wrong: both routes can be removed from
     `App.tsx` entirely (not just nav) in a single small follow-up commit — more complete
     than nav-hiding alone, since a fabricated-data risk (already resolved, but if regressed)
     warrants full removal, not just hiding.
   - Live render of `/knowledge-vault` looks wrong: hide its nav entry
     (`AppLayout.tsx`) as an immediate mitigation while the render issue is investigated —
     acceptable here specifically because the current failure mode is a safe error message,
     not fabricated or leaked data.

---

## 6. GO / NO-GO Recommendation

# NO-GO

Narrower than the prior certification's reasoning, not weaker. Two of three previously-named
risks are genuinely fixed and verified as far as static evidence allows — that is real
progress, not just cosmetic. What still blocks GO:

1. **TASK-14 remains open** — no recorded decision authorizes this deployment at all, and
   that was never contingent on the other two risks. Closing them doesn't close this.
2. **The live routing/render behavior — the mechanism the entire deployment depends on — has
   never been confirmed working, only reasoned to be correct.** This is not a residual
   caveat to note in passing; it is now the binding open verification standing between this
   branch and a safe deploy, precisely because everything else that could be checked without
   a browser has been checked.

Recommend: close TASK-14, then obtain one live, authenticated pass through the checklist in
Section 4 (in this environment once browser automation is available, or manually) before
revisiting this recommendation.

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GyjerP42mTVzzK2ZkSeRCf
