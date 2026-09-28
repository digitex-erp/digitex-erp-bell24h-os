# Communication Hub — PR Readiness

> **Superseded in part (2026-09-28, Sprint C0):** blockers B1, B2 and B3 below were fixed afterwards — see `COMMUNICATION_HUB_HARDENING_REPORT.md`. Everything else in this report (migration unapplied, no tests for providers live, daily cron, no real sends) is unchanged. Kept as the dated record of the state before C0.

**Date:** 2026-09-28. Read-only verification. Nothing modified, committed, pushed, deployed, or merged in this pass (this file is the only new artifact, left untracked).
**Branch:** `feature/communication-hub` @ `9709052` (pushed, tracks `origin/feature/communication-hub`).

## Verdict

**Type-checks and builds clean. NOT merge-ready.** No check *failed*, but the review found 3 security blockers, no tests, and a scope surprise in the diff (see §4, §7). Suitable to open as a **draft PR for review**; not to merge or deploy until the blockers below are resolved.

## 1. Git state

- Working tree: tracked files clean. Untracked (deliberately withheld from push): `GITHUB_PURGE_REQUEST.md`, `ORG_WIDE_COMMIT_VERIFICATION.md`, `SSH_KEY_EXPOSURE_REPORT.md`.
- `feature/communication-hub` is in sync with its remote.
- **`origin/main` is at `a0fd612`; local `main` is at `bb72913` (3 commits ahead of origin, never pushed).** So `origin/main...HEAD` is **5 commits, not 2**:
  - `65fdb24` fix(workers): remove fabricated success paths (P0 remediation)
  - `42747e8` feat(workers): serverless-safe worker activation via cron tick (P0 remediation)
  - `bb72913` Merge feature/p0-remediation
  - `a5c0a3b` Communication Hub
  - `9709052` docs bundle
- 31 files, +3191 / −115. Beyond the hub and docs, the diff includes P0-remediation changes: `server/middleware/requireCronAuth.ts` (new), `MediaJobHandler.ts` (−116 net), `PublishingJobHandler.ts`, `vercel.json` (cron entry), the `/api/v1/workers/tick` route and `processBatch()` in `server.ts` / `WorkerRegistry.ts`. Nothing else unexpected.

## 2. Implementation classification

| # | Component | Status | Evidence |
|---|---|---|---|
| 1 | CommunicationService | **IMPLEMENTED** | send, bulk, schedule, cancel, status, retry. Bulk is sequential (unoptimized, self-documented). |
| 2 | Provider abstraction | **IMPLEMENTED** | `ProviderAdapter` interface + `ProviderFactory` registry; secrets resolved from `process.env`. |
| 3 | Resend adapter | **IMPLEMENTED** | send/status/validate/healthCheck via `fetch`. Never exercised against the real API. |
| 4 | SMTP adapter | **IMPLEMENTED (untested, see blocker B2)** | Hand-rolled SMTP over `net`/`tls`, STARTTLS, AUTH LOGIN. |
| 5 | MSG91 | **STUB** | `send/status/healthCheck` throw; `validate` returns invalid. |
| 6 | Meta WhatsApp | **STUB** | same |
| 7 | Twilio | **STUB** | same |
| 8 | NotificationService | **MISSING** | No such file or class in repo. |
| 9 | CampaignEngine | **MISSING** | Only the `communication_campaigns` table + `campaign_id` column; no engine. |
| 10 | AnalyticsService | **MISSING** | none |
| 11 | CommunicationJobHandler | **IMPLEMENTED** | Priority-ordered provider failover, per-attempt delivery rows, cancel check, dead-letter prediction. |
| 12 | API routes | **PARTIAL** | 6 routes: send, templates GET/POST, history, status/:id, retry/:id. **No** routes for cancel, schedule, bulk, providers, campaigns, or webhooks (service methods exist but are unexposed). |
| 13 | SQL migration | **IMPLEMENTED, NOT APPLIED** | 6 tables, indexes, org-scoped RLS; deliveries/webhooks append-only. Not run against any database. |
| 14 | Audit logging | **IMPLEMENTED** | `emitAuditEvent` on enqueue/schedule/cancel/retry and worker sent/failed/dead-lettered. |
| 15 | Retry handling | **IMPLEMENTED** | Reuses `job_queue` retry/dead-letter; manual retry route (failed/dead_letter only → 409 otherwise). |
| 16 | Delivery tracking | **PARTIAL** | Send-attempt tracking works. `communication_webhooks` is schema only: no receiver, so `delivered`/bounce states never occur. |

## 3. Security

Every route uses `requireAuth`; `organizationId` comes from the verified token, never the body. Every service/handler query filters `organization_id`. No credential values are logged or returned; only the secret's *name* is stored or shown in errors.

