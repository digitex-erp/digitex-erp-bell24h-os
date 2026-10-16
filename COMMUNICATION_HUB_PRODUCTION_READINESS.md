# Communication Hub — Production Readiness (live audit)

> **Superseded in part (2026-09-28, Sprint C0):** blockers B1, B2 and B3 below were fixed afterwards — see `COMMUNICATION_HUB_HARDENING_REPORT.md`. Everything else in this report (migration unapplied, no tests for providers live, daily cron, no real sends) is unchanged. Kept as the dated record of the state before C0.

**Date:** 2026-09-28. Every fact below was re-derived from live commands in this pass (git, gh, tsc, build, grep). No prior report was used as evidence. Audit only: no code modified, nothing committed, nothing pushed. This file is the only artifact created (untracked).

## Verdict

**NOT production-ready.** Builds and type-checks clean, but: not merged, no PR, migration status unverifiable and presumed unapplied, 3 open security blockers, no tests, no real-time worker trigger, and zero real provider ever exercised.

## 1. Git status

Branch `feature/communication-hub` @ `9709052`, tracking `origin/feature/communication-hub`.

| Item | Live result |
|---|---|
| Uncommitted tracked changes | **4 files**: `ARCHITECTURE_DECISIONS.md`, `add_communication_hub.sql`, `ProviderFactory.ts`, `StubProviders.ts` (+26 / −15). This is the Twilio-removal + provider-decision edit; **not committed**. |
| Untracked | `COMMUNICATION_HUB_PR_READINESS.md`, `COMMUNICATION_HUB_PRODUCTION_READINESS.md` (this file), and 3 security reports deliberately never pushed (`GITHUB_PURGE_REQUEST.md`, `ORG_WIDE_COMMIT_VERIFICATION.md`, `SSH_KEY_EXPOSURE_REPORT.md`). |
| `origin/main` | `a0fd612` |
| local `main` | `bb72913`, **3 commits ahead of origin/main, unpushed** |

Commits on the branch not in `origin/main` (5):
`65fdb24` P0 fix (fabricated success removal) · `42747e8` P0 cron worker tick · `bb72913` merge of p0-remediation · `a5c0a3b` Communication Hub · `9709052` docs bundle. The first three are P0-remediation work that exists on `feature/p0-remediation` on origin but not in `origin/main`.

## 2. Push status

- Remote branch exists at `9709052`; local HEAD = remote HEAD; ahead/behind **0 / 0**. **All commits are pushed.**
- **Unpushed *work*: the 4 modified files above** (uncommitted, so not on GitHub).
- **PR status: none.** `gh` is authenticated (`digitex-erp`); `gh pr list --state all` on the repo returns **zero PRs of any state**. Not merged.

## 3. Build and TypeScript (run live, on the working tree incl. uncommitted edits)

| Check | Result |
|---|---|
| `npx`/`npm run lint` (`tsc --noEmit`) | **PASS**, exit 0 |
| `npm run build` (vite + esbuild) | **PASS**, exit 0; `dist/server.cjs` 146.8 kB; only the pre-existing >500 kB client chunk warning |
| `npm run typecheck` | script does not exist (`lint` is the type check) |
| Tests | Only `smoke_test.ts` exists, with no Communication Hub coverage. **No hub tests.** |

## 4. Database migration status

