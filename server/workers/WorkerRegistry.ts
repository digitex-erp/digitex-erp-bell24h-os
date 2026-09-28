/**
 * Bell24h-OS Enterprise Edition
 * Worker Fleet Registry & Execution Engine
 * Phase: B.5B.2 Worker Fleet Subsystem
 */

import os from "os";
import pg from "pg";
import { QueueManager } from "../queue/QueueManager.js";
import { QueueJob, JobType } from "../queue/QueueTypes.js";
import { AIJobHandler } from "./handlers/AIJobHandler.js";
import { MediaJobHandler } from "./handlers/MediaJobHandler.js";
import { PublishingJobHandler } from "./handlers/PublishingJobHandler.js";
import { CommunicationJobHandler } from "./handlers/CommunicationJobHandler.js";
import { emitAuditEvent } from "../audit.js";

export interface WorkerOptions {
  workerId?: string;
  concurrencyLimit?: number;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  supportedTypes?: JobType[];
  maxConcurrentPerTenant?: number;
}

export class WorkerRegistry {
  private static instance: WorkerRegistry | null = null;
  private pool: pg.Pool;
  private queueManager: QueueManager;

  public readonly workerId: string;
  public readonly concurrencyLimit: number;
  private pollIntervalMs: number;
  private heartbeatIntervalMs: number;
  private supportedTypes: JobType[];
  private maxConcurrentPerTenant: number;

  private isRunning: boolean = false;
  private isShuttingDown: boolean = false;
  private activeJobs: Set<string> = new Set();

  private pollTimeout: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  // Handlers
  private aiHandler: AIJobHandler;
  private mediaHandler: MediaJobHandler;
  private publishingHandler: PublishingJobHandler;
  private communicationHandler: CommunicationJobHandler;

  constructor(pool: pg.Pool, queueManager: QueueManager, options: WorkerOptions = {}) {
    this.pool = pool;
    this.queueManager = queueManager;

    const hostname = os.hostname().replace(/[^a-zA-Z0-9_-]/g, "");
    this.workerId = options.workerId || `wrk_${hostname}_${process.pid}_${Date.now().toString(36)}`;
    this.concurrencyLimit = options.concurrencyLimit || 5;
    this.pollIntervalMs = options.pollIntervalMs || 2000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs || 15000;
    this.maxConcurrentPerTenant = options.maxConcurrentPerTenant || 5;
    this.supportedTypes = options.supportedTypes || [
      "content",
      "seo",
      "prompt",
      "image",
      "video",
      "voice",
      "publishing",
      "social",
      "analytics",
      "automation",
      "communication",
    ];

    this.aiHandler = new AIJobHandler(pool);
    this.mediaHandler = new MediaJobHandler(pool, queueManager);
    this.publishingHandler = new PublishingJobHandler(pool);
    this.communicationHandler = new CommunicationJobHandler(pool);
  }

  public static getInstance(pool?: pg.Pool, queueManager?: QueueManager, options?: WorkerOptions): WorkerRegistry {
    if (!WorkerRegistry.instance) {
      if (!pool || !queueManager) {
        throw new Error("[WorkerRegistry] Must provide pg.Pool and QueueManager on initialization.");
      }
      WorkerRegistry.instance = new WorkerRegistry(pool, queueManager, options);
    }
    return WorkerRegistry.instance;
  }

  /**
   * Starts the worker fleet lifecycle: registers, starts heartbeats, and begins poll loop.
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.isShuttingDown = false;

    await this.registerWorker();
    this.startHeartbeatLoop();
    this.setupProcessSignals();
    this.scheduleNextPoll(0);

    console.log(`[WorkerRegistry] Worker ${this.workerId} started (Concurrency: ${this.concurrencyLimit})`);
  }

  /**
   * Gracefully shuts down the worker fleet.
   */
  async stop(): Promise<void> {
    if (!this.isRunning || this.isShuttingDown) return;
    this.isShuttingDown = true;
    console.log(`[WorkerRegistry] Worker ${this.workerId} initiating graceful shutdown...`);

    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }

    // Set status to shutting_down in database
    await this.updateWorkerStatus("shutting_down");

