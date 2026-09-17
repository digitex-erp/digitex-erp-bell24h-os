# Runtime Baseline Report — Sprint B.5, Phase 1 only

**Scope:** Repository reality audit only, per the user's explicit choice to run Phase 1
(read-only) and decide on implementation separately. **No code, schema, or dependency
was changed.** No queue, worker, or runtime infrastructure was built. This report
does not authorize or begin Phase 2 (Queue Foundation) or any later phase.

**Also unresolved, carried over from the prior session:** Review Gate C is still
BLOCKED (`docs/project/GATE_C_CLOSURE_PACKAGE.md`). This audit does not change that,
and Phase 2+ implementation should not start without the user separately deciding how
to handle that open gate.

---

## Correction to the incoming prompt's evidence baseline

The prompt asserted: *"Only Vercel Cron, Sequential API execution, Shared-secret
authorization exist today."* Checked against this repository directly:

| Claimed to exist | Verified? | Evidence |
|---|---|---|
| Vercel Cron | **False — does not exist in this repo** | `vercel.json` has no `crons` key at all (only `version`, `framework`, `outputDirectory`, `buildCommand`, `rewrites`). Repo-wide grep for `cron` (case-insensitive, all `.ts`/`.tsx`/`.json`) returns exactly one hit: a UI dropdown label string, `"Schedule (Cron)"`, in `src/pages/AutomationBuilderPage.tsx:84` — a form option with no backing scheduler behind it. No `node-cron`, `node-schedule`, `agenda`, or any cron library appears in `package.json`. |
| Sequential API execution | **True** | `server.ts:90-119` — `/api/v1/ai/text` calls `aiRouter.generateText()`/`generateNvidiaText()` with a direct `await` inside the request handler; the AI call and the HTTP response are the same synchronous request/response cycle. No queue sits in front of it. |
| Shared-secret authorization | **True** | `server/middleware/requireServiceAuth.ts` — a real, fails-closed implementation: constant-time SHA-256 digest comparison (`timingSafeEqual`), a single env-configured secret (`BELL24H_VYAPARSETHU_SERVICE_TOKEN`), audit-logged on both success and denial. This is genuinely production-grade for what it does (VyaparSethu-only S2S auth) — it is not the same thing as end-user authorization, and does not resolve `organization_id`. |

The "no cron" correction matters for Phase 2 planning: there is no existing scheduling
primitive to build on or replace — a queue/worker layer here would need to originate
scheduling capability from nothing, not migrate an existing cron mechanism.

---

## What actually exists today (Task: cron / job / worker / retry / failure / telemetry paths)

### Job execution — client-side only, never wired to any server process

- **`src/modules/job-orchestrator/JobOrchestratorService.ts`** — a singleton class.
  `enqueueJob()` inserts a row into `job_queue` via the **browser** Supabase client
  (`@/lib/supabase`). `processJob()` dispatches by `job_type` to
  `AIManagerService` (`src/modules/ai-providers/AiProviderService.ts` — the same
  "legacy browser AI adapter" other reports have flagged for migration).
- **`src/modules/job-orchestrator/JobWorker.ts`** — a singleton using
  `setInterval(() => this.processNext(), 5000)`. `processNext()` selects the oldest
  `status = 'queued'` row from `job_queue` and calls `processJob()`.
- **Both classes run entirely in the browser.** Neither is imported anywhere under
  `server/` or `api/`. `JobWorker`'s only call site anywhere in the repo is
  `src/main.tsx:7-9`, and both the import and the `.start()` call are commented out.

**This is the single most important finding for Phase 2 planning:** even if the two
commented lines in `main.tsx` were restored, the result would be a worker that only
runs *inside a user's open browser tab* — not a backend service. There is no
server-side worker process anywhere in this codebase to "re-enable." `package.json`'s
`scripts` block defines exactly one long-running process (`dev`/`build`/`start`, all
pointing at `server.ts`, the Express API server) and nothing else — no `worker`
script, no second entry point.

### Retry logic — state transition exists; re-execution path does not

`JobOrchestratorService.handleFailure()` (lines 95-109) does increment `retry_count`
and set `status = 'retrying'` when `retry_count < max_retries`. But
`JobWorker.processNext()` only ever queries `status = 'queued'` (line 35 of
`JobWorker.ts`) — a job moved to `'retrying'` is **never queried again by anything**.
There is no re-enqueue step, no delay/backoff of any kind, and no code anywhere
transitions a `'retrying'` job back to `'queued'`. Functionally, today, a failed job
retries exactly zero times regardless of `max_retries`'s configured value.

### Failure handling — logged, not recovered

