/**
 * Bell24h-OS Enterprise Edition
 * AI Job Handler — Server-Side Content & Text Generation
 * Phase: B.5B.2 Worker Fleet Subsystem
 */

import pg from "pg";
import { QueueJob } from "../../queue/QueueTypes.js";
import * as aiRouter from "../../ai/ProviderRouter.js";
import { newRequestId, emitAuditEvent } from "../../audit.js";

export interface AIJobPayload {
  prompt?: string;
  topic?: string;
  contentType?: string;
  projectId?: string;
  content_job_id?: string;
  topic_id?: string;
  provider?: "gemini" | "nvidia";
  model?: string;
  systemPrompt?: string;
  parameters?: Record<string, any>;
}

export class AIJobHandler {
  private pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  /**
   * Executes an asynchronous AI task using server-side ProviderRouter.
   */
  async handle(job: QueueJob<AIJobPayload>): Promise<any> {
    const { payload, organization_id, id: jobId } = job;
    const requestId = newRequestId();

    const routerContext: aiRouter.RouterContext = {
      userId: payload?.parameters?.userId || "system:worker",
      organizationId: organization_id,
      requestId,
      action: `job.ai.${job.job_type}`,
    };

    // Synthesize prompt from payload
    let prompt = payload.prompt || "";
    if (!prompt && payload.topic && payload.contentType) {
      prompt = `Generate high-quality, professional enterprise marketing content for topic: "${payload.topic}". Content Type: ${payload.contentType}.`;
    }

    if (!prompt) {
      throw new Error(`Invalid AI job payload: missing 'prompt' or 'topic'`);
    }

    const provider = payload.provider || "gemini";
    let generatedText: string;

    if (provider === "nvidia") {
      generatedText = await aiRouter.generateNvidiaText(routerContext, {
        prompt,
        model: payload.model,
      });
    } else {
      generatedText = await aiRouter.generateText(routerContext, {
        prompt,
        model: payload.model,
      });
    }

    // If this job was linked to content_jobs, persist to content_outputs
    if (payload.content_job_id || payload.topic_id) {
      await this.persistContentOutput(job, generatedText);
    }

    emitAuditEvent({
      actor: "service:worker",
      organizationId: organization_id,
      action: "job.ai.completed",
      targetType: "job_queue",
      targetId: jobId,
      outcome: "success",
      requestId,
      metadata: {
        jobType: job.job_type,
        provider,
        outputLength: generatedText.length,
      },
    });

    return {
      output: generatedText,
      requestId,
      provider,
    };
  }

  private async persistContentOutput(job: QueueJob<AIJobPayload>, content: string): Promise<void> {
    const { payload, organization_id } = job;
    try {
      // 1. Update content_jobs status if ID provided
      if (payload.content_job_id) {
        await this.pool.query(
          `
          UPDATE public.content_jobs
          SET status = 'completed', completed_at = NOW()
          WHERE id = $1 AND organization_id = $2;
          `,
          [payload.content_job_id, organization_id]
        );
      }

      // 2. Insert into content_outputs if topic_id provided
      if (payload.topic_id) {
        await this.pool.query(
          `
          INSERT INTO public.content_outputs (
            job_id,
            topic_id,
            content_type,
            content,
            organization_id,
            created_at,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW());
          `,
          [
            payload.content_job_id || job.id,
            payload.topic_id,
            payload.contentType || "article",
            content,
            organization_id,
          ]
        );
      }
    } catch (err: any) {
      console.error("[AIJobHandler] Failed to persist content output:", err.message);
      // Non-fatal to job completion itself
    }
  }
}
