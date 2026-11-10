/**
 * Bell24h-OS Enterprise Edition
 * Media Job Handler — Long-Running Image & Video Processing
 * Phase: B.5B.2 Worker Fleet Subsystem
 */

import pg from "pg";
import { QueueJob } from "../../queue/QueueTypes.js";
import { QueueManager } from "../../queue/QueueManager.js";
import { newRequestId, emitAuditEvent } from "../../audit.js";
import { CapabilityNotImplementedError } from "../../lib/errors.js";

export interface MediaJobPayload {
  prompt: string;
  negative_prompt?: string;
  aspect_ratio?: string;
  batch_size?: number;
  model?: string;
  providerId?: string;
  job_id?: string;
  project_id?: string;
  duration?: string;
  quality?: string;
  video_type?: string;
}

export class MediaJobHandler {
  private pool: pg.Pool;
  private queueManager: QueueManager;

  constructor(pool: pg.Pool, queueManager: QueueManager) {
    this.pool = pool;
    this.queueManager = queueManager;
  }

  /**
   * Executes an asynchronous media task with in-flight lease renewal.
   */
  async handle(job: QueueJob<MediaJobPayload>, workerId: string): Promise<any> {
    const { id: jobId, job_type } = job;
    const requestId = newRequestId();

    // Start periodic heartbeat timer to extend worker lease every 25 seconds
    const heartbeatInterval = setInterval(async () => {
      try {
        await this.queueManager.heartbeat({
          jobId,
          workerId,
          extendLockMs: 120000, // Extend by 2 minutes
        });
      } catch (err: any) {
        console.warn(`[MediaJobHandler] Heartbeat failed for job ${jobId}:`, err.message);
      }
    }, 25000);

    try {
      if (job_type === "image") {
        return await this.processImageJob(job, requestId);
      } else if (job_type === "video") {
        return await this.processVideoJob(job, requestId);
      } else {
        throw new Error(`Unsupported media job type: ${job_type}`);
      }
    } finally {
      clearInterval(heartbeatInterval);
    }
  }

  // No image provider is wired in. This used to sleep, invent a storage URL
  // and record success; it now fails without writing anything, so a job can
  // never look completed when no image exists.
  private async processImageJob(job: QueueJob<MediaJobPayload>, requestId: string): Promise<never> {
    return this.failNotImplemented(job, requestId, "image");
  }

  // Same as processImageJob: no video provider is wired in.
  private async processVideoJob(job: QueueJob<MediaJobPayload>, requestId: string): Promise<never> {
    return this.failNotImplemented(job, requestId, "video");
  }

  private failNotImplemented(job: QueueJob<MediaJobPayload>, requestId: string, kind: "image" | "video"): never {
    const error = new CapabilityNotImplementedError(`${kind} generation`);
    emitAuditEvent({
      actor: "service:worker",
      organizationId: job.organization_id,
      action: `job.media.${kind}_failed`,
      targetType: "job_queue",
      targetId: job.id,
      outcome: "failure",
      requestId,
      metadata: { errorCode: error.code, retryable: error.retryable },
    });
    throw error;
  }
}
