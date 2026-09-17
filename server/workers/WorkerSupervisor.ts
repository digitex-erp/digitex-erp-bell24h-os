/**
 * Bell24h-OS Enterprise Edition
 * Worker Supervisor — Cluster Health & Zombie Reaper
 * Phase: B.5B.2 Worker Fleet Subsystem
 */

import pg from "pg";
import { QueueManager } from "../queue/QueueManager.js";
import { emitAuditEvent } from "../audit.js";

export interface SupervisorOptions {
  reapIntervalMs?: number;
  heartbeatTimeoutMs?: number;
}

export interface ClusterStatus {
  activeWorkers: number;
  totalConcurrencyCapacity: number;
  runningJobs: number;
  offlineWorkers: number;
}

export class WorkerSupervisor {
  private static instance: WorkerSupervisor | null = null;
  private pool: pg.Pool;
  private queueManager: QueueManager;

  private reapIntervalMs: number;
  private heartbeatTimeoutMs: number;
  private isRunning: boolean = false;
  private reapInterval: NodeJS.Timeout | null = null;

  constructor(pool: pg.Pool, queueManager: QueueManager, options: SupervisorOptions = {}) {
    this.pool = pool;
    this.queueManager = queueManager;
    this.reapIntervalMs = options.reapIntervalMs || 60000; // 60 seconds
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs || 120000; // 2 minutes
  }

  public static getInstance(pool?: pg.Pool, queueManager?: QueueManager, options?: SupervisorOptions): WorkerSupervisor {
    if (!WorkerSupervisor.instance) {
      if (!pool || !queueManager) {
        throw new Error("[WorkerSupervisor] Must provide pg.Pool and QueueManager on initialization.");
      }
      WorkerSupervisor.instance = new WorkerSupervisor(pool, queueManager, options);
    }
    return WorkerSupervisor.instance;
  }

  /**
   * Starts the 60-second cluster maintenance and zombie reclamation loop.
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Run initial reap immediately on startup
    this.runReaperTick().catch((err) => {
      console.error("[WorkerSupervisor] Initial reaper tick failed:", err.message);
    });

    this.reapInterval = setInterval(() => {
      this.runReaperTick().catch((err) => {
        console.error("[WorkerSupervisor] Reaper tick failed:", err.message);
      });
    }, this.reapIntervalMs);

    console.log(`[WorkerSupervisor] Cluster supervisor started (Tick: ${this.reapIntervalMs / 1000}s)`);
  }

  /**
   * Stops the supervisor loop.
   */
  stop(): void {
    if (!this.isRunning) return;
    if (this.reapInterval) {
      clearInterval(this.reapInterval);
      this.reapInterval = null;
    }
    this.isRunning = false;
    console.log("[WorkerSupervisor] Cluster supervisor stopped.");
  }

  /**
   * Core reaper logic: detects dead workers and reclaims their orphaned tasks.
   */
  async runReaperTick(): Promise<{ deadWorkersCount: number; reapedJobsCount: number }> {
    let deadWorkersCount = 0;

    // 1. Detect dead workers whose heartbeats have stalled beyond timeout
    try {
      const deadRes = await this.pool.query(
        `
        UPDATE public.job_workers
        SET status = 'offline'
        WHERE status != 'offline'
          AND last_heartbeat < NOW() - ($1 * INTERVAL '1 millisecond')
        RETURNING worker_id, last_heartbeat;
        `,
        [this.heartbeatTimeoutMs]
      );

      deadWorkersCount = deadRes.rowCount || 0;
      if (deadWorkersCount > 0) {
        const deadIds = deadRes.rows.map((r) => r.worker_id);
        console.warn(`[WorkerSupervisor] Detected ${deadWorkersCount} dead workers: ${deadIds.join(", ")}`);

        emitAuditEvent({
          actor: "service:supervisor",
          organizationId: null,
          action: "worker.reaped",
          targetType: "job_workers",
          targetId: "cluster",
          outcome: "success",
          requestId: `reap_${Date.now()}`,
          metadata: { deadWorkers: deadIds },
        });
      }
    } catch (err: any) {
      console.error("[WorkerSupervisor] Error querying dead workers:", err.message);
    }

    // 2. Reclaim orphaned jobs via QueueManager
    let reapedJobsCount = 0;
    try {
      reapedJobsCount = await this.queueManager.reapOrphanedJobs(30000); // 30s buffer past expiration
      if (reapedJobsCount > 0) {
        console.warn(`[WorkerSupervisor] Reclaimed ${reapedJobsCount} orphaned jobs whose leases expired.`);

        emitAuditEvent({
          actor: "service:supervisor",
          organizationId: null,
          action: "job.reclaimed",
          targetType: "job_queue",
          targetId: "cluster",
          outcome: "success",
          requestId: `reap_${Date.now()}`,
          metadata: { reapedJobsCount },
        });
      }
    } catch (err: any) {
      console.error("[WorkerSupervisor] Error reclaiming orphaned jobs:", err.message);
    }

    return { deadWorkersCount, reapedJobsCount };
  }

  /**
   * Returns a real-time cluster health summary.
   */
  async getClusterStatus(): Promise<ClusterStatus> {
    const res = await this.pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('idle', 'processing') AND last_heartbeat >= NOW() - INTERVAL '2 minutes') AS active_workers,
        COALESCE(SUM(concurrency_limit) FILTER (WHERE status IN ('idle', 'processing') AND last_heartbeat >= NOW() - INTERVAL '2 minutes'), 0) AS total_capacity,
        (SELECT COUNT(*) FROM public.job_queue WHERE status = 'running') AS running_jobs,
        COUNT(*) FILTER (WHERE status = 'offline' OR last_heartbeat < NOW() - INTERVAL '2 minutes') AS offline_workers
      FROM public.job_workers;
    `);

    const row = res.rows[0];
    return {
      activeWorkers: Number(row.active_workers || 0),
      totalConcurrencyCapacity: Number(row.total_capacity || 0),
      runningJobs: Number(row.running_jobs || 0),
      offlineWorkers: Number(row.offline_workers || 0),
    };
  }
}
