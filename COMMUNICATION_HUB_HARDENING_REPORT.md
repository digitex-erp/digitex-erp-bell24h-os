# Communication Hub — Sprint C0 Hardening Report

**Date:** 2026-09-28 · **Branch:** `feature/communication-hub` · **Scope:** fix B1, B2, B3 from `COMMUNICATION_HUB_PR_READINESS.md`. No provider-strategy change; no real provider sends; nothing deployed; migration **not applied to any database**.

## Result

| Gate | Result |
|---|---|
| `npm test` (new) | **110 / 110 pass**, 31 suites, ~7 s, 0 skipped |
| `npx tsc --noEmit` | **PASS**, exit 0 |
| `npm run build` | **PASS**, exit 0 (`dist/server.cjs` 163 kB; the pre-existing >500 kB client-chunk warning only). Test-only dependency `pglite` is **not** in the server bundle. |
| B1, B2, B3 | **Fixed in code and migration, verified by tests**, with the residual risks listed in §6. |

The tests were checked to be able to fail (§4): restoring the original SMTP adapter, the original migration, or removing the B1 allowlist each makes the relevant tests fail.

## 1. B1 — arbitrary environment-variable access

**Two independent holes, both closed** (an allowlist alone would not have closed it):

1. **Secret-name allowlist** (`server/communication/providers/ProviderFactory.ts`). `credentials_secret_ref` comes from a database row, so it is untrusted. It is now matched against a *per-provider* pattern before `process.env` is read: `RESEND_API_KEY | COMM_RESEND_*`, `SMTP_PASSWORD | COMM_SMTP_*`, `META_WHATSAPP_ACCESS_TOKEN | COMM_META_*`, `MSG91_AUTH_KEY | COMM_MSG91_*`. `DATABASE_URL`, service keys, `CRON_SECRET`, another provider's credential, lowercase/whitespace/newline variants, and prototype keys (`__proto__`, `constructor`) are all refused. The refusal message does **not** echo the requested name (it is attacker-controlled and gets persisted to `communication_deliveries.error_message`). Provider lookup also uses own-property checks so `constructor`/`toString` don't resolve.
2. **Tenants can no longer write provider rows** (`add_communication_hub.sql`). This is the half the allowlist cannot cover: provider secrets are shared server env vars, so a tenant could still insert `provider='smtp'`, `credentials_secret_ref='SMTP_PASSWORD'`, `settings.host=<attacker>` and the worker would send the real SMTP password to the attacker's host. `communication_providers` now has **no tenant policy and no `anon`/`authenticated` privileges**. Provider rows are operator-managed (service-role SQL).

SMTP `host`/`port`/`fromAddress` from settings are also validated (hostname syntax, port range) so a bad row cannot smuggle protocol text or a `host:port` pair.

## 2. B2 — SMTP CRLF / header injection

New `server/communication/validation.ts`. Policy is **reject, never strip** (stripping could deliver to an address the caller did not name). Applied at three layers: HTTP route (400), `CommunicationService` (before storage), and each adapter (before any socket opens).

- **recipient**: strict addr-spec; any control character (CR, LF, NUL, ESC, U+2028/2029), `<>`, whitespace, `,`, `;`, quotes, backslash → rejected. SMS/WhatsApp recipients must be E.164.
- **subject**: no control characters, ≤200 chars; non-ASCII is RFC 2047-encoded so the header stays one ASCII line.
- **headers**: built only from validated values; `MIME-Version` added.
- **body**: every CR / LF / CRLF normalized to CRLF before dot-stuffing (bare CR/LF is the SMTP-smuggling vector).
- **Template variables** are validated *after* substitution, so `{{name}}` = `"A\r\nBcc: x"` cannot reintroduce an injection.
- Resend gets the same validation for consistency (its JSON body was not injectable).

## 3. B3 — access control, quotas, idempotency, rate limiting

**Role-based access control** (`server/communication/rbac.ts`). Nothing in `server/` read `roles`/`user_roles` before this, so this is new infrastructure and **the mapping below is a decision I made, not a pre-existing convention** — please confirm or change it (role names come from `activate_vyaparsethu_root_org.sql`):