| Area | Result |
|---|---|
| API authentication | **PASS** — `requireAuth` on all 6 routes; fail-closed. |
| Organization boundary | **PASS (app layer)** — all queries scoped by `organization_id`. |
| RLS | **PARTIAL** — policies present on all 6 tables, but the server uses a pooled `DATABASE_URL` connection, so isolation rests on the app-layer `WHERE`, not RLS. RLS still matters for any direct Supabase-client access (see B1). |
| Provider secrets | **FAIL — B1** |
| Credential logging | **PASS** |
| Rate limiting | **FAIL — B3** — send route has none; the existing `rateLimit` middleware is unused here, and it is an in-memory Map (per serverless instance). |
| Webhook security | **N/A** — no receiver exists. Must be signature-verified when built. |
| Idempotency | **FAIL** — `/send` has no idempotency key (the generic job route has one). Client retry = duplicate email. Worker can also re-send if it crashes after the provider call but before completion; the handler doesn't skip already-`sent` messages. |

### Blockers

- **B1 — Secret-ref indirection is exploitable.** `ProviderFactory.resolveSecret()` reads `process.env[credentials_secret_ref]` with a value taken from a database row, and the RLS INSERT policy lets a tenant write their own `communication_providers` row. A tenant with direct table access could set `credentials_secret_ref` to any server env var name (e.g. the DB URL or a service key) and `provider='smtp'` with an attacker-controlled `host`; the worker would then send that value as the SMTP AUTH password. Fix: allowlist secret names (e.g. `COMM_*` prefix) and restrict provider writes to the service role or a server route. Confirm whether the `authenticated` role has INSERT on this table before/after applying the migration.
- **B2 — CRLF / SMTP command injection.** `SMTPProvider` interpolates `recipient` and `subject` unescaped into `RCPT TO:<…>` and header lines. `/api/communications/send` does no validation of either. Fix: reject `\r`/`\n` and validate recipient format at the route and in the adapter. (Resend path is JSON-encoded, not affected. Its `html: body` is unsanitized HTML from the caller.)
- **B3 — Open relay for any authenticated org user.** No role check, rate limit, or recipient controls on `/send`; combined with B2 and no idempotency, this is an easy spam/abuse path once a real provider is configured.

### Lesser issues
- `channelType` isn't validated in the route; an invalid value hits the DB CHECK and returns **500** with the raw error text (`err.message` is returned to clients on all routes).
- `retry` can leave a message `queued` while an older job still exists; low risk.

## 4. Tests and build

| Check | Result |
|---|---|
| `npm run typecheck` | **Script does not exist** in `package.json` (not added). |
| `npm run lint` (= `tsc --noEmit`, the repo's type check) | **PASS**, exit 0, no errors |
| `npm run build` (vite + esbuild server bundle) | **PASS** — `dist/server.cjs` 147 kB; only the existing >500 kB client chunk warning. `dist/` is gitignored. |
| Communication Hub tests | **None exist.** The only test file is `smoke_test.ts`, which has 0 references to communication. Zero automated coverage of send, failover, retry, or org isolation. |

## 5. Provider gate

| Provider | Status |
|---|---|
| Real Meta WhatsApp | **NOT IMPLEMENTED** (stub; throws on send) |
| Real MSG91 | **NOT IMPLEMENTED** (stub; throws on send) |
| Real Twilio | **NOT IMPLEMENTED** (stub; throws on send) |

Blocked pending provider credentials and Gate D.1 approval. Resend and SMTP are the only functional adapters and have never been run against a live service. No real send was triggered in this review.

## 6. Migration, deployment, rollback

- **Migration:** `add_communication_hub.sql` is **unapplied** anywhere. It needs `uuid-ossp`, `get_current_org_id()`, and existing `organizations`, `profiles`, `job_queue` tables (all defined elsewhere in the repo). Apply manually per the repo's manual-SQL workflow, in staging first. Additive only (`CREATE TABLE IF NOT EXISTS`); policies are not `IF NOT EXISTS`, so re-running errors.
- **Deployment:** none. Not deployed. Merging to `main` may auto-deploy via Vercel, so don't merge before the migration and blockers are handled.
- **Cron limitation:** `vercel.json` runs `/api/v1/workers/tick` once daily (`0 0 * * *`). Queued messages, including "high" priority sends, may wait up to ~24h in production. Real-time sending needs a more frequent scheduler or an external trigger. Also requires `CRON_SECRET` in env.
- **Rollback:** code — revert the two hub commits (and P0 commits if they're bundled). Schema — `DROP TABLE` the 6 `communication_*` tables (deliveries → messages → campaigns/templates/providers order, webhooks first); no existing tables are altered. `job_queue` rows with `job_type='communication'` would need cancelling; the worker throws "No worker handler" for that type after revert.

## 7. Known limitations
- No provider-management, cancel, schedule, bulk, campaign, analytics or webhook endpoints; no NotificationService/CampaignEngine/AnalyticsService.
- Delivery states beyond `sent` are unreachable without webhooks.
- Template variables: simple `{{var}}` substitution only; no HTML escaping.
- `send` stores full message body in `communication_messages`.
- PR scope includes the 3 unpushed P0-remediation commits (see §1).

## 8. Suggested PR command (NOT run)

Draft PR against `main`. Note this will include the P0-remediation commits because local `main` was never pushed; if you prefer a hub-only diff, push `main` first (separate decision) and the PR will shrink to 2 commits.

```bash
gh pr create --draft --base main --head feature/communication-hub \
  --title "feat(communication): Communication Hub foundation (service, providers, worker, schema)" \
  --body-file COMMUNICATION_HUB_PR_READINESS.md
```
