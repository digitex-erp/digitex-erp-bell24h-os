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

    // Simulate external GPU rendering pipeline latency (e.g. 500ms)
    await new Promise((resolve) => setTimeout(resolve, 500));

    const assetUrl = `https://storage.bell24h.com/image_assets/${job.organization_id}/${jobId}_render.webp`;

    // 1. Update image_jobs table
    if (payload.job_id) {
      await this.pool.query(
        `
        UPDATE public.image_jobs
        SET status = 'completed', completed_at = NOW()
        WHERE id = $1 AND organization_id = $2;
        `,
        [payload.job_id, organization_id]
      );
    }

    // 2. Insert into image_assets table
    if (payload.project_id) {
      await this.pool.query(
        `
        INSERT INTO public.image_assets (
          job_id,
          project_id,
          asset_url,
          prompt,
          negative_prompt,
          provider,
          model,
          resolution,
          organization_id,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW());
        `,
        [
          payload.job_id || jobId,
          payload.project_id,
          assetUrl,
          payload.prompt,
          payload.negative_prompt || null,
          payload.providerId || "flux",
          payload.model || "flux-1-schnell",
          payload.aspect_ratio || "1:1",
          organization_id,
        ]
      );
    }

    emitAuditEvent({
      actor: "service:worker",
      organizationId: organization_id,
      action: "job.media.image_completed",
      targetType: "job_queue",
      targetId: jobId,
      outcome: "success",
      requestId,
      metadata: { assetUrl, model: payload.model },
    });

    return { assetUrl, status: "completed" };
  }

  private async processVideoJob(job: QueueJob<MediaJobPayload>, requestId: string): Promise<any> {
    const { payload, organization_id, id: jobId } = job;

    // Simulate external video rendering pipeline latency
    await new Promise((resolve) => setTimeout(resolve, 800));

    const assetUrl = `https://storage.bell24h.com/video_assets/${job.organization_id}/${jobId}_master.mp4`;
    const thumbnailUrl = `https://storage.bell24h.com/video_assets/${job.organization_id}/${jobId}_thumb.webp`;

    // 1. Update video_jobs table
    if (payload.job_id) {
      await this.pool.query(
        `
        UPDATE public.video_jobs
        SET status = 'completed', completed_at = NOW()
        WHERE id = $1 AND organization_id = $2;
        `,
        [payload.job_id, organization_id]
      );
    }

    // 2. Insert into video_assets table
    if (payload.project_id) {
      await this.pool.query(
        `
        INSERT INTO public.video_assets (
          job_id,
          project_id,
          asset_url,
          thumbnail_url,
          video_type,
          prompt,
          provider,
          model,
          resolution,
          duration,
          organization_id,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW());
        `,
        [
          payload.job_id || jobId,
          payload.project_id,
          assetUrl,
          thumbnailUrl,
          payload.video_type || "reel",
          payload.prompt,
          payload.providerId || "opensora",
          payload.model || "opensora-1.2",
          payload.quality || "1080p",
          payload.duration || "15s",
          organization_id,
        ]
      );
    }

    emitAuditEvent({
      actor: "service:worker",
      organizationId: organization_id,
      action: "job.media.video_completed",
      targetType: "job_queue",
      targetId: jobId,
      outcome: "success",
      requestId,
      metadata: { assetUrl, duration: payload.duration },
    });

    return { assetUrl, thumbnailUrl, status: "completed" };
  }
}
