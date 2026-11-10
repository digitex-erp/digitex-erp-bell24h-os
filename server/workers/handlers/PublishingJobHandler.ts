/**
 * Bell24h-OS Enterprise Edition
 * Publishing Job Handler — Social & Channel Distribution
 * Phase: B.5B.2 Worker Fleet Subsystem
 */

import pg from "pg";
import { QueueJob } from "../../queue/QueueTypes.js";
import { newRequestId, emitAuditEvent } from "../../audit.js";
import { CapabilityNotImplementedError } from "../../lib/errors.js";

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
   * No publishing channel integration is wired in. This used to sleep, invent
   * a post ID and record the item as published; it now fails without writing
   * anything, so content can never look published when nothing was sent.
   */
  async handle(job: QueueJob<PublishingJobPayload>): Promise<never> {
    const requestId = newRequestId();
    const error = new CapabilityNotImplementedError("channel publishing");
    emitAuditEvent({
      actor: "service:worker",
      organizationId: job.organization_id,
      action: "job.publishing.failed",
      targetType: "job_queue",
      targetId: job.id,
      outcome: "failure",
      requestId,
      metadata: { errorCode: error.code, retryable: error.retryable },
    });
    throw error;
  }
}
