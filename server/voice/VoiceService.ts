/**
 * Voice Studio — service layer. Mirrors CommunicationService.ts's shape:
 * validates input, enforces tenant isolation on every query, enqueues onto
 * the EXISTING job_queue (never a bespoke voice queue), emits an audit event
 * on every state change. This class never dispatches a call itself — that
 * happens worker-side, in VoiceJobHandler.ts, after the job is claimed.
 */
import type pg from "pg";
import { randomUUID } from "crypto";
import { QueueManager } from "../queue/QueueManager.js";
import { emitAuditEvent } from "../audit.js";
import {
  ALLOWED_SCRIPT_VARIABLES,
  SCRIPT_SECTION_FIELDS,
  validateCode,
  validateContactName,
  validateDeclaredVariables,
  validateDriverName,
  validateLanguage,
  validateObjective,
  validatePhone,
  validateRef,
  validateScriptSection,
  validateScriptName,
  validateScriptStatus,
  validateTone,
  validateVariableUsage,
  VoiceValidationError,
  type ScriptSectionField,
} from "./validation.js";
import { maskPhone, type VoiceCapture } from "./voiceDriver.js";

export class VoiceNotFoundError extends Error {
  constructor() {
    super("Voice call not found");
    this.name = "VoiceNotFoundError";
  }
}

export class VoiceDuplicateDispatchError extends Error {
  constructor(public readonly existingRef: string) {
    super(`A call with ref "${existingRef}" was already dispatched for this organization.`);
    this.name = "VoiceDuplicateDispatchError";
  }
}

export class VoiceScriptNotFoundError extends Error {
  constructor() {
    super("Voice script not found");
    this.name = "VoiceScriptNotFoundError";
  }
}

export class VoiceScriptConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceScriptConflictError";
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface DispatchCallInput {
  ref: string;
  contactName: string;
  company?: string | null;
  phone?: string | null;
  objective: string;
  language?: string;
  driver: "simulated" | "dograh";
  entityType?: string;
  entityId?: string | null;
  rfqNumber?: string | null;
  campaignId?: string | null;
  agentKey?: string | null;
}

export class VoiceService {
  private pool: pg.Pool;
  private queueManager: QueueManager;

  constructor(pool: pg.Pool) {
    this.pool = pool;
    this.queueManager = new QueueManager(pool);
  }

  /**
   * Validates and records intent to dispatch, then enqueues a 'voice' job
   * onto the existing job_queue. Idempotent on (organizationId, ref): a
   * repeat dispatch for a ref that already has a call row returns the
   * existing row rather than creating a second one or a second job.
   */
  async dispatchCall(organizationId: string, userId: string, requestId: string, input: DispatchCallInput) {
    const ref = validateRef(input.ref);
    const contactName = validateContactName(input.contactName);
    const phone = validatePhone(input.phone ?? null);
    const objective = validateObjective(input.objective);
    const language = validateLanguage(input.language);
    const driver = validateDriverName(input.driver);

    const existing = await this.pool.query(
      `SELECT id, ref, status FROM public.voice_calls WHERE organization_id = $1 AND ref = $2`,
      [organizationId, ref],
    );
    if (existing.rows.length > 0) {
      return { call: existing.rows[0], created: false };
    }

    const insert = await this.pool.query(
      `INSERT INTO public.voice_calls
         (organization_id, ref, campaign_id, agent_key, contact_name, company, phone_masked,
          entity_type, entity_id, driver, status, rfq_number, language)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'queued',$11,$12)
       RETURNING *`,
      [
        organizationId,
        ref,
        input.campaignId ?? null,
        input.agentKey ?? null,
        contactName,
        input.company ?? null,
        maskPhone(phone),
        input.entityType ?? "supplier",
        input.entityId ?? null,
        driver,
        input.rfqNumber ?? null,
        language,
      ],
    );
    const call = insert.rows[0];

    // Full phone number lives only in the job payload (consumed once by the
    // worker, never persisted in plaintext) -- the row above keeps only the
    // masked display form.
    await this.queueManager.enqueueJob({
      organizationId,
      jobType: "voice",
      idempotencyKey: `voice-dispatch-${organizationId}-${ref}`,
      payload: {
        callId: call.id,
        ref,
        contactName,
        company: input.company ?? null,
        phone,
        objective,
        language,
        driver,
      },
    });

    emitAuditEvent({
      actor: userId,
      organizationId,
      action: "voice.dispatch",
      targetType: "voice_call",
      targetId: call.id,
      outcome: "success",
      requestId,
      metadata: { ref, driver, simulated: driver === "simulated" },
    });

    return { call, created: true };
  }

