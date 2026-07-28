---
name: bell24h-verify
description: Run, build, and verify Bell24h-OS. Use when starting the app, reproducing a bug, checking auth/session behaviour, auditing the production bundle for leaked secrets or the dev auth bypass, verifying Supabase/env wiring, or preparing Review Gate evidence. Read this BEFORE assuming the repo is Next.js, before assuming port 3000 is free, and before concluding "the app is broken" from an /api call.
---

# Verifying Bell24h-OS

Operational knowledge for this repo. Most of it is counter-intuitive and has caused
wrong conclusions before. Read the traps section first.

## Traps that produce wrong conclusions

**1. This is a Vite SPA, not Next.js.**
No `middleware.ts`, no `createServerClient`, no SSR, no auth cookies, no route handlers.
Sessions live in `localStorage` (`sb-<projectref>-auth-token`) via `supabase-js` defaults.
`NEXT_PUBLIC_*` variables are inert here — the code reads `VITE_SUPABASE_URL` /
`VITE_SUPABASE_KEY` only. Checklists written for Next.js auth do not apply.

**2. There is a second, confusable project.**
| | This repo | The other one |
|---|---|---|
| Path | `digitex-erp-bell24h-os` | `C:/Users/Sanika/Projects/bell24h` |
| Stack | Vite + React SPA | Next.js |
| Auth | Supabase email/password | MSG91 phone OTP |
| Backend | Supabase | INSFORGE + Prisma |
| Deployed | never | bell24h.com → vyaparsethu.com |

They share a name and nothing else. If you see MSG91, Razorpay, INSFORGE, Prisma, or
`VyaparSethu` in output, **you are looking at the wrong application.**

**3. Port 3000 is usually occupied by the other project's dev server.**
`npm run dev` hardcodes `PORT = 3000` (`server.ts:24`). It will appear to start
("Server running on http://0.0.0.0:3000") while the other process wins the connections.
Always check ownership before trusting anything served on 3000.

**4. `/api/*` on a bare Vite server proxies to port 3000.**
`vite.config.ts` sets `server.proxy['/api'] → http://localhost:3000`. If you run
`npx vite` while the other project holds 3000, every `/api` call returns *its* HTML and
you get `SyntaxError: Unexpected token '<'`. This is a routing artifact, **not** a broken
API. Verify the route exists in `server.ts` before reporting a defect.

## Running it

```bash
npm run lint     # tsc --noEmit
npm run build    # vite build → dist/ ; esbuild → dist/server.cjs
npm run dev      # tsx server.ts → express :3000 + vite middleware (full API)
```

Check who owns 3000 first:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 3000 |
  ForEach-Object { Get-Process -Id $_.OwningProcess | Select-Object Id,Name,StartTime }
```

If it is taken, do **not** kill it — it is likely the other project. Use alternate ports.
(`killall` does not exist in Git Bash on Windows; it silently no-ops.)

```bash
# SPA only — client-side verification. /api will misroute; that is expected.
npx vite --port 5199 --strictPort

