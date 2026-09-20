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

    // Stage A (honest failure): no real channel-dispatch integration (LinkedIn,
    // Twitter/X, Facebook, Instagram, YouTube) is wired yet. This previously
    // simulated a dispatch delay and fabricated a "published" result with a
    // synthetic post ID that no channel ever issued. Stage B (real channel
    // adapters) is tracked separately — see
    // docs/project/BELL24H_OS_P0_REMEDIATION_IMPLEMENTATION_PLAN.md Phase 2.
    //
    // Note: PublishingCenterService.enqueuePublishingTask() has zero call sites
    // in the repository today, so this handler is also unreachable from the
    // enqueue side — recorded, not fixed, as out of scope for this change.
    const errorMessage =
      "PROVIDER_NOT_CONFIGURED: no publishing channel integration is wired yet.";

    if (payload.queue_id) {
      await this.pool.query(
        `
        UPDATE public.publishing_queue
        SET status = 'failed'
        WHERE id = $1 AND organization_id = $2;
        `,
        [payload.queue_id, organization_id]
      );

      await this.pool.query(
        `
        INSERT INTO public.publishing_logs (
          organization_id,
          queue_id,
          log
        ) VALUES ($1, $2, $3);
        `,
        [organization_id, payload.queue_id, errorMessage]
      );
    }

    emitAuditEvent({
      actor: "service:worker",
      organizationId: organization_id,
      action: "job.publishing.failed",
      targetType: "job_queue",
      targetId: jobId,
      outcome: "failure",
      requestId,
      metadata: { channel: payload.channel_type, reason: "PROVIDER_NOT_CONFIGURED" },
    });

    throw new Error(errorMessage);
  }
}
