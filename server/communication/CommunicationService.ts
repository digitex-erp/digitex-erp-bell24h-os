/**
 * CommunicationService — Communication Hub service layer.
 *
 * Server-only. Never import this from src/ (browser code) — it takes a raw pg
 * Pool and resolves secrets from process.env, exactly the pattern
 * src/modules/ai-providers/AiProviderService.ts's own header comment says
 * SHOULD have been used instead of loading provider credentials into the
 * browser. Do not repeat that mistake for communication provider credentials.
 *
 * Scheduling/retry/dead-letter deliberately reuse the existing job_queue
 * (QueueManager) rather than a new queue — see add_communication_hub.sql.
 * This service enqueues; CommunicationJobHandler (run by WorkerRegistry) is
 * what actually calls a provider adapter and updates message status.
 *
 * organizationId is always an explicit parameter, never resolved via RLS here
 * — the same shape QueueManager.enqueueJob() already uses. A future API route
 * must resolve organizationId from the authenticated caller's own token
 * (req.auth.organizationId from requireAuth), never accept it from the request
 * body, before calling into this service.
 */

import type pg from "pg";
import { QueueManager } from "../queue/QueueManager.js";
import { emitAuditEvent, newRequestId } from "../audit.js";
import type {
  CommunicationMessage,
  ScheduleMessageInput,
  SendMessageInput,
} from "./types.js";

export class MessageNotFoundError extends Error {
  constructor(id: string) {
    super(`Communication message ${id} not found in this organization.`);
  }
}

export class InvalidStateTransitionError extends Error {
  constructor(id: string, from: string, action: string) {
    super(`Message ${id} cannot be ${action} while in status "${from}".`);
  }
}

export class CommunicationService {
  private pool: pg.Pool;
  private queueManager: QueueManager;

  constructor(pool: pg.Pool) {
    this.pool = pool;
    this.queueManager = QueueManager.getInstance(pool);
  }

