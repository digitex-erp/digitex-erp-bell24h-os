# CH-02 Independent Verification Addendum

**Date:** 2026-09-28 · **Branch checked:** `sprint/ch-02-campaigns` @ `db3862c` · **Author:** a second, independent session · **Status of this file:** untracked; nothing was committed, pushed, migrated or deployed.

This addendum does not replace `CH02_IMPLEMENTATION_REPORT.md`. It re-checks that report's claims with fresh commands and adds facts the report listed as unknown. **Nothing was rebuilt**: the CH-02 code was already written, and 315 tests plus a 63-check browser harness had already run on it.

## 1. Corrections to the premises of the latest brief

| Claim in the brief | What is actually true (verified today) |
|---|---|
| "Communications Hub FD1 certified" | **Not certified.** The report says so, and the database agrees: **none of the `communication_*` tables exist** in the database `DATABASE_URL` points to (checked: providers, messages, deliveries, templates, campaigns, campaign recipients, suppressions, lists, segments all absent). The Hub has never sent a real message. |
| "Communication Hub code committed and pushed" | **Only partly.** `feature/communication-hub` (Hub service, providers, worker handler, hardening) is pushed at `bd3b8af`. **The four CH-02 commits (`7346130`, `be9070e`, `361a0f6`, `db3862c`) exist only on the local branch `sprint/ch-02-campaigns`.** It is not on GitHub and has no PR. |
| "Resend Email = Ready, SMTP = Ready" | Code exists for both, but neither has been verified with a real send, and the required secrets (`RESEND_API_KEY`, SMTP settings, `COMM_UNSUBSCRIBE_SECRET`, `COMM_PUBLIC_BASE_URL`) are not in the local `.env` (only `DATABASE_URL`, `SUPABASE_*` and `VITE_SUPABASE_*` are set). |
| "Campaign Manager / Analytics / Segmentation / Suppression / Templates: Not Built" | **Built** on the CH-02 branch (code complete, test-verified), **but not applied to any database and not deployed**. |

## 2. Independent re-verification

| Claim in the report | Re-run today | Result |
|---|---|---|
| `npx tsc --noEmit` passes | Re-ran (91 s) | **Pass, exit 0** |
| `npm test`: 315/315, 86 suites | Re-ran (55 s) | **Pass: 315 tests, 86 suites, 0 failed, 0 skipped** |
| Branch is local only | `git ls-remote` | **Confirmed**: `sprint/ch-02-campaigns` not on origin; 4 commits ahead of `origin/feature/communication-hub` |
| Working tree | `git status` | No tracked modifications; 4 untracked report files |
| `npm run build`, 63-check browser harness | **Not re-run** | Not independently verified |

## 3. Facts the report listed as unknown, now checked (read-only; catalog queries and aggregate counts only)

1. **Which database role `DATABASE_URL` uses:** `postgres`, `rolsuper = false`, **`rolbypassrls = true`**. The server's pooled connection therefore **bypasses row-level security**. Organisation isolation on server-written data depends entirely on the application code (the report's "tenants read, server writes" model is confirmed; do not treat RLS as a safety net on this path).
2. **Knowledge Vault "Could not load documents": the database side is healthy.** All five vault tables exist; RLS is on with a `Public Read Access` policy; `anon` and `authenticated` both have `SELECT`; every column the routes order by exists (`last_updated`, `sort_order`, `id`, `created_at`); a PostgREST GET as the public anon key returns **HTTP 200 with rows for all five tables**; `vault_documents` holds 4 rows. **So the cause is not missing tables, permissions or schema.** What remains is the deployed server's environment (`SUPABASE_URL` / key on Vercel) or the caller's token. The definitive check is the new `/api/vault/health` endpoint, which needs the CH-02 build deployed. Vercel env-var names could not be read (403).
3. **A defect in the report's diagnostic SQL:** the query in §3 #1 fails on this server with `operator is not unique: text || "char"`. Cast `polcmd` to text: `p.polname::text || ' (' || p.polcmd::text || ')'`. Everything else in the query works.
4. **Industry Intelligence blank page: root cause found.** The page queries `industries` and renders nothing on an empty result and nothing on failure (`.then(setIndustries)` with no error handling, no empty state). **All four industry tables (`industries`, `industry_categories`, `industry_subcategories`, `industry_products`) contain 0 rows**, so the page shows only its title. Fix needs (a) a decision on the data to seed, and (b) an empty/error state in the page. (The tables and org-isolation RLS policies exist; anon reads return 0 rows by design.)
5. **Campaigns cannot run yet even with everything else in place:** `contacts` has **0 rows**; `organizations` has 1; `job_queue` has 1.
6. **The Vercel cron is daily:** `vercel.json` schedules `/api/v1/workers/tick` at `0 0 * * *`. At 5 jobs per tick that is 5 messages a day, which is why the InsForge one-minute schedule (report §4) is still required. The InsForge schedule count remains 0 per the report; not re-checked (the CLI was not run).

## 4. What is complete, pending and blocked (delta from the report)

| Item | Status |
|---|---|
| Campaign engine, templates (edit + lock), lists, segments, suppression + unsubscribe, analytics, admin console, diagnostics hardening, scheduler certifier | **Code complete; typecheck and 315 tests re-verified.** Not applied to a database, not deployed, not pushed |
| Knowledge Vault fix | **Undetermined but narrowed** (not database, not PostgREST, not schema). Needs the deployed `/api/vault/health` result |
| Industry Intelligence blank page | **Diagnosed** (0 rows, no empty state). Not fixed |
| AI Providers 0/6 | Needs credentials |
| Real send, scheduler certification, migration application | **Blocked** (see §5) |

**Ready for production: nothing.**

## 5. Decisions needed (not taken here)

1. **Push `sprint/ch-02-campaigns` and open a PR?** Not done.
2. **Apply `add_communication_hub.sql` then `add_communication_campaigns.sql`?** Not done. Note: the only database configured locally appears to be the one Supabase project the app uses (1 organisation). If that is production, the report's "apply in staging first" needs a staging database that does not appear to exist yet.
3. **Meta WhatsApp:** keep the real adapter as built, or revert to an interface-only stub (report §3 #6, §10 #2).
4. **MSG91:** remove the SMS/OTP stub from the registry, or keep it (report §10 #3).
5. **Industry Intelligence:** what data seeds `industries` (a decision, plus a write to the database).
6. **Vault:** deploy the CH-02 diagnostics (or read the deployed env) to learn the real cause.

## 6. Suggested order

1. Answer decisions 1–4. 2. If yes to pushing: push the branch and open a PR (no database change). 3. Provision a **staging** Supabase project, then apply the two migrations there. 4. Set the secrets by name (`RESEND_API_KEY`, `COMM_UNSUBSCRIBE_SECRET`, `COMM_PUBLIC_BASE_URL`, `CRON_SECRET`), insert a provider row, create the InsForge schedule, run `certify-scheduler.ts`. 5. Send a test to an address you own. 6. Fix the Industry page empty state and seed data. 7. Only then consider marketing automation.