  async listCalls(organizationId: string, limit = 50) {
    const res = await this.pool.query(
      `SELECT * FROM public.voice_calls WHERE organization_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [organizationId, Math.min(Math.max(limit, 1), 200)],
    );
    return res.rows;
  }

  async getCall(organizationId: string, ref: string) {
    const callRes = await this.pool.query(
      `SELECT * FROM public.voice_calls WHERE organization_id = $1 AND ref = $2`,
      [organizationId, ref],
    );
    if (callRes.rows.length === 0) throw new VoiceNotFoundError();
    const call = callRes.rows[0];
    const messages = await this.pool.query(
      `SELECT * FROM public.voice_call_messages WHERE organization_id = $1 AND call_id = $2 ORDER BY seq ASC`,
      [organizationId, call.id],
    );
    return { ...call, messages: messages.rows };
  }

  /**
   * Applies a driver's capture to a call row (either the simulated driver's
   * inline result, from VoiceJobHandler, or a Dograh webhook callback).
   * Idempotent: a second application for a call that already reached a
   * terminal status is a no-op, reported back as `applied: false`.
   */
  async applyCapture(
    organizationId: string,
    callId: string,
    capture: VoiceCapture,
    extra: { driverJobId?: string | null; transcript?: { speaker: string; text: string; atSec: number }[]; durationSec?: number; recordingUrl?: string | null },
  ): Promise<{ applied: boolean; call: any }> {
    const existing = await this.pool.query(
      `SELECT * FROM public.voice_calls WHERE organization_id = $1 AND id = $2`,
      [organizationId, callId],
    );
    if (existing.rows.length === 0) throw new VoiceNotFoundError();
    const call = existing.rows[0];

    if (call.status === "completed" || call.status === "failed") {
      return { applied: false, call };
    }

    const updated = await this.pool.query(
      `UPDATE public.voice_calls
         SET status = 'completed', outcome = $3, interested = $4, price = $5, currency = $6,
             moq = $7, delivery_days = $8, remarks = $9, confidence = $10,
             driver_job_id = COALESCE($11, driver_job_id), duration_sec = $12,
             recording_url = COALESCE($13, recording_url), ended_at = NOW(), updated_at = NOW()
       WHERE organization_id = $1 AND id = $2
       RETURNING *`,
      [
        organizationId,
        callId,
        capture.outcome,
        capture.interested,
        capture.price,
        capture.currency,
        capture.moq,
        capture.deliveryDays,
        capture.remarks,
        capture.confidence,
        extra.driverJobId ?? null,
        extra.durationSec ?? 0,
        extra.recordingUrl ?? null,
      ],
    );

    if (extra.transcript?.length) {
      for (let i = 0; i < extra.transcript.length; i++) {
        const m = extra.transcript[i];
        await this.pool.query(
          `INSERT INTO public.voice_call_messages (call_id, organization_id, seq, speaker, text, at_sec)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [callId, organizationId, i, m.speaker, m.text, m.atSec],
        );
      }
    }

    // Bell24h-OS owns this write -- the driver never writes comm_events itself.
    await this.pool.query(
      `INSERT INTO public.comm_events
         (organization_id, ref, channel, direction, contact_name, company, outcome, call_ref, entity_type, rfq_number)
       VALUES ($1,$2,'voice','outbound',$3,$4,$5,$6,$7,$8)`,
      [
        organizationId,
        `comm-${randomUUID()}`,
        call.contact_name,
        call.company,
        capture.outcome,
        call.ref,
        call.entity_type,
        call.rfq_number,
      ],
    );

    return { applied: true, call: updated.rows[0] };
  }

  async markDispatched(organizationId: string, callId: string, driverJobId: string) {
    await this.pool.query(
      `UPDATE public.voice_calls SET status = 'dispatched', driver_job_id = $3, started_at = NOW(), updated_at = NOW()
       WHERE organization_id = $1 AND id = $2`,
      [organizationId, callId, driverJobId],
    );
  }

  async markFailed(organizationId: string, callId: string, error: string) {
    await this.pool.query(
      `UPDATE public.voice_calls SET status = 'failed', error = $3, ended_at = NOW(), updated_at = NOW()
       WHERE organization_id = $1 AND id = $2`,
      [organizationId, callId, error],
    );
  }

  /** Finds the call a Dograh webhook callback refers to, by driver_job_id first, taskRef as fallback. */
  async findCallForWebhook(organizationId: string, driverJobId: string | null, taskRef: string | null) {
    if (driverJobId) {
      const byJob = await this.pool.query(
        `SELECT * FROM public.voice_calls WHERE organization_id = $1 AND driver_job_id = $2`,
        [organizationId, driverJobId],
      );
      if (byJob.rows.length > 0) return byJob.rows[0];
    }
    if (taskRef) {
      const byRef = await this.pool.query(
        `SELECT * FROM public.voice_calls WHERE organization_id = $1 AND ref = $2`,
        [organizationId, taskRef],
      );
      if (byRef.rows.length > 0) return byRef.rows[0];
    }
    return null;
  }

  // ─── Agents (representative "builder" CRUD) ────────────────────────────

  async listAgents(organizationId: string) {
    const res = await this.pool.query(
      `SELECT * FROM public.voice_agents WHERE organization_id = $1 ORDER BY created_at DESC`,
      [organizationId],
    );
    return res.rows;
  }

  async createAgent(organizationId: string, userId: string, requestId: string, input: { agentKey: string; name: string; purpose: string; language?: string }) {
    const agentKey = validateCode(input.agentKey, "agentKey");
    if (typeof input.name !== "string" || !input.name.trim()) {
      throw new VoiceValidationError("name", "name is required");
    }
    const res = await this.pool.query(
      `INSERT INTO public.voice_agents (organization_id, agent_key, name, purpose, language)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [organizationId, agentKey, input.name.trim(), input.purpose ?? "", validateLanguage(input.language)],
    );
    emitAuditEvent({
      actor: userId,
      organizationId,
      action: "voice.agent.create",
      targetType: "voice_agent",
      targetId: res.rows[0].id,
      outcome: "success",
      requestId,
    });
    return res.rows[0];
  }

  // ─── Campaigns (representative "builder" CRUD) ─────────────────────────

  async listCampaigns(organizationId: string) {
    const res = await this.pool.query(
      `SELECT * FROM public.voice_campaigns WHERE organization_id = $1 ORDER BY created_at DESC`,
      [organizationId],
    );
    return res.rows;
  }

  async createCampaign(organizationId: string, userId: string, requestId: string, input: { code: string; name: string; objective?: string }) {
    const code = validateCode(input.code, "code");
    if (typeof input.name !== "string" || !input.name.trim()) {
      throw new VoiceValidationError("name", "name is required");
    }
    const res = await this.pool.query(
      `INSERT INTO public.voice_campaigns (organization_id, code, name, objective)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [organizationId, code, input.name.trim(), input.objective ?? null],
    );
    emitAuditEvent({
      actor: userId,
      organizationId,
      action: "voice.campaign.create",
      targetType: "voice_campaign",
      targetId: res.rows[0].id,
      outcome: "success",
      requestId,
    });
    return res.rows[0];
  }

  // ─── Call Scripts ───────────────────────────────────────────────────────
  //
  // voice_scripts is the mutable draft/current row (status: draft | published
  // | archived; version: 0 until first published). voice_script_versions
  // holds immutable snapshots, one per publish. Editing a published script's
  // content flips it back to 'draft' -- the row no longer matches the latest
  // snapshot until it is published again -- so "draft editing" and
  // "published versions" never collapse into one ambiguous state.

  private withParsedVariables<T extends { variables: unknown }>(row: T): T {
    if (typeof row.variables !== "string") return row;
    try {
      return { ...row, variables: JSON.parse(row.variables) };
    } catch {
      return { ...row, variables: [] };
    }
  }

  async listScripts(organizationId: string) {
    const res = await this.pool.query(
      `SELECT * FROM public.voice_scripts WHERE organization_id = $1 ORDER BY created_at DESC`,
      [organizationId],
    );
    return res.rows.map((r) => this.withParsedVariables(r));
  }

  private async getScriptRow(organizationId: string, code: string) {
    const res = await this.pool.query(
      `SELECT * FROM public.voice_scripts WHERE organization_id = $1 AND code = $2`,
      [organizationId, code],
    );
    if (res.rows.length === 0) throw new VoiceScriptNotFoundError();
    return res.rows[0];
  }

  async getScript(organizationId: string, code: string) {
    const script = await this.getScriptRow(organizationId, code);
    const versions = await this.pool.query(
      `SELECT id, version, published_by, published_at FROM public.voice_script_versions
       WHERE organization_id = $1 AND script_id = $2 ORDER BY version DESC`,
      [organizationId, script.id],
    );
    return { ...this.withParsedVariables(script), versions: versions.rows };
  }

  private buildSections(input: Record<string, unknown>): Record<ScriptSectionField, string | null> {
    const out = {} as Record<ScriptSectionField, string | null>;
    for (const field of SCRIPT_SECTION_FIELDS) {
      out[field] = validateScriptSection(input[field], field);
    }
    return out;
  }

  async createScript(organizationId: string, userId: string, requestId: string, input: Record<string, unknown>) {
    const code = validateCode(input.code, "code");
    const name = validateScriptName(input.name);
    const language = validateLanguage(input.language);
    const tone = validateTone(input.tone);
    const variables = validateDeclaredVariables(input.variables);
    const sections = this.buildSections(input);
    validateVariableUsage(sections, variables);

    const existing = await this.pool.query(`SELECT id FROM public.voice_scripts WHERE organization_id = $1 AND code = $2`, [
      organizationId,
      code,
    ]);
    if (existing.rows.length > 0) {
      throw new VoiceScriptConflictError(`A script with code "${code}" already exists for this organization.`);
    }

    const res = await this.pool.query(
      `INSERT INTO public.voice_scripts
         (organization_id, code, name, agent_key, language, tone,
          opening, verification, purpose, questions, objections, negotiation, closing, escalation, fallback,
          variables, status, version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'draft',0)
       RETURNING *`,
      [
        organizationId,
        code,
        name,
        typeof input.agentKey === "string" ? input.agentKey : null,
        language,
        tone,
        sections.opening,
        sections.verification,
        sections.purpose,
        sections.questions,
        sections.objections,
        sections.negotiation,
        sections.closing,
        sections.escalation,
        sections.fallback,
        JSON.stringify(variables),
      ],
    );
    const script = res.rows[0];
    emitAuditEvent({
      actor: userId,
      organizationId,
      action: "voice.script.create",
      targetType: "voice_script",
      targetId: script.id,
      outcome: "success",
      requestId,
      metadata: { code },
    });
    return this.withParsedVariables(script);
  }

  async updateScript(organizationId: string, userId: string, requestId: string, code: string, input: Record<string, unknown>) {
    const current = await this.getScriptRow(organizationId, code);
    if (current.status === "archived") {
      throw new VoiceScriptConflictError("An archived script must not be edited.");
    }

    const name = input.name !== undefined ? validateScriptName(input.name) : current.name;
    const language = input.language !== undefined ? validateLanguage(input.language) : current.language;
    const tone = input.tone !== undefined ? validateTone(input.tone) : current.tone;
    const variables =
      input.variables !== undefined ? validateDeclaredVariables(input.variables) : JSON.parse(current.variables || "[]");

    const sections = {} as Record<ScriptSectionField, string | null>;
    for (const field of SCRIPT_SECTION_FIELDS) {
      sections[field] = input[field] !== undefined ? validateScriptSection(input[field], field) : current[field];
    }
    validateVariableUsage(sections, variables);

    // Editing a published script's content means the live row no longer
    // matches the last published snapshot -- it reverts to 'draft' rather
    // than silently keeping a 'published' label on unpublished content.
    const nextStatus = current.status === "published" ? "draft" : current.status;

    const res = await this.pool.query(
      `UPDATE public.voice_scripts
         SET name=$3, agent_key=$4, language=$5, tone=$6,
             opening=$7, verification=$8, purpose=$9, questions=$10, objections=$11,
             negotiation=$12, closing=$13, escalation=$14, fallback=$15,
             variables=$16, status=$17, updated_at=NOW()
       WHERE organization_id=$1 AND id=$2
       RETURNING *`,
      [
        organizationId,
        current.id,
        name,
        input.agentKey !== undefined ? input.agentKey : current.agent_key,
        language,
        tone,
        sections.opening,
        sections.verification,
        sections.purpose,
        sections.questions,
        sections.objections,
        sections.negotiation,
        sections.closing,
        sections.escalation,
        sections.fallback,
        JSON.stringify(variables),
        nextStatus,
      ],
    );
    const script = res.rows[0];
    emitAuditEvent({
      actor: userId,
      organizationId,
      action: "voice.script.update",
      targetType: "voice_script",
      targetId: script.id,
      outcome: "success",
      requestId,
      metadata: { code, revertedToDraft: current.status === "published" },
    });
    return this.withParsedVariables(script);
  }

  async duplicateScript(
    organizationId: string,
    userId: string,
    requestId: string,
    code: string,
    input: { newCode: unknown; newName?: unknown },
  ) {
    const source = await this.getScriptRow(organizationId, code);
    const newCode = validateCode(input.newCode, "newCode");
    const newName = input.newName !== undefined ? validateScriptName(input.newName) : `${source.name} (Copy)`;

    const existing = await this.pool.query(`SELECT id FROM public.voice_scripts WHERE organization_id = $1 AND code = $2`, [
      organizationId,
      newCode,
    ]);
    if (existing.rows.length > 0) {
      throw new VoiceScriptConflictError(`A script with code "${newCode}" already exists for this organization.`);
    }

    // A duplicate is always a fresh draft -- it does not inherit the
    // source's publish history or status.
    const res = await this.pool.query(
      `INSERT INTO public.voice_scripts
         (organization_id, code, name, agent_key, language, tone,
          opening, verification, purpose, questions, objections, negotiation, closing, escalation, fallback,
          variables, status, version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'draft',0)
       RETURNING *`,
      [
        organizationId,
        newCode,
        newName,
        source.agent_key,
        source.language,
        source.tone,
        source.opening,
        source.verification,
        source.purpose,
        source.questions,
        source.objections,
        source.negotiation,
        source.closing,
        source.escalation,
        source.fallback,
        source.variables,
      ],
    );
    const script = res.rows[0];
    emitAuditEvent({
      actor: userId,
      organizationId,
      action: "voice.script.duplicate",
      targetType: "voice_script",
      targetId: script.id,
      outcome: "success",
      requestId,
      metadata: { sourceCode: code, newCode },
    });
    return this.withParsedVariables(script);
  }

  async publishScript(organizationId: string, userId: string, requestId: string, code: string) {
    const current = await this.getScriptRow(organizationId, code);
    if (current.status === "archived") {
      throw new VoiceScriptConflictError("An archived script must not be published.");
    }
    if (current.status === "published") {
      return { script: this.withParsedVariables(current), published: false };
    }

    const nextVersion = current.version + 1;
    const res = await this.pool.query(
      `UPDATE public.voice_scripts SET status='published', version=$3, updated_at=NOW()
       WHERE organization_id=$1 AND id=$2 RETURNING *`,
      [organizationId, current.id, nextVersion],
    );
    const script = res.rows[0];

    await this.pool.query(
      `INSERT INTO public.voice_script_versions
         (script_id, organization_id, version, name, agent_key, language, tone,
          opening, verification, purpose, questions, objections, negotiation, closing, escalation, fallback,
          variables, published_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        script.id,
        organizationId,
        nextVersion,
        script.name,
        script.agent_key,
        script.language,
        script.tone,
        script.opening,
        script.verification,
        script.purpose,
        script.questions,
        script.objections,
        script.negotiation,
        script.closing,
        script.escalation,
        script.fallback,
        script.variables,
        userId,
      ],
    );

    emitAuditEvent({
      actor: userId,
      organizationId,
      action: "voice.script.publish",
      targetType: "voice_script",
      targetId: script.id,
      outcome: "success",
      requestId,
      metadata: { code, version: nextVersion },
    });
    return { script: this.withParsedVariables(script), published: true };
  }

  /**
   * Pure, read-only render of a script's sections with {{variable}} tokens
   * substituted and HTML-escaped. No call is placed, no driver is touched,
   * nothing is written to any table -- a text preview only.
   */
  async previewScript(organizationId: string, code: string, sampleValues: Record<string, unknown> = {}) {
    const script = await this.getScriptRow(organizationId, code);
    const declared: string[] = JSON.parse(script.variables || "[]");

    const safeValues: Record<string, string> = {};
    for (const [key, value] of Object.entries(sampleValues)) {
      if (!(ALLOWED_SCRIPT_VARIABLES as readonly string[]).includes(key)) {
        throw new VoiceValidationError("sampleValues", `unknown variable "${key}"`);
      }
      if (typeof value !== "string" || value.length > 200 || /[\r\n]/.test(value)) {
        throw new VoiceValidationError("sampleValues", `sampleValues.${key} must be a single-line string (max 200 chars)`);
      }
      safeValues[key] = value;
    }

    const render = (text: string | null): string | null => {
      if (text === null) return null;
      return text.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_match, varName: string) => {
        const resolved = safeValues[varName] ?? `[${varName}]`;
        return escapeHtml(resolved);
      });
    };

    const sections: Record<string, string | null> = {};
    for (const field of SCRIPT_SECTION_FIELDS) sections[field] = render(script[field]);

    return {
      preview: true,
      disclaimer: "This is a text preview only. No call is placed and no voice is synthesized.",
      code: script.code,
      name: script.name,
      status: script.status,
      version: script.version,
      declaredVariables: declared,
      sections,
    };
  }
}
