/**
 * Bell24h-OS Enterprise Edition
 * Media Job Handler — Long-Running Image & Video Processing
 * Phase: B.5B.2 Worker Fleet Subsystem
 */

import pg from "pg";
import { QueueJob } from "../../queue/QueueTypes.js";
import { QueueManager } from "../../queue/QueueManager.js";
import { newRequestId, emitAuditEvent } from "../../audit.js";

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
    const { payload, organization_id, id: jobId, job_type } = job;
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

  private async processImageJob(job: QueueJob<MediaJobPayload>, requestId: string): Promise<any> {
    const { payload, organization_id, id: jobId } = job;

    // Stage A (honest failure): no real image-generation provider is wired to
    // Image Studio yet. This previously simulated a GPU rendering delay and
    // fabricated a success row pointing at an asset that was never created.
    // Stage B (real provider integration, e.g. Flux/SDXL) is tracked separately —
    // see docs/project/BELL24H_OS_P0_REMEDIATION_IMPLEMENTATION_PLAN.md Phase 2.
    const errorMessage =
      "PROVIDER_NOT_CONFIGURED: no image-generation provider is wired to Image Studio yet.";

    if (payload.job_id) {
      await this.pool.query(
        `
        UPDATE public.image_jobs
        SET status = 'failed', error_message = $3, completed_at = NOW()
        WHERE id = $1 AND organization_id = $2;
        `,
        [payload.job_id, organization_id, errorMessage]
      );
    }

    emitAuditEvent({
      actor: "service:worker",
      organizationId: organization_id,
      action: "job.media.image_failed",
      targetType: "job_queue",
      targetId: jobId,
      outcome: "failure",
      requestId,
      metadata: { reason: "PROVIDER_NOT_CONFIGURED", model: payload.model },
    });

    throw new Error(errorMessage);
  }

  private async processVideoJob(job: QueueJob<MediaJobPayload>, requestId: string): Promise<any> {
    const { payload, organization_id, id: jobId } = job;

    // Stage A (honest failure): no real video-generation provider is wired to
    // Video Factory yet. This previously simulated a rendering delay and
    // fabricated a success row (asset + thumbnail URLs) pointing at files that
    // were never created. Stage B (real provider integration, e.g. OpenSora) is
    // tracked separately — see
    // docs/project/BELL24H_OS_P0_REMEDIATION_IMPLEMENTATION_PLAN.md Phase 2.
    const errorMessage =
      "PROVIDER_NOT_CONFIGURED: no video-generation provider is wired to Video Factory yet.";

    if (payload.job_id) {
      await this.pool.query(
        `
        UPDATE public.video_jobs
        SET status = 'failed', error_message = $3, completed_at = NOW()
        WHERE id = $1 AND organization_id = $2;
        `,
        [payload.job_id, organization_id, errorMessage]
      );
    }

    emitAuditEvent({
      actor: "service:worker",
      organizationId: organization_id,
      action: "job.media.video_failed",
      targetType: "job_queue",
      targetId: jobId,
      outcome: "failure",
      requestId,
      metadata: { reason: "PROVIDER_NOT_CONFIGURED", duration: payload.duration },
    });

    throw new Error(errorMessage);
  }
}
