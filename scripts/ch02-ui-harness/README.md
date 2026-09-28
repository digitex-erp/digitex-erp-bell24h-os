# CH-02 UI harness (verification tool — not part of the app)

Runs the **real** admin page (`/admin/communications`) against the **real** `/api/communications/*` routes,
the **real** `CommunicationJobHandler`, and the **real** migrations on an in-process Postgres (PGlite), then
drives it in a real Chrome with `e2e.cjs`.

## What is real and what is not
| Real | Stubbed |
|---|---|
| React UI, routes, RBAC, quotas, idempotency, campaign flow, worker handler, all SQL, both migrations | **Login** (always the seeded ADMIN) |
| | **The provider**, when switched on (`/__provider?mode=ok`): a test double named "Resend (TEST DOUBLE)". No network, **no real delivery.** |
| | **The scheduler**: `/__tick` runs queued communication jobs (stands in for the InsForge trigger) |

So a green run proves the UI and orchestration behave correctly (gates fail closed, nothing is marked sent
that was not, counts match). It does **not** prove any real provider delivers.

## Run
```bash
npm i --no-save playwright-core          # not a project dependency
npx vite build --config scripts/ch02-ui-harness/vite.config.ts
PORT=4179 npx tsx scripts/ch02-ui-harness/server.ts &      # prints HARNESS_READY
CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" node scripts/ch02-ui-harness/e2e.cjs
```
`e2e.cjs` writes screenshots to `scripts/ch02-ui-harness/shots/` (git-ignored) and exits non-zero on any failed check.