`handleFailure()` writes one `error`-level row to `job_logs` with the exception
message. There is no dead-letter queue (no table or code path distinct from
`job_queue.status = 'failed'`), no alerting, and no operator-facing failure view
found anywhere in `src/pages/*`.

### Concurrency safety — not addressed, currently moot

`processNext()`'s job-claim is a plain `SELECT ... LIMIT 1`, not an atomic claim
(no `FOR UPDATE SKIP LOCKED` or equivalent, and no compare-and-set on `status`).
Two concurrent workers could select and process the same row. This is currently moot
only because no worker runs at all; it becomes real the moment more than one
consumer exists.

### Telemetry / worker health — schema scaffolding only, zero code

- `public.job_workers` (`supabase_schema.sql:1179-1186`) — columns for `worker_id`,
  `status`, `concurrency_limit`, `last_heartbeat`. **Zero references anywhere in
  `src/` or `server/`** — nothing ever inserts, updates, or reads this table. RLS is
  enabled with a `SELECT`-only policy; no `INSERT`/`UPDATE` policy exists at all, so
  even a correctly-authenticated org member could never write a heartbeat to it as
  currently configured.
- `public.job_schedules` (`supabase_schema.sql:1189-1198`) — has a `cron_expression`
  column, suggesting this table was meant to be the scheduling primitive. **Zero code
  references anywhere.** Same RLS gap: `SELECT`-only policy, no write policy.
- `public.job_priorities` (`supabase_schema.sql:1201-1205`) — RLS **enabled with no
  policy of any kind** (not even `SELECT`), which under Postgres RLS means the table
  is unreadable and unwritable by any non-superuser role as it stands. This matches
  and reconfirms a finding already on record in `PROJECT_CONTINUITY_REPORT.md` Step 5.
- No metrics library, no `/metrics` endpoint, no dashboard component for queue depth,
  processing rate, or failure rate exists anywhere in the repository.

### Persistence — real, but Postgres-only and not lock-safe

`job_queue`, `job_dependencies`, `job_logs` (`supabase_schema.sql:1132-1177`) are real
tables with correct org-isolation RLS policies (`organization_id = get_current_org_id()`
on select/insert/update) — this part is genuinely more solid than the worker/retry
layer built on top of it. This is Postgres-backed durable storage, not an in-memory
queue; a job survives a browser refresh. It is not, however, a dedicated queue engine
— no visibility timeout, no atomic claim, no priority-ordered dequeue (the `priority`
column exists but `processNext()`'s query does not `ORDER BY priority`, only
`created_at`).

---

## Summary table

| Capability | Exists? | Where | Production-ready? |
|---|---|---|---|
| Cron / scheduling | **No** | `job_schedules.cron_expression` column only; zero evaluator | No — nothing reads the column |
| Job creation/persistence | **Yes** | `job_queue` table + `JobOrchestratorService.enqueueJob()` | Partially — durable, org-isolated, but browser-resident and not lock-safe |
| Worker process | **No server-side worker exists** | `JobWorker.ts` — browser-only, disabled | No — there is nothing to "re-enable" on the server; a server worker would be new construction |
| Retry execution | **No** (state field exists, never consumed) | `handleFailure()` sets `'retrying'`; nothing reads it | No |
| Dead-letter / recovery | **No** | N/A | No |
| Worker health / heartbeat | **No** (table only) | `job_workers` — 0 code references | No |
| Queue telemetry | **No** | N/A | No |
| Shared-secret S2S auth | **Yes** | `requireServiceAuth.ts` | Yes, for its narrow VyaparSethu-only scope |
| Sequential (non-queued) AI calls | **Yes** | `/api/v1/ai/text` in `server.ts` | Yes, as a synchronous pattern — this is what a queue would sit in front of |

---

## What this means for Phase 2 planning (not decided here)

The original Sprint B.5 framing ("re-enable and verify the JobWorker → Queue →
Processing cycle") undersells the actual gap. There is no disabled *server-side*
worker to re-enable — the disabled code was always a client-side polling loop. Any
production-ready worker is new backend construction, not a restoration. This changes
the shape of Phase 2's "preferred stack: BullMQ / Redis / ioredis" question: adopting
that stack means running a new persistent Node process (a real architectural
addition — new infra dependency, new deployment target, new failure domain), separate
from the existing `job_queue` Postgres tables. Whether to keep Postgres as the queue
backing store (with proper row-locking) or introduce Redis/BullMQ alongside it is an
architecture decision, not something this audit resolves.

**Per the user's instruction, this report stops here.** No Phase 2 code was written.
The open question — how to handle Gate C's BLOCKED status, and whether/how to proceed
into Phase 2 — is still pending the user's decision from the prior turn.

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012ZFnfse6FQkg3HHFk566rZ