    // Wait up to 20 seconds for active jobs to drain
    const drainDeadline = Date.now() + 20000;
    while (this.activeJobs.size > 0 && Date.now() < drainDeadline) {
      console.log(`[WorkerRegistry] Waiting for ${this.activeJobs.size} active jobs to complete...`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Set status to offline
    await this.updateWorkerStatus("offline");
    this.isRunning = false;
    console.log(`[WorkerRegistry] Worker ${this.workerId} shut down cleanly.`);
  }

  /**
   * Registers this worker instance into public.job_workers.
   */
  private async registerWorker(): Promise<void> {
    try {
      await this.pool.query(
        `
        INSERT INTO public.job_workers (
          worker_id,
          status,
          concurrency_limit,
          last_heartbeat
        ) VALUES ($1, 'idle', $2, NOW())
        ON CONFLICT (worker_id) 
        DO UPDATE SET 
          status = 'idle',
          concurrency_limit = $2,
          last_heartbeat = NOW();
        `,
        [this.workerId, this.concurrencyLimit]
      );

      emitAuditEvent({
        actor: `worker:${this.workerId}`,
        organizationId: null,
        action: "worker.registered",
        targetType: "job_workers",
        targetId: this.workerId,
        outcome: "success",
        requestId: `boot_${Date.now()}`,
        metadata: { concurrencyLimit: this.concurrencyLimit, supportedTypes: this.supportedTypes },
      });
    } catch (err: any) {
      console.error(`[WorkerRegistry] Failed to register worker ${this.workerId}:`, err.message);
      throw err;
    }
  }

  /**
   * Periodically emits a heartbeat to public.job_workers every 15 seconds.
   */
  private startHeartbeatLoop(): void {
    this.heartbeatInterval = setInterval(async () => {
      if (!this.isRunning) return;
      try {
        const currentStatus = this.activeJobs.size > 0 ? "processing" : "idle";
        await this.pool.query(
          `
          UPDATE public.job_workers
          SET 
            last_heartbeat = NOW(),
            status = $2
          WHERE worker_id = $1;
          `,
          [this.workerId, currentStatus]
        );
      } catch (err: any) {
        console.warn(`[WorkerRegistry] Heartbeat failed for ${this.workerId}:`, err.message);
      }
    }, this.heartbeatIntervalMs);
  }

  private async updateWorkerStatus(status: "idle" | "processing" | "shutting_down" | "offline"): Promise<void> {
    try {
      await this.pool.query(
        `UPDATE public.job_workers SET status = $2, last_heartbeat = NOW() WHERE worker_id = $1;`,
        [this.workerId, status]
      );
    } catch (err: any) {
      console.warn(`[WorkerRegistry] Failed to update status to ${status}:`, err.message);
    }
  }

  /**
   * Main work poll loop: claims available jobs up to remaining concurrency capacity.
   */
  private async pollAndExecute(): Promise<void> {
    if (!this.isRunning || this.isShuttingDown) return;

    const availableSlots = this.concurrencyLimit - this.activeJobs.size;
    if (availableSlots <= 0) {
      this.scheduleNextPoll(this.pollIntervalMs);
      return;
    }

    let claimedJobs: QueueJob[] = [];
    try {
      claimedJobs = await this.queueManager.claimJobs({
        workerId: this.workerId,
        supportedTypes: this.supportedTypes,
        batchSize: availableSlots,
        lockDurationMs: 300000, // 5 min initial lease
        maxConcurrentPerTenant: this.maxConcurrentPerTenant,
      });
    } catch (err: any) {
      console.error(`[WorkerRegistry] Failed claiming jobs:`, err.message);
      this.scheduleNextPoll(this.pollIntervalMs * 2);
      return;
    }

    if (claimedJobs.length > 0) {
      console.log(`[WorkerRegistry] Claimed ${claimedJobs.length} jobs on worker ${this.workerId}`);
      for (const job of claimedJobs) {
        this.activeJobs.add(job.id);
        // Execute asynchronously in background without awaiting here
        this.executeJob(job).finally(() => {
          this.activeJobs.delete(job.id);
        });
      }
      // If we claimed jobs, poll again immediately for additional ready work
      this.scheduleNextPoll(100);
    } else {
      // Idle sleep
      this.scheduleNextPoll(this.pollIntervalMs);
    }
  }

  private scheduleNextPoll(delayMs: number): void {
    if (!this.isRunning || this.isShuttingDown) return;
    this.pollTimeout = setTimeout(() => {
      this.pollAndExecute();
    }, delayMs);
  }

  /**
   * Dispatches and monitors execution for an individual claimed task.
   * Returns the outcome rather than swallowing it, so a bounded caller (e.g.
   * processBatch()) can report accurate per-job results instead of assuming
   * every awaited call succeeded.
   */
  private async executeJob(job: QueueJob): Promise<{ outcome: "completed" | "failed"; error?: string }> {
    const startedAt = Date.now();
    console.log(`[WorkerRegistry] Executing job ${job.id} (type: ${job.job_type}, priority: ${job.priority})`);

    try {
      let result: any;

      switch (job.job_type) {
        case "content":
        case "seo":
        case "prompt":
        case "analytics":
        case "intelligence_requirement":
          result = await this.aiHandler.handle(job);
          break;

        case "image":
        case "video":
        case "voice":
          result = await this.mediaHandler.handle(job, this.workerId);
          break;

        case "publishing":
        case "social":
          result = await this.publishingHandler.handle(job);
          break;

        case "communication":
          result = await this.communicationHandler.handle(job);
          break;

        default:
          throw new Error(`No worker handler registered for job type: ${job.job_type}`);
      }

      await this.queueManager.completeJob({
        jobId: job.id,
        workerId: this.workerId,
        result,
      });

      console.log(`[WorkerRegistry] Job ${job.id} completed in ${Date.now() - startedAt}ms`);
      return { outcome: "completed" };
    } catch (err: any) {
      console.error(`[WorkerRegistry] Job ${job.id} failed:`, err.message);
      await this.queueManager.failJob({
        jobId: job.id,
        workerId: this.workerId,
        error: err,
        isTerminal: false,
      });
      return { outcome: "failed", error: err.message };
    }
  }

  /**
   * Serverless-safe alternative to start()/pollAndExecute(): claims and fully
   * processes one bounded batch of jobs, then returns — no setInterval, no
   * setTimeout poll loop, nothing left running after this promise resolves.
   * Modeled on WorkerSupervisor.runReaperTick(), the pattern this exact
   * codebase already uses for the same serverless constraint (a Vercel
   * function does not survive after it returns its response, so start()'s
   * persistent timers are dead code in that environment — see
   * docs/project/BELL24H_OS_RUNTIME_REALITY_CERTIFICATION.md §2).
   *
   * Every claimed job is awaited before this method returns (unlike
   * pollAndExecute()'s fire-and-forget `executeJob(job).finally(...)`, which
   * is only safe in a long-running process that stays alive to let those
   * promises finish on their own schedule).
   *
   * Intended caller: a cron-triggered route (server.ts, /api/v1/workers/tick),
   * not the continuous poll loop used by start().
   */
  async processBatch(maxJobs: number = this.concurrencyLimit): Promise<{
    claimedCount: number;
    completedCount: number;
    failedCount: number;
    jobResults: Array<{ jobId: string; jobType: string; outcome: "completed" | "failed"; error?: string }>;
  }> {
    await this.registerWorker();

    let claimedJobs: QueueJob[] = [];
    try {
      claimedJobs = await this.queueManager.claimJobs({
        workerId: this.workerId,
        supportedTypes: this.supportedTypes,
        batchSize: maxJobs,
        lockDurationMs: 300000,
        maxConcurrentPerTenant: this.maxConcurrentPerTenant,
      });
    } catch (err: any) {
      console.error(`[WorkerRegistry] processBatch: failed claiming jobs:`, err.message);
      return { claimedCount: 0, completedCount: 0, failedCount: 0, jobResults: [] };
    }

    const jobResults: Array<{ jobId: string; jobType: string; outcome: "completed" | "failed"; error?: string }> = [];

    if (claimedJobs.length > 0) {
      console.log(`[WorkerRegistry] processBatch: claimed ${claimedJobs.length} jobs on worker ${this.workerId}`);
      await this.updateWorkerStatus("processing");

      await Promise.all(
        claimedJobs.map(async (job) => {
          this.activeJobs.add(job.id);
          try {
            const { outcome, error } = await this.executeJob(job);
            jobResults.push({ jobId: job.id, jobType: job.job_type, outcome, error });
          } finally {
            this.activeJobs.delete(job.id);
          }
        })
      );

      await this.updateWorkerStatus("idle");
    }

    const completedCount = jobResults.filter((r) => r.outcome === "completed").length;
    const failedCount = jobResults.filter((r) => r.outcome === "failed").length;

    return { claimedCount: claimedJobs.length, completedCount, failedCount, jobResults };
  }

  private setupProcessSignals(): void {
    const onSignal = async (signal: string) => {
      console.log(`\n[WorkerRegistry] Received ${signal}. Shutting down worker fleet...`);
      await this.stop();
    };

    process.once("SIGTERM", () => onSignal("SIGTERM"));
    process.once("SIGINT", () => onSignal("SIGINT"));
  }

  /**
   * Diagnostic inspection of active workers.
   */
  getStatus() {
    return {
      workerId: this.workerId,
      isRunning: this.isRunning,
      isShuttingDown: this.isShuttingDown,
      activeJobsCount: this.activeJobs.size,
      activeJobIds: Array.from(this.activeJobs),
      concurrencyLimit: this.concurrencyLimit,
    };
  }
}
