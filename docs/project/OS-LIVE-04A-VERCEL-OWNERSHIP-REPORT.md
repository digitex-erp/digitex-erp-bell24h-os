# OS-LIVE-04A — Vercel Ownership & Access Reconciliation

**Date:** 2026-08-18
**Scope:** Read-only re-check of whether the actual owner of
`digitex-erp-bell24h-os.vercel.app` can now be identified, following OS-LIVE-01/02/03
in the same session. No source, `vercel.json`, environment variable, domain, or Git
integration was modified. Gate A and Gate B-02 were not reopened or retested.

Legend: **VERIFIED** (directly observed this sprint) / **INFERRED** (reasoned from
verified evidence) / **UNKNOWN** (no evidence) / **ACCESS DENIED** (a specific tool
call refused access).

---

## Phase 1 — Live Domain (VERIFIED)

```
GET https://digitex-erp-bell24h-os.vercel.app/               -> HTTP 200
GET https://digitex-erp-bell24h-os.vercel.app/api/v1/health  -> HTTP 200
{"status":"ok","apiVersion":"v1","requestId":"req_msxwrvzm_0j3lrotf"}
```
Unchanged from OS-LIVE-03.

---

## Phase 2 — Vercel Ownership: **ACCESS DENIED**

Re-checked fresh this sprint via two independent paths (Vercel CLI and the Vercel MCP
connector), specifically to test whether access had changed since OS-LIVE-03:

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
`list_teams` (Vercel MCP connector, independent auth path from the CLI): still returns
exactly **one** team — `BELL24x's projects` / `bell24xs-projects` /
`team_4QgVezq9OAa7UqzMkRMteKZX`. No second team or account has been added since
OS-LIVE-03.

**No bypass was attempted.** Access to the owning project/domain remains denied,
unchanged from the prior sprint.

---

## Phase 3 — Project Identity: **NOT APPLICABLE (owner inaccessible)**

Owner cannot be reached, so none of the following can be verified this sprint:
`VERCEL PROJECT`, `PROJECT ID`, `TEAM`, `GITHUB REPOSITORY`, `PRODUCTION BRANCH` for
the *actual* owning project — all **UNKNOWN**.

What *is* accessible and re-verified unchanged:

| Field | Value |
|---|---|
| Accessible project | `digitex-erp-bell24h-os` |
| Project ID | `prj_8oLwDwlcBgJAuf4FFFsSWwBcFBGp` |
| Team | `bell24xs-projects` (`team_4QgVezq9OAa7UqzMkRMteKZX`) |
| Domains on this project | `digitex-erp-bell24h-os-bell24xs-projects.vercel.app`, `digitex-erp-bell24h-os-bell24hhelpline-8523-bell24xs-projects.vercel.app` — **not** the bare vanity domain |
| Latest deployment | `dpl_k9wxJRarfhr7gNsFoNYSda2T2ntk`, `READY`, `target: null` — identical to OS-LIVE-03, no new deployment since |

This project is confirmed (again) **not** the owner of the live domain.

---

## Phase 4 — Git Link: **UNKNOWN**

Cannot be directly verified — the owning project is inaccessible, so its Git
integration settings cannot be read. Per instruction, Git linkage is **not** inferred
from HTML/content matching alone (that evidence was already offered, with the correct
caveat, in OS-LIVE-03 §6 — not repeated here as new proof). The accessible project
itself has no Git integration (re-confirmed: still no commit SHA on its deployment
record), so it is independently ruled out as the source.

**Classification: UNKNOWN** (not "NOT VERIFIED" — that would imply a check was run
against the actual owner and failed; no such check was possible at all).

---

## Phase 5 — Production Configuration: names/scopes only, accessible project

| Environment | Variables |
|---|---|
| Production | **None** |
| Preview | **None** |
| Development | **None** |

Re-run fresh this sprint (`vercel env ls <environment> --scope bell24xs-projects` ×3),
identical to OS-LIVE-03 — no variable was added, removed, or renamed on the accessible
project. No name, scope, or value was retrieved for the actual owning project — it
remains unreachable. No value was ever printed for any variable, on either project.

---

## Phase 6 — No Changes: **CONFIRMED**

```
SOURCE CODE:            UNCHANGED
VERCEL.JSON:            UNCHANGED
ENVIRONMENT VARIABLES:  UNCHANGED
DOMAINS:                UNCHANGED
DEPLOYMENT:             UNCHANGED
```
Only read-only inspection commands were run this sprint (`curl`, `vercel whoami`,
`vercel domains ls/inspect`, `vercel inspect`, `vercel env ls`, and the Vercel MCP
`list_teams`/`get_project` read calls). Verified via `git status --short` before
writing this report — see Phase 8.

---

## Conclusion

**Nothing about the ownership/access situation has changed since OS-LIVE-03.** This
was a genuine re-check, not a repeat from memory — every access path tried in
OS-LIVE-03 (CLI domain inspect, CLI deployment inspect, MCP team listing, CLI domain
listing) was re-run fresh this sprint and produced identical results. The blocker
remains exactly what OS-LIVE-03 identified: **this session's Vercel access
(`bell24hhelpline-8523` / `bell24xs-projects`) does not include the account or team
that owns `digitex-erp-bell24h-os.vercel.app`.** No further automated reconnaissance
from this session will change that outcome.

---

## OS-LIVE-04A — FINAL VERDICT

```
ACTUAL VERCEL OWNER:         ACCESS DENIED

PROJECT:                     UNKNOWN
PROJECT ID:                  UNKNOWN
TEAM:                        UNKNOWN

LIVE DOMAIN:                 VERIFIED
GITHUB:                      UNKNOWN
PRODUCTION BRANCH:           UNKNOWN
PRODUCTION DEPLOYMENT:       UNKNOWN

ENVIRONMENT VARIABLE NAMES:  none observable for the actual owning project (access
                              denied); accessible project (digitex-erp-bell24h-os,
                              bell24xs-projects) has zero variables in Production,
                              Preview, and Development

SECRETS:                     NOT EXPOSED
SOURCE:                       UNCHANGED
VERCEL CONFIG:                UNCHANGED
DEPLOYMENT:                   UNCHANGED

GATE A:                       UNCHANGED
GATE B-02:                    UNCHANGED

NEXT GATE:                    HUMAN VERCEL ACCESS REQUIRED
```

STOP.
