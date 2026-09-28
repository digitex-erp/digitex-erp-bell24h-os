/**
 * DashboardService — the numbers behind the admin Dashboard and Schedules tabs.
 *
 * Every figure is a COUNT of real rows (messages, campaigns, job_queue, deliveries). Nothing is
 * estimated or defaulted to a healthy-looking value. "Worker evidence" is deliberately phrased as
 * evidence: the app cannot see InsForge or Vercel, so the only honest signal that a trigger is
 * working is that communication jobs have actually been completing.
 */

import type pg from "pg";
import { getDailyQuota } from "./CommunicationService.js";
import { ProviderAdminService } from "./ProviderAdminService.js";
import { SENDABLE_CHANNELS } from "./validation.js";

export interface WorkerEvidence {
  queuedJobs: number;
  oldestQueuedAt: string | null;
  runningJobs: number;
  deadLetterJobs: number;
  lastJobCompletedAt: string | null;
}

async function workerEvidence(pool: pg.Pool, organizationId: string): Promise<WorkerEvidence> {
  const r = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
            MIN(COALESCE(next_run_at, scheduled_at)) FILTER (WHERE status = 'queued') AS oldest_queued,
            COUNT(*) FILTER (WHERE status = 'running')::int AS running,
            COUNT(*) FILTER (WHERE status = 'dead_letter')::int AS dead,
            MAX(completed_at) FILTER (WHERE status = 'completed') AS last_completed
       FROM public.job_queue WHERE organization_id = $1 AND job_type = 'communication'`,
    [organizationId],
  );
  const row = r.rows[0];
  return {
    queuedJobs: row.queued,
    oldestQueuedAt: row.oldest_queued,
    runningJobs: row.running,
    deadLetterJobs: row.dead,
    lastJobCompletedAt: row.last_completed,
  };
}

export class DashboardService {
  constructor(private pool: pg.Pool) {}

  async getDashboard(organizationId: string) {
    const [msg24, msg7, quotaUse, camps, upcoming, worker, providers] = await Promise.all([
      this.pool.query(
        `SELECT status, COUNT(*)::int AS n FROM public.communication_messages
          WHERE organization_id = $1 AND NOT is_test AND created_at > NOW() - INTERVAL '24 hours' GROUP BY status`,
        [organizationId],
      ),
      this.pool.query(
        `SELECT status, COUNT(*)::int AS n FROM public.communication_messages
          WHERE organization_id = $1 AND NOT is_test AND created_at > NOW() - INTERVAL '7 days' GROUP BY status`,
        [organizationId],
      ),
      // Same definition the quota check uses (includes test sends; excludes cancelled).
      this.pool.query(
        `SELECT channel_type, COUNT(*)::int AS n FROM public.communication_messages
          WHERE organization_id = $1 AND created_at > NOW() - INTERVAL '24 hours' AND status <> 'cancelled' GROUP BY channel_type`,
        [organizationId],
      ),
      this.pool.query(`SELECT status, COUNT(*)::int AS n FROM public.communication_campaigns WHERE organization_id = $1 GROUP BY status`, [organizationId]),
      this.pool.query(
        `SELECT COUNT(*)::int AS n, MIN(scheduled_at) AS next_at FROM public.communication_campaigns WHERE organization_id = $1 AND status = 'scheduled'`,
        [organizationId],
      ),
      workerEvidence(this.pool, organizationId),
      new ProviderAdminService(this.pool).list(organizationId),
    ]);

    const toMap = (rows: { status: string; n: number }[]) => Object.fromEntries(rows.map((r) => [r.status, r.n]));
    const used = Object.fromEntries((quotaUse.rows as { channel_type: string; n: number }[]).map((r) => [r.channel_type, r.n]));

    return {
      messages: { last24h: toMap(msg24.rows), last7d: toMap(msg7.rows) },
      quota: SENDABLE_CHANNELS.map((c) => ({ channel: c, used: used[c] ?? 0, limit: getDailyQuota(c) })),
      campaigns: toMap(camps.rows),
      scheduled: { count: upcoming.rows[0].n as number, nextAt: (upcoming.rows[0].next_at as string | null) ?? null },
      worker,
      providers: {
        total: providers.length,
        canSend: providers.filter((p) => p.implementation === "live-capable").length,
        credentialsConfigured: providers.filter((p) => p.credentialsConfigured).length,
        verified: providers.filter((p) => p.verified).length,
      },
    };
  }

  /** Campaigns that are scheduled or in progress, joined to the run job that will (or did) start them. */
  async getSchedules(organizationId: string) {
    const r = await this.pool.query(
      `SELECT c.id, c.name, c.channel_type, c.status, c.total_recipients, c.scheduled_at, c.run_count, c.paused_reason,
              j.status AS job_status, j.retry_count AS job_retry_count, COALESCE(j.next_run_at, j.scheduled_at) AS job_due_at,
              j.completed_at AS job_completed_at
         FROM public.communication_campaigns c
         LEFT JOIN public.job_queue j
                ON j.organization_id = c.organization_id AND j.idempotency_key = 'camp-run:' || c.id || ':' || c.run_count
        WHERE c.organization_id = $1 AND c.status IN ('scheduled', 'running', 'paused')
        ORDER BY COALESCE(c.scheduled_at, c.started_at, c.created_at)`,
      [organizationId],
    );
    const now = Date.now();
    const schedules = (r.rows as any[]).map((row) => {
      const due = row.job_due_at ? new Date(row.job_due_at).getTime() : null;
      // Overdue = the job's time has passed and it is still waiting: nothing has triggered the worker.
      const overdue = row.status === "scheduled" && row.job_status === "queued" && due !== null && due < now - 60_000;
      return { ...row, overdue };
    });
    return { schedules, worker: await workerEvidence(this.pool, organizationId) };
  }
}