| Permission | Roles | Routes |
|---|---|---|
| send | ADMIN, MANAGER | `POST /send`, `POST /retry/:id` |
| write | ADMIN, MANAGER, EDITOR | `POST /templates` |
| read | ADMIN, MANAGER, EDITOR, VIEWER | templates, history, status |

Fails **closed**: a role-lookup error → 503; no role in the org → 403; a role assignment belonging to a different org does not count. Order is `requireAuth → role → rate limit → handler`, role *before* limiter so a VIEWER cannot burn the org's send budget with requests that would be refused anyway.

**Organization quotas.** Rolling 24 h, per organization *and* channel, counted from `communication_messages` (DB-backed, so correct across serverless instances). Defaults email 1000 / sms 200 / whatsapp 500, overridable with `COMM_QUOTA_<CHANNEL>_PER_DAY`; `0` disables a channel; a malformed override falls back to the default and can never disable the limit. Exceeding → `429 quota_exceeded` + `Retry-After`. Enforced inside a transaction under a per-(org, channel) advisory lock. Cancelled messages don't count; idempotent replays don't count. Manual retry is additionally capped at `max_retries` (3).

**Idempotency.**
- API: `Idempotency-Key` header is **required** on `/send` (a decision: no client exists yet, and optional keys leave the duplicate-send hole open). Same key + same payload → `200` with the original message, `Idempotent-Replay: true`, one row, one job. Same key + different recipient/channel → `422`. Scoped per organization. Backed by a unique index `(organization_id, idempotency_key)`.
- Crash recovery: a stored message with no job (crash between INSERT and enqueue) gets its job on replay. Enqueue is itself keyed (`comm-msg:<id>:<retry_count>`).
- **Worker (the second, separate duplicate-send path):** `CommunicationJobHandler` now skips messages already `sent`/`delivered`, and passes a stable idempotency key to the provider (Resend `Idempotency-Key` header).

**Rate limiting.** Existing per-org `rateLimit` middleware now applied: send 20/min, retry 10/min, template writes 30/min (env-overridable).

**Also:** channel restricted to approved `email | sms | whatsapp`; query params validated (no arrays / unknown enums); UUID path params checked (404 not 500); internal error text is never returned (stable `internal_error` + `requestId`); routes extracted from `server.ts` into `server/communication/routes.ts`.

**Tenant direct-write lockdown (bypass prevention).** Role checks, quotas and validation are meaningless if a tenant can `INSERT` into `communication_messages` through the Supabase client. Tenants are now read-only (RLS `SELECT` + privilege `REVOKE`) on messages, campaigns, deliveries, webhooks. Templates stay tenant-writable (no outbound effect; role-checked in the API; content re-validated at send).

## 4. Tests

Runner: **`node:test` via `tsx`** (`npm test`) — zero new runner dependency; there was no test script before (`smoke_test.ts` is a manual script needing a live DB). One new **devDependency**: `@electric-sql/pglite` (in-process Postgres) so integration tests run the **real** migration, the **real** `job_queue` DDL, real `QueueManager` and real SQL rather than a mock that agrees with the code.

