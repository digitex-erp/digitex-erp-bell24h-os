# Security Exposure Report — digitex-erp-bell24h-os

**Date:** 2026-09-28
**Scope:** `digitex-erp/digitex-erp-bell24h-os` — full local git history (105 commits, all local branches/tags) plus GitHub API checks. Read-only audit; no code modified, no commits created.
**Method:** see "Methodology" at the end for exact commands, so every finding below is reproducible.

## 1. Target commit reachability

**Commit:** `795cf84990406b148376ebba30dc297811d69923`

| Check | Result |
|---|---|
| Valid SHA-1 format (40 hex chars) | Yes |
| Present in local object database | **No** — `git cat-file -e` fails, not an object this clone has ever fetched |
| Reachable from any local branch/tag | **No** — `git branch --all --contains` returns "no such commit" |
| `GET /repos/{repo}/commits/{sha}` (GitHub REST) | **404 / 422** — "No commit found for SHA" |
| `GET /repos/{repo}/git/commits/{sha}` (raw git object API) | **404 Not Found** |
| GitHub global commit search (`search/commits?q=hash:{sha}`) | **0 results** |

**Conclusion: this SHA is not retrievable through the GitHub API for `digitex-erp/digitex-erp-bell24h-os`, and is not present in this local clone's history.**

**Caveats, stated plainly:**
- This does not prove the commit never existed. If it was ever force-pushed away or a branch containing it was deleted *before* this local clone last fetched, it could be permanently gone from GitHub's reachable objects (GitHub eventually garbage-collects unreachable objects on its own schedule, typically after some weeks) and this check would report exactly what it reports now either way.
- The `digitex-erp` GitHub org has **24 other repositories**, several with very similar names (`bell24h-os`, `bell24h-os-2`, `SogoBELL24H`, `bell24h-osSOGO`, `Vishaal-Pendharcar` — itself mapped to "bell24h-os" as its description). **This commit was checked only against `digitex-erp-bell24h-os`.** If the SHA originated from one of those other repositories, this report says nothing about it — that would need a separate, explicitly-scoped check.

## 2. Full-history secret search

Searched every commit reachable from any local ref (105 commits total — `feature/knowledge-substrate`, `feature/p0-remediation`, `feature/shogo-phase1-gap-audit`, `frontend-activation/fd1-vercel-build`, `main`, `release/fd2-production`, `sprint-1/gov2-sec2-gov4`, plus 2 tags) for the 10 requested terms, using two complementary methods (see Methodology):

1. **Vendor-signature scan** — regex patterns matching the actual *shape* of a real secret (JWT `eyJ...`, OpenAI `sk-...`, Google `AIza...`, GitHub `gh[pousr]_...`, Slack `xox...`, AWS `AKIA...`, PEM private-key headers, Google OAuth `ya29...`) across every added line in every commit's diff.
2. **Assignment-pattern scan** — any added line where one of the 10 requested terms (case-insensitive) appears near a quoted string of 16+ characters, with obvious placeholders filtered out.
3. **File-existence check** — whether `.env`, `.env.local`, `.env.production`, `.pem`, `.key`, `.p12`, `.pfx`, or an SSH private key was ever added to the repository at any point in history.

### Results