**UNVERIFIED — cannot be confirmed from this repo, presumed NOT applied.**
- `add_communication_hub.sql` exists only as a file; the repo has no applied-migration ledger. `run_migration.cjs` is a generic runner needing `DATABASE_URL` (not set in this shell; I did not read `.env` or connect to any database, per the repo's manual-SQL workflow).
- Nothing in the running code proves the 6 tables exist. Until they do, `/api/communications/*` fail with "relation does not exist" (500).
- To verify, run this single read-only query in your SQL editor and paste the result:

```sql
SELECT t AS table_name, to_regclass('public.' || t) IS NOT NULL AS exists
FROM unnest(ARRAY['communication_providers','communication_templates','communication_campaigns',
                  'communication_messages','communication_deliveries','communication_webhooks']) AS t;
```

## 5. Communication Hub status

| Component | Status |
|---|---|
| CommunicationService (send/bulk/schedule/cancel/status/retry) | Implemented |
| ProviderFactory + `ProviderAdapter` abstraction | Implemented |
| Resend adapter | Implemented, never run live |
| SMTP adapter (hand-rolled, `net`/`tls`) | Implemented, never run live; injection risk (B2) |
| Meta WhatsApp (`meta_whatsapp`) | **STUB** (send throws) |
| MSG91 (`msg91`, SMS) | **STUB** (send throws) |
| CommunicationJobHandler (failover, delivery rows, dead-letter) | Implemented |
| API routes | **6 only**: send, templates GET/POST, history, status/:id, retry/:id |
| Webhook receiver | **None** (0 webhook references in `server.ts`) |
| Provider-management / cancel / schedule / bulk / campaign routes | **None** |
| NotificationService / CampaignEngine / AnalyticsService | **Do not exist** |
| Frontend | `CommunicationsPage.tsx` is a placeholder |

## 6. Provider decision verification

Requested state: ACTIVE = Resend, SMTP, Meta WhatsApp Cloud API. REMOVED = Twilio, MSG91 WhatsApp.

- **Twilio — no functional references.** Case-insensitive search of all `.ts/.tsx/.js/.json/.sql` (tracked + untracked, excluding lockfile) finds exactly **1 hit**: a comment in `StubProviders.ts:19` stating Twilio is removed. No class, registry entry, import, env var, or SQL reference remains. Markdown docs still mention Twilio (historical Sprint B / Gate D.1 / architecture docs), and my added-lines diff shows those doc mentions were added in this branch's commits, but as plans, not code.
- **MSG91 WhatsApp — no code path exists.** The registry maps `msg91` to an SMS-only stub (`channelType: "sms"`); nothing routes WhatsApp through it.
- **Stale user-facing text:** `src/pages/CommunicationsPage.tsx:11,56` still says "WhatsApp (**Meta/MSG91**)". This is pre-existing copy (not added by this branch) and contradicts the decision. Cosmetic, but should be corrected.
- **Discrepancy to resolve:** the requested ACTIVE list omits **MSG91 SMS**, while the earlier owner decision includes it (SMS + OTP = MSG91), and the registry currently has `msg91`. I treated MSG91 SMS as active. Confirm.

## 7. Production blockers (each re-verified live)

| # | Blocker | Live evidence |
|---|---|---|
| B1 | **Env-var indirection can exfiltrate secrets.** Worker resolves `process.env[credentials_secret_ref]` from a DB row a tenant can insert (RLS INSERT policy is org-scoped, not admin-only); no allowlist. | `ProviderFactory.resolveSecret` reads any env name; grep for allowlist/prefix check: none. |
| B2 | **SMTP CRLF/command injection** via `recipient` / `subject`. | Interpolated raw into `RCPT TO:<…>` and `Subject:`; no validation in route, service, or adapter. |
| B3 | **No abuse controls on `/send`**: no rate limit (0 of 6 routes use `rateLimit`), no role check, no idempotency key (0 hits in hub code); handler doesn't skip already-`sent` messages (duplicate send risk on crash/retry). | grep results above. |
| B4 | **Migration unapplied/unverified** (§4). | — |
| B5 | **Worker only runs daily.** `vercel.json` cron `0 0 * * *` on `/api/v1/workers/tick`; "immediate" sends can wait ~24 h; needs `CRON_SECRET`. | `vercel.json`. |
| B6 | **No credentials/providers configured.** `RESEND_API_KEY`, `CRON_SECRET`, `DATABASE_URL` not set in this shell (`.env` exists; contents not inspected). No `communication_providers` rows can be created via the API (no provider route), so an operator must insert rows by SQL. | — |
| B7 | **No tests.** Zero coverage of send, failover, retry, org isolation. | test file listing. |
| B8 | **Nothing merged; PR scope includes 3 unpushed-to-main P0 commits.** | §1–2. |
| B9 | No delivery confirmation: no webhook receiver, so status never reaches `delivered`; bounces invisible. | 0 webhook refs. |

Also: error text (`err.message`) is returned to clients on all routes; invalid `channelType` yields 500 rather than 400; no HTML escaping of template variables in email bodies.

## 8. Missing work

1. Fix B1–B3 (secret-name allowlist + service-role-only provider writes; input validation incl. CR/LF rejection and address checks; rate limit + idempotency key + already-sent guard + role check).
2. Commit the 4 pending edits; decide PR base (push `main` first for a hub-only diff, or accept the 5-commit PR).
3. Apply migration in staging and verify (§4 query).
4. Add tests: service, handler failover/retry/dead-letter, org isolation, adapter injection cases.
5. Provider management route (service-role gated), cancel/schedule/bulk routes.
6. More frequent worker trigger (or external scheduler) and a `CRON_SECRET`.
7. Webhook receiver with signature verification (Resend and Meta), populating `communication_webhooks` and advancing message status.
8. Real Meta Cloud API adapter (Sprint C1) and MSG91 SMS adapter (Sprint C2) — gated by Gate D.1: real credentials + outbound abuse/rate-limit design.
9. Fix stale `CommunicationsPage.tsx` "Meta/MSG91" copy; build the actual UI.
10. Live smoke test of Resend and SMTP with a real test recipient (after approval).

## 9. Recommended next sprint

**Sprint C0 — Harden the foundation (before C1/C2).** Order:
1. Commit the pending edits.
2. B1, B2, B3 fixes with tests (small, contained, server-side only).
3. Apply the migration to staging; run the §4 verification query.
4. Live Resend send to an owner-controlled address; set `CRON_SECRET`; more frequent tick.
5. Decide PR base and open a draft PR.

Then Sprint C1 (Meta Cloud API) once credentials exist and outbound rate-limit design is done, then C2 (MSG91 SMS), then the RFQ Matching Engine. Starting C1 before C0 would put a per-message-cost provider behind an unprotected, injectable send route.