# Production build, served as users would get it.
npx vite preview --port 5200 --strictPort --outDir dist
```

Poll rather than sleep:

```bash
for i in $(seq 1 10); do
  code=$(curl -s -m 3 -o /dev/null -w "%{http_code}" http://localhost:5199/ 2>/dev/null)
  [ "$code" = "200" ] && echo "up" && break
done
```

## Reading live client state

Browser automation is **`claude-in-chrome`**. Playwright is not installed — do not
plan around it. The extension is blocked on `aistudio.google.com` and other Google
domains (`[BLOCKED: Cookie/query string data]`, `Viewport: 0x0`); localhost is fine.

React state will not pick up `form_input` on controlled inputs — click the field and
`type`, then submit with `Enter`. Reading module state is more reliable than the DOM:

```js
const m = await import('/src/lib/supabase.ts');
JSON.stringify({ url: m.supabaseUrl, project: m.supabaseProjectId, configured: m.SUPABASE_CONFIGURED })

const s = await import('/src/store/useAuthStore.ts');
JSON.stringify({ bypass: s.AUTH_BYPASS, ...s.useAuthStore.getState() })
```

`/system/diagnostics` renders the active Supabase project ID on screen. This is the
fastest way to answer "which project is this build actually pointed at" — and it needs
no credentials.

## Environment configuration

The chain is: `.env` → `dotenv/config` → `process.env` → `vite.config.ts` `define` →
`import.meta.env.VITE_*` → `src/lib/supabase.ts`.

`vite.config.ts` **must** keep its `import 'dotenv/config'` first line. Vite does not
load `.env` into `process.env` on its own, and the `define` block reads `process.env`.
Without it, every production build bakes `placeholder.supabase.co` regardless of
configuration. Removing that import silently breaks all deployments.

Real credentials live only in **Google AI Studio Secrets**. They are not in the repo, not
in git history, not in Windows env, and not on Vercel (project
`digitex-erp-bell24h-os` has zero environment variables and zero deployments).

`.env` is gitignored (`.env*` with `!.env.example`). Safe to create for local testing —
delete it afterwards and confirm `git status` is clean.

## Auditing the production bundle

Always build first, then grep `dist/assets/*.js`.

```bash
npm run build
B=$(ls dist/assets/*.js)

# Dev auth bypass MUST be absent from production.
for m in "dev-user-id" "developer@bell24h.os" "Developer Admin" "Logout disabled"; do
  printf "  %-30s %s\n" "$m" "$(grep -o "$m" $B | wc -l)"
done

# Secrets MUST be absent.
grep -cE "eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}" $B

# Which Supabase project got baked in.
grep -oE "https://[a-z0-9]{15,25}\.supabase\.co" $B | sort -u
```

**Expect false positives** on `sk-ant-`, `AIzaSy`, `service_role`. All three are UI
strings — two are input `placeholder` attributes on the settings form, one is
`<code>service_role</code>` in migration help text. Always extract context before
reporting a leak:

```bash
grep -oE ".{90}sk-ant-.{90}" $B
```

`placeholder.supabase.co` appearing once is **normal** — it is a source-level fallback
constant, not evidence of misconfiguration. Judge configuration by whether the *real*
project ref is present, not by the placeholder's absence.

## The auth bypass

`AUTH_BYPASS = import.meta.env.DEV` (`src/store/useAuthStore.ts`). Dev auto-authenticates
as `Developer Admin`; production runs the real Supabase path. Verify **both** directions —
a bundle grep alone is not proof:

- dev: `/auth/login` must redirect to `/dashboard`
- prod (`vite preview`): `/dashboard` must redirect to `/auth` and render the login form

Treat this as temporary. If you touch `useAuthStore.ts`, `useAuth.ts`, or `App.tsx`,
re-run both checks before claiming anything about auth.

## Governance

`ENGINEERING_GOVERNANCE.md` is the authoritative constitution; `SECURITY_BASELINE.md`
and `ARCHITECTURE_DECISIONS.md` bind too. Rules that get violated most often:

- Every server API needs auth, authorization, input validation, and organization scope
- RLS is mandatory for tenant data — and is bypassed by any direct `DATABASE_URL` query
- All AI calls go through the AI Router (`AiProviderService`), never a provider SDK directly
- No hardcoded roles, statuses, users, or success results
- Work stays in sprint scope; missing prerequisites are recorded as blockers, not papered over

Do not certify a Review Gate on static inspection. Produce runtime evidence, and when a
prerequisite is genuinely unavailable, stop and name it rather than inferring success.

## Known open violations

Recorded at Review Gate C (`281c08a`). Verify before assuming still-open or fixed.

| Issue | Where | Severity |
|---|---|---|
| All 13 API routes unauthenticated | `server.ts` | Critical |
| Vault routes query Postgres via pooled `DATABASE_URL`, bypassing RLS | `server.ts:153+` | Critical |
| Unauthenticated Gemini endpoints, prompt built from request body, bypasses AI Router | `server.ts:223,264` | Critical |
| `role: 'ADMIN'` hardcoded for every user | `useAuth.ts:32,53` | High |
| `status: 'pass'` hardcoded for checks never performed | `SystemDiagnosticsPage.tsx:138,159,183` | Low |
| Password reset flow — `/auth/update-password` route now exists; verify end-to-end | `AuthPage.tsx` | Low |
