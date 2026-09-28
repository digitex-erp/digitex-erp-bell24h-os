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
 * — the same shape QueueManager.enqueueJob() already uses. The API route
 * resolves organizationId from the authenticated caller's own token
 * (req.auth.organizationId from requireAuth), never from the request body,
 * before calling into this service.
 *
 * Sprint C0 hardening implemented here:
 *  - input validation (recipient / subject / body) before anything is stored;
 *  - per-organization, per-channel rolling 24h quota, enforced under an advisory
 *    lock so concurrent requests cannot jointly overshoot it;
 *  - idempotency keys: one (organizationId, idempotencyKey) -> one message, one job;
 *  - a cap on manual retries (messages.max_retries).
 */

import type pg from "pg";
import { QueueManager } from "../queue/QueueManager.js";
import { emitAuditEvent, newRequestId } from "../audit.js";
import { assertNotSuppressed } from "./SuppressionService.js";
import { buildTemplateParameters, type ProviderTemplateRef } from "./whatsappTemplate.js";
import type {
  ChannelType,
  CommunicationMessage,
  ScheduleMessageInput,
  SendMessageInput,
} from "./types.js";
import {
  CommunicationValidationError,
  validateBody,
  validateChannel,
  validateIdempotencyKey,
  validateRecipient,
  validateSubject,
} from "./validation.js";

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

export class QuotaExceededError extends Error {
  readonly code = "quota_exceeded";
  constructor(
    public readonly channelType: ChannelType,
    public readonly limit: number,
  ) {
    super(`Organization quota reached: at most ${limit} ${channelType} messages per rolling 24 hours.`);
  }
}

export class IdempotencyKeyReuseError extends Error {
  readonly code = "idempotency_key_reuse";
  constructor() {
    super("This Idempotency-Key was already used for a different message (channel or recipient differ).");
  }
}

/** Default rolling-24h ceilings per organization and channel. Override with COMM_QUOTA_<CHANNEL>_PER_DAY. */
const DEFAULT_DAILY_QUOTA: Record<string, number> = { email: 1000, sms: 200, whatsapp: 500 };