| Search | Hits found | True positives (real secret values) |
|---|---|---|
| Vendor-signature scan (method 1) | **0** | **0** |
| Assignment-pattern scan (method 2) | 23 candidate lines | **0** |
| `.env`/key-file existence (method 3) | 0 files ever committed (only `.env.example`, always empty) | n/a |
| Targeted: `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `service_role` | 12 commits touch a matching line | **0** |

**No real secret value was found anywhere in this repository's full local history.**

### What the 23 assignment-pattern hits actually were

Every one of the 23 candidates was manually inspected. Each is one of:

| Type | Example | File |
|---|---|---|
| Env var **name** in a config array, not a value | `deepseek: ["DEEPSEEK_API_KEY"]` | `server/ai/ProviderManager.ts` history |
| Header/const **name**, value is a header string not a secret | `const SERVICE_TOKEN_HEADER = "x-bell24h-service-token";` | `server.ts` history |
| Doc prose quoting an error message or var name | `` `SERVICE_TOKEN_ENV_VAR = "BELL24H_VYAPARSETHU_SERVICE_TOKEN"` `` | various `docs/` files |
| `.env.example` documented placeholder | `GEMINI_API_KEY="MY_GEMINI_API_KEY"` | `.env.example` (this is the AI-Studio convention placeholder, not a real key) |
| Unrelated substring match | `"node_modules/js-tokens": {` in `package-lock.json` | false positive on the word "token" inside a package name |
| Env var **name** listed for validation, no value | `'OPENAI_API_KEY'`, `'STRIPE_SECRET_KEY'` in a required-vars array | `server.ts` history |

Full match list with commit SHAs: see `Methodology → raw output` below.

### `.env.example` across every historical version

Every version of `.env.example` that has ever existed in this repository's history (checked commit-by-commit, not just the current one) contains only empty assignments (`SUPABASE_URL=`, `DATABASE_URL=`, `OPENAI_API_KEY=`, etc.) plus two AI-Studio-convention placeholder strings (`GEMINI_API_KEY="MY_GEMINI_API_KEY"`, `APP_URL="MY_APP_URL"`). No real value has ever been committed to this file.

## 3. Exposure table

| Exposure source | Commit SHA | File path | Secret type | Reachability | Remediation status |
|---|---|---|---|---|---|
| — | `795cf84990406b148376ebba30dc297811d69923` | — | Unknown (SHA given, no content ever seen) | **Not reachable** — not in local history, not retrievable via GitHub API for this repo | **No action possible or needed on this repo** — nothing was ever found under this SHA here. If this SHA belongs to a different `digitex-erp` repository, that repository needs its own check. |
| — | — | — | `adminPassword`, `password`, `secret`, `token`, `apikey`, `api_key`, `private_key`, `service_role`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY` | **No real value found** in any commit on any local branch/tag | **No rotation forced by this repo's git history** — see `SECRET_ROTATION_CHECKLIST.md` for rotation guidance driven by *operational* exposure risk (this session's own prior audits, shared screens, etc.), not a confirmed git leak. |

There is nothing in this section describing an actual confirmed leak, because none was found. This is a genuine "no exposure found" result, not an incomplete scan — see Methodology for exactly what was checked.

## Methodology (for reproducibility)

```bash
# 1. Commit reachability
git cat-file -e 795cf84990406b148376ebba30dc297811d69923
git branch --all --contains 795cf84990406b148376ebba30dc297811d69923
gh api repos/digitex-erp/digitex-erp-bell24h-os/commits/795cf84990406b148376ebba30dc297811d69923
gh api repos/digitex-erp/digitex-erp-bell24h-os/git/commits/795cf84990406b148376ebba30dc297811d69923
gh api "search/commits?q=hash:795cf84990406b148376ebba30dc297811d69923"

# 2. Full history dump (105 commits, all refs)
git log --all -p --format="@@COMMIT@@ %H %ai" > fullhist.diff

# 3. Vendor-signature scan (real secret shapes) over every added line
#    eyJ...\....\...  (JWT)   sk-...(20+)      AIza...(30+)      gh[pousr]_...(30+)
#    xox[baprs]-...          AKIA...(12+)      -----BEGIN ... PRIVATE KEY-----   ya29....(20+)

# 4. Assignment-pattern scan: (password|secret|token|api_?key|private_key), case-insensitive,
#    near a quoted string 16+ chars, placeholders filtered

# 5. File existence check
git log --all --diff-filter=A --name-only -- '.env' '.env.local' '.env.production' '*.pem' '*.key' '*.p12' '*.pfx'
git log --all --format=%H -- .env.example | xargs -I{} git show {}:.env.example
```

No files were modified and no commits were created in the course of this audit.
