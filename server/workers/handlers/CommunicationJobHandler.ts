/**
 * Communication Job Handler — Communication Hub worker fleet integration.
 *
 * Follows the exact shape of AIJobHandler / MediaJobHandler / PublishingJobHandler:
 * handle(job) either returns a result (WorkerRegistry calls completeJob) or
 * throws (WorkerRegistry calls failJob, which applies job_queue's own
 * retry_count/max_retries policy and dead-letters automatically — no new
 * retry/dead-letter mechanism is built here, per add_communication_hub.sql).
 *
 * Failover: tries each active communication_providers row for the message's
 * channel_type, in priority order, until one adapter.send() succeeds. Every
 * attempt is persisted to communication_deliveries (append-only) — that
 * table is the durable record of the failover chain; communication_messages
 * holds only the final outcome.
 */

import pg from "pg";
import { QueueJob } from "../../queue/QueueTypes.js";
import { emitAuditEvent, newRequestId } from "../../audit.js";
import { ProviderFactory, MissingSecretError, SecretNotAllowedError, UnknownProviderError } from "../../communication/providers/ProviderFactory.js";
import type { CommunicationMessage } from "../../communication/types.js";

export interface CommunicationJobPayload {
  messageId: string;
}

interface ProviderRow {
  id: string;
  provider: string;
  credentials_secret_ref: string;
  settings: Record<string, unknown>;
  priority: number;
}

export class CommunicationJobHandler {
  private pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async handle(job: QueueJob<CommunicationJobPayload>): Promise<any> {
    const { payload, organization_id, retry_count, max_retries } = job;
    const requestId = newRequestId();

    if (!payload?.messageId) {
      throw new Error("Invalid communication job payload: missing 'messageId'.");
    }

    const messageRes = await this.pool.query(
      `SELECT * FROM public.communication_messages WHERE id = $1 AND organization_id = $2`,
      [payload.messageId, organization_id],
    );
    if (messageRes.rowCount === 0) {
      throw new Error(`Communication message ${payload.messageId} not found for org ${organization_id}.`);
    }
    const message = messageRes.rows[0] as CommunicationMessage;

    if (message.status === "sent" || message.status === "delivered") {
      // Worker-side idempotency (Sprint C0 / B3): if an earlier attempt already reached the
      // provider and recorded success, a re-run of this job (crash after the provider call,
      // lock-expiry reclaim, duplicate enqueue) must not send a second copy.
      return { skipped: true, reason: "already_sent" };
    }

    if (message.status === "cancelled") {
      // Message was cancelled after being enqueued but before this attempt ran.
      // Not a failure — nothing to send.
      return { skipped: true, reason: "cancelled" };
    }

    const providersRes = await this.pool.query(
      `SELECT id, provider, credentials_secret_ref, settings, priority
       FROM public.communication_providers
       WHERE channel_type = $1 AND organization_id = $2 AND is_active = true
       ORDER BY priority ASC`,
      [message.channel_type, organization_id],
    );
    const providers = providersRes.rows as ProviderRow[];

    if (providers.length === 0) {
      const errorMessage = "PROVIDER_NOT_CONFIGURED: no active provider for this channel type.";
      await this.markFailed(job, message, errorMessage, requestId);
      throw new Error(errorMessage);
    }

    let attemptNumber = 0;
    const attempts: Array<{ provider: string; error: string }> = [];

    for (const row of providers) {
      attemptNumber++;
      try {
        const adapter = ProviderFactory.getAdapter(row.provider);
        const resolved = ProviderFactory.buildResolvedConfig(row.provider, row.credentials_secret_ref, row.settings || {});
        const result = await adapter.send(
          {
            recipient: message.recipient,
            subject: message.subject ?? undefined,
            body: message.body || "",
            // Stable across worker retries of the same send; a manual retry gets a new value.
            idempotencyKey: `comm-msg:${message.id}:${message.retry_count}`,
          },
          resolved,
        );

        await this.recordDelivery(organization_id, message.id, row, attemptNumber, result.success ? "success" : "failed", result);

        if (result.success) {
          await this.pool.query(
            `UPDATE public.communication_messages
             SET status = 'sent', sent_at = NOW(), provider_message_id = $1, provider_id = $2, updated_at = NOW()
             WHERE id = $3`,
            [result.providerMessageId ?? null, row.id, message.id],
          );

          emitAuditEvent({
            actor: "service:worker",
            organizationId: organization_id,
            action: "job.communication.sent",
            targetType: "communication_message",
            targetId: message.id,
            outcome: "success",
            requestId,
            metadata: { provider: row.provider, providerMessageId: result.providerMessageId },
          });

          return { provider: row.provider, providerMessageId: result.providerMessageId };
        }

        attempts.push({ provider: row.provider, error: result.errorMessage || "send() returned success:false" });
      } catch (err: any) {
        const reason =
          err instanceof MissingSecretError || err instanceof SecretNotAllowedError || err instanceof UnknownProviderError
            ? err.message
            : err?.message || String(err);
        attempts.push({ provider: row.provider, error: reason });
        await this.recordDelivery(organization_id, message.id, row, attemptNumber, "failed", { errorMessage: reason });
      }
    }

    // Every configured provider failed (or none were usable).
    const errorMessage = `All ${attempts.length} provider(s) failed: ${JSON.stringify(attempts)}`;
    await this.markFailed(job, message, errorMessage, requestId);
    throw new Error(errorMessage);
  }

  private async recordDelivery(
    organizationId: string,
    messageId: string,
    row: ProviderRow,
    attemptNumber: number,
    status: "success" | "failed",
    result: { providerMessageId?: string; errorMessage?: string; raw?: unknown },
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO public.communication_deliveries (
         organization_id, message_id, provider_id, provider, attempt_number,
         status, provider_message_id, error_message, raw_response
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        organizationId,
        messageId,
        row.id,
        row.provider,
        attemptNumber,
        status,
        result.providerMessageId ?? null,
        result.errorMessage ?? null,
        result.raw ? JSON.stringify(result.raw) : null,
      ],
    );
  }

  /**
   * Sets message.status. Uses job_queue's own dead-letter formula
   * (retry_count + 1 >= max_retries — see QueueManager.failJob) to predict
   * whether THIS attempt is terminal, so the message row reflects the same
   * outcome job_queue is about to record — not a separate guess.
   */
  private async markFailed(
    job: QueueJob<CommunicationJobPayload>,
    message: CommunicationMessage,
    errorMessage: string,
    requestId: string,
  ): Promise<void> {
    const willDeadLetter = job.retry_count + 1 >= job.max_retries;
    const status = willDeadLetter ? "dead_letter" : "failed";

    await this.pool.query(
      `UPDATE public.communication_messages
       SET status = $1, error_message = $2, updated_at = NOW()
       WHERE id = $3`,
      [status, errorMessage, message.id],
    );

    emitAuditEvent({
      actor: "service:worker",
      organizationId: job.organization_id,
      action: willDeadLetter ? "job.communication.dead_lettered" : "job.communication.failed",
      targetType: "communication_message",
      targetId: message.id,
      outcome: "failure",
      requestId,
      metadata: { errorMessage, retryCount: job.retry_count, maxRetries: job.max_retries },
    });
  }
}
