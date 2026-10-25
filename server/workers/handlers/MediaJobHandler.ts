/**
 * Bell24h-OS Enterprise Edition
 * Media Job Handler — Long-Running Image & Video Processing
 * Phase: B.5B.2 Worker Fleet Subsystem
 */

import pg from "pg";
import { QueueJob } from "../../queue/QueueTypes.js";
import { QueueManager } from "../../queue/QueueManager.js";
import { newRequestId, emitAuditEvent } from "../../audit.js";
import { getCredential, ProviderCredentialError } from "../../ai/ProviderManager.js";
import { getCircuitBreaker, recordBreakerSuccess, recordBreakerFailure, consumeBudget, BudgetExceededError } from "../../ai/ProviderRouter.js";

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

    const failHonestly = async (reason: string, errorMessage: string, metadata: Record<string, unknown> = {}) => {
      if (payload.job_id) {
        await this.pool.query(
          `UPDATE public.video_jobs SET status = 'failed', error_message = $3, completed_at = NOW()
           WHERE id = $1 AND organization_id = $2;`,
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
        metadata: { reason, ...metadata },
      });
      throw new Error(errorMessage);
    };

    // Stage A (honest failure, unchanged): no credential configured at all.
    let credential;
    try {
      credential = getCredential("minimax");
    } catch (err) {
      if (err instanceof ProviderCredentialError) {
        return failHonestly(
          "PROVIDER_NOT_CONFIGURED",
          "PROVIDER_NOT_CONFIGURED: no video-generation provider is wired to Video Factory yet.",
          { duration: payload.duration }
        );
      }
      throw err;
    }

    // Stage B (2026-10-25): real MiniMax Hailuo video-01 integration, reusing
    // the existing text-provider circuit breaker and daily budget cap under
    // the "minimax" provider identity (ProviderRouter.ts) rather than inventing
    // a parallel control for media jobs. Organization identity comes only from
    // the trusted queue job row (organization_id above) — never from payload.

    const breaker = getCircuitBreaker("minimax");
    if (breaker.state === "OPEN") {
      return failHonestly("CIRCUIT_BREAKER_OPEN", "CIRCUIT_BREAKER_OPEN: the minimax provider is temporarily unavailable after repeated failures.", {});
    }

    try {
      consumeBudget(organization_id);
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        return failHonestly("BUDGET_EXCEEDED", err.message, {});
      }
      throw err;
    }

    try {
      const assetUrl = await this.generateMiniMaxVideo(payload, credential.apiKey);
      recordBreakerSuccess("minimax");

      if (payload.job_id) {
        await this.pool.query(
          `UPDATE public.video_jobs SET status = 'completed', completed_at = NOW() WHERE id = $1 AND organization_id = $2;`,
          [payload.job_id, organization_id]
        );
        await this.pool.query(
          `INSERT INTO public.video_assets (job_id, project_id, asset_url, video_type, prompt, negative_prompt, provider, model, organization_id)
           VALUES ($1, $2, $3, $4, $5, $6, 'minimax', $7, $8);`,
          [payload.job_id, payload.project_id ?? null, assetUrl, payload.video_type ?? null, payload.prompt, payload.negative_prompt ?? null, "MiniMax-Hailuo-2.3", organization_id]
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
        metadata: { provider: "minimax" },
      });

      return { assetUrl };
    } catch (err: any) {
      recordBreakerFailure("minimax", err?.message ?? String(err));
      return failHonestly("PROVIDER_CALL_FAILED", `PROVIDER_CALL_FAILED: ${err?.message ?? String(err)}`, { provider: "minimax" });
    }
  }

  /**
   * MiniMax Hailuo video generation — a 3-step async contract verified via
   * live provider documentation search on 2026-10-25 (platform.minimax.io):
   *   1. POST /v1/video_generation -> { task_id }
   *   2. GET  /v1/query/video_generation?task_id=... -> { status, file_id }  (poll)
   *   3. GET  /v1/files/retrieve?file_id=...          -> { download_url }
   * The download_url MiniMax returns is time-limited (~9h per their docs) --
   * this handler persists it as-is; a job to re-fetch/permanently re-host the
   * asset before expiry is a separate, not-yet-implemented concern, noted
   * here rather than silently assumed away.
   *
   * No speculative field names: every field read below was named explicitly
   * in the verified documentation search, not guessed. If the live response
   * ever doesn't match this shape, this function throws rather than
   * persisting a fabricated or partial result.
   */
  private async generateMiniMaxVideo(payload: MediaJobPayload, apiKey: string): Promise<string> {
    const SUBMIT_URL = "https://api.minimax.io/v1/video_generation";
    const QUERY_URL = "https://api.minimax.io/v1/query/video_generation";
    const RETRIEVE_URL = "https://api.minimax.io/v1/files/retrieve";
    const SUBMIT_TIMEOUT_MS = 15000;
    const POLL_TIMEOUT_MS = 10000;
    const POLL_INTERVAL_MS = 8000;
    const MAX_WAIT_MS = 240000; // in-job wait budget; heartbeat (handle()) keeps the lease alive throughout

    const authHeaders = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

    const submitRes = await fetch(SUBMIT_URL, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        model: "MiniMax-Hailuo-2.3",
        prompt: payload.prompt,
        duration: payload.duration ? Number(payload.duration) : undefined,
        resolution: payload.quality === "high" ? "1080P" : "768P",
      }),
      signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
    });
    const submitBody: any = await submitRes.json().catch(() => null);
    if (!submitRes.ok || !submitBody?.task_id) {
      throw new Error(`MiniMax submit failed (HTTP ${submitRes.status}): ${submitBody?.base_resp?.status_msg ?? "malformed response"}`);
    }
    const taskId = submitBody.task_id as string;

    const startedAt = Date.now();
    let fileId: string | undefined;
    while (Date.now() - startedAt < MAX_WAIT_MS) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const queryRes = await fetch(`${QUERY_URL}?task_id=${encodeURIComponent(taskId)}`, {
        headers: authHeaders,
        signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
      });
      const queryBody: any = await queryRes.json().catch(() => null);
      if (!queryRes.ok || !queryBody?.status) {
        throw new Error(`MiniMax status query failed (HTTP ${queryRes.status}): malformed response`);
      }
      if (queryBody.status === "Success") {
        fileId = queryBody.file_id;
        break;
      }
      if (queryBody.status === "Fail") {
        throw new Error(`MiniMax reported generation failure for task ${taskId}`);
      }
      // "Processing"/"Queueing" or any other non-terminal status: keep polling.
    }
    if (!fileId) {
      throw new Error(`MiniMax generation did not complete within ${MAX_WAIT_MS}ms (task ${taskId})`);
    }

    const retrieveRes = await fetch(`${RETRIEVE_URL}?file_id=${encodeURIComponent(fileId)}`, {
      headers: authHeaders,
      signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
    });
    const retrieveBody: any = await retrieveRes.json().catch(() => null);
    if (!retrieveRes.ok || !retrieveBody?.file?.download_url) {
      throw new Error(`MiniMax file retrieval failed (HTTP ${retrieveRes.status}): malformed response`);
    }
    return retrieveBody.file.download_url as string;
  }
}