export function getDailyQuota(channel: ChannelType, env: NodeJS.ProcessEnv = process.env): number {
  const fallback = DEFAULT_DAILY_QUOTA[channel] ?? 0;
  const raw = env[`COMM_QUOTA_${channel.toUpperCase()}_PER_DAY`];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  // A malformed override must never silently disable the limit.
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

export type SendResult = CommunicationMessage & { deduplicated: boolean };

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
  ): Promise<{ subject: string | null; body: string; providerTemplate: ProviderTemplateRef | null }> {
    if (!input.templateId) {
      if (!input.body) throw new CommunicationValidationError("body", "either templateId or body is required");
      return { subject: validateSubject(input.subject), body: validateBody(input.body), providerTemplate: null };
    }
    // The mapping columns are only read for WhatsApp, so email / SMS sends do not depend on them.
    const res = await this.pool.query(
      input.channelType === "whatsapp"
        ? `SELECT subject, body, provider_template_name, provider_template_language, provider_template_variables
             FROM public.communication_templates WHERE id = $1 AND organization_id = $2 AND is_active = true`
        : `SELECT subject, body FROM public.communication_templates
             WHERE id = $1 AND organization_id = $2 AND is_active = true`,
      [input.templateId, organizationId],
    );
    if (res.rows.length === 0) {
      throw new CommunicationValidationError("templateId", "template not found or inactive for this organization");
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
    // Re-validated AFTER substitution: a variable value can carry CR/LF into the subject.
    const row = res.rows[0];
    // A WhatsApp template mapped to a Meta template is sent AS that template: every mapped variable must have a
    // real value for this recipient, otherwise the send is refused (fail closed, reported as a validation error).
    const providerTemplate: ProviderTemplateRef | null = row.provider_template_name
      ? {
          name: row.provider_template_name,
          language: row.provider_template_language ?? "en",
          parameters: buildTemplateParameters(Array.isArray(row.provider_template_variables) ? row.provider_template_variables : [], input.variables),
        }
      : null;
    return {
      subject: validateSubject(substitute(row.subject)),
      body: validateBody(substitute(row.body)),
      providerTemplate,
    };
  }

  /**
   * Validates, applies idempotency and quota, and inserts the message row — all
   * inside one transaction that holds a per-(org, channel) advisory lock. The
   * lock is what makes "count, then insert" safe under concurrency.
   */
  private async createMessageRecord(
    input: SendMessageInput,
    resolved: { subject: string | null; body: string; providerTemplate?: ProviderTemplateRef | null },
    status: "queued" | "scheduled",
    scheduledAt: Date | null,
  ): Promise<{ message: CommunicationMessage; deduplicated: boolean }> {
    const { organizationId, channelType, recipient } = input;
    const idempotencyKey = input.idempotencyKey ?? null;

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `comm-quota:${organizationId}:${channelType}`,
      ]);

      if (idempotencyKey) {
        const existing = await client.query(
          `SELECT * FROM public.communication_messages WHERE organization_id = $1 AND idempotency_key = $2`,
          [organizationId, idempotencyKey],
        );
        if (existing.rows.length > 0) {
          await client.query("COMMIT");
          const row = existing.rows[0] as CommunicationMessage;
          if (row.channel_type !== channelType || row.recipient !== recipient) throw new IdempotencyKeyReuseError();
          return { message: row, deduplicated: true };
        }
      }

      const limit = getDailyQuota(channelType);
      const used = await client.query(
        `SELECT COUNT(*)::int AS n FROM public.communication_messages
         WHERE organization_id = $1 AND channel_type = $2
           AND created_at > NOW() - INTERVAL '24 hours' AND status <> 'cancelled'`,
        [organizationId, channelType],
      );
      if ((used.rows[0].n as number) >= limit) {
        await client.query("ROLLBACK");
        throw new QuotaExceededError(channelType, limit);
      }

      const inserted = await client.query(
        `INSERT INTO public.communication_messages (
           organization_id, channel_type, template_id, campaign_id, recipient,
           subject, body, variables_used, status, scheduled_at, created_by, idempotency_key, is_test
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [
          organizationId,
          channelType,
          input.templateId ?? null,
          input.campaignId ?? null,
          recipient,
          resolved.subject,
          resolved.body,
          JSON.stringify(input.variables ?? {}),
          status,
          scheduledAt,
          input.createdBy ?? null,
          idempotencyKey,
          input.isTest === true,
        ],
      );
      if (resolved.providerTemplate) {
        const withTemplate = await client.query(
          `UPDATE public.communication_messages SET provider_template = $1::jsonb WHERE id = $2 RETURNING *`,
          [JSON.stringify(resolved.providerTemplate), inserted.rows[0].id],
        );
        inserted.rows[0] = withTemplate.rows[0];
      }
      await client.query("COMMIT");
      return { message: inserted.rows[0] as CommunicationMessage, deduplicated: false };
    } catch (err) {
      // No-op if already committed / rolled back; keeps the connection clean before release.
      await client.query("ROLLBACK").catch(() => undefined);
      // Same key racing on a DIFFERENT channel takes a different advisory lock, so the
      // unique index is the backstop. That is by definition key reuse, not a server fault.
      if ((err as { code?: string }).code === "23505" && String((err as { constraint?: string }).constraint).includes("idempotency")) {
        throw new IdempotencyKeyReuseError();
      }
      throw err;
    } finally {
      client.release();
    }
  }

  private validateInput(input: SendMessageInput): SendMessageInput {
    const channelType = validateChannel(input.channelType);
    return {
      ...input,
      channelType,
      recipient: validateRecipient(channelType, input.recipient),
      idempotencyKey: input.idempotencyKey === undefined ? undefined : validateIdempotencyKey(input.idempotencyKey),
    };
  }

  private async attachJobId(messageId: string, jobId: string): Promise<void> {
    await this.pool.query(`UPDATE public.communication_messages SET job_id = $1, updated_at = NOW() WHERE id = $2`, [
      jobId,
      messageId,
    ]);
  }

  /**
   * Enqueue is itself idempotent per message (job_queue's own
   * (organization_id, idempotency_key) unique index), so a crash between the
   * message INSERT and the enqueue is repaired by simply replaying the request.
   */
  private async enqueueForMessage(
    message: CommunicationMessage,
    priority: "high" | "medium",
    scheduledAt?: Date,
  ): Promise<string> {
    const job = await this.queueManager.enqueueJob({
      organizationId: message.organization_id,
      jobType: "communication",
      payload: { messageId: message.id },
      priority,
      scheduledAt,
      idempotencyKey: `comm-msg:${message.id}:${message.retry_count}`,
    });
    await this.attachJobId(message.id, job.id);
    return job.id;
  }

  /** Immediate send: enqueues at job_queue priority "high", runs as soon as a worker claims it. */
  async sendMessage(rawInput: SendMessageInput): Promise<SendResult> {
    const requestId = newRequestId();
    const input = this.validateInput(rawInput);
    // A replay of an already-accepted send (same idempotency key) is answered as before; a NEW send to a
    // suppressed address is refused before anything is stored or queued.
    await assertNotSuppressed(this.pool, input.organizationId, input.channelType, input.recipient);
    const resolved = await this.resolveTemplateIfNeeded(input.organizationId, input);
    const { message, deduplicated } = await this.createMessageRecord(input, resolved, "queued", null);

    if (deduplicated && message.job_id) {
      return { ...message, deduplicated: true };
    }

    const jobId = await this.enqueueForMessage(message, "high");

    if (!deduplicated) {
      emitAuditEvent({
        actor: input.createdBy ?? null,
        organizationId: input.organizationId,
        action: "communication.message.enqueued",
        targetType: "communication_message",
        targetId: message.id,
        outcome: "success",
        requestId,
        metadata: { channelType: input.channelType, jobId },
      });
    }

    return { ...message, job_id: jobId, deduplicated };
  }

  /**
   * Sends each input sequentially via sendMessage(). Not batch-optimized —
   * a single-INSERT bulk path is a real future improvement, not implemented
   * in this slice; do not assume this is fast at high volume. Every item goes
   * through the same validation and quota as a single send.
   */
  async sendBulkMessages(inputs: SendMessageInput[]): Promise<SendResult[]> {
    const results: SendResult[] = [];
    for (const input of inputs) {
      results.push(await this.sendMessage(input));
    }
    return results;
  }

  async scheduleMessage(rawInput: ScheduleMessageInput): Promise<SendResult> {
    const requestId = newRequestId();
    const input = { ...this.validateInput(rawInput), scheduledAt: rawInput.scheduledAt };
    await assertNotSuppressed(this.pool, input.organizationId, input.channelType, input.recipient);
    const resolved = await this.resolveTemplateIfNeeded(input.organizationId, input);
    const { message, deduplicated } = await this.createMessageRecord(input, resolved, "scheduled", input.scheduledAt);

    if (deduplicated && message.job_id) {
      return { ...message, deduplicated: true };
    }

    const jobId = await this.enqueueForMessage(message, "medium", input.scheduledAt);

    if (!deduplicated) {
      emitAuditEvent({
        actor: input.createdBy ?? null,
        organizationId: input.organizationId,
        action: "communication.message.scheduled",
        targetType: "communication_message",
        targetId: message.id,
        outcome: "success",
        requestId,
        metadata: { channelType: input.channelType, jobId, scheduledAt: input.scheduledAt.toISOString() },
      });
    }

    return { ...message, job_id: jobId, deduplicated };
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
         WHERE id = $1 AND organization_id = $2 AND status IN ('queued', 'blocked')`,
        [current.job_id, organizationId],
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
   * Capped at messages.max_retries so retry cannot be used as an unbounded
   * re-send button against a paid provider.
   */
  async retryFailedMessage(organizationId: string, messageId: string, actor: string | null = null): Promise<CommunicationMessage> {
    const requestId = newRequestId();
    const current = await this.getMessageStatus(organizationId, messageId);
    if (!current) throw new MessageNotFoundError(messageId);
    if (!["failed", "dead_letter"].includes(current.status)) {
      throw new InvalidStateTransitionError(messageId, current.status, "retried");
    }
    if (current.retry_count >= current.max_retries) {
      throw new InvalidStateTransitionError(messageId, current.status, "retried (manual retry limit reached)");
    }

    const job = await this.queueManager.enqueueJob({
      organizationId,
      jobType: "communication",
      payload: { messageId },
      priority: "high",
      idempotencyKey: `comm-msg:${messageId}:${current.retry_count + 1}`,
    });

    await this.pool.query(
      `UPDATE public.communication_messages
       SET status = 'queued', job_id = $1, retry_count = retry_count + 1,
           error_message = NULL, updated_at = NOW()
       WHERE id = $2 AND organization_id = $3`,
      [job.id, messageId, organizationId],
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
