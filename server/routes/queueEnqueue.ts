import type { Request, Response } from "express";
import { CapabilityNotImplementedError, sendError } from "../lib/errors.js";
import { gatedCapabilityFor, isCapabilityEnabled } from "../lib/capabilityFlags.js";

/**
 * POST /api/v1/queue/enqueue handler. Rejects job types whose capability is
 * switched off (default) before anything is written to job_queue.
 */
export function createEnqueueHandler(
  getQueueManager: () => { enqueueJob: (args: any) => Promise<any> },
  env: Record<string, string | undefined> = process.env,
) {
  return async (req: Request, res: Response): Promise<void> => {
    const auth = (req as any).auth;
    const { jobType, payload, priority, idempotencyKey, scheduledAt, timeoutMs, maxRetries, dependencies } = req.body ?? {};

    if (!jobType || !payload) {
      res.status(400).json({ error: "jobType and payload are required" });
      return;
    }

    const capability = gatedCapabilityFor(jobType);
    if (capability && !isCapabilityEnabled(capability, env)) {
      const err = new CapabilityNotImplementedError(`${capability} jobs`);
      sendError(res, 501, err.code, String(req.headers?.["x-request-id"] ?? "enqueue"), err.message, {
        capability,
      });
      return;
    }

    try {
      const job = await getQueueManager().enqueueJob({
        organizationId: auth!.organizationId,
        jobType,
        payload,
        priority,
        idempotencyKey,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
        timeoutMs,
        maxRetries,
        dependencies,
      });
      res.status(201).json({ success: true, job });
    } catch (err: any) {
      console.error("[Runtime] Enqueue error:", err.message);
      res.status(500).json({ error: err.message });
    }
  };
}