| File | Tests | Covers |
|---|---:|---|
| `validation.test.ts` | 21 | email/subject/phone/channel/key/host/port validators, CRLF corpus, quota config |
| `providers.test.ts` | 20 | **provider validation**: allowlist matrix, no env read on denial, no name echo, registry = exactly resend/smtp/meta_whatsapp/msg91 (Twilio etc. don't resolve), stubs throw, Resend/SMTP settings validation, Resend idempotency header |
| `smtp.wire.test.ts` | 7 | mock SMTP server records bytes: injection rejected with **zero connections**, smuggling, encoding |
| `migration.test.ts` | 10 | real SQL applies + re-applies; tenant INSERT into providers/messages **denied by the DB**; org-scoped RLS reads; unique idempotency index |
| `routes.integration.test.ts` | 41 | **integration**: real routes over HTTP + real SQL: 401s, RBAC matrix (incl. cross-org role), validation, idempotency (replay, reuse 422, concurrent, crash recovery), quotas (per org/channel/window, cancel frees slot, replay at limit), rate limits, org isolation, retry cap, no error leakage |
| `handler.test.ts` | 11 | worker: already-sent skip, exactly-once on re-run, allowlist at runtime, failover, dead-letter, org boundary |
| **Total** | **110** | |

**Tests can fail (mutation checks, run and restored):**
- Original `SMTPProvider.ts` restored → 4 of 7 wire tests **fail** (recipient injection, subject injection, encoding, bare CR).
- Original `add_communication_hub.sql` restored → 8 of 10 migration tests **fail** (this also confirms the original tenant-INSERT exploit was real).
- Allowlist line removed from `resolveSecret` → 4 provider/handler tests **fail**.

Two test-harness bugs were found and fixed along the way (pool `rowCount` semantics for SELECT; hook ordering) — both were in the test scaffolding, not the product code.

## 5. Files

New: `server/communication/{validation,rbac,routes}.ts`, `server/communication/__tests__/*` (6 test files + `helpers/testDb.ts`).
Modified: `CommunicationService.ts`, `types.ts`, `ProviderFactory.ts`, `ResendProvider.ts`, `SMTPProvider.ts`, `StubProviders.ts` (Twilio stub removed, per the provider decision), `CommunicationJobHandler.ts`, `server.ts` (inline routes → `registerCommunicationRoutes`), `add_communication_hub.sql`, `.env.example` (names only, no values), `package.json` / `package-lock.json`, `ARCHITECTURE_DECISIONS.md`.

## 6. Residual risks and things NOT done (read before merging)

1. **Migration still unapplied/unverified against a real database.** The tenant lockdown only takes effect once `add_communication_hub.sql` runs. It is re-runnable (verified on PGlite twice). Run it in staging first; it assumes Supabase-style `anon`/`authenticated` roles (guarded, so it also runs without them).
2. **Roles must exist in production.** RBAC fails closed: an org with no `user_roles` rows gets 403 on everything. I did not query production `roles`; the names are taken from the seed SQL and compared case-insensitively.
3. **Provider rows have no API** — operators insert them by SQL. There is still no provider-management route.
4. **Concurrency is logically tested, not race-tested.** PGlite is a single connection (my pool adapter serializes it). The advisory lock that makes quota "count then insert" safe was not exercised under real parallel contention.
5. **Rate limiter is in-memory, per instance** (existing middleware's documented limitation). The quota is DB-backed and cross-instance; the per-minute limiter is not.
6. **Crash-window duplicate for SMTP.** If the process dies after SMTP accepts the message but before the status write, a lock-expiry reclaim re-sends: SMTP has no provider-side idempotency. Resend gets an `Idempotency-Key` header; I did not verify its behavior against the live API.
7. **Not addressed (out of scope):** email HTML is not escaped/sanitized (template variables can inject markup); SMTP STARTTLS is opportunistic (downgrade possible); the pre-existing `job_queue` policy still lets a tenant insert/update job rows directly — with messages now locked they cannot create sendable messages, but that policy deserves its own review.
8. **Worker still runs on a once-daily cron** (`vercel.json`); queued sends can wait ~24 h. Unchanged from the readiness report (B5).
9. **No real send has ever been made** — Resend/SMTP remain unexercised against live services; Meta WhatsApp and MSG91 remain stubs (Sprints C1/C2).
10. **Breaking API change:** `Idempotency-Key` is now required on `POST /send`; `channelType` is restricted to `email|sms|whatsapp`. No known client exists (the frontend page is a placeholder).
11. **PR scope:** `origin/main` is 3 commits behind local `main`, so a PR from this branch also carries the P0-remediation commits.

## 7. Provider strategy (unchanged, verified)

Registry = `resend`, `smtp`, `msg91` (SMS/OTP stub), `meta_whatsapp` (stub). No Twilio or WhatsApp-via-MSG91 code path exists; `getAdapter("twilio")` throws `UnknownProviderError` (tested).
