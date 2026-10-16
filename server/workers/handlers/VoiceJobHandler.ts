/**
 * Voice Job Handler — Worker-Side Call Dispatch
 *
 * Claims a 'voice' job from the existing job_queue (server/queue/QueueManager.ts)
 * and runs it through the appropriate VoiceDriver. Mirrors
 * CommunicationJobHandler.ts's shape: the worker owns the writeback, never
 * the driver itself.
 *
 * Two outcomes, matching the two drivers' own synchronous-vs-async design:
 *   simulated — dispatch() returns a capture inline; this handler applies it
 *               immediately and the job completes in one pass.
 *   dograh    — dispatch() only confirms the call was accepted; the real
 *               capture arrives later via the webhook route
 *               (server/voice/routes.ts), not from this handler. The job
 *               still completes here once Dograh has accepted the request —
 *               "accepted" and "captured" are different events on purpose.
 */
import pg from "pg";
import { QueueJob } from "../../queue/QueueTypes.js";
import { getDriver, type VoiceDispatchInput } from "../../voice/voiceDriver.js";
import { VoiceService } from "../../voice/VoiceService.js";
import { newRequestId, emitAuditEvent } from "../../audit.js";

export interface VoiceJobPayload {
  callId: string;
  ref: string;
  contactName: string;
  company: string | null;
  phone: string | null;
  objective: string;
  language: string;
  driver: "simulated" | "dograh";
}

export class VoiceJobHandler {
  private pool: pg.Pool;
  private service: VoiceService;

  constructor(pool: pg.Pool) {
    this.pool = pool;
    this.service = new VoiceService(pool);
  }

  async handle(job: QueueJob<VoiceJobPayload>): Promise<any> {
    const { payload, organization_id: organizationId, id: jobId } = job;
    const requestId = newRequestId();

    const input: VoiceDispatchInput = {
      ref: payload.ref,
      contactName: payload.contactName,
      company: payload.company,
      phone: payload.phone,
      objective: payload.objective,
      language: payload.language,
      rfq: null, // Batch 1 scope: RFQ linkage is a follow-up, not implemented this batch.
    };

    const driver = getDriver(payload.driver);
    const result = await driver.dispatch(input);

    if (!result.accepted) {
      await this.service.markFailed(organizationId, payload.callId, result.error ?? "Driver rejected the dispatch.");
      emitAuditEvent({
        actor: "service:worker",
        organizationId,
        action: "voice.dispatch.failed",
        targetType: "voice_call",
        targetId: payload.callId,
        outcome: "failure",
        requestId,
        metadata: { ref: payload.ref, driver: payload.driver, error: result.error },
      });
      // A driver-level rejection (e.g. missing Dograh config, no phone
      // number) is not a transient/retryable failure -- throwing here would
      // let QueueManager's own retry policy keep re-attempting a dispatch
      // that will fail identically every time.
      throw new Error(result.error ?? "Voice dispatch failed");
    }

    if (result.capture) {
      // Simulated driver -- capture is already here, apply it now.
      await this.service.applyCapture(organizationId, payload.callId, result.capture, {
        driverJobId: result.driverJobId,
        transcript: result.transcript,
      });
    } else {
      // Dograh -- accepted, capture arrives later via the webhook.
      await this.service.markDispatched(organizationId, payload.callId, result.driverJobId);
    }

    emitAuditEvent({
      actor: "service:worker",
      organizationId,
      action: "voice.dispatch.completed",
      targetType: "voice_call",
      targetId: payload.callId,
      outcome: "success",
      requestId,
      metadata: { ref: payload.ref, driver: payload.driver, simulated: driver.simulated },
    });

    return { driverJobId: result.driverJobId, simulated: driver.simulated };
  }
}
