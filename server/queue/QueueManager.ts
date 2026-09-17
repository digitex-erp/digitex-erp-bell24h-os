/**
 * Bell24h-OS Enterprise Edition
 * Production Queue Core Engine (PostgreSQL Native SKIP LOCKED)
 * Phase: B.5B.1 Queue Core
 */

import pg from "pg";
import {
  QueueJob,
  JobStatus,
  EnqueueJobOptions,
  ClaimJobsOptions,
  CompleteJobOptions,
  FailJobOptions,
  RetryJobOptions,
  HeartbeatOptions,
  QueueMetrics,
} from "./QueueTypes.js";

export class QueueManager {
  private static instance: QueueManager | null = null;
  private pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  public static getInstance(pool?: pg.Pool): QueueManager {
    if (!QueueManager.instance) {
      if (!pool) {
        throw new Error("[QueueManager] Instance not initialized. Provide a pg.Pool instance.");
      }
      QueueManager.instance = new QueueManager(pool);
    }
    return QueueManager.instance;
  }

  /**
   * Enqueue a new asynchronous task with optional idempotency and DAG dependencies.
   */
  async enqueueJob<T = any>(options: EnqueueJobOptions<T>): Promise<QueueJob<T>> {
    const {
      organizationId,
      jobType,
      payload,
      priority = "medium",
      idempotencyKey = null,
      scheduledAt = new Date(),
      timeoutMs = 300000,
      maxRetries = 3,
      dependencies = [],
    } = options;

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN;");

      const initialStatus: JobStatus = dependencies.length > 0 ? "blocked" : "queued";

      let insertQuery = `
        INSERT INTO public.job_queue (
          organization_id,
          job_type,
          payload,
          priority,
          idempotency_key,
          status,
          scheduled_at,
          timeout_ms,
          max_retries,
          retry_count,
          next_run_at,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, $7, NOW(), NOW())
      `;

      let queryParams: any[] = [
        organizationId,
        jobType,
        JSON.stringify(payload),
        priority,
        idempotencyKey,
        initialStatus,
        scheduledAt,
        timeoutMs,
        maxRetries,
      ];

      if (idempotencyKey) {
        insertQuery += `
          ON CONFLICT (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL
          DO UPDATE SET
            next_run_at = CASE 
              WHEN public.job_queue.status IN ('failed', 'dead_letter') THEN NOW()
              ELSE public.job_queue.next_run_at
            END,
            updated_at = NOW()
          RETURNING *;
        `;
      } else {
        insertQuery += " RETURNING *;";
      }

      const res = await client.query(insertQuery, queryParams);
      const job: QueueJob<T> = res.rows[0];

      // If DAG dependencies are specified, link them in job_dependencies
      if (dependencies.length > 0 && job) {
        for (const depId of dependencies) {
          await client.query(
            `
            INSERT INTO public.job_dependencies (job_id, depends_on_job_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING;
            `,
            [job.id, depId]
          );
        }
      }

      await client.query("COMMIT;");
      return job;
    } catch (err: any) {
      await client.query("ROLLBACK;");
      console.error("[QueueManager] Enqueue failed:", err.message);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Atomically claim ready jobs using PostgreSQL `SELECT ... FOR UPDATE SKIP LOCKED`.
   * Ensures zero race conditions and zero lock contention across concurrent workers.
   */
  async claimJobs(options: ClaimJobsOptions): Promise<QueueJob[]> {
    const {
      workerId,
      supportedTypes = null,
      batchSize = 1,
      lockDurationMs = 300000,
      maxConcurrentPerTenant = 5,
    } = options;

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN;");

      const claimSql = `
        WITH ready_candidates AS (
          SELECT q.id
          FROM public.job_queue q
          WHERE q.status IN ('queued', 'retrying')
            AND (q.scheduled_at IS NULL OR q.scheduled_at <= NOW())
            AND (q.next_run_at IS NULL OR q.next_run_at <= NOW())
            AND ($1::text[] IS NULL OR q.job_type = ANY($1::text[]))
            AND (
              $2::integer IS NULL OR (
                SELECT COUNT(*)
                FROM public.job_queue active_tenant
                WHERE active_tenant.organization_id = q.organization_id
                  AND active_tenant.status = 'running'
              ) < $2::integer
            )
          ORDER BY 
            (CASE q.priority
              WHEN 'critical' THEN 4
              WHEN 'high'     THEN 3
              WHEN 'medium'   THEN 2
              WHEN 'low'      THEN 1
              ELSE 0
            END) DESC,
            COALESCE(q.next_run_at, q.scheduled_at, q.created_at) ASC,
            q.created_at ASC
          LIMIT $3
          FOR UPDATE SKIP LOCKED
        )
        UPDATE public.job_queue target
        SET 
          status = 'running',
          locked_by = $4,
          locked_at = NOW(),
          lock_expires_at = NOW() + ($5 * INTERVAL '1 millisecond'),
          heartbeat_at = NOW(),
          started_at = COALESCE(target.started_at, NOW()),
          updated_at = NOW()
        FROM ready_candidates
        WHERE target.id = ready_candidates.id
        RETURNING target.*;
      `;

      const res = await client.query(claimSql, [
        supportedTypes && supportedTypes.length > 0 ? supportedTypes : null,
        maxConcurrentPerTenant,
        batchSize,
        workerId,
        lockDurationMs,
      ]);

      await client.query("COMMIT;");
      return res.rows;
    } catch (err: any) {
      await client.query("ROLLBACK;");
      console.error("[QueueManager] Claim failed:", err.message);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Atomically marks a job completed, clears worker lease, and cascades unblocking to child DAG tasks.
   */
  async completeJob(options: CompleteJobOptions): Promise<boolean> {
    const { jobId, workerId, result } = options;

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN;");

      // 1. Mark job as completed
      const updateRes = await client.query(
        `
        UPDATE public.job_queue
        SET 
          status = 'completed',
          completed_at = NOW(),
          locked_by = NULL,
          locked_at = NULL,
          lock_expires_at = NULL,
          updated_at = NOW()
        WHERE id = $1 AND locked_by = $2 AND status = 'running'
        RETURNING id, organization_id;
        `,
        [jobId, workerId]
      );

      if (updateRes.rowCount === 0) {
        await client.query("ROLLBACK;");
        return false;
      }

      // 2. Insert completion log
      await client.query(
        `
        INSERT INTO public.job_logs (job_id, level, message, metadata, created_at)
        VALUES ($1, 'info', 'Job completed successfully', $2, NOW());
        `,
        [jobId, result ? JSON.stringify({ result }) : null]
      );

      // 3. Atomically unblock dependent child jobs if all their parent dependencies are completed
      await client.query(
        `
        WITH pending_children AS (
          SELECT d.job_id
          FROM public.job_dependencies d
          WHERE d.depends_on_job_id = $1
        ),
        unblocked_children AS (
          SELECT pc.job_id
          FROM pending_children pc
          WHERE NOT EXISTS (
            SELECT 1
            FROM public.job_dependencies other_deps
            JOIN public.job_queue parent_q ON other_deps.depends_on_job_id = parent_q.id
            WHERE other_deps.job_id = pc.job_id
              AND parent_q.status != 'completed'
          )
        )
        UPDATE public.job_queue
        SET 
          status = 'queued',
          next_run_at = NOW(),
          updated_at = NOW()
        WHERE id IN (SELECT job_id FROM unblocked_children)
          AND status = 'blocked';
        `,
        [jobId]
      );

      await client.query("COMMIT;");
      return true;
    } catch (err: any) {
      await client.query("ROLLBACK;");
      console.error("[QueueManager] Complete job failed:", err.message);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Handles job execution failures. Classifies whether to retry or route directly to dead-letter queue.
   */
  async failJob(options: FailJobOptions): Promise<QueueJob> {
    const { jobId, workerId, error, isTerminal = false } = options;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : null;

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN;");

      // Inspect current retry status
      const checkRes = await client.query(
        `
        SELECT retry_count, max_retries, organization_id
        FROM public.job_queue
        WHERE id = $1 AND locked_by = $2 AND status = 'running';
        `,
        [jobId, workerId]
      );

      if (checkRes.rowCount === 0) {
        await client.query("ROLLBACK;");
        throw new Error(`Job ${jobId} not found or not locked by worker ${workerId}`);
      }

      const { retry_count, max_retries } = checkRes.rows[0];
      const shouldDeadLetter = isTerminal || retry_count + 1 >= max_retries;

      let resultJob: QueueJob;

      if (shouldDeadLetter) {
        // Move to Dead-Letter Queue
        const dlqRes = await client.query(
          `
          UPDATE public.job_queue
          SET 
            status = 'dead_letter',
            dead_letter_reason = $3,
            error_details = $4,
            locked_by = NULL,
            locked_at = NULL,
            lock_expires_at = NULL,
            updated_at = NOW()
          WHERE id = $1 AND locked_by = $2
          RETURNING *;
          `,
          [
            jobId,
            workerId,
            errorMessage,
            JSON.stringify({ message: errorMessage, stack: errorStack, failed_at: new Date().toISOString() }),
          ]
        );
        resultJob = dlqRes.rows[0];

        // Fail downstream dependent jobs immediately with 'dependency_failed'
        await client.query(
          `
          UPDATE public.job_queue
          SET 
            status = 'dependency_failed',
            dead_letter_reason = 'Parent job dependency failed permanently',
            updated_at = NOW()
          WHERE id IN (
            SELECT job_id FROM public.job_dependencies WHERE depends_on_job_id = $1
          ) AND status = 'blocked';
          `,
          [jobId]
        );

        // Record terminal log
        await client.query(
          `
          INSERT INTO public.job_logs (job_id, level, message, metadata, created_at)
          VALUES ($1, 'error', 'Job permanently failed and moved to dead-letter queue: ' || $2, $3, NOW());
          `,
          [jobId, errorMessage, JSON.stringify({ error: errorMessage, stack: errorStack })]
        );
      } else {
        // Calculate exponential backoff with randomized jitter
        // formula: min(1 hour, 5000 * 2^retry_count) + random(0, 3000) ms
        const backoffBase = Math.min(3600000, 5000 * Math.pow(2, retry_count));
        const jitter = Math.floor(Math.random() * 3000);
        const delayMs = backoffBase + jitter;

        const retryRes = await client.query(
          `
          UPDATE public.job_queue
          SET 
            status = 'retrying',
            retry_count = retry_count + 1,
            next_run_at = NOW() + ($3 * INTERVAL '1 millisecond'),
            locked_by = NULL,
            locked_at = NULL,
            lock_expires_at = NULL,
            error_details = $4,
            updated_at = NOW()
          WHERE id = $1 AND locked_by = $2
          RETURNING *;
          `,
          [
            jobId,
            workerId,
            delayMs,
            JSON.stringify({ message: errorMessage, retry_delay_ms: delayMs, attempted_at: new Date().toISOString() }),
          ]
        );
        resultJob = retryRes.rows[0];

        // Record retry log
        await client.query(
          `
          INSERT INTO public.job_logs (job_id, level, message, metadata, created_at)
          VALUES ($1, 'warn', 'Job execution failed. Scheduled retry in ' || $2 || 'ms: ' || $3, $4, NOW());
          `,
          [jobId, delayMs, errorMessage, JSON.stringify({ error: errorMessage, retry_delay_ms: delayMs })]
        );
      }

      await client.query("COMMIT;");
      return resultJob;
    } catch (err: any) {
      await client.query("ROLLBACK;");
      console.error("[QueueManager] Fail job failed:", err.message);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Explicitly retry a job with an optional custom delay override.
   */
  async retryJob(options: RetryJobOptions): Promise<QueueJob> {
    const { jobId, workerId, error, customDelayMs } = options;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : null;

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN;");

      const checkRes = await client.query(
        `SELECT retry_count, max_retries FROM public.job_queue WHERE id = $1 AND locked_by = $2;`,
        [jobId, workerId]
      );

      if (checkRes.rowCount === 0) {
        await client.query("ROLLBACK;");
        throw new Error(`Job ${jobId} not found or not leased by ${workerId}`);
      }

      const { retry_count, max_retries } = checkRes.rows[0];
      if (retry_count + 1 >= max_retries) {
        await client.query("ROLLBACK;");
        return this.failJob({ jobId, workerId, error, isTerminal: true });
      }

      const delayMs = customDelayMs ?? Math.min(3600000, 5000 * Math.pow(2, retry_count)) + Math.floor(Math.random() * 2000);

      const res = await client.query(
        `
        UPDATE public.job_queue
        SET 
          status = 'retrying',
          retry_count = retry_count + 1,
          next_run_at = NOW() + ($3 * INTERVAL '1 millisecond'),
          locked_by = NULL,
          locked_at = NULL,
          lock_expires_at = NULL,
          error_details = $4,
          updated_at = NOW()
        WHERE id = $1 AND locked_by = $2
        RETURNING *;
        `,
        [jobId, workerId, delayMs, JSON.stringify({ message: errorMessage, stack: errorStack })]
      );

      await client.query(
        `
        INSERT INTO public.job_logs (job_id, level, message, metadata, created_at)
        VALUES ($1, 'warn', 'Job explicitly rescheduled for retry in ' || $2 || 'ms', $3, NOW());
        `,
        [jobId, delayMs, JSON.stringify({ delayMs, error: errorMessage })]
      );

      await client.query("COMMIT;");
      return res.rows[0];
    } catch (err: any) {
      await client.query("ROLLBACK;");
      console.error("[QueueManager] Retry job failed:", err.message);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Extends the worker lease and updates the heartbeat timestamp for active long-running jobs.
   */
  async heartbeat(options: HeartbeatOptions): Promise<boolean> {
    const { jobId, workerId, extendLockMs = 300000 } = options;

    const res = await this.pool.query(
      `
      UPDATE public.job_queue
      SET 
        heartbeat_at = NOW(),
        lock_expires_at = NOW() + ($3 * INTERVAL '1 millisecond'),
        updated_at = NOW()
      WHERE id = $1 AND locked_by = $2 AND status = 'running';
      `,
      [jobId, workerId, extendLockMs]
    );

    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Scans and recovers orphaned jobs where the worker crashed or missed heartbeats past `lock_expires_at`.
   * Essential supervisor function guaranteeing at-least-once processing.
   */
  async reapOrphanedJobs(leaseBufferMs: number = 30000): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN;");

      const reaperSql = `
        WITH expired_jobs AS (
          SELECT id, retry_count, max_retries
          FROM public.job_queue
          WHERE status = 'running'
            AND lock_expires_at < NOW() - ($1 * INTERVAL '1 millisecond')
          FOR UPDATE SKIP LOCKED
        ),
        recovered AS (
          UPDATE public.job_queue q
          SET 
            status = CASE 
              WHEN ej.retry_count + 1 >= ej.max_retries THEN 'dead_letter'::text
              ELSE 'retrying'::text
            END,
            dead_letter_reason = CASE 
              WHEN ej.retry_count + 1 >= ej.max_retries THEN 'Worker heartbeat expired (zombie task reaped)'
              ELSE q.dead_letter_reason
            END,
            retry_count = q.retry_count + 1,
            next_run_at = NOW(),
            locked_by = NULL,
            locked_at = NULL,
            lock_expires_at = NULL,
            updated_at = NOW()
          FROM expired_jobs ej
          WHERE q.id = ej.id
          RETURNING q.id
        )
        SELECT COUNT(*) as reaped_count FROM recovered;
      `;

      const res = await client.query(reaperSql, [leaseBufferMs]);
      await client.query("COMMIT;");
      return Number(res.rows[0]?.reaped_count || 0);
    } catch (err: any) {
      await client.query("ROLLBACK;");
      console.error("[QueueManager] Reap orphaned jobs failed:", err.message);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Retrieves queue depth and health metrics across all states.
   */
  async getMetrics(organizationId?: string): Promise<QueueMetrics> {
    const query = `
      SELECT
        COUNT(*) FILTER (WHERE status = 'queued') AS queued,
        COUNT(*) FILTER (WHERE status = 'blocked') AS blocked,
        COUNT(*) FILTER (WHERE status = 'running') AS running,
        COUNT(*) FILTER (WHERE status = 'retrying') AS retrying,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed,
        COUNT(*) FILTER (WHERE status = 'failed') AS failed,
        COUNT(*) FILTER (WHERE status = 'dead_letter') AS dead_letter,
        EXTRACT(EPOCH FROM (NOW() - MIN(created_at) FILTER (WHERE status = 'queued')))::integer AS oldest_queued_age_seconds
      FROM public.job_queue
      WHERE ($1::uuid IS NULL OR organization_id = $1::uuid);
    `;

    const res = await this.pool.query(query, [organizationId || null]);
    const row = res.rows[0];

    return {
      queued: Number(row.queued || 0),
      blocked: Number(row.blocked || 0),
      running: Number(row.running || 0),
      retrying: Number(row.retrying || 0),
      completed: Number(row.completed || 0),
      failed: Number(row.failed || 0),
      dead_letter: Number(row.dead_letter || 0),
      oldest_queued_age_seconds: row.oldest_queued_age_seconds ? Number(row.oldest_queued_age_seconds) : null,
    };
  }
}
