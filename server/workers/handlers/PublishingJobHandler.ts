/**
 * Bell24h-OS Enterprise Edition
 * Publishing Job Handler — Social & Channel Distribution
 * Phase: B.5B.2 Worker Fleet Subsystem
 */

import pg from "pg";
import { QueueJob } from "../../queue/QueueTypes.js";
import { newRequestId, emitAuditEvent } from "../../audit.js";

export interface PublishingJobPayload {
  queue_id?: string;
  media_package_id?: string;
  channel_id?: string;
  channel_type?: "linkedin" | "twitter" | "facebook" | "instagram" | "youtube" | "whatsapp";
  content?: string;
  media_url?: string;
  scheduled_at?: string;
}

export class PublishingJobHandler {
  private pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  /**
   * Executes a publishing/distribution task.
   */
  async handle(job: QueueJob<PublishingJobPayload>): Promise<any> {
    const { payload, organization_id, id: jobId } = job;
    const requestId = newRequestId();

    // Simulate channel dispatch
    await new Promise((resolve) => setTimeout(resolve, 300));

    const externalPostId = `post_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // 1. Update publishing_queue record if linked
    if (payload.queue_id) {
      await this.pool.query(
        `
        UPDATE public.publishing_queue
        SET status = 'published'
        WHERE id = $1 AND organization_id = $2;
        `,
        [payload.queue_id, organization_id]
      );

      // 2. Insert into publishing_history
      await this.pool.query(
        `
        INSERT INTO public.publishing_history (
          queue_id,
          organization_id,
          published_at,
          result
        ) VALUES ($1, $2, NOW(), $3);
        `,
        [
          payload.queue_id,
          organization_id,
          JSON.stringify({ externalPostId, channel: payload.channel_type || "web", status: "published" }),
        ]
      );
    }

    emitAuditEvent({
      actor: "service:worker",
      organizationId: organization_id,
      action: "job.publishing.completed",
      targetType: "job_queue",
      targetId: jobId,
      outcome: "success",
      requestId,
      metadata: { externalPostId, channel: payload.channel_type },
    });

    return {
      externalPostId,
      status: "published",
      publishedAt: new Date().toISOString(),
    };
  }
}