  private async resolveTemplateIfNeeded(
    organizationId: string,
    input: SendMessageInput,
  ): Promise<{ subject: string | null; body: string }> {
    if (!input.templateId) {
      if (!input.body) throw new Error("sendMessage requires either templateId or body.");
      return { subject: input.subject ?? null, body: input.body };
    }
    const res = await this.pool.query(
      `SELECT subject, body FROM public.communication_templates
       WHERE id = $1 AND organization_id = $2 AND is_active = true`,
      [input.templateId, organizationId],
    );
    if (res.rows.length === 0) {
      throw new Error(`Template ${input.templateId} not found or inactive for this organization.`);
    }
    // Variable substitution: {{var}} -> value. Kept intentionally simple for
    // this slice — no conditional/loop templating.
    const substitute = (text: string | null) => {
      if (!text) return text;
      return text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        const val = input.variables?.[key];
        return val === undefined ? `{{${key}}}` : String(val);
      });
    };
    return { subject: substitute(res.rows[0].subject), body: substitute(res.rows[0].body) as string };
  }

  private async insertMessageRow(
    organizationId: string,
    input: SendMessageInput,
    resolved: { subject: string | null; body: string },
    status: "queued" | "scheduled",
    scheduledAt: Date | null,
  ): Promise<CommunicationMessage> {
    const res = await this.pool.query(
      `INSERT INTO public.communication_messages (
         organization_id, channel_type, template_id, campaign_id, recipient,
         subject, body, variables_used, status, scheduled_at, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        organizationId,
        input.channelType,
        input.templateId ?? null,
        input.campaignId ?? null,
        input.recipient,
        resolved.subject,
        resolved.body,
        JSON.stringify(input.variables ?? {}),
        status,
        scheduledAt,
        input.createdBy ?? null,
      ],
    );
    return res.rows[0] as CommunicationMessage;
  }

  private async attachJobId(messageId: string, jobId: string): Promise<void> {
    await this.pool.query(`UPDATE public.communication_messages SET job_id = $1, updated_at = NOW() WHERE id = $2`, [
      jobId,
      messageId,
    ]);
  }

  /** Immediate send: enqueues at job_queue priority "high", runs as soon as a worker claims it. */
  async sendMessage(input: SendMessageInput): Promise<CommunicationMessage> {
    const requestId = newRequestId();
    const resolved = await this.resolveTemplateIfNeeded(input.organizationId, input);
    const message = await this.insertMessageRow(input.organizationId, input, resolved, "queued", null);

    const job = await this.queueManager.enqueueJob({
      organizationId: input.organizationId,
      jobType: "communication",
      payload: { messageId: message.id },
      priority: "high",
    });
    await this.attachJobId(message.id, job.id);

    emitAuditEvent({
      actor: input.createdBy ?? null,
      organizationId: input.organizationId,
      action: "communication.message.enqueued",
      targetType: "communication_message",
      targetId: message.id,
      outcome: "success",
      requestId,
      metadata: { channelType: input.channelType, jobId: job.id },
    });

    return { ...message, job_id: job.id };
  }

  /**
   * Sends each input sequentially via sendMessage(). Not batch-optimized —
   * a single-INSERT bulk path is a real future improvement, not implemented
   * in this slice; do not assume this is fast at high volume.
   */
  async sendBulkMessages(inputs: SendMessageInput[]): Promise<CommunicationMessage[]> {
    const results: CommunicationMessage[] = [];
    for (const input of inputs) {
      results.push(await this.sendMessage(input));
    }
    return results;
  }

  async scheduleMessage(input: ScheduleMessageInput): Promise<CommunicationMessage> {
    const requestId = newRequestId();
    const resolved = await this.resolveTemplateIfNeeded(input.organizationId, input);
    const message = await this.insertMessageRow(input.organizationId, input, resolved, "scheduled", input.scheduledAt);

    const job = await this.queueManager.enqueueJob({
      organizationId: input.organizationId,
      jobType: "communication",
      payload: { messageId: message.id },
      priority: "medium",
      scheduledAt: input.scheduledAt,
    });
    await this.attachJobId(message.id, job.id);

    emitAuditEvent({
      actor: input.createdBy ?? null,
      organizationId: input.organizationId,
      action: "communication.message.scheduled",
      targetType: "communication_message",
      targetId: message.id,
      outcome: "success",
      requestId,
      metadata: { channelType: input.channelType, jobId: job.id, scheduledAt: input.scheduledAt.toISOString() },
    });

    return { ...message, job_id: job.id };
  }

  /** Only queued/scheduled messages can be cancelled — a message already sending/sent is not revocable. */
  async cancelMessage(organizationId: string, messageId: string, actor: string | null = null): Promise<void> {
    const requestId = newRequestId();
    const current = await this.getMessageStatus(organizationId, messageId);
    if (!current) throw new MessageNotFoundError(messageId);
    if (!["queued", "scheduled"].includes(current.status)) {
      throw new InvalidStateTransitionError(messageId, current.status, "cancelled");
    }

    await this.pool.query(
      `UPDATE public.communication_messages SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND organization_id = $2`,
      [messageId, organizationId],
    );
    if (current.job_id) {
      await this.pool.query(
        `UPDATE public.job_queue SET status = 'cancelled', updated_at = NOW()
         WHERE id = $1 AND status IN ('queued', 'blocked')`,
        [current.job_id],
      );
    }
    emitAuditEvent({
      actor,
      organizationId,
      action: "communication.message.cancelled",
      targetType: "communication_message",
      targetId: messageId,
      outcome: "success",
      requestId,
    });
  }

  async getMessageStatus(organizationId: string, messageId: string): Promise<CommunicationMessage | null> {
    const res = await this.pool.query(
      `SELECT * FROM public.communication_messages WHERE id = $1 AND organization_id = $2`,
      [messageId, organizationId],
    );
    return (res.rows[0] as CommunicationMessage) ?? null;
  }

  /**
   * Re-enqueues a failed/dead-lettered message as a brand-new job_queue row.
   * This is an explicit, user/operator-triggered retry — distinct from the
   * worker fleet's own automatic retry_count-based retries inside job_queue.
   */
  async retryFailedMessage(organizationId: string, messageId: string, actor: string | null = null): Promise<CommunicationMessage> {
    const requestId = newRequestId();
    const current = await this.getMessageStatus(organizationId, messageId);
    if (!current) throw new MessageNotFoundError(messageId);
    if (!["failed", "dead_letter"].includes(current.status)) {
      throw new InvalidStateTransitionError(messageId, current.status, "retried");
    }

    const job = await this.queueManager.enqueueJob({
      organizationId,
      jobType: "communication",
      payload: { messageId },
      priority: "high",
    });

    await this.pool.query(
      `UPDATE public.communication_messages
       SET status = 'queued', job_id = $1, retry_count = retry_count + 1,
           error_message = NULL, updated_at = NOW()
       WHERE id = $2`,
      [job.id, messageId],
    );

    emitAuditEvent({
      actor,
      organizationId,
      action: "communication.message.retried",
      targetType: "communication_message",
      targetId: messageId,
      outcome: "success",
      requestId,
      metadata: { newJobId: job.id, previousRetryCount: current.retry_count },
    });

    return (await this.getMessageStatus(organizationId, messageId)) as CommunicationMessage;
  }
}
