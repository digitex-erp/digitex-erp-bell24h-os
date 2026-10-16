# Secret Rotation Checklist — digitex-erp-bell24h-os

**Context:** `SECURITY_EXPOSURE_REPORT.md` found **no confirmed credential leak** in this repository's git history. This checklist is precautionary hygiene, not a response to a confirmed breach. It also records, per provider, **whether this codebase actually has a live integration for it today** — several providers below are referenced only in planning docs, not in working code, which changes what "rotation" even means for them. Verified against this repo's own code in prior audits this session; re-check before acting if time has passed.

**How to use:** for each provider, do the "Rotate" step only if you have reason to believe the current key was ever exposed (shared on screen, pasted into a chat, committed and later removed, etc.) — routine rotation with no suspected exposure is a separate, lower-urgency hygiene practice, not implied as necessary by this checklist's existence.

---

## 1. Supabase

**Integration status:** Live. `src/lib/supabase.ts` (anon key, baked into the client bundle by design — anon keys are meant to be public) and `server/middleware/requireAuth.ts` (verifies caller tokens against Supabase's own `/auth/v1/user`).

- [ ] Confirm which key type may have been exposed: **anon key** (public by design, rotation is lower-urgency) vs. **service-role key** (full DB bypass — treat any exposure as critical).
- [ ] Rotate in Supabase Dashboard → Project Settings → API → "Roll" for the affected key.
- [ ] Update `SUPABASE_KEY`/`VITE_SUPABASE_KEY` (anon) or `SUPABASE_SERVICE_KEY` wherever the app's real runtime env is configured — **not** `.env.example`, which must stay empty.
- [ ] Redeploy so the new key is baked into a fresh build (`vite.config.ts` bakes it at build time via `define`).
- [ ] If service-role was exposed: audit `pg_stat_statements`/Supabase logs for the exposure window for unexpected queries before rotating (rotation immediately after would lose that evidence).

## 2. OpenAI

**Integration status:** Referenced as `OPENAI_API_KEY` in `.env.example` and in a required-vars check in `server.ts`. No dedicated `OpenAIProvider` call site was found wired into the active AI Router (`server/ai/ProviderRouter.ts` routes to Gemini/Nvidia/DeepSeek/Qwen/GLM/MiniMax, not OpenAI, per this session's prior audits) — confirm current usage before assuming a live key exists.

- [ ] Check the OpenAI dashboard (platform.openai.com → API keys) for whether a key was ever actually issued for this project, rather than assuming one exists because the env var is documented.
- [ ] If one exists and may be exposed: revoke it in the dashboard, generate a new one, update the real (non-example) env config.
- [ ] Check usage/billing history for the exposure window for anomalous spend before revoking.

## 3. MSG91

**Integration status: not integrated in this codebase.** MSG91 appears only in architecture/planning docs (`docs/architecture/BELL24H_COMMUNICATION_HUB_IMPLEMENTATION_PLAN.md`, `BELL24H_OS_CURRENT_STATE.md`, `BELL24H_OS_VYAPARSETHU_SDK_API_CONTRACT_V1.md`) and this repo's own `bell24h-verify` skill, which explicitly warns that MSG91 phone-OTP auth is a signature of a **different, unrelated project** (`Projects/bell24h`, Next.js) — not this one.

- [ ] Before doing anything: confirm whether an MSG91 key was ever actually provisioned *for this project specifically*. If the only MSG91 credential you have is for the other bell24h project, it is out of this repo's scope — handle it in that project's own audit.
- [ ] If a key does exist for this project: rotate via MSG91 dashboard → API keys, update wherever it's actually consumed (no consuming code was found in `src`/`server` as of this audit).

## 4. Razorpay

**Integration status: not integrated in this codebase.** Mentioned only in architecture docs (`ARCHITECTURE_DECISION_RECORDS.md`, `CANONICAL_ARCHITECTURE.md`, `MASTER_MODULES.md`) as planned/future scope. No `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` in `.env.example`, no SDK call site in `src`/`server`.

- [ ] Confirm whether Razorpay keys were provisioned in the Razorpay dashboard for this project at all before assuming there's anything to rotate.
- [ ] If keys exist: rotate live-mode secret key immediately on any suspected exposure (payment credentials are high-severity); test-mode keys are lower urgency but still worth rotating.
- [ ] Check Razorpay webhook signing secret separately — it rotates independently of the API key pair.

## 5. Meta (WhatsApp Business API)

**Integration status: not integrated in this codebase.** Referenced in docs (`META_WHATSAPP_PRODUCTION_READINESS_CERTIFICATION.md`, `WHATSAPP_TEMPLATE_MASTER_AUDIT.md`) and as planned scope text in `CommunicationsPage.tsx` ("WhatsApp (Meta/MSG91)... scheduled for Phase FD2"). `PublishingJobHandler.ts` explicitly fails with `PROVIDER_NOT_CONFIGURED` rather than calling any real channel.

- [ ] Confirm in Meta Business Suite / developers.facebook.com whether a system-user access token was ever generated for this project.
- [ ] If one exists: rotate the system-user token, and separately check the app secret (different value, different rotation flow) in App Settings → Basic.

## 6. GitHub

**Integration status:** `gh` CLI access confirmed active in this session (`digitex-erp` account). No `.github/workflows` directory exists in this repo, so no GitHub Actions secrets are defined *by this repo's own workflow files* — but the repository or organization may still have Actions secrets, deploy keys, or a fine-grained PAT configured on GitHub's side that git history cannot show.

- [ ] Check Settings → Secrets and variables → Actions (repo and org level) for any secret that may have been pasted into an issue, PR description, or commit message (secrets in these locations don't show up in a file-content history scan).
- [ ] Check Settings → Deploy keys and Settings → Webhooks for any key/secret configured there.
- [ ] If a personal access token (PAT) was used in a URL (`https://<token>@github.com/...`) at any point, rotate it — token-in-URL is a common accidental-exposure vector this scan's file-content search would not catch if it was only ever typed into a terminal, not committed.

## 7. Neon

**Integration status: ambiguous.** Mentioned only in docs as a target for analytics/vector search in some architecture proposals; the actual pooled Postgres connection this app uses (`DATABASE_URL` in `server.ts`, `QueueManager`, worker handlers) has never been confirmed in this session to point at Neon specifically vs. Supabase's own pooler vs. something else — no live database check has been completed (see prior `S1 Supabase Architecture Validation` thread, closed BLOCKED on live evidence).

- [ ] Before rotating anything, confirm in the Neon console (console.neon.tech) whether a project/branch actually exists for this app, and whether its connection string is what `DATABASE_URL` currently holds.
- [ ] If confirmed: rotate the role password via Neon console → your project → Roles → reset password, then update `DATABASE_URL` everywhere it's configured (this is the same variable `QueueManager`/worker handlers depend on — a rotation here requires a coordinated redeploy, not just an env change).

## 8. Resend

**Integration status:** `RESEND_API_KEY` documented (empty) in `.env.example`; `server/communication/adapters/EmailAdapter.ts` (built this session) is the first code that actually reads it, via `process.env.RESEND_API_KEY` — never from a database column.

- [ ] Check resend.com dashboard → API Keys for whether a key was ever issued for this project.
- [ ] If one exists and may be exposed: revoke and reissue in the dashboard, update the real env config. `EmailAdapter.healthCheck()` (GET `/domains`) can confirm the new key works without sending a real email.

---

## General notes

- **Rotation order for anything confirmed exposed:** revoke/rotate first, investigate usage logs for the exposure window second if the provider's console still shows historical data after rotation — for providers where rotation deletes log visibility (rare, but check each dashboard), pull logs before rotating instead.
- **This checklist does not rotate anything itself** — every checkbox above is a manual action in a provider's own dashboard/console, consistent with this repo's own manual-SQL / no-credentials-in-chat workflow discipline.
- Re-verify each "Integration status" line against current code before acting on it if significant time has passed since 2026-09-28 — this reflects one point-in-time repo audit, not a live-updating source of truth.
