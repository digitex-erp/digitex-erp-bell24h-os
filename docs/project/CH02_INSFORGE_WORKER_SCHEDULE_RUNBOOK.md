# CH-02 — InsForge schedule that triggers the communication worker

**Status: PREPARED, NOT EXECUTED.** No InsForge schedule has been created. Creating one needs two things this
change does not have and must not invent: the URL of a deployment that contains the CH-02 code, and the value of
`CRON_SECRET`. Until it exists, scheduled campaigns and queued sends do **not** run (only Vercel's once-daily cron
in `vercel.json` would pick them up — up to ~24 h late).

## What was verified (2026-09-28, read-only)
| Check | Result |
|---|---|
| `npx -y @insforge/cli current` | Linked to project **Bell24h-os-VyaparSethu**, app key `r8fgym8r`, region us-east |
| `npx -y @insforge/cli whoami` | Authenticated |
| `npx -y @insforge/cli schedules list --json` | `[]` — **no schedules exist** |
| InsForge **MCP** server | Timed out at session start (transport issue). The **CLI** works; use the CLI. |

Not verified: that a schedule can reach the deployed app, that `CRON_SECRET` is set on the deployment, or that the
tick route runs in production (nothing in this repository has ever observed it running there).

## How the pieces fit
```
InsForge schedule (every N seconds/minutes)
   └─ GET  <app>/api/v1/workers/tick        Authorization: Bearer <CRON_SECRET>
        └─ WorkerRegistry.processBatch()    claims up to 5 queued jobs (concurrency limit) and runs them
             ├─ { messageId }   -> CommunicationJobHandler sends ONE message via the configured provider
             └─ { campaignId }  -> CampaignService.runBatch(): expands up to 100 recipients into messages
```
- **Schedule Campaign** (UI) only records *when*: it enqueues a `job_queue` row with `scheduled_at`. The tick that
  first runs after that time starts it.
- **Trigger Communication Jobs** = the tick above. `SKIP LOCKED` claiming makes overlapping ticks (InsForge **and**
  Vercel's cron) safe.
- **Record Execution Logs**: three durable places — `communication_deliveries` (one row per provider attempt),
  `communication_messages` (final status), and InsForge's own `schedules logs` (HTTP result of each trigger). The
  admin **Logs** tab reads the first two; **Dashboard → Worker evidence** shows whether jobs are actually completing.

## Throughput — read this before choosing a cadence
Each tick processes **at most 5 jobs** (`WorkerRegistry.concurrencyLimit`, default 5). One message = one job, plus
one job per 100-recipient batch. At a 1-minute cadence that is roughly **5 messages/minute (~300/hour)**; a
1,000-recipient campaign takes about 3½ hours. InsForge supports sub-minute intervals (`"30 seconds"`), which
doubles that; raising the batch size is a code change (`processBatch(maxJobs)` is not exposed on the route) and is
**not** part of CH-02. Organization quotas (default 1,000 email/day) cap volume regardless.

## Prerequisites (owner actions)
1. Deploy a build containing CH-02 and apply `add_communication_hub.sql` then `add_communication_campaigns.sql`
   (staging first; check `SELECT current_user, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user;`).
2. Set `CRON_SECRET` (a long random value) in the deployment environment.
3. Store the **same** value as an InsForge secret (it is referenced from the header, never written into the schedule).

## Commands
```bash
# 1. secret (value from your password manager — do not paste it into chat or commit it)
npx -y @insforge/cli secrets add CRON_SECRET "<the same value as the deployment's CRON_SECRET>"

# 2. schedule: every minute (5-field cron). For sub-minute use  --cron "30 seconds"
npx -y @insforge/cli schedules create \
  --name "Bell24h worker tick" \
  --cron "* * * * *" \
  --url "https://<production-app-host>/api/v1/workers/tick" \
  --method GET \
  --headers '{"Authorization": "Bearer ${{secrets.CRON_SECRET}}"}'

# 3. verify it is active and firing, and that responses are 200
npx -y @insforge/cli schedules list
npx -y @insforge/cli schedules get <id>
npx -y @insforge/cli schedules logs <id> --limit 20
```

## Acceptance (what "working" means — do not claim it earlier)
1. `schedules logs` shows repeated **HTTP 200** from `/api/v1/workers/tick` (a 401 means the secret differs).
2. Send one **test message** from a campaign to an address you own: it reaches **sent** without anyone clicking anything.
3. Admin **Dashboard → Worker evidence** shows a recent *last job completed* time, and **Schedules** shows no
   *overdue* row.
4. Only then schedule or execute a real campaign.

## Rollback
`npx -y @insforge/cli schedules delete <id>` (confirm first). Queued jobs simply wait; nothing is lost. Removing the
schedule does not affect Vercel's daily cron.
